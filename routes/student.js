const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Student = require('../models/Student');
const School = require('../models/School');

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
      sortOrder = 'asc'
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

    res.json({
      students: students.map(formatStudentResponse),
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
        sortOrder
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
    const { reason, notes } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid student ID format' });
    }

    const student = await Student.findById(id).populate('school', 'name');
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Check if already manually verified
    if (student.verificationResult === 'manually_verified') {
      return res.status(400).json({ 
        message: 'Student is already manually verified',
        verificationDate: student.manualVerificationDate
      });
    }

    // Update student with manual verification
    student.verified = true;
    student.verificationResult = 'manually_verified';
    student.manuallyVerified = true;
    student.manualVerificationDate = new Date();
    
    // Add verification metadata
    if (reason) student.manualVerificationReason = reason.trim();
    if (notes) student.manualVerificationNotes = notes.trim();

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
    const { reason } = req.body;

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