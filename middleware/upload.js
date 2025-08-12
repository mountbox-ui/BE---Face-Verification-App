const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Files will be saved in the 'uploads/' directory
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
    destination: function (req, file, cb) { cb(null, 'uploads/images'); },
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
    destination: function (req, file, cb) { cb(null, 'uploads/excel'); },
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
