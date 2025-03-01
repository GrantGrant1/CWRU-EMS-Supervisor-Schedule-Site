const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  scheduleStart: { type: Date },
  scheduleEnd: { type: Date }
});

module.exports = mongoose.model('Config', configSchema);
