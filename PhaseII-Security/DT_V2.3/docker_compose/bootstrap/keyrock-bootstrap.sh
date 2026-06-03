#!/bin/sh
set -eu

apk add --no-cache curl jq >/dev/null

KEYROCK_URL="${KEYROCK_URL:-http://keyrock:3005}"
ADMIN_NAME="${KEYROCK_ADMIN_NAME:-}"
ADMIN_PASS="${KEYROCK_ADMIN_PASS:-}"
VIEWER_USERNAME="${KEYROCK_VIEWER_USERNAME:-}"
VIEWER_EMAIL="${KEYROCK_VIEWER_EMAIL:-}"
VIEWER_PASS="${KEYROCK_VIEWER_PASS:-}"

APP_NAME="${APP_NAME:-MTEXNS Secure API}"
APP_DESCRIPTION="${APP_DESCRIPTION:-Secured Orion + IoT Agent behind Wilma}"
APP_URL="${APP_URL:-http://localhost:8001}"
APP_REDIRECT_URI="${APP_REDIRECT_URI:-http://localhost:8001/auth/callback}"
APP_GRANT_TYPE="${APP_GRANT_TYPE:-authorization_code}"

ENV_OUT_FILE="${ENV_OUT_FILE:-}"
WEB_CONFIG_FILE="${WEB_CONFIG_FILE:-}"

require_var() {
  key="$1"; value="$2"
  if [ -z "${value:-}" ]; then
    echo "ERROR: required variable '$key' is empty."
    exit 1
  fi
}

require_var "KEYROCK_ADMIN_NAME" "$ADMIN_NAME"
require_var "KEYROCK_ADMIN_PASS" "$ADMIN_PASS"
require_var "KEYROCK_VIEWER_USERNAME" "$VIEWER_USERNAME"
require_var "KEYROCK_VIEWER_EMAIL" "$VIEWER_EMAIL"
require_var "KEYROCK_VIEWER_PASS" "$VIEWER_PASS"

update_env() {
  k="$1"; v="$2"; f="$3"
  [ -n "$f" ] || return 0
  if [ -f "$f" ] && grep -q "^${k}=" "$f"; then
    # Avoid sed -i rename issues on Windows bind mounts.
    tmp="$(mktemp)"
    sed "s|^${k}=.*|${k}=${v}|g" "$f" > "$tmp"
    cat "$tmp" > "$f"
    rm -f "$tmp"
  else
    printf "%s=%s\n" "$k" "$v" >> "$f"
  fi
}

write_runtime_config() {
  app_id="$1"; f="$2"
  [ -n "$f" ] || return 0
  cat > "$f" <<EOF
window.__DT_RUNTIME_CONFIG__ = {
  KEYROCK_CLIENT_ID: "$app_id"
};
EOF
}

