# Tauri HTML -> EXE: Solution (Umi Frontend)

## Goals
- Package a static HTML folder into a Windows EXE.
- Provide a guided UI for non-technical users.
- Keep output reproducible and logs traceable.
- Support custom app name, icon, version, and window settings.

## User Flow
1. Select HTML entry or folder.
2. Validate assets (CSS/JS/images).
3. Configure app metadata.
4. Build EXE with progress and logs.
5. Open output folder.

## Project Layout

```
apps/
  packer-ui/           # Umi frontend
  packer-core/         # Tauri Rust backend
templates/
  tauri-minimal/       # temp project template for build
tools/
  html_packager/       # optional CLI
```

## Core Modules (Rust)
- `commands/validate.rs`: check entry HTML and asset references.
- `commands/prepare.rs`: create temp project, copy HTML to dist.
- `commands/build.rs`: run bundler, return output path + logs.
- `model/config.rs`: config schema shared with UI.

## Frontend (Umi)
- Wizard-style pages: input -> settings -> build -> result.
- Store last config in local storage.
- Display build logs with streaming updates.

## Packaging Pipeline
1. Validate input path and entry HTML.
2. Parse HTML to resolve assets.
3. Generate temp Tauri workspace.
4. Write `tauri.conf.json`.
5. Run Tauri build.
6. Collect EXE from `target/release/bundle`.

## Config Model

```
{
  "app_name": "MyApp",
  "bundle_id": "com.example.myapp",
  "version": "0.1.0",
  "icon_path": "C:/icons/app.ico",
  "entry": "index.html",
  "window": { "width": 1280, "height": 800 },
  "output_dir": "C:/Users/me/Desktop"
}
```

## Security
- Default to local files only.
- Warn on absolute file system paths in HTML.

