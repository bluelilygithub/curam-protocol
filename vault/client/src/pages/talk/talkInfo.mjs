// The words in Talk it through's "How Talk it through works" box (the (i) beside the title; it opens by itself the first time, like the other tools).
// Plain data so a test can keep it honest: node client/src/pages/talk/talkTips.test.mjs

export const TALK_INTRO = 'Ask questions out loud, hear the answers spoken back, and keep the conversation as a note. Every button has a hover tip. Stuck? Press the round button at the bottom right and ask the guide, or press the compass beside the title for a step-by-step tour.';

export const HOW_TALK_WORKS = [
  ['Talk', 'Tap the big button, ask your question, and pause. Your words are sent as soon as you stop, and the reply is spoken back to you. Tap the button while it is speaking to interrupt and talk over it. If you would rather type, press Type instead.'],
  ['Going back and forth', 'Where your browser allows it, Listen again starts listening by itself after each reply, so you can answer without touching the screen. On an iPhone or iPad the browser cannot listen while it speaks, so you tap the button for each turn.'],
  ['The switches', 'Read aloud speaks each reply (switch it off to just read them). Listen again, as above. My notes lets the assistant draw on your own notes that match what you say, and tells you which it used. It is off unless you switch it on, and those notes are sent to the AI service with your question.'],
  ['Ending it', 'End conversation writes it up as a note for you to check: a summary of what was said, any decisions, the to-dos as tick-boxes, and then everything that was said. Change anything, file it under a project and a client, and press Save as a note. Keep talking goes back, and Do not save leaves without a note. On the saved note, Make tasks turns the to-dos into tasks.'],
  ['What it is', 'It is an ordinary Chat conversation underneath, asked to answer in short spoken sentences. It appears in Chat History, and uses the same AI model and settings as Chat.'],
];

export const TALK_NOT = 'It uses your browser\'s own speech recognition and voice, so it is only as good as they are: Chrome, Edge and Safari work, Firefox cannot listen, and a locked phone screen stops it listening. It cannot tell who is speaking if several people talk.';
