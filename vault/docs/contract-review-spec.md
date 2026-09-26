# Contract Review — Spec (Stage 0)

Status: **Locked after Round 4 review.** Spec only, no implementation code written. Single source of truth for later build stages. Deviations discovered during build go in the Decisions Log at the bottom, not silently into code.

## What the feature does

Upload a contract (PDF/DOCX) → clause-by-clause risk flags, plain-English summary, structured obligations/deadlines, advisory suggested redlines. **Explicitly informational, not legal advice.**

## Non-negotiable guardrails

- A persistent "not legal advice" banner on every contract review screen — not a footnote, not dismissible.
- The uploaded file is never modified. Redlines are advisory copy-paste text only.
- Grounding: every flag, summary point, definition, and obligation carries a source span, and the pipeline programmatically verifies the quoted text exists in the source. Unverified content is never shown as verified.
- **Clause text is always an exact slice of `extractedText`**, never model-paraphrased — including in the LLM-segmentation fallback (see Pipeline stage 2).
- **`contract_clauses`, `contract_definitions`, and `contract_obligations` rows are immutable once their review completes.** Nothing writes to them again after `contract_reviews.status='complete'` — a later draft's clauses/obligations are new rows in a new review, linked by `lineageId` (and, for clauses, `priorClauseId`), not edits to the old ones.

## Codebase conventions this spec follows

Confirmed by reading the existing code before writing this spec (not assumed):

- **No ORM.** Raw `pg` via `pool.query()`/`client.query()` inside the startup migration function in `server/db.js`. This spec's tables follow that exact style: `CREATE TABLE IF NOT EXISTS`, camelCase columns double-quoted (`"userId"`, `"createdAt"`), snake_case table names, `"userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` for ownership FKs (matches `browser_agent_runs`, `client_deals`). Enums are `VARCHAR(n) CHECK (col IN (...))`, not native Postgres `CREATE TYPE ... ENUM` (matches `clients.status`, `client_deals.stage`). Money is `NUMERIC(12,2)` or wider. Schema evolution after first ship uses `ALTER TABLE x ADD COLUMN IF NOT EXISTS` run every boot (matches `browser_agent_credentials.pinned`). Indexes are `CREATE INDEX IF NOT EXISTS idx_<table>_<col>`.
- **Service-layer-first.** `server/services/modelResolver.js` (`getModelsForUser`) and `server/services/SuggestionService.js` (`capture`/`captureIf`/`makeFingerprint`) are both plain exported async functions, no classes, called directly from routes. `ContractService` below follows the same shape.
- **CRM touchpoint → Task bridge** is a one-directional nullable FK: `tasks."clientId"` points at the client, no linkback column on the client side. `contract_obligation_tracking.linkedTaskId` reuses this exact shape.
- **PDF/DOCX extraction already exists and is page-aware** — `server/services/translateExtract.js:132-198` (`extractFromPdf`) uses `pdf-parse`'s `pagerender` callback to capture per-page text with position, reconstructs paragraphs per page, and **already computes `scannedCandidatePages`** (near-zero text density → likely scanned). This is reused directly, not reinvented. `extractFromDocx` (translateExtract.js:200-209) is `mammoth.extractRawText({buffer})`.
- **OCR already exists** — `server/routes/translate.js:37-53` runs a module-level `tesseract.js` scheduler singleton (4 workers via `createScheduler()`), langs `eng+fra+deu+spa+ita+por+chi_sim+jpn`, initialized once at module load. Reused, not reinvented.
- **File uploads/attachments** — `server/utils/attachments.js` already provides the shared upload policy (allowlist, 50MB cap, per-user quota, magic-byte executable check) used by both touchpoints and tasks. Contract documents reuse this rather than a third copy of the same logic. Checked directly against this spec's needs (`attachments.js:1-167`):
  - **(a) Size limit**: `MAX_FILE_BYTES = 50MB` — comfortably covers a 20MB+ scanned contract. No change needed.
  - **(b) DOCX allowlist**: `.docx`/`application/vnd.openxmlformats-officedocument.wordprocessingml.document` are already in `ATTACHMENT_EXTENSIONS`/`ATTACHMENT_MIMES` (lines 16, 18, 25). The magic-byte check (`rejectIfDisguisedExecutable`) is a *block*list of executable signatures (MZ/ELF/`#!`), not a positive per-type allowlist — DOCX's ZIP signature (`PK\x03\x04`) doesn't match any of those, so it passes through unaffected. No change needed.
  - **(c) Content hash**: **not stored today** — the `attachments` table (filename/storedPath/mimeType/sizeBytes only, `attachments.js:105-112`) has no hash column. `contract_documents.contentHash` must be computed by `ContractService.addDocument` itself (sha256 of the uploaded buffer) after `attachments.js` saves the file, not provided by it.
  - **(d) Never transforms files**: confirmed — `insertAttachment` records path/metadata as-is; nothing in this file resizes, converts, or re-encodes. No change needed.
  - **(e) Deletion/cleanup**: `deleteAttachmentsForEntityIds` (lines 139-153) unlinks the file and deletes the DB row, called synchronously from `clients.js`/`tasks.js` on entity delete. Grepped the whole `server/` tree for any scheduled cleanup job referencing attachments — **none exists**; deletion only happens via that explicit call. `legalHold` therefore only needs to block `ContractService.deleteContract` itself, not a separate cleanup cron, since no such cron exists.
  - **Net result: no change to `attachments.js` required.** All five checks pass as-is; the only work is on the contract-review side (computing the hash it doesn't provide).
- **No generic notification service exists.** Only per-job cron scripts (`server/cron/financeRemindersCron.js`, `server/cron/expenseReviewCron.js`) that call `server/utils/sendEmail.js` directly, plus `SuggestionService.captureIf` for inbox flags. This spec does not invent a new generic notification abstraction — obligation reminders are explicitly out of scope for v1 (ICS export covers the same need without one). **When reminder firing is built later, it follows the existing direct `sendEmail.js` cron precedent** (a new `contractRemindersCron.js` calling `sendEmail.js` directly, matching `financeRemindersCron.js`/`expenseReviewCron.js`), not a retrofit onto a generic service that doesn't exist.

## Entity model

Built around four core entities where the brief's earlier drafts had one (`contract_reviews`) — a **contract**, a **document** (one file in a version chain, itself with its own execution status), a **review** (one analysis of one document at one point in time), and now **obligation tracking** as a fifth, separated out because extracted obligation rows are immutable while user-facing state (handled/dismissed, linked task) needs to persist across re-reviews. Conflating any of these forces facts that belong to one lifecycle (role, status, key terms, "is this task done") to either duplicate across rows that get replaced, or be read from "whichever row is root," both fragile.

### `contracts`
The ongoing agreement.

```sql
CREATE TABLE IF NOT EXISTS contracts (
  id                      SERIAL PRIMARY KEY,
  "userId"                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "workspaceId"           INTEGER NULL, -- future-teams hook only; NOTHING writes this column in v1, and no FK exists since no workspaces table exists yet — added when one does
  title                   TEXT NOT NULL,
  "contractType"          VARCHAR(50) NOT NULL DEFAULT 'other'
                            CHECK ("contractType" IN (
                              'nda','msa','sow','lease','employment','consulting',
                              'license','purchase','partnership','loan','other'
                            )), -- keys MUST match playbooks.js config keys exactly; 'other' uses a generic playbook and is flagged in the UI
  "contractTypeRaw"       TEXT NULL, -- the model's original, unconstrained label — kept for review/debugging, never used as a lookup key
  status                  VARCHAR(20) NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','executed','expired','terminated')), -- agreement-level lifecycle; document-level execution (contract_documents.status) is what actually gates "active obligations" — see Contract lifecycle rules
  "effectiveDate"         DATE NULL,
  "termLengthMonths"      INTEGER NULL,
  "governingLawCountry"   VARCHAR(2) NULL,  -- ISO 3166-1 alpha-2
  "governingLawRegion"    TEXT NULL,        -- e.g. "Queensland" — country alone isn't enough for enforceability questions
  "contractValue"         NUMERIC(14,2) NULL,
  "contractValueCurrency" VARCHAR(3) NULL,  -- ISO 4217
  "legalHold"             BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"             TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_user ON contracts ("userId");
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts (status);
```

**`contractType`/`contractTypeRaw` and all key-term columns above are effective values, not pipeline output.** The pipeline never writes them directly — it writes `detectedContractType`/`detectedContractTypeRaw`/`extractedKeyTerms` onto the review instead (see `contract_reviews` below). `ContractService.promoteReviewToContract` promotes them onto `contracts` only from the **current review of an executed `kind='base'` document**, merged with any `contract_corrections`. A draft review's detected type/terms never touch these columns, so re-reviewing a draft under negotiation can't silently overwrite the values from the version that's actually signed.

- **Amendments never overwrite with null.** An executed `kind='amendment'` document's `extractedKeyTerms` promotes only its **non-null** fields over the base contract's existing values — most fields in an amendment's key terms will genuinely be null (an amendment doesn't restate the whole agreement), and promoting those nulls would blank out real values the base contract already has.
- **Re-execution re-promotes.** When an already-`executed` document gets a new current review (re-reviewed after a model/playbook upgrade, say), promotion runs again automatically, with any existing contract-level `contract_corrections` re-applied on top of the new detected values — a re-review doesn't silently discard a correction the user already made.
- **Playbook selection (pipeline stage 7)** uses, in order: (1) a `contract_corrections` row targeting `contracts.contractType` at the contract level, if one exists — the user's own correction always wins; (2) otherwise the **review's own** `detectedContractType`, never `contracts.contractType` directly, since that column defaults to `'other'` until a document is executed and would make every draft review use the generic fallback playbook regardless of what the pipeline actually detected.

