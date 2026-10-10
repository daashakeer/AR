import React from 'react';
import type { DeviceCapabilities } from '../hooks/useDeviceCapabilities';

interface Props {
  reason: 'desktop' | 'no-webxr' | 'no-ar' | 'no-camera';
  caps: DeviceCapabilities;
  onLaunchSimulator?: () => void;
}

export const UnsupportedScreen: React.FC<Props> = ({ reason, caps, onLaunchSimulator }) => {
  const messages: Record<Props['reason'], { title: string; body: string; tips: string[] }> = {
    desktop: {
      title: '📱 Open on Mobile (or Try Simulator)',
      body: 'Real AR measurement requires a smartphone with a rear camera and ARCore support. You can also test right now using our built-in 3D AR Simulator!',
      tips: [
        'To use real AR, open this site on an Android phone using Chrome.',
        'Make sure your device supports Google ARCore.',
        'Or click below to launch the interactive 3D Simulator on your desktop.',
      ],
    },
    'no-webxr': {
      title: '⚠️ WebXR Not Available',
      body: 'Your browser does not support the WebXR Device API required for native AR. You can still test using the 3D Simulator.',
      tips: [
        'Use Google Chrome (latest) on Android.',
        'Update your browser to the latest version.',
        'Make sure you\'re accessing the site over HTTPS.',
      ],
    },
    'no-ar': {
      title: '⚠️ AR Not Supported',
      body: 'Your browser supports WebXR but immersive-ar sessions are not available on this device.',
      tips: [
        'Install Google Play Services for AR (ARCore) from the Play Store.',
        'Try on a different Android device that supports ARCore.',
        'Chrome on Android is the most compatible browser for WebXR AR.',
      ],
    },
    'no-camera': {
      title: '📷 No Camera Found',
      body: 'No camera was detected on this device. AR measurement requires a rear-facing camera.',
      tips: [
        'Check that your device has a working camera.',
        'Allow camera access in browser settings.',
      ],
    },
  };

  const { title, body, tips } = messages[reason];

  return (
    <div className="unsupported-screen">
      <div className="unsupported-card">
        <h1 className="unsupported-title">{title}</h1>
        <p className="unsupported-body">{body}</p>

        {onLaunchSimulator && (
          <button className="unsupported-sim-btn" onClick={onLaunchSimulator}>
            🎮 Launch 3D AR Simulator
          </button>
        )}

        <ul className="unsupported-tips">
          {tips.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>

        <div className="unsupported-device-info">
          <p>Detected: {caps.deviceType} · {caps.browserName}</p>
          <p>WebXR: {caps.webXRSupported ? '✓' : '✗'} · Immersive AR: {caps.arSupported ? '✓' : '✗'}</p>
        </div>

        <div className="unsupported-disclaimer">
          <p>WebXR immersive-ar is best supported on Android Chrome with ARCore.</p>
        </div>
      </div>
    </div>
  );
};
