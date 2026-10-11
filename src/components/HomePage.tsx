import React from 'react';

interface Props {
  onStart: () => void;
  onStartSimulator: () => void;
  isArSupported: boolean;
}

export const HomePage: React.FC<Props> = ({ onStart, onStartSimulator, isArSupported }) => {
  return (
    <div className="home-page">
      <div className="home-content">
        <div className="home-icon" aria-hidden="true">
          <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="8" y="20" width="64" height="40" rx="12" fill="url(#rg)" />
            <line x1="16" y1="40" x2="64" y2="40" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 6" />
            <circle cx="24" cy="40" r="4" fill="#fff" />
            <circle cx="56" cy="40" r="4" fill="#fff" />
            <defs>
              <linearGradient id="rg" x1="8" y1="20" x2="72" y2="60" gradientUnits="userSpaceOnUse">
                <stop stopColor="#00e5ff" />
                <stop offset="1" stopColor="#0077ff" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h1 className="home-title">Slyte AI Reference Measure</h1>
        <p className="home-subtitle">
          Capture a real camera frame in AR to automatically measure the full horizontal X-distance
          across physical garment boundaries in pixels and real-world metres.
        </p>

        <div className="home-buttons">
          <button type="button" className="home-start-btn" onClick={onStart} disabled={!isArSupported}>
            {isArSupported ? '📷 Start AR Reference Capture' : 'AR unavailable on this device'}
          </button>
          <button type="button" className="home-garment-btn" onClick={onStartSimulator}>
            🎮 Open geometry simulator (desktop)
          </button>
        </div>

        <div className="home-features-grid">
          <div className="home-feature-pill">
            <span className="feat-icon">📐</span>
            <div>
              <strong>Matched pixel &amp; metre pairs</strong>
              <p>Ray–plane intersection from the same capture pose</p>
            </div>
          </div>
          <div className="home-feature-pill">
            <span className="feat-icon">📄</span>
            <div>
              <strong>Versioned JSON export</strong>
              <p>Download image + metadata for HRNet waistband pipeline</p>
            </div>
          </div>
        </div>

        <p className="home-privacy">
          Requires Android Chrome with ARCore for live AR. iOS Safari WebXR support is limited.
        </p>
      </div>
    </div>
  );
};
