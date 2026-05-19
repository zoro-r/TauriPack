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
