import React from 'react';
import PlanButton from '../drawings/PlanButton';
import { NOTE_TIPS } from './noteTips.mjs';

/**
 * The Make a plan button in an open note, beside Convert to Task. The button, its list of plans made from the note and the box that makes one
 * are the same as in Diagrams (pages/drawings/PlanButton.jsx); the note is saved first so the plan is made from what is on screen.
 * The rules for turning a note into steps are in server/services/planFromNote.js (docs/plans.md "From a note").
 */
export default function NotePlanButton({ noteId, noteTitle, beforeOpen }) {
  return <PlanButton noteId={noteId} sourceTitle={noteTitle} beforeOpen={beforeOpen} tipNone={NOTE_TIPS.makePlan} />;
}
