import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';

interface OfflineBannerProps {
  onRetry: () => void;
  isRetrying: boolean;
  errorMessage?: string;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({ onRetry, isRetrying, errorMessage }) => {
  return (
    <div className="offline-banner">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <WifiOff size={16} />
        <span>
          <strong>Offline Mode:</strong> {errorMessage || 'Could not reach backend service (http://localhost:5082). Local UI is functioning offline.'}
        </span>
      </div>
      <button 
        className="offline-banner-btn" 
        onClick={onRetry} 
        disabled={isRetrying}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RefreshCw size={12} className={isRetrying ? 'animate-spin' : ''} />
          <span>{isRetrying ? 'Retrying...' : 'Retry Connection'}</span>
        </div>
      </button>
    </div>
  );
};
