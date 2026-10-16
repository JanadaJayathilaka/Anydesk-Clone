import React, { useEffect, useState } from 'react';
import { UserCheck, ShieldAlert, Check, X, MousePointer, Keyboard, Clipboard, Volume2 } from 'lucide-react';
import type { SessionPermissions } from '../types';

interface IncomingSessionModalProps {
  sessionId: string;
  controllerDeviceId: string;
  controllerName: string;
  initialPermissions: SessionPermissions;
  onAccept: (permissions: SessionPermissions) => void;
  onReject: () => void;
}

export const IncomingSessionModal: React.FC<IncomingSessionModalProps> = ({
  sessionId,
  controllerDeviceId,
  controllerName,
  initialPermissions,
  onAccept,
  onReject
}) => {
  const [permissions, setPermissions] = useState<SessionPermissions>({ ...initialPermissions });
  const [timeLeft, setTimeLeft] = useState(30);

  // Auto-reject countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onReject();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onReject]);

  const togglePermission = (key: keyof SessionPermissions) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const formattedCallerId = controllerDeviceId.replace(/(\d{3})(?=\d)/g, '$1 ');

  return (
    <div className="modal-overlay">
      <div className="modal-dialog">
        <div className="incoming-modal-header">
          <div className="caller-avatar">
            <UserCheck size={32} />
          </div>
          <h2 className="incoming-title">Incoming Connection Request</h2>
          <div className="incoming-caller-info">
            {controllerName} ({formattedCallerId})
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Session #{sessionId} • Auto-rejecting in {timeLeft}s
          </div>
        </div>

        <div className="incoming-modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-amber)', fontSize: '13px', marginBottom: '14px' }}>
            <ShieldAlert size={16} />
            <span>Grant permissions for this session:</span>
          </div>

          <label className="perm-checkbox-row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={permissions.allowMouse}
              onChange={() => togglePermission('allowMouse')}
              style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
            />
            <MousePointer size={16} color="var(--color-primary)" />
            <span>Control Mouse Cursor</span>
          </label>

          <label className="perm-checkbox-row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={permissions.allowKeyboard}
              onChange={() => togglePermission('allowKeyboard')}
              style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
            />
            <Keyboard size={16} color="var(--color-primary)" />
            <span>Transmit Keyboard Keystrokes</span>
          </label>

          <label className="perm-checkbox-row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={permissions.allowClipboard}
              onChange={() => togglePermission('allowClipboard')}
              style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
            />
            <Clipboard size={16} color="var(--color-primary)" />
            <span>Synchronize Clipboard</span>
          </label>

          <label className="perm-checkbox-row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={permissions.allowAudio}
              onChange={() => togglePermission('allowAudio')}
              style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
            />
            <Volume2 size={16} color="var(--color-primary)" />
            <span>Transmit Desktop Audio</span>
          </label>
        </div>

        <div className="incoming-modal-actions">
          <button className="btn-modal-reject" onClick={onReject}>
            <X size={18} />
            <span>Dismiss</span>
          </button>
          <button className="btn-modal-accept" onClick={() => onAccept(permissions)}>
            <Check size={18} />
            <span>Accept ({timeLeft}s)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
