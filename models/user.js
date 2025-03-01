const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    password: String,
    firstName: String,
    lastName: String,
    role: { type: String, default: 'user' }
  });  

module.exports = mongoose.model('User', userSchema);
