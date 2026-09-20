import { useState, useEffect } from 'react';
import {
  isMobileDevice,
  getBrowserName,
  getDeviceType,
  isWebXRAvailable,
  isArSupported,
  hasCameraDevice,
} from '../utils/deviceDetect';

export interface DeviceCapabilities {
  checking: boolean;
  isMobile: boolean;
  deviceType: string;
  browserName: string;
  webXRSupported: boolean;
  arSupported: boolean;
  hasCamera: boolean;
}

export function useDeviceCapabilities(): DeviceCapabilities {
  const [caps, setCaps] = useState<DeviceCapabilities>({
    checking: true,
    isMobile: false,
    deviceType: 'Unknown',
    browserName: 'Unknown',
    webXRSupported: false,
    arSupported: false,
    hasCamera: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      const isMobile = isMobileDevice();
      const deviceType = getDeviceType();
      const browserName = getBrowserName();
      const webXRSupported = isWebXRAvailable();
      const [arSupported, hasCamera] = await Promise.all([
        isArSupported(),
        hasCameraDevice(),
      ]);

      if (!cancelled) {
        setCaps({
          checking: false,
          isMobile,
          deviceType,
          browserName,
          webXRSupported,
          arSupported,
          hasCamera,
        });
      }
    }

    detect();
    return () => { cancelled = true; };
  }, []);

  return caps;
}
