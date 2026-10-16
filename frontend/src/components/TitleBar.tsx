import React from 'react';
import { Settings } from 'lucide-react';
import type { ConnectionStatus } from '../types';

interface TitleBarProps {
  status: ConnectionStatus;
  onOpenSettings: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({ status, onOpenSettings }) => {
  const getStatusText = () => {
    switch (status) {
      case 'ready':
        return 'Ready';
      case 'connecting':
        return 'Connecting...';
      case 'waiting_approval':
        return 'Waiting for Approval';
      case 'connected':
        return 'Connected';
      case 'rejected':
        return 'Connection Rejected';
      case 'offline':
      default:
        return 'Offline';
    }
  };

  const getStatusClass = () => {
    if (status === 'ready' || status === 'connected') return 'ready';
    if (status === 'connecting' || status === 'waiting_approval') return 'connecting';
    return 'offline';
  };

  return (
    <header className="app-titlebar">
      <div className="titlebar-left">
        <div className="app-logo">
          {/* Iconic AnyDesk red polygon logo */}
          <svg className="logo-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8.322 3.677 0 12l8.322 8.323L16.645 12zm7.371.01-1.849 1.85 6.49 6.456-6.49 6.49 1.85 1.817L24 11.993z" />
          </svg>
          <span>AnyDesk</span>
        </div>
      </div>

      <div className="titlebar-center">
        <div className="status-badge" title="Signaling connection status">
          <span className={`status-dot ${getStatusClass()}`} />
          <span>{getStatusText()}</span>
        </div>
      </div>

      <div className="titlebar-right">
        <button
          className="btn-icon-titlebar"
          onClick={onOpenSettings}
          title="Settings & Diagnostics"
          aria-label="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
};