echo "[0/10] Preflight: checking existing Keyrock resources ..."
preflight_ok=0
if curl -fsS "$KEYROCK_URL/version" >/dev/null 2>&1; then
  pf_token="$(curl -isS -X POST "$KEYROCK_URL/v1/auth/tokens" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$ADMIN_NAME\",\"password\":\"$ADMIN_PASS\"}" \
    | awk -F': ' 'tolower($1)=="x-subject-token"{print $2}' | tr -d '\r')"
  if [ -n "$pf_token" ]; then
    pf_app_id="$(curl -fsS "$KEYROCK_URL/v1/applications" -H "X-Auth-token: $pf_token" \
      | jq -r --arg n "$APP_NAME" '.applications[]? | select(.name==$n) | .id' | head -n1 || true)"
    pf_role_id=""
    if [ -n "${pf_app_id:-}" ] && [ "$pf_app_id" != "null" ]; then
      pf_role_id="$(curl -fsS "$KEYROCK_URL/v1/applications/$pf_app_id/roles" -H "X-Auth-token: $pf_token" \
        | jq -r '.roles[]? | select(.name=="Admin") | .id' | head -n1 || true)"
    fi

    # admin user id (same lookup as main flow)
    pf_admin_id=""
    pf_users="$(curl -fsS "$KEYROCK_URL/v1/users" -H "X-Auth-token: $pf_token" 2>/dev/null || true)"
    pf_admin_id="$(echo "$pf_users" | jq -r \
      --arg u "${KEYROCK_ADMIN_USERNAME:-admin}" \
      --arg e "${KEYROCK_ADMIN_EMAIL:-$ADMIN_NAME}" \
      '.users[]? | select(.username==$u or .email==$e) | .id' | head -n1)"

    pf_pep_id=""
    if [ -n "${pf_app_id:-}" ] && [ "$pf_app_id" != "null" ]; then
      pf_pep_id="$(curl -fsS "$KEYROCK_URL/v1/applications/$pf_app_id/pep_proxies" -H "X-Auth-token: $pf_token" \
        | jq -r '.pep_proxy.id // empty' || true)"
    fi

    # Best-effort check: only short-circuit if all key pieces exist.
    if [ -n "${pf_app_id:-}" ] && [ "$pf_app_id" != "null" ] && \
       [ -n "${pf_role_id:-}" ] && [ "$pf_role_id" != "null" ] && \
       [ -n "${pf_admin_id:-}" ] && [ "$pf_admin_id" != "null" ] && \
       [ -n "${pf_pep_id:-}" ]; then
      preflight_ok=1
    fi
  fi
fi

if [ "$preflight_ok" = "1" ]; then
  echo "  Base app/role/user resources already exist; enforcing full bootstrap state."
fi

echo "[1/10] Waiting for Keyrock at $KEYROCK_URL ..."
until curl -fsS "$KEYROCK_URL/version" >/dev/null 2>&1; do
  sleep 2
done

echo "[2/10] Getting admin token ..."
TOKEN="$(curl -isS -X POST "$KEYROCK_URL/v1/auth/tokens" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$ADMIN_NAME\",\"password\":\"$ADMIN_PASS\"}" \
  | awk -F': ' 'tolower($1)=="x-subject-token"{print $2}' | tr -d '\r')"

if [ -z "$TOKEN" ]; then
  echo "ERROR: could not obtain X-Subject-Token from Keyrock. Check admin credentials."
  exit 1
fi

echo "[3/10] Finding admin user id (via /v1/users) ..."
ADMIN_USERNAME="${KEYROCK_ADMIN_USERNAME:-admin}"
ADMIN_EMAIL="${KEYROCK_ADMIN_EMAIL:-$ADMIN_NAME}"

ADMIN_USER_ID=""
USERS_JSON=""
for i in $(seq 1 30); do
  USERS_JSON="$(curl -fsS "$KEYROCK_URL/v1/users" \
    -H "X-Auth-token: $TOKEN" 2>/dev/null || true)"

  ADMIN_USER_ID="$(echo "$USERS_JSON" | jq -r \
    --arg u "$ADMIN_USERNAME" \
    --arg e "$ADMIN_EMAIL" \
    '.users[]? | select(.username==$u or .email==$e) | .id' | head -n1)"

  if [ -n "${ADMIN_USER_ID:-}" ] && [ "$ADMIN_USER_ID" != "null" ]; then
    break
  fi
  sleep 2
done

if [ -z "${ADMIN_USER_ID:-}" ] || [ "$ADMIN_USER_ID" = "null" ]; then
  echo "ERROR: could not resolve admin user id from /v1/users."
  echo "Response (first 800 chars):"
  echo "$USERS_JSON" | head -c 800
  echo
  exit 1
fi
#echo "  Admin user id: $ADMIN_USER_ID"
echo "  Admin user found with success"

echo "[4/10] Creating (or finding) application: $APP_NAME ..."
APP_ID="$(curl -fsS "$KEYROCK_URL/v1/applications" -H "X-Auth-token: $TOKEN" \
  | jq -r --arg n "$APP_NAME" '.applications[]? | select(.name==$n) | .id' | head -n1 || true)"

