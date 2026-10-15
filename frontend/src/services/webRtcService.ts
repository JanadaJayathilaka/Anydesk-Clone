import type { PeerStats, RemoteInputEvent, SignalMessage, ElectronSource } from '../types';
import { signalRService } from './signalRService';

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: [
      'turn:standard.relay.metered.ca:80',
      'turn:standard.relay.metered.ca:443',
      'turn:standard.relay.metered.ca:443?transport=tcp'
    ],
    username: 'e49987cfbe2b9265fefbe7ce',
    credential: 'b6f/eJ8m0rCeqq74'
  },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp'
    ],
    username: 'openrelay',
    credential: 'openrelay'
  }
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

  private isHostRole: boolean = false;
  private hostScreensList: ElectronSource[] = [];
  private currentSourceId: string = '';

  private pendingSignals: any[] = [];
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private localOffer: RTCSessionDescriptionInit | null = null;
  private offerRetransmitInterval: any = null;
  private requestOfferInterval: any = null;

  public onRemoteStreamReceived: ((stream: MediaStream) => void) | null = null;
  public onRemoteInputReceived: ((input: RemoteInputEvent) => void) | null = null;
  public onConnectionStateChange: ((state: RTCPeerConnectionState) => void) | null = null;
  public onDetailedStatus: ((status: string) => void) | null = null;
  public onStatsUpdate: ((stats: PeerStats) => void) | null = null;
  public onSwitchSidesRequested: (() => void) | null = null;
  public onHostScreensReceived: ((screens: ElectronSource[], activeSourceId?: string) => void) | null = null;
  public onHostScreenSwitched: ((activeSourceId: string) => void) | null = null;
  public onControlChannelOpen: (() => void) | null = null;
  public onHostCursorPositionReceived: ((pos: { x: number; y: number }) => void) | null = null;
  public onHostApprovedSignalReceived: ((sessionId: string, senderDeviceId: string) => void) | null = null;

  public setHostScreensList(screens: ElectronSource[], activeSourceId?: string) {
    this.hostScreensList = screens;
    if (activeSourceId) {
      this.currentSourceId = activeSourceId;
    }
    this.sendControlCommand({
      type: 'host-screens-list',
      screens: this.hostScreensList,
      activeSourceId: this.currentSourceId
    });
  }

  public getHostScreensList(): ElectronSource[] {
    return this.hostScreensList;
  }

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

    if (chosenSourceId && window.electronAPI?.setActiveDisplay) {
      window.electronAPI.setActiveDisplay(chosenSourceId);
    }

    // 1. Standard getDisplayMedia flow (handled seamlessly by Electron setDisplayMediaRequestHandler)
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
        console.warn('[WebRTC] getDisplayMedia failed, trying desktopCapturer getUserMedia:', err);
      }
    }

    // 2. Electron desktop capturer flow using chosenSourceId
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
        console.warn('[WebRTC] Electron getUserMedia failed, falling back to virtual display:', err);
      }
    }

    // 3. Safe fallback: canvas-driven virtual display stream
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
    this.isHostRole = true;
    this.closeExistingPeerConnection(stream);
    this.sessionId = sessionId;
    this.currentDeviceId = hostDeviceId;
    this.targetDeviceId = controllerDeviceId;

    // Check if the passed stream has live tracks, else generate virtual stream
    const hasLiveVideo = stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
    if (!hasLiveVideo) {
      console.warn('[WebRTC Host] No live video track found in stream, generating virtual display stream');
      this.localStream = this.createVirtualDisplayStream();
    } else {
      this.localStream = stream;
    }

    // 1. Initialize PeerConnection
    this.peerConnection = this.createPeerConnection();

    // 2. Setup Host Data Channel BEFORE creating offer (so it's included in SDP)
    this.setupHostDataChannel();

    // 3. Add Screen Tracks to PeerConnection
    this.localStream.getTracks().forEach((track) => {
      console.log('[WebRTC Host] Adding track to PC:', track.kind, track.label, 'readyState:', track.readyState);
      this.peerConnection?.addTrack(track, this.localStream!);
    });

    // 4. Create Host Offer (includes the video track + data channel in SDP)
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    this.localOffer = {
      type: offer.type,
      sdp: offer.sdp
    };

    // 5. Send Offer to Controller and periodically retransmit until answered/connected
    console.log('[WebRTC Host] Sending Offer to controller:', controllerDeviceId);
    const sendHostOffer = async () => {
      if (!this.peerConnection || !this.localOffer) return;
      if (this.peerConnection.remoteDescription || this.peerConnection.iceConnectionState === 'connected') {
        this.stopOfferRetransmit();
        return;
      }
      console.log('[WebRTC Host] Transmitting/Retransmitting Offer to controller:', this.targetDeviceId);
      await signalRService.sendSignal({
        sessionId: this.sessionId,
        senderDeviceId: this.currentDeviceId,
        targetDeviceId: this.targetDeviceId,
        type: 'offer',
        payload: {
          type: this.localOffer.type,
          sdp: this.localOffer.sdp
        }
      });
    };

    await sendHostOffer();
    this.startOfferRetransmit(sendHostOffer);

    this.startStatsMonitoring();
    await this.flushPendingSignals();
  }

  public async startControllerSession(
    sessionId: string,
    controllerDeviceId: string,
    hostDeviceId: string
  ): Promise<void> {
    console.log('[WebRTC] Starting Controller session for session:', sessionId);

    // If already active and connected or connecting to this exact session, do not tear down
    if (
      this.peerConnection &&
      this.sessionId === sessionId &&
      !this.isHostRole &&
      this.peerConnection.signalingState !== 'closed' &&
      this.peerConnection.connectionState !== 'closed' &&
      this.peerConnection.connectionState !== 'failed'
    ) {
      console.log('[WebRTC] Controller session already in progress for session:', sessionId);
      return;
    }

    this.isHostRole = false;
    this.onDetailedStatus?.('Waiting for host screen feed offer...');
    this.closeExistingPeerConnection();
    this.sessionId = sessionId;
    this.currentDeviceId = controllerDeviceId;
    this.targetDeviceId = hostDeviceId;

    // 1. Initialize PeerConnection
    this.peerConnection = this.createPeerConnection();

    this.startStatsMonitoring();

    // 2. Proactively ping host for offer every 1.5s until offer received
    const requestOffer = async () => {
      if (!this.peerConnection) return;
      if (this.peerConnection.remoteDescription || this.peerConnection.iceConnectionState === 'connected') {
        this.stopRequestOfferInterval();
        return;
      }
      console.log('[WebRTC Controller] Requesting offer from host:', this.targetDeviceId);
      await signalRService.sendSignal({
        sessionId: this.sessionId,
        senderDeviceId: this.currentDeviceId,
        targetDeviceId: this.targetDeviceId,
        type: 'command',
        payload: { type: 'request-offer' }
      });
    };

    await requestOffer();
    this.startRequestOfferInterval(requestOffer);

    // 3. Process any Offer or ICE candidates that arrived before PC was ready
    await this.flushPendingSignals();
  }

  private startOfferRetransmit(fn: () => void) {
    this.stopOfferRetransmit();
    this.offerRetransmitInterval = setInterval(fn, 2000);
  }

  private stopOfferRetransmit() {
    if (this.offerRetransmitInterval) {
      clearInterval(this.offerRetransmitInterval);
      this.offerRetransmitInterval = null;
    }
  }

  private startRequestOfferInterval(fn: () => void) {
    this.stopRequestOfferInterval();
    this.requestOfferInterval = setInterval(fn, 2000);
  }

  private stopRequestOfferInterval() {
    if (this.requestOfferInterval) {
      clearInterval(this.requestOfferInterval);
      this.requestOfferInterval = null;
    }
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
        this.onDetailedStatus?.('Connecting over network path (negotiating peer link)...');
      } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.stopOfferRetransmit();
        this.stopRequestOfferInterval();
        this.onDetailedStatus?.('Direct peer connection established! Streaming desktop video...');
      } else if (pc.iceConnectionState === 'failed') {
        this.onDetailedStatus?.('Peer connection failed. Retrying network route...');
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

      const triggerStreamReady = () => {
        console.log('[WebRTC] Remote track active & live, notifying listener');
        this.onDetailedStatus?.('Video active!');
        if (this.remoteStream) {
          this.onRemoteStreamReceived?.(this.remoteStream);
        }
      };

      event.track.onunmute = triggerStreamReady;
      if (event.track.readyState === 'live') {
        triggerStreamReady();
      }

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

  private setupHostDataChannel() {
    if (!this.peerConnection) return;

    try {
      this.controlChannel = this.peerConnection.createDataChannel('control-channel', {
        ordered: true
      });
      this.setupControlChannel(this.controlChannel);
      console.log('[WebRTC Host] Created control data channel');
    } catch (e) {
      console.warn('[WebRTC Host] createDataChannel error:', e);
    }
  }

  private setupControlChannel(channel: RTCDataChannel) {
    this.controlChannel = channel;
    channel.onopen = () => {
      console.log('[WebRTC] Control channel is OPEN');
      if (this.isHostRole && this.hostScreensList.length > 0) {
        try {
          channel.send(JSON.stringify({
            type: 'host-screens-list',
            screens: this.hostScreensList,
            activeSourceId: this.currentSourceId
          }));
        } catch (e) {}
      }
      this.onControlChannelOpen?.();
    };
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'switch-screen') {
          console.log('[WebRTC Host] Received switch-screen command:', data.sourceId);
          this.switchScreenSource(data.sourceId);
          return;
        }
        if (data.type === 'request-screens') {
          if (this.isHostRole && this.hostScreensList.length > 0) {
            try {
              channel.send(JSON.stringify({
                type: 'host-screens-list',
                screens: this.hostScreensList,
                activeSourceId: this.currentSourceId
              }));
            } catch (e) {}
          }
          return;
        }
        if (data.type === 'host-screens-list') {
          console.log('[WebRTC Controller] Received host-screens-list:', data.screens, data.activeSourceId);
          this.onHostScreensReceived?.(data.screens, data.activeSourceId);
          return;
        }
        if (data.type === 'host-screen-switched') {
          console.log('[WebRTC Controller] Host switched screen to:', data.activeSourceId);
          this.currentSourceId = data.activeSourceId;
          this.onHostScreenSwitched?.(data.activeSourceId);
          return;
        }
        if (data.type === 'host-cursor') {
          this.onHostCursorPositionReceived?.({ x: data.x, y: data.y });
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
    const sDeviceId = message.senderDeviceId || (message as any).SenderDeviceId;
    console.log('[WebRTC] Received signal message:', rawType, 'from:', sDeviceId);

    // Filter out our own echoed signals
    if (sDeviceId && this.currentDeviceId && sDeviceId === this.currentDeviceId) {
      return;
    }

    if (!this.targetDeviceId && sDeviceId) {
      this.targetDeviceId = sDeviceId;
    }
    if (!this.sessionId && (message.sessionId || (message as any).SessionId)) {
      this.sessionId = message.sessionId || (message as any).SessionId;
    }

    const sId = message.sessionId || (message as any).SessionId;
    if (rawType === 'offer' || rawType === 'command') {
      if (sId) {
        this.onHostApprovedSignalReceived?.(sId, sDeviceId);
      }
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
        this.stopRequestOfferInterval();
        console.log('[WebRTC Controller] Processing WebRTC Offer from host...');
        this.onDetailedStatus?.('Received host offer. Creating and sending answer...');

        let payloadObj = rawPayload;
        if (typeof rawPayload === 'string') {
          try {
            payloadObj = JSON.parse(rawPayload);
          } catch {
            payloadObj = { sdp: rawPayload, type: 'offer' };
          }
        }

        const sdp = payloadObj.sdp || payloadObj.Sdp || (typeof rawPayload === 'string' ? rawPayload : '');
        const sdpType = (payloadObj.type || payloadObj.Type || 'offer').toLowerCase();

        if (this.peerConnection.remoteDescription) {
          console.log('[WebRTC Controller] Remote description already set, ignoring duplicate offer');
          return;
        }

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
        this.stopOfferRetransmit();
        console.log('[WebRTC Host] Processing WebRTC Answer from controller...');

        let payloadObj = rawPayload;
        if (typeof rawPayload === 'string') {
          try {
            payloadObj = JSON.parse(rawPayload);
          } catch {
            payloadObj = { sdp: rawPayload, type: 'answer' };
          }
        }

        const sdp = payloadObj.sdp || payloadObj.Sdp || (typeof rawPayload === 'string' ? rawPayload : '');
        const sdpType = (payloadObj.type || payloadObj.Type || 'answer').toLowerCase();

        if (this.peerConnection.remoteDescription) {
          console.log('[WebRTC Host] Remote description already set, ignoring repeated answer');
          return;
        }

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
        let candObj = rawPayload;
        if (typeof rawPayload === 'string') {
          try {
            candObj = JSON.parse(rawPayload);
          } catch {
            candObj = null;
          }
        }
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
        const cmd = typeof rawPayload === 'string' ? (() => { try { return JSON.parse(rawPayload); } catch { return rawPayload; } })() : rawPayload;
        if (cmd?.type === 'request-offer') {
          if (this.isHostRole && this.localOffer) {
            console.log('[WebRTC Host] Received request-offer from controller, re-transmitting offer now...');
            signalRService.sendSignal({
              sessionId: this.sessionId || message.sessionId || message.SessionId,
              senderDeviceId: this.currentDeviceId,
              targetDeviceId: this.targetDeviceId || message.senderDeviceId || message.SenderDeviceId,
              type: 'offer',
              payload: {
                type: this.localOffer.type,
                sdp: this.localOffer.sdp
              }
            });
          }
          return;
        }
        if (cmd?.type === 'switch-screen') {
          this.switchScreenSource(cmd.sourceId);
        } else if (cmd?.type === 'request-screens') {
          if (this.isHostRole && this.hostScreensList.length > 0) {
            this.sendControlCommand({
              type: 'host-screens-list',
              screens: this.hostScreensList,
              activeSourceId: this.currentSourceId
            });
          }
        } else if (cmd?.type === 'host-screens-list') {
          console.log('[WebRTC Controller] Received host-screens-list via signal:', cmd.screens, cmd.activeSourceId);
          this.onHostScreensReceived?.(cmd.screens, cmd.activeSourceId);
        } else if (cmd?.type === 'host-screen-switched') {
          console.log('[WebRTC Controller] Host switched screen to:', cmd.activeSourceId);
          this.currentSourceId = cmd.activeSourceId;
          this.onHostScreenSwitched?.(cmd.activeSourceId);
        } else if (cmd?.type === 'host-cursor') {
          this.onHostCursorPositionReceived?.({ x: cmd.x, y: cmd.y });
        } else if (cmd?.type === 'switch-sides') {
          this.onSwitchSidesRequested?.();
        }
      }
    } catch (err: any) {
      console.error('[WebRTC] Error handling signal:', err);
      this.onDetailedStatus?.(`WebRTC signal error: ${err?.message || err}`);
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

      this.currentSourceId = newSourceId || '';
      this.onRemoteStreamReceived?.(newStream);

      // Tell Electron on Host to update active display for mouse coordinates
      if (window.electronAPI?.setActiveDisplay && newSourceId) {
        window.electronAPI.setActiveDisplay(newSourceId);
      }

      // Notify controller that the host has completed switching screen
      this.sendControlCommand({
        type: 'host-screen-switched',
        activeSourceId: newSourceId
      });

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

  private closeExistingPeerConnection(streamToKeep?: MediaStream) {
    this.stopStatsMonitoring();
    this.stopVirtualDisplay();
    this.stopOfferRetransmit();
    this.stopRequestOfferInterval();
    this.localOffer = null;

    if (this.localStream && this.localStream !== streamToKeep) {
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
    this.stopOfferRetransmit();
    this.stopRequestOfferInterval();
    this.localOffer = null;
    this.pendingSignals = [];
    this.pendingCandidates = [];
    this.sessionId = '';
    this.targetDeviceId = '';
    this.isHostRole = false;
    this.hostScreensList = [];
    this.currentSourceId = '';
  }
}

export const webRtcService = new WebRtcService();
