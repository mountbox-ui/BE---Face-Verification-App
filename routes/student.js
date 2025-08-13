const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Student = require('../models/Student');
const School = require('../models/School');
const XLSX = require('xlsx');
const faceapi = require('face-api.js');
const canvas = require('canvas');
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Helper function to validate ObjectId
const isValidObjectId = (id) => {
  return /^[0-9a-fA-F]{24}$/.test(id);
};

// Helper function to format student response
const formatStudentResponse = (student) => {
  return {
    _id: student._id,
    name: student.name,
    rollNumber: student.rollNumber,
    class: student.class,
    dob: student.dob,
    ageGroup: student.ageGroup,
    school: student.school,
    verified: student.verified,
    verificationResult: student.verificationResult,
    manuallyVerified: student.manuallyVerified,
    manualVerificationDate: student.manualVerificationDate,
    faceDescriptors: student.faceDescriptors ? student.faceDescriptors.length : 0,
    day1Photo: student.day1Photo,
    dayVerification: student.dayVerification,
    hasFaceDescriptor: Array.isArray(student.faceDescriptor) && student.faceDescriptor.length > 0,
    createdAt: student.createdAt,
    updatedAt: student.updatedAt
  };
};

// Get all students with optional filters
router.get('/', auth, async (req, res) => {
  try {
    const { 
      schoolId, 
      verificationStatus, 
      search, 
      page = 1, 
      limit = 50,
      sortBy = 'name',
      sortOrder = 'asc',
      day
    } = req.query;

    // Build query
    const query = {};
    
    if (schoolId) {
      if (!isValidObjectId(schoolId)) {
        return res.status(400).json({ message: 'Invalid school ID format' });
      }
      query.school = schoolId;
    }

    if (verificationStatus) {
      if (verificationStatus === 'verified') {
        query.verificationResult = { $in: ['success', 'manually_verified'] };
      } else if (verificationStatus === 'pending') {
        query.verificationResult = { $in: ['pending', null] };
      } else if (verificationStatus === 'failed') {
        query.verificationResult = 'failed';
      }
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { rollNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with pagination
    const [students, totalCount] = await Promise.all([
      Student.find(query)
        .populate('school', 'name')
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      Student.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    // If day filter is specified, project day-specific view
    const projected = students.map((s) => {
      const obj = formatStudentResponse(s);
      if (day && /^day[1-6]$/.test(day)) {
        obj.day = day;
        obj.dayResult = s.dayVerification?.[day]?.result || 'pending';
        obj.dayConfidence = s.dayVerification?.[day]?.confidence || null;
        obj.dayDate = s.dayVerification?.[day]?.date || null;
      }
      return obj;
    });

    res.json({
      students: projected,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        hasNextPage: pageNum < totalPages,
        hasPreviousPage: pageNum > 1
      },
      filters: {
        schoolId,
        verificationStatus,
        search,
        sortBy,
        sortOrder,
        day
      }
    });

  } catch (err) {
    console.error('Get students error:', err);
    res.status(500).json({ 
      message: 'Failed to fetch students',
      error: err.message 
    });
  }
});

// Save per-student descriptor from base64 (Day 1)
router.post('/:id/save-descriptor', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { photo, descriptor } = req.body;
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid student ID format' });
    if (!photo && !descriptor) return res.status(400).json({ message: 'photo (base64) or descriptor is required' });

    const student = await Student.findById(id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    if (descriptor && Array.isArray(descriptor)) {
      student.faceDescriptor = descriptor.map(Number);
    } else {
      // Compute from photo if descriptor not provided
      await faceapi.nets.tinyFaceDetector.loadFromDisk('./models/face_models');
      await faceapi.nets.faceLandmark68Net.loadFromDisk('./models/face_models');
      await faceapi.nets.faceRecognitionNet.loadFromDisk('./models/face_models');
      const buffer = Buffer.from(photo.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const img = await canvas.loadImage(buffer);
      const detection = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detection) return res.status(400).json({ message: 'No face detected in the photo' });
      student.faceDescriptor = Array.from(detection.descriptor);
    }
    if (photo && !student.day1Photo) student.day1Photo = photo;
    student.dayVerification = student.dayVerification || {};
    if (!student.dayVerification.day1) student.dayVerification.day1 = {};
    student.dayVerification.day1.result = 'success';
    student.dayVerification.day1.date = new Date();
    await student.save();

    res.json({ message: 'Descriptor saved', hasFaceDescriptor: true });
  } catch (err) {
    console.error('Save descriptor error:', err);
    res.status(500).json({ message: 'Failed to save descriptor', error: err.message });
  }
});

// Day result update (when verifying on Day N)
router.post('/:id/day/:dayNumber/result', auth, async (req, res) => {
  try {
    const { id, dayNumber } = req.params;
    const { result, confidence, photo } = req.body; // photo optional, only stored on day1

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid student ID format' });
    }
    const dayKey = `day${parseInt(dayNumber, 10)}`;
    if (!/^day[1-6]$/.test(dayKey)) {
      return res.status(400).json({ message: 'dayNumber must be 1-6' });
    }

    const student = await Student.findById(id);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    // Save day 1 photo if provided
    if (dayKey === 'day1' && photo) {
      student.day1Photo = photo;
    }

    student.dayVerification[dayKey] = {
      result: result || 'pending',
      confidence: confidence || null,
      date: new Date()
    };

    await student.save();
    res.json({ message: 'Day result updated', student: formatStudentResponse(student) });
  } catch (err) {
    console.error('Update day result error:', err);
    res.status(500).json({ message: 'Failed to update day result', error: err.message });
  }
});

// Download day-specific details
router.get('/download/day/:dayNumber', auth, async (req, res) => {
  try {
    const { dayNumber } = req.params;
    const { schoolId } = req.query;

    const dayKey = `day${parseInt(dayNumber, 10)}`;
    if (!/^day[1-6]$/.test(dayKey)) {
      return res.status(400).json({ message: 'dayNumber must be 1-6' });
    }
    if (!schoolId || !isValidObjectId(schoolId)) {
      return res.status(400).json({ message: 'Valid schoolId is required' });
    }

    const school = await School.findById(schoolId);
    if (!school) return res.status(404).json({ message: 'School not found' });

    const students = await Student.find({ school: schoolId });
    const rows = students.map(s => ({
      'Register No': s.registrationNo,
      'Name': s.name,
      'Class': s.class || '',
      'DOB': s.dob || '',
      'Age Group': s.ageGroup || '',
      'Day': dayKey,
      'Day Result': s.dayVerification?.[dayKey]?.result || 'pending',
      'Day Confidence': s.dayVerification?.[dayKey]?.confidence || '',
      'Day Date': s.dayVerification?.[dayKey]?.date ? new Date(s.dayVerification[dayKey].date).toISOString().split('T')[0] : ''
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, `${dayKey.toUpperCase()} Details`);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${school.name}_${dayKey}_details.xlsx"`);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (err) {
    console.error('Download day details error:', err);
    res.status(500).json({ message: 'Failed to generate day download', error: err.message });
  }
});
 
 // Get student by ID
 router.get('/:id', auth, async (req, res) => {
   try {
     const { id } = req.params;

     if (!isValidObjectId(id)) {
       return res.status(400).json({ message: 'Invalid student ID format' });
     }

     const student = await Student.findById(id).populate('school', 'name groupPhoto');
     
     if (!student) {
       return res.status(404).json({ message: 'Student not found' });
     }

     res.json({
       student: formatStudentResponse(student),
       school: student.school
     });

   } catch (err) {
     console.error('Get student error:', err);
     res.status(500).json({ 
       message: 'Failed to fetch student',
       error: err.message 
     });
   }
 });

// Update student information
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, rollNumber, class: studentClass, dob, ageGroup } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid student ID format' });
    }

    // Validation
    if (name && name.trim().length < 2) {
      return res.status(400).json({ message: 'Name must be at least 2 characters long' });
    }

    if (rollNumber && rollNumber.trim().length < 1) {
      return res.status(400).json({ message: 'Roll number cannot be empty' });
    }

    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Check for duplicate roll number in the same school
    if (rollNumber && rollNumber !== student.rollNumber) {
      const existingStudent = await Student.findOne({
        school: student.school,
        rollNumber: rollNumber.trim(),
        _id: { $ne: id }
      });

      if (existingStudent) {
        return res.status(409).json({ 
          message: 'A student with this roll number already exists in this school' 
        });
      }
    }

    // Update fields
    if (name) student.name = name.trim();
    if (rollNumber) student.rollNumber = rollNumber.trim();
    if (studentClass) student.class = studentClass.trim();
    if (dob) student.dob = new Date(dob);
    if (ageGroup) student.ageGroup = ageGroup.trim();

    await student.save();

    res.json({
      message: 'Student updated successfully',
      student: formatStudentResponse(student)
    });

  } catch (err) {
    console.error('Update student error:', err);
    
    if (err.code === 11000) {
      return res.status(409).json({ 
        message: 'Duplicate roll number in this school' 
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to update student',
      error: err.message 
    });
  }
});