APP_SECRET=""
if [ -z "${APP_ID:-}" ] || [ "$APP_ID" = "null" ]; then
  APP_CREATE_PAYLOAD="$(jq -nc \
    --arg n "$APP_NAME" \
    --arg d "$APP_DESCRIPTION" \
    --arg u "$APP_URL" \
    --arg r "$APP_REDIRECT_URI" \
    --arg gt "$APP_GRANT_TYPE" \
    '{application:{name:$n,description:$d,url:$u,redirect_uri:$r,grant_type:[$gt]}}')"

  APP_JSON="$(curl -fsS -X POST "$KEYROCK_URL/v1/applications" \
    -H "X-Auth-token: $TOKEN" -H "Content-Type: application/json" \
    -d "$APP_CREATE_PAYLOAD")"

  APP_ID="$(echo "$APP_JSON" | jq -r '.application.id')"
  APP_SECRET="$(echo "$APP_JSON" | jq -r '.application.secret // empty')"
  #echo "  Created application: APP_ID=$APP_ID"
  echo "  Application created with success"
else
  #echo "  Application already exists: APP_ID=$APP_ID"
  echo "  Application already exists! Success"
  APP_SECRET="$(curl -fsS "$KEYROCK_URL/v1/applications/$APP_ID" -H "X-Auth-token: $TOKEN" \
    | jq -r '.application.secret // empty' || true)"
fi

echo "      Enforcing application OAuth config (authorization code flow + redirect URI) ..."
APP_PATCH_PAYLOAD="$(jq -nc \
  --arg n "$APP_NAME" \
  --arg d "$APP_DESCRIPTION" \
  --arg u "$APP_URL" \
  --arg r "$APP_REDIRECT_URI" \
  --arg gt "$APP_GRANT_TYPE" \
  '{application:{name:$n,description:$d,url:$u,redirect_uri:$r,grant_type:[$gt]}}')"

APP_PATCH_CODE="$(curl -sS -o /tmp/app_patch_body.json -w "%{http_code}" -X PATCH \
  "$KEYROCK_URL/v1/applications/$APP_ID" \
  -H "X-Auth-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$APP_PATCH_PAYLOAD" || true)"

if [ "$APP_PATCH_CODE" != "200" ] && [ "$APP_PATCH_CODE" != "201" ] && [ "$APP_PATCH_CODE" != "204" ]; then
  echo "ERROR: failed to patch Keyrock application OAuth config. HTTP=$APP_PATCH_CODE"
  head -c 800 /tmp/app_patch_body.json || true
  echo
  exit 1
fi

update_env "PEP_PROXY_APP_ID" "$APP_ID" "$ENV_OUT_FILE"
update_env "KEYROCK_CLIENT_ID" "$APP_ID" "$ENV_OUT_FILE"
update_env "KEYROCK_CLIENT_SECRET" "$APP_SECRET" "$ENV_OUT_FILE"
write_runtime_config "$APP_ID" "$WEB_CONFIG_FILE"

echo "[5/10] Creating (or finding) role: Admin ..."
ADMIN_ROLE_ID="$(curl -fsS "$KEYROCK_URL/v1/applications/$APP_ID/roles" -H "X-Auth-token: $TOKEN" \
  | jq -r '.roles[]? | select(.name=="Admin") | .id' | head -n1 || true)"

if [ -z "${ADMIN_ROLE_ID:-}" ] || [ "$ADMIN_ROLE_ID" = "null" ]; then
  ADMIN_ROLE_ID="$(curl -fsS -X POST "$KEYROCK_URL/v1/applications/$APP_ID/roles" \
    -H "X-Auth-token: $TOKEN" -H "Content-Type: application/json" \
    -d '{"role":{"name":"Admin"}}' | jq -r '.role.id')"
  #echo "  Created role Admin: ROLE_ID=$ADMIN_ROLE_ID"
  echo "  Created role Admin with success"
