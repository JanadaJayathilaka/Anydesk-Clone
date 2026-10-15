import React, { useEffect, useState, useCallback, useRef } from 'react';
import { TitleBar } from './components/TitleBar';
import { OfflineBanner } from './components/OfflineBanner';
import { ThisDeskCard } from './components/ThisDeskCard';
import { RemoteDeskCard } from './components/RemoteDeskCard';
import { RecentSessions } from './components/RecentSessions';
import { IncomingSessionModal } from './components/IncomingSessionModal';
import { RemoteScreenViewer } from './components/RemoteScreenViewer';
import { SettingsModal } from './components/SettingsModal';

import type {
  ConnectionStatus,
  ElectronSource,
  LanDiscoveredDevice,
  PeerStats,
  RecentSession,
  RemoteInputEvent,
  SessionPermissions,
  SignalMessage
} from './types';
import { signalRService } from './services/signalRService';
import { webRtcService } from './services/webRtcService';

const STORAGE_KEY_DEVICE_ID = 'anydesk_clone_device_id';
const STORAGE_KEY_SERVER_URL = 'anydesk_clone_server_url';
const STORAGE_KEY_DEVICE_NAME = 'anydesk_clone_device_name';
const STORAGE_KEY_RECENTS = 'anydesk_clone_recent_sessions';

// Generates a 9-digit random numeric ID like AnyDesk (e.g. 842109385)
function generateDeviceId(): string {
  const min = 100000000;
  const max = 999999999;
  return Math.floor(min + Math.random() * (max - min)).toString();
}

export const DEFAULT_SERVER_URL = 'http://18.188.166.170:5082';

export function isLocalOrPrivateIp(url: string | null | undefined): boolean {
  if (!url) return true;
  if (url.includes('localhost') || url.includes('127.0.0.1')) return true;
  // Match 192.168.x.x, 10.x.x.x, 172.16-31.x.x
  if (/https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(url)) return true;
  return false;
}