// Manual verification endpoint
router.post('/:id/manual-verify', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, notes, photo, day } = req.body; // optional photo and day

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid student ID format' });
    }

    const student = await Student.findById(id).populate('school', 'name');
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Determine day key if provided
    let dayKey = null;
    if (typeof day !== 'undefined' && day !== null) {
      if (typeof day === 'number') {
        dayKey = `day${parseInt(day, 10)}`;
      } else if (typeof day === 'string') {
        dayKey = /^day[1-6]$/.test(day) ? day : null;
      }
    }

    // If a valid day is provided, only update that day (do not set global verification flags)
    if (dayKey && /^day[1-6]$/.test(dayKey)) {
      // Prevent duplicate manual verification for the same day
      if (student.dayVerification?.[dayKey]?.result === 'manually_verified') {
        return res.status(400).json({ 
          message: `Student is already manually verified for ${dayKey}`
        });
      }

      student.dayVerification = student.dayVerification || {};
      student.dayVerification[dayKey] = {
        result: 'manually_verified',
        confidence: null,
        date: new Date()
      };

      // If Day 1 manual verify and photo provided, save Day 1 reference photo
      if (dayKey === 'day1' && photo) {
        student.day1Photo = photo;
      }

      // Add optional metadata (kept for audit)
      if (reason) student.manualVerificationReason = reason.trim();
      if (notes) student.manualVerificationNotes = notes.trim();
    } else {
      // No valid day provided: fall back to global manual verification behavior
      if (student.verificationResult === 'manually_verified') {
        return res.status(400).json({ 
          message: 'Student is already manually verified',
          verificationDate: student.manualVerificationDate
        });
      }

      student.verified = true;
      student.verificationResult = 'manually_verified';
      student.manuallyVerified = true;
      student.manualVerificationDate = new Date();

      if (reason) student.manualVerificationReason = reason.trim();
      if (notes) student.manualVerificationNotes = notes.trim();

      // If Day 1 photo is provided without explicit day, still allow saving
      if (photo) {
        student.day1Photo = photo;
      }
    }

    await student.save();

    console.log(`Student ${student.name} (${student.rollNumber}) manually verified in school: ${student.school.name}`);

    res.json({
      message: 'Student manually verified successfully',
      student: formatStudentResponse(student),
      school: student.school
    });

  } catch (err) {
    console.error('Manual verification error:', err);
    res.status(500).json({ 
      message: 'Failed to manually verify student',
      error: err.message 
    });
  }
});

