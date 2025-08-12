const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Import fs module

// Helper function to ensure directory exists
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const commonStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    let dest;
    if (file.fieldname === 'xlsFile') {
      dest = path.join(__dirname, '../uploads/excel');
    } else if (file.fieldname === 'groupPhoto') {
      dest = path.join(__dirname, '../uploads/images');
    } else {
      dest = path.join(__dirname, '../uploads'); // Fallback for other fields
    }
    ensureDirExists(dest);
    cb(null, dest);
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const commonFileFilter = (req, file, cb) => {
  if (file.fieldname === 'xlsFile') {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed for xlsFile!'), false);
    }
  } else if (file.fieldname === 'groupPhoto') {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, jpeg, png, webp) are allowed for groupPhoto!'), false);
    }
  } else {
    // For any other unexpected fields
    cb(new Error('Unexpected field type!'), false);
  }
};

const upload = multer({
  storage: commonStorage,
  fileFilter: commonFileFilter
});

module.exports = upload;
