import * as signalR from '@microsoft/signalr';
import type { RemoteInputEvent, SessionPermissions, SignalMessage } from '../types';

export class SignalRService {
  private hubConnection: signalR.HubConnection | null = null;
  private heartbeatInterval: any = null;
  private currentDeviceId: string = '';

  public onConnectionChange: ((connected: boolean, error?: string) => void) | null = null;
  public onSessionIncoming: ((data: { sessionId: string; controllerDeviceId: string; controllerName: string; createdAt: string }) => void) | null = null;
  public onSessionApproved: ((data: { sessionId: string; hostDeviceId?: string; permissions: SessionPermissions; startedAt: string }) => void) | null = null;
  public onSessionRejected: ((data: { sessionId: string; reason: string }) => void) | null = null;
  public onSessionEnded: ((data: { sessionId: string }) => void) | null = null;
  public onReceiveSignal: ((message: SignalMessage) => void) | null = null;
  public onReceiveInput: ((inputEvent: RemoteInputEvent) => void) | null = null;

  public isConnected(): boolean {
    return this.hubConnection?.state === signalR.HubConnectionState.Connected;
  }

  public async connect(serverUrl: string, deviceId: string, deviceName: string): Promise<boolean> {
    this.currentDeviceId = deviceId;

    if (this.hubConnection) {
      try {
        await this.hubConnection.stop();
      } catch (e) {
        // ignore
      }
    }

    const candidateUrls = [serverUrl];
    if (serverUrl.includes('localhost:5082')) {
      candidateUrls.push(serverUrl.replace('localhost:5082', '127.0.0.1:5082'));
    } else if (serverUrl.includes('127.0.0.1:5082')) {
      candidateUrls.push(serverUrl.replace('127.0.0.1:5082', 'localhost:5082'));
    }

    let lastError: any = null;

    for (const url of candidateUrls) {
      try {
        this.hubConnection = new signalR.HubConnectionBuilder()
          .withUrl(`${url.replace(/\/+$/, '')}/hubs/session`, {
            skipNegotiation: false,
            transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling
          })
          .withAutomaticReconnect([0, 1000, 3000, 5000, 10000])
          .configureLogging(signalR.LogLevel.Warning)
          .build();

        this.registerHandlers();

        await this.hubConnection.start();

        // Register device on hub
        await this.hubConnection.invoke('RegisterDevice', deviceId, deviceName);

        this.startHeartbeat();
        this.onConnectionChange?.(true);
        return true;
      } catch (err: any) {
        lastError = err;
        try {
          await this.hubConnection?.stop();
        } catch {}
      }
    }

    console.warn('SignalR connection failed (running in offline/disconnected mode):', lastError?.message || lastError);
    this.onConnectionChange?.(false, lastError?.message || 'Could not connect to signaling server');
    return false;
  }

  private registerHandlers() {
    if (!this.hubConnection) return;

    this.hubConnection.onclose((err) => {
      this.stopHeartbeat();
      this.onConnectionChange?.(false, err?.message);
    });

    this.hubConnection.onreconnecting(() => {
      this.onConnectionChange?.(false, 'Reconnecting...');
    });

    this.hubConnection.onreconnected(async () => {
      this.onConnectionChange?.(true);
      if (this.currentDeviceId) {
        try {
          await this.hubConnection?.invoke('RegisterDevice', this.currentDeviceId, 'AnyDesk Client');
        } catch (e) {
          console.error('Re-registration error:', e);
        }
      }
      this.startHeartbeat();
    });

    this.hubConnection.on('SessionIncoming', (data) => {
      this.onSessionIncoming?.(data);
    });

    this.hubConnection.on('SessionApproved', (data) => {
      this.onSessionApproved?.(data);
    });

    this.hubConnection.on('SessionRejected', (data) => {
      this.onSessionRejected?.(data);
    });

    this.hubConnection.on('SessionEnded', (data) => {
      this.onSessionEnded?.(data);
    });

    this.hubConnection.on('ReceiveSignal', (message: SignalMessage) => {
      this.onReceiveSignal?.(message);
    });

    this.hubConnection.on('ReceiveInput', (inputEvent: RemoteInputEvent) => {
      this.onReceiveInput?.(inputEvent);
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(async () => {
      if (this.isConnected() && this.currentDeviceId) {
        try {
          await this.hubConnection?.invoke('Heartbeat', this.currentDeviceId);
        } catch {
          // ignore transient heartbeat error
        }
      }
    }, 10000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public async requestSession(hostDeviceId: string, controllerDeviceId: string, controllerName: string) {
    if (!this.hubConnection || !this.isConnected()) {
      throw new Error('Signaling server is not connected.');
    }
    return await this.hubConnection.invoke('RequestSession', hostDeviceId, controllerDeviceId, controllerName);
  }

  public async respondSession(sessionId: string, approved: boolean, permissions: SessionPermissions) {
    if (!this.hubConnection || !this.isConnected()) return;
    await this.hubConnection.invoke('RespondSession', sessionId, approved, permissions);
  }

  public async sendSignal(message: SignalMessage) {
    if (!this.hubConnection || !this.isConnected()) return;
    try {
      await this.hubConnection.invoke('SendSignal', message);
    } catch (e) {
      console.error('Failed to send signaling message:', e);
    }
  }

  public async sendInput(inputEvent: RemoteInputEvent) {
    if (!this.hubConnection || !this.isConnected()) return;
    try {
      await this.hubConnection.invoke('SendInput', inputEvent);
    } catch (e) {
      console.error('Failed to send input event via SignalR:', e);
    }
  }

  public async endSession(sessionId: string) {
    if (!this.hubConnection || !this.isConnected()) return;
    try {
      await this.hubConnection.invoke('EndSession', sessionId);
    } catch {
      // ignore
    }
  }

  public async disconnect() {
    this.stopHeartbeat();
    if (this.hubConnection) {
      try {
        await this.hubConnection.stop();
      } catch {
        // ignore
      }
      this.hubConnection = null;
    }
    this.onConnectionChange?.(false);
  }
}

export const signalRService = new SignalRService();
