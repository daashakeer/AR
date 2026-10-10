import React from 'react';

interface Props {
  onStart: () => void;
  onStartGarment: () => void;
  onStartSimulator: () => void;
  isArSupported: boolean;
}

export const HomePage: React.FC<Props> = ({
  onStart,
  onStartGarment,
  onStartSimulator,
  isArSupported,
}) => {
  return (
    <div className="home-page">
      <div className="home-content">
        {/* Animated ruler icon */}
        <div className="home-icon" aria-hidden="true">
          <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="24" width="72" height="32" rx="6" fill="url(#rg)" />
            <line x1="16" y1="24" x2="16" y2="38" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="28" y1="24" x2="28" y2="32" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <line x1="40" y1="24" x2="40" y2="38" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="52" y1="24" x2="52" y2="32" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <line x1="64" y1="24" x2="64" y2="38" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            <defs>
              <linearGradient id="rg" x1="4" y1="24" x2="76" y2="56" gradientUnits="userSpaceOnUse">
                <stop stopColor="#00e5ff"/>
                <stop offset="1" stopColor="#0077ff"/>
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h1 className="home-title">AR Measure Pro</h1>
        <p className="home-subtitle">
          Precision real-world distance & AI garment sizing with instant surface tracking and 3D visual feedback.
        </p>

        {/* Action Buttons */}
        <div className="home-buttons">
          <button className="home-start-btn" onClick={onStart}>
            {isArSupported ? '⚡ Start Tape Measure' : 'Start Measuring'}
          </button>

          <button className="home-garment-btn" onClick={onStartGarment}>
            👖 AI Pant Sizing (Auto HRNet)
          </button>

          <button className="home-sim-btn" onClick={onStartSimulator}>
            🎮 Launch 3D Simulator
          </button>
        </div>

        {/* Feature Badges */}
        <div className="home-features-grid">
          <div className="home-feature-pill">
            <span className="feat-icon">🤖</span>
            <div>
              <strong>AI Garment Landmarks</strong>
              <p>Hugging Face HRNet + SAM3 waist detector</p>
            </div>
          </div>
          <div className="home-feature-pill">
            <span className="feat-icon">🎯</span>
            <div>
              <strong>Filtered Stability</strong>
              <p>Jitter-free adaptive smoothing</p>
            </div>
          </div>
          <div className="home-feature-pill">
            <span className="feat-icon">📐</span>
            <div>
              <strong>Level & Incline</strong>
              <p>Floor, wall, and slope detection</p>
            </div>
          </div>
        </div>

        {/* Quick Guide */}
        <div className="how-it-works">
          <h2>Quick Guide</h2>
          <ol className="how-steps">
            <li><span className="step-num">1</span> <strong>Pant Sizing:</strong> Lay pants flat, point camera, tap "Scan Pant with AI".</li>
            <li><span className="step-num">2</span> <strong>Tape Measure:</strong> Tap Point A, move camera, tap Point B.</li>
            <li><span className="step-num">3</span> <strong>Real Scale:</strong> AR computes millimeter physical distances in 3D.</li>
          </ol>
        </div>

        <p className="home-privacy">
          🔒 Camera stream is processed on-device. Images sent to AI only when you tap scan.
        </p>
      </div>
    </div>
  );
};
