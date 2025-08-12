const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

// Middleware and models
const auth = require('../middleware/auth');
const Student = require('../models/Student');
const School = require('../models/School');

// Face recognition libraries
const faceapi = require('face-api.js');
const canvas = require('canvas');
const { Canvas, Image, ImageData } = canvas;

// Monkey patch for face-api.js
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Configuration
const CONFIG = {
  MODELS_PATH: './models/face_models',
  VERIFICATION_THRESHOLD: 0.6, // Lower is stricter
  MAX_IMAGE_SIZE: 5 * 1024 * 1024, // 5MB
  SUPPORTED_FORMATS: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  DETECTOR_OPTIONS: {
    inputSize: 416,
    scoreThreshold: 0.5
  }
};

// Model loading state
let modelsLoaded = false;
const modelLoadPromise = loadFaceApiModels();

/**
 * Load face-api.js models
 */
async function loadFaceApiModels() {
  try {
    if (modelsLoaded) return;

    console.log('Loading face recognition models...');
    
    // Check if models directory exists
    const modelsExist = await checkModelsExist();
    if (!modelsExist) {
      throw new Error('Face recognition models not found. Please ensure models are placed in the correct directory.');
    }

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromDisk(CONFIG.MODELS_PATH),
      faceapi.nets.faceLandmark68Net.loadFromDisk(CONFIG.MODELS_PATH),
      faceapi.nets.faceRecognitionNet.loadFromDisk(CONFIG.MODELS_PATH)
    ]);

    modelsLoaded = true;
    console.log('Face recognition models loaded successfully');
  } catch (error) {
    console.error('Error loading face recognition models:', error);
    throw error;
  }
}

/**
 * Check if face recognition models exist
 */
async function checkModelsExist() {
  try {
    const modelFiles = [
      'tiny_face_detector_model-weights_manifest.json',
      'face_landmark_68_model-weights_manifest.json',
      'face_recognition_model-weights_manifest.json'
    ];

    const checks = modelFiles.map(async (file) => {
      try {
        await fs.access(path.join(CONFIG.MODELS_PATH, file));
        return true;
      } catch {
        return false;
      }
    });

    const results = await Promise.all(checks);
    return results.every(exists => exists);
  } catch {
    return false;
  }
}

/**
 * Validate base64 image
 */
function validateBase64Image(base64) {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('Invalid image data provided');
  }

  // Check if it's a valid base64 image
  const base64Regex = /^data:image\/(jpeg|jpg|png|webp);base64,/;
  if (!base64Regex.test(base64)) {
    throw new Error('Invalid image format. Only JPEG, PNG, and WebP are supported');
  }

  // Estimate size (base64 is ~4/3 larger than binary)
  const estimatedSize = (base64.length * 3) / 4;
  if (estimatedSize > CONFIG.MAX_IMAGE_SIZE) {
    throw new Error(`Image too large. Maximum size is ${CONFIG.MAX_IMAGE_SIZE / (1024 * 1024)}MB`);
  }

  return true;
}

/**
 * Extract face descriptor from base64 image
 */
async function extractDescriptorFromBase64(base64) {
  try {
    // Ensure models are loaded
    await modelLoadPromise;
    
    // Validate image
    validateBase64Image(base64);

    // Convert base64 to buffer and load as image
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const img = await canvas.loadImage(buffer);

    // Detect face with enhanced options
    const detection = await faceapi
      .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions(CONFIG.DETECTOR_OPTIONS))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      return null;
    }

    // Validate detection quality
    const detectionScore = detection.detection.score;
    if (detectionScore < CONFIG.DETECTOR_OPTIONS.scoreThreshold) {
      console.log(`Low quality face detection: ${detectionScore}`);
      return null;
    }

    return {
      descriptor: Array.from(detection.descriptor),
      confidence: detectionScore,
      landmarks: detection.landmarks?.positions?.length || 0
    };

  } catch (error) {
    console.error('Error extracting face descriptor:', error);
    throw new Error(`Face extraction failed: ${error.message}`);
  }
}

