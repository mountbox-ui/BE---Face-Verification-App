const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

// Configuration constants
const CONFIG = {
  UPLOADS_DIR: 'uploads',
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_FILES: 5,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_EXCEL_TYPES: [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]
};

// Utility functions
const createUploadsDirectory = async () => {
  try {
    if (!fsSync.existsSync(CONFIG.UPLOADS_DIR)) {
      await fs.mkdir(CONFIG.UPLOADS_DIR, { recursive: true });
      console.log(`Created uploads directory: ${CONFIG.UPLOADS_DIR}`);
    }
  } catch (error) {
    console.error('Error creating uploads directory:', error);
    throw error;
  }
};

const generateUniqueFilename = (fieldname, originalname) => {
  const timestamp = Date.now();
  const random = Math.round(Math.random() * 1E9);
  const extension = path.extname(originalname);
  return `${fieldname}-${timestamp}-${random}${extension}`;
};

const isValidFileType = (mimetype) => {
  return [...CONFIG.ALLOWED_IMAGE_TYPES, ...CONFIG.ALLOWED_EXCEL_TYPES].includes(mimetype);
};

// Initialize uploads directory
createUploadsDirectory().catch(console.error);

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CONFIG.UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    try {
      const filename = generateUniqueFilename(file.fieldname, file.originalname);
      cb(null, filename);
    } catch (error) {
      cb(error);
    }
  }
});

// File filter function
const fileFilter = (req, file, cb) => {
  if (isValidFileType(file.mimetype)) {
    cb(null, true);
  } else {
    const allowedTypes = [...CONFIG.ALLOWED_IMAGE_TYPES, ...CONFIG.ALLOWED_EXCEL_TYPES].join(', ');
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed types: ${allowedTypes}`), false);
  }
};

// Multer configuration
const upload = multer({
  storage,
  limits: {
    fileSize: CONFIG.MAX_FILE_SIZE,
    files: CONFIG.MAX_FILES
  },
  fileFilter
});

// Helper function to format file response
const formatFileResponse = (file) => ({
  url: file.path,
  filename: file.filename,
  originalName: file.originalname,
  size: file.size,
  mimetype: file.mimetype,
  uploadedAt: new Date().toISOString()
});

// Single file upload endpoint
router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
        message: 'Please select a file to upload'
      });
    }

    const fileInfo = formatFileResponse(req.file);
    
    res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      data: fileInfo
    });

  } catch (error) {
    console.error('Single upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Upload failed',
      message: error.message
    });
  }
});

// Multiple files upload endpoint
router.post('/multiple', upload.array('files', CONFIG.MAX_FILES), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded',
        message: 'Please select at least one file to upload'
      });
    }

    const uploadedFiles = req.files.map(formatFileResponse);

    res.status(201).json({
      success: true,
      message: `Successfully uploaded ${req.files.length} file${req.files.length > 1 ? 's' : ''}`,
      data: {
        files: uploadedFiles,
        count: uploadedFiles.length
      }
    });

  } catch (error) {
    console.error('Multiple upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Multiple upload failed',
      message: error.message
    });
  }
});

// File info endpoint (optional - to get info about uploaded file)
router.get('/info/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(CONFIG.UPLOADS_DIR, filename);
    
    const stats = await fs.stat(filePath);
    
    res.json({
      success: true,
      data: {
        filename,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        exists: true
      }
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        success: false,
        error: 'File not found',
        message: `File ${req.params.filename} does not exist`
      });
    }
    
    console.error('File info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get file info',
      message: error.message
    });
  }
});

// Delete file endpoint (optional)
router.delete('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(CONFIG.UPLOADS_DIR, filename);
    
    await fs.unlink(filePath);
    
    res.json({
      success: true,
      message: `File ${filename} deleted successfully`
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        success: false,
        error: 'File not found',
        message: `File ${req.params.filename} does not exist`
      });
    }
    
    console.error('File deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete file',
      message: error.message
    });
  }
});

// Enhanced error handling middleware
router.use((error, req, res, next) => {
  console.error('Upload middleware error:', error);

  // Handle Multer-specific errors
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          error: 'File too large',
          message: `Maximum file size is ${CONFIG.MAX_FILE_SIZE / (1024 * 1024)}MB`
        });
      
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          error: 'Too many files',
          message: `Maximum number of files is ${CONFIG.MAX_FILES}`
        });
      
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          error: 'Unexpected file field',
          message: 'The file field name is not expected'
        });
      
      case 'LIMIT_PART_COUNT':
        return res.status(400).json({
          success: false,
          error: 'Too many form parts',
          message: 'Request has too many parts'
        });
      
      default:
        return res.status(400).json({
          success: false,
          error: 'Upload error',
          message: error.message
        });
    }
  }

  // Handle file type validation errors
  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid file type',
      message: error.message
    });
  }

  // Handle other errors
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'An unexpected error occurred during file upload'
  });
});

module.exports = router;