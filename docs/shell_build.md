# Shell Build (Base App)

This project uses a minimal Tauri shell app as the packaging template.
Build it once per platform and copy the output into `templates/`.

## macOS
```
./scripts/build-shell-macos.sh
```

Output:
- `templates/macos/Base.app`

## Windows (run on Windows)
```
./scripts/build-shell-windows.ps1
```

Output:
- `templates/windows/base.exe`

## Notes
- The shell app loads `www/index.html` and `config.json` at runtime.
- You only need to rebuild when the shell logic changes.
