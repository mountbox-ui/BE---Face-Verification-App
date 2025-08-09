// const mongoose = require('mongoose');

// const schoolSchema = new mongoose.Schema({
//     name: { type: String, required: true, unique: true },
//     groupPhoto: { type: String }, // path to uploaded photo
//     students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }]
// });

// module.exports = mongoose.model('School', schoolSchema);

// For realt face verification on local server

const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  affNo: { type: String },
  groupPhoto: String,
  groupDescriptors: [[Number]], // Array of face descriptors
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }]
});

module.exports = mongoose.model('School', schoolSchema);