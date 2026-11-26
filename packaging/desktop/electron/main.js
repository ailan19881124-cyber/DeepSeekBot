const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { cp, mkdir, mkdtemp, rename, rm, stat } = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { available, findPort, loopback } = require('./ports');

const urlPattern = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=[A-Za-z0-9_.~%-]+/g;
const startup = new AbortController();
let window;
let origin;
let host;
let logPath;
let timeout;
let quitting = false;
let shutdownComplete = false;

function showPage(message, detail = '') {
  if (!window || window.isDestroyed()) return;
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<style>:root{color-scheme:light dark}body{font:16px system-ui;margin:3rem}p{overflow-wrap:anywhere}</style>
<title>DSH BOT</title><h1>${escape(message)}</h1><p>${escape(detail)}</p></html>`;
  void window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
}

function showError(message) {
  clearTimeout(timeout);
  if (!quitting) showPage('BotHarness 启动失败', `${message} 日志文件位于 ${logPath}`);
}

function log(line) {
  appendFileSync(logPath, line.replace(urlPattern, '[本机启动地址已隐藏]') + '\n', { mode: 0o600 });
}

async function initializeProfile(home, template) {
  const profiles = path.join(home, 'profiles');
  const profile = path.join(profiles, 'app');
  try {
    await stat(profile);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await mkdir(profiles, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(path.join(profiles, '.app-'));
  try {
    await cp(template, staging, { recursive: true });
    await rename(staging, profile);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function stopHost() {
  const child = host;
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function launch(bin, home, port) {
  const child = spawn(process.execPath, [
    bin, '--profile', 'app', '--port', String(port), '--no-open', '--host', loopback,
  ], {
    cwd: home,
    env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  host = child;
  let ready = false;
  let addressInUse = false;
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream, crlfDelay: Infinity }).on('line', line => {
      try {
        log(line);
      } catch (error) {
        startup.abort();
        void stopHost();
        showError(error.message);
        return;
      }
      addressInUse ||= /EADDRINUSE|address already in use/i.test(line);
      if (ready || stream !== child.stdout || startup.signal.aborted) return;
      const match = [...line.matchAll(urlPattern)].find(entry => Number(entry[1]) === port);
      if (!match) return;
      ready = true;
      clearTimeout(timeout);
      origin = new URL(match[0]).origin;
      void window.loadURL(match[0]).catch(() => showError('无法加载 BotHarness 页面。'));
    });
  }

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve(signal ?? code));
  });
  host = undefined;
  if (startup.signal.aborted) return false;
  if (!ready && (addressInUse || !(await available(port)))) return true;
  throw new Error(`Host 已退出（${result}）。`);
}

async function start() {
  const userData = app.getPath('userData');
  logPath = path.join(userData, 'host.log');
  const home = path.join(userData, 'host-home');
  const runtime = app.isPackaged
    ? path.join(process.resourcesPath, 'runtime')
    : path.join(__dirname, '../build/runtime');
  const bin = path.join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js');

  window = new BrowserWindow({
    width: 1100,
    height: 780,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const event of ['will-navigate', 'will-redirect']) {
    window.webContents.on(event, (navigation, url) => {
      if (!origin || new URL(url).origin !== origin) navigation.preventDefault();
    });
  }
  showPage('正在启动 BotHarness…');
  log('正在启动 BotHarness…');

  timeout = setTimeout(() => {
    startup.abort();
    void stopHost();
    showError('90 秒内未收到 Host 启动地址。');
  }, 90_000);

  await stat(bin);
  await initializeProfile(home, path.join(runtime, 'profile'));

  let first = 32080;
  while (!startup.signal.aborted) {
    const port = await findPort(first, startup.signal);
    startup.signal.throwIfAborted();
    if (!(await launch(bin, home, port))) break;
    first = port + 1;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    startup.abort();
    clearTimeout(timeout);
    void stopHost().finally(() => {
      shutdownComplete = true;
      app.quit();
    });
  });
  void app.whenReady().then(start).catch(error => {
    if (!startup.signal.aborted) showError(error.message);
  });
}