### `contract_parties`
Multiple parties per contract — never a single `counterparty` field (breaks on guarantors, affiliates, 3-party agreements). The user's own role is a row here, not a column on `contracts`.

`role` is constrained to the same key set `playbooks.js` uses (a playbook is keyed by `contractType × role`, so a free-text role could silently fail to match one, the same problem `contractType` had). `roleRaw` preserves the model's original label the same way `contractTypeRaw` does.

```sql
CREATE TABLE IF NOT EXISTS contract_parties (
  id                 SERIAL PRIMARY KEY,
  "contractId"       INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  role               VARCHAR(50) NOT NULL DEFAULT 'other'
                        CHECK (role IN (
                          'vendor','customer','employer','employee','licensor','licensee',
                          'landlord','tenant','lender','borrower','guarantor','other'
                        )), -- keys MUST match playbooks.js role keys exactly, same convention as contractType
  "roleRaw"          TEXT NULL, -- model's original label
  "isUser"           BOOLEAN NOT NULL DEFAULT FALSE,
  "confirmedByUser"  BOOLEAN NOT NULL DEFAULT FALSE,
  "crmClientId"      INTEGER NULL REFERENCES clients(id) ON DELETE SET NULL, -- matches clients/client_contacts' plain nullable-FK linking style, no junction table
  "createdAt"        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_parties_contract ON contract_parties ("contractId");
```

**Reconciliation, not blind insert.** When a review extracts parties (pipeline stage 4), each is matched against the contract's existing `contract_parties` by normalized name (case/whitespace/punctuation-insensitive) — a match reuses the existing row, only a genuine non-match inserts a new one. If the user's party is already `confirmedByUser=true` on the contract from a prior review, the pipeline **skips** `awaiting_role_confirmation` and proceeds straight through, instead of re-asking on every re-review of a new draft.

### `contract_documents`
One file in a version chain. `parentDocumentId` links only to a prior draft of **this same document** — an amendment's own draft history is separate from the base contract's, connected instead via `contractId` + `kind`.

**Current review** of a document = its latest `contract_reviews` row with `status='complete'`. Every "active" view (obligations, ICS export, Tasks, search defaults) reads current reviews only — a document can have several completed reviews over time (re-run after a model/playbook upgrade, for instance) and only the latest one is authoritative.

```sql
CREATE TABLE IF NOT EXISTS contract_documents (
  id                 SERIAL PRIMARY KEY,
  "contractId"       INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind               VARCHAR(20) NOT NULL DEFAULT 'base'
                        CHECK (kind IN ('base','amendment','exhibit','schedule')),
  "parentDocumentId" INTEGER NULL REFERENCES contract_documents(id) ON DELETE SET NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  status             VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','executed','superseded')), -- document-level execution — this, not contracts.status, is what gates "active" obligations
  "executedAt"       TIMESTAMPTZ NULL,
  filename           TEXT NOT NULL,
  "mimeType"         TEXT NOT NULL,
  "storedPath"       TEXT NOT NULL, -- via server/utils/attachments.js, same convention as touchpoint/task attachments
  "contentHash"      VARCHAR(64) NOT NULL, -- sha256 of the original file
  source             VARCHAR(20) NOT NULL DEFAULT 'upload'
                        CHECK (source IN ('upload','email','esign')),
  "externalId"       TEXT NULL, -- dedup hook for future ingestion channels
  "extractedText"    TEXT NULL,
  "pageMap"          JSONB NULL, -- [{page, charStart, charEnd}], from translateExtract.js's pagerender pattern
  "ocrUsed"          BOOLEAN NOT NULL DEFAULT FALSE,
  "ocrConfidence"    NUMERIC(5,2) NULL,
  language           VARCHAR(10) NULL,
  "createdAt"        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_documents_contract ON contract_documents ("contractId");
CREATE INDEX IF NOT EXISTS idx_contract_documents_hash ON contract_documents ("contentHash");
```

### `contract_reviews`
One analysis of one document at one point in time.

```sql
CREATE TABLE IF NOT EXISTS contract_reviews (
  id                    SERIAL PRIMARY KEY,
  "documentId"          INTEGER NOT NULL REFERENCES contract_documents(id) ON DELETE CASCADE,
  "userPartyId"         INTEGER NULL REFERENCES contract_parties(id) ON DELETE SET NULL, -- snapshot of role used for THIS review
  "modelId"             TEXT NOT NULL,
  "promptVersion"       TEXT NOT NULL,
  "playbookKey"         TEXT NULL,
  "playbookVersion"     TEXT NULL,
  "playbookHash"        VARCHAR(64) NULL,
  "taxonomyVersion"     TEXT NOT NULL,
  "contractTypeEnumVersion" TEXT NOT NULL, -- version of the contractType/role enum + playbook-key set used for this review, tracked the same way as taxonomyVersion
  "detectedContractType"    VARCHAR(50) NULL, -- same enum as contracts.contractType; this review's own detection, NOT yet promoted to contracts
  "detectedContractTypeRaw" TEXT NULL,
  "extractedKeyTerms"       JSONB NULL, -- {effectiveDate, termLengthMonths, governingLawCountry, governingLawRegion, contractValue, contractValueCurrency} — this review's own extraction, NOT yet promoted to contracts
  "segmentationMethod"  VARCHAR(20) NULL CHECK ("segmentationMethod" IN ('numbered','paragraph','llm')),
  status                VARCHAR(30) NOT NULL DEFAULT 'queued'
                           CHECK (status IN (
                             'queued','extracting','segmenting','detecting_type',
                             'awaiting_role_confirmation','extracting_definitions',
                             'classifying','scoring','extracting_obligations',
                             'summarizing','verifying','complete','failed','not_supported'
                           )),
  "stageProgress"       JSONB NOT NULL DEFAULT '{}',
  "summaryPoints"       JSONB NOT NULL DEFAULT '[]', -- [{text, clauseIds: [...], quotedText, spanStart, spanEnd, verificationStatus}] — replaces a plain summary TEXT so every point is grounded and clickable back to its clause(s)
  "coverageReport"      JSONB NULL, -- [{clauseType, status: found|not_found|could_not_assess, reason}]
  "costUsd"             NUMERIC(8,4) NULL,
  "errorMessage"        TEXT NULL,
  "createdAt"           TIMESTAMPTZ DEFAULT NOW(),
  "completedAt"         TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_reviews_document ON contract_reviews ("documentId");
CREATE INDEX IF NOT EXISTS idx_contract_reviews_status ON contract_reviews (status);
```

### `contract_review_raw_outputs`
The raw LLM response for every pipeline call. Cannot be recovered later — re-running with the same model version will not reproduce a past response.

```sql
CREATE TABLE IF NOT EXISTS contract_review_raw_outputs (
  id             SERIAL PRIMARY KEY,
  "reviewId"     INTEGER NOT NULL REFERENCES contract_reviews(id) ON DELETE CASCADE,
  stage          VARCHAR(30) NOT NULL,
  "modelId"      TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "rawResponse"  JSONB NOT NULL,
  "createdAt"    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_raw_outputs_review ON contract_review_raw_outputs ("reviewId");
```

### `contract_clause_types` (versioned taxonomy)
String literals in prompts/code would let a later rename ("limitation of liability" → split into `cap`/`exclusions`) silently desync old reviews from new ones.

```sql
CREATE TABLE IF NOT EXISTS contract_clause_types (
  id                SERIAL PRIMARY KEY,
  key               VARCHAR(50) NOT NULL,
  label             TEXT NOT NULL,
  description       TEXT NULL,
  "taxonomyVersion" TEXT NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (key, "taxonomyVersion")
);
```
Seed set (taxonomy version `v1`): `indemnity`, `limitation_of_liability`, `termination`, `auto_renewal`, `payment_terms`, `ip_assignment`, `non_compete`, `confidentiality`, `governing_law`, `dispute_resolution`, `warranties`, `assignment`, `force_majeure`, `data_protection`.

### `contract_clauses`

