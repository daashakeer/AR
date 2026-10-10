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
        onExit={() => setScreen('home')}
      />
    );
  }

  // Active Real WebXR AR screen
  if (screen === 'ar') {
    // If somehow entered AR screen without mobile/WebXR, route gracefully
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

    return (
      <ArView
        capabilities={caps}
        isSimulator={false}
        onExit={() => setScreen('home')}
      />
    );
  }

  // Home Screen
  const handleStart = () => {
    if (caps.isMobile && caps.arSupported) {
      setScreen('ar');
    } else {
      // Desktop or device without WebXR AR: automatically launch or prompt simulator
      setScreen('simulator');
    }
  };

  return (
    <HomePage
      onStart={handleStart}
      onStartSimulator={() => setScreen('simulator')}
      isArSupported={caps.arSupported}
    />
  );
}
