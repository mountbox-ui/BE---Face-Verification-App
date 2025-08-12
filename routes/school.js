const express = require('express');
const router = express.Router();
const schoolController = require('../controllers/schoolController');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const School = require('../models/School');
const Student = require('../models/Student');
const XLSX = require('xlsx');
const path = require('path');

// Helper function to sanitize filename
const sanitizeFilename = (filename) => {
  return filename.replace(/[^a-zA-Z0-9\-_\.]/g, '_');
};

// Helper function to validate ObjectId
const isValidObjectId = (id) => {
  return /^[0-9a-fA-F]{24}$/.test(id);
};

// Add school (XLS + group photo)
router.post(
  '/add',
  auth,
  upload.excelUpload.single('xlsFile'), // Use dedicated Excel upload middleware
  upload.imageUpload.single('groupPhoto'), // Use dedicated Image upload middleware
  schoolController.addSchool
);

// Get all schools
router.get('/', auth, schoolController.getSchools);

// Download verified profiles from all schools (must be before /:schoolId routes)
router.get('/download/all-verified', auth, async (req, res) => {
  try {
    console.log('Starting download of all verified profiles');
    
    // Get all schools and their verified students
    const schools = await School.find();
    const allVerifiedStudents = [];
    
    for (const school of schools) {
      const students = await Student.find({ 
        school: school._id,
        verificationResult: { $in: ['success', 'manually_verified'] }
      });
      
      // Add school info to each student
      const studentsWithSchool = students.map(student => ({
        'Name': student.name,
        'Roll Number': student.rollNumber,
        'Verification Status': student.verificationResult === 'success' ? 'Verified' : 'Manually Verified',
        'School': school.name,
        'Verification Date': student.manualVerificationDate || 
          (student.updatedAt ? student.updatedAt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0])
      }));
      
      allVerifiedStudents.push(...studentsWithSchool);
    }
    
    if (allVerifiedStudents.length === 0) {
      return res.status(404).json({ 
        message: 'No verified students found across all schools',
        totalSchools: schools.length 
      });
    }
    
    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(allVerifiedStudents);
    
    // Auto-size columns
    const colWidths = [
      { wch: 25 }, // Name
      { wch: 15 }, // Roll Number
      { wch: 20 }, // Verification Status
      { wch: 30 }, // School
      { wch: 15 }  // Verification Date
    ];
    worksheet['!cols'] = colWidths;
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'All Verified Profiles');
    
    // Set headers for file download
    const filename = sanitizeFilename(`all_verified_profiles_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Convert to buffer and send
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
    
    console.log(`Downloaded ${allVerifiedStudents.length} verified profiles from ${schools.length} schools`);
  } catch (err) {
    console.error('Download all verified profiles error:', err);
    res.status(500).json({ 
      message: 'Failed to generate download file',
      error: err.message 
    });
  }
});

// Get students by school
router.get('/:schoolId/students', auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    if (!isValidObjectId(schoolId)) {
      return res.status(400).json({ message: 'Invalid school ID format' });
    }
    
    const students = await schoolController.getStudentsBySchool(req, res);
  } catch (err) {
    console.error('Get students error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Download verified profiles as XLSX for specific school
router.get('/:schoolId/download', auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    if (!isValidObjectId(schoolId)) {
      return res.status(400).json({ message: 'Invalid school ID format' });
    }
    
    // Get school and its students
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }
    
    const students = await Student.find({ school: schoolId });
    
    if (students.length === 0) {
      return res.status(404).json({ 
        message: 'No students found for this school',
        schoolName: school.name 
      });
    }
    
    // Create data for Excel
    const excelData = students.map(student => ({
      'Name': student.name,
      'Roll Number': student.rollNumber,
      'Class': student.class || 'N/A',
      'DOB': student.dob ? new Date(student.dob).toLocaleDateString() : 'N/A',
      'Age Group': student.ageGroup || 'N/A',
      'Verification Status': student.verificationResult === 'success' ? 'Verified' : 
                           student.verificationResult === 'manually_verified' ? 'Manually Verified' :
                           student.verificationResult === 'failed' ? 'Failed' : 'Pending',
      'School': school.name,
      'Last Updated': student.updatedAt ? student.updatedAt.toISOString().split('T')[0] : 'N/A'
    }));
    
    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // Auto-size columns
    const colWidths = [
      { wch: 25 }, // Name
      { wch: 15 }, // Roll Number
      { wch: 10 }, // Class
      { wch: 12 }, // DOB
      { wch: 12 }, // Age Group
      { wch: 20 }, // Verification Status
      { wch: 30 }, // School
      { wch: 15 }  // Last Updated
    ];
    worksheet['!cols'] = colWidths;
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Student Profiles');
    
    // Set headers for file download
    const filename = sanitizeFilename(`${school.name}_all_profiles_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Convert to buffer and send
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
    
    console.log(`Downloaded ${students.length} profiles for school: ${school.name}`);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ 
      message: 'Failed to generate download file',
      error: err.message 
    });
  }
});

