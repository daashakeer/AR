# Slyte AI Fit Assistant & 100% Metric AR Measurement

A complete, production-ready web application combining the **Slyte AI Fit Assistant** with the **DASH Phone Tilt Level Guide** and **WebXR 3D Augmented Reality Measurement**.

Built with **pure HTML5, CSS3, and ES6 JavaScript**. Zero heavy framework overhead, mobile-first, and 100% calibrated.

---

## 🌟 Key Capabilities

### 1. Slyte AI Fit Assistant
- **Step 1 — Enter Name**: Personalized sizing output and profile syncing.
- **Step 2 — Flat Laid Pant Scan**:
  - Interactive upload zone with pant SVG contour.
  - One-tap selection between **Level Camera**, **WebXR AR 3D Scan**, and **Gallery**.
  - Background image compression for fast inference.
- **Step 3 — Enter Waist Size**: Validated wearing waist input (24" to 60").
- **AI Model Pipeline**: Connects with SAM3 background segmentation and HRNet DeepFashion2 landmark detection to produce:
  - Recommended Trouser Size (e.g., `32`, `M`, `L`)
  - Detailed Garment Dimensions: Waist, Inseam, Outseam, Ankle / Hem, Thigh Width, and Flat Circumference
  - Trouser classification (e.g. Straight Fit, Gurkha, Korean Pleated)
  - Local profile persistence (`slyteFitResult`) & postMessage event emission (`dashFitResult`)

### 2. DASH Phone Tilt Level Guide
Prevents perspective distortion when scanning trousers laid flat on a floor or table:
- **Horizon Level Line**: iPhone-style horizon indicator that rotates with phone roll and snaps bright green when level.
- **Status Pill**: Real-time sensor state:
  - 🟢 **Ready** (within ±5° pitch & roll tolerance)
  - 🟡 **Adjust** (within 5° to 8°)
  - 🔴 **Tilt Phone** (> 8° tilt)
- **Real-Time Directional Guidance**: "Tilt phone forward/backward", "Rotate slightly left/right", "✓ Ready".
- **Pant Outline Guide**: SVG silhouette overlaid on camera feed that glows green when the phone is parallel to the ground.
- **Smart Auto-Capture & Shutter Protection**: Circular SVG progress ring fills when held level; automatically counts down 3-2-1 and takes a clear photo. Tilted manual taps trigger a shake warning and "Adjust phone tilt first" toast.
- **Calibration & Settings**: Manual/Auto capture toggle and level calibration.
- **iOS DeviceOrientation Permission**: Handles iOS 13+ permission prompts smoothly.

### 3. Integrated WebXR AR 3D Measurement
- True metric coordinates ($1.0 = 1.0\text{ m}$) via WebXR hit-testing and ARCore SLAM.
- **Live Phone Tilt HUD inside AR**: Horizon level line and tilt indicators render directly in the AR DOM Overlay so users maintain level camera alignment relative to the detected surface plane.
- 3D keypoint unprojection with `FABRIC_OFFSET` (2mm cloth elevation).
- Desktop WebXR Emulator support for testing without a physical mobile device.

---

## 📂 Project Structure

```
AR/
├── index.html            # Main UI with Slyte AI Fit, Phone Tilt screen & AR overlay
├── style.css             # Unified luxury stylesheet (Slyte aesthetic, Tilt HUD, AR HUD)
├── app.js                # ES6 application engine (Sensors, Tilt, Gradio client, WebXR)
├── build.js              # Production static asset builder for Cloudflare/Vercel
├── test_measurements.js  # Mathematical and architectural verification suite
├── package.json          # Project metadata & npm scripts
├── README.md             # Documentation
└── images/               # Product guides, logos, and branding assets
    ├── logos/
    │   ├── slyte-logo-black.png
    │   └── slyte-only-logo-black.png
    └── other/
        └── pant_photo_guide.png
```

---

## 🚀 Running Locally & Testing

1. **Run Tests**:
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
   Open `http://localhost:8080` in your browser. (Note: WebXR and Device Sensors require `localhost` or HTTPS).
