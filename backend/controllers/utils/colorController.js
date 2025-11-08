// controllers/utils/colorController.js
const sharp = require('sharp');

// Average only the center region after resize to reduce background influence
async function centerMeanRgbFromBuffer(buffer, outSize = 96, centerFrac = 0.5) {
  const { data, info } = await sharp(buffer)
    .rotate() // respect EXIF
    .resize(outSize, outSize, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width, h = info.height;
  const x0 = Math.floor((1 - centerFrac) / 2 * w);
  const y0 = Math.floor((1 - centerFrac) / 2 * h);
  const x1 = Math.ceil((1 + centerFrac) / 2 * w);
  const y1 = Math.ceil((1 + centerFrac) / 2 * h);

  let r = 0, g = 0, b = 0, cnt = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * w * 3;
    for (let x = x0; x < x1; x++) {
      const i = row + x * 3;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      cnt++;
    }
  }
  return { r: r / cnt, g: g / cnt, b: b / cnt };
}

function rgbToHsv({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function closeHue(h, target, tol = 45) {
  const diff = Math.abs(h - target);
  return Math.min(diff, 360 - diff) <= tol;
}

function dominanceOK(rgb, main, margin = 1.08) {
  const { r, g, b } = rgb;
  if (main === 'r') return r > margin * g && r > margin * b;
  if (main === 'g') return g > margin * r && g > margin * b;
  return b > margin * r && b > margin * g;
}

exports.analyzeColors = async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No images uploaded' });
    if (files.length > 6) return res.status(413).json({ error: 'Too many images (max 6)' });

    // Compute center-weighted means and HSV per file
    const means = [];
    const hsv = [];
    for (const f of files) {
      const m = await centerMeanRgbFromBuffer(f.buffer, 96, 0.5); // 50% center
      means.push(m);
      hsv.push(rgbToHsv(m));
    }

    // If a baseline is present, expect order: [baselineGray, red, green, blue]
    const hasBaseline = means.length >= 4;
    const baselineIdx = hasBaseline ? 0 : -1;

    const targets = [
      { hue: 0,   main: 'r' },   // red
      { hue: 120, main: 'g' },   // green
      { hue: 240, main: 'b' },   // blue
    ];

    let passByIndex = [];
    if (hasBaseline) {
      const baseHSV = hsv[baselineIdx];
      const baseS = baseHSV.s, baseV = baseHSV.v;

      // More tolerant absolute thresholds when we also see a relative lift vs baseline
      const SAT_MIN = 0.10;         // absolute minimum saturation
      const VAL_MIN = 0.15;         // absolute minimum brightness
      const DELTA_S_MIN = 0.04;     // required saturation increase vs baseline
      const DELTA_V_MIN = 0.03;     // slight brightness rise helps robustness

      passByIndex = targets.map((t, i) => {
        const idx = i + 1; // skip baseline (0)
        const c = means[idx], h = hsv[idx];
        if (!c || !h) return false;
        const okAbs =
          h.s >= SAT_MIN &&
          h.v >= VAL_MIN &&
          closeHue(h.h, t.hue, 45) &&
          dominanceOK(c, t.main, 1.08);

        const okDelta =
          (h.s - baseS) >= DELTA_S_MIN &&
          (h.v - baseV) >= DELTA_V_MIN;

        return okAbs && okDelta;
      });
    } else {
      // No baseline: fall back to absolute checks on the first three images
      passByIndex = targets.map((t, i) => {
        const c = means[i], h = hsv[i];
        if (!c || !h) return false;
        return (
          h.s >= 0.12 &&
          h.v >= 0.18 &&
          closeHue(h.h, t.hue, 45) &&
          dominanceOK(c, t.main, 1.08)
        );
      });
    }

    const overallPassed = passByIndex.length >= 3 && passByIndex[0] && passByIndex[1] && passByIndex[2];

    res.json({
      count: means.length,
      means,              // backwards compatible
      hsv,                // useful for debugging
      passByIndex,        // [bool,bool,bool] for R,G,B
      overallPassed,      // single boolean
      baselineUsed: hasBaseline,
    });
  } catch (err) {
    next ? next(err) : res.status(500).json({ error: err?.message || 'Failed to analyze colors' });
  }
};
