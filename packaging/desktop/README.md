# DSH BOT

DSH BOT 是 BotHarness 的 Electron 桌面应用。安装包内含 DSH CLI 和
`@botharness/tobs@1.7.0`，Host 使用 Electron 自带的 Node.js。配置、凭据和插件数据
保存在应用数据目录的 `host-home` 中。可在 DSH 界面配置凭据，也可从启动应用的环境
传入 `DEEPSEEK_API_KEY`。Host 日志位于同一应用数据目录的 `host.log`。

## 本机构建

在 Apple Silicon Mac 上使用 Node.js 24 和 pnpm 11.28.5。构建时需要访问 npm registry
及 Electron 和 electron-builder 的下载源。

```bash
pnpm install
node scripts/prepare-runtime.mjs
pnpm build:mac
```

`prepare-runtime` 将已发布的依赖以生产模式装入 `build/runtime`。DSH 选用 Tobs
已验证的 `0.2.2-rc.1`。打包后的应用可以直接启动 Host。

## 下载安装

从 GitHub Actions 的 **Build installers** 下载对应平台的 artifact 并解压。

- **macOS（Apple Silicon）** 打开 `DSH BOT-<version>-arm64.dmg`，把 `DSH BOT.app` 拖到
  `应用程序`，再双击打开。构建使用 ad hoc 签名。跨机器下载时，macOS 可能要求在
  「系统设置 → 隐私与安全性」中批准打开可信来源的副本。
- **Windows（x64）** 双击 NSIS 安装程序，按提示安装，然后从开始菜单打开 DSH BOT。
- **Linux（x64）** 给下载的 AppImage 添加执行权限（`chmod +x *.AppImage`），然后运行它。

## macOS 验收

```bash
open "/Applications/DSH BOT.app"
sleep 45
lsof -nP -iTCP:32080 -sTCP:LISTEN
```

确认窗口显示 BotHarness、端口监听在 `127.0.0.1`。按 Cmd+Q，重新运行
`lsof -nP -iTCP:32080 -sTCP:LISTEN`，确认无输出。验收前确保没有其他应用使用
32080。日常运行中遇到端口占用时，应用会尝试下一个可用端口。

```bash
du -sh build/runtime
stat -f '%z bytes %N' dist/*.dmg
```
