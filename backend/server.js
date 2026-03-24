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

// ── FRIENDLY ERROR HELPER ────────────────────────────────────────────────────
// Converts raw database/system errors into readable messages for users.
// Technical details are logged server-side only.
function friendlyError(err, context = '') {
  if (context) console.error(`[${context}]`, err.message || err);

  // MongoDB duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    const fieldLabel = field === 'username' ? 'Username'
                     : field === 'email'    ? 'Email address'
                     : field === 'phone'    ? 'Phone number'
                     : field.charAt(0).toUpperCase() + field.slice(1);
    return `${fieldLabel} already exists. Please use a different one.`;
  }
  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    const msgs = Object.values(err.errors).map(e => e.message);
    return msgs.length ? msgs[0] : 'One or more fields are invalid. Please check your input.';
  }
  // Cast errors (e.g. invalid ObjectId)
  if (err.name === 'CastError') {
    return 'Invalid ID format. Please refresh the page and try again.';
  }
  // MongoDB network / connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoServerSelectionError') {
    return 'Unable to reach the database. Please try again in a moment.';
  }
  // JWT errors (shouldn't normally reach here, but just in case)
  if (err.name === 'JsonWebTokenError') return 'Invalid session. Please log in again.';
  if (err.name === 'TokenExpiredError')  return 'Your session has expired. Please log in again.';

  // Generic fallback — never expose raw err.message to the client
  return 'Something went wrong on the server. Please try again or contact support.';
}
// ─────────────────────────────────────────────────────────────────────────────

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
      errors.push({ donor: `${donor.firstName} ${donor.lastName}`, error: 'SMS could not be delivered.' });
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
  username:         { type: String, required: true, unique: true, trim: true },
  password:         { type: String, required: true },
  email:            { type: String, default: '', trim: true, lowercase: true },
  role:             { type: String, enum: ['admin', 'user'], default: 'user' },
  bloodType:        { type: String, default: '', trim: true },
  // Enhanced donor fields
  mobile:           { type: String, default: '', trim: true, unique: true, sparse: true },
  isAvailable:      { type: Boolean, default: true },
  address:          { type: String, default: '', trim: true },
  lastDonationDate: { type: Date, default: null },
  firstName:        { type: String, default: '', trim: true },
  lastName:         { type: String, default: '', trim: true },
  donorId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Donor', default: null },
  createdAt:        { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// OTP Store (in-memory; for production use Redis or a DB collection)
const otpStore = new Map(); // key: mobile → { otp, expiresAt, purpose }

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTP(mobile, otp) {
  // If Twilio is configured, send real SMS; otherwise log to console (dev mode)
  if (twilioClient && TWILIO_FROM) {
    let phone = mobile.replace(/[\s\-()]/g, '');
    if (!phone.startsWith('+')) phone = '+91' + phone;
    await twilioClient.messages.create({
      body: `Your HSBlood OTP is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`,
      from: TWILIO_FROM,
      to: phone,
    });
    console.log(`📱 OTP sent to ${phone}`);
  } else {
    // Dev mode — print OTP to console so testing is possible without Twilio
    console.log(`🔐 [DEV MODE] OTP for ${mobile}: ${otp}`);
  }
}

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
  email:           { type: String, required: false, unique: true, sparse: true, lowercase: true, trim: true, default: null },
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
  remainingUnits: { type: Number, default: null }, // null = use unitsRequired as baseline
  urgency:        { type: String, enum: ['Critical','High','Medium','Low'], default: 'Medium' },
  requiredBy:     { type: Date },
  notes:          { type: String, default: '' },
  status:         { type: String, enum: ['Open','Fulfilled','Cancelled'], default: 'Open' },
  createdBy:      { type: String, default: '' },
  donations: [{
    donorUsername: { type: String, required: true },
    donorName:     { type: String, default: '' },
    bloodType:     { type: String, default: '' },
    donatedAt:     { type: Date, default: Date.now },
    note:          { type: String, default: '' }
  }],
  declines: [{
    donorUsername: { type: String },
    declinedAt:    { type: Date, default: Date.now }
  }],
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

// ── OTP: Send OTP to mobile (for HS Employee login/register) ──
app.post('/api/auth/otp/send', async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile.trim()))
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit Indian mobile number.' });

    const mob     = mobile.trim();
    const purpose = (req.body.purpose || 'login').trim();

    // Check if mobile is registered — block login attempts for unregistered numbers
    const existingUser  = await User.findOne({ mobile: mob }).lean();
    const existingDonor = await Donor.findOne({ phone: mob }).lean();

    if (purpose !== 'register' && !existingUser && !existingDonor) {
      return res.status(404).json({
        success: false,
        error: 'No account found for this mobile number. Please register first.',
      });
    }

    const otp = generateOTP();
    otpStore.set(mob, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });

    await sendOTP(mob, otp);

    res.json({
      success: true,
      message: 'OTP sent successfully! Check your mobile.',
      isExistingUser:  !!existingUser,
      isExistingDonor: !!existingDonor && !existingUser,
    });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'OTP Send') });
  }
});

