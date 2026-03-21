const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
require('dotenv').config();

// Twilio SMS (optional — only active if TWILIO_* env vars are set)
let twilioClient = null;
const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID  || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN    || '';
const TWILIO_FROM  = process.env.TWILIO_PHONE_NUMBER  || '';
if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
  try {
    const twilio = require('twilio');
    twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
    console.log('✅ Twilio SMS enabled');
  } catch(e) {
    console.warn('⚠️  Twilio package not found — run: npm install twilio');
  }
} else {
  console.log('ℹ️  Twilio not configured — SMS notifications disabled');
}

// Helper: create in-app notifications for users with matching blood type
async function createInAppNotifications(requirement) {
  try {
    const { bloodType, patientName, hospital, location, unitsRequired, urgency, _id } = requirement;

    // Find all users: admin gets all, users get only their blood type
    const allUsers = await User.find({}, 'username role bloodType').lean();

    const urgencyLabel = urgency === 'Critical' ? '🚨 Critical' :
                         urgency === 'High'     ? '⚠️ High Priority' :
                         urgency === 'Medium'   ? '🟡 Medium' : '🟢 Low';

    const title   = `${urgencyLabel} — ${bloodType} Blood Needed`;
    const message = `${unitsRequired} unit${unitsRequired !== 1 ? 's' : ''} of ${bloodType} needed for ${patientName} at ${hospital}${location ? ', ' + location : ''}.`;

    const notifications = allUsers
      .filter(u => u.role === 'admin' || u.bloodType === bloodType)
      .map(u => ({
        username:      u.username,
        type:          'requirement',
        title,
        message,
        bloodType,
        requirementId: _id,
        isRead:        false,
      }));

    if (notifications.length) {
      await Notification.insertMany(notifications);
      console.log(`🔔 Created ${notifications.length} notification(s) for ${bloodType} requirement`);
    }
  } catch(err) {
    console.error('Notification creation error:', err.message);
  }
}

// Helper: send SMS to matching available donors for a blood requirement
async function notifyMatchingDonors(requirement) {
  if (!twilioClient) return { sent: 0, failed: 0, skipped: 'Twilio not configured' };

  const { bloodType, patientName, hospital, location, unitsRequired, urgency } = requirement;

  // Find available donors with matching blood type who have a phone number
  const donors = await Donor.find({
    bloodType,
    isAvailable: true,
    phone: { $exists: true, $ne: '' }
  }).lean();

  if (!donors.length) return { sent: 0, failed: 0, skipped: 'No matching donors' };

  // Build the SMS message
  const urgencyText = urgency === 'Critical' ? '🚨 URGENT' : urgency === 'High' ? '⚠️ HIGH PRIORITY' : 'Blood Needed';
  const locationText = location ? ` in ${location}` : '';
  const message =
    `${urgencyText} - HSBlood Alert
` +
    `Blood Type: ${bloodType} (${unitsRequired} unit${unitsRequired !== 1 ? 's' : ''} needed)
` +
    `Patient: ${patientName}
` +
    `Hospital: ${hospital}${locationText}
` +
    `If you can donate, please contact the hospital directly.
` +
    `Reply STOP to opt out.`;

  let sent = 0, failed = 0;
  const errors = [];

  // Send to each donor — do not await all at once to avoid rate limits
  for (const donor of donors) {
    try {
      // Normalise phone: ensure it starts with + for international format
      let phone = donor.phone.replace(/[\s\-()]/g, '');
      if (!phone.startsWith('+')) phone = '+91' + phone; // default India country code
      await twilioClient.messages.create({
        body: message,
        from: TWILIO_FROM,
        to:   phone,
      });
      sent++;
    } catch(err) {
      failed++;
      errors.push({ donor: `${donor.firstName} ${donor.lastName}`, error: err.message });
    }
  }

  console.log(`📱 SMS: ${sent} sent, ${failed} failed for ${bloodType} requirement`);
  if (errors.length) console.warn('SMS errors:', errors);
  return { sent, failed, total: donors.length };
}

const app = express();

// CORS — allow localhost (dev), LAN access, file:// protocol, and any HTTPS origin
// (frontend is a static file that can be opened from anywhere)
const ALLOWED_ORIGIN_ENV = process.env.ALLOWED_ORIGIN || ''; // optional: lock to specific domain

app.use(cors({
  origin: function(origin, callback) {
    // No origin   → same-origin / curl / Postman
    // 'null'      → file:// protocol (browser sends literal string "null")
    if (!origin || origin === 'null') return callback(null, true);

    // If admin has locked to a specific origin via env var, enforce it
    if (ALLOWED_ORIGIN_ENV && origin !== ALLOWED_ORIGIN_ENV) {
      return callback(new Error('CORS: origin not allowed — ' + origin));
    }

    // Localhost / 127.0.0.1 (any port)
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);

    // LAN / private network IPs
    if (/^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)) return callback(null, true);

    // Any HTTPS origin — needed for Render hosting, GitHub Pages, Netlify, etc.
    if (/^https:\/\//.test(origin)) return callback(null, true);

    callback(new Error('CORS: origin not allowed — ' + origin));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.static('../')); // serves index.html, css/, js/, assets/ from root

// ─── HEALTH CHECK ─────────────────────────────────────────────
// Used by UptimeRobot to keep Render free tier awake
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ─── DB ───────────────────────────────────────────────────────
const MONGO_URI  = process.env.MONGO_URI  || 'mongodb://localhost:27017/bloodlink';
const JWT_SECRET = process.env.JWT_SECRET || 'bloodlink_secret';

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000,  // fail fast instead of hanging for 30s
  socketTimeoutMS: 45000,
})
  .then(() => { console.log('✅ Connected to MongoDB'); seedAccounts(); })
  .catch(err => console.error('❌ MongoDB connection error:', err.message));