/**
 * Calculate Euclidean distance between two descriptors
 */
function euclideanDistance(desc1, desc2) {
  if (!desc1 || !desc2 || desc1.length !== desc2.length) {
    throw new Error('Invalid descriptors for distance calculation');
  }
  
  return Math.sqrt(
    desc1.reduce((sum, val, i) => sum + Math.pow(val - desc2[i], 2), 0)
  );
}

/**
 * Find best match from group descriptors
 */
function findBestMatch(capturedDescriptor, groupDescriptors, threshold = CONFIG.VERIFICATION_THRESHOLD) {
  if (!groupDescriptors || groupDescriptors.length === 0) {
    return { match: false, distance: null, confidence: 0 };
  }

  let bestDistance = Infinity;
  let bestMatch = false;

  for (const groupDesc of groupDescriptors) {
    try {
      const distance = euclideanDistance(capturedDescriptor, groupDesc);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = distance < threshold;
      }
    } catch (error) {
      console.warn('Error calculating distance for descriptor:', error);
      continue;
    }
  }

  return {
    match: bestMatch,
    distance: bestDistance === Infinity ? null : bestDistance,
    confidence: bestDistance === Infinity ? 0 : Math.max(0, (1 - bestDistance) * 100)
  };
}

/**
 * Log verification attempt
 */
async function logVerificationAttempt(studentId, schoolId, result, confidence, error = null) {
  try {
    // You could implement logging to database or file here
    console.log(`Verification attempt - Student: ${studentId}, School: ${schoolId}, Result: ${result}, Confidence: ${confidence}%, Error: ${error || 'None'}`);
  } catch (logError) {
    console.error('Error logging verification attempt:', logError);
  }
}

