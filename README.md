# HTML -> EXE Packager (Tauri + Umi)

This project is a desktop packaging tool that turns a static HTML folder into a
Windows EXE using Tauri. The frontend is built with Umi.

## Quick Start

Frontend (Umi):
- `npm install`
- `npm run dev`

Backend (Tauri):
- `cd apps/packer-core/src-tauri`
- `cargo tauri dev`

Turborepo shortcuts:
- `npm run dev` (frontend + tauri)
- `npx turbo run tauri:dev` (tauri dev only)

Shell build (base app templates):
- `scripts/build-shell-macos.sh`
- `scripts/build-shell-windows.ps1`

Deployment:
- `pnpm deploy` builds and uploads both dist directories through SSH, then restarts the application.
- Configure SSH credentials and `BT_PANEL_URL`, `BT_API_KEY`, `BT_APP_NAME=cbapp` in the Git-ignored `.deploy.env`. BaoTa restart requires local Python 3.
- `SSH_RESTART_COMMAND`, when configured, takes priority over the BaoTa API.
- `pnpm deploy -- --no-restart` uploads without restarting; `--skip-build` reuses existing build outputs.
- Missing restart configuration stops deployment before upload. A failed restart exits with an error after upload; fix the cause and rerun the restart with `set -a; source .deploy.env; set +a; python3 scripts/restart-baota.py`.

Member application hosting:
- `POST /api/apps/upload-package/api-key` accepts a Bearer API key and multipart fields `file`, `appName`, optional `appId`, and optional `expireDays` (integer 1–365, for example 1/7/30/365; omitted defaults to 1). Invalid or repeated values are rejected. Existing membership, quota and ownership checks apply.
- `previewUrl` uses server configuration `APP_HOSTING_ORIGIN` (default `https://app.chaobenxueyuan.com`), never the caller's Origin or Host. Configure an HTTP(S) origin without a path.
- API-key uploads return a separate anonymous preview URL and `previewExpiresAt` matching `expireDays` (each day is 24 hours). Existing links keep their original expiry. Anyone holding this URL can view the web files until expiry or the next upload to that application. Treat the URL as a temporary credential. Relative web assets are supported; absolute `/static/apps/...` URLs still require the original application permissions.
- `entryUrl` and `packageUrl` remain relative paths for the existing catalog workflow and do not become public. Uploading a package does not create a catalog record; ordinary UI uploads still create/update it in a separate request. Preview links work before this step, without changing catalog visibility or consuming a second app slot.
