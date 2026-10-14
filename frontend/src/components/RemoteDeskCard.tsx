import React from 'react';
import { Play, ArrowRight, Loader2, Globe, MonitorPlay } from 'lucide-react';
import type { ConnectionStatus } from '../types';

interface RemoteDeskCardProps {
  remoteId: string;
  onChangeRemoteId: (id: string) => void;
  onConnect: () => void;
  onCancel: () => void;
  onSelfTest?: () => void;
  status: ConnectionStatus;
  statusMessage?: string;
  thisDeviceId?: string;
}

export const RemoteDeskCard: React.FC<RemoteDeskCardProps> = ({
  remoteId,
  onChangeRemoteId,
  onConnect,
  onCancel,
  onSelfTest,
  status,
  statusMessage,
  thisDeviceId
}) => {
  // Formatter for 9-digit input: inserts space every 3 digits
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 9);
    onChangeRemoteId(raw);
  };

  const formattedDisplay = (remoteId || '').replace(/(\d{3})(?=\d)/g, '$1 ');

  const isConnecting = status === 'connecting' || status === 'waiting_approval';
  const isValidId = (remoteId || '').length >= 6;
  const isSelfId = thisDeviceId && remoteId === thisDeviceId;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValidId && !isConnecting) {
      onConnect();
    }
  };

  return (
    <div className="card remote-desk-card">
      <div className="card-header">
        <div className="card-title-group">
          <Globe size={22} color="var(--color-blue)" />
          <div>
            <h2 className="card-title">Remote Desk</h2>
            <div className="card-subtitle">Control another computer remotely</div>
          </div>
        </div>
        {onSelfTest && (
          <button
            type="button"
            onClick={onSelfTest}
            style={{
              background: 'rgba(56, 189, 248, 0.12)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Test screen stream on this PC"
          >
            <MonitorPlay size={12} />
            <span>Self-Test</span>
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Enter Remote Address:
        </div>

        <div className="remote-input-wrapper">
          <input
            type="text"
            className="remote-id-input"
            placeholder="e.g. 948 201 553"
            value={formattedDisplay}
            onChange={handleInputChange}
            disabled={isConnecting}
          />
        </div>

        {isSelfId && !statusMessage && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              marginBottom: '14px',
              fontSize: '12px',
              background: 'rgba(56, 189, 248, 0.12)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span>You entered your own address. Click Connect for local loopback test.</span>
          </div>
        )}

        {statusMessage && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background:
                status === 'rejected'
                  ? 'rgba(239, 68, 68, 0.15)'
                  : 'rgba(56, 189, 248, 0.1)',
              color: status === 'rejected' ? 'var(--primary-red)' : 'var(--color-blue)',
              border: `1px solid ${
                status === 'rejected' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(56, 189, 248, 0.3)'
              }`
            }}
          >
            {isConnecting && <Loader2 size={14} className="animate-spin" />}
            <span>{statusMessage}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          {isConnecting ? (
            <button
              type="button"
              className="btn-connect"
              style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)' }}
              onClick={onCancel}
            >
              <span>Cancel Connection</span>
            </button>
          ) : (
            <button
              type="submit"
              className="btn-connect"
              disabled={!isValidId}
            >
              <Play size={18} fill="#fff" />
              <span>{isSelfId ? 'Start Self-Session' : 'Connect'}</span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </form>

      <div style={{ marginTop: '20px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
        Direct end-to-end WebRTC peer connection. The remote host must be online with AnyDesk open to approve the connection.
      </div>
    </div>
  );
};
