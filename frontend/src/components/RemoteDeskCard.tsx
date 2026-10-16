import { Play, ArrowRight, Loader2, Globe, Wifi, RefreshCw } from 'lucide-react';
import type { ConnectionStatus, LanDiscoveredDevice } from '../types';

interface RemoteDeskCardProps {
  remoteId: string;
  onChangeRemoteId: (id: string) => void;
  onConnect: () => void;
  onCancel: () => void;
  onSelfTest?: () => void;
  status: ConnectionStatus;
  statusMessage?: string;
  thisDeviceId?: string;
  lanDevices?: LanDiscoveredDevice[];
  onSelectLanDevice?: (dev: LanDiscoveredDevice) => void;
  onRefreshLan?: () => void;
}

export const RemoteDeskCard: React.FC<RemoteDeskCardProps> = ({
  remoteId,
  onChangeRemoteId,
  onConnect,
  onCancel,
  onSelfTest: _onSelfTest,
  status,
  statusMessage,
  thisDeviceId,
  lanDevices = [],
  onSelectLanDevice,
  onRefreshLan
}) => {
  // Allow 9-digit address OR IP address (e.g. 192.168.1.136)
  const isIpLike = remoteId.includes('.') || remoteId.includes(':') || remoteId.startsWith('http');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // If user is typing an IP address or URL, keep punctuation
    if (/[.:]/.test(val) || val.startsWith('http')) {
      onChangeRemoteId(val.trim());
    } else {
      // Otherwise format as standard digits
      const digitsOnly = val.replace(/\D/g, '').slice(0, 9);
      onChangeRemoteId(digitsOnly);
    }
  };

  const formattedDisplay = isIpLike
    ? remoteId
    : (remoteId || '').replace(/(\d{3})(?=\d)/g, '$1 ');

  const isConnecting = status === 'connecting' || status === 'waiting_approval';
  const isValidId = isIpLike ? remoteId.length >= 7 : (remoteId || '').length >= 6;
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
          <Globe size={22} color="var(--color-primary)" />
          <div>
            <h2 className="card-title">Remote Desk</h2>
            <div className="card-subtitle">Connect to a computer on your Local Network or Wi-Fi</div>
          </div>
        </div>
        {/* {onSelfTest && (
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
        )} */}
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Enter Remote Address or Local IP:
        </div>

        <div className="remote-input-wrapper">
          <input
            type="text"
            className="remote-id-input"
            placeholder="e.g. 948 201 553 or 192.168.1.136"
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
              border: `1px solid ${status === 'rejected' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(56, 189, 248, 0.3)'
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

      {/* Discovered LAN Peers */}
      <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Wifi size={13} />
            <span>Discovered on Local Network ({lanDevices.length})</span>
          </div>
          {onRefreshLan && (
            <button
              type="button"
              onClick={onRefreshLan}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px'
              }}
              title="Rescan Local Wi-Fi Subnet"
            >
              <RefreshCw size={11} />
              <span>Scan LAN</span>
            </button>
          )}
        </div>

        {lanDevices.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
            Scanning local network for other AnyDesk PCs... Click <strong>Scan LAN</strong> to refresh.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {lanDevices.map((dev) => (
              <div
                key={dev.deviceId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'rgba(56, 189, 248, 0.05)',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  borderRadius: '6px'
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                    {dev.deviceName}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    ID: <span style={{ color: '#bae6fd' }}>{dev.deviceId.replace(/(\d{3})(?=\d)/g, '$1 ')}</span> • IP: {dev.ip}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectLanDevice?.(dev)}
                  style={{
                    background: 'var(--primary-red)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Connect
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
