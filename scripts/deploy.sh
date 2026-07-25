#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.deploy.env}"

if [[ ! -f "$DEPLOY_ENV_FILE" ]]; then
  echo "Deployment configuration not found: $DEPLOY_ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$DEPLOY_ENV_FILE"
set +a

exec "$ROOT_DIR/scripts/deploy-ssh.sh" "$@"