// Face verification endpoint
router.post('/:studentId', auth, async (req, res) => {
  let student = null;
  let school = null;

  try {
    const { studentId } = req.params;
    const { capturedImage, descriptor, schoolId, threshold } = req.body;

    // Validate required parameters
    if (!capturedImage && !descriptor) {
      return res.status(400).json({ success: false, result: 'failed', message: 'Captured image or descriptor is required' });
    }

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        result: 'failed',
        message: 'School ID is required'
      });
    }

    // Fetch student and school data
    [student, school] = await Promise.all([
      Student.findById(studentId),
      School.findById(schoolId)
    ]);

    if (!student) {
      return res.status(404).json({
        success: false,
        result: 'failed',
        message: 'Student not found'
      });
    }

    if (!school) {
      return res.status(404).json({
        success: false,
        result: 'failed',
        message: 'School not found'
      });
    }

    // Use client-provided descriptor if available, else extract on server
    let capturedDescriptor;
    let faceQuality = null;
    let landmarksDetected = null;
    if (Array.isArray(descriptor) && descriptor.length) {
      capturedDescriptor = descriptor.map(Number);
    } else {
      const extractionResult = await extractDescriptorFromBase64(capturedImage);
      if (!extractionResult?.descriptor) {
        await logVerificationAttempt(studentId, schoolId, 'failed', 0, 'No face detected');
        return res.json({
          success: false,
          result: 'failed',
          message: 'No face detected in captured image. Please ensure your face is clearly visible and try again.',
          details: { faceDetected: false, imageQuality: 'poor' }
        });
      }
      capturedDescriptor = extractionResult.descriptor;
      faceQuality = extractionResult.confidence ? parseFloat(extractionResult.confidence.toFixed(2)) : null;
      landmarksDetected = extractionResult.landmarks;
    }

    const verificationThreshold = threshold && typeof threshold === 'number' ? threshold : CONFIG.VERIFICATION_THRESHOLD;

    // Prefer per-student descriptor if available
    let matchResult;
    if (Array.isArray(student.faceDescriptor) && student.faceDescriptor.length === 128) {
      const distance = euclideanDistance(capturedDescriptor, student.faceDescriptor);
      matchResult = {
        match: distance < verificationThreshold,
        distance,
        confidence: Math.max(0, (1 - distance) * 100)
      };
    } else {
      // Fall back to group descriptors
      matchResult = findBestMatch(capturedDescriptor, school.groupDescriptors, verificationThreshold);
    }

    // Update student verification status
    const updateData = {
      verified: matchResult.match,
      verificationResult: matchResult.match ? 'success' : 'failed',
      lastVerificationAttempt: new Date(),
      verificationConfidence: Math.round(matchResult.confidence)
    };

    await Student.findByIdAndUpdate(studentId, updateData, { new: true });

    await logVerificationAttempt(studentId, schoolId, matchResult.match ? 'success' : 'failed', matchResult.confidence);

    const response = {
      success: true,
      result: matchResult.match ? 'success' : 'failed',
      message: matchResult.match 
        ? 'Face verification successful. You have been matched.' 
        : 'Face verification failed.',
      details: {
        confidence: Math.round(matchResult.confidence),
        distance: matchResult.distance ? parseFloat(matchResult.distance.toFixed(4)) : null,
        threshold: verificationThreshold,
        faceQuality,
        landmarksDetected,
        groupDescriptorsCount: Array.isArray(school.groupDescriptors) ? school.groupDescriptors.length : 0,
        usedStudentDescriptor: Array.isArray(student.faceDescriptor) && student.faceDescriptor.length === 128
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Face verification error:', error);

    if (student && school) {
      await logVerificationAttempt(req.params.studentId, req.body.schoolId, 'error', 0, error.message);
    }

    if (error.message.includes('models not found') || error.message.includes('Face extraction failed')) {
      return res.status(503).json({
        success: false,
        result: 'failed',
        message: 'Face verification service is temporarily unavailable. Please try again later.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }

    if (error.message.includes('Invalid image')) {
      return res.status(400).json({
        success: false,
        result: 'failed',
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      result: 'failed',
      message: 'An unexpected error occurred during face verification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Health check endpoint for face verification service
router.get('/health', async (req, res) => {
  try {
    const modelsExist = await checkModelsExist();
    
    res.json({
      success: true,
      status: 'healthy',
      modelsLoaded,
      modelsExist,
      config: {
        threshold: CONFIG.VERIFICATION_THRESHOLD,
        maxImageSize: `${CONFIG.MAX_IMAGE_SIZE / (1024 * 1024)}MB`,
        supportedFormats: CONFIG.SUPPORTED_FORMATS
      }
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Batch verification endpoint (optional - for multiple students)
router.post('/batch', auth, async (req, res) => {
  try {
    const { verifications, schoolId } = req.body;

    if (!Array.isArray(verifications) || verifications.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Verifications array is required'
      });
    }

    const school = await School.findById(schoolId);
    if (!school || !school.groupDescriptors?.length) {
      return res.status(400).json({
        success: false,
        message: 'School not found or no group descriptors available'
      });
    }

    const results = [];

    for (const verification of verifications) {
      try {
        const { studentId, capturedImage } = verification;
        const extractionResult = await extractDescriptorFromBase64(capturedImage);
        
        if (extractionResult?.descriptor) {
          const matchResult = findBestMatch(extractionResult.descriptor, school.groupDescriptors);
          
          await Student.findByIdAndUpdate(studentId, {
            verified: matchResult.match,
            verificationResult: matchResult.match ? 'success' : 'failed',
            lastVerificationAttempt: new Date(),
            verificationConfidence: Math.round(matchResult.confidence)
          });

          results.push({
            studentId,
            success: true,
            result: matchResult.match ? 'success' : 'failed',
            confidence: Math.round(matchResult.confidence)
          });
        } else {
          results.push({
            studentId,
            success: false,
            result: 'failed',
            message: 'No face detected',
            confidence: 0
          });
        }
      } catch (error) {
        results.push({
          studentId: verification.studentId,
          success: false,
          result: 'error',
          message: error.message,
          confidence: 0
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${results.length} verifications`,
      results
    });

  } catch (error) {
    console.error('Batch verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Batch verification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;