export type ConnectionStatus = 'offline' | 'connecting' | 'ready' | 'waiting_approval' | 'connected' | 'disconnected' | 'rejected';

export interface DeviceStatus {
  deviceId: string;
  deviceName: string;
  isOnline: boolean;
  activeSessionId?: string | null;
}

export interface SessionPermissions {
  allowControl: boolean;
  allowMouse: boolean;
  allowKeyboard: boolean;
  allowClipboard: boolean;
  allowAudio: boolean;
}

export interface RemoteSession {
  sessionId: string;
  hostDeviceId: string;
  controllerDeviceId: string;
  controllerName: string;
  state: string;
  createdAt: string;
  startedAt?: string | null;
  permissions: SessionPermissions;
}

export interface SignalMessage {
  sessionId: string;
  senderDeviceId: string;
  targetDeviceId: string;
  type: 'offer' | 'answer' | 'candidate' | 'ping' | 'pong' | 'chat' | 'status' | 'command';
  payload: any;
}

export interface RemoteInputEvent {
  sessionId: string;
  type: 'mousemove' | 'mousedown' | 'mouseup' | 'click' | 'wheel' | 'keydown' | 'keyup' | 'specialkey';
  normalizedX: number;
  normalizedY: number;
  button?: number; // 0=left, 1=middle, 2=right
  deltaX?: number;
  deltaY?: number;
  key?: string;
  code?: string;
  keyCode?: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  specialKey?: string;
}

export interface RecentSession {
  id: string;
  deviceId: string;
  alias?: string;
  timestamp: number;
  lastDuration?: string;
}

export interface PeerStats {
  rttMs: number;
  fps: number;
  resolution: string;
  bytesReceived: number;
  packetsLost: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
  isSelf: boolean;
}

export interface ElectronSource {
  id: string;
  name: string;
  thumbnail?: string | null;
  display_id?: string;
}

export interface LanDiscoveredDevice {
  deviceId: string;
  deviceName: string;
  ip: string;
  port: number;
  lastSeen: number;
}

export interface ElectronAPI {
  isElectron: boolean;
  getScreenSources: (opts?: any) => Promise<ElectronSource[]>;
  getSystemInfo: () => Promise<{
    hostname: string;
    platform: string;
    arch: string;
    release: string;
    cpus: number;
    totalMem: string;
    localIp?: string;
    allIps?: string[];
  }>;
  startBackend: () => Promise<{ success: boolean; pid?: number | null; error?: string; message?: string }>;
  getBackendInfo: () => Promise<{ isRunning: boolean; pid: number | null; executablePath: string | null; lastError: string | null; logs?: string[] }>;
  broadcastLanPresence?: (info: { deviceId: string; deviceName: string }) => void;
  scanSubnet?: () => Promise<LanDiscoveredDevice[]>;
  onLanDeviceDiscovered?: (callback: (device: LanDiscoveredDevice) => void) => () => void;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  simulateInput?: (input: RemoteInputEvent) => void;
  setActiveDisplay?: (sourceId: string) => void;
  startCursorBroadcast?: () => void;
  stopCursorBroadcast?: () => void;
  onHostCursorPosition?: (callback: (pos: { x: number; y: number }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

