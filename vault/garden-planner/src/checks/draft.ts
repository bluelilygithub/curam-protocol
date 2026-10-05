// Every check that rests on plant data (mature size, sun, frost, climate, weed and pet flags) must say so: the dataset is a DRAFT that has not
// been verified against horticultural sources or state weed lists. The wording is shared so tests can require it.
export const DRAFT_LABEL = 'draft, unverified';
export const DRAFT_SUFFIX = ` (plant data is ${DRAFT_LABEL})`;

/** Add the draft label to a message that uses plant data (once). */
export const withDraftLabel = (message: string): string => (message.includes(DRAFT_LABEL) ? message : `${message}${DRAFT_SUFFIX}`);

export const mentionsDraft = (message: string): boolean => message.includes(DRAFT_LABEL);
