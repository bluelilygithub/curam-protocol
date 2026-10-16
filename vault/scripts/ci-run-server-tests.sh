#!/usr/bin/env bash
# Runs every server/client *.test.* file once (the sub-apps have their own vitest jobs) and prints a
# summary. Needs DATABASE_URL pointing at a throwaway Postgres; never point it at a real database.
# Used by .github/workflows/ci.yml; also runnable locally:
#   DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local bash scripts/ci-run-server-tests.sh
set -u
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL must point at a throwaway test database}"
case "$DATABASE_URL" in
  *railway*|*rlwy.net*) echo "Refusing to run against a Railway host."; exit 2 ;;
esac

export NODE_ENV=test LOG_LEVEL=silent DISABLE_EXTERNAL_CRON=true
# Nothing may be sent or called: mail and every outside key stays blank.
export MAIL_CHANNEL_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= MAIL_FROM=
export ANTHROPIC_API_KEY= GEMINI_API_KEY= DEEPSEEK_API_KEY= FAL_API_KEY= REPLICATE_API_TOKEN=
export FINNHUB_API_KEY= ALPHA_VANTAGE_API_KEY= SEARCH_API_KEY= SERPER_SEARCH_API_KEY= RAINFOREST_API_KEY=
export GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= SENTRY_DSN=

# Files that cannot run in a plain offline job, each with the reason. Remove a line when its cause is fixed.
EXCLUDED=(
  # Need ANTHROPIC_API_KEY (live model calls)
  server/services/gmailNLP.test.js
  server/services/propertyScenario/parseScenario.test.js
  # Contract review: need a second database (TEST_DATABASE_URL), milestone3/4 also live model calls,
  # milestone1/2 hit a schema-creation race on an empty database
  server/services/contractReview/milestone1.test.js
  server/services/contractReview/milestone2.test.js
  server/services/contractReview/milestone3.test.js
  server/services/contractReview/milestone4.test.js
  # Fails until the PDF text-extraction fix (branch fix/pdf-extract-pdfjs6) is merged
  client/src/utils/translatePdfFonts.test.js
)

is_excluded() { local f="$1" x; for x in "${EXCLUDED[@]}"; do [ "$x" = "$f" ] && return 0; done; return 1; }

pass=0; fail=0; failed=()
while IFS= read -r f; do
  f="${f#./}"
  is_excluded "$f" && { echo "SKIP (excluded) $f"; continue; }
  echo "::group::$f"
  if timeout 300 node "$f"; then pass=$((pass+1)); else fail=$((fail+1)); failed+=("$f"); fi
  echo "::endgroup::"
done < <(find . \( -path ./node_modules -o -path ./dist -o -path ./room-planner -o -path ./garden-planner -o -path ./cellar-planner -o -path ./route-tracer \) -prune -o \( -name '*.test.js' -o -name '*.test.mjs' -o -name '*.test.cjs' \) -print | sort)

echo
echo "passed: $pass   failed: $fail   excluded: ${#EXCLUDED[@]}"
if [ "$fail" -gt 0 ]; then printf 'FAILED: %s\n' "${failed[@]}"; exit 1; fi
