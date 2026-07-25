#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RELEASE_DIR="$ROOT_DIR/.release"
INCLUDE_ENV=false
SKIP_BUILD=false
REMOTE_DIR="${FTP_REMOTE_DIR:-/}"

usage() {
  cat <<'EOF'
Usage: scripts/deploy-ftp.sh [options]

Builds the web client and API server, creates a release archive, then uploads it with FTP/FTPS.

Required environment variables:
  FTP_URL       FTP server URL, for example ftps://ftp.example.com
  FTP_USER      FTP username
  FTP_PASSWORD  FTP password

Optional environment variables:
  FTP_REMOTE_DIR  Remote directory for the archive. Default: /
  FTP_TLS         Force FTPS. Default: true
  BT_PANEL_URL    BaoTa panel URL, for example https://panel.example.com:8888
  BT_API_KEY      BaoTa API key
  BT_APP_NAME     BaoTa Node project name to restart, for example cbapp
  BT_APP_TYPE     BaoTa project type. Default: nodejs
  BT_RESTART_PATH BaoTa project restart path. Default: /mod/project/nodejs/com/set_project_status

Options:
  --remote-dir DIR  Override FTP_REMOTE_DIR
  --include-env     Include apps/basic-server/.env in the archive
  --skip-build      Package existing dist directories without rebuilding
  -h, --help        Show this help text

The archive excludes apps/basic-server/uploads so existing server uploads remain untouched.
FTP upload cannot restart the server; extract the archive and restart the process on the server.
When BT_PANEL_URL, BT_API_KEY, and BT_APP_NAME are configured, the script restarts that Node project after upload.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote-dir)
      REMOTE_DIR="${2:?missing remote directory}"
      shift 2
      ;;
    --include-env)
      INCLUDE_ENV=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

for key in FTP_URL FTP_USER FTP_PASSWORD; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required environment variable: $key" >&2
    exit 1
  fi
done

if ! command -v lftp >/dev/null 2>&1; then
  echo "lftp is required. Install it with: brew install lftp" >&2
  exit 1
fi

md5_of() {
  if command -v md5sum >/dev/null 2>&1; then
    printf '%s' "$1" | md5sum | awk '{print $1}'
  else
    printf '%s' "$1" | md5 -q
  fi
}

restart_baota_app() {
  if [[ -z "${BT_PANEL_URL:-}" && -z "${BT_API_KEY:-}" && -z "${BT_APP_NAME:-}" ]]; then
    echo "BaoTa app restart skipped: BT_PANEL_URL, BT_API_KEY, and BT_APP_NAME are not configured."
    return 0
  fi
  for key in BT_PANEL_URL BT_API_KEY BT_APP_NAME; do
    if [[ -z "${!key:-}" ]]; then
      echo "BaoTa app restart requires: $key" >&2
      return 1
    fi
  done

  local request_time request_token restart_path app_type response
  request_time=$(date +%s)
  request_token=$(md5_of "${request_time}$(md5_of "$BT_API_KEY")")
  restart_path=${BT_RESTART_PATH:-'/mod/project/nodejs/com/set_project_status'}
  app_type=${BT_APP_TYPE:-nodejs}
  echo "Restarting BaoTa Node project: $BT_APP_NAME"
  response=$(curl --fail --silent --show-error --request POST "${BT_PANEL_URL%/}${restart_path}" \
    --data-urlencode "request_token=${request_token}" \
    --data-urlencode "request_time=${request_time}" \
    --data-urlencode "project_type=${app_type}" \
    --data-urlencode "project_name=${BT_APP_NAME}" \
    --data-urlencode "status=restart")
  echo "BaoTa API response: $response"
}

if [[ "$SKIP_BUILD" != true ]]; then
  pnpm --dir "$ROOT_DIR/apps/base-client" build
  pnpm --dir "$ROOT_DIR/apps/basic-server" build
fi

CLIENT_DIST="$ROOT_DIR/apps/base-client/dist"
SERVER_DIST="$ROOT_DIR/apps/basic-server/dist"
if [[ ! -d "$CLIENT_DIST" || ! -d "$SERVER_DIST" ]]; then
  echo "Build output is missing. Run without --skip-build." >&2
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RELEASE_NAME="tauripack_${TIMESTAMP}"
PAYLOAD_DIR="$RELEASE_DIR/$RELEASE_NAME"
ARCHIVE_PATH="$RELEASE_DIR/${RELEASE_NAME}.tar.gz"

rm -rf "$PAYLOAD_DIR"
mkdir -p "$PAYLOAD_DIR/basic-server" "$PAYLOAD_DIR/base-client"

cp -R "$SERVER_DIST" "$PAYLOAD_DIR/basic-server/dist"
cp "$ROOT_DIR/apps/basic-server/package.json" "$PAYLOAD_DIR/basic-server/package.json"
cp -R "$CLIENT_DIST" "$PAYLOAD_DIR/base-client/dist"

if [[ "$INCLUDE_ENV" == true ]]; then
  cp "$ROOT_DIR/apps/basic-server/.env" "$PAYLOAD_DIR/basic-server/.env"
fi

printf 'release=%s\nbuilt_at=%s\n' "$RELEASE_NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PAYLOAD_DIR/RELEASE_INFO"
tar -C "$RELEASE_DIR" -czf "$ARCHIVE_PATH" "$RELEASE_NAME"

FTP_TLS_VALUE=${FTP_TLS:-true}
echo "Uploading $(basename "$ARCHIVE_PATH") to ${FTP_URL}${REMOTE_DIR}"
lftp <<EOF
set cmd:fail-exit yes
set net:max-retries 2
set net:timeout 30
set ftp:ssl-force ${FTP_TLS_VALUE}
set ftp:ssl-protect-data ${FTP_TLS_VALUE}
open -u "${FTP_USER}","${FTP_PASSWORD}" "${FTP_URL}"
mkdir -p "${REMOTE_DIR}"
cd "${REMOTE_DIR}"
put "${ARCHIVE_PATH}"
bye
EOF

echo "Upload complete: ${REMOTE_DIR%/}/$(basename "$ARCHIVE_PATH")"
echo "Local archive: $ARCHIVE_PATH"
restart_baota_app
