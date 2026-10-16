import React, { useState } from 'react';
import { X, Check, Activity, Server, Laptop, AlertTriangle, ShieldCheck } from 'lucide-react';
import { DEFAULT_SERVER_URL, isLocalOrPrivateIp } from '../utils/networkUtils';

interface SettingsModalProps {
  serverUrl: string;
  deviceName: string;
  localIp?: string;
  onSave: (serverUrl: string, deviceName: string) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  serverUrl,
  deviceName,
  localIp,
  onSave,
  onClose
}) => {
  // If the passed serverUrl is a local/LAN IP or empty, immediately default to AWS server!
  const [currentUrl, setCurrentUrl] = useState(() => {
    if (!serverUrl || isLocalOrPrivateIp(serverUrl)) {
      return DEFAULT_SERVER_URL;
    }
    return serverUrl;
  });
  const [currentName, setCurrentName] = useState(deviceName);
  const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: ''
  });

  const isAwsServer = currentUrl.trim().replace(/\/+$/, '') === DEFAULT_SERVER_URL;
  const isLocalUrl = isLocalOrPrivateIp(currentUrl);

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
    onSave(currentUrl.trim().replace(/\/+$/, ''), currentName);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" style={{ maxWidth: '540px' }}>
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
          {/* Warning if a local IP is selected */}
          {isLocalUrl && (
            <div
              style={{
                marginBottom: '14px',
                padding: '10px 14px',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#fbbf24',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={16} color="#fbbf24" style={{ flexShrink: 0 }} />
                <span>Local IP detected. For reliable remote access, use your AWS backend.</span>
              </div>
              <button
                type="button"
                onClick={() => setCurrentUrl(DEFAULT_SERVER_URL)}
                style={{
                  background: '#f59e0b',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '11px',
                  border: 'none',
                  borderRadius: '5px',
                  padding: '4px 10px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                Use AWS
              </button>
            </div>
          )}

          {/* Active AWS badge */}
          {isAwsServer && (
            <div
              style={{
                marginBottom: '14px',
                padding: '8px 12px',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <ShieldCheck size={16} color="#10b981" />
              <span>Configured to your live AWS Windows Signaling Backend</span>
            </div>
          )}

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
              placeholder="http://18.188.166.170:5082"
            />
            <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                style={{
                  background: isAwsServer ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.12)',
                  border: `1px solid ${isAwsServer ? '#10b981' : 'rgba(16, 185, 129, 0.4)'}`,
                  color: '#10b981',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onClick={() => setCurrentUrl(DEFAULT_SERVER_URL)}
              >
                <span>★ Use AWS Cloud Server ({DEFAULT_SERVER_URL})</span>
                {isAwsServer && (
                  <span style={{ fontSize: '9px', background: '#10b981', color: '#000', borderRadius: '3px', padding: '1px 5px', fontWeight: 800 }}>
                    ACTIVE
                  </span>
                )}
              </button>
              <button
                type="button"
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
                onClick={() => setCurrentUrl('http://localhost:5082')}
              >
                Use Localhost (http://localhost:5082)
              </button>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', lineHeight: '1.4' }}>
              Both computers connect to your AWS Cloud Backend (<code>http://18.188.166.170:5082</code>). Remote connections work seamlessly across any network.
              {localIp && localIp !== '127.0.0.1' && (
                <span style={{ display: 'block', marginTop: '4px', opacity: 0.8 }}>
                  Local PC network adapter IP: <code>{localIp}</code>
                </span>
              )}
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
