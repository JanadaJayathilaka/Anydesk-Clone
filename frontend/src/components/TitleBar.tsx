import React from 'react';
import { Settings, ScreenShare } from 'lucide-react';
import type { ConnectionStatus } from '../types';

interface TitleBarProps {
  status: ConnectionStatus;
  onOpenSettings: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  status,
  onOpenSettings
}) => {
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
          {/* Light blue Screen Share 1 logo */}
          <ScreenShare className="logo-icon" size={22} strokeWidth={2.2} />
          <span>Screen Share 1</span>
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
