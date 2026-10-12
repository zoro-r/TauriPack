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
