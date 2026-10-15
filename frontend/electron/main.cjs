const { app, BrowserWindow, ipcMain, desktopCapturer, session, Menu, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const dgram = require('dgram');
const { spawn } = require('child_process');
const http = require('http');

// Expose real local LAN IP addresses in WebRTC ICE candidates (disable mDNS IP anonymization)
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('enable-webrtc-hide-local-ips-with-mdns', 'false');

let mainWindow = null;
let backendProcess = null;
let lastBackendError = null;
const backendLogs = [];

// ==============================================================================
// LAN Peer Discovery via UDP Broadcast (Port 50820) + HTTP Subnet Scanning
// ==============================================================================
const LAN_DISCOVERY_PORT = 50820;
let udpSocket = null;
let myDeviceId = null;
let myDeviceName = null;
let lanBroadcastTimer = null;
let lanScanTimer = null;

function getLocalNetworkIps() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name in ifaces) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        ips.push(net.address);
      }
    }
  }

  // Prioritize typical home/office LAN subnets (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  ips.sort((a, b) => {
    const score = (ip) => {
      if (ip.startsWith('192.168.')) return 3;
      if (ip.startsWith('10.')) return 2;
      if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return 1;
      return 0;
    };
    return score(b) - score(a);
  });

  return ips.length > 0 ? ips : ['127.0.0.1'];
}

function initLanDiscovery() {
  try {
    udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    udpSocket.on('error', (err) => {
      console.warn('[UDP Discovery] Socket error:', err.message);
    });

    udpSocket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data && data.type === 'anydesk-lan-presence' && data.deviceId) {
          // Ignore our own broadcast packets
          if (myDeviceId && data.deviceId === myDeviceId) return;

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('lan:discovered-device', {
              deviceId: data.deviceId,
              deviceName: data.deviceName || 'Remote LAN PC',
              ip: rinfo.address,
              port: data.port || 5082,
              lastSeen: Date.now()
            });
          }
        }
      } catch {}
    });

    udpSocket.bind(LAN_DISCOVERY_PORT, () => {
      try {
        udpSocket.setBroadcast(true);
        console.log(`[UDP Discovery] Listening and broadcasting on UDP port ${LAN_DISCOVERY_PORT}`);
      } catch (e) {
        console.warn('[UDP Discovery] Could not setBroadcast:', e.message);
      }
    });
  } catch (err) {
    console.warn('[UDP Discovery] Init exception:', err.message);
  }
}

function broadcastPresence(deviceId, deviceName) {
  myDeviceId = deviceId;
  myDeviceName = deviceName;
  if (!udpSocket) return;

  const packet = Buffer.from(
    JSON.stringify({
      type: 'anydesk-lan-presence',
      deviceId,
      deviceName,
      port: 5082
    })
  );

  const broadcastTargets = ['255.255.255.255'];
  const ips = getLocalNetworkIps();
  for (const ip of ips) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      broadcastTargets.push(`${parts[0]}.${parts[1]}.${parts[2]}.255`);
    }
  }

  for (const target of broadcastTargets) {
    try {
      udpSocket.send(packet, 0, packet.length, LAN_DISCOVERY_PORT, target, () => {});
    } catch {}
  }
}

async function scanSubnetForAnyDesk() {
  const ips = getLocalNetworkIps();
  if (!ips || ips.length === 0 || ips[0] === '127.0.0.1') return [];

  const localIp = ips[0];
  const parts = localIp.split('.');
  if (parts.length !== 4) return [];
  const base = `${parts[0]}.${parts[1]}.${parts[2]}.`;

  const checks = [];

  for (let i = 1; i <= 254; i++) {
    const targetIp = `${base}${i}`;
    checks.push(
      new Promise((resolve) => {
        const req = http.get(
          {
            hostname: targetIp,
            port: 5082,
            path: '/api/devices',
            timeout: 380
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              try {
                const devs = JSON.parse(data);
                if (Array.isArray(devs) && devs.length > 0) {
                  resolve({ ip: targetIp, devices: devs });
                  return;
                }
              } catch {}
              resolve(null);
            });
          }
        );
        req.on('error', () => resolve(null));
        req.on('timeout', () => {
          req.destroy();
          resolve(null);
        });
      })
    );
  }

  const responses = await Promise.all(checks);
  const foundDevices = [];

  for (const r of responses) {
    if (r && r.devices) {
      for (const d of r.devices) {
        if (d.isOnline && d.deviceId && (!myDeviceId || d.deviceId !== myDeviceId)) {
          const deviceObj = {
            deviceId: d.deviceId,
            deviceName: d.deviceName || 'Remote LAN PC',
            ip: r.ip,
            port: 5082,
            lastSeen: Date.now()
          };
          foundDevices.push(deviceObj);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('lan:discovered-device', deviceObj);
          }
        }
      }
    }
  }

  return foundDevices;
}

