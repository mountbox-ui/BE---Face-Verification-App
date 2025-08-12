const multer = require('multer');
const path = require('path'); // Still needed for path.extname

// Use memory storage for all files
const storage = multer.memoryStorage();

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
    cb(new Error('Unexpected field type!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: commonFileFilter
});

module.exports = upload;