mongoose.connection.on('disconnected', () =>
  console.warn('⚠️  MongoDB disconnected — waiting for reconnect…'));
mongoose.connection.on('reconnected',  () =>
  console.log('✅ MongoDB reconnected'));
mongoose.connection.on('error', err =>
  console.error('❌ MongoDB error:', err.message));

// ─── SCHEMAS ──────────────────────────────────────────────────

// User / Auth
const userSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, trim: true },
  password:  { type: String, required: true },
  email:     { type: String, default: '', trim: true, lowercase: true },
  role:      { type: String, enum: ['admin', 'user'], default: 'user' },
  bloodType: { type: String, default: '', trim: true }, // optional — used for notifications
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Notification
const notificationSchema = new mongoose.Schema({
  username:      { type: String, required: true },         // recipient username
  type:          { type: String, default: 'requirement' }, // notification type
  title:         { type: String, required: true },
  message:       { type: String, required: true },
  bloodType:     { type: String, default: '' },
  requirementId: { type: mongoose.Schema.Types.ObjectId, ref: 'BloodRequirement', default: null },
  isRead:        { type: Boolean, default: false },
  createdAt:     { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

// Blood Type
const bloodTypeSchema = new mongoose.Schema({
  type:           { type: String, required: true, unique: true, enum: ['A+','A-','B+','B-','AB+','AB-','O+','O-'] },
  description:    { type: String, default: '' },
  canDonateTo:    [{ type: String }],
  canReceiveFrom: [{ type: String }],
  characteristics:{ type: String, default: '' },
  specialNotes:   { type: String, default: '' },
  createdAt:      { type: Date, default: Date.now }
});
const BloodType = mongoose.model('BloodType', bloodTypeSchema);

// Donor
const donorSchema = new mongoose.Schema({
  firstName:       { type: String, required: true, trim: true },
  lastName:        { type: String, required: true, trim: true },
  dateOfBirth:     { type: Date,   required: true },
  gender:          { type: String, enum: ['Male','Female','Other'], required: true },
  email:           { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:           { type: String, required: true },
  address:         { type: String, default: '' },
  city:            { type: String, default: 'N/A' },
  country:         { type: String, default: 'N/A' },
  bloodType:       { type: String, required: true, enum: ['A+','A-','B+','B-','AB+','AB-','O+','O-'] },
  lastDonationDate:{ type: Date },
  isAvailable:     { type: Boolean, default: true },
  createdAt:       { type: Date, default: Date.now },
  updatedAt:       { type: Date, default: Date.now }
});
donorSchema.pre('save', function(next){ this.updatedAt = new Date(); next(); });
const Donor = mongoose.model('Donor', donorSchema);

// Blood Requirement
const bloodRequirementSchema = new mongoose.Schema({
  patientName:    { type: String, required: true, trim: true },
  hospital:       { type: String, required: true, trim: true },
  location:       { type: String, default: '', trim: true },
  contactPerson:  { type: String, required: true, trim: true },
  contactPhone:   { type: String, required: true },
  bloodType:      { type: String, required: true, enum: ['A+','A-','B+','B-','AB+','AB-','O+','O-'] },
  unitsRequired:  { type: Number, required: true, min: 1 },
  urgency:        { type: String, enum: ['Critical','High','Medium','Low'], default: 'Medium' },
  requiredBy:     { type: Date },
  notes:          { type: String, default: '' },
  status:         { type: String, enum: ['Open','Fulfilled','Cancelled'], default: 'Open' },
  createdBy:      { type: String, default: '' },
  createdAt:      { type: Date, default: Date.now },
  updatedAt:      { type: Date, default: Date.now }
});
bloodRequirementSchema.pre('save', function(next){ this.updatedAt = new Date(); next(); });
const BloodRequirement = mongoose.model('BloodRequirement', bloodRequirementSchema);

// Info Directory (Hospitals & Ambulances)
const infoEntrySchema = new mongoose.Schema({
  category:    { type: String, required: true, enum: ['Hospital', 'Ambulance', 'Blood Bank'] },
  name:        { type: String, required: true, trim: true },
  phone:       { type: String, required: true, trim: true },
  address:     { type: String, default: '', trim: true },
  area:        { type: String, default: '', trim: true },
  notes:       { type: String, default: '', trim: true },
  available24h:{ type: Boolean, default: false },
  lat:         { type: Number, default: null },
  lng:         { type: Number, default: null },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now }
});
infoEntrySchema.pre('save', function(next){ this.updatedAt = new Date(); next(); });
infoEntrySchema.index({ name: 1, phone: 1 }, { unique: true });
const InfoEntry = mongoose.model('InfoEntry', infoEntrySchema);

// ─── SEED DEFAULT ACCOUNTS ────────────────────────────────────
async function seedAccounts() {
  try {
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    const normalUser = process.env.USER_USERNAME || 'user';
    const normalPass = process.env.USER_PASSWORD || 'user123';

    const existingAdmin = await User.findOne({ username: adminUser });
    if (!existingAdmin) {
      const hashed = await bcrypt.hash(adminPass, 10);
      await User.create({ username: adminUser, password: hashed, role: 'admin' });
      console.log(`✅ Admin account created → username: ${adminUser}  password: ${adminPass}`);
    }

    const existingUser = await User.findOne({ username: normalUser });
    if (!existingUser) {
      const hashed = await bcrypt.hash(normalPass, 10);
      await User.create({ username: normalUser, password: hashed, role: 'user' });
      console.log(`✅ User account created  → username: ${normalUser}  password: ${normalPass}`);
    }
  } catch(err) {
    console.error('Seed error:', err.message);
  }
}

// ─── MIDDLEWARE ───────────────────────────────────────────────

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Not authenticated. Please log in.' });
  }
  try {
    const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch(e) {
    return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Permission denied. Admin access required.' });
  }
  next();
}

// Helper — always converts isAvailable to a real boolean no matter what comes in
function castAvailability(body) {
  body.isAvailable = String(body.isAvailable) === 'true';
  return body;
}

// ─── AUTH ROUTES ──────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, error: 'Username and password are required.' });

    const user = await User.findOne({ username: username.trim().toLowerCase() });
    if (!user)
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: { username: user.username, role: user.role, email: user.email || '', bloodType: user.bloodType || '' },
      message: `Welcome back, ${user.username}!`
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ─── REGISTER (HS Employee self-registration) ─────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, confirmPassword, email } = req.body;

    if (!username || !password || !confirmPassword)
      return res.status(400).json({ success: false, error: 'All fields are required.' });

    if (username.trim().length < 3)
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters.' });

    if (password.length < 6)
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });

    if (password !== confirmPassword)
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });

    // Check for duplicate username (case-insensitive)
    const existing = await User.findOne({ username: username.trim().toLowerCase() });
    if (existing)
      return res.status(409).json({ success: false, error: 'Username already exists. Please choose a different one.' });

    const hashed = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      username:  username.trim().toLowerCase(),
      password:  hashed,
      email:     email ? email.trim().toLowerCase() : '',
      role:      'user',
      bloodType: req.body.bloodType ? req.body.bloodType.trim() : ''
    });

    console.log(`✅ New HS Employee registered → username: ${newUser.username}`);

    res.status(201).json({
      success: true,
      message: `Account created successfully! You can now sign in as ${newUser.username}.`
    });
  } catch(err) {
    if (err.code === 11000)
      return res.status(409).json({ success: false, error: 'Username already exists. Please choose a different one.' });
    res.status(500).json({ success: false, error: err.message });
  }
});


