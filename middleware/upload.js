const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Set up Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    let folder = 'uploads';
    let allowed_formats = [];
    let resource_type = 'image'; // Default to image

    if (file.fieldname === 'xlsFile') {
      folder = 'excel_uploads';
      allowed_formats = ['xlsx', 'xls'];
      resource_type = 'raw'; // Explicitly set to raw for Excel
    } else if (file.fieldname === 'groupPhoto') {
      folder = 'uploads';
      allowed_formats = ['jpg', 'jpeg', 'png', 'webp'];
      resource_type = 'image'; // Explicitly set to image for photos
    }
    
    return {
      folder: folder,
      allowed_formats: allowed_formats,
      resource_type: resource_type,
      public_id: Date.now() + '-' + file.originalname.split('.')[0]
    };
  }
});

const upload = multer({ storage });

module.exports = upload;
