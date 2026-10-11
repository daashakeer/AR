import React, { useState } from 'react';
import { HomePage } from './components/HomePage';
import { ArView } from './components/ArView';
import { UnsupportedScreen } from './components/UnsupportedScreen';
import { useDeviceCapabilities } from './hooks/useDeviceCapabilities';
import './styles/global.css';

type AppScreen = 'home' | 'ar' | 'simulator';

export default function App() {
  const caps = useDeviceCapabilities();
  const [screen, setScreen] = useState<AppScreen>('home');

  if (caps.checking) {
    return (
      <div className="splash">
        <div className="splash-spinner" />
        <p>Checking device capabilities…</p>
      </div>
    );
  }

  if (screen === 'simulator') {
    return <ArView capabilities={caps} isSimulator onExit={() => setScreen('home')} />;
  }

  if (screen === 'ar') {
    if (!caps.isMobile) {
      return (
        <UnsupportedScreen
          reason="desktop"
          caps={caps}
          onLaunchSimulator={() => setScreen('simulator')}
        />
      );
    }
    if (!caps.hasCamera) {
      return (
        <UnsupportedScreen
          reason="no-camera"
          caps={caps}
          onLaunchSimulator={() => setScreen('simulator')}
        />
      );
    }
    if (!caps.webXRSupported) {
      return (
        <UnsupportedScreen
          reason="no-webxr"
          caps={caps}
          onLaunchSimulator={() => setScreen('simulator')}
        />
      );
    }
    if (!caps.arSupported) {
      return (
        <UnsupportedScreen
          reason="no-ar"
          caps={caps}
          onLaunchSimulator={() => setScreen('simulator')}
        />
      );
    }

    return <ArView capabilities={caps} onExit={() => setScreen('home')} />;
  }

  return (
    <HomePage
      onStart={() => setScreen('ar')}
      onStartSimulator={() => setScreen('simulator')}
      isArSupported={caps.arSupported}
    />
  );
}
