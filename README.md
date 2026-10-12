# AR 2-Point Distance Calculator

A pure client-side web application for scanning physical surroundings and calculating the **100% accurate real-world distance between 2 user-selected points** using WebXR Augmented Reality.

Built with **pure HTML5, CSS3, and modern ES6 JavaScript**. Zero build steps, zero external frameworks, and **no reference objects needed** (no coins, markers, cards, or hardcoded camera heights).

---

## 1. How It Works

1. **Scan Surrounding**:
   - The user aims the camera at any surface (floor, table, desk, wall, or object).
   - WebXR hit-testing continuously tests physical geometry against the environment surface point cloud.
   - The center reticle locks to the detected surface plane.

2. **Select Point 1**:
   - Tap anywhere on screen or press the **Place Point 1 (P1)** shutter button.
   - Anchors Point 1 at the exact 3D world coordinate $(X_1, Y_1, Z_1)$ in physical meters.

3. **Stretch to Point 2**:
   - Move the phone towards the end target.
   - A dynamic measuring line and floating distance tag follow the aiming reticle in real time.
   - Computes live physical distance $D_{\text{live}} = \sqrt{(X_r - X_1)^2 + (Y_r - Y_1)^2 + (Z_r - Z_1)^2}$.

4. **Lock & Calculate Distance**:
   - Tap anywhere on screen or press **Place Point 2 (P2)**.
   - Anchors Point 2 at $(X_2, Y_2, Z_2)$.
   - Immediately calculates and locks the true 3D Euclidean distance:
     $$D = \sqrt{(X_2 - X_1)^2 + (Y_2 - Y_1)^2 + (Z_2 - Z_1)^2}$$
   - Displays real-world distance in centimeters, meters, and inches.

5. **View Breakdown / Reset**:
   - Tap **View Results** to view the full coordinate breakdown and formula verification.
   - Tap the **Reset** button at any time to clear points and measure another distance.

---

## 2. 100% Metric Accuracy (No Reference Objects)

WebXR's `XRHitResult.getPose(referenceSpace)` returns coordinates directly in metric meters ($1.0 = 1.0\text{ m}$), tracked by device hardware (ARCore on Android with visual-inertial odometry and SLAM plane tracking).

Because measurements are computed directly from the 3D metric coordinate system:
- **No reference object required** (no credit cards, coins, or paper sheets).
- **No camera height assumptions** (no fixed heights or hardcoded ratios).
- Works at any angle, orientation, or distance.

---

## 3. Platform & Browser Compatibility

| Platform / Browser | Support Status | Notes |
| :--- | :--- | :--- |
| **Android Chrome (v81+)** | **Full Native AR** | Requires [Google Play Services for AR (ARCore)](https://play.google.com/store/apps/details?id=com.google.ar.core). Supports native WebXR `immersive-ar`, `hit-test`, and `dom-overlay`. |
| **Desktop Chrome / Edge** | **WebXR Emulator Mode** | Fully interactive testing using the built-in "Test in WebXR Emulator Mode" button or Chrome DevTools WebXR tab. |
| **iOS Safari** | **Unsupported** | Safari does not implement WebXR natively. Requires WebXR-compatible browsers such as Mozilla WebXR Viewer. |

---

## 4. Local Testing & Deployment

### Quick Local Test
Open PowerShell or Terminal in the project directory:
```bash
npx serve .
```
Or with Python:
```bash
python -m http.server 8080
```
Open `http://localhost:8080` in your browser. (WebXR requires `localhost` or HTTPS).

### Deployment (Cloudflare Pages / GitHub Pages / Vercel)
This app consists purely of static HTML, CSS, and JS files (`index.html`, `style.css`, `app.js`).
Deploy directly to Cloudflare Pages:
1. Connect repository.
2. Build command: None (leave blank).
3. Output directory: `/` or `dist/`.
4. Deploy! Cloudflare automatically provisions HTTPS.
