import type { ChatMessage, PeerStats, RemoteInputEvent, SignalMessage } from '../types';
import { signalRService } from './signalRService';

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

export class WebRtcService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private chatChannel: RTCDataChannel | null = null;
  private statsInterval: any = null;
  private virtualCanvasInterval: any = null;

  private sessionId: string = '';
  private currentDeviceId: string = '';
  private targetDeviceId: string = '';

  private pendingSignals: SignalMessage[] = [];

  public onRemoteStreamReceived: ((stream: MediaStream) => void) | null = null;
  public onRemoteInputReceived: ((input: RemoteInputEvent) => void) | null = null;
  public onChatMessageReceived: ((msg: ChatMessage) => void) | null = null;
  public onConnectionStateChange: ((state: RTCPeerConnectionState) => void) | null = null;
  public onStatsUpdate: ((stats: PeerStats) => void) | null = null;

  public async acquireScreenStream(sourceId?: string): Promise<MediaStream> {
    // 1. Electron desktop capturer flow
    if (window.electronAPI && sourceId) {
      const constraints: any = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080,
            maxFrameRate: 60
          }
        }
      };
      return await (navigator.mediaDevices as any).getUserMedia(constraints);
    }

    // 2. Browser standard getDisplayMedia flow
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      return await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
    }

    throw new Error('Screen capture not supported in this environment');
  }

  public createVirtualDisplayStream(): MediaStream {
    this.stopVirtualDisplay();

    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d')!;

    let frame = 0;
    const render = () => {
      frame++;
      // Background gradient
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(0.5, '#1e1b4b');
      grad.addColorStop(1, '#020617');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Windows taskbar
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, canvas.height - 48, canvas.width, 48);

      // Start button icon (blue square)
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(16, canvas.height - 36, 24, 24);

      // AnyDesk red orb in center
      ctx.fillStyle = 'rgba(243, 34, 58, 0.2)';
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2 - 20, 140, 0, Math.PI * 2);
      ctx.fill();

      // Heading
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AnyDesk Virtual Remote Desktop', canvas.width / 2, canvas.height / 2 - 40);

      // Subtitle
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 20px "Segoe UI", sans-serif';
      ctx.fillText(`Host Active • Device ID: ${this.currentDeviceId || 'Host PC'} • Frame: ${frame}`, canvas.width / 2, canvas.height / 2 + 10);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px "Segoe UI", sans-serif';
      ctx.fillText('Move mouse or type on Controller to interact with Host', canvas.width / 2, canvas.height / 2 + 50);

      // Clock
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '16px "Segoe UI", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(new Date().toLocaleTimeString(), canvas.width - 24, canvas.height - 18);
    };

    render();
    this.virtualCanvasInterval = setInterval(render, 1000 / 30);
    return canvas.captureStream(30);
  }

  private stopVirtualDisplay() {
    if (this.virtualCanvasInterval) {
      clearInterval(this.virtualCanvasInterval);
      this.virtualCanvasInterval = null;
    }
  }

  public async startHostSessionWithStream(
    sessionId: string,
    hostDeviceId: string,
    controllerDeviceId: string,
    stream: MediaStream
  ): Promise<void> {
    this.cleanUp();
    this.sessionId = sessionId;
    this.currentDeviceId = hostDeviceId;
    this.targetDeviceId = controllerDeviceId;
    this.localStream = stream;

    // 1. Initialize PeerConnection
    this.peerConnection = this.createPeerConnection();

    // 2. Add Screen Tracks to PeerConnection
    this.localStream.getTracks().forEach((track) => {
      this.peerConnection?.addTrack(track, this.localStream!);
    });

    // 3. Create Host Offer
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // 4. Send Offer to Controller
    await signalRService.sendSignal({
      sessionId: this.sessionId,
      senderDeviceId: this.currentDeviceId,
      targetDeviceId: this.targetDeviceId,
      type: 'offer',
      payload: offer
    });

    this.startStatsMonitoring();
    await this.flushPendingSignals();
  }

  public async startControllerSession(
    sessionId: string,
    controllerDeviceId: string,
    hostDeviceId: string
  ): Promise<void> {
    this.cleanUp();
    this.sessionId = sessionId;
    this.currentDeviceId = controllerDeviceId;
    this.targetDeviceId = hostDeviceId;

    // 1. Initialize PeerConnection
    this.peerConnection = this.createPeerConnection();

    // 2. Setup Data Channels as initiator
    this.setupControllerDataChannels();

    this.startStatsMonitoring();
    await this.flushPendingSignals();
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: DEFAULT_ICE_SERVERS
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signalRService.sendSignal({
          sessionId: this.sessionId,
          senderDeviceId: this.currentDeviceId,
          targetDeviceId: this.targetDeviceId,
          type: 'candidate',
          payload: event.candidate.toJSON()
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('WebRTC Connection state:', pc.connectionState);
      this.onConnectionStateChange?.(pc.connectionState);
    };

    pc.ontrack = (event) => {
      console.log('WebRTC received remote track:', event.track.kind);
      let stream = event.streams && event.streams[0];
      if (!stream) {
        stream = new MediaStream([event.track]);
      }
      this.remoteStream = stream;
      this.onRemoteStreamReceived?.(this.remoteStream);
    };

    // If host, receive data channels created by controller
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === 'control-channel') {
        this.setupControlChannel(channel);
      } else if (channel.label === 'chat-channel') {
        this.setupChatChannel(channel);
      }
    };

    return pc;
  }

  private setupControllerDataChannels() {
    if (!this.peerConnection) return;

    this.controlChannel = this.peerConnection.createDataChannel('control-channel', {
      ordered: false,
      maxRetransmits: 0
    });
    this.setupControlChannel(this.controlChannel);

    this.chatChannel = this.peerConnection.createDataChannel('chat-channel', {
      ordered: true
    });
    this.setupChatChannel(this.chatChannel);
  }

  private setupControlChannel(channel: RTCDataChannel) {
    this.controlChannel = channel;
    channel.onmessage = (event) => {
      try {
        const input: RemoteInputEvent = JSON.parse(event.data);
        this.onRemoteInputReceived?.(input);
      } catch (err) {
        console.error('Failed to parse input event over datachannel:', err);
      }
    };
  }

  private setupChatChannel(channel: RTCDataChannel) {
    this.chatChannel = channel;
    channel.onmessage = (event) => {
      try {
        const msg: ChatMessage = JSON.parse(event.data);
        this.onChatMessageReceived?.(msg);
      } catch (err) {
        console.error('Failed to parse chat message over datachannel:', err);
      }
    };
  }

  public async handleSignalMessage(message: SignalMessage) {
    if (!this.targetDeviceId && message.senderDeviceId) {
      this.targetDeviceId = message.senderDeviceId;
    }

    if (!this.peerConnection) {
      console.log('PeerConnection not yet initialized, queueing signal:', message.type);
      this.pendingSignals.push(message);
      return;
    }

    await this.processSignal(message);
  }

  private async processSignal(message: SignalMessage) {
    if (!this.peerConnection) return;

    try {
      if (message.type === 'offer') {
        console.log('Processing WebRTC Offer from host...');
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        await signalRService.sendSignal({
          sessionId: this.sessionId,
          senderDeviceId: this.currentDeviceId,
          targetDeviceId: this.targetDeviceId,
          type: 'answer',
          payload: answer
        });
      } else if (message.type === 'answer') {
        console.log('Processing WebRTC Answer from controller...');
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload));
      } else if (message.type === 'candidate') {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(message.payload));
        } catch (e) {
          console.warn('ICE candidate addition failed:', e);
        }
      }
    } catch (err) {
      console.error('Error handling WebRTC signal:', err);
    }
  }

  private async flushPendingSignals() {
    while (this.pendingSignals.length > 0) {
      const msg = this.pendingSignals.shift()!;
      await this.processSignal(msg);
    }
  }

  public sendInputEvent(input: RemoteInputEvent) {
    if (this.controlChannel && this.controlChannel.readyState === 'open') {
      try {
        this.controlChannel.send(JSON.stringify(input));
        return;
      } catch (e) {
        // Fall back to SignalR
      }
    }
    signalRService.sendInput(input);
  }

  public sendChatMessage(text: string, senderName: string): ChatMessage {
    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      sender: senderName,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isSelf: true
    };

    if (this.chatChannel && this.chatChannel.readyState === 'open') {
      this.chatChannel.send(JSON.stringify({ ...msg, isSelf: false }));
    } else {
      signalRService.sendSignal({
        sessionId: this.sessionId,
        senderDeviceId: this.currentDeviceId,
        targetDeviceId: this.targetDeviceId,
        type: 'chat',
        payload: { ...msg, isSelf: false }
      });
    }

    return msg;
  }

  private startStatsMonitoring() {
    this.stopStatsMonitoring();

    this.statsInterval = setInterval(async () => {
      if (!this.peerConnection) return;
      try {
        const stats = await this.peerConnection.getStats();
        let rtt = 14;
        let fps = 60;
        let resolution = '1920x1080';
        let bytesRecv = 0;
        let packetsLost = 0;

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.currentRoundTripTime) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            fps = report.framesPerSecond || 60;
            if (report.frameWidth && report.frameHeight) {
              resolution = `${report.frameWidth}x${report.frameHeight}`;
            }
            bytesRecv = report.bytesReceived || 0;
            packetsLost = report.packetsLost || 0;
          }
        });

        this.onStatsUpdate?.({
          rttMs: rtt || 14,
          fps: fps || 60,
          resolution,
          bytesReceived: bytesRecv,
          packetsLost
        });
      } catch {
        // ignore
      }
    }, 1000);
  }

  private stopStatsMonitoring() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  public cleanUp() {
    this.stopStatsMonitoring();
    this.stopVirtualDisplay();
    this.pendingSignals = [];

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.controlChannel) {
      this.controlChannel.close();
      this.controlChannel = null;
    }
    if (this.chatChannel) {
      this.chatChannel.close();
      this.chatChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.remoteStream = null;
  }
}

export const webRtcService = new WebRtcService();
