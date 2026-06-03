#!/bin/sh
set -eu

MYSQL_HOST="${MYSQL_HOST:-mysql-db}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_ROOT_PASSWORD_FILE="${MYSQL_ROOT_PASSWORD_FILE:-/run/secrets/my_secret_data}"
KEYROCK_DB_NAME="${KEYROCK_DB_NAME:-keyrock}"
KEYROCK_DB_USER="${KEYROCK_DB_USER:-keyrock}"
KEYROCK_DB_PASS="${KEYROCK_DB_PASS:-}"

require_var() {
  key="$1"; value="$2"
  if [ -z "${value:-}" ]; then
    echo "ERROR: required variable '$key' is empty."
    exit 1
  fi
}

if [ ! -f "$MYSQL_ROOT_PASSWORD_FILE" ] || [ ! -s "$MYSQL_ROOT_PASSWORD_FILE" ]; then
  echo "ERROR: MySQL root password file is missing or empty: $MYSQL_ROOT_PASSWORD_FILE"
  exit 1
fi

require_var "KEYROCK_DB_PASS" "$KEYROCK_DB_PASS"

echo "Waiting for MySQL..."
until mysqladmin ping -h "$MYSQL_HOST" -P "$MYSQL_PORT" -uroot -p"$(cat "$MYSQL_ROOT_PASSWORD_FILE")" --silent; do
  sleep 2
done

echo "Bootstrapping Keyrock DB user/grants..."
mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -uroot -p"$(cat "$MYSQL_ROOT_PASSWORD_FILE")" <<SQL
CREATE DATABASE IF NOT EXISTS \`$KEYROCK_DB_NAME\`;
CREATE USER IF NOT EXISTS '$KEYROCK_DB_USER'@'%' IDENTIFIED BY '$KEYROCK_DB_PASS';
ALTER USER '$KEYROCK_DB_USER'@'%' IDENTIFIED BY '$KEYROCK_DB_PASS';
GRANT ALL PRIVILEGES ON \`$KEYROCK_DB_NAME\`.* TO '$KEYROCK_DB_USER'@'%';
FLUSH PRIVILEGES;
SET GLOBAL host_cache_size = 0;
FLUSH HOSTS;
SQL

echo "Bootstrap done."
