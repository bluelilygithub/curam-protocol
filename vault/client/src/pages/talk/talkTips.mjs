// The hover tip for each control on the Talk screen, in plain words (the shared Tooltip, never a native title="").
// Checked by node client/src/pages/talk/talkTips.test.mjs

export const TALK_TIPS = {
  info: 'How Talk it through works: what each button does, what the switches mean, and what it cannot do.',
  tour: 'Take the guided tour of Talk it through, step by step.',
  mic: 'The big button. Tap it and talk; pause when you are done and your words are sent. While it is speaking, tap it to interrupt and talk over it.',
  readAloud: 'Speak each reply out loud. Switch off to read the replies instead.',
  autoListen: 'Start listening again by itself when a reply has finished, so you can talk back and forth without touching the screen. Not possible on an iPhone, where you tap each time.',
  useNotes: 'Let the assistant draw on your notes that match what you say, and say which it used. Off unless you switch it on. Your notes are sent to the AI service with your question.',
  type: 'Type a question instead of speaking it. It is answered the same way.',
  end: 'Finish the conversation. You see a note with a summary, any decisions and to-dos, and everything that was said, and you choose whether to keep it.',
  stop: 'Stop the reply that is being written.',
  reviewSave: 'Save this as a note, filed under the project and client you picked. The to-dos in it can then be made into tasks from the note.',
  reviewKeepTalking: 'Go back to the conversation and carry on.',
  reviewDiscard: 'Leave without saving a note. The conversation stays in Chat History.',
  reviewProject: 'File the note under one of your projects.',
  reviewClient: 'File the note under one of your clients.',
};
