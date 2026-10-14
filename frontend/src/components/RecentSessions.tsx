import React from 'react';
import { Monitor, ArrowUpRight, Trash2 } from 'lucide-react';
import type { RecentSession } from '../types';

interface RecentSessionsProps {
  sessions: RecentSession[];
  onSelectSession: (deviceId: string) => void;
  onClearSessions: () => void;
}

export const RecentSessions: React.FC<RecentSessionsProps> = ({
  sessions,
  onSelectSession,
  onClearSessions
}) => {
  if (sessions.length === 0) {
    return (
      <div className="recent-sessions-section">
        <div className="section-title-row">
          <span className="section-title">Recent Sessions</span>
        </div>
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px dashed var(--border-color)',
            borderRadius: '10px',
            padding: '24px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '13px'
          }}
        >
          No recent remote desktop sessions yet. Enter an address above to start connecting.
        </div>
      </div>
    );
  }

  const formatId = (id: string) => id.replace(/(\d{3})(?=\d)/g, '$1 ');

  const formatTime = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div className="recent-sessions-section">
      <div className="section-title-row">
        <span className="section-title">Recent Sessions</span>
        <button
          onClick={onClearSessions}
          style={{
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          title="Clear recent history"
        >
          <Trash2 size={13} />
          <span>Clear History</span>
        </button>
      </div>

      <div className="recent-grid">
        {sessions.map((item) => (
          <div key={item.id} className="recent-card">
            <div className="recent-info">
              <div className="recent-icon-wrap">
                <Monitor size={18} />
              </div>
              <div>
                <div className="recent-alias">{item.alias || 'Remote PC'}</div>
                <div className="recent-id">{formatId(item.deviceId)}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {formatTime(item.timestamp)}
                </div>
              </div>
            </div>

            <button
              className="btn-quick-connect"
              onClick={() => onSelectSession(item.deviceId)}
              title="Connect to this device"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>Connect</span>
                <ArrowUpRight size={13} />
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
