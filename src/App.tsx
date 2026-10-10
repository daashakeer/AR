import React, { useState } from 'react';
import { HomePage } from './components/HomePage';
import { ArView } from './components/ArView';
import { UnsupportedScreen } from './components/UnsupportedScreen';
import { useDeviceCapabilities } from './hooks/useDeviceCapabilities';
import type { MeasurementMode } from './components/HUD';
import './styles/global.css';

type AppScreen = 'home' | 'ar' | 'simulator';

export default function App() {
  const caps = useDeviceCapabilities();
  const [screen, setScreen] = useState<AppScreen>('home');
  const [initialMode, setInitialMode] = useState<MeasurementMode>('manual');

  // Still detecting capabilities
  if (caps.checking) {
    return (
      <div className="splash">
        <div className="splash-spinner" />
        <p>Checking device capabilities…</p>
      </div>
    );
  }

  // Active 3D Simulator screen (available on all devices including desktop)
  if (screen === 'simulator') {
    return (
      <ArView
        capabilities={caps}
        isSimulator={true}
        initialMode={initialMode}
        onExit={() => setScreen('home')}
      />
    );
  }

  // Active Real WebXR AR screen
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
    // If not in garment mode and WebXR is missing, show unsupported screen
    if (initialMode !== 'garment') {
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
    }

    return (
      <ArView
        capabilities={caps}
        isSimulator={false}
        initialMode={initialMode}
        onExit={() => setScreen('home')}
      />
    );
  }

  // Home Screen Handlers
  const handleStartManual = () => {
    setInitialMode('manual');
    if (caps.isMobile && caps.arSupported) {
      setScreen('ar');
    } else {
      setScreen('simulator');
    }
  };

  const handleStartGarment = () => {
    setInitialMode('garment');
    if (caps.isMobile && caps.hasCamera) {
      setScreen('ar');
    } else if (caps.isMobile && caps.arSupported) {
      setScreen('ar');
    } else {
      setScreen('simulator');
    }
  };

  const handleStartSimulator = () => {
    setInitialMode('manual');
    setScreen('simulator');
  };

  return (
    <HomePage
      onStart={handleStartManual}
      onStartGarment={handleStartGarment}
      isArSupported={caps.arSupported}
    />
  );
}
