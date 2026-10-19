'use strict';

// The Video Tools and Music tutor (one catalogue, two pages): a person says what they want to make ("add my script as captions to a video"), and the tutor works out
// which of the tools that really exist to use, in what order, or says plainly that a piece is missing or that the job is
// outside what Video Tools and Music do.
//
// The tutor only knows what is in CATALOG below. A test (videoTutor.test.js) fails if a tool is added to or removed from the
// Video Tools sidebar (client TOOL_GROUPS) or the Music sidebar (client/src/pages/music/musicTools.mjs) without this file being updated, so the advice cannot quietly go stale. The model's answer is
// treated as untrusted: it is parsed, trimmed and every tool id is checked against the catalogue before anything is shown.

const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');

// id = the sidebar id the page opens. `needs` = what you must bring; `makes` = what you get; `notes` = limits worth knowing.
const CATALOG = [
  { id: 'generate', label: 'Generate clip', group: 'Make',
    does: 'Makes a short AI video clip (3-10 seconds) from a written description, optionally starting from a picture, a reference video or a YouTube example. Can make several takes.',
    needs: 'a description (a picture or reference is optional)', makes: 'a short video clip',
    notes: 'Costs money per clip (AI service). Needs the video-generation service to be set up. Short clips only.' },
  { id: 'convert', label: 'Convert / compress', group: 'Export and convert',
    does: 'Re-saves a video as MP4 with a chosen quality and an optional maximum width, to make the file smaller or fix a format that will not play.',
    needs: 'a video', makes: 'an MP4 video', notes: 'Lower quality number = better picture and a bigger file.' },
  { id: 'extract-audio', label: 'Extract audio', group: 'Audio',
    does: 'Pulls the soundtrack out of a video and saves it as an MP3.', needs: 'a video', makes: 'an MP3 audio file', notes: '' },
  { id: 'isolate-voice', label: 'Isolate voice', group: 'Audio',
    does: 'Takes the spoken words out of a recording that has background music. Best quality (AI) separates the voice from the music and also gives the music-only file; the Quick filter is free but only turns the music down.',
    needs: 'an audio file', makes: 'a voice-only audio file (and music-only with the AI option)',
    notes: 'AI option costs a small amount per run and takes a minute or two. Singing in the music leaks into the voice. Audio files only; for a video, run Extract audio first.' },
  { id: 'transcribe-audio', label: 'Audio → transcript', group: 'Audio',
    does: 'Writes out what is said in an audio or video file as editable text (plain, or with timestamps as an SRT). Also times a script you already wrote (or one with [00:00 - 00:12] times in it) to the recording. From the result you can send the captions to Caption studio, put them straight onto a video, or make a plain coloured video from audio with the words along the bottom.',
    needs: 'an audio or video file (or a script)', makes: 'text, an SRT subtitle file, or a captioned video',
    notes: 'Speech only. Needs the Gemini setup for listening. Up to about 75 minutes at once. Music over speech lowers accuracy; Isolate voice first can help.' },
  { id: 'audio', label: 'Mute / replace audio', group: 'Audio',
    does: 'Removes a video\'s sound, or swaps it for an audio file you upload.', needs: 'a video (and an audio file to replace with)', makes: 'a video', notes: 'The new audio is not mixed with the old; it replaces it.' },
  { id: 'normalize', label: 'Normalize audio', group: 'Audio',
    does: 'Evens out the loudness of a video\'s sound in one click (quiet, normal or loud target).', needs: 'a video with sound', makes: 'a video', notes: '' },
  { id: 'togif', label: 'Video → GIF', group: 'Export and convert',
    does: 'Turns part of a video into a short looping GIF, with a chosen frame rate, width, start and end.', needs: 'a video', makes: 'a GIF image', notes: 'Keep it short; GIFs get large quickly.' },
  { id: 'export-social', label: 'Export for Social', group: 'Export and convert',
    does: 'Makes Reels/TikTok/Shorts (9:16, up to 60 seconds), Square (1:1) and Landscape (16:9) versions of one video in one go, and downloads them separately or as a zip.', needs: 'a video', makes: 'up to three MP4 files', notes: 'Crops to fill each shape; choose which part of the picture to keep.' },
  { id: 'clip', label: 'Clip / trim', group: 'Edit video',
    does: 'Cuts out a part of a video, from a start time to an end time, and saves just that part as a new video. The original is not changed. Has a timeline of pictures from the video: click or drag along it to move through the video and drag the start and end markers (the video shows the exact picture), or press Set start here / Set end here while watching, or type the times; Play selection previews the chosen part. Can also work from a direct video file link.',
    needs: 'a video', makes: 'a shorter video', notes: 'There is a "keep original quality" option that makes no quality loss but may start a second or two early. Cutting a section OUT of the middle is not available for video (it is for audio in Trim audio).' },
  { id: 'replace-section', label: 'Replace a section', group: 'Edit video',
    does: 'Swaps the picture of one stretch of a video for another clip, leaving the original soundtrack completely untouched so music and voice carry on without a break. The finished video is exactly as long as the original. Choose the exact start time; the replacement clip must be exactly the same length as the section it replaces. Optional transitions in and out (crossfade, dip to black or white, wipe, slide) happen inside the section.',
    needs: 'a video, and a replacement clip of exactly the same length as the section', makes: 'one video (same length as the original)',
    notes: 'Only for replacing a section with a clip of matching length: the tool refuses a clip that is more than a tenth of a second off and says how much to trim, so trim it first in Clip / trim. The replacement clip\'s own sound is ignored. One section at a time. It cannot lengthen or shorten the video, and it cannot add a clip without removing something.' },
  { id: 'trim-audio', label: 'Trim audio', group: 'Audio',
    does: 'Keeps a part of an MP3 (or other audio file), or cuts a part out of it and joins the rest. Optional fade in and fade out.', needs: 'an audio file', makes: 'an audio file',
    notes: 'Same file type with no quality loss by default; fades and middle cuts make an MP3.' },
  { id: 'reframe', label: 'Crop / reframe', group: 'Edit video',
    does: 'Changes the shape of a video to 9:16, 16:9, 1:1 or 4:5 by cropping to fill, or by adding bars (letterbox).', needs: 'a video', makes: 'a video', notes: '' },
  { id: 'speed', label: 'Speed', group: 'Edit video',
    does: 'Makes a whole video slower or faster, from a quarter speed up to four times; the sound follows the speed.', needs: 'a video', makes: 'a video', notes: 'The whole video changes speed; speeding up only one part is not possible.' },
  { id: 'annotate', label: 'Annotate', group: 'Titles and captions',
    does: 'Puts one line of text on a video (title, label or credit) in a chosen font, size, colour, background and position, with optional fade in and out.', needs: 'a video', makes: 'a video', notes: 'One label per run. For timed subtitles use Caption studio.' },
  { id: 'title-card', label: 'Title card', group: 'Titles and captions',
    does: 'Shows a message card (headline, supporting line, optional button-style label and web address, over an adjustable tint) on the video between a start time and an end time that you choose, anywhere in the video. It fades in and out, and you control the tint colour and strength (0 keeps the picture in full colour) and both fade lengths. The video keeps its length and its sound is not touched.',
    needs: 'a video', makes: 'a video',
    notes: 'One card per run; to add another, run the result through the tool again. It sits over the playing picture and does not pause the video; to freeze the first or last picture for a title use Intro and ending. For ordinary subtitles that follow the speech use Caption studio.' },
  { id: 'end-card', label: 'Call to action', group: 'Titles and captions',
    does: 'Adds a closing screen to the end of a video with a headline, supporting line, button-style label and web address or phone number.', needs: 'a video', makes: 'a video', notes: 'The button is drawn text, not clickable.' },
  { id: 'overlay', label: 'Overlay / watermark', group: 'Titles and captions',
    does: 'Places a logo or picture on top of a video, in a chosen corner or spot, size and see-through level.', needs: 'a video and an image', makes: 'a video', notes: 'A still image only, not another video.' },
  { id: 'join', label: 'Join videos', group: 'Edit video',
    does: 'Joins two or more video clips into one, in an order you choose, with a hard cut or a transition (crossfade, dip to black or white, wipe, slide) between each pair and optional effects on each clip. You can describe in words how you want it joined and get a plan to edit.',
    needs: 'two or more videos', makes: 'one video',
    notes: 'Join all the clips in one go rather than joining in stages, so quality is not lost by repeated re-saving.' },
  { id: 'slideshow', label: 'Slideshow', group: 'Make',
    does: 'Turns 2-20 still pictures into a video with optional background audio, a chosen shape, a time per picture, transitions, gentle camera movement and captions. You can describe the look in words.', needs: 'pictures (and optionally an audio file)', makes: 'a video', notes: '' },
  { id: 'caption-studio', label: 'Caption studio', group: 'Titles and captions',
    does: 'Burns styled subtitles (font, size, colour, background, position) onto a video, from an SRT file, pasted captions, auto-transcription, or a script with no timestamps, which it times to the speech.',
    needs: 'a video and captions (or just a script)', makes: 'a video with captions', notes: 'Auto-transcribe and script timing need the Gemini setup. Captions are burned in; they cannot be switched off afterwards.' },
  { id: 'extend-ending', label: 'Intro and ending', group: 'Titles and captions',
    does: 'Holds the first frame and the last frame of a video so it does not start or stop dead, with a title over each. OPENING: the first picture is held for a number of seconds with an opening title (headline, supporting line, button-style label, web address) on it, which fades away as the video starts moving. ENDING: the last picture is held for a number of seconds with a closing message that fades in while the music fades out. Give it the voice and the music as two separate audio files: the music plays under the opening title, the voice begins when the video starts moving and plays once, and the music carries on through the held last frame and fades out (it dips under the voice, and repeats smoothly if shorter). The tint colour, strength and fade time of each title are adjustable.',
    needs: 'a video, plus ideally the voice and the music as separate audio files', makes: 'one video',
    notes: 'The voice and music need to be separate files for the voice to stop while the music carries on; a finished voice-and-music file ends where it ends and cannot be extended. Without any file the video\'s own sound is kept (it starts when the video moves, and is faded out at its end) and the held frames are silent. The audio files replace the video\'s own sound. Both titles are optional. It runs in the background and can take a few minutes for a long video.' },
  { id: 'mix-audio', label: 'Mix audio', group: 'Audio',
    does: 'Combines a voice recording (foreground) and a piece of music (background) into one audio file. Instead of uploading a recording, you can write a script and have an AI voice (with an Australian accent) read it into the Voice slot. The music repeats smoothly or is trimmed to fit, dips under the voice while it speaks (light or strong, or off), can start before the voice and keep going after it, and fades in and out. The result is levelled for speech.',
    needs: 'two audio files: a voice and music', makes: 'one audio file (MP3 or WAV)',
    notes: 'One voice and one music track only, not a multi-track editor. If the voice recording already has music under it, use Isolate voice first. To put the mixed audio on a video, use Mute / replace audio. Free (no AI cost).' },
  { id: 'add-music', label: 'Add music (Music page)', group: 'Audio', link: '/music',
    does: 'Opens the separate Music page (see the three Music page tools below): pick a mood to generate background music cut to the exact length of your video, optionally with a spoken voiceover, and export as WAV or MP4.',
    needs: 'a video', makes: 'music or a video with music', notes: 'AI music and voices cost a small amount per run.' },
  { id: 'music-score', label: 'Score a video (Music page)', group: 'Music',
    does: 'On the Music page: choose a video and a mood (upbeat vlog, cinematic tension, calm corporate, travel montage, suspense, documentary, lo-fi chill) or describe the music in words, with an optional tempo, and get three instrumental options cut to the exact length of the video with a fade in and out. Each is previewed against the video, with a music volume and a ducking setting (the music dips while people talk). Export the music as WAV, the video with the music as MP4, or save it to Saved media. A single option can be made again with a new seed, or another option added (up to six). Each option also has "Finish in Video Tools" buttons that open Normalize audio, Trim audio, Mix audio or Export for Social with the music (or the video with the music) already loaded.',
    needs: 'a video (up to five minutes)', makes: 'three music options; WAV audio or an MP4 video with the music',
    notes: 'AI music costs a small amount per go and takes about a minute. Always instrumental, no singing. Clips are about 30 seconds and loop with smooth crossfades for a longer video. Results are kept for about 90 minutes, then deleted. For a video longer than five minutes, trim it first in Clip / trim.' },
  { id: 'music-text', label: 'Music from a description (Music page)', group: 'Music',
    does: 'On the Music page, with NO video needed: pick a mood or describe the music in words (optional tempo), choose how long it should be (5 seconds up to a few minutes) and get three instrumental options to listen to and download as WAV. A single option can be made again with a new random seed, or one more option can be added (up to six). The seed each version was made from is shown; typing it back in with the same description gives that music again. Options can be compared by playing each from the same moment.',
    needs: 'a description or mood, and a length', makes: 'three music options as WAV audio',
    notes: 'AI music costs a small amount per go (and per new version). Always instrumental, no singing. Clips are about 30 seconds and loop with smooth crossfades for a longer length. No video means no video export and no Saved media; a voiceover can still be added, and the downloaded WAV then has the voice mixed in. The music can also be sent to Trim audio or Mix audio in Video Tools. Results are kept for about 90 minutes, then deleted.' },
  { id: 'music-own-track', label: 'Use my own track (Music page)', group: 'Music',
    does: 'On the Music page: fits a music file you already have (MP3, WAV, M4A) to a video. A short track loops with smooth crossfades, a long one is trimmed, and it fades in and out. Then it is previewed, mixed (volume, ducking) and exported like generated music.',
    needs: 'a video and a music file', makes: 'one music option; WAV audio or an MP4 video with the music', notes: 'No AI cost. Only for music the person has the rights to.' },
  { id: 'music-voiceover', label: 'Voiceover (Music page)', group: 'Music',
    does: 'On the Music page, after music has been made (for a video, or music made without one): adds narration over it. Type a script (up to 1500 characters) for an AI voice with an Australian accent, or upload a recording. Choose when the voice starts and how loud it is; the music and the video\'s own sound dip underneath it, and every option\'s preview and export includes it.',
    needs: 'finished music from Score a video or Use my own track, and a script or a recording', makes: 'the options with the voiceover mixed in',
    notes: 'One voiceover per set of music; adding another replaces it. A voice that runs past the end of the video is cut off. The AI voice costs a small amount per use and has a choice of two voices. Not for translating or cloning a voice.' },
  { id: 'saved-library', label: 'Saved media', group: 'Library and info',
    does: 'Lists the videos and images you saved from other tools, to preview, rename, delete or send back into Caption studio.', needs: 'nothing', makes: 'nothing new', notes: '' },
  { id: 'info', label: 'File info', group: 'Library and info',
    does: 'Shows a video\'s length, size shape, codec and whether it has sound.', needs: 'a video', makes: 'information only', notes: '' },
  { id: 'thumbnail', label: 'Thumbnail', group: 'Export and convert',
    does: 'Saves one picture (JPG) from a chosen moment in a video.', needs: 'a video', makes: 'a JPG picture', notes: '' },
];

