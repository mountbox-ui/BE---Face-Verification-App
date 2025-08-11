const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const schoolController = require('../controllers/schoolController');
const School = require('../models/School');
const Student = require('../models/Student');
const XLSX = require('xlsx');

// Add school (XLS + group photo)
router.post(
  '/add',
  upload.fields([
    { name: 'xlsFile', maxCount: 1 },
    { name: 'groupPhoto', maxCount: 1 }
  ]),
  schoolController.addSchool
);

// Get all schools
router.get('/', auth, schoolController.getSchools);

// Get students by school
router.get('/:schoolId/students', auth, schoolController.getStudentsBySchool);

// Delete school and all its students
router.delete('/:schoolId', auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    // Delete all students associated with this school
    await Student.deleteMany({ school: schoolId });
    
    // Delete the school
    await School.findByIdAndDelete(schoolId);
    
    res.json({ message: 'School and all students deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Download verified profiles as XLSX
router.get('/:schoolId/download', auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    // Get school and its students
    const school = await School.findById(schoolId);
    const students = await Student.find({ school: schoolId });
    
    // Create data for Excel
    const excelData = students.map(student => ({
      'Name': student.name,
      'Roll Number': student.rollNumber,
      'Verification Status': student.verificationResult === 'success' ? 'Verified' : 
                           student.verificationResult === 'manually_verified' ? 'Manually Verified' :
                           student.verificationResult === 'failed' ? 'Failed' : 'Pending',
      'School': school.name
    }));
    
    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Verified Profiles');
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${school.name}_verified_profiles.xlsx"`);
    
    // Convert to buffer and send
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Download verified profiles from all schools
router.get('/download/all-verified', auth, async (req, res) => {
  try {
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
        'Verification Date': student.manualVerificationDate || new Date().toISOString().split('T')[0]
      }));
      
      allVerifiedStudents.push(...studentsWithSchool);
    }
    
    if (allVerifiedStudents.length === 0) {
      return res.status(404).json({ message: 'No verified students found across all schools' });
    }
    
    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(allVerifiedStudents);
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'All Verified Profiles');
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="all_verified_profiles_${new Date().toISOString().split('T')[0]}.xlsx"`);
    
    // Convert to buffer and send
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
    
    console.log(`Downloaded ${allVerifiedStudents.length} verified profiles from all schools`);
  } catch (err) {
    console.error('Download all verified profiles error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Download only verified profiles for current school
router.get('/:schoolId/download/verified-only', auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    // Get school and its verified students only
    const school = await School.findById(schoolId);
    const verifiedStudents = await Student.find({ 
      school: schoolId,
      verificationResult: { $in: ['success', 'manually_verified'] }
    });
    
    if (verifiedStudents.length === 0) {
      return res.status(404).json({ message: 'No verified students found for this school' });
    }
    
    // Create data for Excel
    const excelData = verifiedStudents.map(student => ({
      'Name': student.name,
      'Roll Number': student.rollNumber,
      'Verification Status': student.verificationResult === 'success' ? 'Verified' : 'Manually Verified',
      'School': school.name,
      'Verification Date': student.manualVerificationDate || new Date().toISOString().split('T')[0]
    }));
    
    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Verified Profiles Only');
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${school.name}_verified_only_${new Date().toISOString().split('T')[0]}.xlsx"`);
    
    // Convert to buffer and send
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
    
    console.log(`Downloaded ${verifiedStudents.length} verified profiles for school: ${school.name}`);
  } catch (err) {
    console.error('Download verified only error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get school details including group photo
router.get('/:schoolId', auth, async (req, res) => {
  try {
    const { schoolId } = req.params;
    console.log('Fetching school with ID:', schoolId);
    
    const school = await School.findById(schoolId);
    console.log('Found school:', school);
    
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }
    
    // Ensure groupPhoto is a consistent relative URL under /uploads
    const uploadsRoot = (process.env.UPLOADS_DIR || 'uploads').replace(/\\/g, '/');
    const groupPhotoRelative = school.groupPhoto && school.groupPhoto.startsWith(uploadsRoot)
      ? school.groupPhoto
      : school.groupPhoto
        ? `${uploadsRoot}/${school.groupPhoto.replace(/^[.\\/]+/, '').replace(/^.*uploads[\\\/]?/, '')}`
        : null;

    res.json({
      _id: school._id,
      name: school.name,
      groupPhoto: groupPhotoRelative,
      groupPhotoUrl: groupPhotoRelative ? `${req.protocol}://${req.get('host')}/${groupPhotoRelative}` : null,
      hasGroupDescriptors: school.groupDescriptors && school.groupDescriptors.length > 0,
      descriptorsCount: school.groupDescriptors ? school.groupDescriptors.length : 0
    });
  } catch (err) {
    console.error('Error fetching school:', err);
    res.status(500).json({ message: err.message });
  }
});

// Regenerate group descriptors for a school
router.post('/:schoolId/regenerate-descriptors', auth, schoolController.regenerateGroupDescriptors);

module.exports = router;