else
  #echo "  Role Admin already exists: ROLE_ID=$ADMIN_ROLE_ID"
  echo "  Role Admin already exists! Success"
fi

echo "      Creating (or finding) role: Viewer ..."
VIEWER_ROLE_ID="$(curl -fsS "$KEYROCK_URL/v1/applications/$APP_ID/roles" -H "X-Auth-token: $TOKEN" \
  | jq -r '.roles[]? | select(.name=="Viewer") | .id' | head -n1 || true)"

if [ -z "${VIEWER_ROLE_ID:-}" ] || [ "$VIEWER_ROLE_ID" = "null" ]; then
  VIEWER_ROLE_ID="$(curl -fsS -X POST "$KEYROCK_URL/v1/applications/$APP_ID/roles" \
    -H "X-Auth-token: $TOKEN" -H "Content-Type: application/json" \
    -d '{"role":{"name":"Viewer"}}' | jq -r '.role.id')"
  echo "  Created role Viewer with success"
else
  echo "  Role Viewer already exists! Success"
fi

echo "[6/10] Creating permissions + assigning to roles ..."
ensure_permission_for_role() {
  ROLE_ID="$1"; PNAME="$2"; PDESC="$3"; PACTION="$4"; PRES="$5"; PREGEX="$6"
  PAYLOAD="$(jq -nc \
    --arg n "$PNAME" --arg d "$PDESC" --arg a "$PACTION" --arg r "$PRES" \
    --argjson rx "$PREGEX" \
    '{permission:{name:$n, description:$d, action:$a, resource:$r, is_regex:$rx}}')"

  # 1) Find permission by name (if already exists)
  PID="$(curl -fsS "$KEYROCK_URL/v1/applications/$APP_ID/permissions" \
    -H "Content-Type: application/json" \
    -H "X-Auth-token: $TOKEN" \
    | jq -r --arg n "$PNAME" '.permissions[]? | select(.name==$n) | .id' | head -n1 || true)"

  # 2) Create permission if missing
  if [ -z "${PID:-}" ] || [ "$PID" = "null" ]; then
    PID="$(curl -fsS -X POST "$KEYROCK_URL/v1/applications/$APP_ID/permissions" \
      -H "Content-Type: application/json" \
      -H "X-Auth-token: $TOKEN" \
      -d "$PAYLOAD" | jq -r '.permission.id')"

    #echo "  Created permission: $PNAME (id=$PID)"
    echo "  Created permission: $PNAME"
  else
    #echo "  Permission exists: $PNAME (id=$PID)"
    echo "  Permission exists: $PNAME "
  fi

  # 3) Enforce permission fields (important when an old run stored is_regex incorrectly).
  patch_code="$(curl -sS -o /dev/null -w "%{http_code}" -X PATCH \
    "$KEYROCK_URL/v1/applications/$APP_ID/permissions/$PID" \
    -H "Content-Type: application/json" \
    -H "X-Auth-token: $TOKEN" \
    -d "$PAYLOAD" || true)"
  if [ "$patch_code" != "200" ] && [ "$patch_code" != "201" ] && [ "$patch_code" != "204" ]; then
    echo "ERROR: failed to patch permission '$PNAME'. HTTP=$patch_code"
    exit 1
  fi

  # 4) Assign permission to role (POST).
  code="$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
    "$KEYROCK_URL/v1/applications/$APP_ID/roles/$ROLE_ID/permissions/$PID" \
    -H "Content-Type: application/json" \
    -H "X-Auth-token: $TOKEN" \
    -d '' || true)"
  if [ "$code" != "200" ] && [ "$code" != "201" ] && [ "$code" != "204" ] && [ "$code" != "409" ]; then
    echo "ERROR: failed to assign permission '$PNAME' to role. HTTP=$code"
    exit 1
  fi
}

