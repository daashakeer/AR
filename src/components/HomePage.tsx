import React from 'react';

interface Props {
  onStart: () => void;
}

export const HomePage: React.FC<Props> = ({ onStart }) => {
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
                <stop stopColor="#1a8cff"/>
                <stop offset="1" stopColor="#00c896"/>
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h1 className="home-title">Measure</h1>
        <p className="home-subtitle">
          Measure the distance between any two points using your camera.
        </p>

        <button className="home-start-btn" onClick={onStart}>
          Start Measuring
        </button>

        {/* How it works */}
        <div className="how-it-works">
          <h2>How it works</h2>
          <ol className="how-steps">
            <li><span className="step-num">1</span> Point your camera at a flat surface.</li>
            <li><span className="step-num">2</span> Tap to place <strong>Point A</strong>.</li>
            <li><span className="step-num">3</span> Move to <strong>Point B</strong>.</li>
            <li><span className="step-num">4</span> Tap again.</li>
            <li><span className="step-num">5</span> The app calculates the real-world distance.</li>
          </ol>
        </div>

        <p className="home-privacy">
          🔒 Your camera feed stays on your device.
        </p>

        <p className="home-compat">
          Requires Android Chrome with ARCore support.
        </p>
      </div>
    </div>
  );
};
