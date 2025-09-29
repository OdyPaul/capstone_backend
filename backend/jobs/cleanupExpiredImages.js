const cron = require('node-cron');
const Image = require('../models/Image');
const cloudinary = require('../utils/cloudinary');

// Run every day at 01:00
cron.schedule('0 1 * * *', async () => {
  try {
    const now = new Date();
    const expired = await Image.find({ expiresAt: { $lte: now } });
    if (!expired.length) return;

    for (const img of expired) {
      try {
        // delete from cloudinary
        if (img.publicId) {
          await cloudinary.uploader.destroy(img.publicId);
        }
      } catch (err) {
        console.error('Cloud delete failed', img.publicId, err.message);
      }
      // Remove doc
      await Image.findByIdAndDelete(img._id);
    }
    console.log(`Cleanup run: removed ${expired.length} expired images`);
  } catch (err) {
    console.error('Cleanup job error', err);
  }
});