ensure_permission_for_role "$ADMIN_ROLE_ID" "IoT Services — Delete (by path)" \
  "Deleting a service group on the IoT Agent" \
  "DELETE" '^/iot/services/?(\?.*)?$' true

ensure_permission_for_role "$ADMIN_ROLE_ID" "IoT Services — Create" \
  "Creating a service group (/iot/services) on the IoT Agent" \
  "POST" '^/iot/services/?$' true

ensure_permission_for_role "$ADMIN_ROLE_ID" "IoT Devices — Create" \
  "Registering devices in a service group on the IoT Agent" \
  "POST" '^/iot/devices/?(\?.*)?$' true

ensure_permission_for_role "$ADMIN_ROLE_ID" "IoT Services — List" \
  "Listing existing service groups on the IoT Agent" \
  "GET" '^/iot/services/?$' true

ensure_permission_for_role "$ADMIN_ROLE_ID" "Orion Entities — List/Read (keyValues or full)" \
  "Reading data from Orion Context Broker" \
  "GET" '^/v2/entities(/[^/]+)?/?(\?.*)?$' true

ensure_permission_for_role "$ADMIN_ROLE_ID" "IoT Devices — List" \
  "Listing devices the IoT Agent has registered" \
  "GET" '^/iot/devices/?$' true

ensure_permission_for_role "$ADMIN_ROLE_ID" "IoT Devices — Delete (by id)" \
  "Deleting a single device by device_id on the IoT Agent" \
  "DELETE" '^/iot/devices/[^/]+/?(\?.*)?$' true

ensure_permission_for_role "$ADMIN_ROLE_ID" "IoT Devices — Update (by id)" \
  "Updating a single device by device_id on the IoT Agent" \
  "PUT" '^/iot/devices/[^/]+/?(\?.*)?$' true

