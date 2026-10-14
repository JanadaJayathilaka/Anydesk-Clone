import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Power,
  MousePointer,
  Maximize,
  Minimize,
  Activity,
  Keyboard,
  Monitor,
  Repeat,
  Check,
  ChevronDown
} from 'lucide-react';
import type { PeerStats, RemoteInputEvent, ElectronSource } from '../types';

interface RemoteScreenViewerProps {
  remoteStream: MediaStream | null;
  remoteDeviceId: string;
  sessionId: string;
  isHost: boolean;
  stats: PeerStats;
  connectionDetailStatus?: string;
  screenSources?: ElectronSource[];
  selectedSourceId?: string;
  onSelectSourceId?: (sourceId: string) => void;
  onSwitchSides?: () => void;
  onSendInputEvent: (input: RemoteInputEvent) => void;
  onDisconnect: () => void;
}

export const RemoteScreenViewer: React.FC<RemoteScreenViewerProps> = ({
  remoteStream,
  remoteDeviceId,
  sessionId,
  isHost,
  stats,
  connectionDetailStatus,
  screenSources = [],
  selectedSourceId = '',
  onSelectSourceId,
  onSwitchSides,
  onSendInputEvent,
  onDisconnect
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isInteractive, setIsInteractive] = useState(!isHost); // controllers have interactive mode on by default
  const [displayMode, setDisplayMode] = useState<'contain' | 'original'>('contain');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showSpecialKeys, setShowSpecialKeys] = useState(false);
  const [showScreenMenu, setShowScreenMenu] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

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
    const video = videoRef.current;
    if (!video) return;

    if (remoteStream) {
      video.srcObject = remoteStream;
      video.muted = true;
      video.play().then(() => {
        setIsVideoPlaying(true);
      }).catch((e) => {
        console.log('Video autoplay error:', e);
        setIsVideoPlaying(true);
      });

      const tracks = remoteStream.getVideoTracks();
      if (tracks.length > 0) {
        if (tracks[0].readyState === 'live') {
          setIsVideoPlaying(true);
        }
        tracks[0].onunmute = () => {
          setIsVideoPlaying(true);
          video.play().catch(() => {});
        };
        // Fallback: if track is live or ready, reveal video after short delay
        const checkTimer = setTimeout(() => {
          if (video.currentTime > 0 || video.readyState >= 1 || tracks[0].readyState === 'live') {
            setIsVideoPlaying(true);
          }
        }, 300);
        return () => clearTimeout(checkTimer);
      }
    } else {
      setIsVideoPlaying(false);
    }
  }, [remoteStream]);

  // Coordinate normalizer: accurately converts client mouse coordinates on <video> to normalized 0.0 -> 1.0
  // Accounts for letterboxing / pillarboxing when aspect ratio doesn't match window
  const getNormalizedCoordinates = useCallback((e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const video = videoRef.current;
    if (!video) return null;

    const rect = video.getBoundingClientRect();
    const vw = video.videoWidth || rect.width;
    const vh = video.videoHeight || rect.height;

    if (!vw || !vh || rect.width <= 0 || rect.height <= 0) return null;

    let renderWidth = rect.width;
    let renderHeight = rect.height;
    let offsetX = rect.left;
    let offsetY = rect.top;

    if (displayMode === 'contain') {
      const containerRatio = rect.width / rect.height;
      const videoRatio = vw / vh;
      if (containerRatio > videoRatio) {
        // Black bars on left and right (pillarboxed)
        renderWidth = rect.height * videoRatio;
        offsetX = rect.left + (rect.width - renderWidth) / 2;
      } else {
        // Black bars on top and bottom (letterboxed)
        renderHeight = rect.width / videoRatio;
        offsetY = rect.top + (rect.height - renderHeight) / 2;
      }
    }

    if (
      e.clientX < offsetX ||
      e.clientX > offsetX + renderWidth ||
      e.clientY < offsetY ||
      e.clientY > offsetY + renderHeight
    ) {
      return null;
    }

    const normX = (e.clientX - offsetX) / renderWidth;
    const normY = (e.clientY - offsetY) / renderHeight;

    return {
      x: Math.max(0, Math.min(1, normX)),
      y: Math.max(0, Math.min(1, normY))
    };
  }, [displayMode]);

  // Mouse event handlers
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

  // Keyboard event handlers
  useEffect(() => {
    if (!isInteractive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture keyboard if user is typing in an input
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

  const handleSwitchScreenChoice = (sourceId: string) => {
    setShowScreenMenu(false);
    onSelectSourceId?.(sourceId);
  };

  const formattedPeerId = remoteDeviceId.replace(/(\d{3})(?=\d)/g, '$1 ');

  return (
    <div className="remote-viewer-container" ref={containerRef}>
      {/* Floating AnyDesk Toolbar */}
      <div className="viewer-toolbar">
        <div className="toolbar-session-info">
          <span>{isHost ? `Host Mode (Partner: ${formattedPeerId})` : formattedPeerId}</span>
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
          {/* Input Control Toggle */}
          {!isHost && (
            <button
              className={`btn-toolbar ${isInteractive ? 'active' : ''}`}
              onClick={() => setIsInteractive(!isInteractive)}
              title={isInteractive ? 'Input Control Active (Clicking & Typing on Remote PC)' : 'View Only Mode'}
            >
              <MousePointer size={14} />
              <span>{isInteractive ? 'Control' : 'View Only'}</span>
            </button>
          )}

          {/* Screen / Monitor Switcher on the fly */}
          <div style={{ position: 'relative' }}>
            <button
              className={`btn-toolbar ${showScreenMenu ? 'active' : ''}`}
              onClick={() => setShowScreenMenu(!showScreenMenu)}
              title="Switch Screen / Monitor without ending session"
            >
              <Monitor size={14} />
              <span>Screens</span>
              <ChevronDown size={12} style={{ opacity: 0.7 }} />
            </button>

            {showScreenMenu && (
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
                  minWidth: '220px'
                }}
              >
                <div style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Select Display / Window
                </div>

                {screenSources.length > 0 ? (
                  screenSources.map((source) => {
                    const isSelected = selectedSourceId === source.id;
                    return (
                      <button
                        key={source.id}
                        className={`btn-toolbar ${isSelected ? 'active' : ''}`}
                        style={{
                          width: '100%',
                          justifyContent: 'flex-start',
                          padding: '8px 10px',
                          gap: '8px'
                        }}
                        onClick={() => handleSwitchScreenChoice(source.id)}
                      >
                        <Monitor size={14} color={isSelected ? 'var(--primary-red)' : 'var(--text-muted)'} />
                        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {source.name}
                        </span>
                        {isSelected && <Check size={13} color="var(--primary-red)" />}
                      </button>
                    );
                  })
                ) : (
                  <>
                    <button
                      className="btn-toolbar"
                      style={{ width: '100%', justifyContent: 'flex-start' }}
                      onClick={() => handleSwitchScreenChoice('screen:0:0')}
                    >
                      <Monitor size={14} />
                      <span>Primary Display 1</span>
                    </button>
                    <button
                      className="btn-toolbar"
                      style={{ width: '100%', justifyContent: 'flex-start' }}
                      onClick={() => handleSwitchScreenChoice('screen:1:0')}
                    >
                      <Monitor size={14} />
                      <span>Secondary Display 2</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Switch Sides (Swap Roles) */}
          {onSwitchSides && (
            <button
              className="btn-toolbar"
              onClick={onSwitchSides}
              title={isHost ? 'Switch Sides: View Controller desktop instead' : 'Switch Sides: Share your desktop with partner'}
            >
              <Repeat size={14} />
              <span>Switch Sides</span>
            </button>
          )}

          {/* Scaling Toggle */}
          <button
            className="btn-toolbar"
            onClick={() => setDisplayMode(displayMode === 'contain' ? 'original' : 'contain')}
            title="Toggle Display Scaling"
          >
            {displayMode === 'contain' ? <Maximize size={14} /> : <Minimize size={14} />}
            <span>{displayMode === 'contain' ? 'Fit' : '100%'}</span>
          </button>

          {/* Special System Keys */}
          <div style={{ position: 'relative' }}>
            <button
              className={`btn-toolbar ${showSpecialKeys ? 'active' : ''}`}
              onClick={() => setShowSpecialKeys(!showSpecialKeys)}
              title="Send Special System Keys to Remote Desktop"
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

          {/* Disconnect / End Session */}
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
        style={{ position: 'relative', width: '100%', height: '100%' }}
      >
        {(!remoteStream || !isVideoPlaying) && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            color: '#fff',
            padding: '32px',
            background: 'var(--bg-dark)',
            zIndex: 10
          }}>
            <div className="status-dot connecting" style={{ width: '22px', height: '22px' }} />
            <div style={{ fontSize: '20px', fontWeight: 600 }}>
              {isHost ? 'Sharing Your Desktop...' : 'Connecting to Remote Desktop Feed...'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', maxWidth: '480px' }}>
              {isHost
                ? `Your screen is being broadcasted to ${formattedPeerId}`
                : (connectionDetailStatus || `Establishing direct peer-to-peer connection with ${formattedPeerId}. Receiving video stream...`)}
            </div>
          </div>
        )}

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onPlaying={() => setIsVideoPlaying(true)}
          onLoadedData={() => setIsVideoPlaying(true)}
          onCanPlay={() => setIsVideoPlaying(true)}
          onLoadedMetadata={() => {
            setIsVideoPlaying(true);
            videoRef.current?.play().catch(() => {});
          }}
          className="remote-video-element"
          style={{
            objectFit: displayMode === 'contain' ? 'contain' : 'fill',
            width: '100%',
            height: '100%',
            display: 'block'
          }}
        />
      </div>
    </div>
  );
};
