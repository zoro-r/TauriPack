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
- `POST /api/apps/upload-package/api-key` accepts a Bearer API key and multipart fields `file`, `appName`, optional `appId`, and optional `expireDays` (integer 1–365; omitted defaults to 1). Invalid or repeated expiry values are rejected. Uploads require an active member (administrators are exempt from membership checks).
- Cloud space belongs to the member account, not an individual API key. Keys registered to the same account can manage the same packages. Each account has **50 × 1024 × 1024 bytes** of ZIP capacity; pending uploads reserve capacity atomically in MongoDB, so concurrent uploads cannot overrun the limit. Cloud uploads do not consume catalog app slots. ZIP uploads also have a 50MB request-file limit and a 200MB uncompressed limit.
- API-key uploads always create an independent cloud directory, including when `appId` is supplied. `appId` still validates catalog ownership, but uploading/deleting cloud packages never replaces/deletes catalog files. Ordinary JWT catalog uploads retain their original workflow.
- The upload response adds `appName`, `packageSize` (ZIP bytes) and `createdAt`, alongside `appSlug`, `previewUrl`, `previewExpiresAt` and the existing package fields. Preview URLs remain stable when listing or rotating API keys. Anyone holding a preview URL can view its web files until expiry or deletion; treat it as a temporary credential.
- `GET /api/previews` returns `{ code: 200, data: { list, total, page, pageSize, usedBytes, limitBytes } }`. Every item contains `appSlug`, `slug`, `appName`, `previewUrl`, `packageSize`, `createdAt`, `previewExpiresAt`. Omitting pagination returns all active ready packages; optional positive `page`/`pageSize` paginate (maximum page size 500). Quota always covers the entire account, including pending uploads, regardless of pagination.
- `DELETE /api/previews/:slug` checks ownership, deletes files and releases capacity; success returns `code: 200`. `GET /api/previews/quota` returns `{ code: 200, data: { usedBytes, limitBytes } }`. These management endpoints accept either a registered Bearer API key or a user JWT/session; expired members may still list/delete their data.
- Compatibility: with a Bearer `sk-...` API key, `GET /api/apps` and `DELETE /api/apps/:slug` dispatch to cloud space. JWT/anonymous catalog listing and JWT catalog deletion retain their existing behavior. `GET /api/apps/quota` aliases cloud quota and is registered before the dynamic app ID route. Invalid API keys fail instead of falling back to a public catalog result.
- `previewUrl` uses server configuration `APP_HOSTING_ORIGIN` (default `https://app.chaobenxueyuan.com`), never the caller's Origin or Host. Configure an HTTP(S) origin without a path. The stable preview URL is stored in the account's private MongoDB record; do not expose those records through public catalog APIs or logs.
- Expired packages do not count toward quota and disappear from the active list. Files are removed on account list/quota/upload requests and by a startup/hourly sweep. Failed uploads roll back their reservation and files; interrupted uploads reserve capacity for at most 10 minutes and are cleaned up afterward. No TTL deletion of account records is used, ensuring filesystem cleanup runs first. Each account uses one MongoDB document for atomic reservations and metadata (no replica-set transaction requirement).
- Existing packages without account metadata are intentionally not migrated, listed, counted, or deleted. Existing preview links keep their original expiry. The frontend must treat a successful empty server list as authoritative, rather than restoring stale browser-local records.
- `entryUrl` and `packageUrl` remain relative protected `/static/apps/...` paths for catalog use. Independent cloud packages have no catalog record, so those paths may return 404; use `previewUrl`. Relative web assets are supported. Uploading a cloud package does not publish a catalog app or make protected static paths public.
