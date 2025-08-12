// For real face verification onlocal server

const School = require('../models/School');
const Student = require('../models/Student');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const axios = require('axios');
const cloudinary = require('../cloudinary');

// Face-api.js setup
const faceapi = require('face-api.js');
const canvas = require('canvas');
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODELS_PATH = path.join(__dirname, '../models/face_models');
let modelsLoaded = false;

async function loadFaceApiModels() {
  if (modelsLoaded) return;
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);
  modelsLoaded = true;
}

async function extractGroupDescriptors(imageBuffer, imageMimeType) {
  console.log('Attempting to extract descriptors from image buffer. Mime Type:', imageMimeType, 'Buffer length:', imageBuffer.length);
  try {
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Image buffer is empty or invalid.');
    }

    await loadFaceApiModels();
    
    // Decode and normalize entirely with sharp to avoid node-canvas decoder issues
    const { data: rgba, info } = await sharp(imageBuffer)
      .rotate()
      .resize({ width: 720, withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (!info || !info.width || !info.height) {
      throw new Error('Failed to decode image dimensions');
    }

    const c = new canvas.Canvas(info.width, info.height);
    const ctx = c.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(rgba), info.width, info.height);
    ctx.putImageData(imageData, 0, 0);

    // Detection with TinyFaceDetector
    const detections = await faceapi
      .detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (detections.length === 0) {
      const detections2 = await faceapi
        .detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 256, scoreThreshold: 0.15 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (detections2.length === 0) {
        throw new Error('No faces detected in the group photo. Please ensure the photo contains clear, visible faces with good lighting and minimal obstructions.');
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
    if (row[key] !== undefined && row[key] !== null && String(row[key]).toString().trim() !== '') {
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

    // Parse XLS from buffer
    const workbook = XLSX.read(xlsFile.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!data || data.length === 0) {
      return res.status(400).json({ message: 'XLS file appears to be empty' });
    }

    // School-level fields from the first row
    const firstRow = data[0];
    const schoolName = getCell(firstRow, ['School', 'school', 'School Name', 'SchoolName']) || 'Unnamed School';
    const affNo = getCell(firstRow, ['Affno', 'Aff No', 'Aff No.', 'AffNo', 'Affiliation No', 'AffiliationNo']);

    // Prepare school data
    const schoolData = {
      name: schoolName,
      affNo: affNo || undefined,
      students: []
    };

    // Upload group photo to Cloudinary if provided
    if (groupPhoto) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: 'group-photos', resource_type: 'image' }, (err, res) => {
          if (err) return reject(err);
          resolve(res);
        });
        stream.end(groupPhoto.buffer);
      });
      schoolData.groupPhoto = result.secure_url;
    }

    // Create school
    const school = new School(schoolData);
    await school.save();

    // Add students with robust header mapping
    const students = await Student.insertMany(
      data.map(row => ({
        name: getCell(row, ['Name', 'Student Name', 'Studentname', 'FullName', 'name']) || undefined,
        rollNumber: getCell(row, ['RollNumber', 'Roll Number', 'rollNumber', 'roll no', 'RollNo']),
        registrationNo: getCell(row, ['RegistrationNo', 'Register No', 'RegisterNo', 'Reg No', 'RegNo', 'Registration No']),
        class: getCell(row, ['Class', 'Std', 'Standard', 'class']),
        dob: getCell(row, ['Dob', 'D.O.B', 'Date of Birth', 'DOB', 'dob']),
        ageGroup: getCell(row, ['Agegroup', 'Age Group', 'AgeGroup', 'agegroup']),
        school: school._id
      }))
    );

    // Link students to school
    school.students = students.map(s => s._id);

    await school.save();

    // Respond
    res.json({
      message: 'School and students added successfully',
      school: {
        _id: school._id,
        name: school.name,
        affNo: school.affNo,
        groupPhoto: school.groupPhoto,
        studentsCount: students.length,
        descriptorsCount: school.groupDescriptors ? school.groupDescriptors.length : 0,
        groupDescriptorsStatus: school.groupDescriptorsStatus || 'processing'
      }
    });

    // Trigger background extraction to keep UX fast
    if (school.groupPhoto) {
      await School.findByIdAndUpdate(school._id, { groupDescriptorsStatus: 'processing', groupDescriptorsError: null });
      setImmediate(async () => {
        try {
          const resp = await axios.get(school.groupPhoto, { responseType: 'arraybuffer' });
          const buf = Buffer.from(resp.data);
          const descriptors = await extractGroupDescriptors(buf, 'image/jpeg');
          await School.findByIdAndUpdate(school._id, {
            groupDescriptors: descriptors,
            groupDescriptorsStatus: 'ready',
            groupDescriptorsError: null,
            groupDescriptorsUpdatedAt: new Date()
          });
        } catch (err) {
          await School.findByIdAndUpdate(school._id, {
            groupDescriptorsStatus: 'error',
            groupDescriptorsError: err.message,
            groupDescriptorsUpdatedAt: new Date()
          });
        }
      });
    }

  } catch (err) {
    console.error('Error in addSchool:', err);
    res.status(500).json({ message: err.message });
  }
};