// Reset verification endpoint
router.post('/:id/reset-verification', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, clearDay1Photo } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid student ID format' });
    }

    const student = await Student.findById(id).populate('school', 'name');
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Check if already pending
    if (student.verificationResult === 'pending' || !student.verificationResult) {
      return res.status(400).json({ 
        message: 'Student verification is already pending'
      });
    }

    const previousStatus = student.verificationResult;

    // Reset verification status to pending
    student.verified = false;
    student.verificationResult = 'pending';
    student.manuallyVerified = false;
    student.manualVerificationDate = null;
    student.manualVerificationReason = null;
    student.manualVerificationNotes = null;
    
    // Add reset metadata
    student.lastResetDate = new Date();
    if (reason) student.resetReason = reason.trim();

    // If triggered from Day 1 re-verify, clear stored Day 1 photo and day1 result
    if (clearDay1Photo) {
      student.day1Photo = null;
      if (!student.dayVerification) student.dayVerification = {};
      student.dayVerification.day1 = { result: 'pending', date: new Date(), confidence: null };
    }

    await student.save();

    console.log(`Student ${student.name} (${student.rollNumber}) verification reset from ${previousStatus} to pending in school: ${student.school.name}`);

    res.json({
      message: 'Student verification status reset successfully',
      student: formatStudentResponse(student),
      previousStatus,
      school: student.school
    });

  } catch (err) {
    console.error('Reset verification error:', err);
    res.status(500).json({ 
      message: 'Failed to reset verification status',
      error: err.message 
    });
  }
});

