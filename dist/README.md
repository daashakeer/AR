# AR Measurement MVP

A mobile-first, high-precision web application for automated flat surface detection, 3D metric distance calculation, synchronized frame capture, and image/JSON data export.

Built with **pure HTML5, CSS3, and modern ES6 JavaScript**. **No HRNet, AI models, machine learning, or manual point selection.**

---

## 1. Core Features & Architecture

### 1. Automatic Surface Scanning
- Initializes WebXR in `immersive-ar` mode with `hit-test` and `dom-overlay`.
- Probes the visible environment using a multi-directional ray grid (offset rays across the camera FOV) to automatically detect real-world surface hit poses.
- Continuous coplanar filtering evaluates surface normal vectors and planar distance envelopes (tolerance within 4 cm) to identify valid flat surfaces without manual user tapping.

### 2. Automated Farthest-Two-Points Selection
- Collects valid coplanar points in real-time from the detected surface.
- Calculates pairwise physical 3D distances using the metric reference space coordinates:
  $$\text{realDistanceMeters} = \sqrt{(X_2 - X_1)^2 + (Y_2 - Y_1)^2 + (Z_2 - Z_1)^2}$$
- Automatically selects the pair $(A, B)$ that maximizes this physical distance.
- Displays high-contrast 2D projected markers and connecting measurement lines on the live HUD overlay.

### 3. Synchronized Instantaneous Capture
- Freezes camera frame, 3D metric coordinates $(X, Y, Z)$, and camera calibration projection matrices at the exact instant the **Capture** button is tapped.
- Preserves the **original, unannotated RGB image** (downloadable as PNG).
- Generates an **annotated preview** with Point A, Point B, connecting lines, and metric callouts.

### 4. Mathematical Projection & Pixel Distance Calculation
- Projects 3D metric coordinates $(X, Y, Z)$ to 2D image pixel coordinates $(x, y)$ using the camera's view matrix and projection matrix from that specific frame:
  $$\mathbf{P}_{\text{cam}} = \mathbf{V} \cdot \mathbf{P}_{\text{world}}$$
  $$\mathbf{P}_{\text{clip}} = \mathbf{P}_{\text{proj}} \cdot \mathbf{P}_{\text{cam}}$$
  $$x_{\text{pixel}} = \left(\frac{x_{\text{ndc}} + 1}{2}\right) \times W, \quad y_{\text{pixel}} = \left(\frac{1 - y_{\text{ndc}}}{2}\right) \times H$$
- Calculates 2D Euclidean pixel distance:
  $$\text{pixelDistance} = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$$
- Calculates scaling ratios:
  $$\text{metersPerPixel} = \frac{\text{realDistanceMeters}}{\text{pixelDistance}}$$
  $$\text{pixelsPerMeter} = \frac{\text{pixelDistance}}{\text{realDistanceMeters}}$$

---

## 2. API Support & Hardware Compatibility

| Platform / Browser | Support Status | Notes |
| :--- | :--- | :--- |
| **Android Chrome (v81+)** | **Full Support** | Requires [Google Play Services for AR (ARCore)](https://play.google.com/store/apps/details?id=com.google.ar.core). Supports WebXR `immersive-ar`, `hit-test`, and `dom-overlay`. |
| **Desktop Chrome / Edge** | **WebXR Emulator** | Tested via Chrome DevTools WebXR tab or the built-in **WebXR Emulator Mode** button. |
| **iOS Safari** | **Unsupported** | Apple Safari on iOS does not support the WebXR Device API natively. Requires specialized browsers such as Mozilla WebXR Viewer. |

### Camera Frame Access & Limitations
- **WebXR Raw Camera Access (`camera-access`)**: Where supported by experimental flags or browser implementation (`XRWebGLBinding.getCameraImage`), raw RGB textures are read directly.
- **Privacy Isolation**: In standard Android Chrome WebXR, the live camera feed is composited by the OS beneath the WebGL canvas, and raw camera pixel access is restricted for privacy. In this configuration, the app captures the WebGL viewport buffer, marks `measurementSource` accurately, and does not invent fake camera feeds.

---

## 3. Export Data Format

The application provides two export actions:
1. **Download Image**: Downloads the original, unannotated captured image (`.png`).
2. **Download JSON**: Exports calculated measurements matching the exact schema:

```json
{
  "imageWidth": 1920,
  "imageHeight": 1080,
  "pointA": {
    "xPixel": 420,
    "yPixel": 300,
    "xMeters": 0.1,
    "yMeters": 0.2,
    "zMeters": 0.0
  },
  "pointB": {
    "xPixel": 920,
    "yPixel": 300,
    "xMeters": 0.6,
    "yMeters": 0.2,
    "zMeters": 0.0
  },
  "pixelDistance": 500,
  "realDistanceMeters": 0.5,
  "metersPerPixel": 0.001,
  "pixelsPerMeter": 1000,
  "measurementSource": "AR (WebXR Hit-Test)",
  "captureTimestamp": "2026-10-11T13:12:00.000Z"
}
```

---

## 4. Deployment to Cloudflare Pages

This application has no Node.js compilation, bundling, or external build steps.

To deploy to Cloudflare Pages:
1. Connect your GitHub repository to Cloudflare Pages.
2. In the deployment settings:
   - **Framework preset**: None
   - **Build command**: (Leave empty)
   - **Build output directory**: `/` (root directory containing `index.html`)
3. Deploy! Cloudflare Pages automatically provides HTTPS, which is required for WebXR and camera permissions.

---

## 5. Local Development & Testing

Serve locally over a local web server:

```bash
# Using Python
python -m http.server 8000

# Or using Node
npx serve .
```

Access via `http://localhost:8000` (localhost is treated as a secure context by Chrome).
To test on a physical Android device, use Chrome Remote Debugging (`chrome://inspect`) with port forwarding over USB.
