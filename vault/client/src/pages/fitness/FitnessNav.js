import { createContext } from 'react';

/** Lets a deep component (like the safety notice) send the person to another tab without passing callbacks everywhere. */
const FitnessNav = createContext({ goTo: () => {} });
export default FitnessNav;