// Bulk operations endpoint
router.post('/bulk-actions', auth, async (req, res) => {
  try {
    const { action, studentIds, data = {} } = req.body;

    if (!action || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ 
        message: 'Action and studentIds array are required' 
      });
    }

    if (studentIds.length > 100) {
      return res.status(400).json({ 
        message: 'Maximum 100 students can be processed at once' 
      });
    }

    // Validate all student IDs
    const invalidIds = studentIds.filter(id => !isValidObjectId(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ 
        message: 'Invalid student ID formats found',
        invalidIds 
      });
    }

    let result = {};

    switch (action) {
      case 'manual-verify':
        const verifyResult = await Student.updateMany(
          { _id: { $in: studentIds } },
          {
            verified: true,
            verificationResult: 'manually_verified',
            manuallyVerified: true,
            manualVerificationDate: new Date(),
            manualVerificationReason: data.reason || 'Bulk verification'
          }
        );
        result = {
          action: 'manual-verify',
          processed: verifyResult.modifiedCount,
          message: `${verifyResult.modifiedCount} students manually verified`
        };
        break;

      case 'reset-verification':
        const resetResult = await Student.updateMany(
          { _id: { $in: studentIds } },
          {
            verified: false,
            verificationResult: 'pending',
            manuallyVerified: false,
            manualVerificationDate: null,
            lastResetDate: new Date(),
            resetReason: data.reason || 'Bulk reset'
          }
        );
        result = {
          action: 'reset-verification',
          processed: resetResult.modifiedCount,
          message: `${resetResult.modifiedCount} students verification reset`
        };
        break;

      default:
        return res.status(400).json({ message: 'Invalid action specified' });
    }

    console.log(`Bulk ${action} completed for ${result.processed} students`);

    res.json({
      success: true,
      ...result,
      totalRequested: studentIds.length
    });

  } catch (err) {
    console.error('Bulk action error:', err);
    res.status(500).json({ 
      message: 'Failed to perform bulk action',
      error: err.message 
    });
  }
});

// Delete student
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid student ID format' });
    }

    const student = await Student.findById(id).populate('school', 'name');
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    await Student.findByIdAndDelete(id);

    console.log(`Student ${student.name} (${student.rollNumber}) deleted from school: ${student.school.name}`);

    res.json({
      message: 'Student deleted successfully',
      deletedStudent: {
        _id: student._id,
        name: student.name,
        rollNumber: student.rollNumber,
        school: student.school.name
      }
    });

  } catch (err) {
    console.error('Delete student error:', err);
    res.status(500).json({ 
      message: 'Failed to delete student',
      error: err.message 
    });
  }
});

// Error handling middleware for this router
router.use((err, req, res, next) => {
  console.error('Student router error:', err);
  
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid ID format' });
  }
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({ 
      message: 'Validation error',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }
  
  res.status(500).json({ 
    message: 'Internal server error in student routes',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

module.exports = router;