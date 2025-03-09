require('dotenv').config();

const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const path = require('path');

// Existing models
const User = require('./models/user');
const Availability = require('./models/availability');
const Config = require('./models/config');

// NEW CODE FOR TEST CALL SCHEDULE:
const TestAvailability = require('./models/testAvailability');
const TestConfig = require('./models/testConfig');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Connect to MongoDB Atlas
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

// ----------------------
// Existing Routes
// ----------------------

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
app.get('/admin', requireAdmin, async (req, res) => {
  let config = await Config.findOne();
  if (!config) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    config = new Config({
      scheduleStart: now,
      scheduleEnd: new Date(now.getTime() + 14 * 86400000)
    });
    await config.save();
  }
  // For simplicity, we are not auto-creating a TestConfig here.
  const allUsers = await User.find({});
  const currentUserId = req.session.userId;
  res.render('admin', { config, allUsers, currentUserId });
});

// Delete a user (cannot delete yourself)
app.post('/admin/delete-user', requireAdmin, async (req, res) => {
  const { userId } = req.body;
  if (userId === req.session.userId) {
    return res.status(400).send("Cannot delete yourself.");
  }
  try {
    await User.findByIdAndDelete(userId);
    await Availability.deleteMany({ user: userId });
    await TestAvailability.deleteMany({ user: userId });
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

// Set date range (main schedule)
app.post('/admin/set-dates', requireAdmin, async (req, res) => {
  const { start, end } = req.body;
  try {
    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    let config = await Config.findOne();
    if (!config) config = new Config();
    config.scheduleStart = startDate;
    config.scheduleEnd = endDate;
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
      await TestAvailability.deleteMany({ user: { $ne: currentUserId } });
    } else if (action === 'clearAvailabilities') {
      await Availability.deleteMany({});
      await TestAvailability.deleteMany({});
    }
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to clear data');
  }
});

// (Optional) Clear availabilities by date range
app.post('/admin/clear-availability-by-date', requireAdmin, async (req, res) => {
  const { start, end } = req.body;
  try {
    await Availability.deleteMany({ 
      date: { $gte: start, $lte: end }
    });
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send("Error clearing availabilities by date range.");
  }
});

// (Optional) Clear all availabilities for a specific user
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

// ----------------------
// MAIN SCHEDULE PAGE
// ----------------------
app.get('/schedule', requireLogin, async (req, res) => {
  let config = await Config.findOne();
  if (!config) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    config = new Config({
      scheduleStart: now,
      scheduleEnd: new Date(now.getTime() + 14 * 86400000)
    });
    await config.save();
  }

  const startDay = new Date(
    config.scheduleStart.getFullYear(),
    config.scheduleStart.getMonth(),
    config.scheduleStart.getDate()
  );
  const endDay = new Date(
    config.scheduleEnd.getFullYear(),
    config.scheduleEnd.getMonth(),
    config.scheduleEnd.getDate()
  );

  let dates = [];
  let currentDay = new Date(startDay);
  while (currentDay <= endDay) {
    const yyyy = currentDay.getFullYear();
    const mm = String(currentDay.getMonth() + 1).padStart(2, '0');
    const dd = String(currentDay.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    currentDay.setDate(currentDay.getDate() + 1);
  }

  let timeSlots = [];
  for (let h = 0; h < 24; h++) {
    timeSlots.push(
      `${String(h).padStart(2, '0')}:00-${String(h + 1).padStart(2, '0')}:00`
    );
  }

  const allAvailabilities = await Availability.find({
    date: { $in: dates }
  }).populate('user');

  let availabilityMap = {};
  allAvailabilities.forEach(item => {
    const key = `${item.date}||${item.timeSlot}`;
    if (!availabilityMap[key]) {
      availabilityMap[key] = [];
    }
    if (item.available) {
      availabilityMap[key].push({
        id: item.user._id.toString(),
        firstName: item.user.firstName,
        lastName: item.user.lastName  // Include lastName!
      });
    }
  });

  // Compute "Supervisor On Call" (using short name)
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const localDateStr = `${yyyy}-${mm}-${dd}`;
  const localHour = now.getHours();
  const currentSlot = `${String(localHour).padStart(2, '0')}:00-${String(localHour + 1).padStart(2, '0')}:00`;
  const currentKey = `${localDateStr}||${currentSlot}`;
  let currentOnCall = null;
  if (availabilityMap[currentKey] && availabilityMap[currentKey].length > 0) {
    currentOnCall = availabilityMap[currentKey]
      .map(u => u.firstName + ' ' + (u.lastName && u.lastName.length > 0 ? (u.lastName[0] + '.') : ''))
      .join(', ');
  }

  const currentUserDoc = await User.findById(req.session.userId);
  const currentUserId = currentUserDoc ? currentUserDoc._id.toString() : '';
  const isAdmin = currentUserDoc && currentUserDoc.role === 'admin';
  let users = [];
  if (isAdmin) {
    users = await User.find();
  }

  res.render('schedule', {
    dates,
    timeSlots,
    availMap: availabilityMap,
    currentUserId,
    isAdmin,
    users,
    currentUser: currentUserDoc,
    currentOnCall
  });
});

// API for main schedule batch updates
app.post('/api/batch-availability', requireLogin, async (req, res) => {
  const { changes } = req.body;
  const currentUserId = req.session.userId;
  
  for (let change of changes) {
    let userId = currentUserId;
    if (change.targetUserId) {
      const currentUser = await User.findById(currentUserId);
      if (currentUser && currentUser.role === 'admin') {
        userId = change.targetUserId;
      }
    }
    if (change.available) {
      await Availability.findOneAndUpdate(
        { user: userId, date: change.date, timeSlot: change.timeSlot },
        { available: true },
        { upsert: true }
      );
    } else {
      await Availability.findOneAndDelete({ user: userId, date: change.date, timeSlot: change.timeSlot });
    }
  }
  
  io.emit('updateAvailability', {});
  res.json({ success: true });
});

// ----------------------
// TEST CALL SCHEDULE PAGE
// ----------------------
app.post('/admin/set-test-dates', requireAdmin, async (req, res) => {
  const { start, end } = req.body;
  try {
    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    let testConfig = await TestConfig.findOne();
    if (!testConfig) testConfig = new TestConfig();
    testConfig.scheduleStart = startDate;
    testConfig.scheduleEnd = endDate;
    await testConfig.save();
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to update test schedule dates');
  }
});

app.get('/test-schedule', requireLogin, async (req, res) => {
  let tConfig = await TestConfig.findOne();
  if (!tConfig) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    tConfig = new TestConfig({
      scheduleStart: now,
      scheduleEnd: new Date(now.getTime() + 14 * 86400000)
    });
    await tConfig.save();
  }

  const startDay = new Date(
    tConfig.scheduleStart.getFullYear(),
    tConfig.scheduleStart.getMonth(),
    tConfig.scheduleStart.getDate()
  );
  const endDay = new Date(
    tConfig.scheduleEnd.getFullYear(),
    tConfig.scheduleEnd.getMonth(),
    tConfig.scheduleEnd.getDate()
  );

  let dates = [];
  let currentDay = new Date(startDay);
  while (currentDay <= endDay) {
    const yyyy = currentDay.getFullYear();
    const mm = String(currentDay.getMonth() + 1).padStart(2, '0');
    const dd = String(currentDay.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    currentDay.setDate(currentDay.getDate() + 1);
  }

  let timeSlots = [];
  for (let h = 0; h < 24; h++) {
    timeSlots.push(
      `${String(h).padStart(2, '0')}:00-${String(h + 1).padStart(2, '0')}:00`
    );
  }

  const allTestAvail = await TestAvailability.find({
    date: { $in: dates }
  }).populate('user');

  let availabilityMap = {};
  allTestAvail.forEach(item => {
    const key = `${item.date}||${item.timeSlot}`;
    if (!availabilityMap[key]) availabilityMap[key] = [];
    if (item.available) {
      availabilityMap[key].push({
        id: item.user._id.toString(),
        firstName: item.user.firstName,
        lastName: item.user.lastName  // include lastName here as well!
      });
    }
  });

  // Note: No "On Call" line on test schedule as requested.
  const currentUserDoc = await User.findById(req.session.userId);
  const currentUserId = currentUserDoc ? currentUserDoc._id.toString() : '';
  const isAdmin = currentUserDoc && currentUserDoc.role === 'admin';
  let users = [];
  if (isAdmin) {
    users = await User.find();
  }

  res.render('testSchedule', {
    dates,
    timeSlots,
    availMap: availabilityMap,
    currentUserId,
    isAdmin,
    users,
    currentUser: currentUserDoc
  });
});

// API for test schedule batch updates
app.post('/api/test-batch-availability', requireLogin, async (req, res) => {
  const { changes } = req.body;
  const currentUserId = req.session.userId;

  for (let change of changes) {
    let userId = currentUserId;
    if (change.targetUserId) {
      const currentUser = await User.findById(currentUserId);
      if (currentUser && currentUser.role === 'admin') {
        userId = change.targetUserId;
      }
    }
    if (change.available) {
      await TestAvailability.findOneAndUpdate(
        { user: userId, date: change.date, timeSlot: change.timeSlot },
        { available: true },
        { upsert: true }
      );
    } else {
      await TestAvailability.findOneAndDelete({
        user: userId,
        date: change.date,
        timeSlot: change.timeSlot
      });
    }
  }

  io.emit('updateTestAvailability', {});
  res.json({ success: true });
});

// Socket.io connection
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
