// For real face verification on local server + Cloudinary
const School = require('../models/School');
const Student = require('../models/Student');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const os = require('os');

// Cloudinary setup
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Face-api.js setup
const faceapi = require('face-api.js');
const canvas = require('canvas');
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODELS_PATH = path.join(__dirname, '../models/face_models');

async function loadFaceApiModels() {
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);
}

async function extractGroupDescriptors(imagePath) {
  try {
    console.log('Loading face detection models...');
    await loadFaceApiModels();

    console.log('Loading image from path:', imagePath);
    const img = await canvas.loadImage(imagePath);

    console.log('Detecting faces...');
    const detections = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({
      inputSize: 512,
      scoreThreshold: 0.3
    }))
    .withFaceLandmarks()
    .withFaceDescriptors();

    if (detections.length === 0) {
      console.log('Retrying with lower threshold...');
      const detections2 = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({
        inputSize: 256,
        scoreThreshold: 0.1
      }))
      .withFaceLandmarks()
      .withFaceDescriptors();

      if (detections2.length === 0) {
        throw new Error('No faces detected in the group photo.');
      }
      return detections2.map(det => Array.from(det.descriptor));
    }

    return detections.map(det => Array.from(det.descriptor));
  } catch (error) {
    console.error('Error in extractGroupDescriptors:', error);
    throw error;
  }
}

// Helper to get first non-empty value for a set of possible header names
function getCell(row, possibleKeys) {
  for (const key of possibleKeys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return '';
}

exports.addSchool = async (req, res) => {
  try {
    const xlsFile = req.files.xlsFile ? req.files.xlsFile[0] : null;
    const groupPhoto = req.files.groupPhoto ? req.files.groupPhoto[0] : null;

    if (!xlsFile) return res.status(400).json({ message: 'XLS file is required' });

    // Parse XLS
    const workbook = XLSX.readFile(xlsFile.path);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!data || data.length === 0) {
      return res.status(400).json({ message: 'XLS file appears to be empty' });
    }

    // School details from first row
    const firstRow = data[0];
    const schoolName = getCell(firstRow, ['School', 'school', 'School Name', 'SchoolName']) || 'Unnamed School';
    const affNo = getCell(firstRow, ['Affno', 'Aff No', 'Aff No.', 'AffNo', 'Affiliation No', 'AffiliationNo']);

    const schoolData = {
      name: schoolName,
      affNo: affNo || undefined,
      students: []
    };

    // Upload group photo to Cloudinary
    let cloudinaryUrl = null;
    if (groupPhoto) {
      const uploadRes = await cloudinary.uploader.upload(groupPhoto.path, {
        folder: 'group_photos'
      });
      cloudinaryUrl = uploadRes.secure_url;
      schoolData.groupPhoto = cloudinaryUrl;
    }

    // Create school
    const school = new School(schoolData);
    await school.save();

    // Extract descriptors if group photo exists
    if (cloudinaryUrl) {
      try {
        console.log('Downloading image from Cloudinary for processing...');
        const tempPath = path.join(os.tmpdir(), `groupPhoto-${Date.now()}.jpg`);
        const response = await axios.get(cloudinaryUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(tempPath, Buffer.from(response.data, 'binary'));

        console.log('Extracting descriptors...');
        const descriptors = await extractGroupDescriptors(tempPath);
        school.groupDescriptors = descriptors;
        await school.save();

        fs.unlinkSync(tempPath);
      } catch (err) {
        console.error('Error extracting group descriptors:', err);
      }
    }

    // Add students
    const students = await Student.insertMany(
      data.map(row => ({
        name: getCell(row, ['Name', 'Student Name', 'Studentname', 'FullName', 'name']) || undefined,
        rollNumber: getCell(row, ['RollNum]()
