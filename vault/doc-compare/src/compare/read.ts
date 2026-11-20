import { checkFileTypes } from '../checks/fileType';
import type { NormalizedDoc } from '../readers/types';

/** Gate 1 + reading. Throws GateError with a message for people. Runs on the main thread (pdf.js has its own worker). */
export async function readPair(original: File, edited: File): Promise<[NormalizedDoc, NormalizedDoc]> {
  const reader = await checkFileTypes(original, edited);
  return Promise.all([reader.read(original), reader.read(edited)]);
}
