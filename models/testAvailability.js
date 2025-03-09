// File: models/testAvailability.js
const mongoose = require('mongoose');

const testAvailabilitySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  date: String,         // e.g. "2025-03-08"
  timeSlot: String,     // e.g. "14:00-15:00"
  available: Boolean
});

module.exports = mongoose.model('TestAvailability', testAvailabilitySchema);
