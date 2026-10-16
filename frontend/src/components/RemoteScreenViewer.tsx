import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Power,
  MousePointer,
  Maximize,
  Minimize,
  Keyboard,
  Monitor,
  Check,
  RefreshCw
} from 'lucide-react';
import type { PeerStats, RemoteInputEvent, ElectronSource, ConnectionStatus } from '../types';

interface RemoteScreenViewerProps {
  remoteStream: MediaStream | null;
  remoteDeviceId: string;
  sessionId: string;
  isHost: boolean;
  stats: PeerStats;
  connectionStatus?: ConnectionStatus;
  connectionDetailStatus?: string;
  screenSources?: ElectronSource[];
  selectedSourceId?: string;
  hostCursorPos?: { x: number; y: number } | null;
  remoteCursorPos?: { x: number; y: number } | null;
  onSelectSourceId?: (sourceId: string) => void;
  onSwitchSides?: () => void;
  onSendInputEvent: (input: RemoteInputEvent) => void;
  onDisconnect: () => void;
  onRetry?: () => void;
}

export const RemoteScreenViewer: React.FC<RemoteScreenViewerProps> = ({
  remoteStream,
  remoteDeviceId,
  sessionId,
  isHost,
  stats,
  connectionStatus,
  connectionDetailStatus,
  screenSources = [],
  selectedSourceId = '',
  onSelectSourceId,
  onSendInputEvent,
  onDisconnect,
  onRetry
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);

  const [isInteractive, setIsInteractive] = useState(!isHost); // controllers have interactive mode on by default
  const [displayMode, setDisplayMode] = useState<'contain' | 'original'>('contain');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showSpecialKeys, setShowSpecialKeys] = useState(false);
  const [showScreenMenu, setShowScreenMenu] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  const [videoBox, setVideoBox] = useState<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0
  });

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
      video.playsInline = true;
      
      const tracks = remoteStream.getVideoTracks();
      if (tracks.length > 0) {
        setIsVideoPlaying(true);
        tracks[0].onunmute = () => {
          setIsVideoPlaying(true);
          video.play().catch(() => {});
        };
      }

      video.play().then(() => {
        setIsVideoPlaying(true);
      }).catch((e) => {
        console.log('Video play error/handled:', e);
        setIsVideoPlaying(true);
      });

      // Quick fallback: if stream is passed, unhide connecting overlay immediately
      const checkTimer = setTimeout(() => {
        setIsVideoPlaying(true);
      }, 150);
      return () => clearTimeout(checkTimer);
    } else {
      setIsVideoPlaying(false);
    }
  }, [remoteStream]);

  // Computes precise video display rectangle inside the canvas wrapper (accounting for pillarboxing/letterboxing)
  const updateVideoBox = useCallback(() => {
    const video = videoRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!video || !wrapper) return;

    const wRect = wrapper.getBoundingClientRect();
    const vRect = video.getBoundingClientRect();
    const vw = video.videoWidth || vRect.width;
    const vh = video.videoHeight || vRect.height;

    if (!vw || !vh || vRect.width <= 0 || vRect.height <= 0 || wRect.width <= 0 || wRect.height <= 0) {
      setVideoBox({ left: 0, top: 0, width: Math.round(wRect.width), height: Math.round(wRect.height) });
      return;
    }

    let renderWidth = vRect.width;
    let renderHeight = vRect.height;
    let offsetX = vRect.left - wRect.left;
    let offsetY = vRect.top - wRect.top;

    if (displayMode === 'contain') {
      const containerRatio = vRect.width / vRect.height;
      const videoRatio = vw / vh;
      if (containerRatio > videoRatio) {
        // Pillarboxed (bars on left/right)
        renderWidth = vRect.height * videoRatio;
        offsetX += (vRect.width - renderWidth) / 2;
      } else {
        // Letterboxed (bars on top/bottom)
        renderHeight = vRect.width / videoRatio;
        offsetY += (vRect.height - renderHeight) / 2;
      }
    }

    setVideoBox({
      left: Math.max(0, Math.round(offsetX)),
      top: Math.max(0, Math.round(offsetY)),
      width: Math.max(10, Math.round(renderWidth)),
      height: Math.max(10, Math.round(renderHeight))
    });
  }, [displayMode]);

  useEffect(() => {
    updateVideoBox();
    window.addEventListener('resize', updateVideoBox);
    return () => window.removeEventListener('resize', updateVideoBox);
  }, [updateVideoBox]);

  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      updateVideoBox();
    });
    ro.observe(wrapper);
    if (videoRef.current) {
      ro.observe(videoRef.current);
    }
    return () => ro.disconnect();
  }, [updateVideoBox]);

  // Coordinate normalizer: accurately converts client mouse coordinates on <video> to normalized 0.0 -> 1.0
  const getNormalizedCoordinates = useCallback((e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return null;

    const wRect = wrapper.getBoundingClientRect();
    const mouseX = e.clientX - wRect.left;
    const mouseY = e.clientY - wRect.top;

    const box = videoBox.width > 0 && videoBox.height > 0
      ? videoBox
      : { left: 0, top: 0, width: wRect.width, height: wRect.height };

    if (
      mouseX < box.left ||
      mouseX > box.left + box.width ||
      mouseY < box.top ||
      mouseY > box.top + box.height
    ) {
      return null;
    }

    const normX = (mouseX - box.left) / box.width;
    const normY = (mouseY - box.top) / box.height;

    return {
      x: Math.max(0, Math.min(1, normX)),
      y: Math.max(0, Math.min(1, normY))
    };
  }, [videoBox]);

  // Mouse event handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getNormalizedCoordinates(e);
    if (coords && isInteractive) {
      onSendInputEvent({
        sessionId,
        type: 'mousemove',
        normalizedX: coords.x,
        normalizedY: coords.y
      });
    }
  }, [getNormalizedCoordinates, isInteractive, onSendInputEvent, sessionId]);

  const handleMouseLeave = useCallback(() => {
    // no-op
  }, []);

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
      {/* 100% Full-Width AnyDesk Header Bar matching provided screenshot (Image 2) */}
      <div className="anydesk-top-bar">
        {/* Left Section: [Green Status Dot] | [Monitor Icon] | [Remote Desk ID] [PRO badge] [Timer] */}
        <div className="anydesk-bar-left">
          <div className="anydesk-status-dot-active" title="Connected & Active" />
          <div className="anydesk-bar-divider" />
          <div className="anydesk-monitor-box" title="Remote Display Feed">
            <Monitor size={15} color="#F59E0B" />
          </div>
          <div className="anydesk-bar-divider" />
          <span className="anydesk-desk-id">
            {isHost ? `HOST (${remoteDeviceId || 'Partner'})` : (remoteDeviceId || 'Desk')}
          </span>
          <span className="anydesk-pro-badge">PRO</span>
          <span className="anydesk-session-timer">
            {formatTimer(elapsedSeconds)}
          </span>
        </div>

        {/* Center Section: Quality & Latency Stats */}
        <div className="anydesk-bar-center">
          <div className="anydesk-stats-pill">
            <span className="stat-dot" style={{ background: remoteStream && isVideoPlaying ? '#22c55e' : '#eab308' }} />
            {remoteStream && isVideoPlaying ? (
              <>
                <span>{stats.rttMs || 16}ms</span>
                <span className="stat-sep">•</span>
                <span>{stats.fps || 60} FPS</span>
                <span className="stat-sep">•</span>
                <span>{stats.resolution || '1920x1080'}</span>
              </>
            ) : (
              <span>Connecting video feed...</span>
            )}
          </div>
        </div>

        {/* Right Section: Action Icons matching Image 2 */}
        <div className="anydesk-bar-right">
          {/* Display / Screen Switcher [1] */}
          {!isHost && (
            <div style={{ position: 'relative' }}>
              <button
                className={`anydesk-icon-btn ${showScreenMenu ? 'active' : ''}`}
                onClick={() => setShowScreenMenu(!showScreenMenu)}
                title="Select Remote Screen [1]"
              >
                <div className="anydesk-screen-indicator">
                  <Monitor size={14} />
                  <span className="screen-num">
                    {screenSources.findIndex((s) => s.id === selectedSourceId) >= 0
                      ? screenSources.findIndex((s) => s.id === selectedSourceId) + 1
                      : '1'}
                  </span>
                </div>
              </button>

              {showScreenMenu && (
                <div className="anydesk-dropdown-menu">
                  <div className="dropdown-header">Select Remote Screen</div>
                  {screenSources.length > 0 ? (
                    screenSources.map((source, index) => {
                      const isSelected = selectedSourceId === source.id || (!selectedSourceId && index === 0);
                      return (
                        <button
                          key={source.id || index}
                          className={`dropdown-item ${isSelected ? 'active' : ''}`}
                          onClick={() => handleSwitchScreenChoice(source.id)}
                        >
                          <Monitor size={14} color={isSelected ? 'var(--color-green)' : 'inherit'} />
                          <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {source.name || `Display ${index + 1}`}
                          </span>
                          {isSelected && <Check size={13} color="var(--color-green)" />}
                        </button>
                      );
                    })
                  ) : (
                    <button
                      className="dropdown-item active"
                      onClick={() => handleSwitchScreenChoice(selectedSourceId || 'screen:0:0')}
                    >
                      <Monitor size={14} color="var(--color-green)" />
                      <span style={{ flex: 1, textAlign: 'left' }}>Host Primary Screen</span>
                      <Check size={13} color="var(--color-green)" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Scaling / Fit Toggle */}
          <button
            className={`anydesk-icon-btn ${displayMode === 'contain' ? '' : 'active'}`}
            onClick={() => setDisplayMode(displayMode === 'contain' ? 'original' : 'contain')}
            title={displayMode === 'contain' ? 'Fit Screen (Contain)' : 'Original Size (1:1)'}
          >
            {displayMode === 'contain' ? <Maximize size={15} /> : <Minimize size={15} />}
          </button>

          {/* Input Control Toggle (Mouse pointer in top bar) */}
          <button
            className={`anydesk-icon-btn ${isInteractive ? 'active-green' : ''}`}
            onClick={() => setIsInteractive(!isInteractive)}
            title={isInteractive ? 'Input Control Enabled (Click & Type Active)' : 'Input Control Disabled (View-Only Mode)'}
          >
            <MousePointer size={15} />
          </button>

          {/* Special System Keys */}
          {!isHost && (
            <div style={{ position: 'relative' }}>
              <button
                className={`anydesk-icon-btn ${showSpecialKeys ? 'active' : ''}`}
                onClick={() => setShowSpecialKeys(!showSpecialKeys)}
                title="System Keys (Win, Alt+Tab, Ctrl+Alt+Del)"
              >
                <Keyboard size={15} />
              </button>

              {showSpecialKeys && (
                <div className="anydesk-dropdown-menu">
                  <div className="dropdown-header">Send System Keys</div>
                  <button className="dropdown-item" onClick={() => handleSendSpecialKey('win')}>
                    <span>Windows Key</span>
                  </button>
                  <button className="dropdown-item" onClick={() => handleSendSpecialKey('alttab')}>
                    <span>Alt + Tab</span>
                  </button>
                  <button className="dropdown-item" onClick={() => handleSendSpecialKey('escape')}>
                    <span>Escape</span>
                  </button>
                  <button className="dropdown-item danger" onClick={() => handleSendSpecialKey('ctrlaltdel')}>
                    <span>Ctrl + Alt + Del</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="anydesk-bar-divider" />

          {/* Disconnect / End Session Button */}
          <button
            className="anydesk-end-session-btn"
            onClick={onDisconnect}
            title="Terminate Remote Session"
          >
            <Power size={13} />
            <span>End Session</span>
          </button>
        </div>
      </div>

      {/* Screen Canvas / Video Area for Controller PC (Remote Viewer) */}
      <div
        ref={canvasWrapperRef}
        className={`screen-canvas-wrapper ${isInteractive ? 'interactive' : ''}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
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
            <div
              className={`status-dot ${
                connectionStatus === 'waiting_approval'
                  ? 'waiting'
                  : connectionDetailStatus?.toLowerCase().includes('fail')
                  ? 'offline'
                  : 'connecting'
              }`}
              style={{
                width: '24px',
                height: '24px',
                background: connectionDetailStatus?.toLowerCase().includes('fail')
                  ? 'var(--color-primary)'
                  : connectionStatus === 'waiting_approval'
                  ? '#38bdf8'
                  : '#f59e0b',
                boxShadow: `0 0 16px ${
                  connectionDetailStatus?.toLowerCase().includes('fail')
                    ? 'var(--primary-red-glow)'
                    : connectionStatus === 'waiting_approval'
                    ? 'rgba(56, 189, 248, 0.5)'
                    : 'rgba(245, 158, 11, 0.5)'
                }`
              }}
            />
            <div style={{ fontSize: '20px', fontWeight: 600 }}>
              {connectionStatus === 'waiting_approval'
                ? 'Waiting for Remote Partner to Accept...'
                : connectionDetailStatus?.toLowerCase().includes('fail')
                ? 'Peer Connection In Progress / Retrying...'
                : 'Connecting to Remote Desktop Feed...'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', maxWidth: '520px', lineHeight: '1.6' }}>
              {connectionStatus === 'waiting_approval'
                ? `Connection request was sent to Desk ${formattedPeerId}. Please click "Accept" on that computer.`
                : connectionDetailStatus || `Establishing direct peer-to-peer connection with ${formattedPeerId}. Receiving video stream...`}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
              {onRetry && (
                <button
                  onClick={onRetry}
                  style={{
                    padding: '8px 18px',
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    borderRadius: 'var(--radius-button)',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <RefreshCw size={14} />
                  <span>Retry Peer Link</span>
                </button>
              )}

              <button
                onClick={onDisconnect}
                style={{
                  padding: '8px 20px',
                  background: 'var(--color-primary-light)',
                  color: 'var(--color-primary)',
                  border: '1px solid var(--color-primary)',
                  borderRadius: 'var(--radius-button)',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s ease'
                }}
              >
                <Power size={14} />
                <span>Cancel Connection</span>
              </button>
            </div>
          </div>
        )}

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onPlaying={() => {
            setIsVideoPlaying(true);
            updateVideoBox();
          }}
          onLoadedData={() => {
            setIsVideoPlaying(true);
            updateVideoBox();
          }}
          onCanPlay={() => {
            setIsVideoPlaying(true);
            updateVideoBox();
          }}
          onLoadedMetadata={() => {
            setIsVideoPlaying(true);
            updateVideoBox();
            videoRef.current?.play().catch(() => {});
          }}
          onTimeUpdate={() => {
            setIsVideoPlaying(true);
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