// Things people commonly ask for that Video Tools does NOT do. Used to say "beyond the toolset" with confidence.
const NOT_POSSIBLE = [
  'Free-form timeline editing with several video and audio tracks, or cutting and rearranging inside one project.',
  'Colour grading, filters, stabilising shaky footage, or removing objects or people from a picture.',
  'Picture-in-picture (a video over a video), green screen, or animated titles and motion graphics.',
  'Translating speech or captions into another language, dubbing, or cloning a voice.',
  'Removing background noise other than music (the voice isolation is for background music); removing echo.',
  'Downloading videos from YouTube or other sites (there is no download feature), or recording the screen or camera.',
  'Cutting a section out of the middle of a VIDEO (audio can do this in Trim audio); speeding up only part of a video.',
  'Uploading directly to YouTube/Instagram/TikTok (files are downloaded and posted by hand).',
  'Videos longer than the upload limit of the server (about 80 MB per file) in most tools.',
  'Music with singing or lyrics, music copied from a named song or artist, or editing the music after it is made (changing the tune, moving a section); a new set of options has to be made instead.',
  'Voiceovers in languages other than English, or in a voice cloned from a recording.',
];

const VERDICTS = ['doable', 'partly', 'missing', 'beyond', 'question'];
const CATALOG_IDS = new Set(CATALOG.map((t) => t.id));
const byId = (id) => CATALOG.find((t) => t.id === id);

