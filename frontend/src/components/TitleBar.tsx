import React from 'react';
import { Minus, Square, X, Settings } from 'lucide-react';
import type { ConnectionStatus } from '../types';

interface TitleBarProps {
  status: ConnectionStatus;
  onOpenSettings: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({ status, onOpenSettings }) => {
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = () => window.electronAPI?.maximize();
  const handleClose = () => window.electronAPI?.close();

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
          {/* Iconic AnyDesk diamond logo SVG */}
          <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 12 12 22 22 12 12 2" fill="currentColor" fillOpacity="0.85" />
            <polygon points="12 6 6 12 12 18 18 12 12 6" fill="#0c0e14" />
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

        {isElectron && (
          <>
            <button className="btn-icon-titlebar" onClick={handleMinimize} title="Minimize" aria-label="Minimize">
              <Minus size={14} />
            </button>
            <button className="btn-icon-titlebar" onClick={handleMaximize} title="Maximize" aria-label="Maximize">
              <Square size={13} />
            </button>
            <button className="btn-icon-titlebar close-btn" onClick={handleClose} title="Close" aria-label="Close">
              <X size={15} />
            </button>
          </>
        )}
      </div>
    </header>
  );
};
