import { createContext, useContext } from 'react';

export const QuizBuildContext = createContext({
  buildState: null,
  startQuizBuild: () => {},
  endQuizBuild: () => {},
});

export function useQuizBuild() {
  return useContext(QuizBuildContext);
}
