# Repository Guidelines

## Project Structure & Module Organization
- `apps/packer-ui/`: Umi (React) frontend.
- `apps/packer-core/`: Tauri Rust core (`apps/packer-core/src-tauri/`).
- `apps/basic-server/`: Koa + TypeScript API server.
- `scripts/`: build helpers (e.g., `scripts/build-shell-macos.sh`).
- `templates/`: base app templates and assets.
- `docs/`: project notes and migration docs.

## Build, Test, and Development Commands
- `pnpm install`: install workspace dependencies.
- `pnpm dev`: run Turbo dev for UI + Tauri (`turbo run dev tauri:dev --parallel`).
- `pnpm build`: build all apps with Turbo.
- `cd apps/packer-ui && pnpm dev`: start Umi dev server (port 5173).
- `cd apps/packer-core/src-tauri && cargo tauri dev`: run Tauri backend.
- `cd apps/basic-server && pnpm dev`: run Koa API in watch mode.

## Coding Style & Naming Conventions
- TypeScript/JavaScript: 2-space indentation, camelCase for vars/functions, PascalCase for components.
- Rust: follow rustfmt defaults; keep functions small and purposeful.
- Keep filenames descriptive (e.g., `authController.ts`, `iconService.ts`).
- Stylesheets should use Less (e.g., `index.less`).

## Testing Guidelines
- No formal test framework configured.
- There is a manual script: `apps/basic-server/test-static.js`.
- If you add tests, document how to run them in this file.

## API Response Rules (basic-server)
- All controller responses must be returned via `apps/basic-server/src/utils/tool.ts` helpers (`success`, `fail`, `error`, `wechatSuccess`, `wechatFail`).
- Do not set `ctx.status` in controllers; rely on the response body contract instead.
## API Routing Rules (basic-server)
- All backend API routes must start with `/api`.

## Commit & Pull Request Guidelines
- Git history is not available in this workspace; no commit convention detected.
- PRs should describe scope, list commands run, and include UI screenshots when changing `packer-ui`.

## Security & Configuration Tips
- Backend config is environment-driven (see `apps/basic-server` and `docs/` for Mongo/WeChat notes).
- Avoid committing secrets; use local `.env` files where needed.
