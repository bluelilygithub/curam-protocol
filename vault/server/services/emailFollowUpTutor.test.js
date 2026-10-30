'use strict';

// node server/services/emailFollowUpTutor.test.js   (part of npm run test:email-follow-up-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./emailFollowUpTutor');

checkGuide({
  name: 'emailFollowUpTutor',
  service,
  askName: 'askEmailFollowUpTutor',
  feature: 'email_follow_up_guide',
  toolsFile: 'emailFollowUp/emailFollowUpTools.mjs',
  menuExport: 'EF_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'ledger',
  exampleStepId: 'check-sent',
  facts: [
    ['new-case', 'does', /what is owed/, 'a case is opened from what is owed'],
    ['find-mail', 'notes', /Nothing attaches itself/, 'mail never attaches itself'],
    ['read', 'notes', /word for word/, 'a row needs a word-for-word quote'],
    ['read', 'notes', /two different amounts/, 'a disagreement blocks drafting'],
    ['get-attachments', 'notes', /OCR is a machine reading/, 'OCR may misread figures'],
    ['get-attachments', 'notes', /program/, 'a disguised program is refused'],
    ['check-sent', 'notes', /Required before chasing/, 'Sent must be checked first'],
    ['check-sent', 'notes', /runs it for you/, 'Draft follow-up checks Sent itself'],
    ['draft-followup', 'notes', /No AI writes the draft/, 'drafts are not model-written'],
    ['condition-met', 'notes', /"thanks" never counts/, 'a polite reply does not meet a condition'],
    ['took-over', 'notes', /unconfirmed/, 'a substitute is unconfirmed'],
    ['copy', 'notes', /Nothing is sent by Vault/, 'copy never sends'],
    ['approve', 'notes', /newer version|new version/, 'editing resets approval'],
    ['coverage', 'does', /could not see/, 'coverage says what it could not see'],
    ['close-case', 'notes', /exactly as they are/, 'closing changes nothing inside the case'],
    ['close-case', 'does', /read-only/, 'a closed case is read-only'],
    ['set-aside', 'notes', /no ledger row and no draft quotes/, 'remove is refused when something quotes the thread'],
    ['delete-case', 'does', /type the case name/, 'delete needs the name typed'],
    ['delete-case', 'does', /approval record goes with it/, 'approved drafts need a second confirmation'],
    ['delete-case', 'notes', /Gmail is never touched/, 'delete never touches Gmail'],
  ],
  gaps: [/Sending an email/, /photos and pictures of documents/, /misread digits/, /phone calls, portals/, /Opening a case by itself/, /legal, tax or accounting advice/, /Editing the wording/, /Medical, mortgage/, /Deleting your Gmail/, /without a trace/],
  rules: [/only reads Gmail/, /never guesses a date/, /Sent folder first/, /five drafts/, /word for word/],
  system: [/cannot see any case, email/, /cannot send|it cannot/],
}).catch((e) => { console.error(e); process.exit(1); });
