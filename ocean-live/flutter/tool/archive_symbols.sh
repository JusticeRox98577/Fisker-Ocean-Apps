#!/usr/bin/env bash
set -euo pipefail
# Do not publish raw deobfuscation maps from a public repository.
if [[ -z "${SYMBOLS_ENCRYPTION_PASSWORD:-}" ]]; then
  echo "Symbols were not uploaded: configure SYMBOLS_ENCRYPTION_PASSWORD to retain encrypted crash symbols." >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi
mkdir -p build/private-artifacts
if [[ -d build/app/outputs/mapping ]]; then cp -R build/app/outputs/mapping build/symbols/native-mapping; fi
tar -czf "$RUNNER_TEMP/ocean-symbols.tar.gz" -C build symbols
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$RUNNER_TEMP/ocean-symbols.tar.gz" -out "build/private-artifacts/symbols-${GITHUB_JOB}.tar.gz.enc" \
  -pass env:SYMBOLS_ENCRYPTION_PASSWORD
rm -f "$RUNNER_TEMP/ocean-symbols.tar.gz"