ensure_viewer_orion_working_hours_rule() {
  ROLE_ID="$1"
  PNAME="Orion Logs — Read entities"
  PDESC="Viewer can read Orion logs only in Lisbon working hours"
  PACTION="GET"
  PRES='^/v2/entities/?(\?.*)?$'
  PREGEX=true

  BASE_PAYLOAD="$(jq -nc \
    --arg n "$PNAME" --arg d "$PDESC" --arg a "$PACTION" --arg r "$PRES" \
    --argjson rx "$PREGEX" \
    '{permission:{name:$n, description:$d, action:$a, resource:$r, is_regex:$rx}}')"

  PID="$(curl -fsS "$KEYROCK_URL/v1/applications/$APP_ID/permissions" \
    -H "Content-Type: application/json" \
    -H "X-Auth-token: $TOKEN" \
    | jq -r --arg n "$PNAME" '.permissions[]? | select(.name==$n) | .id' | head -n1 || true)"

  if [ -z "${PID:-}" ] || [ "$PID" = "null" ]; then
    PID="$(curl -fsS -X POST "$KEYROCK_URL/v1/applications/$APP_ID/permissions" \
      -H "Content-Type: application/json" \
      -H "X-Auth-token: $TOKEN" \
      -d "$BASE_PAYLOAD" | jq -r '.permission.id')"
    echo "  Created permission: $PNAME"
  else
    echo "  Permission exists: $PNAME"
    patch_code="$(curl -sS -o /dev/null -w "%{http_code}" -X PATCH \
      "$KEYROCK_URL/v1/applications/$APP_ID/permissions/$PID" \
      -H "Content-Type: application/json" \
      -H "X-Auth-token: $TOKEN" \
      -d "$BASE_PAYLOAD" || true)"
    if [ "$patch_code" != "200" ] && [ "$patch_code" != "201" ] && [ "$patch_code" != "204" ]; then
      echo "ERROR: failed to patch base permission '$PNAME'. HTTP=$patch_code"
      exit 1
    fi
  fi

  VIEWER_XML_RULE="$(cat <<EOF
<Rule RuleId="$PID" Effect="Permit">
  <Description>Viewer can read Orion logs only in Lisbon working hours (Mon-Fri 09:00-13:00 and 14:00-18:00)</Description>
  <Target>
    <AnyOf>
      <AllOf>
        <Match MatchId="urn:oasis:names:tc:xacml:1.0:function:string-regexp-match">
          <AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">^/v2/entities/?(\\?.*)?$</AttributeValue>
          <AttributeDesignator Category="urn:oasis:names:tc:xacml:3.0:attribute-category:resource"
              AttributeId="urn:thales:xacml:2.0:resource:sub-resource-id" DataType="http://www.w3.org/2001/XMLSchema#string"
              MustBePresent="true" />
        </Match>
      </AllOf>
    </AnyOf>
    <AnyOf>
      <AllOf>
        <Match MatchId="urn:oasis:names:tc:xacml:1.0:function:string-equal">
          <AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">GET</AttributeValue>
          <AttributeDesignator Category="urn:oasis:names:tc:xacml:3.0:attribute-category:action"
              AttributeId="urn:oasis:names:tc:xacml:1.0:action:action-id" DataType="http://www.w3.org/2001/XMLSchema#string"
              MustBePresent="true" />
        </Match>
      </AllOf>
    </AnyOf>
  </Target>
  <Condition>
    <Apply FunctionId="urn:oasis:names:tc:xacml:1.0:function:and">
      <Apply FunctionId="urn:oasis:names:tc:xacml:3.0:function:any-of">
        <Function FunctionId="urn:oasis:names:tc:xacml:1.0:function:string-equal" />
        <AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">$ROLE_ID</AttributeValue>
        <AttributeDesignator AttributeId="urn:oasis:names:tc:xacml:2.0:subject:role"
            DataType="http://www.w3.org/2001/XMLSchema#string" MustBePresent="false"
            Category="urn:oasis:names:tc:xacml:1.0:subject-category:access-subject" />
      </Apply>
      <Apply FunctionId="urn:oasis:names:tc:xacml:1.0:function:string-regexp-match">
        <AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">^(Mon|Tue|Wed|Thu|Fri)$</AttributeValue>
        <Apply FunctionId="urn:oasis:names:tc:xacml:1.0:function:string-one-and-only">
          <AttributeDesignator Category="urn:oasis:names:tc:xacml:3.0:attribute-category:environment"
              AttributeId="urn:fiware:environment:lisbon-weekday" DataType="http://www.w3.org/2001/XMLSchema#string"
              MustBePresent="true" />
        </Apply>
      </Apply>
      <Apply FunctionId="urn:oasis:names:tc:xacml:1.0:function:or">
        <Apply FunctionId="urn:oasis:names:tc:xacml:2.0:function:time-in-range">
          <Apply FunctionId="urn:oasis:names:tc:xacml:1.0:function:time-one-and-only">
            <AttributeDesignator Category="urn:oasis:names:tc:xacml:3.0:attribute-category:environment"
                AttributeId="urn:fiware:environment:lisbon-time" DataType="http://www.w3.org/2001/XMLSchema#time"
                MustBePresent="true" />
          </Apply>
          <AttributeValue DataType="http://www.w3.org/2001/XMLSchema#time">09:00:00</AttributeValue>
          <AttributeValue DataType="http://www.w3.org/2001/XMLSchema#time">13:00:00</AttributeValue>
        </Apply>
        <Apply FunctionId="urn:oasis:names:tc:xacml:2.0:function:time-in-range">
          <Apply FunctionId="urn:oasis:names:tc:xacml:1.0:function:time-one-and-only">
            <AttributeDesignator Category="urn:oasis:names:tc:xacml:3.0:attribute-category:environment"
                AttributeId="urn:fiware:environment:lisbon-time" DataType="http://www.w3.org/2001/XMLSchema#time"
                MustBePresent="true" />
          </Apply>
          <AttributeValue DataType="http://www.w3.org/2001/XMLSchema#time">14:00:00</AttributeValue>
          <AttributeValue DataType="http://www.w3.org/2001/XMLSchema#time">18:00:00</AttributeValue>
        </Apply>
      </Apply>
    </Apply>
  </Condition>
</Rule>
EOF
)"

  XML_PAYLOAD="$(jq -nc --arg x "$VIEWER_XML_RULE" '{permission:{xml:$x}}')"
  xml_code="$(curl -sS -o /dev/null -w "%{http_code}" -X PATCH \
    "$KEYROCK_URL/v1/applications/$APP_ID/permissions/$PID" \
    -H "Content-Type: application/json" \
    -H "X-Auth-token: $TOKEN" \
    -d "$XML_PAYLOAD" || true)"
  if [ "$xml_code" != "200" ] && [ "$xml_code" != "201" ] && [ "$xml_code" != "204" ]; then
    echo "ERROR: failed to patch viewer XML permission. HTTP=$xml_code"
    exit 1
  fi

  # Force policy re-submit in Authzforce: remove and recreate assignment.
  del_code="$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE \
    "$KEYROCK_URL/v1/applications/$APP_ID/roles/$ROLE_ID/permissions/$PID" \
    -H "Content-Type: application/json" \
    -H "X-Auth-token: $TOKEN" || true)"
  if [ "$del_code" != "200" ] && [ "$del_code" != "204" ] && [ "$del_code" != "404" ]; then
    echo "ERROR: failed to remove viewer permission assignment for resync. HTTP=$del_code"
    exit 1
  fi

  assign_raw="$(curl -sS -X POST \
    "$KEYROCK_URL/v1/applications/$APP_ID/roles/$ROLE_ID/permissions/$PID" \
    -H "Content-Type: application/json" \
    -H "X-Auth-token: $TOKEN" \
    -d '' \
    -w '\n%{http_code}' || true)"
  assign_code="$(printf "%s" "$assign_raw" | tail -n1)"
  assign_body="$(printf "%s" "$assign_raw" | sed '$d')"
  if [ "$assign_code" != "200" ] && [ "$assign_code" != "201" ] && [ "$assign_code" != "204" ] && [ "$assign_code" != "409" ]; then
    echo "ERROR: failed to assign viewer working-hours permission. HTTP=$assign_code"
    echo "$assign_body" | head -c 800
    echo
    exit 1
  fi

  azf_create_status="$(printf "%s" "$assign_body" | jq -r '.authzforce.create_policy.status // empty' 2>/dev/null || true)"
  if [ -n "$azf_create_status" ] && [ "$azf_create_status" != "200" ]; then
    azf_msg="$(printf "%s" "$assign_body" | jq -r '.authzforce.create_policy.message // "unknown error"' 2>/dev/null || true)"
    echo "ERROR: Authzforce policy update failed for viewer permission. status=$azf_create_status message=$azf_msg"
    exit 1
  fi
}

