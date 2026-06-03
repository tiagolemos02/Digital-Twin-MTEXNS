#!/bin/sh
set -eu

ENV_FILE="${GENERATED_ENV_FILE:-/work/.env.generated}"

load_generated_env() {
  file="$1"
  [ -f "$file" ] || return 0

  # Handle Windows CRLF line endings before sourcing.
  tmp_file="/tmp/generated-env.$$"
  sed 's/\r$//' "$file" > "$tmp_file"
  set -a
  . "$tmp_file"
  set +a
  rm -f "$tmp_file"
}

require_var() {
  key="$1"
  value="$2"
  if [ -z "${value:-}" ]; then
    echo "ERROR: required variable '$key' is empty."
    exit 1
  fi
}

load_generated_env "$ENV_FILE"

require_var "KEYROCK_CLIENT_ID" "${KEYROCK_CLIENT_ID:-}"
require_var "KEYROCK_CLIENT_SECRET" "${KEYROCK_CLIENT_SECRET:-}"

cd /app
exec node server.js
