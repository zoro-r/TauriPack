# Development Guide

## 1. Project Overview

This repository is a desktop packaging tool monorepo. Its main purpose is to turn a static HTML directory into a desktop application package through a Tauri shell, while also providing a web UI and a small backend service for auxiliary capabilities such as icon conversion and authentication.

The repository is managed with `pnpm` workspaces and `turbo`.

Core applications:

- `apps/packer-ui`: main packaging workbench, based on Umi + React
- `apps/packer-core`: Tauri desktop shell, based on Rust
- `apps/basic-server`: Koa backend service, based on TypeScript
- `apps/base-client`: a separate Umi frontend served by `basic-server`

Supporting directories:

- `scripts`: local build helper scripts
- `templates`: packaged shell templates and assets
- `docs`: project notes and design/migration documents
- `tools`: auxiliary tooling

## 2. Tech Stack

### Frontend

- `React 18`
- `@umijs/max`
- `antd`
- `@ant-design/pro-components`
- `axios`
- `Less` and `CSS`

### Desktop Runtime

- `Tauri 2`
- `@tauri-apps/api`
- `@tauri-apps/plugin-dialog`
- `Rust 2021`

### Backend

- `Node.js`
- `Koa`
- `@koa/router`
- `mongoose`
- `jsonwebtoken`
- `multer`
- `sharp`
- `png-to-ico`
- `@fiahfy/icns`

### Build / Workspace

- `pnpm`
- `turbo`
- `TypeScript`

## 3. Monorepo Structure

### Root

- `package.json`: workspace root scripts
- `pnpm-workspace.yaml`: workspace package declaration
- `turbo.json`: build and dev task orchestration

### apps/packer-ui

Purpose: desktop packaging UI.

Typical structure:

- `config/config.ts`: Umi routes and runtime config
- `src/pages/`: page-level components
- `src/layouts/`: layout components
- `src/utils/request.ts`: unified request wrapper
- `src/*.less`: page or layout styles

Current route style is flat and explicit, for example:

- `/`
- `/wallet`
- `/login`

### apps/packer-core

Purpose: desktop-side runtime and local packaging commands.

Typical structure:

- `src-tauri/src/main.rs`: Tauri app startup and command registration
- `src-tauri/src/commands.rs`: packaging, DMG generation, open directory, and related logic
- `src-tauri/tauri.conf.json`: Tauri app config
- `src-tauri/icons/`: application icon assets

The frontend calls Rust commands through `invoke`, and the Rust side performs filesystem and OS-level operations.

### apps/basic-server

Purpose: backend API and static hosting.

Typical structure:

- `src/app.ts`: Koa bootstrap, Mongo connection, CORS, static hosting
- `src/routers/`: route registration
- `src/controllers/`: HTTP parameter validation and response assembly
- `src/services/`: business logic
- `src/models/`: Mongoose models
- `src/utils/`: shared tools and response helpers
- `src/scripts/`: local scripts

This app also serves:

- uploaded static assets under `/static/*`
- built frontend assets from `apps/base-client/dist`

### apps/base-client

Purpose: frontend site hosted by `basic-server`.

Typical structure:

- `config/config.ts`
- `src/app.tsx`
- `src/pages/`
- `src/utils/request.ts`

## 4. Primary Development Commands

Recommended package manager: `pnpm`.

### Workspace-level

- `pnpm install`: install all workspace dependencies
- `pnpm dev`: run Turbo dev tasks for UI and Tauri
- `pnpm build`: build all applications

### App-level

- `cd apps/packer-ui && pnpm dev`: start Umi dev server on `127.0.0.1:5173`
- `cd apps/packer-ui && pnpm build`: build main frontend
- `cd apps/packer-core && pnpm tauri:dev`: start Tauri dev
- `cd apps/packer-core && pnpm tauri:build`: build Tauri app
- `cd apps/basic-server && pnpm dev`: run Koa server in watch mode
- `cd apps/basic-server && pnpm build`: compile backend TypeScript
- `cd apps/basic-server && pnpm serve`: run production backend on port `3698` by default
- `cd apps/base-client && pnpm dev`: start secondary frontend on `127.0.0.1:5174`

## 5. Languages and Coding Conventions

The repository guidelines and current codebase imply the following conventions.

### TypeScript / JavaScript

- 2-space indentation
- variables and functions use `camelCase`
- React components use `PascalCase`
- filenames should be descriptive, such as `authController.ts` and `iconService.ts`
- styles prefer Less files such as `index.less`

### Rust

- follow `rustfmt` defaults
- keep functions small and responsibility-focused
- separate Tauri command entrypoints from internal helper functions when practical

