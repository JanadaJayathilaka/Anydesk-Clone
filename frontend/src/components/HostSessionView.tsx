import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Power,
  MousePointer,
  Clipboard,
  Eye,
  EyeOff,
  Activity,
  Layers
} from 'lucide-react';
import type { PeerStats, SessionPermissions, ElectronSource } from '../types';

interface HostSessionViewProps {
  remoteDeviceId: string;
  sessionId: string;
  stats: PeerStats;
  permissions: SessionPermissions;
  onUpdatePermissions: (newPerms: SessionPermissions) => void;
  onDisconnect: () => void;
  screenSources?: ElectronSource[];
  selectedSourceId?: string;
  onSelectSourceId?: (sourceId: string) => void;
  localStream?: MediaStream | null;
}

export const HostSessionView: React.FC<HostSessionViewProps> = ({
  remoteDeviceId,
  stats,
  permissions,
  onUpdatePermissions,
  onDisconnect,
  screenSources = [],
  selectedSourceId = '',
  onSelectSourceId,
  localStream
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Timer for session duration
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

  const formattedRemoteId = remoteDeviceId
    ? remoteDeviceId.replace(/(\d{3})(?=\d)/g, '$1 ')
    : 'Remote Controller';

  // Attach local stream to preview video when preview is toggled
  useEffect(() => {
    if (showPreview && previewVideoRef.current && localStream) {
      previewVideoRef.current.srcObject = localStream;
      previewVideoRef.current.play().catch(() => {});
    }
  }, [showPreview, localStream]);

  const toggleMouseControl = () => {
    const updated = {
      ...permissions,
      allowControl: !permissions.allowControl,
      allowMouse: !permissions.allowMouse,
      allowKeyboard: !permissions.allowKeyboard
    };
    onUpdatePermissions(updated);
  };

  const toggleClipboard = () => {
    const updated = {
      ...permissions,
      allowClipboard: !permissions.allowClipboard
    };
    onUpdatePermissions(updated);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      backgroundColor: 'var(--bg-main)',
      color: 'var(--text-primary)',
      overflowY: 'auto'
    }}>
      {/* Top Session Bar (AnyDesk Red / Slate style) */}
      <div style={{
        height: '42px',
        background: '#131722',
        borderBottom: '1px solid #232936',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        fontSize: '13px',
        fontWeight: 500,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#22c55e',
            boxShadow: '0 0 8px rgba(34, 197, 94, 0.8)'
          }} />
          <span style={{ fontWeight: 600, color: '#f8fafc' }}>Host Session Active</span>
          <span style={{ color: '#64748b' }}>•</span>
          <span style={{ color: '#94a3b8' }}>Controller: <strong style={{ color: '#38bdf8' }}>{formattedRemoteId}</strong></span>
          <span style={{ color: '#64748b' }}>•</span>
          <span style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>{formatTimer(elapsedSeconds)}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Stats */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: '#94a3b8' }}>
            <span>FPS: <strong style={{ color: '#38bdf8' }}>{stats.fps || 60}</strong></span>
            <span>Latency: <strong style={{ color: '#22c55e' }}>{stats.rttMs || 12} ms</strong></span>
          </div>

          {/* End Session Button */}
          <button
            onClick={onDisconnect}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--color-primary)',
              color: '#ffffff',
              border: 'none',
              padding: '5px 12px',
              borderRadius: 'var(--radius-button)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-primary-hover)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'var(--color-primary)')}
          >
            <Power size={13} />
            <span>End Session</span>
          </button>
        </div>
      </div>

      {/* Main Host Management Dashboard */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '640px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '28px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px'
        }}>
          {/* Header Banner */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '54px',
              height: '54px',
              borderRadius: '12px',
              background: 'rgba(34, 197, 94, 0.15)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#22c55e',
              flexShrink: 0
            }}>
              <Shield size={28} />
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Your Screen is Currently Shared
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Remote user <strong style={{ color: '#38bdf8' }}>{formattedRemoteId}</strong> is connected and viewing this desktop feed.
              </div>
            </div>
          </div>

          {/* Screen Selection (if multiple displays) */}
          {screenSources.length > 1 && onSelectSourceId && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Layers size={18} style={{ color: '#38bdf8' }} />
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Active Screen Broadcast</span>
              </div>
              <select
                value={selectedSourceId}
                onChange={(e) => onSelectSourceId(e.target.value)}
                style={{
                  background: '#131722',
                  color: '#fff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {screenSources.map((src) => (
                  <option key={src.id} value={src.id}>
                    {src.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Live Permissions Management */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Session Access Controls
            </div>

            {/* Mouse & Keyboard Toggle */}
            <div
              onClick={toggleMouseControl}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: permissions.allowControl ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${permissions.allowControl ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <MousePointer size={18} style={{ color: permissions.allowControl ? '#22c55e' : 'var(--color-primary)' }} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Remote Mouse & Keyboard Control
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {permissions.allowControl
                      ? 'The remote controller is permitted to interact with your desktop'
                      : 'Remote control disabled. Controller can only view the screen.'}
                  </div>
                </div>
              </div>
              <div style={{
                width: '38px',
                height: '22px',
                borderRadius: '12px',
                background: permissions.allowControl ? '#22c55e' : '#475569',
                position: 'relative',
                transition: 'background 0.2s ease'
              }}>
                <div style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: '3px',
                  left: permissions.allowControl ? '19px' : '3px',
                  transition: 'left 0.2s ease'
                }} />
              </div>
            </div>

            {/* Clipboard Toggle */}
            <div
              onClick={toggleClipboard}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: permissions.allowClipboard ? 'rgba(56, 189, 248, 0.08)' : 'rgba(100, 116, 139, 0.08)',
                border: `1px solid ${permissions.allowClipboard ? 'rgba(56, 189, 248, 0.3)' : 'rgba(100, 116, 139, 0.3)'}`,
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Clipboard size={18} style={{ color: permissions.allowClipboard ? '#38bdf8' : '#94a3b8' }} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Clipboard Synchronization
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {permissions.allowClipboard
                      ? 'Text copied on either device is automatically shared'
                      : 'Clipboard sharing is disabled'}
                  </div>
                </div>
              </div>
              <div style={{
                width: '38px',
                height: '22px',
                borderRadius: '12px',
                background: permissions.allowClipboard ? '#38bdf8' : '#475569',
                position: 'relative',
                transition: 'background 0.2s ease'
              }}>
                <div style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: '3px',
                  left: permissions.allowClipboard ? '19px' : '3px',
                  transition: 'left 0.2s ease'
                }} />
              </div>
            </div>
          </div>

          {/* Optional Local Preview Accordion */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onClick={() => setShowPreview(!showPreview)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '12px',
                cursor: 'pointer',
                padding: '4px 0',
                alignSelf: 'flex-start'
              }}
            >
              {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
              <span>{showPreview ? 'Hide Screen Broadcast Preview' : 'Show Screen Broadcast Preview'}</span>
            </button>

            {showPreview && (
              <div style={{
                borderRadius: '8px',
                overflow: 'hidden',
                background: '#000',
                aspectRatio: '16/9',
                maxHeight: '220px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #334155'
              }}>
                <video
                  ref={previewVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>
            )}
          </div>

          {/* Bottom Actions */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-color)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b' }}>
              <Activity size={14} style={{ color: '#22c55e' }} />
              <span>Direct P2P Encrypted Stream</span>
            </div>

            <button
              onClick={onDisconnect}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                padding: '9px 20px',
                borderRadius: 'var(--radius-button)',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px var(--primary-red-glow)'
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-primary-hover)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'var(--color-primary)')}
            >
              <Power size={15} />
              <span>Disconnect & Stop Sharing</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
