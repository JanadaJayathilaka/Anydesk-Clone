const { app, BrowserWindow, ipcMain, desktopCapturer, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const http = require('http');

let mainWindow = null;
let backendProcess = null;
let lastBackendError = null;
const backendLogs = [];

let tunnelProcess = null;
let publicTunnelUrl = null;

function findCloudflaredExecutable() {
  const possiblePaths = [
    path.join(process.resourcesPath, 'tools', 'cloudflared.exe'),
    path.join(path.dirname(process.execPath), 'resources', 'tools', 'cloudflared.exe'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'tools', 'cloudflared.exe'),
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'resources', 'tools', 'cloudflared.exe') : null,
    path.join(__dirname, '../../tools/cloudflared.exe'),
    path.join(__dirname, '../tools/cloudflared.exe'),
    path.join(process.cwd(), 'tools', 'cloudflared.exe'),
    path.join(app.getAppPath(), '..', 'tools', 'cloudflared.exe'),
    path.join(app.getAppPath(), '..', '..', 'tools', 'cloudflared.exe')
  ].filter(Boolean);

  for (const p of possiblePaths) {
    try {
      const resolved = path.resolve(p);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    } catch {}
  }
  return null;
}

function startCloudflareTunnel() {
  if (tunnelProcess && !tunnelProcess.killed && publicTunnelUrl) {
    return Promise.resolve({ success: true, url: publicTunnelUrl });
  }

  const exePath = findCloudflaredExecutable();
  if (!exePath) {
    console.warn('[Tunnel] cloudflared.exe not found on disk');
    return Promise.resolve({ success: false, error: 'cloudflared.exe not found' });
  }

  console.log('[Tunnel] Starting Cloudflare Quick Tunnel from:', exePath);

  return new Promise((resolve) => {
    let resolved = false;

    try {
      tunnelProcess = spawn(exePath, ['tunnel', '--url', 'http://localhost:5082'], {
        windowsHide: true,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const onOutput = (d) => {
        const text = d.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !publicTunnelUrl) {
          publicTunnelUrl = match[0];
          console.log('[Tunnel] Public Internet URL assigned:', publicTunnelUrl);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tunnel:url-ready', publicTunnelUrl);
          }
          if (!resolved) {
            resolved = true;
            resolve({ success: true, url: publicTunnelUrl });
          }
        }
      };

      tunnelProcess.stdout.on('data', onOutput);
      tunnelProcess.stderr.on('data', onOutput);

      tunnelProcess.on('error', (err) => {
        console.error('[Tunnel Error]:', err);
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: err.message });
        }
      });

      tunnelProcess.on('exit', (code) => {
        console.log('[Tunnel Exited] code:', code);
        tunnelProcess = null;
        publicTunnelUrl = null;
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: 'Tunnel process exited' });
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ success: !!publicTunnelUrl, url: publicTunnelUrl });
        }
      }, 15000);
    } catch (e) {
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: e.message });
      }
    }
  });
}

function checkBackendAlive(timeoutMs = 600) {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:5082/health', { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function findBackendExecutable() {
  const possiblePaths = [
    // 1. Packaged resources folder (installed app or portable temp)
    path.join(process.resourcesPath, 'backend', 'AnyDeskClone.Backend.exe'),
    path.join(path.dirname(process.execPath), 'resources', 'backend', 'AnyDeskClone.Backend.exe'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'AnyDeskClone.Backend.exe'),
    // 2. Portable executable directory
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'resources', 'backend', 'AnyDeskClone.Backend.exe') : null,
    // 3. Dev / unpackaged paths
    path.join(__dirname, '../../backend-dist/AnyDeskClone.Backend.exe'),
    path.join(__dirname, '../backend-dist/AnyDeskClone.Backend.exe'),
    path.join(__dirname, '../../installer-dist/win-unpacked/resources/backend/AnyDeskClone.Backend.exe'),
    path.join(process.cwd(), 'backend-dist', 'AnyDeskClone.Backend.exe'),
    path.join(process.cwd(), 'installer-dist', 'win-unpacked', 'resources', 'backend', 'AnyDeskClone.Backend.exe'),
    path.join(app.getAppPath(), '..', 'backend', 'AnyDeskClone.Backend.exe'),
    path.join(app.getAppPath(), '..', '..', 'backend-dist', 'AnyDeskClone.Backend.exe')
  ].filter(Boolean);

  for (const p of possiblePaths) {
    try {
      const resolved = path.resolve(p);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    } catch {}
  }
  return null;
}

