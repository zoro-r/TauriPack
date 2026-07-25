#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REMOTE_ROOT="${SSH_REMOTE_ROOT:-/www/wwwroot/project/cbapp}"
SSH_PORT="${SSH_PORT:-22}"
INCLUDE_ENV=false
SKIP_BUILD=false
SKIP_RESTART=false

usage() {
  cat <<'EOF'
Usage: scripts/deploy-ssh.sh [options]

Builds and deploys basic-server and base-client dist files through SSH/SCP.

Required environment variables:
  SSH_HOST             Server address
  SSH_USER             SSH username
  SSH_RESTART_COMMAND  Optional command run on the server after deployment

Authentication (choose one):
  SSH_KEY_PATH         Private key path (recommended)
  SSH_PASSWORD         Password

Optional environment variables:
  SSH_PORT             SSH port. Default: 22
  SSH_REMOTE_ROOT      Project root. Default: /www/wwwroot/project/cbapp

Options:
  --include-env        Upload apps/basic-server/.env after the dist files
  --no-restart         Do not run SSH_RESTART_COMMAND after upload
  --skip-build         Upload existing dist directories without rebuilding
  -h, --help           Show this help text

The deployment uploads only apps/basic-server/dist and apps/base-client/dist.
It preserves server-side .env, uploads, node_modules, and all other project files
unless --include-env is used.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift ;;
    --include-env) INCLUDE_ENV=true; shift ;;
    --no-restart) SKIP_RESTART=true; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

for key in SSH_HOST SSH_USER; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required environment variable: $key" >&2
    exit 1
  fi
done

SSH_OPTIONS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTIONS=(-P "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
SSH_PREFIX=()
if [[ -n "${SSH_KEY_PATH:-}" ]]; then
  SSH_OPTIONS+=(-i "$SSH_KEY_PATH")
  SCP_OPTIONS+=(-i "$SSH_KEY_PATH")
elif [[ -n "${SSH_PASSWORD:-}" ]]; then
  ASKPASS_HELPER="$ROOT_DIR/scripts/ssh-askpass.sh"
  if [[ ! -x "$ASKPASS_HELPER" ]]; then
    echo "SSH password helper is missing or not executable: $ASKPASS_HELPER" >&2
    exit 1
  fi
  SSH_PREFIX=(env "SSH_ASKPASS=$ASKPASS_HELPER" SSH_ASKPASS_REQUIRE=force DISPLAY=deploy)
fi

ssh_run() {
  "${SSH_PREFIX[@]}" ssh "${SSH_OPTIONS[@]}" "$SSH_USER@$SSH_HOST" "$@"
}

scp_upload() {
  "${SSH_PREFIX[@]}" scp "${SCP_OPTIONS[@]}" "$1" "$SSH_USER@$SSH_HOST:$2"
}

scp_upload_dir() {
  "${SSH_PREFIX[@]}" scp "${SCP_OPTIONS[@]}" -r "$1/." "$SSH_USER@$SSH_HOST:$2"
}

if [[ "$SKIP_BUILD" != true ]]; then
  pnpm --dir "$ROOT_DIR/apps/base-client" build
  pnpm --dir "$ROOT_DIR/apps/basic-server" build
fi

if [[ ! -d "$ROOT_DIR/apps/base-client/dist" || ! -d "$ROOT_DIR/apps/basic-server/dist" ]]; then
  echo "Build output is missing. Run without --skip-build." >&2
  exit 1
fi

echo "Checking SSH connection to $SSH_HOST"
ssh_run 'exit'
echo "Preparing remote dist directories"
ssh_run "set -e; rm -rf '$REMOTE_ROOT/apps/basic-server/dist' '$REMOTE_ROOT/apps/base-client/dist'; mkdir -p '$REMOTE_ROOT/apps/basic-server/dist' '$REMOTE_ROOT/apps/base-client/dist'"

echo "Uploading basic-server dist files"
scp_upload_dir "$ROOT_DIR/apps/basic-server/dist" "$REMOTE_ROOT/apps/basic-server/dist/"
echo "Uploading base-client dist files"
scp_upload_dir "$ROOT_DIR/apps/base-client/dist" "$REMOTE_ROOT/apps/base-client/dist/"
if [[ "$INCLUDE_ENV" == true ]]; then
  echo "Uploading basic-server environment file"
  scp_upload "$ROOT_DIR/apps/basic-server/.env" "$REMOTE_ROOT/apps/basic-server/.env"
fi

if [[ "$SKIP_RESTART" == true || -z "${SSH_RESTART_COMMAND:-}" ]]; then
  echo "Application restart skipped; restart it from BaoTa."
else
  echo "Restarting application"
  ssh_run "set -e; cd '$REMOTE_ROOT'; $SSH_RESTART_COMMAND"
fi
echo "Deployment complete"
