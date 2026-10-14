import React, { useState } from 'react';
import { X, Check, Activity, Server, Laptop } from 'lucide-react';

interface SettingsModalProps {
  serverUrl: string;
  deviceName: string;
  localIp?: string;
  publicTunnelUrl?: string | null;
  onSave: (serverUrl: string, deviceName: string) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  serverUrl,
  deviceName,
  localIp,
  publicTunnelUrl,
  onSave,
  onClose
}) => {
  const [currentUrl, setCurrentUrl] = useState(serverUrl);
  const [currentName, setCurrentName] = useState(deviceName);
  const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: ''
  });

  const handleTestConnection = async () => {
    setTestResult({ status: 'testing', message: 'Connecting to backend...' });
    try {
      const resp = await fetch(`${currentUrl.replace(/\/+$/, '')}/health`);
      if (resp.ok) {
        const data = await resp.json();
        setTestResult({
          status: 'success',
          message: `Connected successfully! Platform: ${data.platform}, Active Devices: ${data.activeDevices}`
        });
      } else {
        setTestResult({
          status: 'error',
          message: `Server returned status ${resp.status} ${resp.statusText}`
        });
      }
    } catch (err: any) {
      setTestResult({
        status: 'error',
        message: `Connection failed: ${err.message || 'Server unreachable'}`
      });
    }
  };

  const handleSave = () => {
    onSave(currentUrl, currentName);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" style={{ maxWidth: '520px' }}>
        <div
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-color)'
          }}
        >
          <span style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={18} color="var(--primary-red)" />
            <span>Settings & Diagnostics</span>
          </span>
          <button className="btn-icon-titlebar" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="settings-modal">
          <div className="settings-row">
            <label className="settings-label">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Server size={14} />
                <span>Backend Signaling Server URL:</span>
              </div>
            </label>
            <input
              type="text"
              className="settings-input"
              value={currentUrl}
              onChange={(e) => setCurrentUrl(e.target.value)}
              placeholder="http://localhost:5082 or https://...trycloudflare.com"
            />
            {publicTunnelUrl && (
              <div style={{ marginTop: '6px', fontSize: '11px', color: '#6ee7b7' }}>
                🌐 Global Internet URL: <strong>{publicTunnelUrl}</strong>
                <button
                  type="button"
                  style={{
                    marginLeft: '8px',
                    background: 'none',
                    border: 'none',
                    color: '#10b981',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    fontSize: '11px',
                    fontWeight: 600
                  }}
                  onClick={() => setCurrentUrl(publicTunnelUrl)}
                >
                  Use Global Internet URL
                </button>
              </div>
            )}
            {localIp && localIp !== '127.0.0.1' && (
              <div style={{ marginTop: '4px', fontSize: '11px', color: '#bae6fd' }}>
                📡 Local Wi-Fi URL: <strong>http://{localIp}:5082</strong>
                <button
                  type="button"
                  style={{
                    marginLeft: '8px',
                    background: 'none',
                    border: 'none',
                    color: '#38bdf8',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    fontSize: '11px'
                  }}
                  onClick={() => setCurrentUrl(`http://${localIp}:5082`)}
                >
                  Use Wi-Fi URL
                </button>
              </div>
            )}
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Paste your Global Internet URL (or local Wi-Fi IP) here so both computers are connected to the same signaling server.
            </div>
          </div>

          <div className="settings-row">
            <label className="settings-label">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Laptop size={14} />
                <span>Device Friendly Name:</span>
              </div>
            </label>
            <input
              type="text"
              className="settings-input"
              value={currentName}
              onChange={(e) => setCurrentName(e.target.value)}
              placeholder="My Windows Workstation"
            />
          </div>

          <div style={{ paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Connection Diagnostics
              </span>
              <button
                type="button"
                className="btn-toolbar"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}
                onClick={handleTestConnection}
                disabled={testResult.status === 'testing'}
              >
                <Activity size={14} />
                <span>{testResult.status === 'testing' ? 'Testing...' : 'Test Backend /health'}</span>
              </button>
            </div>

            {testResult.message && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  lineHeight: '1.4',
                  background:
                    testResult.status === 'success'
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(239, 68, 68, 0.15)',
                  color:
                    testResult.status === 'success' ? 'var(--color-green)' : 'var(--primary-red)',
                  border: `1px solid ${
                    testResult.status === 'success'
                      ? 'rgba(16, 185, 129, 0.3)'
                      : 'rgba(239, 68, 68, 0.3)'
                  }`
                }}
              >
                {testResult.message}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px'
          }}
        >
          <button
            className="btn-toolbar"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn-connect"
            style={{ width: 'auto', padding: '10px 20px' }}
            onClick={handleSave}
          >
            <Check size={16} />
            <span>Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
};
