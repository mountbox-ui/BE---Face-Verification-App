const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Storage for image uploads (e.g., group photos)
const imageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'uploads/images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    resource_type: 'image', // Explicitly image
    public_id: (req, file) => Date.now() + '-' + file.originalname.split('.')[0]
  }
});

// Storage for raw file uploads (e.g., Excel files)
const excelStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'uploads/excel',
    allowed_formats: ['xlsx', 'xls'],
    resource_type: 'raw', // Explicitly raw
    public_id: (req, file) => Date.now() + '-' + file.originalname.split('.')[0]
  }
});

// Multer instances for different file types
exports.imageUpload = multer({ storage: imageStorage });
exports.excelUpload = multer({ storage: excelStorage });

// Combined upload middleware for routes
exports.fields = (fieldsArray) => {
  return (req, res, next) => {
    const uploadMiddleware = multer({
      storage: new CloudinaryStorage({
        cloudinary: cloudinary,
        params: async (req, file) => {
          if (file.fieldname === 'xlsFile') {
            return {
              folder: 'uploads/excel',
              allowed_formats: ['xlsx', 'xls'],
              resource_type: 'raw',
              public_id: Date.now() + '-' + file.originalname.split('.')[0]
            };
          } else if (file.fieldname === 'groupPhoto') {
            return {
              folder: 'uploads/images',
              allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
              resource_type: 'image',
              public_id: Date.now() + '-' + file.originalname.split('.')[0]
            };
          }
          return {}; // Default empty params if fieldname doesn't match
        }
      })
    }).fields(fieldsArray);
    uploadMiddleware(req, res, (err) => {
      if (err) {
        console.error('Multer upload error:', err);
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  };
};
