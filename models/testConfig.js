// File: models/testConfig.js
const mongoose = require('mongoose');

const testConfigSchema = new mongoose.Schema({
  scheduleStart: { type: Date },
  scheduleEnd: { type: Date }
});

module.exports = mongoose.model('TestConfig', testConfigSchema);
