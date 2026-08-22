#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

IDENTIFIER=$(grep -m1 'identifier:' conf.yml | sed -E 's/.*identifier:\s*"?([^"]+)"?.*/\1/')
OUT="${IDENTIFIER}.blueprint"

rm -f "$OUT"
zip -r "$OUT" . -x ".git/*" -x ".claude/*" -x ".dist/*" -x "*.blueprint" -x "build.sh" -x "build.ps1"

echo "Built $OUT"
