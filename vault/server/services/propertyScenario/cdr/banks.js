'use strict';

/**
 * CDR Product Reference Data (PRD) bank registry.
 * Base URLs from LukePrior/Australian-Open-Banking-Data-Database (actively maintained).
 * Product list/detail endpoints: GET {base}/banking/products[/{productId}]
 * Auth: none for public product data. Header x-v required (version negotiated per bank).
 */

const CDR_BANKS = [
  {
    id: 'commbank',
    name: 'CommBank',
    brand: 'CBA',
    baseUrl: 'https://api.commbank.com.au/public/cds-au/v1',
    preferredVersions: [5, 4, 7, 6],
  },
  {
    id: 'westpac',
    name: 'Westpac',
    brand: 'WBC',
    baseUrl: 'https://digital-api.westpac.com.au/cds-au/v1',
    preferredVersions: [5, 4, 3, 6, 7],
  },
  {
    id: 'anz',
    name: 'ANZ',
    brand: 'ANZ',
    baseUrl: 'https://api.anz/cds-au/v1',
    preferredVersions: [5, 4, 6, 7, 3],
  },
  {
    id: 'nab',
    name: 'NAB',
    brand: 'NAB',
    baseUrl: 'https://openbank.api.nab.com.au/cds-au/v1',
    preferredVersions: [5, 4, 3, 6, 7],
  },
  {
    id: 'ing',
    name: 'ING',
    brand: 'ING',
    baseUrl: 'https://id.ob.ing.com.au/cds-au/v1',
    preferredVersions: [5, 4, 3, 6, 7],
  },
  {
    id: 'macquarie',
    name: 'Macquarie',
    brand: 'MQG',
    baseUrl: 'https://api.macquariebank.io/cds-au/v1',
    preferredVersions: [5, 4, 3, 6, 7],
  },
  {
    id: 'ubank',
    name: 'UBank',
    brand: 'UBANK',
    baseUrl: 'https://public.cdr-api.86400.com.au/cds-au/v1',
    preferredVersions: [5, 4, 3, 6, 7],
  },
  {
    id: 'up',
    name: 'Up',
    brand: 'UP',
    baseUrl: 'https://api.up.com.au/cds-au/v1',
    preferredVersions: [5, 4, 3, 6, 7],
  },
];

const MORTGAGE_CATEGORY = 'RESIDENTIAL_MORTGAGES';

module.exports = {
  CDR_BANKS,
  MORTGAGE_CATEGORY,
};
