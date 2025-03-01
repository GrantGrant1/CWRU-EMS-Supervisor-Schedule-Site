require('dotenv').config();

const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const path = require('path');

// Import models
const User = require('./models/user');
const Availability = require('./models/availability');
const Config = require('./models/config');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Connect to MongoDB Atlas (no deprecated options)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB Atlas!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'defaultSecret',
  resave: false,
  saveUninitialized: true
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Auth Middlewares
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).send('Access denied. Admins only.');
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
}

// Routes

// Home
app.get('/', requireLogin, (req, res) => {
  res.redirect('/schedule');
});

// Register
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
  const { username, password, firstName, lastName } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword, firstName, lastName });
    await user.save();
    req.session.userId = user._id;
    res.redirect('/schedule');
  } catch (err) {
    console.error(err);
    res.render('register', { error: 'Username might be taken or registration failed.' });
  }
});

// Login
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.render('login', { error: 'Invalid username or password.' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('login', { error: 'Invalid username or password.' });
    }
    req.session.userId = user._id;
    res.redirect('/schedule');
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Something went wrong.' });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Admin Panel
// In server.js, inside the /admin route
app.get('/admin', requireAdmin, async (req, res) => {
  let config = await Config.findOne();
  if (!config) {
    config = new Config({
      scheduleStart: new Date(),
      scheduleEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    });
    await config.save();
  }
  const allUsers = await User.find({});
  const currentUserId = req.session.userId;
  res.render('admin', { config, allUsers, currentUserId });
});


// Set date range
// Delete a user (cannot delete yourself)
app.post('/admin/delete-user', requireAdmin, async (req, res) => {
  const { userId } = req.body;
  if (userId === req.session.userId) {
    return res.status(400).send("Cannot delete yourself.");
  }
  try {
    await User.findByIdAndDelete(userId);
    // Optionally, delete the user’s availability records as well
    await Availability.deleteMany({ user: userId });
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send("Error deleting user.");
  }
});

// Edit a user’s account
app.post('/admin/edit-user', requireAdmin, async (req, res) => {
  const { userId, username, password, firstName, lastName, role } = req.body;
  const updateFields = { username, firstName, lastName, role };
  try {
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.password = hashedPassword;
    }
    await User.findByIdAndUpdate(userId, updateFields);
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send("Error updating user.");
  }
});

// Set date range
app.post('/admin/set-dates', requireAdmin, async (req, res) => {
  const { start, end } = req.body;
  try {
    let config = await Config.findOne();
    if (!config) config = new Config();
    config.scheduleStart = new Date(start);
    config.scheduleEnd = new Date(end);
    await config.save();
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to update schedule dates');
  }
});


// Clear data
app.post('/admin/clear-data', requireAdmin, async (req, res) => {
  const { action } = req.body;
  try {
    if (action === 'clearUsers') {
      const currentUserId = req.session.userId;
      await User.deleteMany({ _id: { $ne: currentUserId } });
      await Availability.deleteMany({ user: { $ne: currentUserId } });
    } else if (action === 'clearAvailabilities') {
      await Availability.deleteMany({});
    }
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to clear data');
  }
});

// Promote a user to admin
app.post('/make-admin', requireAdmin, async (req, res) => {
  const { username } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).send('User not found');
    }
    user.role = 'admin';
    await user.save();
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error promoting user to admin');
  }
});

// Schedule page
app.get('/schedule', requireLogin, async (req, res) => {
  let config = await Config.findOne();
  if (!config) {
    config = {
      scheduleStart: new Date(),
      scheduleEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    };
  }
  const startDate = new Date(config.scheduleStart);
  const endDate = new Date(config.scheduleEnd);

  let dates = [];
  let current = new Date(startDate);
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  let timeSlots = [];
  for (let h = 0; h < 24; h++) {
    timeSlots.push(`${h.toString().padStart(2, '0')}:00-${(h + 1).toString().padStart(2, '0')}:00`);
  }

  // Fetch all availabilities for these dates and populate user info
  const allAvailabilities = await Availability.find({
    date: { $in: dates }
  }).populate('user');


// Clear availabilities within a specific date range
app.post('/admin/clear-availability-by-date', requireAdmin, async (req, res) => {
  const { start, end } = req.body;
  try {
    // Assuming the 'date' field is stored as a string "YYYY-MM-DD"
    await Availability.deleteMany({ 
      date: { $gte: start, $lte: end }
    });
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send("Error clearing availabilities by date range.");
  }
});

// Clear all availabilities for a specific user
app.post('/admin/clear-availability-by-user', requireAdmin, async (req, res) => {
  const { userId } = req.body;
  try {
    await Availability.deleteMany({ user: userId });
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send("Error clearing availabilities for the user.");
  }
});


  // Build an availability map: key -> array of objects {id, firstName}
  let availabilityMap = {};
  allAvailabilities.forEach(item => {
    const key = `${item.date}_${item.timeSlot}`;
    if (!availabilityMap[key]) {
      availabilityMap[key] = [];
    }
    if (item.available) {
      availabilityMap[key].push({ id: item.user._id.toString(), firstName: item.user.firstName });
    }
  });

  const currentUserDoc = await User.findById(req.session.userId);
  const currentUserId = currentUserDoc ? currentUserDoc._id.toString() : '';

  res.render('schedule', {
    dates,
    timeSlots,
    availMap: availabilityMap,
    currentUserId
  });
});

// API to update availability for the logged-in user
// server.js
app.post('/api/availability', requireLogin, async (req, res) => {
  const { date, timeSlot, available } = req.body;

  if (available) {
    // Check if ANY user is already assigned to that date/timeSlot
    const alreadyTaken = await Availability.findOne({ date, timeSlot });
    if (alreadyTaken) {
      // Return an error to the client 
      return res.json({
        success: false,
        message: 'This shift is already taken by someone else.'
      });
    }

    // Not taken -> create/update record for this user
    await Availability.findOneAndUpdate(
      { user: req.session.userId, date, timeSlot },
      { available: true },
      { upsert: true }
    );

  } else {
    // If turning OFF, remove the record for this user
    await Availability.findOneAndDelete({ user: req.session.userId, date, timeSlot });
  }

  // Emit update for all connected clients
  const userDoc = await User.findById(req.session.userId);
  io.emit('updateAvailability', {
    user: userDoc?.firstName || 'Unknown',
    date,
    timeSlot,
    available
  });

  res.json({ success: true });
});


// Socket.io
io.on('connection', (socket) => {
  console.log('A client connected');
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