ensure_viewer_orion_working_hours_rule "$VIEWER_ROLE_ID"

echo "[7/10] Creating (or finding) viewer user ..."
VIEWER_USER_ID="$(curl -fsS "$KEYROCK_URL/v1/users" -H "X-Auth-token: $TOKEN" \
  | jq -r --arg u "$VIEWER_USERNAME" --arg e "$VIEWER_EMAIL" \
    '.users[]? | select(.username==$u or .email==$e) | .id' | head -n1 || true)"

if [ -z "${VIEWER_USER_ID:-}" ] || [ "$VIEWER_USER_ID" = "null" ]; then
  VIEWER_PAYLOAD="$(jq -nc \
    --arg u "$VIEWER_USERNAME" \
    --arg e "$VIEWER_EMAIL" \
    --arg p "$VIEWER_PASS" \
    '{user:{username:$u,email:$e,password:$p,enabled:true}}')"
  VIEWER_USER_ID="$(curl -fsS -X POST "$KEYROCK_URL/v1/users" \
    -H "X-Auth-token: $TOKEN" -H "Content-Type: application/json" \
    -d "$VIEWER_PAYLOAD" | jq -r '.user.id')"
  echo "  Viewer user created with success"
else
  echo "  Viewer user already exists! Success"
fi

echo "[8/10] Ensuring admin/viewer role assignments in this application ..."
resp="$(curl -sS -i -X PUT \
  "$KEYROCK_URL/v1/applications/$APP_ID/users/$ADMIN_USER_ID/roles/$ADMIN_ROLE_ID" \
  -H "Content-Type: application/json" \
  -H "X-Auth-token: $TOKEN" || true)"