// ─── FORGOT PASSWORD (lookup by username + email) ─────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { username, email, newPassword, confirmPassword } = req.body;

    if (!username || !email || !newPassword || !confirmPassword)
      return res.status(400).json({ success: false, error: 'All fields are required.' });

    if (newPassword.length < 6)
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });

    if (newPassword !== confirmPassword)
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });

    const user = await User.findOne({
      username: username.trim().toLowerCase(),
      email:    email.trim().toLowerCase()
    });

    if (!user)
      return res.status(404).json({ success: false, error: 'No account found with that username and email combination.' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true, message: 'Password reset successfully! You can now sign in.' });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── CHANGE PASSWORD (authenticated) ─────────────────────────
app.post('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword)
      return res.status(400).json({ success: false, error: 'All fields are required.' });

    if (newPassword.length < 6)
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });

    if (newPassword !== confirmPassword)
      return res.status(400).json({ success: false, error: 'New passwords do not match.' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match)
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });

    if (currentPassword === newPassword)
      return res.status(400).json({ success: false, error: 'New password must be different from the current one.' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true, message: 'Password updated successfully!' });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ─── BLOOD TYPE ROUTES ────────────────────────────────────────

app.get('/api/blood-types', authenticate, async (req, res) => {
  try {
    const types = await BloodType.find().sort('type');
    res.json({ success: true, data: types });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/blood-types/:type', authenticate, async (req, res) => {
  try {
    const bt = await BloodType.findOne({ type: req.params.type.toUpperCase() });
    if (!bt) return res.status(404).json({ success: false, error: 'Blood type not found' });
    res.json({ success: true, data: bt });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/blood-types', authenticate, adminOnly, async (req, res) => {
  try {
    const existing = await BloodType.findOne({ type: req.body.type });
    if (existing) {
      Object.assign(existing, req.body);
      await existing.save();
      return res.json({ success: true, data: existing, message: 'Blood type updated' });
    }
    const bt = new BloodType(req.body);
    await bt.save();
    res.status(201).json({ success: true, data: bt, message: 'Blood type created' });
  } catch(err) { res.status(400).json({ success: false, error: err.message }); }
});

app.delete('/api/blood-types/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await BloodType.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Blood type deleted' });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── DONOR ROUTES ─────────────────────────────────────────────

app.get('/api/donors', authenticate, async (req, res) => {
  try {
    const filter = {};
    if (req.query.bloodType) filter.bloodType = req.query.bloodType;
    if (req.query.available) filter.isAvailable = req.query.available === 'true';
    if (req.query.email)     filter.email = req.query.email.trim().toLowerCase();
    const donors = await Donor.find(filter).sort('-createdAt');
    res.json({ success: true, data: donors, count: donors.length });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// Admin only — bulk upload donors from parsed Excel data
app.post('/api/donors/bulk', authenticate, adminOnly, async (req, res) => {
  try {
    const { donors } = req.body;
    if (!Array.isArray(donors) || donors.length === 0)
      return res.status(400).json({ success: false, error: 'No donor data provided.' });

    const VALID_BLOOD_TYPES = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
    const VALID_GENDERS     = ['Male','Female','Other'];

    const results = { inserted: 0, skipped: 0, errors: [] };

    for (let i = 0; i < donors.length; i++) {
      const raw = donors[i];
      const rowNum = i + 2; // Excel row (header is row 1)

      try {
        // Normalise blood type
        const bt = (raw.bloodType || '').toString().trim().toUpperCase()
          .replace('POSITIVE','+').replace('NEGATIVE','-');

        // Normalise gender
        let gender = (raw.gender || '').toString().trim();
        gender = gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase();
        if (gender === 'M') gender = 'Male';
        if (gender === 'F') gender = 'Female';

        // Validate required fields
        if (!raw.firstName || !raw.lastName)
          throw new Error('First name and last name are required');
        if (!raw.email)
          throw new Error('Email is required');
        if (!raw.phone)
          throw new Error('Phone is required');
        if (!VALID_BLOOD_TYPES.includes(bt))
          throw new Error(`Invalid blood type "${bt}". Must be one of: ${VALID_BLOOD_TYPES.join(', ')}`);
        if (!VALID_GENDERS.includes(gender))
          throw new Error(`Invalid gender "${gender}". Must be Male, Female, or Other`);

        // Parse date of birth
        let dob;
        if (raw.dateOfBirth) {
          // Handle Excel serial date numbers
          if (typeof raw.dateOfBirth === 'number') {
            dob = new Date(Math.round((raw.dateOfBirth - 25569) * 86400 * 1000));
          } else {
            dob = new Date(raw.dateOfBirth);
          }
          if (isNaN(dob.getTime())) throw new Error('Invalid date of birth');
        } else {
          throw new Error('Date of birth is required');
        }

        // Parse last donation date (optional)
        let lastDonationDate;
        if (raw.lastDonationDate) {
          if (typeof raw.lastDonationDate === 'number') {
            lastDonationDate = new Date(Math.round((raw.lastDonationDate - 25569) * 86400 * 1000));
          } else {
            lastDonationDate = new Date(raw.lastDonationDate);
          }
          if (isNaN(lastDonationDate.getTime())) lastDonationDate = undefined;
        }

        const donorDoc = {
          firstName:       raw.firstName.toString().trim(),
          lastName:        raw.lastName.toString().trim(),
          dateOfBirth:     dob,
          gender,
          email:           raw.email.toString().trim().toLowerCase(),
          phone:           raw.phone.toString().trim(),
          address:         (raw.address || '').toString().trim(),
          city:            (raw.city    || 'N/A').toString().trim(),
          country:         (raw.country || 'N/A').toString().trim(),
          bloodType:       bt,
          isAvailable:     String(raw.isAvailable).toLowerCase() !== 'false',
          lastDonationDate
        };

        await Donor.create(donorDoc);
        results.inserted++;
      } catch(rowErr) {
        const isDuplicate = rowErr.code === 11000;
        results.skipped++;
        results.errors.push({
          row: rowNum,
          email: (raw.email || '').toString(),
          reason: isDuplicate ? 'Email already exists in registry' : rowErr.message
        });
      }
    }

    res.status(207).json({
      success: true,
      message: `Bulk upload complete: ${results.inserted} inserted, ${results.skipped} skipped.`,
      data: results
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get('/api/donors/:id', authenticate, async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id);
    if (!donor) return res.status(404).json({ success: false, error: 'Donor not found' });
    res.json({ success: true, data: donor });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});


// Both roles — register donor
app.post('/api/donors', authenticate, async (req, res) => {
  try {
    castAvailability(req.body);
    // Pre-check for duplicate email with a friendly message
    const email = (req.body.email || '').trim().toLowerCase();
    if (email) {
      const existing = await Donor.findOne({ email });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: `A donor with email "${email}" is already registered. Please use a different email or check the existing record.`
        });
      }
    }
    const donor = new Donor(req.body);
    await donor.save();
    res.status(201).json({ success: true, data: donor, message: 'Donor registered successfully!' });
  } catch(err) {
    if (err.code === 11000)
      return res.status(409).json({ success: false, error: 'A donor with this email already exists.' });
    res.status(400).json({ success: false, error: err.message });
  }
});

// Admin only — update donor
app.put('/api/donors/:id', authenticate, adminOnly, async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    castAvailability(req.body);
    const donor = await Donor.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!donor) return res.status(404).json({ success: false, error: 'Donor not found' });
    res.json({ success: true, data: donor, message: 'Donor updated successfully!' });
  } catch(err) { res.status(400).json({ success: false, error: err.message }); }
});

// Admin only — delete donor
app.delete('/api/donors/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await Donor.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Donor removed from registry.' });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});


