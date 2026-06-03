#!/bin/sh
set -eu

apk add --no-cache curl jq >/dev/null

ORION_URL="${ORION_URL:-http://orion-v2:1026}"
QUANTUMLEAP_NOTIFY_URL="${QUANTUMLEAP_NOTIFY_URL:-http://quantumleap:8668/v2/notify}"
FIWARE_SERVICE="${FIWARE_SERVICE:-openiot}"
FIWARE_SERVICEPATH="${FIWARE_SERVICEPATH:-/}"
ENTITY_TYPE="${ENTITY_TYPE:-Machine}"
DESCRIPTION="${DESCRIPTION:-Notify QuantumLeap of all Machine entity changes}"

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

orion_headers() {
  curl -fsS "$@" \
    -H "Fiware-Service: $FIWARE_SERVICE" \
    -H "Fiware-ServicePath: $FIWARE_SERVICEPATH"
}

wait_for_url "Orion" "$ORION_URL/version"
wait_for_url "QuantumLeap" "${QUANTUMLEAP_NOTIFY_URL%/v2/notify}/version"

existing_id="$(
  orion_headers "$ORION_URL/v2/subscriptions?limit=1000" \
    | jq -r \
      --arg description "$DESCRIPTION" \
      --arg url "$QUANTUMLEAP_NOTIFY_URL" \
      '.[]? | select(.description == $description or .notification.http.url == $url) | .id' \
    | head -n 1
)"

payload="$(
  jq -nc \
    --arg description "$DESCRIPTION" \
    --arg entityType "$ENTITY_TYPE" \
    --arg url "$QUANTUMLEAP_NOTIFY_URL" \
    '{
      description: $description,
      subject: {
        entities: [
          {
            idPattern: ".*",
            type: $entityType
          }
        ],
        condition: {
          attrs: [],
          notifyOnMetadataChange: false
        }
      },
      notification: {
        http: {
          url: $url
        },
        attrsFormat: "normalized",
        onlyChangedAttrs: true,
        metadata: ["dateCreated", "dateModified"]
      }
    }'
)"

if [ -n "${existing_id:-}" ] && [ "$existing_id" != "null" ]; then
  code="$(
    curl -sS -o /dev/null -w "%{http_code}" -X PATCH \
      "$ORION_URL/v2/subscriptions/$existing_id" \
      -H "Content-Type: application/json" \
      -H "Fiware-Service: $FIWARE_SERVICE" \
      -H "Fiware-ServicePath: $FIWARE_SERVICEPATH" \
      -d "$payload"
  )"
  if [ "$code" != "204" ]; then
    echo "ERROR: failed to update historical subscription $existing_id. HTTP=$code"
    exit 1
  fi
  echo "Historical QuantumLeap subscription already exists: $existing_id"
  exit 0
fi

location="$(
  curl -isS -X POST "$ORION_URL/v2/subscriptions" \
    -H "Content-Type: application/json" \
    -H "Fiware-Service: $FIWARE_SERVICE" \
    -H "Fiware-ServicePath: $FIWARE_SERVICEPATH" \
    -d "$payload" \
    | awk -F': ' 'tolower($1)=="location"{print $2}' \
    | tr -d '\r'
)"

echo "Created historical QuantumLeap subscription: ${location:-unknown id}"
