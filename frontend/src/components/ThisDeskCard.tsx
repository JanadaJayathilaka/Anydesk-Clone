import React, { useState } from 'react';
import { Monitor, Copy, Check, Shield, MousePointer, Keyboard, Clipboard, Volume2 } from 'lucide-react';
import type { ElectronSource, SessionPermissions } from '../types';

interface ThisDeskCardProps {
  deviceId: string;
  deviceName: string;
  localIp?: string;
  serverUrl: string;
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
  serverUrl,
  permissions,
  onUpdatePermissions,
  screenSources,
  selectedSourceId,
  onSelectSourceId
}) => {
  const [copied, setCopied] = useState(false);

  // Format device ID into "XXX XXX XXX" pattern
  const formattedId = deviceId
    ? deviceId.replace(/(\d{3})(?=\d)/g, '$1 ')
    : '--- --- ---';

  const handleCopy = () => {
    navigator.clipboard.writeText(deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const togglePermission = (key: keyof SessionPermissions) => {
    onUpdatePermissions({
      ...permissions,
      [key]: !permissions[key]
    });
  };

  const isAwsHub = serverUrl.includes('18.188.166.170');

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

      {/* Connected Server Hub Status Badge */}
      <div
        style={{
          marginTop: '12px',
          marginBottom: '14px',
          padding: '10px 14px',
          background: isAwsHub ? 'rgba(16, 185, 129, 0.08)' : 'rgba(56, 189, 248, 0.08)',
          border: `1px solid ${isAwsHub ? 'rgba(16, 185, 129, 0.3)' : 'rgba(56, 189, 248, 0.3)'}`,
          borderRadius: '8px',
          fontSize: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ color: isAwsHub ? '#10b981' : '#38bdf8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isAwsHub ? '#10b981' : '#38bdf8', display: 'inline-block' }} />
            {isAwsHub ? 'AWS Cloud Signaling Server' : 'Custom Signaling Server'}
          </span>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: '10px',
              background: isAwsHub ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)',
              color: isAwsHub ? '#10b981' : '#38bdf8'
            }}
          >
            ACTIVE HUB
          </span>
        </div>
        <div style={{ fontSize: '11px', color: isAwsHub ? '#a7f3d0' : '#bae6fd', wordBreak: 'break-all' }}>
          <code>{serverUrl}</code>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
          <span>Both computers connect globally through this hub.</span>
          {localIp && localIp !== '127.0.0.1' && (
            <span style={{ color: 'var(--text-muted)' }}>Local IP: {localIp}</span>
          )}
        </div>
      </div>

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
