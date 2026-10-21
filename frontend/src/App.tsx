import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { TitleBar } from './components/TitleBar';
import { OfflineBanner } from './components/OfflineBanner';
import { ThisDeskCard } from './components/ThisDeskCard';
import { RemoteDeskCard } from './components/RemoteDeskCard';
import { RecentSessions } from './components/RecentSessions';
import { IncomingSessionModal } from './components/IncomingSessionModal';
import { RemoteScreenViewer } from './components/RemoteScreenViewer';
import { HostSessionView } from './components/HostSessionView';
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
import { DEFAULT_SERVER_URL, isLocalOrPrivateIp } from './utils/networkUtils';

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
  const [macScreenPermission, setMacScreenPermission] = useState<string>('granted');

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
      if (window.electronAPI.getScreenAccessStatus) {
        window.electronAPI.getScreenAccessStatus().then((status) => {
          if (status) {
            setMacScreenPermission(status);
            console.log('[macOS Screen Permission Status]:', status);
          }
        });
      }

      window.electronAPI.getSystemInfo().then((info) => {
        if (info.hostname && !localStorage.getItem(STORAGE_KEY_DEVICE_NAME)) {
          setDeviceName(info.hostname);
        }
        if (info.localIp) {
          setLocalIp(info.localIp);
          webRtcService.setMyLanIp(info.localIp);
        }
      });
    } else {
      fetch('/api/my-ip')
        .then((r) => r.json())
        .then((data) => {
          if (data?.ip && data.ip !== '127.0.0.1') {
            setLocalIp(data.ip);
            webRtcService.setMyLanIp(data.ip);
            console.log('[App] Detected browser client LAN IP:', data.ip);
          }
        })
        .catch(() => { });
    }

    if (window.electronAPI?.isElectron) {

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
        const sorted = [...available].sort((a, b) => (a.displayNumber ?? 0) - (b.displayNumber ?? 0));
        setScreenSources(sorted);
        const screen1 = sorted.find((s) => s.displayNumber === 1) || sorted[0];
        if (screen1) {
          setSelectedSourceId(screen1.id);
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

  const activePeerIdRef = useRef(activePeerId);
  activePeerIdRef.current = activePeerId;

  const connectionStatusRef = useRef(connectionStatus);
  connectionStatusRef.current = connectionStatus;

  const screenSourcesRef = useRef(screenSources);
  screenSourcesRef.current = screenSources;

  const selectedSourceIdRef = useRef(selectedSourceId);
  selectedSourceIdRef.current = selectedSourceId;

  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;

  const sessionApprovedHandled = useRef<string | null>(null);

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

  const saveRecentSession = useCallback((targetId: string) => {
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
  }, []);

  const handleSessionApproved = useCallback(async (data: any) => {
    console.log('[App] Processing Session Approved:', data);
    const sid = data?.sessionId || data?.SessionId || activeSessionIdRef.current;
    const partnerId = data?.hostDeviceId || data?.HostDeviceId || activePeerIdRef.current || remoteIdRef.current;
    if (!sid) {
      console.warn('[App] SessionApproved received without sessionId:', data);
      return;
    }

    if (sessionApprovedHandled.current === sid) {
      console.log('[App] SessionApproved already handled for sid:', sid);
      return;
    }
    sessionApprovedHandled.current = sid;
    activeSessionIdRef.current = sid;
    isHostRef.current = false;

    setStatusMessage('Connection approved! Negotiating WebRTC peer connection...');
    setConnectionDetailStatus('Connection approved! Establishing direct video feed...');
    setConnectionStatus('connected');
    setActiveSessionId(sid);
    setIsHost(false);

    if (partnerId) {
      setActivePeerId(partnerId);
      activePeerIdRef.current = partnerId;
      saveRecentSession(partnerId);
    }

    await webRtcService.startControllerSession(sid, deviceIdRef.current, partnerId);
  }, [saveRecentSession]);

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

    signalRService.onSessionApproved = handleSessionApproved;

    webRtcService.onHostApprovedSignalReceived = (sid, partnerId) => {
      if (sessionApprovedHandled.current === sid && activeSessionIdRef.current === sid) return;
      if (connectionStatusRef.current === 'waiting_approval' || connectionStatusRef.current === 'connecting') {
        console.log('[App] Detected incoming host WebRTC signal while waiting for approval, transitioning to connected!');
        handleSessionApproved({ sessionId: sid, hostDeviceId: partnerId });
      }
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

    const executeRemoteInput = (input: RemoteInputEvent) => {
      if (!isHostRef.current || !window.electronAPI?.simulateInput) return;
      const perms = permissionsRef.current;
      if (!perms.allowControl) return;

      const isMouse = ['mousemove', 'mousedown', 'mouseup', 'wheel'].includes(input.type);
      const isKeyboard = ['keydown', 'keyup', 'specialkey'].includes(input.type);

      if (isMouse && !perms.allowMouse) return;
      if (isKeyboard && !perms.allowKeyboard) return;

      window.electronAPI.simulateInput(input);
    };

    signalRService.onReceiveInput = (input: RemoteInputEvent) => {
      executeRemoteInput(input);
    };

    // WebRTC event subscriptions
    webRtcService.onRemoteStreamReceived = (stream) => {
      setRemoteStream(stream);
      setConnectionStatus('connected');
    };

    webRtcService.onRemoteInputReceived = (input) => {
      executeRemoteInput(input);
    };

    webRtcService.onPermissionsUpdate = (newPerms: SessionPermissions) => {
      console.log('[App] Received permissions update from host:', newPerms);
      setPermissions(newPerms);
    };

    webRtcService.onClipboardSyncReceived = (text: string) => {
      if (!permissionsRef.current.allowClipboard) {
        console.log('[App] Clipboard sync received but allowClipboard is false; dropped');
        return;
      }
      if (!text || text === lastClipboardTextRef.current) return;
      lastClipboardTextRef.current = text;
      console.log('[App] Applying remote clipboard text');
      if (window.electronAPI?.writeClipboard) {
        window.electronAPI.writeClipboard(text);
      } else if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
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
      const sorted = [...screens].sort((a, b) => (a.displayNumber ?? 0) - (b.displayNumber ?? 0));
      setRemoteHostScreens(sorted);
      if (activeId) {
        setSelectedSourceId(activeId);
      } else if (sorted.length > 0 && !selectedSourceIdRef.current) {
        const screen1 = sorted.find((s) => s.displayNumber === 1) || sorted[0];
        setSelectedSourceId(screen1.id);
      }
    };

    webRtcService.onHostScreenSwitched = (activeId) => {
      console.log('[App] Host switched active screen to:', activeId);
      setSelectedSourceId(activeId);
    };

    webRtcService.onControlChannelOpen = async () => {
      if (isHostRef.current) {
        let screens: ElectronSource[] = screenSourcesRef.current;
        if (screens.length === 0 && window.electronAPI?.getScreenSources) {
          try {
            const fresh = await window.electronAPI.getScreenSources();
            const scrs = fresh.filter((s) => s.id.startsWith('screen'));
            if (scrs.length > 0) {
              screens = [...scrs].sort((a, b) => (a.displayNumber ?? 0) - (b.displayNumber ?? 0));
              setScreenSources(screens);
              screenSourcesRef.current = screens;
            }
          } catch (e) {
            console.error('[App] Failed to fetch fresh screens on control channel open:', e);
          }
        }
        if (screens.length === 0) {
          screens = [
            { id: 'screen:0:0', name: 'Screen 1', displayNumber: 1, thumbnail: null }
          ];
        }
        webRtcService.setHostScreensList(screens, selectedSourceIdRef.current || screens[0]?.id);
      } else {
        webRtcService.sendControlCommand({ type: 'request-screens' });
      }
    };

    return () => {
      isCancelled = true;
      window.electronAPI?.stopCursorBroadcast?.();
      signalRService.disconnect();
      webRtcService.cleanUp();
    };
  }, [connectSignalR, handleSessionApproved]);

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
      window.electronAPI?.startCursorBroadcast?.();
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
      await signalRService.registerDevice(deviceId, deviceName);
      const resp = await signalRService.requestSession(targetId, deviceId, deviceName);
      const reqSessionId = (resp as any)?.sessionId || (resp as any)?.SessionId;
      if (reqSessionId) {
        setActiveSessionId(reqSessionId);
      }
      setConnectionStatus('waiting_approval');
      setConnectionDetailStatus(`Waiting for Desk ${targetId} to accept connection request...`);
      setStatusMessage('Waiting for remote partner to accept request...');

      // Fast polling fallback: check session state every 800ms while waiting for approval
      if (reqSessionId) {
        const pollApprovalTimer = setInterval(async () => {
          if (connectionStatusRef.current !== 'waiting_approval' || sessionApprovedHandled.current === reqSessionId) {
            clearInterval(pollApprovalTimer);
            return;
          }
          try {
            const res = await fetch(`${serverUrlRef.current.replace(/\/+$/, '')}/api/sessions/${reqSessionId}`);
            if (res.ok) {
              const sess = await res.json();
              const state = (sess.state ?? sess.State ?? '').toString().toLowerCase();
              // SessionState in C#: 0=Pending, 1=WaitingApproval, 2=Approved, 3=Active, 4=Rejected, 5=Ended
              if (state === 'approved' || state === 'active' || state === '2' || state === '3') {
                clearInterval(pollApprovalTimer);
                if (connectionStatusRef.current === 'waiting_approval' && sessionApprovedHandled.current !== reqSessionId) {
                  console.log('[App] Session approval detected via polling fallback!');
                  handleSessionApproved({
                    sessionId: reqSessionId,
                    hostDeviceId: targetId
                  });
                }
              } else if (state === 'rejected' || state === 'ended' || state === '4' || state === '5') {
                clearInterval(pollApprovalTimer);
                setConnectionStatus('rejected');
                setStatusMessage('Remote host rejected the connection request.');
                setTimeout(() => {
                  setConnectionStatus('ready');
                  setStatusMessage('');
                }, 4000);
              }
            }
          } catch { }
        }, 800);
      }
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

    // Re-register device ID on hub to ensure current socket ConnectionId is up to date
    try {
      await signalRService.registerDevice(deviceId, deviceName);
    } catch { }

    // 1. Acquire stream immediately while user click gesture is active
    let stream: MediaStream | null = null;
    try {
      stream = await webRtcService.acquireScreenStream(selectedSourceId);
    } catch (err) {
      console.warn('Screen capture prompt dismissed or unavailable, using simulated host display:', err);
      stream = webRtcService.createVirtualDisplayStream();
    }

    activeSessionIdRef.current = req.sessionId;
    isHostRef.current = true;
    activePeerIdRef.current = req.controllerDeviceId;
    setActiveSessionId(req.sessionId);
    setActivePeerId(req.controllerDeviceId);
    setIsHost(true);
    setConnectionStatus('connected');
    setRemoteStream(stream);

    // 2. Query fresh host screens and notify controller
    let screensToSend: ElectronSource[] = screenSources;
    if (window.electronAPI?.getScreenSources) {
      try {
        const fresh = await window.electronAPI.getScreenSources();
        const scrs = fresh.filter((s) => s.id.startsWith('screen'));
        if (scrs.length > 0) {
          screensToSend = [...scrs].sort((a, b) => (a.displayNumber ?? 0) - (b.displayNumber ?? 0));
          setScreenSources(screensToSend);
          screenSourcesRef.current = screensToSend;
        }
      } catch { }
    }
    if (screensToSend.length === 0) {
      screensToSend = [
        { id: 'screen:0:0', name: 'Screen 1', displayNumber: 1, thumbnail: null }
      ];
    }
    webRtcService.setHostScreensList(screensToSend, selectedSourceId || screensToSend[0]?.id);

    // 3. Negotiate WebRTC with the acquired stream FIRST so Host has localOffer ready
    try {
      window.electronAPI?.startCursorBroadcast?.();
      await webRtcService.startHostSessionWithStream(
        req.sessionId,
        deviceId,
        req.controllerDeviceId,
        stream
      );
    } catch (err) {
      console.error('[App] Failed to start host WebRTC session:', err);
    }

    // 4. Respond to session approval on signaling hub
    await signalRService.respondSession(req.sessionId, true, approvedPermissions);

    // 5. Notify controller of host's available screens
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
  };

  // Update permissions live on host and notify controller
  const handleUpdatePermissions = (newPerms: SessionPermissions) => {
    setPermissions(newPerms);
    webRtcService.sendControlCommand({
      type: 'permissions-update',
      permissions: newPerms
    });
  };

  // Bidirectional Clipboard Synchronization during active session
  const lastClipboardTextRef = useRef<string>('');

  useEffect(() => {
    if (!activeSessionId || !permissions.allowClipboard) {
      return;
    }

    const checkAndSyncLocalClipboard = async () => {
      try {
        let text = '';
        if (window.electronAPI?.readClipboard) {
          text = await window.electronAPI.readClipboard();
        } else if (navigator.clipboard?.readText) {
          text = await navigator.clipboard.readText();
        }

        if (text && text !== lastClipboardTextRef.current) {
          lastClipboardTextRef.current = text;
          webRtcService.sendControlCommand({
            type: 'clipboard-sync',
            text
          });
        }
      } catch (e) {
        // clipboard permission / empty
      }
    };

    const interval = setInterval(checkAndSyncLocalClipboard, 800);

    const onWindowFocus = () => {
      checkAndSyncLocalClipboard();
    };
    window.addEventListener('focus', onWindowFocus);

    const onCopyCut = () => {
      setTimeout(checkAndSyncLocalClipboard, 60);
    };
    window.addEventListener('copy', onCopyCut);
    window.addEventListener('cut', onCopyCut);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('copy', onCopyCut);
      window.removeEventListener('cut', onCopyCut);
    };
  }, [activeSessionId, permissions.allowClipboard]);

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
    sessionApprovedHandled.current = null;
    window.electronAPI?.stopCursorBroadcast?.();
    webRtcService.cleanUp();
    setActiveSessionId(null);
    setRemoteStream(null);
    setIsHost(false);
    setActivePeerId('');
    setRemoteHostScreens([]);
    setConnectionStatus('ready');
    setStatusMessage('');
  };

  // Switch Screen without ending session - Both Host and Controller can switch screen!
  const handleSwitchScreen = async (newSourceId: string) => {
    if (newSourceId === selectedSourceIdRef.current) return;
    setSelectedSourceId(newSourceId);
    if (isHostRef.current) {
      console.log('[App] Host directly switching active screen broadcast to:', newSourceId);
      await webRtcService.switchScreenSource(newSourceId);
    } else {
      console.log('[App] Controller requesting Host to switch screen to:', newSourceId);
      webRtcService.sendControlCommand({ type: 'switch-screen', sourceId: newSourceId });
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

      {/* macOS Screen Recording Permission Warning Banner */}
      {!activeSessionId && (macScreenPermission === 'denied' || macScreenPermission === 'not-determined') && (
        <div
          style={{
            background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.22), rgba(234, 88, 12, 0.18))',
            borderBottom: '1px solid rgba(245, 158, 11, 0.45)',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            fontSize: '13px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#fef08a' }}>
            <AlertTriangle size={20} color="#f59e0b" style={{ flexShrink: 0 }} />
            <span>
              <strong>Screen Recording Permission Required:</strong> macOS blocks screen streaming by default. Enable AnyDesk Clone in <strong>System Settings &gt; Privacy &amp; Security &gt; Screen Recording</strong>, then <strong>Quit and Reopen</strong> AnyDesk Clone (Cmd+Q).
            </span>
          </div>
          <button
            onClick={() => window.electronAPI?.openScreenPreferences?.()}
            style={{
              background: '#f59e0b',
              color: '#000',
              fontWeight: 700,
              border: 'none',
              borderRadius: '6px',
              padding: '7px 14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap'
            }}
          >
            <span>Open System Settings</span>
            <ExternalLink size={13} />
          </button>
        </div>
      )}

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
              onSelectSourceId={() => { }}
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
          {/* <div
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
          </div> */}

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
      ) : isHost ? (
        /* Host Session Control Center: The host sees their own dashboard & controls */
        <HostSessionView
          remoteDeviceId={activePeerId}
          sessionId={activeSessionId}
          stats={peerStats}
          permissions={permissions}
          onUpdatePermissions={handleUpdatePermissions}
          onDisconnect={() => handleEndSession(true)}
          screenSources={screenSources}
          selectedSourceId={selectedSourceId}
          onSelectSourceId={handleSwitchScreen}
          localStream={remoteStream}
        />
      ) : (
        /* Controller Remote Desktop Feed: The other PC sees the live host screen */
        <RemoteScreenViewer
          remoteStream={remoteStream}
          remoteDeviceId={activePeerId}
          sessionId={activeSessionId}
          isHost={false}
          stats={peerStats}
          permissions={permissions}
          connectionStatus={connectionStatus}
          connectionDetailStatus={connectionDetailStatus}
          screenSources={remoteHostScreens}
          selectedSourceId={selectedSourceId}
          onSelectSourceId={handleSwitchScreen}
          onSendInputEvent={handleSendInputEvent}
          onDisconnect={() => handleEndSession(true)}
          onRetry={() => webRtcService.retryConnection()}
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
