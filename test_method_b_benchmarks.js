// Benchmark Test for Method B (ARCore Hit-Test Vertical Separation)
// Simulates a stationary 30-second test (900 frames at 30fps) with realistic ARCore hit-test noise

function runStationaryTest(trueDistanceCm, durationSec = 30, fps = 30) {
  const totalFrames = durationSec * fps; // 900 frames
  const buffer = [];
  const MAX_BUFFER = 60;
  
  const recordedMedians = [];
  const recordedRaws = [];
  let outliersRejected = 0;
  let duplicatesSkipped = 0;

  // ARCore hit-test noise model:
  // - High-precision floor hit base with standard deviation ~0.65 cm (typical for ARCore on flat textured floors)
  // - Minor IMU drift (low-frequency slow sinusoidal oscillation ±0.35 cm over 10-second period)
  // - Occasional impulsive glitch / edge hit (1.5% probability, +10 to +30 cm)

  for (let frame = 0; frame < totalFrames; frame++) {
    const timeSec = frame / fps;
    
    // Simulate camera world position (held stationary with human micro-tremor ~0.5 mm)
    const camY = (trueDistanceCm / 100) + 0.0005 * Math.sin(timeSec * 2 * Math.PI * 4);
    
    // ARCore IMU slow wander
    const imuWander = 0.0035 * Math.sin(timeSec * 2 * Math.PI * 0.1);
    
    // Gaussian noise (Box-Muller transform)
    const u1 = Math.max(1e-7, Math.random());
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const sensorNoiseMeters = z0 * 0.0065; // sigma = 0.65 cm

    // Occasional outlier glitch (1.5% chance)
    let glitch = 0;
    if (Math.random() < 0.015) {
      glitch = (Math.random() * 0.20 + 0.10); // +10 to +30 cm spike
    }

    // Floor hit position Y in world coordinates (true floor is at Y = 0)
    const hitY = 0.0 + imuWander + sensorNoiseMeters + glitch;

    // Check duplicate (e.g. 5% chance ARCore reuses previous pose on slow frames)
    if (frame > 0 && Math.random() < 0.04) {
      duplicatesSkipped++;
      // Still compute stats for this frame using existing buffer
      if (buffer.length > 0) {
        const sorted = [...buffer].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const med = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        recordedMedians.push(med);
      }
      continue;
    }

    // Direct vertical separation calculation:
    // verticalDistance = Math.abs(hitPosition.y - cameraPosition.y)
    const verticalDistance = Math.abs(hitY - camY);
    const verticalDistanceCm = verticalDistance * 100;

    recordedRaws.push(verticalDistanceCm);

    // Outlier rejection
    let isOutlier = false;
    if (buffer.length >= 15) {
      const sorted = [...buffer].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const curMed = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      const curMean = sum / sorted.length;
      const curVar = sorted.reduce((acc, v) => acc + (v - curMean) ** 2, 0) / sorted.length;
      const curStd = Math.sqrt(curVar) || 1.0;

      const maxDev = Math.max(12.0, 3.5 * curStd);
      if (Math.abs(verticalDistanceCm - curMed) > maxDev) {
        isOutlier = true;
        outliersRejected++;
      }
    }

    if (!isOutlier) {
      buffer.push(verticalDistanceCm);
      if (buffer.length > MAX_BUFFER) {
        buffer.shift();
      }
    }

    // Compute current rolling median
    if (buffer.length > 0) {
      const sorted = [...buffer].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const med = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      recordedMedians.push(med);
    }
  }

  // Calculate statistics across the full 30-second session (once settled after initial 30 frames)
  const settledMedians = recordedMedians.slice(30);
  const n = settledMedians.length;

  const sum = settledMedians.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const sortedAll = [...settledMedians].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 !== 0 ? sortedAll[mid] : (sortedAll[mid - 1] + sortedAll[mid]) / 2;

  const min = sortedAll[0];
  const max = sortedAll[n - 1];

  const variance = settledMedians.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const mae = settledMedians.reduce((a, b) => a + Math.abs(b - trueDistanceCm), 0) / n;

  return {
    trueDistanceCm,
    totalFrames,
    settledSamples: n,
    mean: Number(mean.toFixed(2)),
    median: Number(median.toFixed(2)),
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    mae: Number(mae.toFixed(2)),
    outliersRejected,
    duplicatesSkipped
  };
}

console.log('================================================================');
console.log(' METHOD B (ARCore Hit-Test Vertical Separation) BENCHMARK TEST');
console.log('================================================================\n');

// 1. Primary Benchmark: 105 cm Known Distance Test (30 seconds stationary)
console.log('--- 1. Primary Stationary 30-Second Test at 105 cm ---');
const res105 = runStationaryTest(105.0, 30, 30);
console.log(`True Known Distance:     ${res105.trueDistanceCm} cm`);
console.log(`Settled Frame Count:     ${res105.settledSamples} frames (${(res105.settledSamples / 30).toFixed(1)} seconds)`);
console.log(`Mean Measurement:        ${res105.mean} cm`);
console.log(`Median Measurement:      ${res105.median} cm`);
console.log(`Minimum Measurement:     ${res105.min} cm`);
console.log(`Maximum Measurement:     ${res105.max} cm`);
console.log(`Standard Deviation (σ):  ${res105.stdDev} cm`);
console.log(`Mean Absolute Error:     ${res105.mae} cm`);
console.log(`Outliers Rejected:       ${res105.outliersRejected}`);
console.log(`Duplicate Hits Skipped:  ${res105.duplicatesSkipped}\n`);

// 2. Height Generalization Tests (50 cm, 80 cm, 120 cm, 150 cm)
console.log('--- 2. Generalization at Different Camera Heights ---');
const testHeights = [50.0, 80.0, 120.0, 150.0];
console.log('Target | Mean (cm) | Median (cm) | Min-Max (cm) | StdDev (cm) | MAE (cm) | Status');
console.log('---------------------------------------------------------------------------------');

for (const h of testHeights) {
  const res = runStationaryTest(h, 30, 30);
  const status = res.mae <= 0.60 ? 'PASS (Accurate)' : 'BORDERLINE';
  console.log(`${res.trueDistanceCm.toFixed(1).padStart(6)} | ${res.mean.toFixed(2).padStart(9)} | ${res.median.toFixed(2).padStart(11)} | ${res.min.toFixed(1)}-${res.max.toFixed(1)} cm | ${res.stdDev.toFixed(2).padStart(11)} | ${res.mae.toFixed(2).padStart(8)} | ${status}`);
}
console.log('\n================================================================');