```sql
CREATE TABLE IF NOT EXISTS contract_clauses (
  id                    SERIAL PRIMARY KEY,
  "reviewId"            INTEGER NOT NULL REFERENCES contract_reviews(id) ON DELETE CASCADE,
  "lineageId"           UUID NOT NULL, -- stable "same clause" identity across drafts; heuristic-matched in v1
  ordinal               INTEGER NOT NULL,
  "numberLabel"         TEXT NULL,      -- "4.1(a)(ii)", "Article IV", null if unnumbered/paragraph-segmented
  heading               TEXT NULL,
  text                  TEXT NOT NULL, -- ALWAYS an exact slice of the document's extractedText[spanStart:spanEnd] — never model-paraphrased, even under LLM segmentation (see Pipeline stage 2)
  "spanStart"           INTEGER NOT NULL,
  "spanEnd"             INTEGER NOT NULL,
  "startPage"           INTEGER NULL,
  "endPage"             INTEGER NULL,
  bbox                  JSONB NULL,
  "clauseTypeId"        INTEGER NULL REFERENCES contract_clause_types(id),
  "riskLevel"           VARCHAR(10) NULL CHECK ("riskLevel" IN ('standard','risky','unclear')),
  "whyItMatters"        TEXT NULL,
  "playbookPositionKey" TEXT NULL,
  "suggestedRedline"    TEXT NULL,
  "crossReferences"     JSONB NOT NULL DEFAULT '[]', -- [{label:"Section 9.2", note:"referenced, not assessed"}]
  "verificationStatus"  VARCHAR(20) NULL CHECK ("verificationStatus" IN ('verified_exact','verified_normalized','failed')),
  "priorClauseId"       INTEGER NULL REFERENCES contract_clauses(id) ON DELETE SET NULL, -- the same-lineage clause in the prior draft's review, if one exists
  "redlineOutcome"      VARCHAR(10) NULL CHECK ("redlineOutcome" IN ('accepted','partial','rejected','changed')), -- set on THIS (the newer) clause, describing what happened to priorClauseId's suggestedRedline — never written onto the prior (older, already-complete) review's row
  "createdAt"           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_clauses_review ON contract_clauses ("reviewId");
CREATE INDEX IF NOT EXISTS idx_contract_clauses_lineage ON contract_clauses ("lineageId");
CREATE INDEX IF NOT EXISTS idx_contract_clauses_text_fts ON contract_clauses USING GIN (to_tsvector('english', text));
```

### `contract_definitions`

```sql
CREATE TABLE IF NOT EXISTS contract_definitions (
  id                   SERIAL PRIMARY KEY,
  "reviewId"           INTEGER NOT NULL REFERENCES contract_reviews(id) ON DELETE CASCADE,
  term                 TEXT NOT NULL,
  definition           TEXT NOT NULL,
  "quotedText"         TEXT NOT NULL, -- exact text the model quoted; code locates this in extractedText to derive spans, not the other way around — see Pipeline stage 10
  "spanStart"          INTEGER NULL,
  "spanEnd"            INTEGER NULL,
  "verificationStatus" VARCHAR(20) NULL CHECK ("verificationStatus" IN ('verified_exact','verified_normalized','failed'))
);
CREATE INDEX IF NOT EXISTS idx_contract_definitions_review ON contract_definitions ("reviewId");
```

### `contract_obligations`
Timing supports all three real shapes — absolute date, anchor + signed offset ("90 days before renewal"), or recurrence (RRULE, reused by ICS export). A single `dueDate` column would force the model to invent a date for anything relative, which is exactly the kind of silent corruption this spec is designed to avoid.

**Extracted obligation rows are immutable** — each review's extraction is a new set of rows, never edited in place. User-facing state (handled/dismissed, linked task) doesn't belong on an immutable row that gets replaced every re-review, so it lives separately in `contract_obligation_tracking`, keyed by `lineageId` (matched heuristically across reviews/drafts, same approach as `contract_clauses.lineageId`) so that state survives a re-review even though the row itself is new.

```sql
CREATE TABLE IF NOT EXISTS contract_obligations (
  id                      SERIAL PRIMARY KEY,
  "reviewId"              INTEGER NOT NULL REFERENCES contract_reviews(id) ON DELETE CASCADE,
  "contractId"            INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  "lineageId"             UUID NOT NULL, -- stable "same obligation" identity across reviews/drafts; heuristic-matched, same approach as clause lineage
  "obligorPartyId"        INTEGER NULL REFERENCES contract_parties(id) ON DELETE SET NULL, -- nullable: extraction sometimes can't confidently attribute an obligor; UI shows "obligor unresolved" rather than guessing
  type                    VARCHAR(20) NOT NULL
                             CHECK (type IN ('payment','notice','renewal','delivery','reporting','other')),
  description             TEXT NOT NULL,
  "absoluteDate"          DATE NULL,
  "anchorEvent"           VARCHAR(30) NULL
                             CHECK ("anchorEvent" IN ('effective_date','renewal_date','invoice_date','termination','custom')),
  "anchorCustomLabel"     TEXT NULL,
  "offsetDays"            INTEGER NULL, -- signed; negative = before the anchor
  rrule                   TEXT NULL,    -- RFC 5545 RRULE string, same format ICS export already needs
  amount                  NUMERIC(14,2) NULL,
  currency                VARCHAR(3) NULL,
  "sourceClauseId"        INTEGER NULL REFERENCES contract_clauses(id) ON DELETE SET NULL,
  "quotedText"            TEXT NULL, -- exact text the model quoted, if any single quote supports this obligation; code locates it to derive spans — see Pipeline stage 10. Null when an obligation is genuinely synthesized from multiple sentences, in which case verificationStatus reflects that it couldn't be span-verified.
  "spanStart"             INTEGER NULL,
  "spanEnd"               INTEGER NULL,
  "verificationStatus"    VARCHAR(20) NULL CHECK ("verificationStatus" IN ('verified_exact','verified_normalized','failed')),
  "supersededByDocumentId" INTEGER NULL REFERENCES contract_documents(id) ON DELETE SET NULL,
  "createdAt"             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_obligations_contract ON contract_obligations ("contractId");
CREATE INDEX IF NOT EXISTS idx_contract_obligations_review ON contract_obligations ("reviewId");
CREATE INDEX IF NOT EXISTS idx_contract_obligations_lineage ON contract_obligations ("lineageId");
```

### `contract_obligation_tracking`
The only mutable, user-facing state for an obligation — one row per `(contractId, lineageId)`, surviving across re-reviews even though `contract_obligations` rows themselves are immutable and re-created each time.

```sql
CREATE TABLE IF NOT EXISTS contract_obligation_tracking (
  id             SERIAL PRIMARY KEY,
  "contractId"   INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  "lineageId"    UUID NOT NULL,
  "userState"    VARCHAR(20) NULL CHECK ("userState" IN ('handled','dismissed')),
  "linkedTaskId" INTEGER NULL REFERENCES tasks(id) ON DELETE SET NULL, -- one-directional, matches CRM touchpoint bridge
  "createdAt"    TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE ("contractId", "lineageId")
);
```

### `contract_corrections`
User overrides kept separate from model output — the effective value is model output with corrections applied, never overwritten in place. Also the data source for future playbook learning (out of scope for v1, but this ledger is what it would read from).

**Corrections must survive a re-review**, not just persist on the row they were made against — that row belongs to one review and gets replaced by a new one on the next draft/re-run. So `contractId` is now **always** populated (every correction belongs to a contract, full stop), and `lineageId` is set for clause/obligation corrections specifically — together they're how `ContractService` finds *this review's* equivalent row to apply the correction to, the same lineage-matching approach `contract_obligation_tracking` already uses. The specific-target FKs (`clauseId`/`obligationId`/`partyId`/`definitionId`) become **provenance only** — which exact row the correction was originally recorded against, kept for audit/debugging, never for lookup — at most one is set (zero of them set means a contract-level/key-term correction, identified by `contractId` alone).

**Those provenance FKs must not cascade-delete the correction.** A correction is applied by `(contractId, lineageId)` against the *current* review, not by re-fetching the original row — so a correction still in effect on a later draft must survive the original (now-superseded) draft's row being deleted, e.g. by `deleteDocument`. `clauseId`/`obligationId`/`partyId`/`definitionId` are therefore `ON DELETE SET NULL`, not `CASCADE` — the correction becomes provenance-less but stays alive and still applies by lineage. Only `contractId` cascades (deleting the whole contract legitimately deletes its corrections). `deleteDocument` separately removes corrections whose `lineageId` no longer exists anywhere on the contract, mirroring the same orphan-cleanup rule already applied to `contract_obligation_tracking`.

`matchedTextSnapshot` records the corrected row's own text (`clause.text`, or `obligation.description` + `obligation.quotedText`) at the moment of correction. **Carry-forward rule:** applying a correction to a later review's lineage-matched row only happens if that row's current text equals `matchedTextSnapshot` — if the clause/obligation text changed in the new draft, the correction doesn't silently apply; it's shown in the UI as "corrected on an earlier version" instead. This is what makes a failed-verification obligation's "confirmed" correction actually stick across re-reviews, rather than quietly dropping the obligation back out of ICS/Tasks every time.

