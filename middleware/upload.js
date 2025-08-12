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
    console.log('Cloudinary upload params for file:', { fieldname: file.fieldname, originalname: file.originalname, mimetype: file.mimetype });
    let folder = 'uploads';
    let allowed_formats = ['jpg', 'jpeg', 'png', 'webp'];
    let resource_type = 'image';

    if (file.fieldname === 'xlsFile') {
      folder = 'excel_uploads'; // Separate folder for Excel files
      allowed_formats = ['xlsx', 'xls']; // Allow Excel formats
      resource_type = 'raw'; // Treat as raw file
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
