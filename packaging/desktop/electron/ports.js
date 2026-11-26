const { execFile } = require('node:child_process');
const { createServer } = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');

const exec = promisify(execFile);
const loopback = '127.0.0.1';

async function output(file, args) {
  try {
    return (await exec(file, args, { timeout: 4000, windowsHide: true })).stdout.trim();
  } catch {
    return '';
  }
}

async function orphanListeners(port) {
  if (process.platform === 'win32') {
    const script = `
      Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
          $child = Get-CimInstance Win32_Process -Filter "ProcessId=$_"
          if ($child.CommandLine -match '[/\\\\]@deepseek-ai[/\\\\]dsh[/\\\\]lib[/\\\\]bin\\.js(?:"|\\s)') {
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($child.ParentProcessId)"
            if (!$parent -or $parent.CreationDate -gt $child.CreationDate) { $_ }
          }
        }`;
    const ids = await output('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return ids.split(/\s+/).map(Number).filter(pid => Number.isInteger(pid) && pid > 1);
  }

  const listeners = await output(process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof', [
    '-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t',
  ]);
  const sockets = !listeners && process.platform === 'linux'
    ? await output('ss', ['-Hlnpt', 'sport', '=', ':' + port])
    : '';
  const ids = listeners ? listeners.split(/\s+/) : [...sockets.matchAll(/pid=(\d+)/g)].map(match => match[1]);
  const orphans = await Promise.all([...new Set(ids)].filter(id => /^\d+$/.test(id)).map(async id => {
    const details = await output('ps', ['-ww', '-p', id, '-o', 'ppid=,command=']);
    return /^1\s+.*\/@deepseek-ai\/dsh\/lib\/bin\.js(?:\s|$)/.test(details) ? Number(id) : 0;
  }));
  return orphans.filter(pid => pid > 1);
}

function available(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
      else reject(error);
    });
    server.listen({ host: loopback, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function findPort(first, signal) {
  for (let port = first; port <= 65535; port++) {
    signal.throwIfAborted();
    if (await available(port)) return port;
    const orphans = await orphanListeners(port);
    signal.throwIfAborted();
    for (const pid of orphans) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error;
      }
    }
    for (let attempt = 0; orphans.length && attempt < 10; attempt++) {
      await delay(50, undefined, { signal });
      if (await available(port)) return port;
    }
  }
  throw new Error('没有可用的本机 TCP 端口。');
}

module.exports = { available, findPort, loopback };
