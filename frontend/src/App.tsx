import React, { useEffect, useState, useCallback } from 'react';
import { TitleBar } from './components/TitleBar';
import { OfflineBanner } from './components/OfflineBanner';
import { ThisDeskCard } from './components/ThisDeskCard';
import { RemoteDeskCard } from './components/RemoteDeskCard';
import { RecentSessions } from './components/RecentSessions';
import { IncomingSessionModal } from './components/IncomingSessionModal';
import { RemoteScreenViewer } from './components/RemoteScreenViewer';
import { SettingsModal } from './components/SettingsModal';

import type {
  ChatMessage,
  ConnectionStatus,
  ElectronSource,
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

export const App: React.FC = () => {
  // Device identity (uses sessionStorage so separate browser tabs get their own unique device IDs)
  const [deviceId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const paramId = params.get('id');
    if (paramId && paramId.length === 9) return paramId;

    const saved = sessionStorage.getItem(STORAGE_KEY_DEVICE_ID);
    if (saved && saved.length === 9) return saved;
    const newId = generateDeviceId();
    sessionStorage.setItem(STORAGE_KEY_DEVICE_ID, newId);
    return newId;
  });

  const [deviceName, setDeviceName] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_DEVICE_NAME) || 'Windows Desktop';
  });

  const [serverUrl, setServerUrl] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_SERVER_URL) || 'http://localhost:5082';
  });

  // State & Status
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [statusMessage, setStatusMessage] = useState<string>('Starting backend service...');
  const [isRetryingSignalR, setIsRetryingSignalR] = useState(false);
  const [localIp, setLocalIp] = useState<string>('');
  const [publicTunnelUrl, setPublicTunnelUrl] = useState<string | null>(null);

  // Permissions & Screen Sources
  const [permissions, setPermissions] = useState<SessionPermissions>({
    allowControl: true,
    allowMouse: true,
    allowKeyboard: true,
    allowClipboard: true,
    allowAudio: false
  });
  const [screenSources, setScreenSources] = useState<ElectronSource[]>([]);
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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  // Incoming request modal
  const [incomingRequest, setIncomingRequest] = useState<{
    sessionId: string;
    controllerDeviceId: string;
    controllerName: string;
  } | null>(null);

  // Settings modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Initialize Electron sources & system info
  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      window.electronAPI.getSystemInfo().then((info) => {
        if (info.hostname && !localStorage.getItem(STORAGE_KEY_DEVICE_NAME)) {
          setDeviceName(info.hostname);
        }
        if (info.localIp) {
          setLocalIp(info.localIp);
        }
        if (info.publicTunnelUrl) {
          setPublicTunnelUrl(info.publicTunnelUrl);
        }
      });

      if (window.electronAPI.onTunnelUrl) {
        window.electronAPI.onTunnelUrl((url: string) => {
          setPublicTunnelUrl(url);
        });
      }

      window.electronAPI.getScreenSources().then((sources) => {
        setScreenSources(sources);
        if (sources.length > 0) {
          setSelectedSourceId(sources[0].id);
        }
      });
    }
  }, []);

  // Initialize SignalR & WebRTC listeners with auto-retry while backend boots
  const connectSignalR = useCallback(async (maxAttempts = 15, delayMs = 1000) => {
    setIsRetryingSignalR(true);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      setStatusMessage(`Starting and connecting to backend... (Attempt ${attempt}/${maxAttempts})`);
      const ok = await signalRService.connect(serverUrl, deviceId, deviceName);
      if (ok) {
        setConnectionStatus('ready');
        setStatusMessage('');
        setIsRetryingSignalR(false);
        return true;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    setConnectionStatus('offline');
    setStatusMessage('Backend service could not be reached. You can click Retry Connection.');
    setIsRetryingSignalR(false);
    return false;
  }, [serverUrl, deviceId, deviceName]);

  useEffect(() => {
    let isCancelled = false;

    const startup = async () => {
      if (window.electronAPI?.isElectron) {
        try {
          setStatusMessage('Starting AnyDesk backend...');
          await window.electronAPI.startBackend();
        } catch (e) {
          console.warn('Electron startBackend error:', e);
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
        if (!activeSessionId) {
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
      const partnerId = data.hostDeviceId || remoteId;
      setActivePeerId(partnerId);
      await webRtcService.startControllerSession(data.sessionId, deviceId, partnerId);

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
      // Local input execution if host
      if (isHost) {
        console.log('Host received input event:', input.type);
      }
    };

    // WebRTC event subscriptions
    webRtcService.onRemoteStreamReceived = (stream) => {
      setRemoteStream(stream);
      setConnectionStatus('connected');
    };

    webRtcService.onRemoteInputReceived = (input) => {
      // Forward to backend input simulation
      signalRService.sendInput(input);
    };

    webRtcService.onChatMessageReceived = (msg) => {
      setChatMessages((prev) => [...prev, msg]);
    };

    webRtcService.onStatsUpdate = (stats) => {
      setPeerStats(stats);
    };

    return () => {
      signalRService.disconnect();
      webRtcService.cleanUp();
    };
  }, [connectSignalR, deviceId, remoteId, activeSessionId, isHost]);

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

  // Controller starts connection
  const handleConnect = async () => {
    if (!remoteId) {
      setStatusMessage('Please enter a 9-digit address.');
      return;
    }

    // If connecting to own address, seamlessly run self-test session!
    if (remoteId === deviceId) {
      await startSelfSession();
      return;
    }

    setConnectionStatus('connecting');
    setStatusMessage('Contacting remote desk...');
    setActivePeerId(remoteId);

    try {
      await signalRService.requestSession(remoteId, deviceId, deviceName);
      setConnectionStatus('waiting_approval');
      setStatusMessage('Waiting for remote partner to accept request...');
    } catch (err: any) {
      setConnectionStatus('rejected');
      const rawMsg = err?.message || '';
      let cleanMsg = 'Remote desk is offline or unavailable.';
      if (rawMsg.includes('offline or not found')) {
        cleanMsg = `Device ${remoteId} is not online on this server. To connect across the Internet, make sure both PCs have the SAME backend server URL configured in ⚙️ Settings (e.g. ${publicTunnelUrl || 'https://...trycloudflare.com'}).`;
      } else if (rawMsg.includes('not connected')) {
        cleanMsg = 'Signaling server is disconnected. Click Retry Connection.';
      }
      setStatusMessage(cleanMsg);
      setTimeout(() => {
        setConnectionStatus('ready');
      }, 7000);
    }
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
    await signalRService.respondSession(req.sessionId, true, approvedPermissions);

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
    setChatMessages([]);
    setIsHost(false);
    setActivePeerId('');
    setConnectionStatus('ready');
    setStatusMessage('');
  };

  // Chat message sending
  const handleSendChatMessage = (text: string) => {
    const msg = webRtcService.sendChatMessage(text, deviceName);
    setChatMessages((prev) => [...prev, msg]);
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
              publicTunnelUrl={publicTunnelUrl}
              permissions={permissions}
              onUpdatePermissions={setPermissions}
              screenSources={screenSources}
              selectedSourceId={selectedSourceId}
              onSelectSourceId={setSelectedSourceId}
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
          chatMessages={chatMessages}
          onSendChatMessage={handleSendChatMessage}
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
          publicTunnelUrl={publicTunnelUrl}
          onSave={handleSaveSettings}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