ipcMain.on('lan:broadcast-presence', (event, info) => {
  if (info && info.deviceId) {
    broadcastPresence(info.deviceId, info.deviceName);
    if (!lanBroadcastTimer) {
      lanBroadcastTimer = setInterval(() => {
        if (myDeviceId) broadcastPresence(myDeviceId, myDeviceName);
      }, 3000);
    }
  }
});

ipcMain.handle('lan:scan-subnet', async () => {
  return await scanSubnetForAnyDesk();
});

// ==============================================================================
// Backend Service Management (.NET Kestrel on Port 5082)
// ==============================================================================
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

  // Allow F12 or Ctrl+Shift+I to toggle Chrome Developer Tools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`[Renderer] ${message}`);
  });

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

// ==============================================================================
// IPC Handlers
// ==============================================================================
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
    const types = (opts && opts.types) ? opts.types : ['screen'];
    const sources = await desktopCapturer.getSources({
      types: types,
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true
    });

    return sources.map((source) => ({
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

let activeDisplayBounds = null;

ipcMain.on('session:set-active-display', (event, sourceId) => {
  try {
    if (!sourceId) {
      activeDisplayBounds = null;
      return;
    }
    const displays = screen.getAllDisplays();
    let matchedDisplay = displays.find((d) => sourceId.includes(d.id.toString()));
    if (!matchedDisplay) {
      const parts = sourceId.split(':');
      if (parts.length >= 2) {
        const idx = parseInt(parts[1], 10);
        if (!isNaN(idx) && displays[idx]) {
          matchedDisplay = displays[idx];
        }
      }
    }
    if (matchedDisplay) {
      activeDisplayBounds = matchedDisplay.bounds;
      console.log('[NativeInput] Set active display bounds:', activeDisplayBounds);
    } else {
      activeDisplayBounds = null;
    }
  } catch (e) {
    console.warn('[NativeInput] Error setting active display:', e);
  }
});

ipcMain.handle('system:get-info', () => {
  const allIps = getLocalNetworkIps();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    cpus: os.cpus().length,
    totalMem: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + ' GB',
    localIp: allIps[0],
    allIps: allIps
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

// ==============================================================================
// Win32 Native Hardware Input Simulation (Mouse & Keyboard) via koffi
// ==============================================================================
let win32Input = null;
try {
  if (process.platform === 'win32') {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)');
    const mouse_event = user32.func('void __stdcall mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr_t dwExtraInfo)');
    const keybd_event = user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)');
    const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)');

    win32Input = {
      SetCursorPos,
      mouse_event,
      keybd_event,
      GetSystemMetrics
    };
    console.log('[NativeInput] Initialized Win32 input simulation via user32.dll');
  }
} catch (err) {
  console.warn('[NativeInput] Failed to load koffi/user32 for native input:', err);
}

ipcMain.on('system:simulate-input', (event, input) => {
  if (!win32Input || !input) return;

  try {
    const normX = typeof input.normalizedX === 'number' ? input.normalizedX : (input.NormalizedX || 0);
    const normY = typeof input.normalizedY === 'number' ? input.normalizedY : (input.NormalizedY || 0);

    let targetX, targetY, screenWidth, screenHeight;
    if (activeDisplayBounds) {
      screenWidth = activeDisplayBounds.width;
      screenHeight = activeDisplayBounds.height;
      targetX = Math.round(activeDisplayBounds.x + normX * activeDisplayBounds.width);
      targetY = Math.round(activeDisplayBounds.y + normY * activeDisplayBounds.height);
    } else {
      screenWidth = win32Input.GetSystemMetrics(0) || 1920;
      screenHeight = win32Input.GetSystemMetrics(1) || 1080;
      targetX = Math.max(0, Math.min(screenWidth - 1, Math.round(normX * screenWidth)));
      targetY = Math.max(0, Math.min(screenHeight - 1, Math.round(normY * screenHeight)));
    }

    const type = (input.type || input.Type || '').toLowerCase();
    const button = typeof input.button === 'number' ? input.button : (input.Button || 0);

    const MOUSEEVENTF_MOVE = 0x0001;
    const MOUSEEVENTF_LEFTDOWN = 0x0002;
    const MOUSEEVENTF_LEFTUP = 0x0004;
    const MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const MOUSEEVENTF_RIGHTUP = 0x0010;
    const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const MOUSEEVENTF_MIDDLEUP = 0x0040;
    const MOUSEEVENTF_WHEEL = 0x0800;
    const MOUSEEVENTF_ABSOLUTE = 0x8000;
    const KEYEVENTF_KEYUP = 0x0002;

    const absX = Math.round((targetX * 65535) / Math.max(1, screenWidth - 1));
    const absY = Math.round((targetY * 65535) / Math.max(1, screenHeight - 1));

    switch (type) {
      case 'mousemove':
        win32Input.SetCursorPos(targetX, targetY);
        win32Input.mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        break;

      case 'mousedown':
        win32Input.SetCursorPos(targetX, targetY);
        win32Input.mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        if (button === 0) win32Input.mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        else if (button === 2) win32Input.mouse_event(MOUSEEVENTF_RIGHTDOWN | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        else if (button === 1) win32Input.mouse_event(MOUSEEVENTF_MIDDLEDOWN | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        break;

      case 'mouseup':
        win32Input.SetCursorPos(targetX, targetY);
        win32Input.mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        if (button === 0) win32Input.mouse_event(MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        else if (button === 2) win32Input.mouse_event(MOUSEEVENTF_RIGHTUP | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        else if (button === 1) win32Input.mouse_event(MOUSEEVENTF_MIDDLEUP | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        break;

      case 'click':
        win32Input.SetCursorPos(targetX, targetY);
        win32Input.mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        if (button === 0) {
          win32Input.mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
          win32Input.mouse_event(MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        } else if (button === 2) {
          win32Input.mouse_event(MOUSEEVENTF_RIGHTDOWN | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
          win32Input.mouse_event(MOUSEEVENTF_RIGHTUP | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
        }
        break;

      case 'wheel': {
        const delta = input.deltaY || input.DeltaY || 0;
        const scroll = delta > 0 ? -120 : 120;
        win32Input.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, scroll, 0);
        break;
      }

      case 'keydown':
      case 'keyup': {
        const isUp = type === 'keyup';
        const flags = isUp ? KEYEVENTF_KEYUP : 0;
        let vk = input.keyCode || input.KeyCode;
        if (!vk && input.key) {
          vk = input.key.length === 1 ? input.key.toUpperCase().charCodeAt(0) : 0;
        }
        if (vk > 0) {
          win32Input.keybd_event(vk, 0, flags, 0);
        }
        break;
      }

      case 'specialkey': {
        const sKey = (input.specialKey || input.SpecialKey || '').toLowerCase();
        if (sKey === 'escape') {
          win32Input.keybd_event(0x1B, 0, 0, 0);
          win32Input.keybd_event(0x1B, 0, KEYEVENTF_KEYUP, 0);
        } else if (sKey === 'alttab') {
          win32Input.keybd_event(0x12, 0, 0, 0); // Alt down
          win32Input.keybd_event(0x09, 0, 0, 0); // Tab down
          win32Input.keybd_event(0x09, 0, KEYEVENTF_KEYUP, 0);
          win32Input.keybd_event(0x12, 0, KEYEVENTF_KEYUP, 0);
        } else if (sKey === 'win' || sKey === 'windows') {
          win32Input.keybd_event(0x5B, 0, 0, 0);
          win32Input.keybd_event(0x5B, 0, KEYEVENTF_KEYUP, 0);
        } else if (sKey === 'ctrlaltdel' || sKey === 'taskmgr') {
          // Send Ctrl+Shift+Esc to invoke Task Manager
          win32Input.keybd_event(0x11, 0, 0, 0);
          win32Input.keybd_event(0x10, 0, 0, 0);
          win32Input.keybd_event(0x1B, 0, 0, 0);
          win32Input.keybd_event(0x1B, 0, KEYEVENTF_KEYUP, 0);
          win32Input.keybd_event(0x10, 0, KEYEVENTF_KEYUP, 0);
          win32Input.keybd_event(0x11, 0, KEYEVENTF_KEYUP, 0);
        }
        break;
      }
    }
  } catch (err) {
    console.error('[NativeInput] Error executing input simulation:', err);
  }
});

app.whenReady().then(async () => {
  // Automatically handle getDisplayMedia requests with primary screen
  if (session.defaultSession) {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        const primary = sources.find((s) => s.id.startsWith('screen')) || sources[0];
        if (primary) {
          callback({ video: primary });
        } else {
          callback(null);
        }
      } catch (err) {
        console.error('[DisplayMedia] Error in display media handler:', err);
        callback(null);
      }
    });
  }

  ensureBackendRunning();
  initLanDiscovery();
  createWindow();

  // Initial subnet sweep after 1.5 seconds, then every 10 seconds
  setTimeout(() => {
    scanSubnetForAnyDesk();
    lanScanTimer = setInterval(scanSubnetForAnyDesk, 10000);
  }, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (lanBroadcastTimer) {
    clearInterval(lanBroadcastTimer);
    lanBroadcastTimer = null;
  }
  if (lanScanTimer) {
    clearInterval(lanScanTimer);
    lanScanTimer = null;
  }
  if (udpSocket) {
    try {
      udpSocket.close();
    } catch {}
    udpSocket = null;
  }
  if (backendProcess) {
    console.log('[Launcher] Stopping background service...');
    try {
      backendProcess.kill();
    } catch {}
    backendProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