function launchBackend() {
  if (backendProcess && !backendProcess.killed) {
    return { success: true, message: 'Backend process already active', pid: backendProcess.pid };
  }

  const exePath = findBackendExecutable();
  if (!exePath) {
    lastBackendError = 'AnyDeskClone.Backend.exe not found on disk';
    console.error('[Launcher]', lastBackendError);
    return { success: false, error: lastBackendError };
  }

  console.log('[Launcher] Launching backend from:', exePath);
  try {
    const backendDir = path.dirname(exePath);

    // Prepare log file in userData
    let logStream = null;
    try {
      const logDir = app.getPath('userData');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      logStream = fs.createWriteStream(path.join(logDir, 'backend.log'), { flags: 'a' });
    } catch (e) {
      console.warn('Could not initialize backend log stream:', e);
    }

    backendProcess = spawn(exePath, ['--urls', 'http://0.0.0.0:5082'], {
      cwd: backendDir,
      windowsHide: true,
      detached: false,
      env: {
        ...process.env,
        ASPNETCORE_URLS: 'http://0.0.0.0:5082',
        ASPNETCORE_ENVIRONMENT: 'Production',
        DOTNET_CLI_TELEMETRY_OPTOUT: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (logStream) {
      backendProcess.stdout.pipe(logStream);
      backendProcess.stderr.pipe(logStream);
    }

    backendProcess.stdout.on('data', (d) => {
      const text = d.toString().trim();
      backendLogs.push(text);
      if (backendLogs.length > 50) backendLogs.shift();
      console.log(`[Backend] ${text}`);
    });

    backendProcess.stderr.on('data', (d) => {
      const text = d.toString().trim();
      backendLogs.push(text);
      if (backendLogs.length > 50) backendLogs.shift();
      console.error(`[Backend ERR] ${text}`);
      lastBackendError = text;
    });

    backendProcess.on('error', (err) => {
      console.error('[Backend Spawn Error]:', err);
      lastBackendError = err.message;
    });

    backendProcess.on('exit', (code, signal) => {
      console.log(`[Backend Process Exited] code: ${code}, signal: ${signal}`);
      backendProcess = null;
    });

    return { success: true, pid: backendProcess.pid, path: exePath };
  } catch (err) {
    console.error('[Backend Launch Exception]:', err);
    lastBackendError = err.message;
    return { success: false, error: err.message };
  }
}

async function ensureBackendRunning() {
  const isAlreadyAlive = await checkBackendAlive(500);
  if (isAlreadyAlive) {
    return { success: true, message: 'Backend is already running and healthy' };
  }

  const result = launchBackend();
  if (!result.success) {
    return result;
  }

  // Poll for up to 6 seconds for backend to become healthy
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const alive = await checkBackendAlive(300);
    if (alive) {
      return { success: true, pid: backendProcess ? backendProcess.pid : null };
    }
    if (!backendProcess || backendProcess.exitCode !== null) {
      break;
    }
  }

  return { success: true, pid: backendProcess ? backendProcess.pid : null };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0c0e14',
    frame: true,
    title: 'AnyDesk Clone - Remote Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false
    }
  });

  Menu.setApplicationMenu(null);

  const devServerUrl = 'http://localhost:5173';
  const distPath = path.join(__dirname, '../dist/index.html');

  if (app.isPackaged) {
    console.log('[Window] Loading packaged index.html from:', distPath);
    mainWindow.loadFile(distPath);
  } else {
    mainWindow.loadURL(devServerUrl).catch(() => {
      console.log('[Window] Dev server unreachable, falling back to local files:', distPath);
      mainWindow.loadFile(distPath);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('backend:start', async () => {
  return ensureBackendRunning();
});

ipcMain.handle('backend:info', async () => {
  const exePath = findBackendExecutable();
  return {
    isRunning: !!backendProcess && !backendProcess.killed,
    pid: backendProcess ? backendProcess.pid : null,
    executablePath: exePath,
    lastError: lastBackendError,
    logs: backendLogs.slice(-10)
  };
});

ipcMain.handle('desktop-capturer:get-sources', async (event, opts) => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true
    });

    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
      display_id: source.display_id
    }));
  } catch (err) {
    console.error('Error fetching screen sources:', err);
    return [];
  }
});

ipcMain.handle('tunnel:start', async () => {
  return startCloudflareTunnel();
});

ipcMain.handle('tunnel:get-url', async () => {
  return {
    isRunning: !!tunnelProcess && !tunnelProcess.killed,
    url: publicTunnelUrl
  };
});

ipcMain.handle('system:get-info', () => {
  const ifaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  for (const name in ifaces) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
  }
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    cpus: os.cpus().length,
    totalMem: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + ' GB',
    localIp: localIp,
    publicTunnelUrl: publicTunnelUrl
  };
});

ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

app.whenReady().then(async () => {
  // Launch backend service and internet tunnel
  ensureBackendRunning();
  startCloudflareTunnel();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (backendProcess) {
    console.log('[Launcher] Stopping background service...');
    try {
      backendProcess.kill();
    } catch {}
    backendProcess = null;
  }
  if (tunnelProcess) {
    console.log('[Launcher] Stopping Cloudflare tunnel...');
    try {
      tunnelProcess.kill();
    } catch {}
    tunnelProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
