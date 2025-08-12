const mongoose = require('mongoose');

const dayVerificationSchema = new mongoose.Schema({
  result: { type: String, enum: ['success', 'failed', 'pending', 'manually_verified'], default: 'pending' },
  date: { type: Date },
  confidence: { type: Number }
}, { _id: false });

const studentSchema = new mongoose.Schema({
    name: String,
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
    manualVerificationDate: { type: Date },
    // Day 1 captured photo (used as reference for Days 2-6 table display)
    day1Photo: { type: String },
    // Per-student face descriptor computed from Day 1 photo
    faceDescriptor: { type: [Number], default: undefined },
    // Per-day verification results for 6-day program
    dayVerification: {
      day1: { type: dayVerificationSchema, default: () => ({ result: 'pending' }) },
      day2: { type: dayVerificationSchema, default: () => ({ result: 'pending' }) },
      day3: { type: dayVerificationSchema, default: () => ({ result: 'pending' }) },
      day4: { type: dayVerificationSchema, default: () => ({ result: 'pending' }) },
      day5: { type: dayVerificationSchema, default: () => ({ result: 'pending' }) },
      day6: { type: dayVerificationSchema, default: () => ({ result: 'pending' }) }
    }
});

module.exports = mongoose.model('Student', studentSchema);