// Both roles — stats
app.get('/api/stats', authenticate, async (req, res) => {
  try {
    const totalDonors     = await Donor.countDocuments();
    const availableDonors = await Donor.countDocuments({ isAvailable: true });
    const byBloodType     = await Donor.aggregate([
      { $group: { _id: '$bloodType', count: { $sum: 1 } } },
      { $sort:  { _id: 1 } }
    ]);

    // People benefitted = number of fulfilled requirements (1 requirement = 1 patient helped)
    // unitsRequired is shown separately as the blood units delivered
    const fulfilledRequirements = await BloodRequirement.countDocuments({ status: 'Fulfilled' });
    const peopleHelped = fulfilledRequirements;

    const unitsDeliveredAgg = await BloodRequirement.aggregate([
      { $match: { status: 'Fulfilled' } },
      { $group: { _id: null, total: { $sum: '$unitsRequired' } } }
    ]);
    const unitsDelivered = unitsDeliveredAgg.length ? unitsDeliveredAgg[0].total : 0;

    res.json({ success: true, data: { totalDonors, availableDonors, byBloodType, peopleHelped, fulfilledRequirements, unitsDelivered } });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── BLOOD REQUIREMENT ROUTES ─────────────────────────────────

// Get all requirements — both roles
app.get('/api/requirements', authenticate, async (req, res) => {
  try {
    const filter = {};
    if (req.query.bloodType) filter.bloodType = req.query.bloodType;
    if (req.query.status)    filter.status    = req.query.status;
    if (req.query.urgency)   filter.urgency   = req.query.urgency;
    const reqs = await BloodRequirement.find(filter).sort('-createdAt');
    res.json({ success: true, data: reqs, count: reqs.length });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// Get single requirement — both roles
app.get('/api/requirements/:id', authenticate, async (req, res) => {
  try {
    const req_ = await BloodRequirement.findById(req.params.id);
    if (!req_) return res.status(404).json({ success: false, error: 'Requirement not found' });
    res.json({ success: true, data: req_ });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// Create requirement — both roles can add
app.post('/api/requirements', authenticate, async (req, res) => {
  try {
    req.body.createdBy = req.user.username;
    // Duplicate check: same patientName + hospital + bloodType that is still Open
    const patientName = (req.body.patientName || '').trim();
    const hospital    = (req.body.hospital    || '').trim();
    const bloodType   = (req.body.bloodType   || '').trim();
    if (patientName && hospital && bloodType) {
      const existing = await BloodRequirement.findOne({
        patientName: { $regex: new RegExp(`^${patientName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`, 'i') },
        hospital:    { $regex: new RegExp(`^${hospital.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,    'i') },
        bloodType,
        status: 'Open'
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: `An open requirement already exists for patient "${patientName}" at "${hospital}" needing ${bloodType} blood. Please check the existing requirement before adding a new one.`
        });
      }
    }
    const req_ = new BloodRequirement(req.body);
    await req_.save();

    // Create in-app notifications — runs in background
    createInAppNotifications(req_).catch(err => console.error('In-app notification error:', err));

    // Send SMS to matching available donors — runs in background, doesn't block response
    notifyMatchingDonors(req_).then(smsResult => {
      if (smsResult.sent > 0) {
        console.log(`📱 Notified ${smsResult.sent} donor(s) for ${req_.bloodType} requirement`);
      }
    }).catch(err => console.error('SMS notification error:', err));

    res.status(201).json({
      success: true,
      data: req_,
      message: 'Blood requirement created successfully!'
    });
  } catch(err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update requirement — admin only
app.put('/api/requirements/:id', authenticate, adminOnly, async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const req_ = await BloodRequirement.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!req_) return res.status(404).json({ success: false, error: 'Requirement not found' });
    res.json({ success: true, data: req_, message: 'Requirement updated successfully!' });
  } catch(err) { res.status(400).json({ success: false, error: err.message }); }
});

// Delete requirement — admin only
app.delete('/api/requirements/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await BloodRequirement.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Requirement deleted.' });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// Admin only — bulk upload requirements from Excel
app.post('/api/requirements/bulk', authenticate, adminOnly, async (req, res) => {
  try {
    const { requirements } = req.body;
    if (!Array.isArray(requirements) || requirements.length === 0)
      return res.status(400).json({ success: false, error: 'No requirement data provided.' });

    const VALID_BLOOD_TYPES = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
    const VALID_URGENCY     = ['Critical','High','Medium','Low'];
    const VALID_STATUS      = ['Open','Fulfilled','Cancelled'];
    const results = { inserted: 0, skipped: 0, errors: [] };

    for (let i = 0; i < requirements.length; i++) {
      const raw = requirements[i];
      const rowNum = i + 2;
      try {
        const patientName   = (raw.patientName   || '').toString().trim();
        const hospital      = (raw.hospital      || '').toString().trim();
        const contactPerson = (raw.contactPerson || '').toString().trim();
        const contactPhone  = (raw.contactPhone  || '').toString().trim();
        const bt            = (raw.bloodType     || '').toString().trim().toUpperCase()
                               .replace('POSITIVE','+').replace('NEGATIVE','-');

        if (!patientName)   throw new Error('patientName is required');
        if (!hospital)      throw new Error('hospital is required');
        if (!contactPerson) throw new Error('contactPerson is required');
        if (!contactPhone)  throw new Error('contactPhone is required');
        if (!VALID_BLOOD_TYPES.includes(bt))
          throw new Error(`Invalid bloodType "${bt}". Must be one of: ${VALID_BLOOD_TYPES.join(', ')}`);

        const units = parseInt(raw.unitsRequired, 10);
        if (!units || units < 1) throw new Error('unitsRequired must be a positive number');

        let urgency = (raw.urgency || 'Medium').toString().trim();
        urgency = urgency.charAt(0).toUpperCase() + urgency.slice(1).toLowerCase();
        if (!VALID_URGENCY.includes(urgency)) urgency = 'Medium';

        let status = (raw.status || 'Open').toString().trim();
        status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
        if (!VALID_STATUS.includes(status)) status = 'Open';

        // Duplicate check: same patientName + hospital + bloodType with status Open
        if (status === 'Open') {
          const existing = await BloodRequirement.findOne({
            patientName: { $regex: new RegExp(`^${patientName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`, 'i') },
            hospital:    { $regex: new RegExp(`^${hospital.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,    'i') },
            bloodType: bt,
            status: 'Open'
          });
          if (existing) throw new Error(`Duplicate: open requirement for "${patientName}" at "${hospital}" (${bt}) already exists`);
        }

        let requiredBy;
        if (raw.requiredBy) {
          if (typeof raw.requiredBy === 'number') {
            requiredBy = new Date(Math.round((raw.requiredBy - 25569) * 86400 * 1000));
          } else {
            requiredBy = new Date(raw.requiredBy);
          }
          if (isNaN(requiredBy.getTime())) requiredBy = undefined;
        }

        await BloodRequirement.create({
          patientName,
          hospital,
          location:      (raw.location || '').toString().trim(),
          contactPerson,
          contactPhone,
          bloodType:     bt,
          unitsRequired: units,
          urgency,
          status,
          requiredBy,
          notes:         (raw.notes || '').toString().trim(),
          createdBy:     req.user.username
        });
        results.inserted++;
      } catch(rowErr) {
        results.skipped++;
        results.errors.push({
          row: rowNum,
          patientName: (raw.patientName || '').toString(),
          reason: rowErr.message
        });
      }
    }

    res.status(207).json({
      success: true,
      message: `Bulk upload complete: ${results.inserted} inserted, ${results.skipped} skipped.`,
      data: results
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── INFO DIRECTORY ROUTES ────────────────────────────────────

// Get all entries — both roles
app.get('/api/info', authenticate, async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    const entries = await InfoEntry.find(filter).sort('category name');
    res.json({ success: true, data: entries, count: entries.length });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// Get single entry — both roles
// Admin only — bulk upload info entries (hospitals & ambulances)
app.post('/api/info/bulk', authenticate, adminOnly, async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0)
      return res.status(400).json({ success: false, error: 'No entry data provided.' });

    const VALID_CATEGORIES = ['Hospital', 'Ambulance', 'Blood Bank'];
    const results = { inserted: 0, skipped: 0, errors: [] };

    for (let i = 0; i < entries.length; i++) {
      const raw = entries[i];
      const rowNum = i + 2; // Excel row (header = row 1)
      try {
        // Normalise category — accept flexible casing
        let category = (raw.category || '').toString().trim();
        // Handle "blood bank" (case-insensitive) -> canonical form
        if (category.toLowerCase() === 'blood bank') category = 'Blood Bank';
        else category = category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
        if (category === 'Hosp') category = 'Hospital';
        if (category === 'Amb')  category = 'Ambulance';

        if (!VALID_CATEGORIES.includes(category))
          throw new Error(`Invalid category "${raw.category}". Must be Hospital, Ambulance, or Blood Bank`);
        if (!raw.name || !raw.name.toString().trim())
          throw new Error('name is required');
        if (!raw.phone || !raw.phone.toString().trim())
          throw new Error('phone is required');

        // Parse lat/lng — blank is fine (null stored)
        const lat = raw.lat !== '' && raw.lat !== undefined ? parseFloat(raw.lat) : null;
        const lng = raw.lng !== '' && raw.lng !== undefined ? parseFloat(raw.lng) : null;

        const doc = {
          category,
          name:        raw.name.toString().trim(),
          phone:       raw.phone.toString().trim(),
          area:        (raw.area    || '').toString().trim(),
          address:     (raw.address || '').toString().trim(),
          notes:       (raw.notes   || '').toString().trim(),
          available24h: String(raw.available24h).toLowerCase() === 'true' || raw.available24h === 1,
          lat:         (lat !== null && !isNaN(lat)) ? lat : null,
          lng:         (lng !== null && !isNaN(lng)) ? lng : null,
        };

        await InfoEntry.create(doc);
        results.inserted++;
      } catch(rowErr) {
        const isDuplicate = rowErr.code === 11000 ||
          (rowErr.message && rowErr.message.toLowerCase().includes('duplicate'));
        results.skipped++;
        results.errors.push({
          row: rowNum,
          name: (raw.name || '').toString(),
          reason: isDuplicate
            ? `Duplicate: "${(raw.name||'').toString().trim()}" with this phone number already exists`
            : rowErr.message
        });
      }
    }

    res.status(207).json({
      success: true,
      message: `Bulk upload complete: ${results.inserted} inserted, ${results.skipped} skipped.`,
      data: results
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/info/:id', authenticate, async (req, res) => {
  try {
    const entry = await InfoEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: entry });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// Create entry — admin only
app.post('/api/info', authenticate, adminOnly, async (req, res) => {
  try {
    const name  = (req.body.name  || '').trim();
    const phone = (req.body.phone || '').trim();
    if (name && phone) {
      const existing = await InfoEntry.findOne({
        name:  { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,  'i') },
        phone: { $regex: new RegExp(`^${phone.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`, 'i') }
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: `An entry named "${name}" with phone "${phone}" already exists in the directory.`
        });
      }
    }
    const entry = new InfoEntry(req.body);
    await entry.save();
    res.status(201).json({ success: true, data: entry, message: 'Entry added successfully!' });
  } catch(err) {
    if (err.code === 11000)
      return res.status(409).json({ success: false, error: 'An entry with this name and phone number already exists.' });
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update entry — admin only
app.put('/api/info/:id', authenticate, adminOnly, async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const entry = await InfoEntry.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: entry, message: 'Entry updated successfully!' });
  } catch(err) { res.status(400).json({ success: false, error: err.message }); }
});

// Delete entry — admin only
app.delete('/api/info/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await InfoEntry.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Entry deleted.' });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── USER MANAGEMENT (admin only) ────────────────────────────

// List all users
app.get('/api/users', authenticate, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// Create user
app.post('/api/users', authenticate, adminOnly, async (req, res) => {
  try {
    const { username, password, email, role, bloodType } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, error: 'Username and password are required.' });
    if (username.trim().length < 3)
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters.' });
    if (password.length < 6)
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    const existing = await User.findOne({ username: username.trim().toLowerCase() });
    if (existing)
      return res.status(409).json({ success: false, error: 'Username already exists.' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      username:  username.trim().toLowerCase(),
      password:  hashed,
      email:     email ? email.trim().toLowerCase() : '',
      role:      role === 'admin' ? 'admin' : 'user',
      bloodType: bloodType ? bloodType.trim() : ''
    });
    res.status(201).json({ success: true, message: `User "${user.username}" created.`, data: { _id: user._id, username: user.username, email: user.email, role: user.role, bloodType: user.bloodType || '', createdAt: user.createdAt } });
  } catch(err) {
    if (err.code === 11000) return res.status(409).json({ success: false, error: 'Username already exists.' });
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update user (username, email, role, optional new password)
app.put('/api/users/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { username, email, role, password, bloodType } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    if (username && username.trim().length >= 3) {
      const clash = await User.findOne({ username: username.trim().toLowerCase(), _id: { $ne: user._id } });
      if (clash) return res.status(409).json({ success: false, error: 'Username already taken.' });
      user.username = username.trim().toLowerCase();
    }
    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
        return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
      user.email = email ? email.trim().toLowerCase() : '';
    }
    if (role === 'admin' || role === 'user') user.role = role;
    if (bloodType !== undefined) user.bloodType = bloodType ? bloodType.trim() : '';
    if (password) {
      if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
      user.password = await bcrypt.hash(password, 10);
    }
    await user.save();
    res.json({ success: true, message: `User "${user.username}" updated.`, data: { _id: user._id, username: user.username, email: user.email, role: user.role, bloodType: user.bloodType || '', createdAt: user.createdAt } });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// Delete user (cannot delete own account)
app.delete('/api/users/:id', authenticate, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(400).json({ success: false, error: 'You cannot delete your own account.' });
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    res.json({ success: true, message: `User "${user.username}" deleted.` });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── EXPORT ROUTES (admin only) ──────────────────────────────

// GET /api/export?datasets=donors,requirements,info,users&format=json
// Returns filtered, structured data ready for client-side XLSX/CSV generation
app.get('/api/export', authenticate, adminOnly, async (req, res) => {
  try {
    const requested = (req.query.datasets || 'donors,requirements,info')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const donorFilter = {};
    const reqFilter   = {};
    const infoFilter  = {};

    // Donor filters
    if (req.query.bloodType)  donorFilter.bloodType   = req.query.bloodType;
    if (req.query.available !== undefined && req.query.available !== '')
      donorFilter.isAvailable = req.query.available === 'true';
    if (req.query.donorDateFrom || req.query.donorDateTo) {
      donorFilter.createdAt = {};
      if (req.query.donorDateFrom) donorFilter.createdAt.$gte = new Date(req.query.donorDateFrom);
      if (req.query.donorDateTo)   donorFilter.createdAt.$lte = new Date(req.query.donorDateTo + 'T23:59:59');
    }

    // Requirement filters
    if (req.query.reqStatus)    reqFilter.status    = req.query.reqStatus;
    if (req.query.reqBloodType) reqFilter.bloodType = req.query.reqBloodType;
    if (req.query.reqUrgency)   reqFilter.urgency   = req.query.reqUrgency;
    if (req.query.reqDateFrom || req.query.reqDateTo) {
      reqFilter.createdAt = {};
      if (req.query.reqDateFrom) reqFilter.createdAt.$gte = new Date(req.query.reqDateFrom);
      if (req.query.reqDateTo)   reqFilter.createdAt.$lte = new Date(req.query.reqDateTo + 'T23:59:59');
    }

    // Info filters
    if (req.query.infoCategory) infoFilter.category = req.query.infoCategory;

    const result = {};

    if (requested.includes('donors')) {
      const donors = await Donor.find(donorFilter).sort('-createdAt').lean();
      result.donors = donors.map(d => ({
        'First Name':    d.firstName,
        'Last Name':     d.lastName,
        'Email':         d.email,
        'Phone':         d.phone,
        'Blood Type':    d.bloodType,
        'Gender':        d.gender,
        'Date of Birth': d.dateOfBirth ? new Date(d.dateOfBirth).toISOString().split('T')[0] : '',
        'Address':       d.address || '',
        'City':          d.city || '',
        'Country':       d.country || '',
        'Available':     d.isAvailable ? 'Yes' : 'No',
        'Last Donation': d.lastDonationDate ? new Date(d.lastDonationDate).toISOString().split('T')[0] : '',
        'Registered On': new Date(d.createdAt).toISOString().split('T')[0],
        'Last Updated':  new Date(d.updatedAt).toISOString().split('T')[0],
      }));
    }

    if (requested.includes('requirements')) {
      const reqs = await BloodRequirement.find(reqFilter).sort('-createdAt').lean();
      result.requirements = reqs.map(r => ({
        'Patient Name':   r.patientName,
        'Hospital':       r.hospital,
        'Location':       r.location || '',
        'Contact Person': r.contactPerson,
        'Contact Phone':  r.contactPhone,
        'Blood Type':     r.bloodType,
        'Units Required': r.unitsRequired,
        'Urgency':        r.urgency,
        'Status':         r.status,
        'Required By':    r.requiredBy ? new Date(r.requiredBy).toISOString().split('T')[0] : '',
        'Notes':          r.notes || '',
        'Created By':     r.createdBy || '',
        'Created On':     new Date(r.createdAt).toISOString().split('T')[0],
        'Last Updated':   new Date(r.updatedAt).toISOString().split('T')[0],
      }));
    }

    if (requested.includes('info')) {
      const entries = await InfoEntry.find(infoFilter).sort('category name').lean();
      result.info = entries.map(e => ({
        'Category':      e.category,
        'Name':          e.name,
        'Phone':         e.phone,
        'Area':          e.area || '',
        'Address':       e.address || '',
        'Notes':         e.notes || '',
        '24h Available': e.available24h ? 'Yes' : 'No',
        'Latitude':      e.lat != null ? e.lat : '',
        'Longitude':     e.lng != null ? e.lng : '',
        'Added On':      new Date(e.createdAt).toISOString().split('T')[0],
      }));
    }

    if (requested.includes('users')) {
      const users = await User.find({}, '-password').sort({ createdAt: -1 }).lean();
      result.users = users.map(u => ({
        'Username':   u.username,
        'Email':      u.email || '',
        'Role':       u.role,
        'Created On': new Date(u.createdAt).toISOString().split('T')[0],
      }));
    }

    result.summary = {
      donors:       result.donors?.length       ?? null,
      requirements: result.requirements?.length ?? null,
      info:         result.info?.length          ?? null,
      users:        result.users?.length         ?? null,
      exportedAt:   new Date().toISOString(),
      exportedBy:   req.user.username,
    };

    res.json({ success: true, data: result });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PROFILE ROUTES (any authenticated user) ─────────────────

// GET /api/auth/profile — get own profile
app.get('/api/auth/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id, '-password').lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    res.json({ success: true, user });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/auth/profile — update own profile (username, email, bloodType)
app.put('/api/auth/profile', authenticate, async (req, res) => {
  try {
    const { username, email, bloodType } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    // Username duplicate check (exclude self)
    if (username && username.trim().length >= 3) {
      const newUsername = username.trim().toLowerCase();
      if (newUsername !== user.username) {
        const clash = await User.findOne({ username: newUsername, _id: { $ne: user._id } });
        if (clash) return res.status(409).json({ success: false, error: 'That username is already taken. Please choose a different one.' });
        user.username = newUsername;
      }
    } else if (username !== undefined && username.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters.' });
    }

    // Email duplicate check (exclude self)
    if (email !== undefined) {
      const newEmail = email.trim().toLowerCase();
      if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail))
        return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
      if (newEmail && newEmail !== user.email) {
        const clash = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
        if (clash) return res.status(409).json({ success: false, error: 'That email is already linked to another account.' });
      }
      user.email = newEmail;
    }

    if (bloodType !== undefined) user.bloodType = bloodType ? bloodType.trim() : '';

    await user.save();

    // Return updated user (no password)
    const updated = { username: user.username, email: user.email, role: user.role, bloodType: user.bloodType || '' };
    res.json({ success: true, user: updated, message: 'Profile updated successfully!' });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── NOTIFICATION ROUTES ─────────────────────────────────────

// GET /api/notifications — get notifications for current user
app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    const notifications = await Notification.find({ username: req.user.username })
      .sort('-createdAt')
      .limit(50)
      .lean();
    const unreadCount = notifications.filter(n => !n.isRead).length;
    res.json({ success: true, data: notifications, unreadCount });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/notifications/read-all — mark all as read (must be before /:id route)
app.put('/api/notifications/read-all', authenticate, async (req, res) => {
  try {
    await Notification.updateMany({ username: req.user.username, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/notifications/:id/read — mark one as read
app.put('/api/notifications/:id/read', authenticate, async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, username: req.user.username },
      { isRead: true }
    );
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/notifications — clear all (must be before /:id route)
app.delete('/api/notifications', authenticate, async (req, res) => {
  try {
    await Notification.deleteMany({ username: req.user.username });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/notifications/:id — delete one notification
app.delete('/api/notifications/:id', authenticate, async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, username: req.user.username });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GLOBAL ERROR HANDLER ────────────────────────────────────
// Catches any error passed via next(err) from route handlers
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error' });
});

// Catch unhandled promise rejections so the process doesn't crash silently
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// ─── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🩸 BloodLink running at http://localhost:${PORT}`);
  console.log(`─────────────────────────────────────────`);
  console.log(`   Admin  →  ${process.env.ADMIN_USERNAME || 'admin'} / ${process.env.ADMIN_PASSWORD || 'admin123'}`);
  console.log(`   User   →  ${process.env.USER_USERNAME  || 'user'}  / ${process.env.USER_PASSWORD  || 'user123'}`);
  console.log(`─────────────────────────────────────────`);
});