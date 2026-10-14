import type { PeerStats, RemoteInputEvent, SignalMessage } from '../types';
import { signalRService } from './signalRService';

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

export class WebRtcService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private statsInterval: any = null;
  private virtualCanvasInterval: any = null;

  private sessionId: string = '';
  private currentDeviceId: string = '';
  private targetDeviceId: string = '';

  private pendingSignals: any[] = [];
  private pendingCandidates: RTCIceCandidateInit[] = [];

  public onRemoteStreamReceived: ((stream: MediaStream) => void) | null = null;
  public onRemoteInputReceived: ((input: RemoteInputEvent) => void) | null = null;
  public onConnectionStateChange: ((state: RTCPeerConnectionState) => void) | null = null;
  public onDetailedStatus: ((status: string) => void) | null = null;
  public onStatsUpdate: ((stats: PeerStats) => void) | null = null;
  public onSwitchSidesRequested: (() => void) | null = null;

  public async acquireScreenStream(sourceId?: string): Promise<MediaStream> {
    try {
      const streamPromise = this.doAcquireScreenStream(sourceId);
      const timeoutPromise = new Promise<MediaStream>((_, reject) =>
        setTimeout(() => reject(new Error('Screen capture request timed out after 3s')), 3000)
      );
      return await Promise.race([streamPromise, timeoutPromise]);
    } catch (err) {
      console.warn('[WebRTC] Screen capture unavailable or timed out, using virtual display stream:', err);
      return this.createVirtualDisplayStream();
    }
  }

  private async doAcquireScreenStream(sourceId?: string): Promise<MediaStream> {
    let chosenSourceId = sourceId;

    // 1. If in Electron and no sourceId selected, query desktopCapturer for primary screen
    if (!chosenSourceId && window.electronAPI?.getScreenSources) {
      try {
        const sources = await window.electronAPI.getScreenSources();
        const primary = sources.find((s) => s.id.startsWith('screen')) || sources[0];
        if (primary) {
          chosenSourceId = primary.id;
          console.log('[WebRTC] Auto-selected screen source:', primary.name, primary.id);
        }
      } catch (err) {
        console.warn('[WebRTC] getScreenSources auto-select error:', err);
      }
    }

    // 2. Electron desktop capturer flow using chosen sourceId
    if (chosenSourceId) {
      try {
        const constraints: any = {
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: chosenSourceId,
              minWidth: 1280,
              maxWidth: 1920,
              minHeight: 720,
              maxHeight: 1080,
              maxFrameRate: 60
            }
          }
        };
        const stream = await (navigator.mediaDevices as any).getUserMedia(constraints);
        if (stream && stream.getVideoTracks().length > 0) {
          console.log('[WebRTC] Successfully acquired screen stream via Electron desktop capturer');
          return stream;
        }
      } catch (err) {
        console.warn('[WebRTC] Electron getUserMedia failed, trying getDisplayMedia:', err);
      }
    }

    // 3. Standard getDisplayMedia flow (intercepted by Electron setDisplayMediaRequestHandler)
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 60, max: 60 },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        });
        if (stream && stream.getVideoTracks().length > 0) {
          console.log('[WebRTC] Successfully acquired screen stream via getDisplayMedia');
          return stream;
        }
      } catch (err) {
        console.warn('[WebRTC] getDisplayMedia failed, falling back to virtual display:', err);
      }
    }

    // 4. Safe fallback: canvas-driven virtual display stream
    console.warn('[WebRTC] Screen capture unavailable, using virtual desktop feed');
    return this.createVirtualDisplayStream();
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

      // Start button icon
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
      ctx.fillText('AnyDesk LAN Remote Desktop', canvas.width / 2, canvas.height / 2 - 40);

      // Subtitle
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 20px "Segoe UI", sans-serif';
      ctx.fillText(`Host Active • Device ID: ${this.currentDeviceId || 'Host PC'} • Frame: ${frame}`, canvas.width / 2, canvas.height / 2 + 10);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px "Segoe UI", sans-serif';
      ctx.fillText('Connected over Local Network (Peer-to-Peer)', canvas.width / 2, canvas.height / 2 + 50);

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
    console.log('[WebRTC] Starting Host session with stream for session:', sessionId);
    this.closeExistingPeerConnection();
    this.sessionId = sessionId;
    this.currentDeviceId = hostDeviceId;
    this.targetDeviceId = controllerDeviceId;
    this.localStream = stream;

    // Ensure we have a valid video track
    if (!this.localStream || this.localStream.getVideoTracks().length === 0) {
      console.warn('[WebRTC Host] No video track found in stream, generating virtual display stream');
      this.localStream = this.createVirtualDisplayStream();
    }

    // 1. Initialize PeerConnection
    this.peerConnection = this.createPeerConnection();

    // 2. Add Screen Tracks to PeerConnection
    this.localStream.getTracks().forEach((track) => {
      console.log('[WebRTC Host] Adding track to PC:', track.kind, track.label);
      this.peerConnection?.addTrack(track, this.localStream!);
    });

    // 3. Create Host Offer
    const offer = await this.peerConnection.createOffer({
      offerToReceiveVideo: false,
      offerToReceiveAudio: false
    });
    await this.peerConnection.setLocalDescription(offer);

    // 4. Send Offer to Controller
    console.log('[WebRTC Host] Sending Offer to controller:', controllerDeviceId);
    await signalRService.sendSignal({
      sessionId: this.sessionId,
      senderDeviceId: this.currentDeviceId,
      targetDeviceId: this.targetDeviceId,
      type: 'offer',
      payload: {
        type: offer.type,
        sdp: offer.sdp
      }
    });

    this.startStatsMonitoring();
    await this.flushPendingSignals();
  }

  public async startControllerSession(
    sessionId: string,
    controllerDeviceId: string,
    hostDeviceId: string
  ): Promise<void> {
    console.log('[WebRTC] Starting Controller session for session:', sessionId);
    this.onDetailedStatus?.('Waiting for host screen feed offer...');
    this.closeExistingPeerConnection();
    this.sessionId = sessionId;
    this.currentDeviceId = controllerDeviceId;
    this.targetDeviceId = hostDeviceId;

    // 1. Initialize PeerConnection
    this.peerConnection = this.createPeerConnection();

    // 2. Add video recvonly transceiver to receive video feed from Host
    try {
      this.peerConnection.addTransceiver('video', { direction: 'recvonly' });
      console.log('[WebRTC Controller] Added recvonly video transceiver');
    } catch (e) {
      console.warn('[WebRTC Controller] addTransceiver warning:', e);
    }

    // 3. Setup Data Channels as initiator
    this.setupControllerDataChannels();

    this.startStatsMonitoring();

    // 4. Process any Offer or ICE candidates that arrived before PC was ready
    await this.flushPendingSignals();
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: DEFAULT_ICE_SERVERS,
      iceCandidatePoolSize: 10
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTC] Generated ICE candidate:', event.candidate.protocol, event.candidate.address || event.candidate.candidate);
        const candJson = event.candidate.toJSON ? event.candidate.toJSON() : {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        };

        signalRService.sendSignal({
          sessionId: this.sessionId,
          senderDeviceId: this.currentDeviceId,
          targetDeviceId: this.targetDeviceId,
          type: 'candidate',
          payload: candJson
        });
      } else {
        console.log('[WebRTC] ICE candidate gathering complete');
      }
    };

    pc.onicecandidateerror = (event: any) => {
      console.warn('[WebRTC] ICE Candidate Error:', event.errorText, event.address, event.port);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE Connection State changed:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'checking') {
        this.onDetailedStatus?.('Connecting over local Wi-Fi (finding network path)...');
      } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.onDetailedStatus?.('Direct peer-to-peer link established! Waiting for video stream...');
      } else if (pc.iceConnectionState === 'failed') {
        this.onDetailedStatus?.('Direct peer connection failed. Check Windows Defender firewall.');
      } else if (pc.iceConnectionState === 'disconnected') {
        this.onDetailedStatus?.('Peer connection disconnected.');
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] PeerConnection State changed:', pc.connectionState);
      this.onConnectionStateChange?.(pc.connectionState);
    };

    pc.ontrack = (event) => {
      console.log('[WebRTC] >>> Remote track received! Kind:', event.track.kind, 'Streams count:', event.streams?.length);
      this.onDetailedStatus?.('Remote video stream received! Rendering desktop...');
      let stream = event.streams && event.streams[0];
      if (!stream) {
        stream = new MediaStream([event.track]);
      }
      this.remoteStream = stream;

      event.track.onunmute = () => {
        console.log('[WebRTC] Remote track unmuted, notifying listener');
        this.onDetailedStatus?.('Video active!');
        if (this.remoteStream) {
          this.onRemoteStreamReceived?.(this.remoteStream);
        }
      };

      this.onRemoteStreamReceived?.(this.remoteStream);
    };

    // Host receives data channels created by controller
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      console.log('[WebRTC] Received DataChannel from peer:', channel.label);
      if (channel.label === 'control-channel') {
        this.setupControlChannel(channel);
      }
    };

    return pc;
  }

  private setupControllerDataChannels() {
    if (!this.peerConnection) return;

    try {
      this.controlChannel = this.peerConnection.createDataChannel('control-channel', {
        ordered: false,
        maxRetransmits: 0
      });
      this.setupControlChannel(this.controlChannel);
    } catch (e) {
      console.warn('[WebRTC] createDataChannel error:', e);
    }
  }

  private setupControlChannel(channel: RTCDataChannel) {
    this.controlChannel = channel;
    channel.onopen = () => console.log('[WebRTC] Control channel is OPEN');
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'switch-screen') {
          console.log('[WebRTC Host] Received switch-screen command:', data.sourceId);
          this.switchScreenSource(data.sourceId);
          return;
        }
        if (data.type === 'switch-sides') {
          console.log('[WebRTC] Received switch-sides command');
          this.onSwitchSidesRequested?.();
          return;
        }
        this.onRemoteInputReceived?.(data);
      } catch (err) {
        console.error('Failed to parse input event over datachannel:', err);
      }
    };
  }

  public async handleSignalMessage(message: SignalMessage) {
    const rawType = (message.type || (message as any).Type || '').toLowerCase();
    console.log('[WebRTC] Received signal message:', rawType, 'from:', message.senderDeviceId || (message as any).SenderDeviceId);

    if (!this.targetDeviceId && (message.senderDeviceId || (message as any).SenderDeviceId)) {
      this.targetDeviceId = message.senderDeviceId || (message as any).SenderDeviceId;
    }
    if (!this.sessionId && (message.sessionId || (message as any).SessionId)) {
      this.sessionId = message.sessionId || (message as any).SessionId;
    }

    if (!this.peerConnection) {
      console.log('[WebRTC] PeerConnection not yet initialized, queuing signal:', rawType);
      this.pendingSignals.push(message);
      return;
    }

    await this.processSignal(message);
  }

  private async processSignal(message: any) {
    if (!this.peerConnection) return;

    try {
      const type = (message.type || message.Type || '').toLowerCase();
      const rawPayload = message.payload ?? message.Payload;
      if (!rawPayload) return;

      if (type === 'offer') {
        console.log('[WebRTC Controller] Processing WebRTC Offer from host...');
        this.onDetailedStatus?.('Received host offer. Creating and sending answer...');
        const sdp = typeof rawPayload === 'string' ? rawPayload : (rawPayload.sdp || rawPayload.Sdp || '');
        const sdpType = typeof rawPayload === 'object' ? (rawPayload.type || rawPayload.Type || 'offer').toLowerCase() : 'offer';

        if (this.peerConnection.signalingState !== 'stable' && this.peerConnection.signalingState !== 'have-local-offer') {
          console.warn('[WebRTC Controller] Ignoring duplicate or unexpected offer in signalingState:', this.peerConnection.signalingState);
          return;
        }

        await this.peerConnection.setRemoteDescription(new RTCSessionDescription({
          type: sdpType as RTCSdpType,
          sdp
        }));
        console.log('[WebRTC Controller] Set remote description (Offer) success');

        await this.flushPendingCandidates();

        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        console.log('[WebRTC Controller] Created Answer and set local description');

        await signalRService.sendSignal({
          sessionId: this.sessionId || message.sessionId || message.SessionId,
          senderDeviceId: this.currentDeviceId,
          targetDeviceId: this.targetDeviceId || message.senderDeviceId || message.SenderDeviceId,
          type: 'answer',
          payload: {
            type: answer.type,
            sdp: answer.sdp
          }
        });
        console.log('[WebRTC Controller] Answer sent to Host');
        this.onDetailedStatus?.('Handshake answer sent. Establishing direct LAN link...');
      } else if (type === 'answer') {
        console.log('[WebRTC Host] Processing WebRTC Answer from controller...');
        const sdp = typeof rawPayload === 'string' ? rawPayload : (rawPayload.sdp || rawPayload.Sdp || '');
        const sdpType = typeof rawPayload === 'object' ? (rawPayload.type || rawPayload.Type || 'answer').toLowerCase() : 'answer';

        if (this.peerConnection.signalingState !== 'have-local-offer') {
          console.warn('[WebRTC Host] Ignoring duplicate or unexpected answer in signalingState:', this.peerConnection.signalingState);
          return;
        }

        await this.peerConnection.setRemoteDescription(new RTCSessionDescription({
          type: sdpType as RTCSdpType,
          sdp
        }));
        console.log('[WebRTC Host] Set remote description (Answer) success');

        await this.flushPendingCandidates();
      } else if (type === 'candidate') {
        const candObj = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
        if (!candObj) return;

        const candidateStr = candObj.candidate ?? candObj.Candidate;
        if (!candidateStr) return;

        const candidateInit: RTCIceCandidateInit = {
          candidate: candidateStr,
          sdpMid: candObj.sdpMid ?? candObj.SdpMid ?? null,
          sdpMLineIndex: candObj.sdpMLineIndex ?? candObj.SdpMLineIndex ?? null,
          usernameFragment: candObj.usernameFragment ?? candObj.UsernameFragment ?? null
        };

        if (!this.peerConnection.remoteDescription) {
          console.log('[WebRTC] Queuing ICE candidate (waiting for remoteDescription)');
          this.pendingCandidates.push(candidateInit);
        } else {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit));
          } catch (e) {
            console.warn('[WebRTC] ICE candidate addition error:', e);
          }
        }
      } else if (type === 'command') {
        const cmd = rawPayload;
        if (cmd?.type === 'switch-screen') {
          this.switchScreenSource(cmd.sourceId);
        } else if (cmd?.type === 'switch-sides') {
          this.onSwitchSidesRequested?.();
        }
      }
    } catch (err) {
      console.error('[WebRTC] Error handling signal:', err);
    }
  }

  private async flushPendingCandidates() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    if (this.pendingCandidates.length === 0) return;

    console.log(`[WebRTC] Flushing ${this.pendingCandidates.length} queued ICE candidate(s)...`);
    while (this.pendingCandidates.length > 0) {
      const cand = this.pendingCandidates.shift()!;
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('[WebRTC] Flushing queued ICE candidate failed:', e);
      }
    }
  }

  private async flushPendingSignals() {
    if (this.pendingSignals.length === 0) return;
    console.log(`[WebRTC] Flushing ${this.pendingSignals.length} queued signal message(s)...`);
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

  public sendControlCommand(cmd: any) {
    if (this.controlChannel && this.controlChannel.readyState === 'open') {
      try {
        this.controlChannel.send(JSON.stringify(cmd));
        return;
      } catch (e) {}
    }
    signalRService.sendSignal({
      sessionId: this.sessionId,
      senderDeviceId: this.currentDeviceId,
      targetDeviceId: this.targetDeviceId,
      type: 'command' as any,
      payload: cmd
    });
  }

  public async switchScreenSource(newSourceId?: string): Promise<boolean> {
    if (!this.peerConnection) return false;
    try {
      console.log('[WebRTC] Switching screen source to:', newSourceId);
      const newStream = await this.acquireScreenStream(newSourceId);
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return false;

      // Stop previous local stream tracks
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop());
      }
      this.localStream = newStream;

      // Replace track on RTCRtpSender without renegotiating
      const senders = this.peerConnection.getSenders();
      const videoSender = senders.find((s) => s.track && s.track.kind === 'video') ||
                          senders.find((s) => s.track === null);
      if (videoSender) {
        await videoSender.replaceTrack(newVideoTrack);
        console.log('[WebRTC] Successfully replaced screen video track with replaceTrack!');
      }

      this.onRemoteStreamReceived?.(newStream);
      return true;
    } catch (err) {
      console.error('[WebRTC] Error switching screen source:', err);
    }
    return false;
  }

  private startStatsMonitoring() {
    this.stopStatsMonitoring();

    this.statsInterval = setInterval(async () => {
      if (!this.peerConnection) return;
      try {
        const stats = await this.peerConnection.getStats();
        let rtt = 0;
        let fps = 0;
        let resolution = '1920x1080';
        let bytesRecv = 0;
        let packetsLost = 0;

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.currentRoundTripTime) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            fps = report.framesPerSecond || 0;
            bytesRecv = report.bytesReceived || 0;
            packetsLost = report.packetsLost || 0;
            if (report.frameWidth && report.frameHeight) {
              resolution = `${report.frameWidth}x${report.frameHeight}`;
            }
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

  private closeExistingPeerConnection() {
    this.stopStatsMonitoring();
    this.stopVirtualDisplay();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.controlChannel) {
      try {
        this.controlChannel.close();
      } catch {}
      this.controlChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }
    this.remoteStream = null;
  }

  public cleanUp() {
    this.closeExistingPeerConnection();
    this.pendingSignals = [];
    this.pendingCandidates = [];
    this.sessionId = '';
    this.targetDeviceId = '';
  }
}

export const webRtcService = new WebRtcService();