// ── OTP: Login with mobile + OTP (existing user OR existing donor) ──
app.post('/api/auth/otp/login', async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp)
      return res.status(400).json({ success: false, error: 'Mobile number and OTP are required.' });

    const mob = mobile.trim();
    const stored = otpStore.get(mob);
    if (!stored)
      return res.status(400).json({ success: false, error: 'No OTP found. Please request a new OTP.' });
    if (Date.now() > stored.expiresAt) {
      otpStore.delete(mob);
      return res.status(400).json({ success: false, error: 'OTP expired. Please request a new one.' });
    }
    if (stored.otp !== otp.trim())
      return res.status(400).json({ success: false, error: 'Incorrect OTP. Please try again.' });

    otpStore.delete(mob);

    // Find or create user by mobile
    let user = await User.findOne({ mobile: mob });

    if (!user) {
      // Check if there is a donor with this phone — auto-create a user account for them
      const donor = await Donor.findOne({ phone: mob }).lean();
      if (donor) {
        const autoUsername = `hs_${mob.slice(-6)}`;
        const hashedPwd = await bcrypt.hash(mob + '_auto_' + Date.now(), 10);
        user = await User.create({
          username:         autoUsername,
          password:         hashedPwd,
          mobile:           mob,
          email:            donor.email || '',
          bloodType:        donor.bloodType || '',
          isAvailable:      donor.isAvailable,
          address:          donor.address || '',
          lastDonationDate: donor.lastDonationDate || null,
          role:             'user',
          donorId:          donor._id,
        });
        console.log(`✅ Auto-created user for donor ${donor.firstName} ${donor.lastName} → ${autoUsername}`);
      } else {
        return res.status(404).json({
          success: false,
          error: 'No account found for this mobile number. Please register first.',
          notRegistered: true,
        });
      }
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        username:         user.username,
        role:             user.role,
        email:            user.email || '',
        bloodType:        user.bloodType || '',
        mobile:           user.mobile || '',
        firstName:        user.firstName || '',
        lastName:         user.lastName || '',
        isAvailable:      user.isAvailable,
        address:          user.address || '',
        lastDonationDate: user.lastDonationDate || null,
        donorId:          user.donorId || null,
      },
      message: `Welcome back!`,
    });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'OTP Login') });
  }
});