// Download only verified profiles for current school
router.get('/:schoolId/download/verified-only', auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    if (!isValidObjectId(schoolId)) {
      return res.status(400).json({ message: 'Invalid school ID format' });
    }
    
    // Get school and its verified students only
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }
    
    const verifiedStudents = await Student.find({ 
      school: schoolId,
      verificationResult: { $in: ['success', 'manually_verified'] }
    });
    
    if (verifiedStudents.length === 0) {
      return res.status(404).json({ 
        message: 'No verified students found for this school',
        schoolName: school.name 
      });
    }
    
    // Create data for Excel
    const excelData = verifiedStudents.map(student => ({
      'Name': student.name,
      'Roll Number': student.rollNumber,
      'Class': student.class || 'N/A',
      'DOB': student.dob ? new Date(student.dob).toLocaleDateString() : 'N/A',
      'Age Group': student.ageGroup || 'N/A',
      'Verification Status': student.verificationResult === 'success' ? 'Verified' : 'Manually Verified',
      'School': school.name,
      'Verification Date': student.manualVerificationDate || 
        (student.updatedAt ? student.updatedAt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0])
    }));
    
    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // Auto-size columns
    const colWidths = [
      { wch: 25 }, // Name
      { wch: 15 }, // Roll Number
      { wch: 10 }, // Class
      { wch: 12 }, // DOB
      { wch: 12 }, // Age Group
      { wch: 20 }, // Verification Status
      { wch: 30 }, // School
      { wch: 15 }  // Verification Date
    ];
    worksheet['!cols'] = colWidths;
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Verified Profiles Only');
    
    // Set headers for file download
    const filename = sanitizeFilename(`${school.name}_verified_only_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Convert to buffer and send
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
    
    console.log(`Downloaded ${verifiedStudents.length} verified profiles for school: ${school.name}`);
  } catch (err) {
    console.error('Download verified only error:', err);
    res.status(500).json({ 
      message: 'Failed to generate verified profiles download',
      error: err.message 
    });
  }
});

// Regenerate group descriptors for a school
router.post('/:schoolId/regenerate-descriptors', auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    if (!isValidObjectId(schoolId)) {
      return res.status(400).json({ message: 'Invalid school ID format' });
    }
    
    await schoolController.regenerateGroupDescriptors(req, res);
  } catch (err) {
    console.error('Regenerate descriptors error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get school details including group photo (must be last among GET /:schoolId routes)
router.get('/:schoolId', auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    console.log('Fetching school with ID:', schoolId);
    
    if (!isValidObjectId(schoolId)) {
      return res.status(400).json({ message: 'Invalid school ID format' });
    }
    
    const school = await School.findById(schoolId);
    console.log('Found school:', school ? school.name : 'None');
    
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }
    
    // Get student count for this school
    const studentCount = await Student.countDocuments({ school: schoolId });
    const verifiedCount = await Student.countDocuments({ 
      school: schoolId, 
      verificationResult: { $in: ['success', 'manually_verified'] } 
    });
    
    res.json({
      _id: school._id,
      name: school.name,
      groupPhoto: school.groupPhoto,
      hasGroupDescriptors: school.groupDescriptors && school.groupDescriptors.length > 0,
      descriptorsCount: school.groupDescriptors ? school.groupDescriptors.length : 0,
      studentCount: studentCount,
      verifiedCount: verifiedCount,
      createdAt: school.createdAt,
      updatedAt: school.updatedAt
    });
  } catch (err) {
    console.error('Error fetching school:', err);
    res.status(500).json({ 
      message: 'Failed to fetch school details',
      error: err.message 
    });
  }
});

// Delete school and all its students
router.delete('/:schoolId', auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    if (!isValidObjectId(schoolId)) {
      return res.status(400).json({ message: 'Invalid school ID format' });
    }
    
    // Check if school exists
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }
    
    // Get count of students to be deleted
    const studentCount = await Student.countDocuments({ school: schoolId });
    
    // Delete all students associated with this school
    const deletedStudents = await Student.deleteMany({ school: schoolId });
    
    // Delete the school
    await School.findByIdAndDelete(schoolId);
    
    console.log(`Deleted school: ${school.name} with ${studentCount} students`);
    
    res.json({ 
      message: 'School and all students deleted successfully',
      schoolName: school.name,
      deletedStudentsCount: deletedStudents.deletedCount
    });
  } catch (err) {
    console.error('Delete school error:', err);
    res.status(500).json({ 
      message: 'Failed to delete school',
      error: err.message 
    });
  }
});

// Error handling middleware for this router
router.use((err, req, res, next) => {
  console.error('School router error:', err);
  
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
    message: 'Internal server error in school routes',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

module.exports = router;