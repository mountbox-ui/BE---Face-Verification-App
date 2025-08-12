// For real face verification onlocal server

const School = require('../models/School');
const Student = require('../models/Student');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

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

async function extractGroupDescriptors(imageBuffer, imageMimeType) {
  console.log('Attempting to extract descriptors from image buffer. Mime Type:', imageMimeType, 'Buffer length:', imageBuffer.length);
  try {
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Image buffer is empty or invalid.');
    }

    await loadFaceApiModels();
    
    // Normalize the image via sharp: rotate if needed, resize to a reasonable width, ensure alpha channel, convert to PNG
    const processedBuffer = await sharp(imageBuffer)
      .rotate()
      .resize({ width: 1280, withoutEnlargement: true })
      .toFormat('png')
      .ensureAlpha()
      .toBuffer();

    // Use canvas.loadImage directly with buffer to get an Image object
    const img = await canvas.loadImage(processedBuffer);
    // console.log('Image loaded by canvas.loadImage, dimensions:', img.width, 'x', img.height);
    
    // Explicitly create a canvas and draw the image onto it
    const c = new canvas.Canvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, img.width, img.height);
    
    // Get ImageData from the canvas for face-api.js
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    
    // Pass the imageData directly to face-api.js
    // console.log('First detection attempt - Inputting ImageData with dimensions:', imageData.width, 'x', imageData.height);
    const detections = await faceapi.detectAllFaces(imageData, new faceapi.TinyFaceDetectorOptions({
      inputSize: 416,
      scoreThreshold: 0.3
    }))
    .withFaceLandmarks()
    .withFaceDescriptors();
    
    if (detections.length === 0) {
      // console.log('No faces found with first attempt, trying with img on second attempt. Inputting ImageData with dimensions:', imageData.width, 'x', imageData.height);
      const detections2 = await faceapi.detectAllFaces(imageData, new faceapi.TinyFaceDetectorOptions({
        inputSize: 320,
        scoreThreshold: 0.1
      }))
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

    // Store group photo as Base64 if provided
    if (groupPhoto) {
      // Store as Data URL (Base64 string)
      schoolData.groupPhoto = `data:${groupPhoto.mimetype};base64,${groupPhoto.buffer.toString('base64')}`;
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

    // Respond immediately
    res.json({
      message: 'School and students added successfully',
      school: {
        _id: school._id,
        name: school.name,
        affNo: school.affNo,
        groupPhoto: school.groupPhoto,
        studentsCount: students.length
      }
    });

    // Extract and save group descriptors in background to keep submit fast
    if (groupPhoto) {
      setImmediate(async () => {
        try {
          const descriptors = await extractGroupDescriptors(groupPhoto.buffer, groupPhoto.mimetype);
          await School.findByIdAndUpdate(school._id, { groupDescriptors: descriptors });
          console.log(`Saved ${descriptors.length} descriptors for school ${school._id}`);
        } catch (err) {
          console.error('Background descriptor extraction failed:', err);
        }
      });
    }

    // No file cleanup needed as using memory storage
    // if (xlsFile && fs.existsSync(xlsFile.path)) {
    //   fs.unlinkSync(xlsFile.path);
    // }

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
      groupPhoto: school.groupPhoto
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteSchool = async (req, res) => {
  try {
    const { schoolId } = req.params;
    // Get school info for cleanup (no file deletion as using Base64)
    const school = await School.findById(schoolId);
    // No need to delete group photo file from disk as it's stored as Base64 in DB

    // Delete all students associated with this school
    await Student.deleteMany({ school: schoolId });
    // Delete the school
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
    
    // Extract Base64 data and MIME type from the stored Data URL
    if (!school.groupPhoto.startsWith('data:')) {
      return res.status(400).json({ message: 'Stored group photo is not in expected Base64 format.' });
    }
    const [mimePart, base64Data] = school.groupPhoto.split(',');
    const imageMimeType = mimePart.split(':')[1].split(';')[0];
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({ message: 'Extracted group photo data is empty or invalid.' });
    }
    
    try {
      const descriptors = await extractGroupDescriptors(imageBuffer, imageMimeType);
      
      if (!descriptors || descriptors.length === 0) {
        return res.status(400).json({ 
          message: 'No face descriptors could be extracted from the group photo',
          suggestion: 'Please ensure the group photo contains clear, visible faces with good lighting and try again.'
        });
      }
      
      school.groupDescriptors = descriptors;
      await school.save();
      
      res.json({
        message: `Successfully regenerated ${descriptors.length} face descriptors`,
        descriptorsCount: descriptors.length,
        school: {
          _id: school._id,
          name: school.name,
          groupPhoto: school.groupPhoto
        }
      });
    } catch (err) {
      console.error('Error regenerating group descriptors:', err);
      res.status(400).json({ 
        message: 'Failed to extract face descriptors from group photo',
        error: err.message,
        suggestion: 'Please ensure the group photo contains clear, visible faces with good lighting and minimal obstructions. Try uploading a different photo if the issue persists.'
      });
    }
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