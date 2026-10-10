import React from 'react';

interface Props {
  onStart: () => void;
  onStartGarment: () => void;
  isArSupported: boolean;
}

export const HomePage: React.FC<Props> = ({
  onStart,
  onStartGarment,
  isArSupported,
}) => {
  return (
    <div className="home-page">
      <div className="home-content">
        {/* Minimalist icon badge */}
        <div className="home-icon" aria-hidden="true">
          <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="8" y="20" width="64" height="40" rx="12" fill="url(#rg)" />
            <line x1="22" y1="20" x2="22" y2="36" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="34" y1="20" x2="34" y2="30" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <line x1="46" y1="20" x2="46" y2="36" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="58" y1="20" x2="58" y2="30" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <defs>
              <linearGradient id="rg" x1="8" y1="20" x2="72" y2="60" gradientUnits="userSpaceOnUse">
                <stop stopColor="#00e5ff"/>
                <stop offset="1" stopColor="#0077ff"/>
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h1 className="home-title">AR Measure Pro</h1>
        <p className="home-subtitle">
          Precision AI garment waist sizing and point-to-point AR tape measure.
        </p>

        {/* Primary Action Buttons */}
        <div className="home-buttons">
          <button className="home-garment-btn" onClick={onStartGarment}>
            👖 AI Pant Waist Sizing
          </button>

          <button className="home-start-btn" onClick={onStart}>
            {isArSupported ? '📏 Tape Measure (Point A → B)' : 'Start Measuring'}
          </button>
        </div>

        {/* Clean, Premium Feature Cards */}
        <div className="home-features-grid">
          <div className="home-feature-pill">
            <span className="feat-icon">⚡</span>
            <div>
              <strong>Instant HRNet Landmark Detection</strong>
              <p>Precise deep learning trouser waistband detection</p>
            </div>
          </div>
          <div className="home-feature-pill">
            <span className="feat-icon">📐</span>
            <div>
              <strong>Tilt-Corrected 3D Calibration</strong>
              <p>True physical centimeter waist width across surface</p>
            </div>
          </div>
        </div>

        <p className="home-privacy">
          🔒 Real-time on-device optical plane tracking.
        </p>
      </div>
    </div>
  );
};
