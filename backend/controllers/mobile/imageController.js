const Image = require('../../models/mobile/imageModel');
const cloudinary = require('../../utils/cloudinary');
const streamifier = require('streamifier');

// Upload single image (multipart)
// multer configured to store in memory (buffer)
exports.uploadImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const buffer = req.file.buffer;
    const uploadResult = await new Promise((resolve, reject) => {
      const upload_stream = cloudinary.uploader.upload_stream(
        { folder: 'vc_images' },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      streamifier.createReadStream(buffer).pipe(upload_stream);
    });

    const doc = await Image.create({
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      contentType: req.file.mimetype,
      meta: { filename: req.file.originalname, fieldname: req.file.fieldname },
    });

    return res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Upload failed', error: err.message });
  }
};
