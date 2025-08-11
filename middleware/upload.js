// const multer = require('multer');
// const path = require('path');

// const storage = multer.diskStorage({
//     destination: function (req, file, cb) {
//         if (file.fieldname === 'groupPhoto') {
//             cb(null, 'uploads/');
//         } else if (file.fieldname === 'xlsFile') {
//             cb(null, 'uploads/');
//         }
//     },
//     filename: function (req, file, cb) {
//         cb(null, Date.now() + '-' + file.originalname);
//     }
// });

// const upload = multer({ storage });

// module.exports = upload;

// const multer = require('multer');
// const path = require('path');

// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, 'uploads/');
//   },
//   filename: function (req, file, cb) {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
//   }
// });

// const upload = multer({ storage });

// module.exports = upload;

const multer = require('multer');
const path = require('path');

// Use disk storage for handling both images and XLS files
const uploadsRoot = process.env.UPLOADS_DIR || 'uploads';
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsRoot + '/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const base = file.fieldname;
    cb(null, `${base}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ storage });

module.exports = upload;