export const App: React.FC = () => {
  // Device identity (persists in localStorage so PC retains its AnyDesk ID)
  const [deviceId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const paramId = params.get('id');
    if (paramId && paramId.length === 9) return paramId;

    const saved = localStorage.getItem(STORAGE_KEY_DEVICE_ID) || sessionStorage.getItem(STORAGE_KEY_DEVICE_ID);
    if (saved && saved.length === 9) {
      localStorage.setItem(STORAGE_KEY_DEVICE_ID, saved);
      return saved;
    }
    const newId = generateDeviceId();
    localStorage.setItem(STORAGE_KEY_DEVICE_ID, newId);
    sessionStorage.setItem(STORAGE_KEY_DEVICE_ID, newId);
    return newId;
  });

  const [deviceName, setDeviceName] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_DEVICE_NAME) || 'Windows Desktop';
  });

  const [serverUrl, setServerUrl] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SERVER_URL);
    // If empty or previously set to a local/LAN/private IP, reset immediately to the AWS server!
    if (!saved || isLocalOrPrivateIp(saved)) {
      localStorage.setItem(STORAGE_KEY_SERVER_URL, DEFAULT_SERVER_URL);
      return DEFAULT_SERVER_URL;
    }
    return saved;
  });

  // State & Status
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [statusMessage, setStatusMessage] = useState<string>('Starting backend service...');
  const [connectionDetailStatus, setConnectionDetailStatus] = useState<string>('');
  const [isRetryingSignalR, setIsRetryingSignalR] = useState(false);
  const [localIp, setLocalIp] = useState<string>('');
  const [lanDevices, setLanDevices] = useState<LanDiscoveredDevice[]>([]);

  // Permissions & Screen Sources
  const [permissions, setPermissions] = useState<SessionPermissions>({
    allowControl: true,
    allowMouse: true,
    allowKeyboard: true,
    allowClipboard: true,
    allowAudio: false
  });
  const [screenSources, setScreenSources] = useState<ElectronSource[]>([]);
  const [remoteHostScreens, setRemoteHostScreens] = useState<ElectronSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');

  // Remote connection input
  const [remoteId, setRemoteId] = useState<string>('');
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_RECENTS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Active Session
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activePeerId, setActivePeerId] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerStats, setPeerStats] = useState<PeerStats>({
    rttMs: 14,
    fps: 60,
    resolution: '1920x1080',
    bytesReceived: 0,
    packetsLost: 0
  });

  // Incoming request modal
  const [incomingRequest, setIncomingRequest] = useState<{
    sessionId: string;
    controllerDeviceId: string;
    controllerName: string;
  } | null>(null);

  // Settings modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Initialize Electron sources & system info & LAN discovery
  useEffect(() => {
    let unsubscribeLan: (() => void) | undefined;

    if (window.electronAPI?.isElectron) {
      window.electronAPI.getSystemInfo().then((info) => {
        if (info.hostname && !localStorage.getItem(STORAGE_KEY_DEVICE_NAME)) {
          setDeviceName(info.hostname);
        }
        if (info.localIp) {
          setLocalIp(info.localIp);
        }
      });

      if (window.electronAPI.broadcastLanPresence) {
        window.electronAPI.broadcastLanPresence({ deviceId, deviceName });
      }

      if (window.electronAPI.onLanDeviceDiscovered) {
        unsubscribeLan = window.electronAPI.onLanDeviceDiscovered((dev: LanDiscoveredDevice) => {
          setLanDevices((prev) => {
            const filtered = prev.filter((d) => d.deviceId !== dev.deviceId);
            return [...filtered, dev];
          });
        });
      }

      if (window.electronAPI.scanSubnet) {
        window.electronAPI.scanSubnet().then((found) => {
          if (found && found.length > 0) {
            setLanDevices((prev) => {
              let merged = [...prev];
              for (const dev of found) {
                merged = merged.filter((d) => d.deviceId !== dev.deviceId);
                merged.push(dev);
              }
              return merged;
            });
          }
        });
      }

      window.electronAPI.getScreenSources().then((sources) => {
        const screensOnly = sources.filter((s) => s.id.startsWith('screen'));
        const available = screensOnly.length > 0 ? screensOnly : sources;
        setScreenSources(available);
        if (available.length > 0) {
          setSelectedSourceId(available[0].id);
        }
      });
    }

    // Prune stale LAN devices every 5s (offline after 25s)
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setLanDevices((prev) => prev.filter((d) => now - d.lastSeen < 25000));
    }, 5000);

    return () => {
      unsubscribeLan?.();
      clearInterval(cleanupInterval);
    };
  }, [deviceId, deviceName]);

  // Check if the configured server is a remote/cloud server (not local)
  const isRemoteServer = !isLocalOrPrivateIp(serverUrl);

  // Keep stable refs to avoid tearing down the SignalR & WebRTC connection when state changes
  const isRemoteServerRef = useRef(isRemoteServer);
  isRemoteServerRef.current = isRemoteServer;

  const serverUrlRef = useRef(serverUrl);
  serverUrlRef.current = serverUrl;

  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;

  const deviceNameRef = useRef(deviceName);
  deviceNameRef.current = deviceName;

  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const remoteIdRef = useRef(remoteId);
  remoteIdRef.current = remoteId;

  const screenSourcesRef = useRef(screenSources);
  screenSourcesRef.current = screenSources;

  const selectedSourceIdRef = useRef(selectedSourceId);
  selectedSourceIdRef.current = selectedSourceId;

  // Initialize SignalR & WebRTC listeners with auto-retry while backend boots
  const connectSignalR = useCallback(async (maxAttempts?: number, delayMs = 1000) => {
    const isRemote = isRemoteServerRef.current;
    const sUrl = serverUrlRef.current;
    const devId = deviceIdRef.current;
    const devName = deviceNameRef.current;

    // For remote/cloud servers: connect quickly, no need for long retry loops
    const attempts = maxAttempts ?? (isRemote ? 3 : 15);
    setIsRetryingSignalR(true);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (isRemote) {
        setStatusMessage(`Connecting to AWS Cloud Backend... (Attempt ${attempt}/${attempts})`);
      } else {
        setStatusMessage(`Starting and connecting to backend... (Attempt ${attempt}/${attempts})`);
      }
      const ok = await signalRService.connect(sUrl, devId, devName);
      if (ok) {
        setConnectionStatus('ready');
        setStatusMessage('');
        setIsRetryingSignalR(false);
        return true;
      }
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    setConnectionStatus('offline');
    if (isRemote) {
      setStatusMessage('AWS Cloud Backend is unreachable. Check your internet connection or verify the server is running.');
    } else {
      setStatusMessage('Backend service could not be reached. You can click Retry Connection.');
    }
    setIsRetryingSignalR(false);
    return false;
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const startup = async () => {
      if (window.electronAPI?.isElectron) {
        if (!isRemoteServerRef.current) {
          // Only start the local bundled backend when NOT using a remote cloud server
          try {
            setStatusMessage('Starting local AnyDesk backend...');
            await window.electronAPI.startBackend();
          } catch (e) {
            console.warn('Electron startBackend error:', e);
          }
        } else {
          console.log('[App] Remote AWS server configured — skipping local backend launch.');
        }
      }

      if (!isCancelled) {
        await connectSignalR();
      }
    };

    startup();

    // SignalR event subscriptions
    signalRService.onConnectionChange = (connected) => {
      if (connected) {
        setConnectionStatus((prev) => (prev === 'offline' || prev === 'connecting' ? 'ready' : prev));
      } else {
        if (!activeSessionIdRef.current) {
          setConnectionStatus('offline');
        }
      }
    };

    signalRService.onSessionIncoming = (data) => {
      setIncomingRequest({
        sessionId: data.sessionId,
        controllerDeviceId: data.controllerDeviceId,
        controllerName: data.controllerName
      });
    };

    signalRService.onSessionApproved = async (data) => {
      setStatusMessage('Connection approved! Negotiating WebRTC peer connection...');
      setConnectionStatus('connected');
      setActiveSessionId(data.sessionId);
      setIsHost(false);

      // Start controller WebRTC session
      const partnerId = data.hostDeviceId || remoteIdRef.current;
      setActivePeerId(partnerId);
      await webRtcService.startControllerSession(data.sessionId, deviceIdRef.current, partnerId);

      // Save to recent sessions
      saveRecentSession(partnerId);
    };

    signalRService.onSessionRejected = (data) => {
      setConnectionStatus('rejected');
      setStatusMessage(data.reason || 'Remote host declined connection.');
      setTimeout(() => {
        setConnectionStatus('ready');
        setStatusMessage('');
      }, 4000);
    };

    signalRService.onSessionEnded = () => {
      handleEndSession(false);
    };

    signalRService.onReceiveSignal = (msg: SignalMessage) => {
      webRtcService.handleSignalMessage(msg);
    };

    signalRService.onReceiveInput = (input: RemoteInputEvent) => {
      // Local hardware input execution if host
      if (isHostRef.current && window.electronAPI?.simulateInput) {
        window.electronAPI.simulateInput(input);
      }
    };

    // WebRTC event subscriptions
    webRtcService.onRemoteStreamReceived = (stream) => {
      setRemoteStream(stream);
      setConnectionStatus('connected');
    };

    webRtcService.onRemoteInputReceived = (input) => {
      // Direct peer-to-peer hardware input execution on host
      if (window.electronAPI?.simulateInput) {
        window.electronAPI.simulateInput(input);
      }
    };

    webRtcService.onSwitchSidesRequested = async () => {
      if (isHostRef.current) {
        setIsHost(false);
        setRemoteStream(null);
        setConnectionDetailStatus('Partner switched sides and is now presenting desktop...');
      } else {
        try {
          const stream = await webRtcService.acquireScreenStream();
          setIsHost(true);
          setRemoteStream(stream);
          if (activeSessionIdRef.current) {
            await webRtcService.startHostSessionWithStream(
              activeSessionIdRef.current,
              deviceIdRef.current,
              remoteIdRef.current,
              stream
            );
          }
        } catch (e) {
          console.warn('Error accepting switch sides:', e);
        }
      }
    };

    webRtcService.onDetailedStatus = (status) => {
      setConnectionDetailStatus(status);
    };

    webRtcService.onStatsUpdate = (stats) => {
      setPeerStats(stats);
    };

    webRtcService.onHostScreensReceived = (screens, activeId) => {
      console.log('[App] Received host screens from partner:', screens, activeId);
      setRemoteHostScreens(screens);
      if (activeId) {
        setSelectedSourceId(activeId);
      }
    };

    webRtcService.onHostScreenSwitched = (activeId) => {
      console.log('[App] Host switched active screen to:', activeId);
      setSelectedSourceId(activeId);
    };

    webRtcService.onControlChannelOpen = () => {
      if (isHostRef.current) {
        const screens: ElectronSource[] = screenSourcesRef.current.length > 0 ? screenSourcesRef.current : [
          { id: 'screen:0:0', name: 'Primary Display 1', thumbnail: null },
          { id: 'screen:1:0', name: 'Secondary Display 2', thumbnail: null }
        ];
        webRtcService.setHostScreensList(screens, selectedSourceIdRef.current || screens[0]?.id);
      } else {
        webRtcService.sendControlCommand({ type: 'request-screens' });
      }
    };

    return () => {
      isCancelled = true;
      signalRService.disconnect();
      webRtcService.cleanUp();
    };
  }, [connectSignalR]);

  const saveRecentSession = (targetId: string) => {
    setRecentSessions((prev) => {
      const filtered = prev.filter((s) => s.deviceId !== targetId);
      const updated = [
        {
          id: Math.random().toString(36).substring(2, 9),
          deviceId: targetId,
          alias: `Remote PC (${targetId.slice(-3)})`,
          timestamp: Date.now()
        },
        ...filtered
      ].slice(0, 8);
      localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(updated));
      return updated;
    });
  };

  // Self-Session / Loopback mode for instant 1-machine testing
  const startSelfSession = async () => {
    setStatusMessage('Starting self-test screen session...');
    setConnectionStatus('connecting');
    try {
      let stream: MediaStream | null = null;
      try {
        stream = await webRtcService.acquireScreenStream(selectedSourceId);
      } catch (err) {
        console.warn('Real screen share prompt canceled, using virtual desktop:', err);
        stream = webRtcService.createVirtualDisplayStream();
      }

      setActiveSessionId('self_test_' + Date.now());
      setActivePeerId(deviceId);
      setIsHost(false);
      setRemoteStream(stream);
      setConnectionStatus('connected');
      setStatusMessage('');
    } catch (e: any) {
      setStatusMessage('Could not start self session: ' + (e?.message || e));
      setConnectionStatus('ready');
    }
  };

  // Connect directly by selecting a LAN device
  const handleSelectLanDevice = async (dev: LanDiscoveredDevice) => {
    setRemoteId(dev.deviceId);
    await initiateSession(dev.deviceId);
  };

  const initiateSession = async (targetId: string) => {
    setConnectionStatus('connecting');
    setStatusMessage('Contacting remote desk via signaling hub...');
    setActivePeerId(targetId);

    try {
      await signalRService.requestSession(targetId, deviceId, deviceName);
      setConnectionStatus('waiting_approval');
      setStatusMessage('Waiting for remote partner to accept request...');
    } catch (err: any) {
      const rawMsg = err?.message || '';
      console.warn('Session request error:', rawMsg);

      setConnectionStatus('rejected');
      let cleanMsg = 'Remote desk is offline or unavailable.';
      if (rawMsg.includes('offline or not found')) {
        cleanMsg = `Device ${targetId.replace(/(\d{3})(?=\d)/g, '$1 ')} was not found on the hub. Make sure AnyDesk is open on that computer.`;
      } else if (rawMsg.includes('not connected')) {
        cleanMsg = 'Signaling server is disconnected. Please check Settings.';
      }
      setStatusMessage(cleanMsg);
      setTimeout(() => {
        setConnectionStatus('ready');
      }, 7000);
    }
  };

  // Controller starts connection (9-digit address)
  const handleConnect = async () => {
    const rawTarget = remoteId.trim();
    if (!rawTarget) {
      setStatusMessage('Please enter a 9-digit address.');
      return;
    }

    if (rawTarget === deviceId) {
      await startSelfSession();
      return;
    }

    const cleanId = rawTarget.replace(/\s+/g, '');
    await initiateSession(cleanId);
  };

  const handleCancelConnection = () => {
    setConnectionStatus('ready');
    setStatusMessage('');
    setActivePeerId('');
  };

  // Host accepts connection
  const handleAcceptIncoming = async (approvedPermissions: SessionPermissions) => {
    if (!incomingRequest) return;
    const req = incomingRequest;
    setIncomingRequest(null);

    // 1. Acquire stream immediately while user click gesture is active
    let stream: MediaStream | null = null;
    try {
      stream = await webRtcService.acquireScreenStream(selectedSourceId);
    } catch (err) {
      console.warn('Screen capture prompt dismissed or unavailable, using simulated host display:', err);
      stream = webRtcService.createVirtualDisplayStream();
    }

    setActiveSessionId(req.sessionId);
    setActivePeerId(req.controllerDeviceId);
    setIsHost(true);
    setConnectionStatus('connected');
    setRemoteStream(stream);

    // 2. Notify controller that request was approved
    const screensToSend: ElectronSource[] = screenSources.length > 0 ? screenSources : [
      { id: 'screen:0:0', name: 'Primary Display 1', thumbnail: null },
      { id: 'screen:1:0', name: 'Secondary Display 2', thumbnail: null }
    ];
    webRtcService.setHostScreensList(screensToSend, selectedSourceId || screensToSend[0]?.id);

    await signalRService.respondSession(req.sessionId, true, approvedPermissions);

    // Notify controller of host's available screens
    await signalRService.sendSignal({
      sessionId: req.sessionId,
      senderDeviceId: deviceId,
      targetDeviceId: req.controllerDeviceId,
      type: 'command',
      payload: {
        type: 'host-screens-list',
        screens: screensToSend,
        activeSourceId: selectedSourceId || screensToSend[0]?.id
      }
    });

    // 3. Negotiate WebRTC with the acquired stream
    await webRtcService.startHostSessionWithStream(
      req.sessionId,
      deviceId,
      req.controllerDeviceId,
      stream
    );
  };

  // Host rejects connection
  const handleRejectIncoming = async () => {
    if (!incomingRequest) return;
    const req = incomingRequest;
    setIncomingRequest(null);
    await signalRService.respondSession(req.sessionId, false, permissions);
  };

  // End session
  const handleEndSession = (notifyPeer: boolean = true) => {
    if (activeSessionId && notifyPeer) {
      signalRService.endSession(activeSessionId);
    }
    webRtcService.cleanUp();
    setActiveSessionId(null);
    setRemoteStream(null);
    setIsHost(false);
    setActivePeerId('');
    setRemoteHostScreens([]);
    setConnectionStatus('ready');
    setStatusMessage('');
  };

  // Switch Screen without ending session - Host cannot change screens, only the other PC (controller) can!
  const handleSwitchScreen = async (newSourceId: string) => {
    if (isHost) {
      console.warn('Host cannot change screens: only the other PC can change screens.');
      return;
    }
    setSelectedSourceId(newSourceId);
    webRtcService.sendControlCommand({ type: 'switch-screen', sourceId: newSourceId });
  };

  // Switch Sides without ending session
  const handleSwitchSides = async () => {
    if (isHost) {
      // Host asks Controller to present
      webRtcService.sendControlCommand({ type: 'switch-sides' });
      setIsHost(false);
      setRemoteStream(null);
      setConnectionDetailStatus('Switched sides: Partner is now sharing screen...');
    } else {
      // Controller shares screen to Host
      try {
        const stream = await webRtcService.acquireScreenStream(selectedSourceId);
        setIsHost(true);
        setRemoteStream(stream);
        webRtcService.sendControlCommand({ type: 'switch-sides' });
        if (activeSessionId) {
          await webRtcService.startHostSessionWithStream(activeSessionId, deviceId, activePeerId, stream);
        }
      } catch (err) {
        console.warn('Switch sides error:', err);
      }
    }
  };

  // Input event sending
  const handleSendInputEvent = (input: RemoteInputEvent) => {
    webRtcService.sendInputEvent(input);
  };

  // Settings Save
  const handleSaveSettings = (newUrl: string, newName: string) => {
    setServerUrl(newUrl);
    setDeviceName(newName);
    localStorage.setItem(STORAGE_KEY_SERVER_URL, newUrl);
    localStorage.setItem(STORAGE_KEY_DEVICE_NAME, newName);
    signalRService.connect(newUrl, deviceId, newName);
  };

  const handleManualLanScan = async () => {
    setStatusMessage('Scanning Wi-Fi network for AnyDesk computers...');
    if (window.electronAPI?.scanSubnet) {
      try {
        const found = await window.electronAPI.scanSubnet();
        if (found && found.length > 0) {
          setLanDevices((prev) => {
            let merged = [...prev];
            for (const dev of found) {
              merged = merged.filter((d) => d.deviceId !== dev.deviceId);
              merged.push(dev);
            }
            return merged;
          });
          setStatusMessage(`Found ${found.length} computer(s) on local network.`);
        } else {
          setStatusMessage('Scan complete. No other AnyDesk computers found on this subnet.');
        }
      } catch {
        setStatusMessage('LAN scan completed.');
      }
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  return (
    <div className="app-container">
      {/* Sleek Top Titlebar */}
      <TitleBar
        status={connectionStatus}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Offline banner if backend unreachable */}
      {connectionStatus === 'offline' && !activeSessionId && (
        <OfflineBanner
          onRetry={async () => {
            if (window.electronAPI?.isElectron) {
              await window.electronAPI.startBackend();
            }
            connectSignalR(10, 1000);
          }}
          isRetrying={isRetryingSignalR}
          errorMessage={statusMessage}
        />
      )}

      {/* Main Dashboard view when not in full-screen session */}
      {!activeSessionId ? (
        <main className="dashboard-main">
          <div className="desk-grid">
            {/* This Desk Card */}
            <ThisDeskCard
              deviceId={deviceId}
              deviceName={deviceName}
              localIp={localIp}
              serverUrl={serverUrl}
              permissions={permissions}
              onUpdatePermissions={setPermissions}
              screenSources={[]}
              selectedSourceId={selectedSourceId}
              onSelectSourceId={() => {}}
            />

            {/* Remote Desk Card */}
            <RemoteDeskCard
              remoteId={remoteId}
              onChangeRemoteId={(id) => {
                setRemoteId(id);
                if (statusMessage) setStatusMessage('');
              }}
              onConnect={handleConnect}
              onCancel={handleCancelConnection}
              onSelfTest={startSelfSession}
              status={connectionStatus}
              statusMessage={statusMessage}
              thisDeviceId={deviceId}
              lanDevices={lanDevices}
              onSelectLanDevice={handleSelectLanDevice}
              onRefreshLan={handleManualLanScan}
            />
          </div>

          {/* Quick Testing Bar for Single-Machine Dev */}
          <div
            style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '10px',
              padding: '12px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '13px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e0f2fe' }}>
              <span style={{ fontWeight: 600 }}>💡 Quick Test Tip:</span>
              <span>Open a second tab to act as the other computer (Host & Controller).</span>
            </div>
            <button
              onClick={() => window.open(window.location.origin, '_blank')}
              style={{
                background: 'rgba(56, 189, 248, 0.2)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              + Open Second Partner Tab
            </button>
          </div>

          {/* Recent Sessions */}
          <RecentSessions
            sessions={recentSessions}
            onSelectSession={(id) => {
              setRemoteId(id);
            }}
            onClearSessions={() => {
              setRecentSessions([]);
              localStorage.removeItem(STORAGE_KEY_RECENTS);
            }}
          />
        </main>
      ) : (
        /* Remote Screen Viewer View when session is active */
        <RemoteScreenViewer
          remoteStream={remoteStream}
          remoteDeviceId={activePeerId}
          sessionId={activeSessionId}
          isHost={isHost}
          stats={peerStats}
          connectionDetailStatus={connectionDetailStatus}
          screenSources={isHost ? [] : (remoteHostScreens.length > 0 ? remoteHostScreens : screenSources)}
          selectedSourceId={selectedSourceId}
          onSelectSourceId={handleSwitchScreen}
          onSwitchSides={handleSwitchSides}
          onSendInputEvent={handleSendInputEvent}
          onDisconnect={() => handleEndSession(true)}
        />
      )}

      {/* Host Approval Modal */}
      {incomingRequest && (
        <IncomingSessionModal
          sessionId={incomingRequest.sessionId}
          controllerDeviceId={incomingRequest.controllerDeviceId}
          controllerName={incomingRequest.controllerName}
          initialPermissions={permissions}
          onAccept={handleAcceptIncoming}
          onReject={handleRejectIncoming}
        />
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <SettingsModal
          serverUrl={serverUrl}
          deviceName={deviceName}
          localIp={localIp}
          onSave={handleSaveSettings}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
