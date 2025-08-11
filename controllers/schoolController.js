// For real face verification onlocal server

const School = require('../models/School');
const Student = require('../models/Student');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Face-api.js setup
require('@tensorflow/tfjs-node');
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
    console.log('Models loaded successfully');
    
    console.log('Loading image from path:', imagePath);
    const img = await canvas.loadImage(imagePath);
    console.log('Image loaded successfully, dimensions:', img.width, 'x', img.height);
    
    console.log('Detecting faces with TinyFaceDetector...');
    const detections = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({
      inputSize: 512,
      scoreThreshold: 0.3
    }))
    .withFaceLandmarks()
    .withFaceDescriptors();
    
    console.log('Face detection completed. Found', detections.length, 'faces');
    
    if (detections.length === 0) {
      // Try with different parameters
      console.log('No faces found with default parameters, trying with lower threshold...');
      const detections2 = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({
        inputSize: 256,
        scoreThreshold: 0.1
      }))
      .withFaceLandmarks()
      .withFaceDescriptors();
      
      console.log('Second attempt found', detections2.length, 'faces');
      
      if (detections2.length === 0) {
        throw new Error('No faces detected in the group photo. Please ensure the photo contains clear, visible faces with good lighting and minimal obstructions.');
      }
      
      console.log(`Successfully extracted ${detections2.length} face descriptors from group photo`);
      return detections2.map(det => Array.from(det.descriptor));
    }
    
    console.log(`Successfully extracted ${detections.length} face descriptors from group photo`);
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

    // Parse XLS
    const workbook = XLSX.readFile(xlsFile.path);
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

    // Save group photo path if provided
    if (groupPhoto) {
      schoolData.groupPhoto = groupPhoto.path;
    }

    // Create school
    const school = new School(schoolData);
    await school.save();

    // Extract and save group descriptors if group photo exists
    if (groupPhoto) {
      try {
        console.log('Extracting face descriptors from group photo...');
        const descriptors = await extractGroupDescriptors(groupPhoto.path);
        school.groupDescriptors = descriptors;
        await school.save();
        console.log(`Successfully saved ${descriptors.length} face descriptors for school: ${school.name}`);
      } catch (err) {
        console.error('Error extracting group descriptors:', err);
      }
    }

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

    // Clean up XLS file
    if (xlsFile && fs.existsSync(xlsFile.path)) {
      fs.unlinkSync(xlsFile.path);
    }

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
    // Get school info for cleanup
    const school = await School.findById(schoolId);
    if (school && school.groupPhoto) {
      try {
        if (fs.existsSync(school.groupPhoto)) {
          fs.unlinkSync(school.groupPhoto);
        }
      } catch (fileError) {
        console.log('Error deleting group photo file:', fileError);
      }
    }
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
    console.log('Regenerating group descriptors for school:', schoolId);
    
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }
    
    if (!school.groupPhoto) {
      return res.status(400).json({ message: 'No group photo found for this school. Please upload a group photo first.' });
    }
    
    // Check if group photo file exists
    if (!fs.existsSync(school.groupPhoto)) {
      return res.status(400).json({ 
        message: 'Group photo file not found on server. The file may have been deleted or moved. Please upload a new group photo.' 
      });
    }
    
    console.log('Group photo file exists at:', school.groupPhoto);
    console.log('File size:', fs.statSync(school.groupPhoto).size, 'bytes');
    
    try {
      console.log('Starting face descriptor extraction...');
      const descriptors = await extractGroupDescriptors(school.groupPhoto);
      
      if (!descriptors || descriptors.length === 0) {
        return res.status(400).json({ 
          message: 'No face descriptors could be extracted from the group photo',
          suggestion: 'Please ensure the group photo contains clear, visible faces with good lighting and try again.'
        });
      }
      
      school.groupDescriptors = descriptors;
      await school.save();
      
      console.log(`Successfully regenerated ${descriptors.length} face descriptors for school: ${school.name}`);
      
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