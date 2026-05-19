# 方案 A：壳应用 + 资源注入（无需用户安装 Rust）

目标：用户本地只需运行本工具即可生成 Windows EXE / macOS APP（不要求 Rust/Tauri）。

## 关键思路
- 准备一份“预编译壳应用”（Windows: `base.exe` / macOS: `Base.app`）。
- 打包时仅复制壳应用 + 注入 `www` 和 `config.json`。
- Windows 通过资源编辑工具替换图标与版本信息（例如 `rh.exe` 或 `rcedit`）。

## 目录约定（本项目）
```
templates/
  windows/
    base.exe          # 需要你提供的壳应用（Windows）
    rh.exe            # 资源替换工具（已从 PakePlus 拷贝）
    man.json          # 可选：默认配置模板
    custom.js         # 可选：注入脚本模板
  macos/
    Base.app          # 需要你提供的壳应用（macOS）
```

## 打包流程（Windows）
1. 将 `base.exe` 复制到 `{output}/{appName}/{appName}.exe`。
2. 复制 HTML 到 `{output}/{appName}/www/`。
3. 写入 `config.json`（窗口尺寸、标题、版本、icon 路径等）。
4. 使用 `rh.exe` 替换 exe 的图标和版本信息（可选）。

## 打包流程（macOS）
1. 将 `Base.app` 拷贝到 `{output}/{appName}.app`。
2. 复制 HTML 到 `{output}/{appName}.app/Contents/MacOS/www/`。
3. 写入 `config.json` 到 `{output}/{appName}.app/Contents/MacOS/config.json`。
4. 可选：替换图标（icns）。

## 需要你提供的文件
- `templates/windows/base.exe`
- `templates/macos/Base.app`

可选：我可以在你的 Windows 机器上为你编译 `base.exe`，或提供一个轻量壳应用项目用于产出。

