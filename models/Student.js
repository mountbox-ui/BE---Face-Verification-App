const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
    name: String,
    // Legacy roll number (kept for compatibility)
    rollNumber: String,
    // Preferred registration number from Excel
    registrationNo: String,
    class: String,
    dob: String,
    ageGroup: String,
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    verified: { type: Boolean, default: false },
    verificationResult: { type: String, enum: ['success', 'failed', 'pending', 'manually_verified'], default: 'pending' },
    manuallyVerified: { type: Boolean, default: false },
    manualVerificationDate: { type: Date }
});

module.exports = mongoose.model('Student', studentSchema);