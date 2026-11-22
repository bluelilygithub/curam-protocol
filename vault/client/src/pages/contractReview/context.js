import { createContext, useContext } from 'react';

// ContractReviewPage owns every piece of state and every API call; each screen in this folder reads what it needs from here.
export const ContractReviewContext = createContext(null);
export const useContractReview = () => useContext(ContractReviewContext);
