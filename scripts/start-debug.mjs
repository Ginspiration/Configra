import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIRST_DEBUG_PORT = 5173;
const LAST_DEBUG_PORT = 5273;
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, '..');
const debugExecutable = join(repoDir, 'src-tauri', 'target', 'debug', 'configra.exe');
const launcherKey = createHash('sha256')
  .update(repoDir.toLocaleLowerCase('en-US'))
  .digest('hex')
  .slice(0, 16);
const startupLockPath = join(tmpdir(), `configra-debug-${launcherKey}.lock`);
const dryRun = process.argv.includes('--dry-run');
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const waitForChild = (child) =>
  new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => {
      if (signal) {
        rejectExit(new Error(`Debug process stopped by ${signal}.`));
      } else {
        resolveExit(code ?? 1);
      }
    });
  });

const debugExecutableIsRunning = () => {
  if (process.platform !== 'win32' || !existsSync(debugExecutable)) return false;
  const escapedPath = debugExecutable.replaceAll("'", "''");
  const command = [
    `$target = '${escapedPath}'`,
    "$match = Get-Process -Name 'configra' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target } | Select-Object -First 1",
    'if ($match) { exit 0 } else { exit 1 }',
  ].join('; ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    { stdio: 'ignore', windowsHide: true },
  );
  return result.status === 0;
};

const launchAdditionalInstance = async () => {
  console.log('[configra-debug] Reusing the active ConfigraDev debug server.');
  const child = spawn(debugExecutable, [], {
    cwd: join(repoDir, 'src-tauri'),
    env: process.env,
    stdio: 'inherit',
  });
  const exitCode = await waitForChild(child);
  if (exitCode !== 0) process.exitCode = exitCode;
};

const processIsRunning = (processId) => {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

const readStartupLockOwner = () => {
  try {
    const value = JSON.parse(readFileSync(startupLockPath, 'utf8'));
    return typeof value.processId === 'number' ? value.processId : undefined;
  } catch {
    return undefined;
  }
};

const tryAcquireStartupLock = () => {
  try {
    writeFileSync(
      startupLockPath,
      `${JSON.stringify({ processId: process.pid, repoDir })}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    return true;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
  }

  const owner = readStartupLockOwner();
  if (processIsRunning(owner)) return false;
  rmSync(startupLockPath, { force: true });
  return tryAcquireStartupLock();
};

const releaseStartupLock = () => {
  if (readStartupLockOwner() === process.pid) rmSync(startupLockPath, { force: true });
};

const waitForPrimaryOrAcquireLock = async () => {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (debugExecutableIsRunning()) return false;
    if (tryAcquireStartupLock()) return true;
    await delay(250);
  }
  throw new Error('Timed out waiting for the first ConfigraDev debug instance to start.');
};

const canListen = (host, port) =>
  new Promise((resolveAvailability) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolveAvailability(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolveAvailability(true));
    });
  });

const portIsAvailable = async (port) => {
  for (const host of LOOPBACK_HOSTS) {
    if (!(await canListen(host, port))) return false;
  }
  return true;
};

const chooseDebugPort = async () => {
  for (let port = FIRST_DEBUG_PORT; port <= LAST_DEBUG_PORT; port += 1) {
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`No free debug port is available from ${FIRST_DEBUG_PORT} to ${LAST_DEBUG_PORT}.`);
};

const run = async () => {
  if (!dryRun && debugExecutableIsRunning()) {
    await launchAdditionalInstance();
    return;
  }

  const ownsStartupLock = dryRun ? false : await waitForPrimaryOrAcquireLock();
  if (!dryRun && !ownsStartupLock) {
    await launchAdditionalInstance();
    return;
  }

  try {
    const port = await chooseDebugPort();
    const override = {
      build: {
        devUrl: `http://127.0.0.1:${port}`,
        beforeDevCommand: `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
      },
    };

    console.log(`[configra-debug] Selected frontend port ${port}.`);
    if (dryRun) {
      console.log(JSON.stringify(override, null, 2));
      return;
    }

    const tauriCli = join(repoDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
    if (!existsSync(tauriCli)) {
      throw new Error('Tauri CLI is missing. Run npm install before starting Configra.');
    }

    const overridePath = join(
      tmpdir(),
      `configra-tauri-dev-${process.pid}-${Date.now()}.json`,
    );
    writeFileSync(overridePath, `${JSON.stringify(override, null, 2)}\n`, 'utf8');

    try {
      const child = spawn(process.execPath, [tauriCli, 'dev', '--config', overridePath], {
        cwd: repoDir,
        env: process.env,
        stdio: 'inherit',
      });
      const exitCode = await waitForChild(child);
      if (exitCode !== 0) process.exitCode = exitCode;
    } finally {
      rmSync(overridePath, { force: true });
    }
  } finally {
    if (ownsStartupLock) releaseStartupLock();
  }
};

run().catch((error) => {
  console.error(`[configra-debug] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
