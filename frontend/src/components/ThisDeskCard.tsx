import React, { useState } from 'react';
import { Monitor, Copy, Check, Shield, MousePointer, Keyboard, Clipboard, Volume2 } from 'lucide-react';
import type { ElectronSource, SessionPermissions } from '../types';

interface ThisDeskCardProps {
  deviceId: string;
  deviceName: string;
  localIp?: string;
  publicTunnelUrl?: string | null;
  permissions: SessionPermissions;
  onUpdatePermissions: (newPerms: SessionPermissions) => void;
  screenSources: ElectronSource[];
  selectedSourceId: string;
  onSelectSourceId: (id: string) => void;
}

export const ThisDeskCard: React.FC<ThisDeskCardProps> = ({
  deviceId,
  deviceName,
  localIp,
  publicTunnelUrl,
  permissions,
  onUpdatePermissions,
  screenSources,
  selectedSourceId,
  onSelectSourceId
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);
  const [copiedTunnel, setCopiedTunnel] = useState(false);

  // Format device ID into "XXX XXX XXX" pattern
  const formattedId = deviceId
    ? deviceId.replace(/(\d{3})(?=\d)/g, '$1 ')
    : '--- --- ---';

  const handleCopy = () => {
    navigator.clipboard.writeText(deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyIp = () => {
    if (!localIp) return;
    navigator.clipboard.writeText(`http://${localIp}:5082`);
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 2000);
  };

  const handleCopyTunnel = () => {
    if (!publicTunnelUrl) return;
    navigator.clipboard.writeText(publicTunnelUrl);
    setCopiedTunnel(true);
    setTimeout(() => setCopiedTunnel(false), 2000);
  };

  const togglePermission = (key: keyof SessionPermissions) => {
    onUpdatePermissions({
      ...permissions,
      [key]: !permissions[key]
    });
  };

  return (
    <div className="card this-desk-card">
      <div className="card-header">
        <div className="card-title-group">
          <Monitor className="logo-icon" size={22} />
          <div>
            <h2 className="card-title">This Desk</h2>
            <div className="card-subtitle">{deviceName} • Ready for incoming sessions</div>
          </div>
        </div>
        <div title="Security active">
          <Shield size={18} color="#10b981" />
        </div>
      </div>

      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
        Your Address (Share with partner):
      </div>

      <div className="id-display-container">
        <span className="device-id-number">{formattedId}</span>
        <button
          className={`btn-copy ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title="Copy Device ID"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>

      {publicTunnelUrl ? (
        <div
          style={{
            marginTop: '10px',
            marginBottom: '14px',
            padding: '10px 14px',
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.28)',
            borderRadius: '8px',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ color: '#6ee7b7', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              Global Internet Tunnel Active
            </span>
            <button
              type="button"
              onClick={handleCopyTunnel}
              style={{
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#6ee7b7',
                borderRadius: '5px',
                padding: '3px 10px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
              title="Copy public URL to paste into other PC's settings"
            >
              {copiedTunnel ? 'Copied Link!' : 'Copy Server Link'}
            </button>
          </div>
          <div style={{ fontSize: '11px', color: '#a7f3d0', wordBreak: 'break-all' }}>
            <code>{publicTunnelUrl}</code>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            To connect from another PC across the Internet, enter this link in that PC's <strong>⚙️ Settings</strong>.
          </div>
        </div>
      ) : localIp && localIp !== '127.0.0.1' ? (
        <div
          style={{
            marginTop: '8px',
            marginBottom: '14px',
            padding: '8px 12px',
            background: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.22)',
            borderRadius: '8px',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}
        >
          <span style={{ color: '#bae6fd' }}>
            📡 <strong>Local Wi-Fi Server:</strong> <code style={{ color: '#38bdf8' }}>http://{localIp}:5082</code>
          </span>
          <button
            type="button"
            onClick={handleCopyIp}
            style={{
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '11px',
              cursor: 'pointer'
            }}
            title="Copy LAN Server URL"
          >
            {copiedIp ? 'Copied URL!' : 'Copy URL'}
          </button>
        </div>
      ) : null}

      {screenSources.length > 1 && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
            Display to Share:
          </label>
          <select
            value={selectedSourceId}
            onChange={(e) => onSelectSourceId(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--bg-input)',
              color: '#fff',
              border: '1px solid var(--border-color)',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '13px'
            }}
          >
            {screenSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="host-permissions-group">
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Host Access Permissions
        </div>

        <div className="perm-label-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MousePointer size={14} color="var(--color-blue)" />
            <span>Allow Mouse Control</span>
          </span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={permissions.allowMouse}
              onChange={() => togglePermission('allowMouse')}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        <div className="perm-label-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Keyboard size={14} color="var(--color-blue)" />
            <span>Allow Keyboard Input</span>
          </span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={permissions.allowKeyboard}
              onChange={() => togglePermission('allowKeyboard')}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        <div className="perm-label-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clipboard size={14} color="var(--color-blue)" />
            <span>Allow Clipboard Sync</span>
          </span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={permissions.allowClipboard}
              onChange={() => togglePermission('allowClipboard')}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        <div className="perm-label-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Volume2 size={14} color="var(--color-blue)" />
            <span>Allow Audio Transmission</span>
          </span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={permissions.allowAudio}
              onChange={() => togglePermission('allowAudio')}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>
    </div>
  );
};