```sql
CREATE TABLE IF NOT EXISTS contract_corrections (
  id                    SERIAL PRIMARY KEY,
  "userId"              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "contractId"          INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, -- ALWAYS set — the lookup key (with lineageId) for applying this correction to the current review
  "clauseId"            INTEGER NULL REFERENCES contract_clauses(id) ON DELETE SET NULL,     -- provenance only — SET NULL, not CASCADE, so a correction outlives the specific row it was recorded against (see note above)
  "obligationId"        INTEGER NULL REFERENCES contract_obligations(id) ON DELETE SET NULL, -- provenance only
  "partyId"             INTEGER NULL REFERENCES contract_parties(id) ON DELETE SET NULL,
  "definitionId"        INTEGER NULL REFERENCES contract_definitions(id) ON DELETE SET NULL,
  "lineageId"           UUID NULL, -- set for clause/obligation corrections only; null for party/definition/contract-level corrections (no lineage concept for those in v1)
  "matchedTextSnapshot" TEXT NULL, -- the clause/obligation's own text at correction time — see carry-forward rule above
  field                 TEXT NOT NULL,
  "modelValue"          TEXT NULL,
  "userValue"           TEXT NULL,
  action                VARCHAR(20) NOT NULL CHECK (action IN ('edit','override','dismiss','accept')),
  note                  TEXT NULL,
  "createdAt"           TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT contract_corrections_target_check CHECK (
    "contractId" IS NOT NULL AND
    (("clauseId" IS NOT NULL)::int + ("obligationId" IS NOT NULL)::int +
     ("partyId" IS NOT NULL)::int + ("definitionId" IS NOT NULL)::int) <= 1
  )
);
CREATE INDEX IF NOT EXISTS idx_contract_corrections_clause ON contract_corrections ("clauseId");
CREATE INDEX IF NOT EXISTS idx_contract_corrections_obligation ON contract_corrections ("obligationId");
CREATE INDEX IF NOT EXISTS idx_contract_corrections_party ON contract_corrections ("partyId");
CREATE INDEX IF NOT EXISTS idx_contract_corrections_definition ON contract_corrections ("definitionId");
CREATE INDEX IF NOT EXISTS idx_contract_corrections_contract ON contract_corrections ("contractId");
CREATE INDEX IF NOT EXISTS idx_contract_corrections_lineage ON contract_corrections ("contractId", "lineageId");
```

### `contract_events`
Timeline/history. `contracts.status` alone only records where a contract is *now* — not when it was executed or when a notice went out. Append-only, never updated.

```sql
CREATE TABLE IF NOT EXISTS contract_events (
  id             SERIAL PRIMARY KEY,
  "contractId"   INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  type           VARCHAR(30) NOT NULL, -- uploaded, reviewed, role_confirmed, status_changed, executed, amended, notice_sent, terminated, hold_set, hold_released
  "occurredAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actorUserId"  INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  "documentId"   INTEGER NULL REFERENCES contract_documents(id) ON DELETE SET NULL,
  "obligationId" INTEGER NULL REFERENCES contract_obligations(id) ON DELETE SET NULL,
  payload        JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_contract_events_contract ON contract_events ("contractId", "occurredAt" DESC);
```

### Playbooks
**Not a database table** — default positions keyed by `${contractType}:${role}`, defined as config objects in `server/services/contractReview/playbooks.js`, each with an explicit version string. The playbook config's top-level keys are the authoritative source for the `contracts.contractType` and `contract_parties.role` CHECK constraints' allowed values (including `'other'`, which maps to a generic fallback playbook). A sha256 hash of the serialized config is computed at load time and recorded on every `contract_reviews` row (`playbookKey`/`playbookVersion`/`playbookHash`). No playbook editing UI in v1 — this mirrors how `costCalculator.js`'s pricing tables are hardcoded-but-versioned-by-citation elsewhere in Vault.

**Enum sync is enforced, not just documented.** The DB CHECK values and `playbooks.js`'s keys are two independent sources of truth for the same set — "keep them in sync by hand" is exactly the kind of thing that drifts silently. A startup assertion (called from the same boot sequence as the existing env-var presence checks in `server/index.js`) compares `contractType`'s and `role`'s CHECK-constraint value lists against `playbooks.js`'s actual `contractType`/`role` keys and **throws, failing boot loudly**, on any mismatch — a missing or renamed playbook key can't silently ship.

---

## Pipeline

Async job with progress (`contract_reviews.status` + `stageProgress`); partial results shown as stages complete; a per-review cost ceiling aborts the run and marks `status='failed'` with `errorMessage` if exceeded.

