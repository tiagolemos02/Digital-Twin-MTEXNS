#!/bin/sh
set -eu

apk add --no-cache curl jq >/dev/null

ORION_URL="${ORION_URL:-http://orion-v2:1026}"
CRATE_URL="${CRATE_URL:-http://crate-db:4200}"
FIWARE_SERVICE="${FIWARE_SERVICE:-openiot}"
FIWARE_SERVICEPATH="${FIWARE_SERVICEPATH:-/}"
ENTITY_TYPE="${ENTITY_TYPE:-Machine}"
SYNC_INTERVAL_SECONDS="${SYNC_INTERVAL_SECONDS:-30}"
RUN_ONCE="${RUN_ONCE:-false}"

schema_name="mt$(printf '%s' "$FIWARE_SERVICE" | tr '[:upper:]' '[:lower:]')"
table_name="et$(printf '%s' "$ENTITY_TYPE" | tr '[:upper:]' '[:lower:]')"

wait_for_url() {
  name="$1"
  url="$2"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "ERROR: $name did not become reachable at $url"
  exit 1
}

orion_get() {
  curl -fsS "$@" \
    -H "Fiware-Service: $FIWARE_SERVICE" \
    -H "Fiware-ServicePath: $FIWARE_SERVICEPATH"
}

crate_sql() {
  stmt="$1"
  jq -nc --arg stmt "$stmt" '{stmt: $stmt}' \
    | curl -fsS "$CRATE_URL/_sql" \
      -H "Content-Type: application/json" \
      -d @-
}

crate_type_for_ngsi_type() {
  ngsi_type="$(printf '%s' "${1:-Text}" | tr '[:upper:]' '[:lower:]')"
  case "$ngsi_type" in
    number|float|double)
      printf '%s\n' "REAL"
      ;;
    integer|int|long)
      printf '%s\n' "BIGINT"
      ;;
    boolean|bool)
      printf '%s\n' "BOOLEAN"
      ;;
    datetime|iso8601)
      printf '%s\n' "TIMESTAMP WITH TIME ZONE"
      ;;
    structuredvalue|object)
      printf '%s\n' "OBJECT(DYNAMIC)"
      ;;
    array)
      printf '%s\n' "ARRAY(TEXT)"
      ;;
    *)
      printf '%s\n' "TEXT"
      ;;
  esac
}

sync_schema() {
  entities="$(orion_get "$ORION_URL/v2/entities?type=$ENTITY_TYPE&limit=1000")"
  attr_lines="$(
    printf '%s' "$entities" \
      | jq -r '
          .[]?
          | to_entries[]
          | select(.key != "id" and .key != "type")
          | select(.value | type == "object")
          | [(.key | ascii_downcase), (.value.type // "Text")]
          | @tsv
        ' \
      | sort -u
  )"

  [ -n "$attr_lines" ] || return 0

  existing_columns="$(
    crate_sql "SELECT column_name FROM information_schema.columns WHERE table_schema = '$schema_name' AND table_name = '$table_name'" \
      | jq -r '.rows[]?[0]'
  )"

  printf '%s\n' "$attr_lines" | while IFS="$(printf '\t')" read -r column_name ngsi_type; do
    [ -n "$column_name" ] || continue
    if ! printf '%s' "$column_name" | grep -Eq '^[a-z_][a-z0-9_]*$'; then
      echo "Skipping unsupported QuantumLeap column name: $column_name"
      continue
    fi

    if printf '%s\n' "$existing_columns" | grep -Fxq "$column_name"; then
      continue
    fi

    crate_type="$(crate_type_for_ngsi_type "$ngsi_type")"
    stmt="ALTER TABLE \"$schema_name\".\"$table_name\" ADD COLUMN \"$column_name\" $crate_type"
    if crate_sql "$stmt" >/dev/null; then
      echo "Added historical column $schema_name.$table_name.$column_name ($crate_type)"
    else
      echo "WARN: failed to add historical column $schema_name.$table_name.$column_name"
    fi
  done
}

wait_for_url "Orion" "$ORION_URL/version"
wait_for_url "CrateDB" "$CRATE_URL/"

while :; do
  sync_schema
  if [ "$RUN_ONCE" = "true" ]; then
    break
  fi
  sleep "$SYNC_INTERVAL_SECONDS"
done