### Imports and Paths

`apps/basic-server` uses path aliases in `tsconfig.json`:

- `@/*` -> `src/*`
- `src/*` -> `src/*`

Prefer existing aliases instead of long relative paths in backend code.

## 6. Backend API Rules

These rules are explicit repository requirements and should be treated as mandatory.

### Route Prefix

All backend API routes must start with `/api`.

Examples already in the codebase:

- `/api/convert-icon`
- `/api/auth/wechat/qr`
- `/api/auth/token`

### Response Format

Controllers in `apps/basic-server` must return response bodies through:

- `success`
- `fail`
- `error`
- `wechatSuccess`
- `wechatFail`

These helpers are defined in `apps/basic-server/src/utils/tool.ts`.

Do not handcraft arbitrary controller response bodies when one of these helpers applies.

### HTTP Status Handling

Do not set `ctx.status` directly in controllers. The project currently relies on the response body contract instead.

## 7. Layering Conventions

### basic-server

Recommended responsibilities by layer:

- router: bind HTTP method and path
- controller: validate request input, call services, return standardized response
- service: hold business logic and integration code
- model: define persistence schema
- utils: hold reusable helpers

This separation is already visible in files such as:

- `src/routers/basic.ts`
- `src/controllers/basicController.ts`
- `src/services/iconService.ts`

### packer-ui

Recommended responsibilities by layer:

- `pages`: page-level orchestration and UI composition
- `layouts`: reusable shell/layout behavior
- `utils/request.ts`: centralized HTTP behavior

The current codebase keeps request token handling, error message display, and login redirection inside the shared request layer.

### packer-core

Recommended responsibilities by layer:

- `main.rs`: register commands, initialize window/runtime state
- `commands.rs`: execute filesystem and packaging commands
- config files: hold Tauri build and window settings

## 8. Runtime and Environment Conventions

### basic-server

- configuration is environment-variable driven
- Mongo connection is assembled from env vars when a full URI is not provided
- frontend static directory can be overridden by `CLIENT_DIST`
- default backend port is `3001` in dev and `3698` in the `serve` script

### packer-ui

- uses `http://127.0.0.1:3001` as API base in development
- uses `window.location.origin` in production

### Tauri

- dev frontend URL is `http://127.0.0.1:5173`
- production frontend dist points to `../../packer-ui/dist`

## 9. Testing Status

The repository does not currently have a formal automated test framework configured at the workspace level.

Current known test-related status:

- `apps/basic-server/test-static.js` exists as a manual script
- no root-level Jest, Vitest, Playwright, or Rust test workflow was found in the scanned configuration

If new tests are added, document how to run them in the relevant app documentation.

## 10. Current Observations and Gaps

These are not hard rules, but they are important for anyone continuing development.

### Package Manager Drift

The repository root is configured for `pnpm`, but some existing files still reference `npm`.

Examples:

- root `package.json` declares `pnpm@8.15.0`
- `README.md` examples still use `npm`
- `apps/packer-ui/config/config.ts` sets `npmClient: 'npm'`

For new work, prefer `pnpm` unless there is a specific compatibility reason not to.

### Tooling Enforcement Is Light

No project-wide ESLint, Prettier, or Stylelint config was found during the scan. Current style consistency appears to rely mainly on team convention and code review.

### Built Artifacts Exist in Repo Workspace

Existing `dist`, `.umi`, `.umi-production`, `.turbo`, `node_modules`, and Tauri `target` directories are present in the working tree. When scanning or editing the repository, focus on source files and avoid confusing generated output with hand-written code.

## 11. Recommended Working Rules

For ongoing development in this repository:

- prefer `pnpm` commands at the root and app level
- keep backend routes under `/api`
- return backend controller responses through the shared response helpers
- avoid putting business logic directly into routers
- keep frontend request handling centralized
- keep Tauri command logic on the Rust side rather than pushing OS work into the frontend
- preserve current directory boundaries between `packer-ui`, `packer-core`, `basic-server`, and `base-client`

## 12. Key Files for New Contributors

Start with these files to understand the project quickly:

- `package.json`
- `pnpm-workspace.yaml`
- `turbo.json`
- `apps/packer-ui/config/config.ts`
- `apps/packer-ui/src/pages/index.tsx`
- `apps/packer-ui/src/utils/request.ts`
- `apps/packer-core/src-tauri/src/main.rs`
- `apps/packer-core/src-tauri/src/commands.rs`
- `apps/packer-core/src-tauri/tauri.conf.json`
- `apps/basic-server/src/app.ts`
- `apps/basic-server/src/routers/index.ts`
- `apps/basic-server/src/utils/tool.ts`
