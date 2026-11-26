# DSH BOT 跨平台独立 App —— 规格 v2（Electron）

## 背景

v1 已经有一个能跑的 Swift 壳（`~/Documents/dshbot/app/`），但它只能 macOS、且运行时引用本机仓库与 `/tmp` 里的 node，换机器/重启就废。现在要：

1. **自包含**：`.app` 内部带运行时，换台 Mac 双击可用
2. **跨平台**：同一套代码出 macOS / Windows / Linux 三个包

## 技术选型（已定，不要改）

- **Electron**（一个代码库三平台），不用 Swift、不用 Tauri
- Host 用 **Electron 自带的 Node** 启动：`ELECTRON_RUN_AS_NODE=1` + `process.execPath`，**不要再带独立的 node 二进制**
- 打包用 **electron-builder**：mac `dmg`(arm64) / win `nsis` / linux `AppImage`
- 三平台构建走 **GitHub Actions matrix**，本机只验证 macOS

## 输出目录

`/Users/willchan/Documents/dshbot/app-electron/`

```
app-electron/
  package.json
  electron/main.js          # 主进程：起 Host、读 token、开窗口、退出清理
  electron/preload.js       # 如无必要就不要；需要时最小面
  build/runtime/            # 运行时（见下）
  scripts/prepare-runtime.mjs   # 生成 build/runtime（可重复执行）
  scripts/build.sh          # 本机 macOS 构建
  .github/workflows/build.yml   # 三平台 CI
  README.md
```

## 运行时怎么来（关键）

优先用**已发布包**，避免把 3.2 GB 开发依赖塞进安装包：

- `build/runtime/package.json` 依赖：`@botharness/tobs@1.7.0`（它会带 `deepseekbot` / `@botharness/*`）
- `scripts/prepare-runtime.mjs` 在 `build/runtime` 里跑 `pnpm install --prod --ignore-scripts=false`
- 同时把 `@deepseek-ai/dsh` 的 CLI 入口（`@deepseek-ai/dsh/lib/bin.js`）定位好；它是 tobs 的依赖，装完应在 `build/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js`
- 如果 `--prod` 装不下（缺 peer），退一步用 `pnpm install`（全量），但要在 README 记录实际体积

> 验收时报告 `build/runtime` 的真实体积。

## 启动流程（main.js）

1. `app.getPath('userData')/host-home` 作为 `DSH_HOME`
2. 首次启动：如果 `host-home/profiles/app` 不存在，用 `prepare-runtime` 产出的 profile 模板初始化（模板里 `dsh.profile.bundles` = `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@botharness/tobs`）
3. 起进程：`spawn(process.execPath, [dshBin, '--profile', 'app', '--port', String(port), '--no-open'], { env: { ...process.env, DSH_HOME, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore','pipe','pipe'] })`
4. 从 stdout 解析 `http://127.0.0.1:<port>/?token=...`，`win.loadURL(url)`
5. stdout/stderr 写 `userData/host.log`；90 秒没拿到 URL 就显示错误页（带日志路径）
6. 退出（`before-quit`、窗口关闭）时杀掉子进程；启动时清理孤儿：占着端口的 `dsh/lib/bin.js` 进程
7. 端口冲突自动换下一个（32080→32081…），不用固定端口

## 安全边界

- 只监听 `127.0.0.1`
- 不写死任何 API key；Host 用 `DEEPSEEK_API_KEY` 环境变量或 DSH 凭据
- 插件目录完全在 `userData/host-home`，不读 `~/.dsh`
- 不要在 Windows 版把 `ELECTRON_RUN_AS_NODE` 漏掉（否则会开出第二个窗口）

## 构建与 CI

- `pnpm build:mac` → `dist/DSH BOT-<version>-arm64.dmg`
- `.github/workflows/build.yml`：matrix `macos-14 / ubuntu-22.04 / windows-2022`，各自 `pnpm install` → `prepare-runtime` → `electron-builder --publish never`，上传 artifacts
- Windows/Linux 本地不验证，CI 产出即可；README 说明如何下载安装

## 验收（本机 macOS，必须真跑）

```bash
cd /Users/willchan/Documents/dshbot/app-electron
pnpm install
node scripts/prepare-runtime.mjs
pnpm build:mac
# 挂载 dmg，把 App 拖到 /Applications，然后：
open "/Applications/DSH BOT.app"
sleep 45
lsof -nP -iTCP:32080 -sTCP:LISTEN      # 有监听
# 窗口里能看到 BotHarness 界面；Cmd+Q 退出后：
lsof -nP -iTCP:32080 -sTCP:LISTEN      # 空
```

四项通过才算完成，并把 `build/runtime` 体积、dmg 体积、启动耗时贴回来。

## 不要做

- 不要修改 `~/Documents/dshbot/upstream` 和 `~/Documents/dshbot/app`（v1 Swift 版保留）
- 不要引入除 electron / electron-builder 之外的框架
- 不要提交任何 key、token、证书
- 不要为了跨平台引入 Rust 工具链
