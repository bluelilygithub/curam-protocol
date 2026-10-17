// The public tool's steps. The Features step exists only while the owner has at least one feature group (Cellar Planner -> Settings -> Feature options);
// with none the tool is the three steps it always was, so removing every group is a way to switch the step off.

export type StepKey = 'space' | 'racking' | 'features' | 'review';

export const STEP_TITLES: Record<StepKey, string> = { space: 'Space', racking: 'Racking & finishes', features: 'Features', review: 'Review' };

export const stepKeys = (hasFeatures: boolean): StepKey[] => (hasFeatures ? ['space', 'racking', 'features', 'review'] : ['space', 'racking', 'review']);
