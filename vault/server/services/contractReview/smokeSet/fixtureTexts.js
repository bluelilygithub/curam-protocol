'use strict';

// Contract Review — Stage 2 smoke set. All six fixtures below are synthetic,
// authored for this test suite — no real client documents, per instruction.
// Obligation language and expected values live in expected.js, written BEFORE
// any obligation-extraction code exists (Stage 4), so Stage 4 can't fit its
// expectations to its own output.

const UNNUMBERED = `MUTUAL NON-DISCLOSURE AGREEMENT

This agreement is between Acme Robotics Pty Ltd ("Discloser") and Blue Horizon Consulting ("Recipient"), effective as of 1 March 2026.

The parties wish to explore a potential business relationship and in connection with this may disclose confidential information to one another.

The Recipient agrees to hold all Confidential Information in strict confidence and not to disclose it to any third party without the Discloser's prior written consent.

The Recipient shall use the Confidential Information solely for the purpose of evaluating the potential business relationship and for no other purpose.

This agreement shall remain in effect for a period of two years from the effective date, after which the confidentiality obligations shall survive for an additional three years.

Either party may terminate this agreement upon thirty days written notice to the other party.

This agreement is governed by the laws of Queensland, Australia.`;

const DEEP_NESTING = `MASTER SERVICES AGREEMENT

1. Definitions

1.1 "Services" means the services described in Schedule A.

2. Term and Termination

2.1 This Agreement commences on the Effective Date and continues for twelve months.

2.2 Termination for cause.

2.2(a) Either party may terminate this Agreement immediately upon written notice if the other party:

2.2(a)(i) commits a material breach that is not remedied within 14 days of notice; or

2.2(a)(ii) becomes insolvent or enters administration.

2.2(b) Termination under this clause is without prejudice to any other rights or remedies.

3. Payment Terms

3.1 The Customer shall pay all invoices within 30 days of the invoice date.

3.2 Late payments accrue interest at 1.5% per month.

4. Limitation of Liability

4.1 Neither party's liability under this Agreement shall exceed the fees paid in the preceding twelve months.

4.1(a) This limitation does not apply to breaches of confidentiality or infringement of intellectual property rights.

4.1(a)(i) For clarity, wilful misconduct is also excluded from this limitation.`;

const MULTI_PARTY = `LOAN GUARANTEE AGREEMENT

This agreement is entered into between:

Northbridge Finance Ltd, as Lender;

Harbor Trading Co Pty Ltd, as Borrower; and

Janet Ellery, as Guarantor.

The Lender agrees to advance the Borrower a loan facility of AUD $250,000, subject to the terms set out below.

The Guarantor unconditionally guarantees the Borrower's obligations under this agreement, including repayment of principal and interest.

The Borrower shall make monthly repayments of AUD $5,000 on the first business day of each month, commencing the month following drawdown.

If the Borrower defaults on any payment, the Guarantor shall pay the outstanding amount to the Lender within 14 days of written demand.

This agreement is governed by the laws of New South Wales.`;

const AMENDMENT = `AMENDMENT NO. 1 TO MASTER SERVICES AGREEMENT

This Amendment amends the Master Services Agreement dated 1 January 2026 between Acme Robotics Pty Ltd and Blue Horizon Consulting (the "Base Agreement").

Effective as of 1 April 2026, Clause 3.1 of the Base Agreement is deleted and replaced with the following:

The Customer shall pay all invoices within 45 days of the invoice date, superseding the 30-day term in the Base Agreement.

All other terms of the Base Agreement remain in full force and effect.`;

// Rendered to an image (no text layer) for the true scanned-PDF fixture.
const SCANNED_SOURCE_TEXT = `EQUIPMENT LEASE AGREEMENT

This agreement is between Coastal Warehousing Pty Ltd ("Lessor") and Orchard Freight Ltd ("Lessee"), effective 1 February 2026.

The Lessor leases to the Lessee the forklift equipment described in Schedule A for a term of 36 months.

The Lessee shall pay lease rental of AUD $1,200 per month, due on the first day of each month.

Ninety days before the renewal date, the Lessee must notify the Lessor in writing if it intends to renew this lease.

The Lessee is responsible for routine maintenance; the Lessor is responsible for major repairs arising from manufacturing defects.`;

// Typed body + one scanned exhibit page (image only).
const MIXED_TYPED_BODY = `SERVICE ORDER FORM

1. This Service Order is issued under the Master Services Agreement between Acme Robotics Pty Ltd and Blue Horizon Consulting.

2. The Vendor shall deliver the Deliverables described in the attached Exhibit A.

3. Payment of AUD $18,000 is due within 30 days of the Vendor's invoice.

4. This Service Order incorporates the signed acceptance page attached as Exhibit A (scanned).`;

const MIXED_SCANNED_EXHIBIT_TEXT = `EXHIBIT A - SIGNED ACCEPTANCE

The undersigned confirms acceptance of the Deliverables described in this Service Order.

Signed for and on behalf of Blue Horizon Consulting.`;

module.exports = {
  UNNUMBERED,
  DEEP_NESTING,
  MULTI_PARTY,
  AMENDMENT,
  SCANNED_SOURCE_TEXT,
  MIXED_TYPED_BODY,
  MIXED_SCANNED_EXHIBIT_TEXT,
};