code="$(printf "%s" "$resp" | awk 'NR==1{print $2}')"
if [ "$code" != "200" ] && [ "$code" != "201" ] && [ "$code" != "204" ]; then
  echo "ERROR: failed to assign Admin role to admin user. HTTP=$code"
  echo "$resp" | head -n 60
  exit 1
fi

viewer_resp="$(curl -sS -i -X PUT \
  "$KEYROCK_URL/v1/applications/$APP_ID/users/$VIEWER_USER_ID/roles/$VIEWER_ROLE_ID" \
  -H "Content-Type: application/json" \
  -H "X-Auth-token: $TOKEN" || true)"

viewer_code="$(printf "%s" "$viewer_resp" | awk 'NR==1{print $2}')"
if [ "$viewer_code" != "200" ] && [ "$viewer_code" != "201" ] && [ "$viewer_code" != "204" ]; then
  echo "ERROR: failed to assign Viewer role to viewer user. HTTP=$viewer_code"
  echo "$viewer_resp" | head -n 60
  exit 1
fi

echo "[9/10] Creating (or finding) PEP Proxy account for the application ..."
# If already exists, keep the current password by default (to avoid breaking pep-proxy on restart).
PEP_ID="$(curl -fsS "$KEYROCK_URL/v1/applications/$APP_ID/pep_proxies" -H "X-Auth-token: $TOKEN" \
  | jq -r '.pep_proxy.id // empty' || true)"

if [ -z "${PEP_ID:-}" ]; then
  PEP_JSON="$(curl -fsS -X POST "$KEYROCK_URL/v1/applications/$APP_ID/pep_proxies" \
    -H "Content-Type: application/json" \
    -H "X-Auth-token: $TOKEN")"
  PEP_USER="$(echo "$PEP_JSON" | jq -r '.pep_proxy.id')"
  PEP_PASS="$(echo "$PEP_JSON" | jq -r '.pep_proxy.password')"
else
  PEP_USER="$PEP_ID"
  if [ "${RESET_PEP_PROXY_PASSWORD:-0}" = "1" ]; then
    PEP_PASS="$(curl -fsS -X PATCH "$KEYROCK_URL/v1/applications/$APP_ID/pep_proxies" \
      -H "Content-Type: application/json" \
      -H "X-Auth-token: $TOKEN" | jq -r '.new_password')"
  else
    PEP_PASS=""
    if [ -n "$ENV_OUT_FILE" ] && [ -f "$ENV_OUT_FILE" ]; then
      PEP_PASS="$(grep -E '^PEP_PROXY_PASSWORD=' "$ENV_OUT_FILE" | tail -n1 | cut -d= -f2- || true)"
    fi
    if [ -z "${PEP_PASS:-}" ]; then
      echo "WARN: PEP proxy exists; password not reset and not found in env file."
      echo "      Set RESET_PEP_PROXY_PASSWORD=1 to rotate it."
    fi
  fi
fi

#echo "  PEP_PROXY_USERNAME=$PEP_USER"
#echo "  PEP_PROXY_PASSWORD=$PEP_PASS"

update_env "PEP_PROXY_USERNAME" "$PEP_USER" "$ENV_OUT_FILE"
update_env "PEP_PROXY_PASSWORD" "$PEP_PASS" "$ENV_OUT_FILE"

echo "[10/10] Runtime files updated."

echo "DONE."
echo "If ENV_OUT_FILE was set, variables were written there."
