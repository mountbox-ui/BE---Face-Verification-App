// For real face verification onlocal server

const School = require('../models/School');
const Student = require('../models/Student');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const cloudinary = require('../cloudinary');

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
    const coachName = getCell(firstRow, ['Coach', 'Coach Name', 'CoachName', 'coach', 'coachName']);
    const coachPhone = getCell(firstRow, ['Coach Phone', 'CoachPhone', 'Phone', 'Phone Number', 'phone', 'phoneNumber']);

    // Prepare school data
    const schoolData = {
      name: schoolName,
      affNo: affNo || undefined,
      coachName: coachName || undefined,
      coachPhone: coachPhone || undefined,
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
      // Initialize descriptor status; frontend will compute and POST descriptors
      schoolData.groupDescriptorsStatus = 'processing';
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

    // Respond immediately; frontend will compute and POST descriptors
    res.json({
      message: 'School and students added successfully',
      school: {
        _id: school._id,
        name: school.name,
        affNo: school.affNo,
        groupPhoto: school.groupPhoto,
        studentsCount: students.length,
        groupDescriptorsStatus: school.groupDescriptorsStatus || 'idle',
        descriptorsCount: school.groupDescriptors ? school.groupDescriptors.length : 0
      }
    });

  } catch (err) {
    console.error('Error in addSchool:', err);
    res.status(500).json({ message: err.message });
  }
};

exports.getSchools = async (req, res) => {
  try {
    const schools = await School.find().select('name affNo coachName coachPhone _id groupPhoto').lean();

    // Gather distinct age groups per school
    const schoolIds = schools.map(s => s._id);
    const ageGroupsAgg = await Student.aggregate([
      { $match: { school: { $in: schoolIds } } },
      { $group: { _id: '$school', ageGroups: { $addToSet: '$ageGroup' } } }
    ]);
    const idToAgeGroups = new Map(
      ageGroupsAgg.map(row => [String(row._id), (row.ageGroups || []).filter(Boolean)])
    );

    const enriched = schools.map(s => ({
      ...s,
      ageGroups: idToAgeGroups.get(String(s._id)) || []
    }));

    res.json(enriched);
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
      coachName: school.coachName || null,
      coachPhone: school.coachPhone || null,
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

// Regenerate group descriptors for a school (client-driven)
exports.regenerateGroupDescriptors = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const school = await School.findById(schoolId);
    if (!school) return res.status(404).json({ message: 'School not found' });

    // Mark as processing; the frontend will compute and POST descriptors
    await School.findByIdAndUpdate(schoolId, {
      groupDescriptorsStatus: 'processing',
      groupDescriptorsError: null,
      groupDescriptorsUpdatedAt: new Date()
    });

    return res.status(202).json({ message: 'Client-side regeneration expected', status: 'processing' });
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