// const express = require('express');
// const router = express.Router();
// const auth = require('../middleware/auth');
// const Student = require('../models/Student');

// // Mark verification result
// router.post('/:studentId', auth, async (req, res) => {
//     const { result } = req.body; // 'success' or 'failed'
//     const student = await Student.findByIdAndUpdate(
//         req.params.studentId,
//         { verified: result === 'success', verificationResult: result },
//         { new: true }
//     );
//     res.json(student);
// });

// module.exports = router;

// For real face verification on local server
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Student = require('../models/Student');
const School = require('../models/School');
require('@tensorflow/tfjs-node');
const faceapi = require('face-api.js');
const canvas = require('canvas');
const { Canvas, Image, ImageData } = canvas;
const path = require('path');
const MODELS_PATH = path.join(__dirname, '../models/face_models');
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

async function extractDescriptorFromBase64(base64) {
  // Load models
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);

  // Convert base64 to buffer and load as image
  const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), 'base64');
  const img = await canvas.loadImage(buffer);

  const detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  return detection ? Array.from(detection.descriptor) : null;
}

function euclideanDistance(desc1, desc2) {
  return Math.sqrt(desc1.reduce((sum, val, i) => sum + Math.pow(val - desc2[i], 2), 0));
}

router.post('/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { capturedImage, schoolId } = req.body;

    const student = await Student.findById(studentId);
    const school = await School.findById(schoolId);

    if (!school.groupDescriptors || school.groupDescriptors.length === 0) {
      return res.json({ 
        result: 'failed', 
        message: 'No group descriptors found. Please regenerate face descriptors from the group photo or upload a new group photo with clear faces.' 
      });
    }

    const capturedDescriptor = await extractDescriptorFromBase64(capturedImage);
    if (!capturedDescriptor) {
      return res.json({ result: 'failed', message: 'No face detected in captured image.' });
    }

    // Compare with all group descriptors
    const threshold = 0.6; // Lower is stricter, 0.6 is typical
    const match = school.groupDescriptors.some(desc => euclideanDistance(desc, capturedDescriptor) < threshold);

    await Student.findByIdAndUpdate(studentId, {
      verified: match,
      verificationResult: match ? 'success' : 'failed'
    });

    res.json({
      result: match ? 'success' : 'failed',
      message: match ? 'Face matched with group photo.' : 'Face not found in group photo.'
    });
  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;