exports.getSchools = async (req, res) => {
  try {
    const schools = await School.find().select('name affNo _id groupPhoto');
    res.json(schools);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getStudentsBySchool = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const students = await Student.find({ school: schoolId });
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getSchoolById = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }
    res.json({
      _id: school._id,
      name: school.name,
      affNo: school.affNo,
      groupPhoto: school.groupPhoto,
      groupDescriptorsStatus: school.groupDescriptorsStatus,
      groupDescriptorsUpdatedAt: school.groupDescriptorsUpdatedAt,
      descriptorsCount: school.groupDescriptors ? school.groupDescriptors.length : 0
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteSchool = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const school = await School.findById(schoolId);

    await Student.deleteMany({ school: schoolId });
    await School.findByIdAndDelete(schoolId);
    res.json({ message: 'School and all students deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Regenerate group descriptors for a school
exports.regenerateGroupDescriptors = async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }
    
    if (!school.groupPhoto) {
      return res.status(400).json({ message: 'No group photo found for this school. Please upload a group photo first.' });
    }

    await School.findByIdAndUpdate(schoolId, {
      groupDescriptorsStatus: 'processing',
      groupDescriptorsError: null
    });

    setImmediate(async () => {
      try {
        let imageBuffer;
        let mime = 'image/jpeg';
        if (school.groupPhoto.startsWith('http')) {
          const resp = await axios.get(school.groupPhoto, { responseType: 'arraybuffer' });
          imageBuffer = Buffer.from(resp.data);
        } else if (school.groupPhoto.startsWith('data:')) {
          const [mimePart, base64Data] = school.groupPhoto.split(',');
          mime = mimePart.split(':')[1].split(';')[0];
          imageBuffer = Buffer.from(base64Data, 'base64');
        }
        const descriptors = await extractGroupDescriptors(imageBuffer, mime);
        await School.findByIdAndUpdate(schoolId, {
          groupDescriptors: descriptors,
          groupDescriptorsStatus: 'ready',
          groupDescriptorsError: null,
          groupDescriptorsUpdatedAt: new Date()
        });
        console.log(`Regenerated ${descriptors.length} descriptors for school ${schoolId}`);
      } catch (err) {
        console.error('Error regenerating group descriptors:', err);
        await School.findByIdAndUpdate(schoolId, {
          groupDescriptorsStatus: 'error',
          groupDescriptorsError: err.message,
          groupDescriptorsUpdatedAt: new Date()
        });
      }
    });
    
    return res.status(202).json({ message: 'Descriptor regeneration started', status: 'processing' });
  } catch (err) {
    console.error('Error in regenerateGroupDescriptors:', err);
    res.status(500).json({ message: err.message });
  }
};

exports.downloadVerifiedProfiles = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const school = await School.findById(schoolId);
    const students = await Student.find({ school: schoolId });

    const excelData = students.map(student => ({
      'Name': student.name,
      'Roll Number': student.rollNumber,
      'Verification Status': student.verificationResult === 'success' ? 'Verified' :
        student.verificationResult === 'failed' ? 'Failed' : 'Pending',
      'School': school?.name || 'Unknown'
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Verified Profiles');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${school?.name || 'school'}_verified_profiles.xlsx"`);

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};