const { app, BrowserWindow, ipcMain, desktopCapturer, session, Menu, screen, clipboard, systemPreferences, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const dgram = require('dgram');
const { spawn } = require('child_process');
const http = require('http');

// Expose real local LAN IP addresses in WebRTC ICE candidates (disable mDNS IP anonymization)
// and prevent Chromium from throttling or pausing WebRTC and input when minimized or occluded
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WebRtcHideLocalIpsWithMdns,IntensiveWakeUpThrottling');
app.commandLine.appendSwitch('enable-webrtc-hide-local-ips-with-mdns', 'false');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_and_private_interfaces');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'WebRTCPeerConnectionWithBlockIceAddresses');

// Prevent Chromium from throttling WebRTC video capture, timers, IPC, and rendering when minimized or in background
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-ipc-flooding-protection');

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

function getAppIconPath() {
  const iconCandidates = [
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '../public/icon.ico'),
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../../public/icon.ico'),
    path.join(__dirname, '../../public/icon.png')
  ];
  for (const candidate of iconCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function createWindow() {
  const appIcon = getAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0c0e14',
    frame: true,
    title: 'AnyDesk - Remote Desktop',
    icon: appIcon || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false
    }
  });

  if (mainWindow.webContents && mainWindow.webContents.setBackgroundThrottling) {
    mainWindow.webContents.setBackgroundThrottling(false);
  }

  if (appIcon && mainWindow.setIcon) {
    try {
      mainWindow.setIcon(appIcon);
    } catch (e) {
      console.warn('[Window] Could not set window icon:', e.message);
    }
  }

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
    // When in development, connect to Vite dev server for real-time HMR
    const loadDevOrFallback = async (retries = 15, delay = 500) => {
      for (let i = 0; i < retries; i++) {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        try {
          await mainWindow.loadURL(devServerUrl);
          console.log('[Window] Connected to live Vite dev server at:', devServerUrl);
          return;
        } catch (err) {
          if (i < retries - 1) {
            console.log(`[Window] Waiting for Vite dev server (${i + 1}/${retries})...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      console.log('[Window] Dev server unreachable after retries, falling back to local files:', distPath);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(distPath);
      }
    };
    loadDevOrFallback();
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

const displayBoundsBySourceId = new Map();

ipcMain.handle('desktop-capturer:get-sources', async (event, opts) => {
  try {
    const types = (opts && opts.types) ? opts.types : ['screen'];
    const sources = await desktopCapturer.getSources({
      types: types,
      thumbnailSize: { width: 160, height: 90 },
      fetchWindowIcons: false
    });

    const screenSources = sources.filter((s) => s.id.startsWith('screen'));
    if (screenSources.length === 0) {
      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
        display_id: source.display_id
      }));
    }

    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    // 1. Sort all displays by physical layout: left-to-right (bounds.x), then top-to-bottom (bounds.y)
    // Matches the physical monitors on the user's desk (e.g. [ 3 ] [ 1 ] [ 2 ] => 1, 2, 3)
    const sortedDisplays = [...displays].sort((a, b) => {
      if (a.bounds.x !== b.bounds.x) return a.bounds.x - b.bounds.x;
      return a.bounds.y - b.bounds.y;
    });

    displayBoundsBySourceId.clear();

    // 2. Track assigned sources so each display gets a unique capture source without duplicates
    const usedSourceIds = new Set();

    // 3. Pair each display with its desktopCapturer source and assign numbers 1, 2, 3... from left to right
    const mappedScreens = sortedDisplays.map((disp, idx) => {
      const displayNumber = idx + 1; // 1 for leftmost, 2 for middle, 3 for rightmost

      // Try exact display_id match first (if supported by platform)
      let matchedSource = screenSources.find(
        (s) => !usedSourceIds.has(s.id) && s.display_id && s.display_id === disp.id.toString()
      );

      // Windows multi-monitor matching: match based on primary vs left vs right
      if (!matchedSource) {
        if (disp.id === primaryDisplay.id) {
          // Center primary display -> Screen 1 in Chromium desktopCapturer (screen:0:0)
          matchedSource = screenSources.find(
            (s) => !usedSourceIds.has(s.id) && (s.name === 'Screen 1' || s.id === 'screen:0:0')
          );
        } else if (disp.bounds.x < primaryDisplay.bounds.x) {
          // Leftmost display (e.g. x: -1536) -> Screen 3 in Chromium desktopCapturer (screen:2:0)
          matchedSource = screenSources.find(
            (s) => !usedSourceIds.has(s.id) && (s.name === 'Screen 3' || s.id === 'screen:2:0')
          );
        } else {
          // Rightmost display (e.g. x: 1920) -> Screen 2 in Chromium desktopCapturer (screen:1:0)
          matchedSource = screenSources.find(
            (s) => !usedSourceIds.has(s.id) && (s.name === 'Screen 2' || s.id === 'screen:1:0')
          );
        }
      }

      // Fallback: pick any unused screen source, or index-based fallback
      if (!matchedSource) {
        matchedSource = screenSources.find((s) => !usedSourceIds.has(s.id)) || screenSources[idx] || screenSources[0];
      }

      if (matchedSource) {
        usedSourceIds.add(matchedSource.id);
        displayBoundsBySourceId.set(matchedSource.id, disp.bounds);
      }

      return {
        id: matchedSource ? matchedSource.id : `screen:${idx}:0`,
        name: `Screen ${displayNumber}`,
        displayNumber: displayNumber,
        thumbnail: matchedSource && matchedSource.thumbnail ? matchedSource.thumbnail.toDataURL() : null,
        display_id: disp.id.toString(),
        bounds: disp.bounds,
        isPrimary: disp.id === primaryDisplay.id,
        x: disp.bounds.x,
        y: disp.bounds.y,
        width: disp.bounds.width,
        height: disp.bounds.height
      };
    });

    const windowSources = sources.filter((s) => !s.id.startsWith('screen')).map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
      display_id: s.display_id
    }));

    return [...mappedScreens, ...windowSources];
  } catch (err) {
    console.error('Error fetching screen sources:', err);
    return [];
  }
});

let activeDisplayBounds = null;
let activeScreenSourceId = null;

ipcMain.handle('session:set-active-display', (event, sourceId) => {
  try {
    activeScreenSourceId = sourceId || null;
    console.log('[NativeInput] Received session:set-active-display:', sourceId);
    if (!sourceId) {
      activeDisplayBounds = null;
      return true;
    }
    if (displayBoundsBySourceId.has(sourceId)) {
      activeDisplayBounds = displayBoundsBySourceId.get(sourceId);
      console.log('[NativeInput] Set active display bounds from mapped cache:', activeDisplayBounds);
      return true;
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
    return true;
  } catch (e) {
    console.warn('[NativeInput] Error setting active display:', e);
    return false;
  }
});

let cursorBroadcastActive = false;
let lastHostCursor = { x: -1, y: -1 };
let lastSimulatedInput = { x: -1, y: -1, time: 0 };

ipcMain.on('session:start-cursor-broadcast', () => {
  cursorBroadcastActive = true;
});

ipcMain.on('session:stop-cursor-broadcast', () => {
  cursorBroadcastActive = false;
});

// Native Clipboard Synchronization
ipcMain.handle('clipboard:read-text', () => {
  try {
    return clipboard.readText();
  } catch (err) {
    return '';
  }
});

ipcMain.on('clipboard:write-text', (_event, text) => {
  try {
    if (typeof text === 'string') {
      clipboard.writeText(text);
    }
  } catch (err) {}
});

setInterval(() => {
  if (!cursorBroadcastActive || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const pt = screen.getCursorScreenPoint();
    const now = Date.now();
    // If the cursor position matches the simulated input position within 150ms,
    // this move was simulated from the remote user, not the host moving their physical mouse
    const isSimulated = (now - lastSimulatedInput.time < 150) &&
      Math.abs(pt.x - lastSimulatedInput.x) <= 4 &&
      Math.abs(pt.y - lastSimulatedInput.y) <= 4;

    if (!isSimulated) {
      if (Math.abs(pt.x - lastHostCursor.x) >= 1 || Math.abs(pt.y - lastHostCursor.y) >= 1) {
        lastHostCursor = pt;
        const bounds = activeDisplayBounds || screen.getPrimaryDisplay().bounds;
        const normX = Math.max(0, Math.min(1, (pt.x - bounds.x) / Math.max(1, bounds.width)));
        const normY = Math.max(0, Math.min(1, (pt.y - bounds.y) / Math.max(1, bounds.height)));
        mainWindow.webContents.send('host:cursor-position', { x: normX, y: normY });
      }
    }
  } catch (e) {}
}, 33);

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

// macOS Screen Recording Permission Helpers
ipcMain.handle('system:get-screen-access-status', async () => {
  if (process.platform === 'darwin' && systemPreferences && systemPreferences.getMediaAccessStatus) {
    try {
      return systemPreferences.getMediaAccessStatus('screen');
    } catch {
      return 'unknown';
    }
  }
  return 'granted';
});

ipcMain.handle('system:open-screen-preferences', async () => {
  if (process.platform === 'darwin' && shell) {
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      return true;
    } catch {
      return false;
    }
  }
  return false;
});

// macOS Accessibility Permission Helpers (Required to simulate mouse/keyboard on Mac)
ipcMain.handle('system:check-accessibility', async () => {
  if (process.platform === 'darwin' && systemPreferences && systemPreferences.isTrustedAccessibilityClient) {
    return systemPreferences.isTrustedAccessibilityClient(true);
  }
  return true;
});

ipcMain.handle('system:open-accessibility-preferences', async () => {
  if (process.platform === 'darwin' && shell) {
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      return true;
    } catch {
      return false;
    }
  }
  return false;
});

// ==============================================================================
// Cross-Platform Native Hardware Input Simulation (Mouse & Keyboard) via koffi
// ==============================================================================
let win32Input = null;
let darwinInput = null;

// DOM keyCode to macOS CGKeyCode map
const DOM_TO_MAC_VIRTUAL_KEY = {
  8: 51,   // Backspace
  9: 48,   // Tab
  13: 36,  // Enter
  27: 53,  // Escape
  32: 49,  // Space
  37: 123, // Left
  38: 126, // Up
  39: 124, // Right
  40: 125, // Down
  45: 114, // Insert / Help
  46: 117, // Delete
  65: 0, 66: 11, 67: 8, 68: 2, 69: 14, 70: 3, 71: 5, 72: 4, 73: 34, 74: 38,
  75: 40, 76: 37, 77: 46, 78: 45, 79: 31, 80: 35, 81: 12, 82: 15, 83: 1,
  84: 17, 85: 32, 86: 9, 87: 13, 88: 7, 89: 16, 90: 6,
  48: 29, 49: 18, 50: 19, 51: 20, 52: 21, 53: 23, 54: 22, 55: 26, 56: 28, 57: 25,
  186: 41, // Semicolon ;
  187: 24, // Equal =
  188: 43, // Comma ,
  189: 27, // Dash / Minus -
  190: 47, // Period .
  191: 44, // Slash /
  192: 50, // Backquote `
  219: 33, // Left bracket [
  220: 42, // Backslash \
  221: 30, // Right bracket ]
  222: 39, // Quote '
  16: 56,  // Shift
  17: 59,  // Control
  18: 58,  // Alt / Option
  91: 55,  // Command Left
  93: 55   // Command Right
};

// DOM KeyboardEvent.code to macOS CGKeyCode map
const CODE_TO_MAC_KEY = {
  'KeyA': 0, 'KeyB': 11, 'KeyC': 8, 'KeyD': 2, 'KeyE': 14, 'KeyF': 3, 'KeyG': 5,
  'KeyH': 4, 'KeyI': 34, 'KeyJ': 38, 'KeyK': 40, 'KeyL': 37, 'KeyM': 46, 'KeyN': 45,
  'KeyO': 31, 'KeyP': 35, 'KeyQ': 12, 'KeyR': 15, 'KeyS': 1, 'KeyT': 17, 'KeyU': 32,
  'KeyV': 9, 'KeyW': 13, 'KeyX': 7, 'KeyY': 16, 'KeyZ': 6,
  'Digit1': 18, 'Digit2': 19, 'Digit3': 20, 'Digit4': 21, 'Digit5': 23,
  'Digit6': 22, 'Digit7': 26, 'Digit8': 28, 'Digit9': 25, 'Digit0': 29,
  'Return': 36, 'Enter': 36, 'Tab': 48, 'Space': 49, 'Backspace': 51, 'Escape': 53,
  'Delete': 117, 'ArrowLeft': 123, 'ArrowRight': 124, 'ArrowDown': 125, 'ArrowUp': 126,
  'Minus': 27, 'Equal': 24, 'BracketLeft': 33, 'BracketRight': 30, 'Backslash': 42,
  'Semicolon': 41, 'Quote': 39, 'Comma': 43, 'Period': 47, 'Slash': 44, 'Backquote': 50,
  'ShiftLeft': 56, 'ShiftRight': 60, 'ControlLeft': 59, 'ControlRight': 62,
  'AltLeft': 58, 'AltRight': 61, 'MetaLeft': 55, 'MetaRight': 55
};

let darwinLeftDown = false;
let darwinRightDown = false;

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
  } else if (process.platform === 'darwin') {
    const koffi = require('koffi');
    let cg = null;
    const pathsToTry = [
      '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics',
      '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices',
      'CoreGraphics'
    ];
    for (const p of pathsToTry) {
      try {
        cg = koffi.load(p);
        if (cg) break;
      } catch {}
    }
    if (!cg) {
      throw new Error('Could not load CoreGraphics library');
    }

    const CGPoint = koffi.struct('CGPoint', {
      x: 'double',
      y: 'double'
    });

    const CGWarpMousePosition = cg.func('int CGWarpMousePosition(CGPoint newCursorPosition)');
    const CGEventCreateMouseEvent = cg.func('void* CGEventCreateMouseEvent(void* source, uint32_t mouseType, CGPoint mouseCursorPosition, uint32_t mouseButton)');
    const CGEventCreateKeyboardEvent = cg.func('void* CGEventCreateKeyboardEvent(void* source, uint16_t virtualKey, bool keyDown)');
    const CGEventCreateScrollWheelEvent = cg.func('void* CGEventCreateScrollWheelEvent(void* source, uint32_t units, uint32_t wheelCount, int32_t wheel1)');
    const CGEventPost = cg.func('void CGEventPost(uint32_t tap, void* event)');
    const CFRelease = cg.func('void CFRelease(void* cf)');

    darwinInput = {
      CGPoint,
      CGWarpMousePosition,
      CGEventCreateMouseEvent,
      CGEventCreateKeyboardEvent,
      CGEventCreateScrollWheelEvent,
      CGEventPost,
      CFRelease
    };
    console.log('[NativeInput] Initialized macOS CoreGraphics input simulation via koffi');
  }
} catch (err) {
  console.warn('[NativeInput] Failed to load native input simulation library:', err);
}

ipcMain.on('system:simulate-input', (event, input) => {
  if (!input) return;

  try {
    const normX = typeof input.normalizedX === 'number' ? input.normalizedX : (input.NormalizedX || 0);
    const normY = typeof input.normalizedY === 'number' ? input.normalizedY : (input.NormalizedY || 0);

    const primaryBounds = screen.getPrimaryDisplay().bounds;
    const bounds = activeDisplayBounds || primaryBounds;
    const screenWidth = bounds.width;
    const screenHeight = bounds.height;
    const targetX = Math.round(bounds.x + normX * screenWidth);
    const targetY = Math.round(bounds.y + normY * screenHeight);

    lastSimulatedInput = { x: targetX, y: targetY, time: Date.now() };

    const type = (input.type || input.Type || '').toLowerCase();
    const button = typeof input.button === 'number' ? input.button : (input.Button || 0);

    // -------------------------------------------------------------
    // Windows Native Input Simulation (Untouched)
    // -------------------------------------------------------------
    if (process.platform === 'win32' && win32Input) {
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
            win32Input.keybd_event(0x12, 0, 0, 0);
            win32Input.keybd_event(0x09, 0, 0, 0);
            win32Input.keybd_event(0x09, 0, KEYEVENTF_KEYUP, 0);
            win32Input.keybd_event(0x12, 0, KEYEVENTF_KEYUP, 0);
          } else if (sKey === 'win' || sKey === 'windows') {
            win32Input.keybd_event(0x5B, 0, 0, 0);
            win32Input.keybd_event(0x5B, 0, KEYEVENTF_KEYUP, 0);
          } else if (sKey === 'ctrlaltdel' || sKey === 'taskmgr') {
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
    }

    // -------------------------------------------------------------
    // macOS CoreGraphics Input Simulation (Native, Zero Lag)
    // -------------------------------------------------------------
    if (process.platform === 'darwin' && darwinInput) {
      const { CGWarpMousePosition, CGEventCreateMouseEvent, CGEventCreateKeyboardEvent, CGEventCreateScrollWheelEvent, CGEventPost, CFRelease } = darwinInput;
      const point = { x: targetX, y: targetY };

      const kCGEventLeftMouseDown = 1;
      const kCGEventLeftMouseUp = 2;
      const kCGEventRightMouseDown = 3;
      const kCGEventRightMouseUp = 4;
      const kCGEventMouseMoved = 5;
      const kCGEventLeftMouseDragged = 6;
      const kCGEventRightMouseDragged = 7;
      const kCGEventOtherMouseDown = 25;
      const kCGEventOtherMouseUp = 26;
      const kCGHIDEventTap = 0;

      const kCGMouseButtonLeft = 0;
      const kCGMouseButtonRight = 1;
      const kCGMouseButtonCenter = 2;

      switch (type) {
        case 'mousemove': {
          CGWarpMousePosition(point);
          const mType = darwinLeftDown ? kCGEventLeftMouseDragged : (darwinRightDown ? kCGEventRightMouseDragged : kCGEventMouseMoved);
          const mBtn = darwinRightDown ? kCGMouseButtonRight : kCGMouseButtonLeft;
          const ev = CGEventCreateMouseEvent(null, mType, point, mBtn);
          if (ev) { CGEventPost(kCGHIDEventTap, ev); CFRelease(ev); }
          break;
        }
        case 'mousedown': {
          if (button === 2) darwinRightDown = true;
          else if (button === 0) darwinLeftDown = true;
          CGWarpMousePosition(point);
          const mType = button === 2 ? kCGEventRightMouseDown : (button === 1 ? kCGEventOtherMouseDown : kCGEventLeftMouseDown);
          const mBtn = button === 2 ? kCGMouseButtonRight : (button === 1 ? kCGMouseButtonCenter : kCGMouseButtonLeft);
          const ev = CGEventCreateMouseEvent(null, mType, point, mBtn);
          if (ev) { CGEventPost(kCGHIDEventTap, ev); CFRelease(ev); }
          break;
        }
        case 'mouseup': {
          if (button === 2) darwinRightDown = false;
          else if (button === 0) darwinLeftDown = false;
          CGWarpMousePosition(point);
          const mType = button === 2 ? kCGEventRightMouseUp : (button === 1 ? kCGEventOtherMouseUp : kCGEventLeftMouseUp);
          const mBtn = button === 2 ? kCGMouseButtonRight : (button === 1 ? kCGMouseButtonCenter : kCGMouseButtonLeft);
          const ev = CGEventCreateMouseEvent(null, mType, point, mBtn);
          if (ev) { CGEventPost(kCGHIDEventTap, ev); CFRelease(ev); }
          break;
        }
        case 'click': {
          CGWarpMousePosition(point);
          const downType = button === 2 ? kCGEventRightMouseDown : kCGEventLeftMouseDown;
          const upType = button === 2 ? kCGEventRightMouseUp : kCGEventLeftMouseUp;
          const btn = button === 2 ? kCGMouseButtonRight : kCGMouseButtonLeft;
          const evDown = CGEventCreateMouseEvent(null, downType, point, btn);
          const evUp = CGEventCreateMouseEvent(null, upType, point, btn);
          if (evDown) { CGEventPost(kCGHIDEventTap, evDown); CFRelease(evDown); }
          if (evUp) { CGEventPost(kCGHIDEventTap, evUp); CFRelease(evUp); }
          break;
        }
        case 'wheel': {
          const delta = input.deltaY || input.DeltaY || 0;
          const scroll = delta > 0 ? -3 : 3;
          if (CGEventCreateScrollWheelEvent) {
            const ev = CGEventCreateScrollWheelEvent(null, 1, 1, scroll);
            if (ev) { CGEventPost(kCGHIDEventTap, ev); CFRelease(ev); }
          }
          break;
        }
        case 'keydown':
        case 'keyup': {
          const isDown = type === 'keydown';
          let macKey = undefined;
          if (input.code && CODE_TO_MAC_KEY[input.code] !== undefined) {
            macKey = CODE_TO_MAC_KEY[input.code];
          } else {
            const keyCode = input.keyCode || input.KeyCode;
            macKey = DOM_TO_MAC_VIRTUAL_KEY[keyCode];
          }
          if (typeof macKey === 'number') {
            const ev = CGEventCreateKeyboardEvent(null, macKey, isDown);
            if (ev) { CGEventPost(kCGHIDEventTap, ev); CFRelease(ev); }
          }
          break;
        }
        case 'specialkey': {
          const sKey = (input.specialKey || input.SpecialKey || '').toLowerCase();
          if (sKey === 'escape') {
            const evDown = CGEventCreateKeyboardEvent(null, 53, true);
            const evUp = CGEventCreateKeyboardEvent(null, 53, false);
            if (evDown) { CGEventPost(kCGHIDEventTap, evDown); CFRelease(evDown); }
            if (evUp) { CGEventPost(kCGHIDEventTap, evUp); CFRelease(evUp); }
          } else if (sKey === 'win' || sKey === 'windows' || sKey === 'cmd') {
            const evDown = CGEventCreateKeyboardEvent(null, 55, true);
            const evUp = CGEventCreateKeyboardEvent(null, 55, false);
            if (evDown) { CGEventPost(kCGHIDEventTap, evDown); CFRelease(evDown); }
            if (evUp) { CGEventPost(kCGHIDEventTap, evUp); CFRelease(evUp); }
          } else if (sKey === 'alttab') {
            const cmdDown = CGEventCreateKeyboardEvent(null, 55, true);
            const tabDown = CGEventCreateKeyboardEvent(null, 48, true);
            const tabUp = CGEventCreateKeyboardEvent(null, 48, false);
            const cmdUp = CGEventCreateKeyboardEvent(null, 55, false);
            if (cmdDown) { CGEventPost(kCGHIDEventTap, cmdDown); CFRelease(cmdDown); }
            if (tabDown) { CGEventPost(kCGHIDEventTap, tabDown); CFRelease(tabDown); }
            if (tabUp) { CGEventPost(kCGHIDEventTap, tabUp); CFRelease(tabUp); }
            if (cmdUp) { CGEventPost(kCGHIDEventTap, cmdUp); CFRelease(cmdUp); }
          } else if (sKey === 'ctrlaltdel' || sKey === 'taskmgr') {
            // macOS Force Quit dialog: Cmd (55) + Option (58) + Escape (53)
            const cmdDown = CGEventCreateKeyboardEvent(null, 55, true);
            const optDown = CGEventCreateKeyboardEvent(null, 58, true);
            const escDown = CGEventCreateKeyboardEvent(null, 53, true);
            const escUp = CGEventCreateKeyboardEvent(null, 53, false);
            const optUp = CGEventCreateKeyboardEvent(null, 58, false);
            const cmdUp = CGEventCreateKeyboardEvent(null, 55, false);
            if (cmdDown) { CGEventPost(kCGHIDEventTap, cmdDown); CFRelease(cmdDown); }
            if (optDown) { CGEventPost(kCGHIDEventTap, optDown); CFRelease(optDown); }
            if (escDown) { CGEventPost(kCGHIDEventTap, escDown); CFRelease(escDown); }
            if (escUp) { CGEventPost(kCGHIDEventTap, escUp); CFRelease(escUp); }
            if (optUp) { CGEventPost(kCGHIDEventTap, optUp); CFRelease(optUp); }
            if (cmdUp) { CGEventPost(kCGHIDEventTap, cmdUp); CFRelease(cmdUp); }
          }
          break;
        }
      }
    }
  } catch (err) {
    console.error('[NativeInput] Error executing input simulation:', err);
  }
});

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.anydeskclone.app');
  }

  if (process.platform === 'darwin') {
    try {
      if (systemPreferences && systemPreferences.getMediaAccessStatus) {
        const screenStatus = systemPreferences.getMediaAccessStatus('screen');
        console.log('[macOS Permissions] Screen access status on launch:', screenStatus);
      }
      desktopCapturer.getSources({ types: ['screen'] }).catch(() => {});
    } catch (e) {
      console.warn('[macOS Permissions] Init error:', e);
    }
  }

  // Automatically handle getDisplayMedia requests with primary or active screen
  if (session.defaultSession) {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(true);
    });
    session.defaultSession.setPermissionCheckHandler(() => true);

    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 },
          fetchWindowIcons: false
        });
        const screens = sources.filter((s) => s.id.startsWith('screen'));
        let chosen = null;
        if (activeScreenSourceId) {
          // 1. Direct ID match
          chosen = screens.find((s) => s.id === activeScreenSourceId) ||
                   sources.find((s) => s.id === activeScreenSourceId);

          // 2. Match by substring
          if (!chosen) {
            chosen = screens.find((s) => s.id.includes(activeScreenSourceId) || activeScreenSourceId.includes(s.id));
          }

          // 3. Match by index if formatted like screen:idx:0
          if (!chosen) {
            const parts = activeScreenSourceId.split(':');
            if (parts.length >= 2) {
              const idx = parseInt(parts[1], 10);
              if (!isNaN(idx) && screens[idx]) {
                chosen = screens[idx];
              }
            }
          }
        }

        // Only default to leftmost physical display (Screen 1) if activeScreenSourceId was never specified
        if (!chosen && !activeScreenSourceId) {
          const displays = screen.getAllDisplays();
          const primaryDisplay = screen.getPrimaryDisplay();
          const sortedDisplays = [...displays].sort((a, b) => {
            if (a.bounds.x !== b.bounds.x) return a.bounds.x - b.bounds.x;
            return a.bounds.y - b.bounds.y;
          });
          const firstDisp = sortedDisplays[0];
          if (firstDisp) {
            let matched = screens.find((s) => s.display_id && s.display_id === firstDisp.id.toString());
            if (!matched) {
              if (firstDisp.id === primaryDisplay.id) {
                matched = screens.find((s) => s.name === 'Screen 1' || s.id === 'screen:0:0');
              } else if (firstDisp.bounds.x < primaryDisplay.bounds.x) {
                matched = screens.find((s) => s.name === 'Screen 3' || s.id === 'screen:2:0');
              } else {
                matched = screens.find((s) => s.name === 'Screen 2' || s.id === 'screen:1:0');
              }
            }
            if (matched) chosen = matched;
          }
          if (!chosen) {
            chosen = screens[0] || sources[0];
          }
        }
        if (chosen) {
          console.log('[DisplayMedia] Serving screen source for getDisplayMedia:', chosen.name, chosen.id);
          callback({ video: chosen });
        } else {
          console.warn('[DisplayMedia] No screen source found to serve');
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