// ── OTP: Register new HS Employee with full donor details ──
app.post('/api/auth/otp/register', async (req, res) => {
  try {
    const { mobile, otp, firstName, lastName, bloodType,
            isAvailable, address, email, lastDonationDate } = req.body;

    if (!mobile || !otp)
      return res.status(400).json({ success: false, error: 'Mobile and OTP are required.' });

    const mob = mobile.trim();
    const stored = otpStore.get(mob);
    if (!stored)
      return res.status(400).json({ success: false, error: 'No OTP found. Please request a new OTP.' });
    if (Date.now() > stored.expiresAt) {
      otpStore.delete(mob);
      return res.status(400).json({ success: false, error: 'OTP expired. Please request a new one.' });
    }
    if (stored.otp !== otp.trim())
      return res.status(400).json({ success: false, error: 'Incorrect OTP. Please try again.' });

    otpStore.delete(mob);

    // Validate required fields
    if (!firstName || !lastName) return res.status(400).json({ success: false, error: 'First name and last name are required.' });
    if (!bloodType) return res.status(400).json({ success: false, error: 'Blood type is required.' });

    const VALID_BT = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
    if (!VALID_BT.includes(bloodType))
      return res.status(400).json({ success: false, error: 'Invalid blood type.' });

    // Check duplicate mobile
    const existingUser = await User.findOne({ mobile: mob });
    if (existingUser)
      return res.status(409).json({ success: false, error: 'An account with this mobile number already exists. Please log in.' });

    // Create or link donor record
    let donor = await Donor.findOne({ phone: mob });
    if (!donor) {
      const donorEmail = email ? email.trim().toLowerCase() : `hs_${mob}@hsblood.local`;
      // Ensure email uniqueness for auto-generated emails
      const existingDonorEmail = await Donor.findOne({ email: donorEmail });
      const finalEmail = existingDonorEmail ? `hs_${mob}_${Date.now()}@hsblood.local` : donorEmail;

      donor = await Donor.create({
        firstName:       firstName.trim(),
        lastName:        lastName.trim(),
        phone:           mob,
        email:           finalEmail,
        address:         address ? address.trim() : '',
        city:            'N/A',
        country:         'N/A',
        bloodType,
        isAvailable:     isAvailable !== false,
        lastDonationDate: lastDonationDate ? new Date(lastDonationDate) : undefined,
      });
      console.log(`✅ Donor auto-created from registration: ${firstName} ${lastName}`);
    }

    // Create user account
    const autoUsername = `hs_${mob.slice(-6)}_${Date.now().toString().slice(-4)}`;
    const hashedPwd = await bcrypt.hash(mob + '_reg_' + Date.now(), 10);
    const newUser = await User.create({
      username:         autoUsername,
      password:         hashedPwd,
      mobile:           mob,
      email:            email ? email.trim().toLowerCase() : '',
      bloodType,
      isAvailable:      isAvailable !== false,
      address:          address ? address.trim() : '',
      lastDonationDate: lastDonationDate ? new Date(lastDonationDate) : null,
      role:             'user',
      donorId:          donor._id,
    });

    const token = jwt.sign(
      { id: newUser._id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✅ New HS Employee registered via OTP → mobile: ${mob}, username: ${autoUsername}`);

    res.status(201).json({
      success: true,
      token,
      user: {
        username:         newUser.username,
        role:             newUser.role,
        email:            newUser.email || '',
        bloodType:        newUser.bloodType || '',
        mobile:           newUser.mobile || '',
        isAvailable:      newUser.isAvailable,
        address:          newUser.address || '',
        lastDonationDate: newUser.lastDonationDate || null,
        donorId:          newUser.donorId || null,
        firstName,
        lastName,
      },
      message: `Welcome to HSBlood, ${firstName}! You are now registered as a donor.`,
    });
  } catch(err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      return res.status(409).json({ success: false, error: `${field === 'mobile' ? 'Mobile number' : 'Email'} already exists.` });
    }
    res.status(500).json({ success: false, error: friendlyError(err, 'OTP Register') });
  }
});

// ─── DIRECT REGISTER (OTP verified + mobile duplicate check) ──
app.post('/api/auth/register-direct', async (req, res) => {
  try {
    const { mobile, otp, username, firstName, lastName, bloodType,
            address, email, lastDonationDate } = req.body;

    // Validate mobile
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile.trim()))
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit Indian mobile number.' });

    const mob = mobile.trim();

    // Verify OTP
    if (!otp) return res.status(400).json({ success: false, error: 'OTP is required.' });
    const stored = otpStore.get(mob);
    if (!stored)            return res.status(400).json({ success: false, error: 'No OTP found for this number. Please send OTP first.' });
    if (Date.now() > stored.expiresAt) { otpStore.delete(mob); return res.status(400).json({ success: false, error: 'OTP expired. Please request a new one.' }); }
    if (stored.otp !== otp.trim())     return res.status(400).json({ success: false, error: 'Incorrect OTP. Please try again.' });
    otpStore.delete(mob);

    // Duplicate mobile check
    const existingUser = await User.findOne({ mobile: mob });
    if (existingUser)
      return res.status(409).json({ success: false, error: 'This mobile number is already registered. Please sign in with OTP instead.' });

    // Validate username
    if (!username || username.trim().length < 3)
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters.' });
    const uname = username.trim().toLowerCase();
    const existingUsername = await User.findOne({ username: uname });
    if (existingUsername)
      return res.status(409).json({ success: false, error: 'Username already taken. Please choose a different one.' });

    // Validate required fields
    if (!firstName || !lastName)
      return res.status(400).json({ success: false, error: 'First name and last name are required.' });
    if (!bloodType || !['A+','A-','B+','B-','AB+','AB-','O+','O-'].includes(bloodType))
      return res.status(400).json({ success: false, error: 'Please select a valid blood type.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });

    // Create or link Donor record
    let donor = await Donor.findOne({ phone: mob });
    if (!donor) {
      // Check email duplicate in donor collection
      const emailClash = await Donor.findOne({ email: email.trim().toLowerCase() });
      if (emailClash)
        return res.status(409).json({ success: false, error: 'This email address is already registered.' });
      donor = await Donor.create({
        firstName: firstName.trim(), lastName: lastName.trim(),
        phone: mob, email: email.trim().toLowerCase(),
        address: address ? address.trim() : '', city: 'N/A', country: 'N/A',
        bloodType, isAvailable: true,
        lastDonationDate: lastDonationDate ? new Date(lastDonationDate) : undefined,
      });
      console.log(`✅ Donor created: ${firstName} ${lastName}`);
    }

    // Create User account
    const hashedPwd = await bcrypt.hash(mob + '_reg_' + Date.now(), 10);
    const newUser = await User.create({
      username: uname, password: hashedPwd, mobile: mob,
      email: email.trim().toLowerCase(),
      bloodType,
      isAvailable: true,
      address: address ? address.trim() : '',
      lastDonationDate: lastDonationDate ? new Date(lastDonationDate) : null,
      role: 'user', donorId: donor._id,
    });

    const token = jwt.sign({ id: newUser._id, username: newUser.username, role: newUser.role }, JWT_SECRET, { expiresIn: '24h' });
    console.log(`✅ HS Employee registered → username: ${uname}, mobile: ${mob}`);

    res.status(201).json({
      success: true, token,
      user: {
        username: newUser.username, role: newUser.role, email: newUser.email || '',
        bloodType: newUser.bloodType || '', mobile: newUser.mobile || '',
        isAvailable: newUser.isAvailable, address: newUser.address || '',
        lastDonationDate: newUser.lastDonationDate || null, donorId: newUser.donorId || null,
        firstName, lastName,
      },
      message: `Welcome to HSBlood, ${firstName}!`,
    });
  } catch(err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      const msg = field === 'mobile' ? 'This mobile number is already registered.'
                : field === 'username' ? 'Username already taken. Please choose a different one.'
                : 'This email is already in use.';
      return res.status(409).json({ success: false, error: msg });
    }
    res.status(500).json({ success: false, error: friendlyError(err, 'DirectRegister') });
  }
});

// ─── UPDATE MOBILE (authenticated, OTP verified) ──────────────
app.post('/api/auth/mobile/update', authenticate, async (req, res) => {
  try {
    const { newMobile, otp } = req.body;

    if (!newMobile || !/^[6-9]\d{9}$/.test(newMobile.trim()))
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit Indian mobile number.' });

    const mob = newMobile.trim();

    // Verify OTP
    if (!otp) return res.status(400).json({ success: false, error: 'OTP is required.' });
    const stored = otpStore.get(mob);
    if (!stored)            return res.status(400).json({ success: false, error: 'No OTP found. Please send OTP first.' });
    if (Date.now() > stored.expiresAt) { otpStore.delete(mob); return res.status(400).json({ success: false, error: 'OTP expired. Please request a new one.' }); }
    if (stored.otp !== otp.trim())     return res.status(400).json({ success: false, error: 'Incorrect OTP. Please try again.' });
    otpStore.delete(mob);

    // Check duplicate — exclude self
    const clash = await User.findOne({ mobile: mob, _id: { $ne: req.user.id } });
    if (clash) return res.status(409).json({ success: false, error: 'This mobile number is already registered to another account.' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const oldMobile = user.mobile;
    user.mobile = mob;
    await user.save();

    // Sync donor record phone if linked
    if (user.donorId) {
      await Donor.findByIdAndUpdate(user.donorId, { phone: mob, updatedAt: new Date() }).catch(() => {});
    }

    console.log(`✅ Mobile updated for ${user.username}: ${oldMobile} → ${mob}`);
    res.json({ success: true, message: 'Mobile number updated successfully!' });
  } catch(err) {
    if (err.code === 11000) return res.status(409).json({ success: false, error: 'This mobile number is already registered to another account.' });
    res.status(500).json({ success: false, error: friendlyError(err, 'MobileUpdate') });
  }
});

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
      user: {
        username:         user.username,
        role:             user.role,
        email:            user.email || '',
        bloodType:        user.bloodType || '',
        isAvailable:      user.isAvailable,
        address:          user.address || '',
        lastDonationDate: user.lastDonationDate || null,
        donorId:          user.donorId || null,
      },
      message: `Welcome back, ${user.username}!`
    });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
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
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});


// ─── FORGOT PASSWORD (lookup by username + email) ─────────────
// ─── PUBLIC: Admin contact email (for Contact Support feature) ───
app.get('/api/config/admin-email', (req, res) => {
  const email = process.env.ADMIN_EMAIL || '';
  res.json({ success: true, email });
});

// ─── SET AVAILABILITY (lightweight — HS Employee only) ────────
app.post('/api/auth/availability', authenticate, async (req, res) => {
  try {
    const isAvailable = req.body.isAvailable === true || req.body.isAvailable === 'true';
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    user.isAvailable = isAvailable;
    await user.save();
    if (user.donorId) {
      await Donor.findByIdAndUpdate(user.donorId, { isAvailable, updatedAt: new Date() }).catch(() => {});
    }
    res.json({ success: true, isAvailable });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});

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
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});

// ─── CHANGE PASSWORD (authenticated — no current password required) ───────────
app.post('/api/auth/change-password', authenticate, async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;

    if (!newPassword || !confirmPassword)
      return res.status(400).json({ success: false, error: 'All fields are required.' });

    if (newPassword.length < 6)
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });

    if (newPassword !== confirmPassword)
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true, message: 'Password updated successfully!' });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});


// ─── BLOOD TYPE ROUTES ────────────────────────────────────────

app.get('/api/blood-types', authenticate, async (req, res) => {
  try {
    const types = await BloodType.find().sort('type');
    res.json({ success: true, data: types });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

app.get('/api/blood-types/:type', authenticate, async (req, res) => {
  try {
    const bt = await BloodType.findOne({ type: req.params.type.toUpperCase() });
    if (!bt) return res.status(404).json({ success: false, error: 'Blood type not found' });
    res.json({ success: true, data: bt });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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
  } catch(err) { res.status(400).json({ success: false, error: friendlyError(err, 'Validation') }); }
});

app.delete('/api/blood-types/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await BloodType.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Blood type deleted' });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// Admin only — bulk upload donors from parsed Excel data
app.post('/api/donors/bulk', authenticate, adminOnly, async (req, res) => {
  try {
    const { donors } = req.body;
    if (!Array.isArray(donors) || donors.length === 0)
      return res.status(400).json({ success: false, error: 'No donor data provided.' });

    const VALID_BLOOD_TYPES = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];

    const results = { inserted: 0, skipped: 0, errors: [] };

    for (let i = 0; i < donors.length; i++) {
      const raw = donors[i];
      const rowNum = i + 2;

      try {
        // Normalise blood type
        const bt = (raw.bloodType || '').toString().trim().toUpperCase()
          .replace('POSITIVE','+').replace('NEGATIVE','-');

        // Validate required fields (firstName, lastName, phone, bloodType only)
        if (!raw.firstName || !raw.lastName)
          throw new Error('First name and last name are required');
        if (!raw.phone)
          throw new Error('Phone is required');
        if (!VALID_BLOOD_TYPES.includes(bt))
          throw new Error(`Invalid blood type "${bt}". Must be one of: ${VALID_BLOOD_TYPES.join(', ')}`);

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

        // Email is optional — only include if provided and not empty
        const emailRaw = raw.email ? raw.email.toString().trim().toLowerCase() : null;

        const donorDoc = {
          firstName:       raw.firstName.toString().trim(),
          lastName:        raw.lastName.toString().trim(),
          phone:           raw.phone.toString().trim(),
          email:           emailRaw || undefined,
          address:         (raw.address || '').toString().trim(),
          city:            'N/A',
          country:         'N/A',
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
          phone: (raw.phone || '').toString(),
          reason: isDuplicate ? 'Phone or email already exists in registry' : (rowErr.name === 'ValidationError' ? Object.values(rowErr.errors).map(e => e.message).join('; ') : rowErr.message)
        });
      }
    }

    res.status(207).json({
      success: true,
      message: `Bulk upload complete: ${results.inserted} inserted, ${results.skipped} skipped.`,
      data: results
    });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});


app.get('/api/donors/:id', authenticate, async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id);
    if (!donor) return res.status(404).json({ success: false, error: 'Donor not found' });
    res.json({ success: true, data: donor });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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
    res.status(400).json({ success: false, error: friendlyError(err, 'Validation') });
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
  } catch(err) { res.status(400).json({ success: false, error: friendlyError(err, 'Validation') }); }
});

// Admin only — delete donor (also removes linked HS Employee user account)
app.delete('/api/donors/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id);
    if (!donor) return res.status(404).json({ success: false, error: 'Donor not found.' });

    // Find and delete the linked user account (matched by donorId or phone)
    const linkedUser = await User.findOne({
      $or: [
        { donorId: donor._id },
        { mobile: donor.phone }
      ],
      role: 'user' // never touch admin accounts
    });

    await Donor.findByIdAndDelete(req.params.id);

    let userDeleted = false;
    if (linkedUser) {
      await User.findByIdAndDelete(linkedUser._id);
      userDeleted = true;
      console.log(`🗑 User account deleted along with donor: ${linkedUser.username} (${linkedUser.mobile})`);
    }

    const message = userDeleted
      ? `Donor and linked HS Employee account (${linkedUser.username}) removed.`
      : 'Donor removed from registry.';

    res.json({ success: true, message });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// Get single requirement — both roles
app.get('/api/requirements/:id', authenticate, async (req, res) => {
  try {
    const req_ = await BloodRequirement.findById(req.params.id);
    if (!req_) return res.status(404).json({ success: false, error: 'Requirement not found' });
    res.json({ success: true, data: req_ });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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

    // Create in-app notifications — awaited so they are committed to DB before
    // the response is sent, ensuring the frontend sees them on the next fetch.
    await createInAppNotifications(req_).catch(err => console.error('In-app notification error:', err));

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
    res.status(400).json({ success: false, error: friendlyError(err, 'Validation') });
  }
});

// Update requirement — admin OR the user who created it
app.put('/api/requirements/:id', authenticate, async (req, res) => {
  try {
    const req_ = await BloodRequirement.findById(req.params.id);
    if (!req_) return res.status(404).json({ success: false, error: 'Requirement not found' });
    const isAdmin   = req.user.role === 'admin';
    const isCreator = req_.createdBy === req.user.username;
    if (!isAdmin && !isCreator) {
      return res.status(403).json({ success: false, error: 'You can only edit requirements you created.' });
    }
    req.body.updatedAt = new Date();
    const updated = await BloodRequirement.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    res.json({ success: true, data: updated, message: 'Requirement updated successfully!' });
  } catch(err) { res.status(400).json({ success: false, error: friendlyError(err, 'Validation') }); }
});

// Delete requirement — admin only
app.delete('/api/requirements/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await BloodRequirement.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Requirement deleted.' });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});


// ── MY REQUIREMENTS ──────────────────────────────────────────
app.get('/api/my-requirements', authenticate, async (req, res) => {
  try {
    const reqs = await BloodRequirement.find({ createdBy: req.user.username }).sort('-createdAt');
    const enriched = reqs.map(r => {
      const obj = r.toObject();
      obj.remainingUnits = (obj.remainingUnits != null) ? obj.remainingUnits : obj.unitsRequired;
      obj.donationsCount = (obj.donations || []).length;
      return obj;
    });
    res.json({ success: true, data: enriched, count: enriched.length });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// ── DONATE ───────────────────────────────────────────────────
app.post('/api/requirements/:id/donate', authenticate, async (req, res) => {
  try {
    const req_ = await BloodRequirement.findById(req.params.id);
    if (!req_) return res.status(404).json({ success: false, error: 'Requirement not found.' });
    if (req_.status !== 'Open') return res.status(400).json({ success: false, error: 'This requirement is no longer open.' });
    const userBT = req.user.bloodType || '';
    if (userBT && req_.bloodType !== userBT) return res.status(400).json({ success: false, error: 'Blood type mismatch. Requirement needs ' + req_.bloodType + ', your type is ' + userBT + '.' });
    if (req.user.isAvailable === false) return res.status(400).json({ success: false, error: 'You are marked unavailable. Please update your profile.' });
    if (req_.donations.some(d => d.donorUsername === req.user.username)) return res.status(400).json({ success: false, error: 'You have already responded to this requirement.' });
    const current = (req_.remainingUnits != null) ? req_.remainingUnits : req_.unitsRequired;
    if (current <= 0) return res.status(400).json({ success: false, error: 'This requirement has already been fully fulfilled.' });
    req_.donations.push({ donorUsername: req.user.username, donorName: ((req.user.firstName || '') + ' ' + (req.user.lastName || '')).trim() || req.user.username, bloodType: userBT || req_.bloodType, donatedAt: new Date(), note: req.body.note || '' });
    req_.remainingUnits = current - 1;
    if (req_.remainingUnits <= 0) { req_.remainingUnits = 0; req_.status = 'Fulfilled'; }
    req_.updatedAt = new Date();
    await req_.save();
    res.json({ success: true, message: req_.status === 'Fulfilled' ? 'This requirement is now fully fulfilled.' : 'Donation recorded! ' + req_.remainingUnits + ' unit(s) still needed.', data: { remainingUnits: req_.remainingUnits, status: req_.status } });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// ── DECLINE ──────────────────────────────────────────────────
app.post('/api/requirements/:id/decline', authenticate, async (req, res) => {
  try {
    const req_ = await BloodRequirement.findById(req.params.id);
    if (!req_) return res.status(404).json({ success: false, error: 'Requirement not found.' });
    if (!req_.declines.some(d => d.donorUsername === req.user.username)) { req_.declines.push({ donorUsername: req.user.username, declinedAt: new Date() }); await req_.save(); }
    res.json({ success: true, message: 'Response recorded.' });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// ── MY DONATIONS ─────────────────────────────────────────────
app.get('/api/my-donations', authenticate, async (req, res) => {
  try {
    const reqs = await BloodRequirement.find({ 'donations.donorUsername': req.user.username }).sort('-updatedAt');
    const history = reqs.map(r => {
      const d = r.donations.find(d => d.donorUsername === req.user.username);
      return { requirementId: r._id, patientName: r.patientName, hospital: r.hospital, location: r.location, bloodType: r.bloodType, unitsRequired: r.unitsRequired, remainingUnits: (r.remainingUnits != null) ? r.remainingUnits : r.unitsRequired, status: r.status, urgency: r.urgency, donatedAt: d ? d.donatedAt : null, note: d ? d.note : '' };
    });
    res.json({ success: true, data: history, count: history.length });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// ── REQUIREMENT DONORS (admin) ────────────────────────────────
app.get('/api/requirements/:id/donors', authenticate, adminOnly, async (req, res) => {
  try {
    const req_ = await BloodRequirement.findById(req.params.id);
    if (!req_) return res.status(404).json({ success: false, error: 'Requirement not found.' });
    res.json({ success: true, data: req_.donations || [], count: (req_.donations || []).length });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
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
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});

app.get('/api/info/:id', authenticate, async (req, res) => {
  try {
    const entry = await InfoEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: entry });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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
    res.status(400).json({ success: false, error: friendlyError(err, 'Validation') });
  }
});

// Update entry — admin only
app.put('/api/info/:id', authenticate, adminOnly, async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const entry = await InfoEntry.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!entry) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: entry, message: 'Entry updated successfully!' });
  } catch(err) { res.status(400).json({ success: false, error: friendlyError(err, 'Validation') }); }
});

// Delete entry — admin only
app.delete('/api/info/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await InfoEntry.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Entry deleted.' });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// ─── USER MANAGEMENT (admin only) ────────────────────────────

// List all users
app.get('/api/users', authenticate, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 }).lean();

    // For users missing firstName/lastName, pull from their linked Donor record
    const enriched = await Promise.all(users.map(async (u) => {
      if (!u.firstName && !u.lastName && u.donorId) {
        const donor = await Donor.findById(u.donorId, 'firstName lastName').lean();
        if (donor) {
          u.firstName = donor.firstName || '';
          u.lastName  = donor.lastName  || '';
          // Backfill the User document so it's correct next time
          await User.findByIdAndUpdate(u._id, { firstName: u.firstName, lastName: u.lastName });
        }
      }
      // Also try matching by mobile if still missing
      if (!u.firstName && !u.lastName && u.mobile) {
        const donor = await Donor.findOne({ phone: u.mobile }, 'firstName lastName').lean();
        if (donor) {
          u.firstName = donor.firstName || '';
          u.lastName  = donor.lastName  || '';
          await User.findByIdAndUpdate(u._id, { firstName: u.firstName, lastName: u.lastName });
        }
      }
      return u;
    }));

    res.json({ success: true, data: enriched });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// Create user
app.post('/api/users', authenticate, adminOnly, async (req, res) => {
  try {
    const { mobile, firstName, lastName, bloodType, email, username, password } = req.body;

    if (!mobile || !/^[6-9]\d{9}$/.test(mobile.trim()))
      return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit mobile number.' });
    if (!firstName || !lastName)
      return res.status(400).json({ success: false, error: 'First name and last name are required.' });
    if (!bloodType || !['A+','A-','B+','B-','AB+','AB-','O+','O-'].includes(bloodType))
      return res.status(400).json({ success: false, error: 'Please select a valid blood type.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    if (!username || username.trim().length < 3)
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters.' });
    if (!password || password.length < 6)
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });

    const mob   = mobile.trim();
    const uname = username.trim().toLowerCase();

    // Duplicate checks
    const mobileClash   = await User.findOne({ mobile: mob });
    if (mobileClash)  return res.status(409).json({ success: false, error: 'This mobile number is already registered.' });
    const usernameClash = await User.findOne({ username: uname });
    if (usernameClash) return res.status(409).json({ success: false, error: 'Username already taken.' });

    const hashedPwd = await bcrypt.hash(password, 10);

    // Create Donor record
    const emailClash = await Donor.findOne({ email: email.trim().toLowerCase() });
    if (emailClash) return res.status(409).json({ success: false, error: 'This email is already registered to a donor.' });
    const phoneClash = await Donor.findOne({ phone: mob });
    let donorId = null;
    if (!phoneClash) {
      const donor = await Donor.create({
        firstName: firstName.trim(), lastName: lastName.trim(),
        phone: mob, email: email.trim().toLowerCase(),
        address: '', city: 'N/A', country: 'N/A',
        bloodType, isAvailable: true,
      });
      donorId = donor._id;
      console.log(`✅ Donor created (admin-add): ${firstName} ${lastName}`);
    }

    const user = await User.create({
      username: uname, password: hashedPwd,
      mobile: mob, bloodType, role: 'user',
      email: email.trim().toLowerCase(),
      firstName: firstName.trim(), lastName: lastName.trim(),
      isAvailable: true, donorId,
    });

    res.status(201).json({
      success: true,
      message: `User "${firstName} ${lastName}" added${donorId ? ' and registered as a donor' : ''}. They can log in with OTP or username/password.`,
      data: { _id: user._id, username: user.username, firstName: user.firstName || '', lastName: user.lastName || '', mobile: user.mobile, role: user.role, bloodType: user.bloodType || '', createdAt: user.createdAt }
    });
  } catch(err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      const msg = field === 'mobile' ? 'Mobile number already registered.'
                : field === 'username' ? 'Username already taken.'
                : field === 'email' ? 'Email already registered.'
                : 'Duplicate value — please try again.';
      return res.status(409).json({ success: false, error: msg });
    }
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});

// Update user (admin only)
app.put('/api/users/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { mobile, firstName, lastName, bloodType, email, username, password } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    if (mobile !== undefined && mobile !== '') {
      if (!/^[6-9]\d{9}$/.test(mobile.trim()))
        return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit mobile number.' });
      const clash = await User.findOne({ mobile: mobile.trim(), _id: { $ne: user._id } });
      if (clash) return res.status(409).json({ success: false, error: 'This mobile number is already registered.' });
      user.mobile = mobile.trim();
    }
    if (username !== undefined && username.trim().length >= 3) {
      const uname = username.trim().toLowerCase();
      if (uname !== user.username) {
        const clash = await User.findOne({ username: uname, _id: { $ne: user._id } });
        if (clash) return res.status(409).json({ success: false, error: 'Username already taken.' });
        user.username = uname;
      }
    }
    if (email !== undefined && email.trim()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
        return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
      user.email = email.trim().toLowerCase();
    }
    if (bloodType !== undefined) user.bloodType = bloodType ? bloodType.trim() : '';
    if (firstName)               user.firstName = firstName.trim();
    if (lastName)                user.lastName  = lastName.trim();
    if (password) {
      if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
      user.password = await bcrypt.hash(password, 10);
    }
    await user.save();

    // Sync linked donor record if exists
    if (user.donorId) {
      const donorUpdate = { updatedAt: new Date() };
      if (bloodType !== undefined) donorUpdate.bloodType = user.bloodType;
      if (mobile !== undefined && mobile !== '') donorUpdate.phone = user.mobile;
      if (firstName) donorUpdate.firstName = firstName.trim();
      if (lastName)  donorUpdate.lastName  = lastName.trim();
      if (email !== undefined && email.trim()) donorUpdate.email = user.email;
      await Donor.findByIdAndUpdate(user.donorId, donorUpdate).catch(() => {});
    }

    res.json({ success: true, message: `User "${user.username}" updated.`, data: { _id: user._id, username: user.username, firstName: user.firstName || '', lastName: user.lastName || '', mobile: user.mobile || '', role: user.role, bloodType: user.bloodType || '', createdAt: user.createdAt } });
  } catch(err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      return res.status(409).json({ success: false, error: field === 'mobile' ? 'Mobile number already registered.' : field === 'username' ? 'Username already taken.' : 'Email already registered.' });
    }
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});

// Delete user (cannot delete own account)
app.delete('/api/users/:id', authenticate, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(400).json({ success: false, error: 'You cannot delete your own account.' });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    // Delete linked donor record (matched by donorId or mobile/phone)
    let donorDeleted = false;
    const linkedDonor = await Donor.findOne({
      $or: [
        ...(user.donorId ? [{ _id: user.donorId }] : []),
        ...(user.mobile  ? [{ phone: user.mobile }] : []),
      ]
    });
    if (linkedDonor) {
      await Donor.findByIdAndDelete(linkedDonor._id);
      donorDeleted = true;
      console.log(`🗑 Donor record deleted along with user: ${user.username} (donor: ${linkedDonor.firstName} ${linkedDonor.lastName})`);
    }

    await User.findByIdAndDelete(user._id);

    const message = donorDeleted
      ? `User "${user.username}" and their donor record deleted.`
      : `User "${user.username}" deleted.`;

    res.json({ success: true, message });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});

// ─── PROFILE ROUTES (any authenticated user) ─────────────────

// GET /api/auth/profile — get own profile
app.get('/api/auth/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id, '-password').lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    // Backfill firstName/lastName from linked Donor if missing on User doc
    if (!user.firstName && !user.lastName) {
      const donor = user.donorId
        ? await Donor.findById(user.donorId, 'firstName lastName').lean()
        : user.mobile
          ? await Donor.findOne({ phone: user.mobile }, 'firstName lastName').lean()
          : null;
      if (donor) {
        user.firstName = donor.firstName || '';
        user.lastName  = donor.lastName  || '';
        // Persist so future calls don't need to look up the donor
        await User.findByIdAndUpdate(user._id, { firstName: user.firstName, lastName: user.lastName });
      }
    }

    res.json({ success: true, user });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// PUT /api/auth/profile — update own profile (username, email, bloodType + donor fields)
app.put('/api/auth/profile', authenticate, async (req, res) => {
  try {
    const { firstName, lastName, username, email, bloodType, isAvailable, address, lastDonationDate } = req.body;
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

    if (firstName !== undefined && firstName.trim()) user.firstName = firstName.trim();
    if (lastName !== undefined && lastName.trim())   user.lastName  = lastName.trim();

    if (bloodType !== undefined)      user.bloodType        = bloodType ? bloodType.trim() : '';
    if (isAvailable !== undefined)    user.isAvailable      = Boolean(isAvailable);
    if (address !== undefined)        user.address          = address ? address.trim() : '';
    if (lastDonationDate !== undefined) user.lastDonationDate = lastDonationDate ? new Date(lastDonationDate) : null;

    await user.save();

    // Sync linked donor record if exists
    if (user.donorId) {
      const donorUpdate = {};
      if (firstName !== undefined && firstName.trim()) donorUpdate.firstName = user.firstName;
      if (lastName !== undefined && lastName.trim())   donorUpdate.lastName  = user.lastName;
      if (bloodType !== undefined)       donorUpdate.bloodType        = user.bloodType;
      if (isAvailable !== undefined)     donorUpdate.isAvailable      = user.isAvailable;
      if (address !== undefined)         donorUpdate.address          = user.address;
      if (lastDonationDate !== undefined) donorUpdate.lastDonationDate = user.lastDonationDate;
      if (email !== undefined)           donorUpdate.email            = user.email;
      donorUpdate.updatedAt = new Date();
      await Donor.findByIdAndUpdate(user.donorId, donorUpdate).catch(() => {});
    }

    // Return updated user (no password)
    const updated = {
      firstName:        user.firstName || '',
      lastName:         user.lastName  || '',
      username:         user.username,
      email:            user.email,
      role:             user.role,
      bloodType:        user.bloodType || '',
      isAvailable:      user.isAvailable,
      address:          user.address || '',
      lastDonationDate: user.lastDonationDate || null,
      donorId:          user.donorId || null,
    };
    res.json({ success: true, user: updated, message: 'Profile updated successfully!' });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// DELETE /api/auth/account — user deletes their own account + linked donor record
app.delete('/api/auth/account', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    // Prevent admin self-deletion via this endpoint
    if (user.role === 'admin')
      return res.status(403).json({ success: false, error: 'Admin accounts cannot be self-deleted.' });

    // Delete linked donor record (by donorId or mobile/phone match)
    let donorDeleted = false;
    if (user.donorId) {
      await Donor.findByIdAndDelete(user.donorId);
      donorDeleted = true;
    } else if (user.mobile) {
      const donor = await Donor.findOne({ phone: user.mobile });
      if (donor) { await Donor.findByIdAndDelete(donor._id); donorDeleted = true; }
    }

    // Delete all notifications for this user
    await Notification.deleteMany({ username: user.username });

    // Delete the user account
    await User.findByIdAndDelete(user._id);

    console.log(`🗑 Self-deleted: ${user.username} (mobile: ${user.mobile || 'none'}) — donor removed: ${donorDeleted}`);
    res.json({ success: true, message: 'Your account and donor record have been permanently deleted.' });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'AccountDelete') });
  }
});

// ─── NOTIFICATION ROUTES ─────────────────────────────────────

// GET /api/notifications — get notifications for current user
// Only returns notifications created AFTER the user registered,
// so newly registered users don't see pre-existing notifications.
app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    // Fetch the user's registration date to use as a lower bound
    const currentUser = await User.findById(req.user.id, 'createdAt').lean();
    const userCreatedAt = currentUser ? currentUser.createdAt : new Date(0);

    const notifications = await Notification.find({
      username:  req.user.username,
      createdAt: { $gte: userCreatedAt },
    })
      .sort('-createdAt')
      .limit(50)
      .lean();
    const unreadCount = notifications.filter(n => !n.isRead).length;
    res.json({ success: true, data: notifications, unreadCount });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});

// PUT /api/notifications/read-all — mark all as read (must be before /:id route)
app.put('/api/notifications/read-all', authenticate, async (req, res) => {
  try {
    await Notification.updateMany({ username: req.user.username, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
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
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});

// DELETE /api/notifications — clear all (must be before /:id route)
app.delete('/api/notifications', authenticate, async (req, res) => {
  try {
    await Notification.deleteMany({ username: req.user.username });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});

// DELETE /api/notifications/:id — delete one notification
app.delete('/api/notifications/:id', authenticate, async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, username: req.user.username });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'Server') });
  }
});

// ─── GLOBAL ERROR HANDLER ────────────────────────────────────
// Catches any error passed via next(err) from route handlers
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message || err);
  res.status(err.status || 500).json({ success: false, error: friendlyError(err, 'GlobalHandler') });
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
});// Appended routes — My Requirements, Donate, Decline, My Donations, Requirement Donors