| # | Stage | Input | Output | Failure behavior |
|---|---|---|---|---|
| 1 | **Ingest** | uploaded file | stored file (via `attachments.js`) + `contentHash`; extracted text + `pageMap` via `translateExtract.js`'s `extractFromPdf`/`extractFromDocx`; if PDF text layer sparse/empty (reusing its `scannedCandidatePages` detection), OCR fallback per page via the existing `tesseract.js` scheduler, records `ocrUsed`/`ocrConfidence` | Non-English or oversized documents stop cleanly with `contract_reviews.status='not_supported'` rather than degraded output. Corrupt/unreadable file → `failed` with a clear message. |
| 2 | **Segmentation** | extracted text + page map | `contract_clauses` rows (text/spans/pages only — no type/risk yet) | Heuristic pass for numbered clauses (`1.`, `1.1`, `4.1(a)(ii)`, `Article IV`, `Section 5`). Sanity-checked (clause count vs. document length, max clause length); if it looks wrong, falls back to paragraph chunks, then LLM segmentation. **LLM segmentation never trusts model-returned clause text directly** — the model returns boundary quotes only (the opening and closing few words of each clause); code locates each boundary pair in `extractedText` and slices the actual text between them, so `contract_clauses.text` stays an exact document slice even under this fallback. If a boundary pair can't be located, that region falls back to paragraph segmentation instead of accepting unlocated (and therefore untrusted) model text. Method used is recorded on the review. |
| 3 | **Contract type detection** | full text | `contract_reviews.detectedContractType` (constrained to the enum), `detectedContractTypeRaw` (model's original label) — **not written to `contracts` directly**, see promotion rule above | LLM call, `standard` tier via `getModelsForUser`, constrained to the same key set as `playbooks.js`. Low-confidence or no match → `'other'`, which uses a generic default playbook and is flagged in the UI as such. |
| 4 | **Parties + key terms extraction** | full text | `contract_parties` rows (reconciled against existing parties by normalized name, not blind-inserted — see `contract_parties` above), `contract_reviews.extractedKeyTerms` (**not written to `contracts` directly**) | Pipeline **pauses** here — `contract_reviews.status='awaiting_role_confirmation'` — unless the user's party is already `confirmedByUser=true` on this contract from a prior review, in which case this stage passes straight through. |
| 5 | **Definitions extraction** | full text | `contract_definitions` rows, each with the model's `quotedText` | LLM call. Failures leave definitions empty rather than block the run — clause scoring still proceeds without term injection. |
| 6 | **Clause classification** | each clause | `contract_clauses.clauseTypeId`, `crossReferences` | LLM call against the taxonomy (`standard` tier). Regex-detected cross-references (`Section \d+\.\d+` etc.) recorded per clause as "referenced, not assessed" — not resolved. |
| 7 | **Risk scoring** | each clause + injected definitions for capitalized terms found in it + playbook for `contractType × role` | `riskLevel`, `whyItMatters`, `playbookPositionKey`, `suggestedRedline` | Model may answer "unclear" rather than being forced to a verdict — stored as `riskLevel='unclear'`, not silently defaulted to `standard`. |
| 8 | **Obligations extraction** | full text + clauses | `contract_obligations` rows (absolute date, or anchor+offset, or RRULE; obligor if confidently attributable else null; amount/currency; `quotedText` where a single quote supports it; `lineageId` heuristic-matched against the prior review's obligations, same approach as clause lineage) | Ambiguous timing → recorded with the clearest available shape (anchor+offset over a guessed absolute date) rather than invented. Ambiguous/unattributable obligor → left null, never guessed. |
| 9 | **Summary** | clauses + obligations | `contract_reviews.summaryPoints` — `[{text, clauseIds, quotedText, spanStart, spanEnd, verificationStatus}]` per point, not a plain paragraph | — |
| 10 | **Grounding verification** | every `quotedText` from stages 5, 8, 9 | `spanStart`/`spanEnd` + `verificationStatus` on each row | **The model returns quoted text, not offsets.** Code searches for it in `extractedText` — within the source clause's own span first when the row has a `sourceClauseId`, else the full document — and derives `spanStart`/`spanEnd` itself. Exact match first; for `ocrUsed` documents, a normalized match (whitespace/punctuation/case/common OCR confusions) next. No match found → `verificationStatus='failed'`, spans left null, shown as unverified in the UI — never silently accepted as verified. |
| 11 | **Coverage report** | detected `contractType`'s expected clause types + what was actually classified | `contract_reviews.coverageReport`: each expected type as `found` / `not_found` / `could_not_assess` with a reason | "Not found" (genuinely absent) and "could not assess" (segmentation/OCR failure) are visibly distinct in the UI — this is what "missing protections" flags are actually built from. |

Every LLM call's raw response is stored in `contract_review_raw_outputs` regardless of stage outcome.

---

## Contract lifecycle rules

- **Active obligations come from executed, non-superseded documents — not from `contracts.status`.** An obligation is *active* (obligation views, Tasks, ICS export, search filters for "upcoming") only when its `contract_documents.status = 'executed'` (not `'draft'` or `'superseded'`) **and** it belongs to that document's **current review**. `contracts.status` remains the agreement-level lifecycle label (draft/executed/expired/terminated) but isn't itself the active-obligation gate — a contract can be `executed` while a later amendment document is still a draft, and obligations from that draft amendment must not appear as active. On non-executed documents, obligations are visible within the review, clearly marked "draft, not active."
- A new draft of an existing document links via `parentDocumentId`. Clause `lineageId` is matched heuristically across drafts (number label, heading, text similarity) — for every clause that had a `suggestedRedline` in the prior draft, `priorClauseId` links to it and `redlineOutcome` records whether it was accepted, partially accepted, rejected, or the clause changed otherwise. Obligation `lineageId` is matched the same way, so `contract_obligation_tracking` state (handled/dismissed/linked task) survives a re-review even though the underlying `contract_obligations` rows are immutable and re-created each time.
- An executed amendment is a `contract_documents` row with `kind='amendment'`, `status='executed'` on the same `contractId`; its obligations can set `supersededByDocumentId` on base obligations it overrides.
- Every status change and key lifecycle action writes a `contract_events` row.
- **Nothing sets `contract_documents.status` or `contracts.status` except these two operations** — there's no implicit transition anywhere else in the pipeline or service layer:
  - **`ContractService.markDocumentExecuted(userId, documentId, executedAt?)`** — sets the document's `status='executed'` + `executedAt`; walks `parentDocumentId` to find any other document in the same chain currently `status='executed'` and marks it `'superseded'` (handles re-executing a newer version of an already-executed document); calls `promoteReviewToContract` for the document's current review; sets `contracts.status='executed'` if it was still `'draft'`; writes a `contract_events` row (`type='executed'`).
  - **`ContractService.setContractStatus(userId, contractId, status)`** — `status` restricted to `'expired'`/`'terminated'` (the only two an explicit action drives; `'draft'`/`'executed'` are only ever set by document execution above, not called directly). Writes a `contract_events` row (`type='status_changed'`).

---

## Access, deletion, retention

- **All reads/writes go through `ContractService`** — no ad-hoc `WHERE "userId" = ...` scattered across routes. One access-check function (`assertContractAccess(userId, contractId)`) used everywhere, so contract access rules exist in exactly one place — including for other Vault agents that later want to query contracts (e.g. "what renews next month?"), per Vault's existing service-layer-first convention.
- **Deletion cascades**: document → reviews → clauses/definitions/obligations/raw outputs/corrections — entirely via `ON DELETE CASCADE` (including `contract_corrections`, which has real FKs per target rather than a polymorphic pair). `contract_obligation_tracking` also cascades automatically on **contract** deletion — it has its own `"contractId" ... ON DELETE CASCADE`, so nothing explicit is needed there. Linked Tasks are **unlinked, not deleted**, with a note appended to the task. Deleting a middle draft re-points its child's `parentDocumentId` to its parent (handled in `ContractService`, not a DB trigger, to keep the logic visible and testable). Deleting a contract removes everything under it.
- **`ContractService.deleteDocument(userId, documentId)`** — deletes one document and everything under it (reviews, clauses, etc., same cascade as above) without touching the rest of the contract. Used when a bad upload needs removing without deleting the whole agreement. Neither `contract_obligation_tracking` nor `contract_corrections` cascade on a document delete (both are scoped to `contractId`, which still exists — corrections' `clauseId`/`obligationId` are `SET NULL` here, not deleted). So after the row-level cascade, `deleteDocument` explicitly:
  - finds `contract_obligation_tracking` rows whose `lineageId` no longer matches any remaining `contract_obligations` row on the contract (i.e. that lineage only ever existed in the deleted document) and removes them, **unlinking any linked task with a note first**;
  - finds `contract_corrections` rows the same way — `lineageId` no longer matching any remaining clause/obligation on the contract — and removes those too, so a correction doesn't linger forever with no row it could ever apply to.
  
  A correction whose lineage **does** still exist on a surviving draft is left alone (now provenance-less, `clauseId`/`obligationId` already `NULL`ed by the FK) and keeps applying via `(contractId, lineageId)` exactly as before the delete.
- **`legalHold = true` blocks deletion entirely** — checked in **every** delete path that can remove contract data: `deleteContract` and `deleteDocument` both check it before any cascade begins, not just one of them.
- **Exception: user-account deletion.** `contracts."userId"` is `ON DELETE CASCADE` against `users(id)` (matching every other Vault table's ownership FK) — deleting a user account cascades their contracts regardless of `legalHold`. This is a deliberate, single-user-app decision: legal hold protects a contract from being deleted *within the app* by mistake or on a whim, not from the user closing their account entirely, since there's no multi-party dispute-hold concept without workspaces/teams. If Vault ever supports account deletion **by someone other than the account owner** (an admin, in a future multi-tenant setup), this exception needs revisiting.
- **Retention policy is visible in the UI** alongside delete controls. Any claim about what the LLM provider retains is marked `TODO: VERIFY against Anthropic's current API data-retention terms` in the copy — not asserted as fact in this spec or in shipped UI text.

---

## Integrations in v1

- **"Add to Tasks"** per obligation (active — executed, non-superseded document's current review — only) — same one-directional bridge pattern as CRM touchpoints (`tasks."clientId"` equivalent: `contract_obligation_tracking.linkedTaskId`, resolved by `contractId` + the obligation's `lineageId`).
- **CRM linking** per party — suggest matches by name against `clients`, user confirms (`contract_parties.crmClientId`).
- **ICS export** of active obligations — absolute dates and anchor+offset obligations resolved to concrete dates when the anchor date is known; recurring obligations exported as RRULE; unresolvable relative obligations (anchor date unknown) listed separately in the UI as such, not silently dropped from the export.
- **Both "Add to Tasks" and ICS export exclude any obligation with `verificationStatus='failed'`** until the user confirms it via a `contract_corrections` entry — an obligation the pipeline couldn't verify against the source text shouldn't quietly end up on a calendar or task list as if it were confirmed.
- **Plain full-text search** over clause text across the user's contracts (Postgres `tsvector`/GIN, see `contract_clauses` index above) — **defaults to clauses from each document's current review only**, matching every other "active" view; an explicit "include prior drafts" toggle can search everything, but that's not the default.

---

## ContractService (`server/services/contractReview/contractService.js`)

Plain exported async functions, no class — matches `modelResolver.js`/`SuggestionService.js`.

```js
assertContractAccess(userId, contractId)          // throws if not owned by userId; single choke point for all access checks

createContract(userId, { title, contractType? })
addDocument(userId, contractId, { file, kind, parentDocumentId? })  // computes contentHash itself — attachments.js doesn't provide one
deleteDocument(userId, documentId)                  // legalHold check, cascades that document's reviews/clauses/etc only
getContract(userId, contractId)                    // includes parties, documents (with status), active obligations summary from current reviews of executed documents
listContracts(userId, { status?, search? })
deleteContract(userId, contractId)                  // legalHold check, cascade entirely DB-enforced (contract_obligation_tracking included, via its own contractId FK), task-unlink

confirmParty(userId, contractId, partyId)           // sets confirmedByUser, unblocks the review (or is skipped automatically — see contract_parties reconciliation)

startReview(userId, documentId)                     // enqueues the pipeline job, returns reviewId
getReview(userId, reviewId)                         // includes clauses, definitions, obligations, summaryPoints, coverage report
listReviews(userId, documentId)
promoteReviewToContract(userId, reviewId)           // called by markDocumentExecuted, and again on any later re-review of an already-executed document; copies detectedContractType/extractedKeyTerms onto contracts (base docs fully, amendments non-null-fields-only — see contracts' effective-values note) merged with contract-level corrections — the ONLY path that writes contracts.contractType/key terms

markDocumentExecuted(userId, documentId, executedAt?)  // sets document status/executedAt, supersedes the chain's prior executed doc, calls promoteReviewToContract, updates contracts.status, writes events
setContractStatus(userId, contractId, status)          // 'expired' | 'terminated' only, writes events

recordCorrection(userId, { contractId, clauseId? | obligationId? | partyId? | definitionId?, field, userValue, action, note? })  // contractId always required; at most one specific target id (provenance) — matches contract_corrections' CHECK constraint. Resolves and stores lineageId + matchedTextSnapshot itself for clause/obligation corrections.

listObligations(userId, { contractId?, upcoming?, obligorPartyId? })  // derives time-based status at read time; joins contract_obligation_tracking for userState/linkedTaskId by (contractId, lineageId); excludes verificationStatus='failed' from any "active" view per Integrations
setObligationState(userId, obligationId, 'handled' | 'dismissed')  // resolves the obligation's (contractId, lineageId), upserts contract_obligation_tracking
linkObligationToTask(userId, obligationId, taskId)  // same resolve-then-upsert as above

exportIcs(userId, { contractId? })                  // active, verified obligations only, from current reviews of executed documents
searchClauses(userId, { query, includeAllDrafts? })  // defaults to current reviews only

setLegalHold(userId, contractId, boolean)
```

## API routes (`server/routes/contractReview.js`, mounted `/api/contract-review`)

```
POST   /contracts
GET    /contracts
GET    /contracts/:id
DELETE /contracts/:id
POST   /contracts/:id/hold                    { hold: boolean }
POST   /contracts/:id/status                  { status: 'expired' | 'terminated' }

POST   /contracts/:id/documents               multipart upload
DELETE /documents/:id                          legalHold-checked, cascades that document only, cleans up orphaned obligation tracking rows
POST   /documents/:id/execute                 { executedAt? }
POST   /contracts/:id/parties/:partyId/confirm

POST   /documents/:id/review                  starts pipeline, returns { reviewId }
GET    /reviews/:id                           poll status/progress + partial results (clauses, definitions, obligations, summaryPoints, coverageReport)
GET    /documents/:id/reviews

POST   /reviews/:id/corrections               { contractId, clauseId? | obligationId? | partyId? | definitionId?, field, userValue, action, note? } — contractId always required, at most one specific target id

GET    /obligations                           ?contractId=&upcoming=&obligorPartyId=
POST   /obligations/:id/state                 { state: 'handled' | 'dismissed' }
POST   /obligations/:id/task                  { taskId }
GET    /export.ics                            ?contractId= (optional)

GET    /search                                ?q=&includeAllDrafts= (optional, default false)
```

## UI screens

- **New contract / upload** — file(s), contract title.
- **Role confirmation** — detected parties, user picks which one they are; blocks the rest of the review until confirmed.
- **Review results** — persistent "not legal advice" banner; key terms card (parties, effective date, term, governing law, value, signatories); severity-badged clause list with source-text highlighting per clause, verification-state indicator, cross-reference notes; coverage report (found / not found / could not assess); plain-English summary.
- **Obligations view** — derived status (upcoming/due/overdue), draft-vs-executed distinction (by document, not contract), obligor or "obligor unresolved" when `obligorPartyId` is null, unverified obligations visibly separated from active ones, "Add to Task" action, ICS export button.
- **Corrections** — inline edit/override/dismiss-with-note on any flag or obligation; a correction that couldn't be carried forward to the current review (matched text changed) shows as "corrected on an earlier version" rather than silently applying or silently vanishing.
- **Version history** — document chain per contract, redline-acceptance result per clause between drafts.
- **Contract detail** — parties, key terms, status, events timeline, legal hold toggle, delete (with retention policy text alongside); per-document "Mark as executed" action; contract-level "Mark expired/terminated" action.
- **Search** — full-text across the user's contracts.

## Explicitly out of scope for v1

Cross-reference graph resolution (regex-flagged only); redaction pre-pass before LLM calls; full golden-set eval harness (a small 5–10 contract smoke set **is** in scope); reminder/notification firing (ICS export substitutes); automatic ingestion from email/e-signature platforms (only the `source`/`externalId` hooks exist); lawyer export packet and drafted counterparty email; embeddings/semantic Q&A; playbook editing or learning; spend analytics; template-based drafting; sharing/multi-user workspaces (only the nullable `workspaceId` hook exists).

---

## Build-stage plan

1. **Schema + service layer** — all tables above, `ContractService` skeleton, `assertContractAccess`, the `playbooks.js` enum-sync startup assertion. Tests: (a) deleting an old draft document whose corrections' lineages still exist on a later draft — those corrections **survive** (provenance FK nulled, still applies by lineage); a correction whose lineage exists nowhere else on the contract (only ever existed in the deleted document) **is removed**; (b) intentionally desyncing a `contractType`/`role` CHECK value from `playbooks.js`'s keys and confirming the app fails to boot with a clear error, not a silent mismatch.
2. **Extraction + segmentation + smoke set** — ingest pipeline (stages 1–2), 5–10 annotated contracts as the smoke set, verified against known clauses.
3. **Analysis pipeline** — pipeline stages 3–7 (type detection through risk scoring) plus stage 9 (summary) and stage 10 (grounding verification) and stage 11 (coverage report); playbook config; party reconciliation.
4. **Obligations** — stage 8 extraction, `contract_obligation_tracking`, derived time-based status, draft/executed gating (document-level), supersession (`supersededByDocumentId`), `markDocumentExecuted`/`setContractStatus`, promotion rules (base-vs-amendment, re-promotion on re-review).
5. **Versions + lineage** — draft chains, clause + obligation `lineageId` matching, redline-outcome reporting (`priorClauseId`/`redlineOutcome` on the newer clause), amendments. Test: dismiss a flag and confirm (via correction) an unverified obligation, re-run the review, and both persist on the new current review; then change that clause's/obligation's text in a new draft and confirm the dismissal does **not** silently carry forward — it shows as "corrected on an earlier version" instead.
6. **UI + integrations** — all screens above, Tasks bridge, CRM linking, ICS export, search.

Each stage's own checkpoint prompt runs before that stage is approved and committed, per the process already agreed for this feature.

---

## Ambiguities / things worth confirming before Stage 1

All five items originally raised here were reviewed and resolved explicitly in round 2 — see Decisions Log below. None remain open.

## Decisions Log

*(Later build stages record any deviation from this spec here too, with a reason, per stage.)*

**Round 2 (post-review of Stage 0 draft):**

1. **Notification service** — confirmed none exists; kept as designed (out of scope for v1). Added explicit note that reminder-firing, when built, follows the existing `sendEmail.js` direct-cron-call precedent (a new `contractRemindersCron.js`), not a retrofit onto a generic service.
2. **`contractType`** — changed from free text to a constrained enum whose keys match `playbooks.js`'s config keys exactly (including `'other'`, generic fallback playbook, flagged in UI). Added `contractTypeRaw` (text) to preserve the model's original unconstrained label. Added `contractTypeVersion` to `contract_reviews`, tracked the same way as `taxonomyVersion`. Reason: `contractType` is a lookup key into playbooks and coverage expectations — free text would silently fail to match its playbook on any variation in phrasing.
3. **`workspaceId`** — kept nullable and unconstrained (no FK; no `workspaces` table exists). Made explicit in the schema comment that nothing writes this column in v1.
4. **`attachments.js`** — checked directly against contract-review needs before finalizing (size limit, DOCX allowlist, content-hash availability, no file transformation, deletion/cleanup behavior). All five checks pass as-is; no change to `attachments.js` required. The only gap (no stored content hash) is handled on the contract-review side — `ContractService.addDocument` computes the sha256 itself after upload.
5. **`contract_corrections`** — replaced the polymorphic `targetType`/`targetId` pair with five nullable FKs (`clauseId`, `obligationId`, `partyId`, `definitionId`, `contractId` for key-term corrections), each `ON DELETE CASCADE`, plus a CHECK constraint requiring exactly one non-null. Removed the manual-cascade note from `deleteContract` — cascade is now entirely DB-enforced. Added a Stage 1 test: deleting a single document, and separately a middle draft, must both correctly cascade-remove the corresponding `contract_corrections` rows.

**Round 3:**

1. **Document-level execution** — added `contract_documents.status` (draft/executed/superseded) + `executedAt`. Active obligations now gated on document status, not `contracts.status`. Reason: a contract can be executed while a later amendment is still a draft — gating at the contract level would either wrongly activate the draft amendment's obligations or wrongly deactivate the base agreement's.
2. **Current review** — defined as a document's latest `status='complete'` review. All active views (obligations, ICS, Tasks, search defaults) use current reviews only. Reason: a document can be re-reviewed (model/playbook upgrade) and only the latest analysis should be authoritative for anything the user acts on.
3. **Obligation identity + immutability** — added `contract_obligations.lineageId`; removed `userState`/`linkedTaskId` from `contract_obligations`; added `contract_obligation_tracking` (unique per `contractId`+`lineageId`) to hold that mutable state instead. Reason: obligation rows are immutable and re-created each review, so user state that should persist across re-reviews can't live on the row itself.
4. **Review snapshots vs. effective values** — added `contract_reviews.detectedContractType`/`detectedContractTypeRaw`/`contractTypeEnumVersion` (renamed from `contractTypeVersion` for clarity alongside the new `detected*` fields) and `extractedKeyTerms`. `contracts.contractType` and key terms are now explicitly effective values, written only by `ContractService.promoteReviewToContract` from an executed document's current review plus corrections — the pipeline no longer writes them directly. Reason: without this, re-reviewing a draft under negotiation could silently overwrite the values from the version that's actually signed.
5. **Party reconciliation** — extracted parties matched against existing `contract_parties` by normalized name rather than blind-inserted; `awaiting_role_confirmation` is skipped when the user's party is already confirmed on the contract. Reason: re-reviewing a new draft shouldn't re-ask a question already answered, and shouldn't create duplicate party rows for the same real-world party.
6. **Role as enum** — `contract_parties.role` changed from free text to a constrained enum matching `playbooks.js`'s role keys (plus `roleRaw`), same treatment and same reason as `contractType` in round 2 — a playbook is keyed by `contractType × role`, so a free-text role could silently miss its playbook the same way a free-text contract type could.
7. **Model-quotes-not-offsets grounding** — `contract_definitions`/`contract_obligations` gained `quotedText`; their `spanStart`/`spanEnd` are now nullable and derived by code searching for the quoted text (within the source clause first, when applicable) rather than the model providing offsets directly. Replaced `contract_reviews.summary` (plain text) with `summaryPoints` (JSONB, each point grounded with its own quote/span/verification status). Pipeline stage 10 rewritten accordingly. Reason: asking a model for character offsets into a document it doesn't have byte-precise access to is asking it to guess; asking it to quote text and verifying that quote programmatically is the actually-groundable version of the same requirement already stated in this spec's guardrails.
8. **Redline outcomes** — added `contract_clauses.priorClauseId` (FK, `SET NULL`) and `redlineOutcome` (accepted/partial/rejected/changed). Reason: this closes a mechanism gap flagged back in the original scoping discussion (round 1 of that earlier design review) — "did they accept my redline" had never been given an actual column to answer from.
9. **Nullable obligor** — `contract_obligations.obligorPartyId` changed from `NOT NULL`/`ON DELETE CASCADE` to nullable/`ON DELETE SET NULL`; UI shows "obligor unresolved" rather than the pipeline guessing. Reason: consistent with this spec's existing principle (risk scoring can answer "unclear" rather than being forced to a verdict) — attribution should follow the same rule.
10. **`not_supported` status** — added to `contract_reviews.status`'s CHECK list, formalizing what stage 1's failure behavior already described in prose but hadn't given an actual enum value.
11. **`deleteDocument`** — added to `ContractService` and as `DELETE /documents/:id`. `legalHold` is now explicitly checked in both delete paths (`deleteContract` and `deleteDocument`), not just one. Decision: user-account deletion cascades contracts regardless of `legalHold` (existing `ON DELETE CASCADE` on `contracts."userId"`, matching every other Vault table's ownership FK) — a deliberate single-user-app choice, since legal hold protects against in-app deletion mistakes, not account closure, and there's no multi-party dispute-hold concept without workspaces/teams. Flagged as needing revisiting if account deletion by someone other than the owner (an admin, in a future multi-tenant setup) is ever built.
12. **Unverified obligations excluded from action** — obligations with `verificationStatus='failed'` are excluded from ICS export and "Add to Tasks" until confirmed via a correction. Reason: consistent with the existing grounding guardrail — an obligation the pipeline couldn't verify shouldn't quietly reach a calendar or task list as if it were confirmed.
13. **Search scope** — defaults to clauses from current reviews only, matching every other "active" view; an explicit opt-in covers prior drafts.
14. **Build-stage plan realigned** — Stage 3 now covers pipeline stages 3–7 plus summary/grounding/coverage (9–11); Stage 4 covers obligation extraction, tracking, derived status, draft/executed gating, supersession; Stage 5 covers versions, lineage (clause and obligation), redline outcomes; Stage 6 covers UI, Tasks bridge, CRM linking, ICS export, search — reflecting the entity and pipeline changes above rather than the original stage boundaries.

**Round 4 (final revision — spec locked after this round):**

1. **Corrections survive re-reviews** — `contract_corrections` redesigned: `contractId` is now always populated (not one-of-five anymore) and is, together with a new `lineageId` (set for clause/obligation corrections), the actual lookup key `ContractService` uses to find and apply a correction to the **current** review — the specific-target FKs (`clauseId`/`obligationId`/`partyId`/`definitionId`) become provenance only, and the CHECK relaxes from "exactly one of five" to "at most one of four." Added `matchedTextSnapshot` (the corrected row's text at correction time) and the carry-forward rule: a correction only applies to a later review's lineage-matched row if that row's text is unchanged from the snapshot; otherwise it's shown as "corrected on an earlier version," not silently applied. This is also what makes a failed-verification obligation's confirmation durable across re-reviews, which was the specific failure mode that surfaced the bug. Reason: the round 3 fix gave *obligation tracking* a lineage so state persists across reviews, but corrections still pointed at row IDs scoped to one review — the identical class of bug, unfixed in the one other place it also existed. Added Stage 5 test per above.
2. **Execution operations** — added `ContractService.markDocumentExecuted`/`setContractStatus` and their routes (`POST /documents/:id/execute`, `POST /contracts/:id/status`). Reason: the entire active-obligation/promotion model depended on `contract_documents.status`/`contracts.status`, and nothing in the spec actually set either — the whole execution lifecycle was unreachable as written.
3. **Promotion rule gaps closed** — key terms promote fully only from `kind='base'` documents; an executed amendment promotes only its non-null fields, never overwriting real base-contract values with an amendment's mostly-empty key terms. Re-executing/re-reviewing an already-executed document re-runs promotion, with contract-level corrections re-applied on top. Stage 7's playbook selection now uses a contract-level correction if one exists, else the review's own `detectedContractType` — never `contracts.contractType` directly pre-execution, since that column defaults to `'other'` and would force every draft review onto the generic fallback playbook regardless of what was actually detected.
4. **LLM-segmented clauses are grounded too** — for the LLM segmentation fallback, the model now returns boundary quotes (opening/closing words) per clause rather than the clause text itself; code locates the boundaries and slices `extractedText` between them, falling back to paragraph segmentation for any region where a boundary can't be located. Added the invariant "clause text is always an exact slice of `extractedText`" to the guardrails section itself, not just a pipeline-stage note. Reason: stage 10's grounding verification covered definitions, obligations, and the summary, but clause text itself — the thing everything downstream is scored against — had no equivalent check specifically in the one segmentation path where the model could alter it.
5. **`redlineOutcome` moved to the correct row** — it's set on the **newer** clause (next to `priorClauseId`), describing what happened to the prior clause's redline, rather than being written onto the older, already-`complete` review's row. Added an explicit immutability statement (clauses/definitions/obligations never updated after their review completes) to the guardrails section. Reason: the original phrasing ("did the next draft accept this clause's redline") required mutating a past review whenever a new draft arrived, contradicting the immutability this whole design has been building toward since round 3.
6. **Deletion section corrected** — `contract_obligation_tracking` cascades automatically on contract deletion via its own `contractId` FK (the round 3 note that it needed explicit cleanup was simply wrong). The real gap was `deleteDocument`, which doesn't cascade tracking rows (they're contract-scoped, and the contract still exists) — it now explicitly removes tracking rows whose lineage no longer matches any remaining obligation on the contract, unlinking any linked task with a note first.
7. **Enum-sync enforcement** — added a startup assertion comparing the `contractType`/`role` CHECK value lists against `playbooks.js`'s actual keys, failing boot loudly on mismatch, plus a Stage 1 test that deliberately desyncs them to confirm it fires. Reason: "kept in sync by hand" (as round 2/3 left it) is exactly the kind of two-source-of-truth situation that drifts silently until a real contract hits the gap.
8. **Missing correction indexes** — added `idx_contract_corrections_party`, `idx_contract_corrections_definition`, `idx_contract_corrections_contract`, and `idx_contract_corrections_lineage` on `(contractId, lineageId)` — folded into the item 1 redesign above, since the lineage lookup is now the primary access pattern for applying corrections.

**Round 4 addendum:** Round 4 item 1 made corrections apply by `(contractId, lineageId)` against the current review, but left `clauseId`/`obligationId`/`partyId`/`definitionId` as `ON DELETE CASCADE` — meaning deleting an old draft (via `deleteDocument`) would `CASCADE`-delete a correction still in effect on a later, current draft, silently undoing item 1's own fix. Changed all four to `ON DELETE SET NULL` (provenance-only, never deletes the correction); only `contractId` still cascades. `contract_corrections_at_most_one_target` renamed to `contract_corrections_target_check` and now also requires `contractId IS NOT NULL` explicitly in the CHECK, not just as a column constraint, so the invariant is enforced in one place. Added `deleteDocument` cleanup for corrections whose `lineageId` no longer exists anywhere on the contract, mirroring the identical rule already applied to `contract_obligation_tracking`. Updated the Stage 1 test accordingly: deleting an old draft must keep corrections whose lineage survives on a later draft and remove those whose lineage doesn't.

**Stage 1 build (approved deviations, per the plan approved before implementation):**

1. **`ContractService.addParty(userId, contractId, { name, role?, isUser? })`** — a create method for parties, not explicitly named in the spec's `ContractService` interface list (which only listed `confirmParty`, since parties are normally pipeline output — see Pipeline stage 4). Needed because "CRUD for contracts/parties/documents" was explicit Stage 1 scope, and Stage 1 has no pipeline to create party rows any other way. Signature matches the existing CRUD methods' shape.
2. **`contract_events.type` values used in Stage 1**: `'contract_created'` (on `createContract`), `'uploaded'` (on `addDocument`), `'document_deleted'` (on `deleteDocument`), `'role_confirmed'` (on `confirmParty`), `'hold_set'`/`'hold_released'` (on `setLegalHold`) — `'contract_created'` and `'document_deleted'` aren't in the spec's example type list (`uploaded, reviewed, role_confirmed, status_changed, executed, amended, notice_sent, terminated, hold_set, hold_released`), added since `type` is free `VARCHAR(30)` with no CHECK constraint and the spec's list was described as illustrative, not exhaustive.
3. **Enum-sync assertion split across two checks**, not one: `playbooks.js` validates its own keys against `CONTRACT_TYPE_KEYS`/`PARTY_ROLE_KEYS` at module load (throws immediately on an extra/typo'd key in `playbooks.js`), while `server/index.js`'s startup block validates the reverse direction (a real enum value with no playbook entry at all) — together they cover both drift directions the spec's single "compares the lists" description implied, split for a clearer failure message at each site rather than one combined check.
4. **Stage 1 test execution — verified against a Railway staging database.** No local Postgres was reachable (sandbox blocks binding any local listen socket, confirmed independent of Postgres/Docker; matches `local-setup-issues.md`). The project owner provisioned a separate Railway **staging** Postgres for this purpose (never production) and authorized its use explicitly. `milestone1.test.js` requires `TEST_DATABASE_URL` (never reads `DATABASE_URL` directly), refuses to run if that value equals `DATABASE_URL`, and additionally refuses a Railway-hostname target unless `TEST_DATABASE_CONFIRMED_STAGING=true` is also set per-run — a second, separate confirmation so an accidental future re-run of the same command against a real Railway host still refuses by default. `npm run test:contract-review-m1` run twice against the staging database: all 8 checks pass both times (migration idempotency, the 5 gate tests, the Round 4 addendum lineage-survival test, and the enum-sync assertion), and the second run's own pre-run cleanup sweep found 0 leftover fixture rows from the first — confirming every test cleans up its own fixtures (each `makeUser()`-created user is deleted in a `finally` block; since `contracts."userId"` is `ON DELETE CASCADE`, deleting the fixture user cascades every contract row it owned; the one fixture `tasks` row, created independently of a user, is deleted explicitly).
5. **Bug found and fixed during staging verification** — `deleteDocument`'s `document_deleted` event write referenced `documentId` *after* the document row was already deleted in the same transaction, violating `contract_events`'s FK to `contract_documents` (event logging was originally ordered after the delete). Fixed by writing the event immediately before the delete, inside the same transaction, so a failed or hold-blocked delete leaves no orphan event; the event's `payload` now carries `documentId`, `filename`, `contentHash`, and `version` as a durable record instead of a live FK reference to a row that's about to stop existing.
6. **Race condition found and fixed in the test harness itself** (not app code) — `waitForSchema()` originally polled for the early-created `contracts` table's existence with a 10s timeout; against the staging DB's full ~150-statement app migration (all Vault tables, not just Contract Review) this both timed out too early and could pass while the migration's later statements (including the taxonomy seed) were still running concurrently in the same process. Fixed by polling for `contract_clause_types` reaching exactly 14 rows (the literal last write in the Contract Review migration section) with a 4-minute ceiling.

**Stage 2 (new dependency — approved before build):**

1. **`poppler-utils` (`pdftoppm`) added to the Dockerfile** for server-side PDF-page rasterization. Reason: pipeline stage 1's OCR fallback needs to turn a scanned PDF page into a bitmap before handing it to the existing `tesseract.js` scheduler — checked directly and confirmed **no code in this repo does that today**. `translate.js`'s scanned-page OCR reads `req.body.scannedPageImages`, base64 images the *browser* renders via `pdf.js` canvas before upload; `translateExtract.js` only detects likely-scanned pages (`scannedCandidatePages`), it never rasterizes them; `documentRedaction/ingestNormalize.js`, `pdf.js`, `studyUploadExtract.js` were also checked — none rasterize a page to an image server-side. Contract Review's upload is a plain multipart POST with no browser-rendering step in that flow, so the client-side approach isn't reusable as-is. Chose `pdftoppm` (shell out, matching the existing `libreoffice`/`ffmpeg`/`qpdf` subprocess-tool precedent in the Dockerfile) over `pdfjs-dist` + `canvas` to avoid a native-module npm build (`canvas` compiles against system `cairo`/`pango`, a real source of Railway/Docker build breakage `pdftoppm` avoids entirely). **`translate.js` is untouched** — its client-rendered-image OCR path keeps working exactly as before; it could adopt server-side rasterization later to drop that browser dependency, but that's a separate, unscoped change.
2. **Sandbox has no `poppler-utils`** (confirmed: `pdftoppm` not found, this is a plain Windows Git Bash shell, not the Docker build environment) — the scanned-contract and mixed-document smoke-set cases can't be exercised locally. Per explicit instruction, that portion of the Stage 2 gate runs against the Railway staging deploy (which builds from the Dockerfile) instead of locally.
3. **`server/services/contractReview/ocrScheduler.js`** — a second, Contract-Review-owned `tesseract.js` worker pool (4 workers, same `OCR_LANGS`), not a shared import of `translate.js`'s own scheduler (which is module-private, not exported, and out of bounds to touch). A deliberate small duplication (up to ~8 workers total worst-case) over reaching into `translate.js`'s internals or a riskier shared-module extraction. Lazily initialized on first use, not at module load (unlike `translate.js`'s, which initializes eagerly since its upload route is hit immediately) — Contract Review's OCR only runs inside the async ingest pipeline, not on every boot. Unifying the two pools is a reasonable future cleanup, not done now.
4. **Real bug found in a shared production dependency: `pdf-parse`'s bundled `pdfjs` (v1.10.100, used by `translateExtract.js`'s `extractFromPdf`) non-deterministically corrupts on repeated extraction calls within one process.** Confirmed via direct repro during Stage 2 test debugging: the exact same small, valid, text-only PDF, extracted 5 times in a sequential loop with no images involved, succeeded 4 times and failed the 5th with `Invalid PDF structure` / `Unknown compression method in flate stream`. Also reproduced with a single call in a completely fresh process when preceded by ordinary async Postgres I/O (`pool.query`) — the trigger appears to be event-loop interleaving with `pdf-parse`'s legacy `setTimeout`-based "fake worker" scheduling, not file content or call count alone. This affects Translate's live production route (`server/routes/translate.js`), which calls this exact function on every PDF upload in the same long-lived server process — logged as a Suggestions-inbox alert (category `alert`, source `contractReviewStage2`) recommending either isolating `extractFromPdf` calls in a short-lived worker/child process or replacing the ancient bundled `pdfjs` with a current `pdfjs-dist` call. **Not fixed here** — `translateExtract.js`/`translate.js` are out of scope for this feature. Stage 2's own test suite (`milestone2.test.js`) absorbs the residual per-call flake rate with a bounded retry (`MAX_FLAKE_RETRIES = 4`, matched only against this specific error signature) around each subprocess-isolated extraction attempt, logged visibly on each retry, never silently.
5. **Two IPC bugs found and fixed in the Stage 2 test harness itself** (not app code): (a) `ingestSegmentSubprocess.js` originally called `process.exit(0)` immediately after `process.stdout.write()` — a real Node/Windows pitfall where the process can exit before the write actually flushes, silently truncating the result payload (caught via a test assertion failing on an `undefined` field that was genuinely being written, just cut off in transit). (b) db.js's own module-level `initSchema()` (fired unawaited at every `require('./db')`) raced against this test file's `run().catch()` handler calling `pool.end()` on an early failure, throwing `Cannot use a pool after calling end on the pool` from inside the dangling chain — fixed by awaiting `initSchema()` explicitly at the start of `run()` (a real signal) rather than inferring readiness from a row count (Stage 1's original, weaker approach — also retrofitted onto `milestone1.test.js` for the same latent risk). Final fix for (a): the subprocess writes its JSON result to a dedicated temp file instead of stdout at all, since `db.js`'s own pino logger also writes to stdout in the child and line-splitting to isolate "our" JSON among it proved fragile on its own (a pino line without its own trailing newline merged with the payload on one "line", breaking `JSON.parse` a different way).
