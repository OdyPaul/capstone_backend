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

  const w = info.width, h = info.height; // e.g., 96x96
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

    // Assume order: red, green, blue (indices 0/1/2). Tolerant checks.
    const targets = [
      { hue: 0,   main: 'r' },
      { hue: 120, main: 'g' },
      { hue: 240, main: 'b' },
    ];
    const passByIndex = targets.map((t, i) => {
      const c = means[i], h = hsv[i];
      if (!c || !h) return false;
      return (
        h.s >= 0.12 &&           // some saturation
        h.v >= 0.18 &&           // not too dark
        closeHue(h.h, t.hue, 45) &&
        dominanceOK(c, t.main, 1.08)
      );
    });

    const overallPassed = passByIndex.length >= 3 && passByIndex[0] && passByIndex[1] && passByIndex[2];

    res.json({
      count: means.length,
      means,              // backwards compatible
      hsv,                // useful for debugging
      passByIndex,        // [bool,bool,bool]
      overallPassed,      // single boolean
    });
  } catch (err) {
    next ? next(err) : res.status(500).json({ error: err?.message || 'Failed to analyze colors' });
  }
};
