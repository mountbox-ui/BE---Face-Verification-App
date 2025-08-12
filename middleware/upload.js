const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Import fs module

// Helper function to ensure directory exists
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dest = path.join(__dirname, '../uploads'); // Base uploads directory
        ensureDirExists(dest); // Ensure base uploads directory exists
        cb(null, dest);
    },
    filename: function (req, file, cb) {
        // Use original filename with a timestamp to prevent overwrites
        cb(null, file.fieldname + '-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Export the combined fields middleware
exports.fields = (fieldsArray) => {
  return upload.fields(fieldsArray);
};

// For single file uploads (if needed elsewhere)
exports.single = (fieldName) => {
  return upload.single(fieldName);
};

// Export specific upload types for clarity in routes
exports.imageUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const dest = path.join(__dirname, '../uploads/images');
      ensureDirExists(dest);
      cb(null, dest);
    },
    filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname); }
  }),
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, jpeg, png, webp) are allowed!'), false);
    }
  }
});

exports.excelUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const dest = path.join(__dirname, '../uploads/excel');
      ensureDirExists(dest);
      cb(null, dest);
    },
    filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname); }
  }),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed!'), false);
    }
  }
});
