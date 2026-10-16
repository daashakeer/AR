# Unified AR 3D Measurement & DASH Phone Tilt Level Guide

A complete, production-ready web application combining **Apple-Style Phone Tilt Level Guidance** and **WebXR 3D Augmented Reality Metric Measurement** into a single, seamless frontend.

Built with **pure HTML5, CSS3, and modern ES6 JavaScript**. Zero heavy framework overhead, mobile-first, and 100% metric-accurate without reference objects.

---

## 🌟 How the Unified Frontend Works

### 1. Dual-Sensor Scanning & Alignment
When AR starts:
- **WebXR Hit-Testing**: Continuously scans surrounding floor or table geometry and locks to the physical surface plane.
- **Phone Tilt Level Guide (DASH)**: Evaluates motion sensor pitch and roll in real time:
  - 🟢 **Ready**: Within $\pm 5.0^\circ$ of flat ground level.
  - 🟡 **Adjust**: Within $5.0^\circ$ to $8.0^\circ$ (provides directional guidance: *"Tilt phone forward/backward"*, *"Rotate slightly left/right"*).
  - 🔴 **Tilt Phone**: $> 8.0^\circ$ tilt.
- **Horizon Level Line**: iPhone-style horizon indicator that rotates with phone roll and snaps bright green when level.
- **Trouser SVG Contour**: Overlaid on the camera feed so users can align flat laid trousers; glows bright green when level.

### 2. Smart Auto-Capture & Backend Inference
- **Automatic Shutter Trigger**: When **both** conditions are satisfied:
  1. The AR has scanned the surroundings and locked the surface plane.
  2. The phone tilt is perfect (held level within $\pm 5^\circ$ for ~1.2s).
- The circular SVG progress ring fills smoothly around the shutter button.
- A 3-2-1 countdown overlay engages, the camera flashes, and the exact frame texture is captured alongside frozen camera poses, projection matrices, and surface plane geometry.
- If the phone tilts or loses the surface during the countdown, auto-capture pauses and resets to protect image quality.
- **Manual Tap Protection**: Users can also tap the shutter button manually. If tapped while tilted, the shutter shakes and warns *"Adjust phone tilt first"*.

### 3. Backend ZeroGPU Inference & 3D Keypoint Unprojection
- Captured image is dispatched to the HRNet DeepFashion2 backend via the Gradio Queue protocol (`https://dashgaming-slytear.hf.space`).
- Backend detects 14 garment landmarks on the trousers.
- Each landmark pixel coordinate $(u, v)$ is unprojected into the physical 3D world along the camera ray and intersected with the detected surface plane with a $+2\text{mm}$ fabric elevation offset (`FABRIC_OFFSET`).
- Computes complete metric dimensions:
  - **Waist Width & Circumference**
  - **Inseam Length**
  - **Outseam Length**
  - **Thigh Width**
  - **Hem / Ankle Width**
- Interactive 3D pins appear in the AR viewport, and the detailed Results Screen displays the dimensions, plotted 2D debug canvas, and full 3D coordinates.

---

## 📂 Project Structure

```
AR/
├── index.html            # Unified UI (AR session, Phone Tilt HUD, overlays & results)
├── style.css             # High-contrast luxury styling (Tilt HUD, Horizon, Shutter ring)
├── app.js                # Core ES6 engine (WebXR, SensorManager, AutoCapture, Gradio API)
├── build.js              # Production asset builder for Cloudflare/Vercel
├── test_measurements.js  # Mathematical and architectural verification suite
├── package.json          # Project metadata & npm scripts
├── dist/                 # Production static bundle
└── README.md             # Documentation
```

---

## 🚀 Running Locally & Testing

1. **Run Unit Tests**:
   ```bash
   npm test
   ```

2. **Build for Production (`dist/`)**:
   ```bash
   npm run build
   ```

3. **Start Local Server**:
   ```bash
   npx serve .
   # Or with Python:
   python -m http.server 8080
   ```
   Open `http://localhost:8080` in your browser. (WebXR and Device Sensors require `localhost` or HTTPS).
