const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Student = require('../models/Student');

// Get student by ID
router.get('/:id', auth, async (req, res) => {
    const student = await Student.findById(req.params.id);
    res.json(student);
});

// Manual verification endpoint
router.post('/:id/manual-verify', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const student = await Student.findById(id);
        
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        
        // Update student with manual verification
        student.verified = true;
        student.verificationResult = 'manually_verified';
        student.manuallyVerified = true;
        student.manualVerificationDate = new Date();
        
        await student.save();
        
        res.json({
            message: 'Student manually verified successfully',
            student: {
                _id: student._id,
                name: student.name,
                rollNumber: student.rollNumber,
                verified: student.verified,
                verificationResult: student.verificationResult,
                manuallyVerified: student.manuallyVerified,
                manualVerificationDate: student.manualVerificationDate
            }
        });
    } catch (err) {
        console.error('Manual verification error:', err);
        res.status(500).json({ message: err.message });
    }
});

// Reset verification endpoint
router.post('/:id/reset-verification', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const student = await Student.findById(id);
        
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        
        // Reset verification status to pending
        student.verified = false;
        student.verificationResult = 'pending';
        student.manuallyVerified = false;
        student.manualVerificationDate = null;
        
        await student.save();
        
        res.json({
            message: 'Student verification status reset successfully',
            student: {
                _id: student._id,
                name: student.name,
                rollNumber: student.rollNumber,
                verified: student.verified,
                verificationResult: student.verificationResult,
                manuallyVerified: student.manuallyVerified,
                manualVerificationDate: student.manualVerificationDate
            }
        });
    } catch (err) {
        console.error('Reset verification error:', err);
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;