function catalogText() {
  return CATALOG.map((t) => `- id "${t.id}" (${t.group}) — ${t.label}: ${t.does} Needs: ${t.needs}. Makes: ${t.makes}.${t.notes ? ` Note: ${t.notes}` : ''}`).join('\n');
}

const SYSTEM = `You are the tutor for the Video Tools and Music sections of Vault. The tools marked "Music page" live on the separate Music page; the rest are in Video Tools. Say which page a tool is on when it is not the one the person has open. People tell you what they want to make or fix, in everyday words, and you tell them which of the tools below to use and in what order.

Rules:
- Use ONLY the tools in the catalogue. Never invent a tool or a feature, and never promise something a tool's notes say it cannot do.
- Speak plainly, as to someone who is not technical. Short sentences. No jargon (do not say CRF, codec, bitrate, filter graph) unless they ask.
- Give the steps in the order to do them. Each step names exactly one tool by its id and says, in a sentence, what to do there. Tools hand work on to each other (for example "Transcribe this →", "Use in another tool", "Add as captions on a video"), so say so when it helps.
- If they have not said enough to answer (for example whether they have a video or only audio), ask ONE short question instead and give no steps.
- Say when something costs money (AI options) or needs the Gemini setup.
- Choose a verdict:
  "doable"   = the job can be done fully with these tools.
  "partly"   = some of it can be done; one piece cannot. Give the steps that are possible and explain in "missing" what is not.
  "missing"  = it sounds like something Video Tools should do, but no tool does it yet. In "missing", say clearly what tool or feature would be needed. Give any steps that still help.
  "beyond"   = this is not something Video Tools is for (see the list of things Video Tools and Music do not do). Say so clearly and kindly in "answer"; do not suggest a workaround that does not exist. You may name the kind of program that does this job.
  "question" = you need to ask something first.

Reply with ONLY a JSON object, no other text:
{"verdict":"doable|partly|missing|beyond|question","answer":"1-4 short sentences","steps":[{"tool":"<tool id>","do":"what to do in this tool"}],"missing":"only for partly or missing: what is needed","tip":"optional one-line tip"}`;

