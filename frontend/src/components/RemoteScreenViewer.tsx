import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Power,
  MousePointer,
  Maximize,
  Minimize,
  MessageSquare,
  Activity,
  Send,
  X,
  Keyboard
} from 'lucide-react';
import type { ChatMessage, PeerStats, RemoteInputEvent } from '../types';

interface RemoteScreenViewerProps {
  remoteStream: MediaStream | null;
  remoteDeviceId: string;
  sessionId: string;
  isHost: boolean;
  stats: PeerStats;
  chatMessages: ChatMessage[];
  onSendChatMessage: (text: string) => void;
  onSendInputEvent: (input: RemoteInputEvent) => void;
  onDisconnect: () => void;
}

export const RemoteScreenViewer: React.FC<RemoteScreenViewerProps> = ({
  remoteStream,
  remoteDeviceId,
  sessionId,
  isHost,
  stats,
  chatMessages,
  onSendChatMessage,
  onSendInputEvent,
  onDisconnect
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isInteractive, setIsInteractive] = useState(!isHost); // controllers have interactive mode on by default
  const [displayMode, setDisplayMode] = useState<'contain' | 'original'>('contain');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInputText, setChatInputText] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showSpecialKeys, setShowSpecialKeys] = useState(false);

  // Format session timer
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Attach remote stream to video element
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
      videoRef.current.muted = true;
      videoRef.current.play().catch((e) => console.log('Video autoplay error:', e));
    }
  }, [remoteStream]);

  // Coordinate normalizer: converts mouse event on <video> to 0.0 -> 1.0
  const getNormalizedCoordinates = useCallback((e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const video = videoRef.current;
    if (!video) return null;

    const rect = video.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      return null;
    }

    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y))
    };
  }, []);

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isInteractive) return;
    const coords = getNormalizedCoordinates(e);
    if (!coords) return;

    onSendInputEvent({
      sessionId,
      type: 'mousemove',
      normalizedX: coords.x,
      normalizedY: coords.y
    });
  }, [isInteractive, getNormalizedCoordinates, onSendInputEvent, sessionId]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isInteractive) return;
    const coords = getNormalizedCoordinates(e);
    if (!coords) return;

    onSendInputEvent({
      sessionId,
      type: 'mousedown',
      normalizedX: coords.x,
      normalizedY: coords.y,
      button: e.button
    });
  }, [isInteractive, getNormalizedCoordinates, onSendInputEvent, sessionId]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isInteractive) return;
    const coords = getNormalizedCoordinates(e);
    if (!coords) return;

    onSendInputEvent({
      sessionId,
      type: 'mouseup',
      normalizedX: coords.x,
      normalizedY: coords.y,
      button: e.button
    });
  }, [isInteractive, getNormalizedCoordinates, onSendInputEvent, sessionId]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!isInteractive) return;
    const coords = getNormalizedCoordinates(e);
    if (!coords) return;

    onSendInputEvent({
      sessionId,
      type: 'wheel',
      normalizedX: coords.x,
      normalizedY: coords.y,
      deltaX: e.deltaX,
      deltaY: e.deltaY
    });
  }, [isInteractive, getNormalizedCoordinates, onSendInputEvent, sessionId]);

  // Keyboard handlers
  useEffect(() => {
    if (!isInteractive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture keyboard if user is typing in chat input
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') {
        return;
      }

      e.preventDefault();
      onSendInputEvent({
        sessionId,
        type: 'keydown',
        normalizedX: 0,
        normalizedY: 0,
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') {
        return;
      }

      e.preventDefault();
      onSendInputEvent({
        sessionId,
        type: 'keyup',
        normalizedX: 0,
        normalizedY: 0,
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isInteractive, onSendInputEvent, sessionId]);

  const handleSendSpecialKey = (keyName: string) => {
    onSendInputEvent({
      sessionId,
      type: 'specialkey',
      normalizedX: 0,
      normalizedY: 0,
      specialKey: keyName
    });
    setShowSpecialKeys(false);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInputText.trim()) {
      onSendChatMessage(chatInputText.trim());
      setChatInputText('');
    }
  };

  const formattedPeerId = remoteDeviceId.replace(/(\d{3})(?=\d)/g, '$1 ');

  return (
    <div className="remote-viewer-container" ref={containerRef}>
      {/* Floating AnyDesk Toolbar */}
      <div className="viewer-toolbar">
        <div className="toolbar-session-info">
          <span>{isHost ? 'Host Session' : formattedPeerId}</span>
          <span style={{ color: 'var(--color-blue)', fontSize: '11px', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
            {formatTimer(elapsedSeconds)}
          </span>
        </div>

        <div className="toolbar-stats-pill">
          <div className="stats-item" title="Round Trip Time Latency">
            <Activity size={13} color="var(--color-green)" />
            <span>{stats.rttMs}ms</span>
          </div>
          <div className="stats-item" title="Stream Frame Rate">
            <span>{stats.fps} FPS</span>
          </div>
          <div className="stats-item" title="Stream Resolution">
            <span>{stats.resolution}</span>
          </div>
        </div>

        <div className="toolbar-actions">
          {!isHost && (
            <button
              className={`btn-toolbar ${isInteractive ? 'active' : ''}`}
              onClick={() => setIsInteractive(!isInteractive)}
              title={isInteractive ? 'Input Control Active' : 'View Only Mode'}
            >
              <MousePointer size={14} />
              <span>{isInteractive ? 'Control' : 'View Only'}</span>
            </button>
          )}

          <button
            className="btn-toolbar"
            onClick={() => setDisplayMode(displayMode === 'contain' ? 'original' : 'contain')}
            title="Toggle Display Scaling"
          >
            {displayMode === 'contain' ? <Maximize size={14} /> : <Minimize size={14} />}
            <span>{displayMode === 'contain' ? 'Fit' : '100%'}</span>
          </button>

          <div style={{ position: 'relative' }}>
            <button
              className={`btn-toolbar ${showSpecialKeys ? 'active' : ''}`}
              onClick={() => setShowSpecialKeys(!showSpecialKeys)}
              title="Send Special System Keys"
            >
              <Keyboard size={14} />
              <span>Keys</span>
            </button>

            {showSpecialKeys && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  marginTop: '8px',
                  left: 0,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '8px',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  zIndex: 300,
                  minWidth: '150px'
                }}
              >
                <button
                  className="btn-toolbar"
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => handleSendSpecialKey('win')}
                >
                  <span>Windows Key</span>
                </button>
                <button
                  className="btn-toolbar"
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => handleSendSpecialKey('alttab')}
                >
                  <span>Alt + Tab</span>
                </button>
                <button
                  className="btn-toolbar"
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => handleSendSpecialKey('escape')}
                >
                  <span>Escape</span>
                </button>
                <button
                  className="btn-toolbar"
                  style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--primary-red)' }}
                  onClick={() => handleSendSpecialKey('ctrlaltdel')}
                >
                  <span>Ctrl + Alt + Del</span>
                </button>
              </div>
            )}
          </div>

          <button
            className={`btn-toolbar ${isChatOpen ? 'active' : ''}`}
            onClick={() => setIsChatOpen(!isChatOpen)}
            title="Toggle In-Session Chat"
          >
            <MessageSquare size={14} />
            <span>Chat</span>
          </button>

          <button
            className="btn-disconnect-viewer"
            onClick={onDisconnect}
            title="Terminate Remote Session"
          >
            <Power size={14} />
            <span>End Session</span>
          </button>
        </div>
      </div>

      {/* Screen Canvas / Video Area */}
      <div
        className={`screen-canvas-wrapper ${isInteractive ? 'interactive' : ''}`}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => isInteractive && e.preventDefault()}
      >
        {!remoteStream ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: '#fff', padding: '32px' }}>
            <div className="status-dot connecting" style={{ width: '20px', height: '20px' }} />
            <div style={{ fontSize: '20px', fontWeight: 600 }}>Connecting to Remote Desktop Feed...</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Establishing peer connection with {formattedPeerId}. If prompt appears, select screen to share.
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="remote-video-element"
            style={{
              objectFit: displayMode === 'contain' ? 'contain' : 'fill'
            }}
          />
        )}
      </div>

      {/* In-Session Chat Drawer */}
      {isChatOpen && (
        <aside className="chat-drawer">
          <div className="chat-drawer-header">
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={16} color="var(--primary-red)" />
              <span>Session Chat</span>
            </span>
            <button
              className="btn-icon-titlebar"
              onClick={() => setIsChatOpen(false)}
            >
              <X size={15} />
            </button>
          </div>

          <div className="chat-messages-list">
            {chatMessages.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', marginTop: '20px' }}>
                No messages yet. Send a message to the remote peer.
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`chat-bubble ${msg.isSelf ? 'self' : 'peer'}`}
                >
                  <div style={{ fontSize: '11px', fontWeight: 600, opacity: 0.85, marginBottom: '2px' }}>
                    {msg.sender}
                  </div>
                  <div>{msg.text}</div>
                  <div className="chat-time">{msg.timestamp}</div>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSendChat} className="chat-input-row">
            <input
              type="text"
              placeholder="Type message..."
              value={chatInputText}
              onChange={(e) => setChatInputText(e.target.value)}
              className="chat-input"
            />
            <button type="submit" className="btn-send-chat" disabled={!chatInputText.trim()}>
              <Send size={15} />
            </button>
          </form>
        </aside>
      )}
    </div>
  );
};
