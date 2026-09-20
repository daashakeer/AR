import React, { useState } from 'react';
import { HomePage } from './components/HomePage';
import { ArView } from './components/ArView';
import { UnsupportedScreen } from './components/UnsupportedScreen';
import { useDeviceCapabilities } from './hooks/useDeviceCapabilities';
import './styles/global.css';

type AppScreen = 'home' | 'ar';

export default function App() {
  const caps = useDeviceCapabilities();
  const [screen, setScreen] = useState<AppScreen>('home');

  // Still detecting capabilities
  if (caps.checking) {
    return (
      <div className="splash">
        <div className="splash-spinner" />
        <p>Checking device…</p>
      </div>
    );
  }

  // Desktop → always show "open on mobile"
  if (!caps.isMobile) {
    return (
      <UnsupportedScreen reason="desktop" caps={caps} />
    );
  }

  // No camera at all
  if (!caps.hasCamera) {
    return <UnsupportedScreen reason="no-camera" caps={caps} />;
  }

  // No WebXR API
  if (!caps.webXRSupported) {
    return <UnsupportedScreen reason="no-webxr" caps={caps} />;
  }

  // WebXR present but immersive-ar not supported
  if (!caps.arSupported) {
    return <UnsupportedScreen reason="no-ar" caps={caps} />;
  }

  // AR session active
  if (screen === 'ar') {
    return (
      <ArView
        capabilities={caps}
        onExit={() => setScreen('home')}
      />
    );
  }

  // Home screen
  return <HomePage onStart={() => setScreen('ar')} />;
}