function buildTutorPrompt({ messages, currentTool }) {
  const convo = (messages || []).map((m) => `${m.role === 'assistant' ? 'Tutor' : 'Person'}: ${m.content}`).join('\n');
  const where = currentTool && byId(currentTool) ? `\nThe person currently has the "${byId(currentTool).label}" tool open.` : '';
  return `TOOLS AVAILABLE (the complete list):
${catalogText()}

THINGS VIDEO TOOLS DOES NOT DO:
${NOT_POSSIBLE.map((t) => `- ${t}`).join('\n')}
${where}

CONVERSATION SO FAR:
${convo}

Reply with the JSON object now.`;
}

/** Keep only the last few turns, trimmed, with roles we know. */
function cleanMessages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.replace(/\s+/g, ' ').trim().slice(0, 1500) }));
}

function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ }
  }
  return null;
}

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Turn the model's reply into something safe to show: known tool ids only, bounded text, a valid verdict. Never throws. */
function normalizeTutorReply(raw) {
  const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
  if (!parsed || typeof parsed !== 'object') {
    // Never show the model's raw text if it was meant to be JSON; a plain-prose reply is fine to show as a question.
    const prose = typeof raw === 'string' && !/[{}]/.test(raw) ? clip(raw, 900) : '';
    return {
      verdict: 'question',
      answer: prose || 'Sorry, I could not work that out. Could you say again what you want to make, in a sentence?',
      steps: [], missing: '', tip: '',
    };
  }
  const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
    .map((s) => ({ tool: String(s?.tool || '').trim(), do: clip(s?.do, 300) }))
    .filter((s) => CATALOG_IDS.has(s.tool) && s.do)
    .slice(0, 8)
    .map((s) => ({ ...s, label: byId(s.tool).label, group: byId(s.tool).group }));
  const missing = clip(parsed.missing, 400);
  let verdict = VERDICTS.includes(parsed.verdict) ? parsed.verdict : (steps.length ? 'doable' : 'question');
  // A verdict has to be backed by what it says: "doable" with no steps, or "missing" with no explanation, is not a usable answer.
  if (verdict === 'doable' && !steps.length) verdict = 'question';
  if ((verdict === 'partly' || verdict === 'missing') && !missing) verdict = steps.length ? 'doable' : 'question';
  if (verdict === 'beyond' || verdict === 'question') steps.length = 0;
  return {
    verdict,
    answer: clip(parsed.answer, 900) || (verdict === 'beyond' ? 'That is outside what Video Tools can do.' : ''),
    steps,
    missing: verdict === 'partly' || verdict === 'missing' ? missing : '',
    tip: clip(parsed.tip, 200),
  };
}

/**
 * @param {number} userId
 * @param {{ messages: Array<{role:string,content:string}>, currentTool?: string }} input
 */
async function askTutor(userId, { messages, currentTool } = {}, deps = {}) {
  const convo = cleanMessages(messages);
  if (!convo.length || convo[convo.length - 1].role !== 'user') {
    const err = new Error('Type what you want to do first.');
    err.status = 400;
    throw err;
  }
  const resolve = deps.getModels || getModelsForUser;
  const call = deps.callModel || callModel;
  const { standard: modelId } = await resolve(userId);
  const result = await call(modelId, buildTutorPrompt({ messages: convo, currentTool }), {
    system: SYSTEM, maxTokens: 900, returnUsage: true, timeoutMs: 45000,
  });
  (deps.logUsage || logUsage)({ userId, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'videos' });
  return normalizeTutorReply(String(result.text || ''));
}

module.exports = {
  CATALOG, NOT_POSSIBLE, SYSTEM, VERDICTS,
  buildTutorPrompt, cleanMessages, normalizeTutorReply, askTutor, catalogText,
};
