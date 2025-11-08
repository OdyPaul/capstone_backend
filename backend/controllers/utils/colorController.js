// utils/colorController.js
const sharp = require('sharp');

async function meanRgbFromBuffer(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()                          // respect EXIF
    .resize(64, 64, { fit: 'cover' })  // small, fast
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 3) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const pixels = info.width * info.height;
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

exports.analyzeColors = async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: 'No images uploaded' });
    }
    if (files.length > 6) {
      return res.status(413).json({ error: 'Too many images (max 6)' });
    }

    const means = [];
    for (const f of files) {
      means.push(await meanRgbFromBuffer(f.buffer));
    }

    res.json({ count: means.length, means });
  } catch (err) {
    next ? next(err) : res.status(500).json({ error: err?.message || 'Failed to analyze colors' });
  }
};
