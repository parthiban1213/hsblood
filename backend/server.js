const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
require('dotenv').config();

// ── Nodemailer (support contact form) ────────────────────────
// Uses Gmail + App Password. Set these env vars on Render:
//   MAIL_USER  — the Gmail address that sends the email
//   MAIL_PASS  — Gmail App Password (not your normal password)
//               Generate at: https://myaccount.google.com/apppasswords
//   MAIL_TO    — inbox that receives support messages (defaults to ADMIN_EMAIL)
let mailTransporter = null;
const MAIL_USER = process.env.MAIL_USER || '';
const MAIL_PASS = process.env.MAIL_PASS || '';
const MAIL_TO   = process.env.MAIL_TO   || process.env.ADMIN_EMAIL || '';
if (MAIL_USER && MAIL_PASS) {
  try {
    const nodemailer = require('nodemailer');
    mailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: MAIL_USER, pass: MAIL_PASS },
    });
    console.log('✅ Nodemailer (Gmail) enabled — support emails active');
  } catch(e) {
    console.warn('⚠️  nodemailer package not found — run: npm install nodemailer');
  }
} else {
  console.log('ℹ️  MAIL_USER / MAIL_PASS not set — support email disabled');
}

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

// ── Firebase Admin SDK (FCM push notifications) ──────────────
// Set FIREBASE_SERVICE_ACCOUNT_JSON env var to the contents of
// your Firebase service account JSON, OR place the file at
// ./firebase-service-account.json on the server.
//
// To get the service account JSON:
//   Firebase Console → Project Settings → Service Accounts
//   → Generate New Private Key → download the JSON file.
//
// On Render: Settings → Environment → add secret file or env var.
let firebaseAdmin = null;
try {
  const admin = require('firebase-admin');
  let serviceAccount = null;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Env var approach (recommended for Render/cloud deployments)
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    // Local file approach (for local development)
    try {
      serviceAccount = require('./firebase-service-account.json');
    } catch (_) {}
  }

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseAdmin = admin;
    console.log('✅ Firebase Admin SDK enabled — FCM push notifications active');
  } else {
    console.log('ℹ️  Firebase Admin SDK not configured — set FIREBASE_SERVICE_ACCOUNT_JSON env var');
  }
} catch(e) {
  console.warn('⚠️  firebase-admin package not found — run: npm install firebase-admin');
}

// Helper: send FCM push to a blood-type topic
// Called when a new requirement is created.
// Topic naming matches the Flutter app: A+ → blood_A_pos, O- → blood_O_neg
async function sendFcmPushForRequirement(requirement) {
  if (!firebaseAdmin) {
    console.warn('[FCM] Skipped — Firebase Admin not initialised. Set FIREBASE_SERVICE_ACCOUNT_JSON env var.');
    return;
  }
  try {
    const { bloodType, patientName, hospital, urgency, unitsRequired, _id } = requirement;

    const topic = 'blood_' + bloodType.replaceAll('+', '_pos').replaceAll('-', '_neg');

    const urgencyLabel = urgency === 'Critical' ? '🚨 Critical'
                       : urgency === 'High'     ? '⚠️ High Priority'
                       : urgency === 'Medium'   ? '🟡 Medium'
                       : '🟢 Low';

    const title = `${urgencyLabel} — ${bloodType} Blood Needed`;
    const body  = `${unitsRequired} unit${unitsRequired !== 1 ? 's' : ''} needed for ${patientName} at ${hospital}`;

    // Build message — clickAction removed (deprecated in Firebase SDK v11+,
    // caused silent delivery failures on Android 13+).
    const buildMsg = (topicName) => ({
      topic: topicName,
      notification: { title, body },
      data: {
        type:          'requirement',
        requirementId: _id ? _id.toString() : '',
        bloodType,
      },
      android: {
        priority: 'high',
        notification: {
          channelId:            'bloodconnect_alerts',
          color:                '#C8102E',
          sound:                'default',
          notificationPriority: 'PRIORITY_HIGH',
          visibility:           'PUBLIC',
        },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    });

    await firebaseAdmin.messaging().send(buildMsg(topic));
    console.log(`🔔 FCM → topic "${topic}" for ${bloodType} requirement`);

  } catch(err) {
    // Common errors:
    //  "Requested entity was not found" = no devices subscribed to this topic yet (normal on first use)
    //  "SenderId mismatch" = wrong google-services.json on device
    //  "Invalid registration" = device uninstalled the app
    console.error('[FCM] Push error:', err.message);
  }
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

// ── GEOCODING HELPER ────────────────────────────────────────────────────────
// Auto-resolve hospital + location/city into lat/lng coordinates.
// Uses OpenStreetMap Nominatim (free, no API key required).
// Rate-limited to 1 req/sec per Nominatim policy.
// Falls back to a built-in Indian city lookup if Nominatim fails.

const INDIAN_CITY_COORDS = {
  'coimbatore':        { lat: 11.0168, lng: 76.9558 },
  'chennai':           { lat: 13.0827, lng: 80.2707 },
  'bangalore':         { lat: 12.9716, lng: 77.5946 },
  'bengaluru':         { lat: 12.9716, lng: 77.5946 },
  'mumbai':            { lat: 19.0760, lng: 72.8777 },
  'delhi':             { lat: 28.6139, lng: 77.2090 },
  'new delhi':         { lat: 28.6139, lng: 77.2090 },
  'hyderabad':         { lat: 17.3850, lng: 78.4867 },
  'pune':              { lat: 18.5204, lng: 73.8567 },
  'kolkata':           { lat: 22.5726, lng: 88.3639 },
  'ahmedabad':         { lat: 23.0225, lng: 72.5714 },
  'jaipur':            { lat: 26.9124, lng: 75.7873 },
  'lucknow':           { lat: 26.8467, lng: 80.9462 },
  'kochi':             { lat: 9.9312,  lng: 76.2673 },
  'thiruvananthapuram':{ lat: 8.5241,  lng: 76.9366 },
  'madurai':           { lat: 9.9252,  lng: 78.1198 },
  'trichy':            { lat: 10.7905, lng: 78.7047 },
  'tiruchirappalli':   { lat: 10.7905, lng: 78.7047 },
  'salem':             { lat: 11.6643, lng: 78.1460 },
  'erode':             { lat: 11.3410, lng: 77.7172 },
  'tiruppur':          { lat: 11.1085, lng: 77.3411 },
  'pollachi':          { lat: 10.6609, lng: 77.0081 },
  'mettupalayam':      { lat: 11.2990, lng: 76.9394 },
  'ooty':              { lat: 11.4102, lng: 76.6950 },
  'dindigul':          { lat: 10.3673, lng: 77.9803 },
  'thanjavur':         { lat: 10.7870, lng: 79.1378 },
  'vellore':           { lat: 12.9165, lng: 79.1325 },
  'tirunelveli':       { lat: 8.7139,  lng: 77.7567 },
  'nagercoil':         { lat: 8.1833,  lng: 77.4119 },
  'karur':             { lat: 10.9601, lng: 78.0766 },
  'namakkal':          { lat: 11.2189, lng: 78.1674 },
  'sivakasi':          { lat: 9.4533,  lng: 77.7981 },
  'virudhunagar':      { lat: 9.5850,  lng: 77.9525 },
  'ramanathapuram':    { lat: 9.3639,  lng: 78.8395 },
  'theni':             { lat: 10.0104, lng: 77.4768 },
  'mysore':            { lat: 12.2958, lng: 76.6394 },
  'mysuru':            { lat: 12.2958, lng: 76.6394 },
  'mangalore':         { lat: 12.9141, lng: 74.8560 },
  'hubli':             { lat: 15.3647, lng: 75.1240 },
  'belgaum':           { lat: 15.8497, lng: 74.4977 },
  'vizag':             { lat: 17.6868, lng: 83.2185 },
  'visakhapatnam':     { lat: 17.6868, lng: 83.2185 },
  'vijayawada':        { lat: 16.5062, lng: 80.6480 },
  'tirupati':          { lat: 13.6288, lng: 79.4192 },
  'indore':            { lat: 22.7196, lng: 75.8577 },
  'bhopal':            { lat: 23.2599, lng: 77.4126 },
  'nagpur':            { lat: 21.1458, lng: 79.0882 },
  'surat':             { lat: 21.1702, lng: 72.8311 },
  'vadodara':          { lat: 22.3072, lng: 73.1812 },
  'rajkot':            { lat: 22.3039, lng: 70.8022 },
  'chandigarh':        { lat: 30.7333, lng: 76.7794 },
  'patna':             { lat: 25.6093, lng: 85.1376 },
  'ranchi':            { lat: 23.3441, lng: 85.3096 },
  'guwahati':          { lat: 26.1445, lng: 91.7362 },
  'bhubaneswar':       { lat: 20.2961, lng: 85.8245 },
};

/**
 * Geocode a hospital + location string into { latitude, longitude, city }.
 * Strategy:
 *   1. Try Nominatim with "hospital, location, India"
 *   2. Try Nominatim with just "location, India"  (in case hospital name is too specific)
 *   3. Fallback to built-in city coordinate lookup
 *
 * Returns { latitude, longitude, city } or null if all methods fail.
 * This function is intentionally non-blocking and failure-tolerant.
 */
async function geocodeLocation(hospital, location) {
  const loc = (location || '').trim();
  const hosp = (hospital || '').trim();
  if (!hosp && !loc) return null;

  // Try Nominatim geocoding
  const queries = [];
  if (hosp && loc) queries.push(`${hosp}, ${loc}, India`);
  if (loc) queries.push(`${loc}, India`);
  if (hosp) queries.push(`${hosp}, India`);

  for (const q of queries) {
    try {
      const result = await nominatimGeocode(q);
      if (result) {
        // Extract city from the location/address fields
        const city = extractCityFromLocation(loc) || '';
        return { latitude: result.lat, longitude: result.lng, city };
      }
    } catch (err) {
      console.error(`[Geocode] Nominatim failed for "${q}":`, err.message);
    }
  }

  // Fallback: try matching location text against known city names
  const cityMatch = findCityInText(loc || hosp);
  if (cityMatch) {
    console.log(`[Geocode] Fallback city match: "${cityMatch.name}" for "${loc || hosp}"`);
    return { latitude: cityMatch.lat, longitude: cityMatch.lng, city: cityMatch.name };
  }

  console.warn(`[Geocode] Could not geocode: hospital="${hosp}", location="${loc}"`);
  return null;
}

/**
 * Query OpenStreetMap Nominatim for coordinates.
 * Returns { lat, lng } or null.
 */
async function nominatimGeocode(query) {
  try {
    // Use global fetch (Node 18+) or fallback to node-fetch
    const fetchFn = typeof fetch !== 'undefined' ? fetch : (() => {
      try { return require('node-fetch'); } catch(_) { return null; }
    })();
    if (!fetchFn) {
      console.warn('[Geocode] No fetch available. Install node-fetch for Node < 18.');
      return null;
    }

    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=in`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetchFn(url, {
      headers: { 'User-Agent': 'BloodConnect-HSBlood/1.0 (blood-donation-platform)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.length === 0) return null;

    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (isNaN(lat) || isNaN(lng)) return null;

    console.log(`[Geocode] Nominatim resolved "${query}" → ${lat}, ${lng}`);
    return { lat, lng };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[Geocode] Nominatim timeout for "${query}"`);
    }
    return null;
  }
}

/**
 * Search for a known Indian city name inside a text string.
 * Returns { name, lat, lng } or null.
 */
function findCityInText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  // Sort city names by length desc so "new delhi" matches before "delhi"
  const sorted = Object.keys(INDIAN_CITY_COORDS).sort((a, b) => b.length - a.length);
  for (const city of sorted) {
    if (lower.includes(city)) {
      const coords = INDIAN_CITY_COORDS[city];
      // Return properly capitalized city name
      const name = city.charAt(0).toUpperCase() + city.slice(1);
      return { name, lat: coords.lat, lng: coords.lng };
    }
  }
  return null;
}

/**
 * Extract the most likely city name from a location string.
 * E.g., "RS Puram, Coimbatore" → "Coimbatore"
 *        "Coimbatore" → "Coimbatore"
 */
function extractCityFromLocation(location) {
  if (!location) return '';
  const lower = location.toLowerCase().trim();
  const sorted = Object.keys(INDIAN_CITY_COORDS).sort((a, b) => b.length - a.length);
  for (const city of sorted) {
    if (lower.includes(city)) {
      return city.charAt(0).toUpperCase() + city.slice(1);
    }
  }
  // If no known city found, use the last comma-separated segment
  // (commonly the city in addresses like "Street, Area, City")
  const parts = location.split(',').map(p => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

/**
 * Geocode and update a saved BloodRequirement document in the background.
 * Non-blocking — failures are logged but never surface to the user.
 */
async function geocodeAndUpdateRequirement(requirementId, hospital, location) {
  try {
    const geo = await geocodeLocation(hospital, location);
    if (!geo) return;

    const update = {};
    if (geo.latitude != null)  update.latitude  = geo.latitude;
    if (geo.longitude != null) update.longitude = geo.longitude;
    if (geo.city)              update.city      = geo.city;

    if (Object.keys(update).length > 0) {
      await BloodRequirement.findByIdAndUpdate(requirementId, update);
      console.log(`[Geocode] Updated requirement ${requirementId}: ${geo.latitude}, ${geo.longitude} (${geo.city})`);
    }
  } catch (err) {
    console.error(`[Geocode] Background update failed for ${requirementId}:`, err.message);
  }
}
// ─────────────────────────────────────────────────────────────────────────────
async function createInAppNotifications(requirement) {
  try {
    const { bloodType, patientName, hospital, location, unitsRequired, urgency, _id, createdBy } = requirement;

    // Notify users (not admins) whose blood type matches, are available, and are not the requester.
    // Use $ne: false for isAvailable so users without the field set still get notified.
    const matchingUsers = await User.find({
      role:        'user',
      bloodType:   bloodType,
      isAvailable: { $ne: false },
      username:    { $ne: createdBy },
    }, 'username').lean();

    console.log(`[Notifications] bloodType=${bloodType}, createdBy=${createdBy}, matchingUsers=${matchingUsers.length}`);
    if (!matchingUsers.length) return;

    const urgencyLabel = urgency === 'Critical' ? '🚨 Critical' :
                         urgency === 'High'     ? '⚠️ High Priority' :
                         urgency === 'Medium'   ? '🟡 Medium' : '🟢 Low';

    const title   = `${urgencyLabel} — ${bloodType} Blood Needed`;
    const message = `${unitsRequired} unit${unitsRequired !== 1 ? 's' : ''} of ${bloodType} needed for ${patientName} at ${hospital}${location ? ', ' + location : ''}.`;

    const notifications = matchingUsers.map(u => ({
      username:      u.username,
      type:          'requirement',
      title,
      message,
      bloodType,
      requirementId: _id,
      isRead:        false,
    }));

    await Notification.insertMany(notifications);
    console.log(`🔔 Created ${notifications.length} notification(s) for ${bloodType} requirement (available users only)`);
  } catch(err) {
    console.error('Notification creation error:', err.message);
  }
}

// notifyMatchingDonors removed — SMS alerts to donors are disabled.
// Donors are notified via FCM push notifications and in-app notifications only.

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
  mobile:           { type: String, default: null, trim: true, unique: true, sparse: true },
  isAvailable:      { type: Boolean, default: true },
  address:          { type: String, default: '', trim: true },
  city:             { type: String, default: '', trim: true },
  country:          { type: String, default: '', trim: true },
  lastDonationDate: { type: Date, default: null },
  firstName:        { type: String, default: '', trim: true },
  lastName:         { type: String, default: '', trim: true },
  fcmToken:         { type: String, default: '' },
  createdAt:        { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);
// ── Helper: convert a User doc to the "donor" shape the frontend expects ──────
// The frontend donor screens use phone/firstName/lastName — we map from User fields.
function userToDonor(u) {
  return {
    _id:             u._id,
    firstName:       u.firstName  || '',
    lastName:        u.lastName   || '',
    email:           u.email      || '',
    phone:           u.mobile     || '',   // mobile → phone
    address:         u.address    || '',
    city:            u.city       || '',
    country:         u.country    || '',
    bloodType:       u.bloodType  || '',
    isAvailable:     u.isAvailable !== false,
    lastDonationDate:u.lastDonationDate || null,
    createdAt:       u.createdAt,
    updatedAt:       u.updatedAt  || u.createdAt,
    username:        u.username,
    role:            u.role,
  };
}


// OTP Store (in-memory; for production use Redis or a DB collection)
const otpStore = new Map(); // key: mobile → { otp, expiresAt, purpose }

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTP(mobile, otp) {
  if (twilioClient && TWILIO_FROM) {
    let phone = mobile.replace(/[\s\-()]/g, '');
    if (!phone.startsWith('+')) phone = '+91' + phone;
    try {
      await twilioClient.messages.create({
        body: `Your HSBlood OTP is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`,
        from: TWILIO_FROM,
        to:   phone,
      });
      console.log(`📱 OTP sent to ${phone}`);
    } catch (twilioErr) {
      console.error(`[Twilio] Failed to send OTP to ${phone}:`, twilioErr.message);
      throw new Error(`Could not send OTP via SMS. Twilio error: ${twilioErr.message}`);
    }
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

// Blood Requirement
const bloodRequirementSchema = new mongoose.Schema({
  patientName:    { type: String, required: true, trim: true },
  hospital:       { type: String, required: true, trim: true },
  location:       { type: String, default: '', trim: true },
  city:           { type: String, default: '', trim: true },
  latitude:       { type: Number, default: null },
  longitude:      { type: Number, default: null },
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
    donorUsername:  { type: String, required: true },
    donorName:      { type: String, default: '' },
    bloodType:      { type: String, default: '' },
    donatedAt:      { type: Date, default: Date.now },
    note:           { type: String, default: '' },
    scheduledDate:  { type: String, default: '' },
    scheduledTime:  { type: String, default: '' },
    donationStatus: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' }
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
    // ── Migration: fix existing '' mobile/email to null so sparse index works ──
    const mobileFixed = await User.updateMany(
      { mobile: '' }, { $set: { mobile: null } }
    );
    if (mobileFixed.modifiedCount > 0)
      console.log(`🔧 Migrated ${mobileFixed.modifiedCount} user(s): mobile '' → null`);

    const emailFixed = await User.updateMany(
      { email: '' }, { $set: { email: null } }
    );
    if (emailFixed.modifiedCount > 0)
      console.log(`🔧 Migrated ${emailFixed.modifiedCount} user(s): email '' → null`);

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

    // Check if mobile is registered
    const existingUser = await User.findOne({ mobile: mob }).lean();

    // Block login attempts for unregistered numbers
    if (purpose !== 'register' && !existingUser) {
      return res.status(404).json({
        success: false,
        error: 'No account found for this mobile number. Please register first.',
      });
    }

    // Block register attempts for already-registered numbers
    if (purpose === 'register' && existingUser) {
      return res.status(409).json({
        success: false,
        error: 'This mobile number is already registered. Please login instead.',
        isExistingUser: true,
      });
    }

    const otp = generateOTP();
    otpStore.set(mob, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });

    await sendOTP(mob, otp);

    res.json({
      success: true,
      message: 'OTP sent successfully! Check your mobile.',
      isExistingUser: !!existingUser,
    });
  } catch(err) {
    console.error('[OTP Send]', err.message);
    res.status(500).json({ success: false, error: err.message || friendlyError(err, 'OTP Send') });
  }
});
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
      return res.status(404).json({
        success: false,
        error: 'No account found for this mobile number. Please register first.',
        notRegistered: true,
      });
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

// ── FCM TOKEN — save/update device token for targeted pushes ──
// POST /api/auth/fcm-token
app.post('/api/auth/fcm-token', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || token.trim().length < 10)
      return res.status(400).json({ success: false, error: 'Invalid FCM token.' });

    await User.findByIdAndUpdate(req.user.id, { fcmToken: token.trim() });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: friendlyError(err, 'FCMToken') });
  }
});

// ─── BLOOD TYPE ROUTES ────────────────────────────────────────

    const VALID_BT = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
    if (!VALID_BT.includes(bloodType))
      return res.status(400).json({ success: false, error: 'Invalid blood type.' });

    // Check duplicate mobile
    const existingUser = await User.findOne({ mobile: mob });
    if (existingUser)
      return res.status(409).json({ success: false, error: 'An account with this mobile number already exists. Please log in.' });

    // Create user account (single record — no separate Donor table)
    const autoUsername = `hs_${mob.slice(-6)}_${Date.now().toString().slice(-4)}`;
    const hashedPwd = await bcrypt.hash(mob + '_reg_' + Date.now(), 10);
    const newUser = await User.create({
      username:         autoUsername,
      password:         hashedPwd,
      mobile:           mob,
      email:            email ? email.trim().toLowerCase() : null,
      firstName:        firstName.trim(),
      lastName:         lastName.trim(),
      bloodType,
      isAvailable:      isAvailable !== false,
      address:          address ? address.trim() : '',
      lastDonationDate: lastDonationDate ? new Date(lastDonationDate) : null,
      role:             'user',
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
            address, city, email, lastDonationDate } = req.body;

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
    // Email is optional — validate only when provided
    if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });

    // Create User account (single record — no separate Donor table)
    const hashedPwd = await bcrypt.hash(mob + '_reg_' + Date.now(), 10);
    const newUser = await User.create({
      username: uname, password: hashedPwd, mobile: mob,
      email: email ? email.trim().toLowerCase() : null,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      bloodType,
      isAvailable: true,
      address: address ? address.trim() : '',
      city: city ? city.trim() : '',
      lastDonationDate: lastDonationDate ? new Date(lastDonationDate) : null,
      role: 'user',
    });

    const token = jwt.sign({ id: newUser._id, username: newUser.username, role: newUser.role }, JWT_SECRET, { expiresIn: '24h' });
    console.log(`✅ HS Employee registered → username: ${uname}, mobile: ${mob}`);

    res.status(201).json({
      success: true, token,
      user: {
        username: newUser.username, role: newUser.role, email: newUser.email || '',
        bloodType: newUser.bloodType || '', mobile: newUser.mobile || '',
        isAvailable: newUser.isAvailable, address: newUser.address || '',
        city: newUser.city || '',
        lastDonationDate: newUser.lastDonationDate || null,
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

    // No separate Donor record to sync — mobile is stored directly on User.

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
        mobile:           user.mobile || '',
        firstName:        user.firstName || '',
        lastName:         user.lastName || '',
        isAvailable:      user.isAvailable,
        address:          user.address || '',
        lastDonationDate: user.lastDonationDate || null,
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
      email:     email ? email.trim().toLowerCase() : null,
      role:      'user',
      bloodType: req.body.bloodType ? req.body.bloodType.trim() : '',
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
    // No separate Donor record to sync — isAvailable stored directly on User.
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

// ── GET /api/donors — list all user-donors ─────────────────────────────────
app.get('/api/donors', authenticate, async (req, res) => {
  try {
    const filter = { role: 'user' };
    if (req.query.bloodType) filter.bloodType = req.query.bloodType;
    if (req.query.available !== undefined && req.query.available !== '')
      filter.isAvailable = req.query.available === 'true';
    if (req.query.email) filter.email = req.query.email.trim().toLowerCase();
    const users = await User.find(filter, '-password').sort('-createdAt').lean();
    res.json({ success: true, data: users.map(userToDonor), count: users.length });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// Admin only — bulk upload donors from Excel (creates User records)
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
        const bt = (raw.bloodType || '').toString().trim().toUpperCase()
          .replace('POSITIVE','+').replace('NEGATIVE','-');
        if (!raw.firstName || !raw.lastName)
          throw new Error('First name and last name are required');
        if (!raw.phone)
          throw new Error('Phone is required');
        if (!VALID_BLOOD_TYPES.includes(bt))
          throw new Error(`Invalid blood type "${bt}"`);

        let lastDonationDate;
        if (raw.lastDonationDate) {
          lastDonationDate = typeof raw.lastDonationDate === 'number'
            ? new Date(Math.round((raw.lastDonationDate - 25569) * 86400 * 1000))
            : new Date(raw.lastDonationDate);
          if (isNaN(lastDonationDate.getTime())) lastDonationDate = undefined;
        }

        const phone  = raw.phone.toString().trim();
        const email  = raw.email ? raw.email.toString().trim().toLowerCase() : null;
        const uname  = 'donor_' + phone.replace(/\D/g,'').slice(-8) + '_' + Date.now().toString().slice(-4);
        const hashed = await bcrypt.hash(phone + '_bulk_' + Date.now(), 10);

        // Check duplicate by mobile
        const clash = await User.findOne({ mobile: phone });
        if (clash) throw new Error('Phone already registered');

        await User.create({
          username:        uname,
          password:        hashed,
          mobile:          phone,
          email,
          firstName:       raw.firstName.toString().trim(),
          lastName:        raw.lastName.toString().trim(),
          address:         (raw.address || '').toString().trim(),
          city:            (raw.city    || '').toString().trim(),
          country:         (raw.country || '').toString().trim(),
          bloodType:       bt,
          isAvailable:     String(raw.isAvailable).toLowerCase() !== 'false',
          lastDonationDate,
          role:            'user',
        });
        results.inserted++;
      } catch(rowErr) {
        const isDuplicate = rowErr.code === 11000 || rowErr.message.includes('already registered');
        results.skipped++;
        results.errors.push({
          row: rowNum,
          phone: (raw.phone || '').toString(),
          reason: isDuplicate ? 'Phone already exists in registry' : rowErr.message,
        });
      }
    }

    res.status(207).json({
      success: true,
      message: `Bulk upload complete: ${results.inserted} inserted, ${results.skipped} skipped.`,
      data: results,
    });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// GET /api/donors/:id — get single donor (user)
app.get('/api/donors/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id, '-password').lean();
    if (!user) return res.status(404).json({ success: false, error: 'Donor not found' });
    res.json({ success: true, data: userToDonor(user) });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// POST /api/donors — register a donor (creates a User record)
app.post('/api/donors', authenticate, async (req, res) => {
  try {
    const phone = (req.body.phone || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();

    if (phone) {
      const clash = await User.findOne({ mobile: phone });
      if (clash) return res.status(409).json({ success: false, error: `A donor with phone "${phone}" is already registered.` });
    }
    if (email) {
      const clash = await User.findOne({ email });
      if (clash) return res.status(409).json({ success: false, error: `A donor with email "${email}" is already registered.` });
    }

    const uname  = 'donor_' + (phone || Date.now().toString()).replace(/\D/g,'').slice(-8) + '_' + Date.now().toString().slice(-4);
    const hashed = await bcrypt.hash((phone || uname) + '_reg_' + Date.now(), 10);
    const bt     = (req.body.bloodType || '').trim();

    const user = await User.create({
      username:        uname,
      password:        hashed,
      mobile:          phone || null,
      email:           email || null,
      firstName:       (req.body.firstName || '').trim(),
      lastName:        (req.body.lastName  || '').trim(),
      address:         (req.body.address   || '').trim(),
      city:            (req.body.city      || '').trim(),
      country:         (req.body.country   || '').trim(),
      bloodType:       bt,
      isAvailable:     req.body.isAvailable !== false && req.body.isAvailable !== 'false',
      lastDonationDate:req.body.lastDonationDate ? new Date(req.body.lastDonationDate) : null,
      role:            'user',
    });

    res.status(201).json({ success: true, data: userToDonor(user), message: 'Donor registered successfully!' });
  } catch(err) {
    if (err.code === 11000) return res.status(409).json({ success: false, error: 'A donor with this phone or email already exists.' });
    res.status(400).json({ success: false, error: friendlyError(err, 'Validation') });
  }
});

// PUT /api/donors/:id — update donor (admin only)
app.put('/api/donors/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const updates = {};
    if (req.body.firstName       !== undefined) updates.firstName        = req.body.firstName.trim();
    if (req.body.lastName        !== undefined) updates.lastName         = req.body.lastName.trim();
    if (req.body.phone           !== undefined) updates.mobile           = req.body.phone.trim();
    if (req.body.email           !== undefined) updates.email            = req.body.email.trim().toLowerCase();
    if (req.body.address         !== undefined) updates.address          = req.body.address.trim();
    if (req.body.city            !== undefined) updates.city             = req.body.city.trim();
    if (req.body.country         !== undefined) updates.country          = req.body.country.trim();
    if (req.body.bloodType       !== undefined) updates.bloodType        = req.body.bloodType.trim();
    if (req.body.isAvailable     !== undefined) updates.isAvailable      = req.body.isAvailable !== false && req.body.isAvailable !== 'false';
    if (req.body.lastDonationDate !== undefined) updates.lastDonationDate = req.body.lastDonationDate ? new Date(req.body.lastDonationDate) : null;

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true }).lean();
    if (!user) return res.status(404).json({ success: false, error: 'Donor not found' });
    res.json({ success: true, data: userToDonor(user), message: 'Donor updated successfully!' });
  } catch(err) { res.status(400).json({ success: false, error: friendlyError(err, 'Validation') }); }
});

// DELETE /api/donors/:id — delete donor/user (admin only)
app.delete('/api/donors/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'Donor not found.' });
    if (user.role === 'admin') return res.status(403).json({ success: false, error: 'Cannot delete an admin account from the donor screen.' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: `Donor "${user.firstName} ${user.lastName}" removed.` });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// Both roles — stats
app.get('/api/stats', authenticate, async (req, res) => {
  try {
    const totalDonors     = await User.countDocuments({ role: 'user' });
    const availableDonors = await User.countDocuments({ role: 'user', isAvailable: { $ne: false } });
    const byBloodType     = await User.aggregate([
      { $match: { role: 'user', bloodType: { $ne: '' } } },
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

    // City-based filtering (fallback when no GPS coords)
    if (req.query.city) {
      filter.city = { $regex: new RegExp(req.query.city.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i') };
    }

    // Pagination
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const skip  = (page - 1) * limit;

    const total = await BloodRequirement.countDocuments(filter);
    let reqs = await BloodRequirement.find(filter).sort('-createdAt').skip(skip).limit(limit);

    // Location-based distance calculation (if user provides lat/lng)
    const userLat = parseFloat(req.query.latitude);
    const userLng = parseFloat(req.query.longitude);
    const maxDistKm = parseFloat(req.query.maxDistance) || null; // optional max radius in km

    let results = reqs.map(r => r.toObject());

    if (!isNaN(userLat) && !isNaN(userLng)) {
      // Haversine distance calculation
      const toRad = deg => deg * Math.PI / 180;
      const haversine = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // Earth radius in km
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      results = results.map(r => {
        if (r.latitude != null && r.longitude != null) {
          r.distanceKm = Math.round(haversine(userLat, userLng, r.latitude, r.longitude) * 10) / 10;
        } else {
          r.distanceKm = null;
        }
        return r;
      });

      // Filter by max distance if specified
      if (maxDistKm) {
        results = results.filter(r => r.distanceKm === null || r.distanceKm <= maxDistKm);
      }

      // Sort by distance (nearest first), nulls last
      results.sort((a, b) => {
        if (a.distanceKm == null && b.distanceKm == null) return 0;
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      });
    }

    res.json({
      success: true,
      data: results,
      count: results.length,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
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

    // Auto-geocode hospital + location → lat/lng in background (non-blocking).
    // The requirement is saved immediately; coordinates are updated asynchronously.
    const location = (req.body.location || '').trim();
    geocodeAndUpdateRequirement(req_._id, hospital, location)
      .catch(err => console.error('[Geocode] Background geocode error:', err.message));

    // Create in-app notifications — awaited so they are committed to DB before
    // the response is sent, ensuring the frontend sees them on the next fetch.
    await createInAppNotifications(req_).catch(err => console.error('In-app notification error:', err));

    // Send FCM push notification to matching blood-type topic only
    // Runs in background — does not block the response.
    sendFcmPushForRequirement(req_).catch(err => console.error('FCM push error:', err));

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
    // If hospital or location changed, clear old coords so they get re-geocoded
    const hospitalChanged  = req.body.hospital  && req.body.hospital  !== req_.hospital;
    const locationChanged  = req.body.location !== undefined && req.body.location !== req_.location;
    if (hospitalChanged || locationChanged) {
      // Clear stale coordinates — they'll be updated by background geocoding
      if (!req.body.latitude)  req.body.latitude  = null;
      if (!req.body.longitude) req.body.longitude = null;
    }
    const updated = await BloodRequirement.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });

    // Re-geocode in background if hospital or location changed
    if (hospitalChanged || locationChanged) {
      const newHospital = (req.body.hospital || updated.hospital || '').trim();
      const newLocation = (req.body.location !== undefined ? req.body.location : updated.location || '').trim();
      geocodeAndUpdateRequirement(updated._id, newHospital, newLocation)
        .catch(err => console.error('[Geocode] Background re-geocode error:', err.message));
    }

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

// ── GEOCODE BACKFILL — admin only ─────────────────────────────
// POST /api/requirements/geocode-backfill
// Geocodes all existing requirements that have no coordinates.
// Respects Nominatim's 1-request-per-second rate limit.
// Safe to call multiple times — only processes requirements with latitude=null.
app.post('/api/requirements/geocode-backfill', authenticate, adminOnly, async (req, res) => {
  try {
    const reqs = await BloodRequirement.find({
      $or: [{ latitude: null }, { latitude: { $exists: false } }]
    }).select('_id hospital location');

    if (reqs.length === 0) {
      return res.json({ success: true, message: 'All requirements already have coordinates.', processed: 0 });
    }

    // Process in background — respond immediately with count
    res.json({
      success: true,
      message: `Geocoding ${reqs.length} requirements in background. This may take ~${Math.ceil(reqs.length * 1.2)} seconds.`,
      queued: reqs.length,
    });

    // Background processing with 1.2s delay between calls (Nominatim rate limit)
    let success = 0, failed = 0;
    for (const r of reqs) {
      try {
        await geocodeAndUpdateRequirement(r._id, r.hospital || '', r.location || '');
        success++;
      } catch (err) {
        failed++;
        console.error(`[Backfill] Failed ${r._id}:`, err.message);
      }
      // Rate limit: Nominatim requires max 1 request per second
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    console.log(`[Backfill] Complete: ${success} geocoded, ${failed} failed out of ${reqs.length}`);
  } catch(err) {
    // If response already sent, just log
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: friendlyError(err, 'GeoBackfill') });
    } else {
      console.error('[Backfill] Error after response sent:', err.message);
    }
  }
});


// ── MY REQUIREMENTS ──────────────────────────────────────────
app.get('/api/my-requirements', authenticate, async (req, res) => {
  try {
    const reqs = await BloodRequirement.find({ createdBy: req.user.username }).sort('-createdAt');
    const enriched = reqs.map(r => {
      const obj = r.toObject();
      obj.remainingUnits = (obj.remainingUnits != null) ? obj.remainingUnits : obj.unitsRequired;
      obj.donationsCount = (obj.donations || []).filter(d => d.donationStatus === 'Completed').length;
      obj.pendingCount   = (obj.donations || []).filter(d => (d.donationStatus || 'Pending') === 'Pending').length;
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
    // Fetch full user from DB — JWT only contains id/username/role, not bloodType/isAvailable/name
    const fullUser = await User.findById(req.user.id || req.user._id).lean();
    if (!fullUser) return res.status(401).json({ success: false, error: 'User not found. Please log in again.' });
    const userBT = fullUser.bloodType || '';
    if (userBT && req_.bloodType !== userBT) return res.status(400).json({ success: false, error: 'Blood type mismatch. Requirement needs ' + req_.bloodType + ', your type is ' + userBT + '.' });
    if (fullUser.isAvailable === false) return res.status(400).json({ success: false, error: 'You are marked unavailable. Please update your profile.' });
    if (req_.donations.some(d => d.donorUsername === req.user.username)) return res.status(400).json({ success: false, error: 'You have already responded to this requirement.' });
    // NOTE: No 90-day restriction on pledging — the restriction is enforced on the frontend
    // based on lastDonationDate, which is only updated when a donation is marked Completed.
    const donorName = ((fullUser.firstName || '') + ' ' + (fullUser.lastName || '')).trim() || req.user.username;
    req_.donations.push({ donorUsername: req.user.username, donorName, bloodType: userBT || req_.bloodType, donatedAt: new Date(), note: req.body.note || '', scheduledDate: req.body.scheduledDate || '', scheduledTime: req.body.scheduledTime || '', donationStatus: 'Pending' });
    // NOTE: remainingUnits and status are NOT changed here.
    // They are updated only when the requester marks the donation as Completed.
    req_.updatedAt = new Date();
    await req_.save();

    // NOTE: lastDonationDate is NOT updated here.
    // It is updated only when the requester marks the donation as Completed.

    res.json({ success: true, message: req_.status === 'Fulfilled' ? 'This requirement is now fully fulfilled.' : 'Donation recorded! ' + req_.remainingUnits + ' unit(s) still needed.', data: { remainingUnits: req_.remainingUnits, status: req_.status } });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// ── NOTIFY REQUESTER OF PLEDGE ──────────────────────────────
// POST /api/requirements/:id/notify-pledge
// Called by the Flutter app right after a donor pledges.
// Sends an in-app notification + FCM push directly to the
// requirement creator so they know immediately that someone responded.
app.post('/api/requirements/:id/notify-pledge', authenticate, async (req, res) => {
  try {
    const req_ = await BloodRequirement.findById(req.params.id).lean();
    if (!req_) return res.status(404).json({ success: false, error: 'Requirement not found.' });

    const requesterUsername = req_.createdBy;
    if (!requesterUsername) return res.json({ success: true }); // no requester to notify

    // Don't notify if the requester is pledging to their own request
    if (requesterUsername === req.user.username) return res.json({ success: true });

    const donorName = req.user.username; // fallback; real name looked up below
    const fullDonor = await User.findById(req.user.id).lean();
    const donorDisplayName = fullDonor
      ? (((fullDonor.firstName || '') + ' ' + (fullDonor.lastName || '')).trim() || req.user.username)
      : req.user.username;

    const title   = `🩸 New Donor for ${req_.patientName}`;
    const message = `${donorDisplayName} has pledged to donate ${req_.bloodType} blood at ${req_.hospital}. Open the app to review.`;

    // 1. Create in-app notification for the requester
    await Notification.create({
      username:      requesterUsername,
      type:          'pledge',
      title,
      message,
      bloodType:     req_.bloodType,
      requirementId: req_._id,
      isRead:        false,
    });
    console.log(`🔔 In-app pledge notification created for requester: ${requesterUsername}`);

    // 2. Send FCM push directly to the requester's device token (if available)
    if (firebaseAdmin) {
      const requesterUser = await User.findOne({ username: requesterUsername }, 'fcmToken').lean();
      const fcmToken = requesterUser?.fcmToken;

      if (fcmToken && fcmToken.trim().length > 10) {
        try {
          await firebaseAdmin.messaging().send({
            token: fcmToken,
            notification: { title, body: message },
            data: {
              type:          'pledge',
              requirementId: req_._id.toString(),
              bloodType:     req_.bloodType,
            },
            android: {
              priority: 'high',
              notification: {
                channelId:            'bloodconnect_alerts',
                color:                '#C8102E',
                sound:                'default',
                notificationPriority: 'PRIORITY_HIGH',
                visibility:           'PUBLIC',
              },
            },
            apns: {
              headers: { 'apns-priority': '10' },
              payload: { aps: { sound: 'default', badge: 1 } },
            },
          });
          console.log(`🔔 FCM pledge push sent to requester: ${requesterUsername}`);
        } catch(fcmErr) {
          // Non-fatal — log and continue
          console.error('[FCM] Pledge push error:', fcmErr.message);
        }
      } else {
        console.log(`[Pledge Notify] Requester ${requesterUsername} has no FCM token — in-app only`);
      }
    }

    res.json({ success: true, message: 'Requester notified.' });
  } catch(err) {
    // Never block the donor's pledge flow — respond 200 even on error
    console.error('[notify-pledge]', err.message);
    res.status(500).json({ success: false, error: friendlyError(err, 'NotifyPledge') });
  }
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
      return { requirementId: r._id, patientName: r.patientName, hospital: r.hospital, location: r.location, bloodType: r.bloodType, unitsRequired: r.unitsRequired, remainingUnits: (r.remainingUnits != null) ? r.remainingUnits : r.unitsRequired, status: r.status, urgency: r.urgency, donatedAt: d ? d.donatedAt : null, note: d ? d.note : '', scheduledDate: d ? (d.scheduledDate || '') : '', scheduledTime: d ? (d.scheduledTime || '') : '', donationStatus: d ? (d.donationStatus || 'Pending') : 'Pending', donorUsername: d ? d.donorUsername : '' };
    });
    res.json({ success: true, data: history, count: history.length });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// ── REQUIREMENT DONORS (admin or requester) ──────────────────────────────────
app.get('/api/requirements/:id/donors', authenticate, async (req, res) => {
  try {
    const req_ = await BloodRequirement.findById(req.params.id);
    if (!req_) return res.status(404).json({ success: false, error: 'Requirement not found.' });
    const isAdmin_    = req.user.role === 'admin';
    const isRequester = req_.createdBy === req.user.username;
    if (!isAdmin_ && !isRequester)
      return res.status(403).json({ success: false, error: 'Only the requester or admin can view this.' });
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

        const bulkLocation = (raw.location || '').toString().trim();
        const created = await BloodRequirement.create({
          patientName,
          hospital,
          location:      bulkLocation,
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
        // Background geocode — non-blocking, tolerates failures
        geocodeAndUpdateRequirement(created._id, hospital, bulkLocation)
          .catch(err => console.error(`[Geocode] Bulk row ${rowNum} error:`, err.message));
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

    res.json({ success: true, data: users });
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
    // Email is optional — validate only when provided
    if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
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

    const user = await User.create({
      username: uname, password: hashedPwd,
      mobile: mob, bloodType, role: 'user',
      email: email.trim().toLowerCase(),
      firstName: firstName.trim(), lastName: lastName.trim(),
      isAvailable: true,
    });

    res.status(201).json({
      success: true,
      message: `User "${firstName} ${lastName}" added. They can log in with OTP or username/password.`,
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

    // No separate Donor record to sync — all fields stored directly on User.

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

    await User.findByIdAndDelete(user._id);
    res.json({ success: true, message: `User "${user.username}" deleted.` });
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
      const userFilter = { role: 'user' };
      if (donorFilter.bloodType)   userFilter.bloodType   = donorFilter.bloodType;
      if (donorFilter.isAvailable !== undefined) userFilter.isAvailable = donorFilter.isAvailable;
      if (donorFilter.createdAt)   userFilter.createdAt   = donorFilter.createdAt;
      const donors = await User.find(userFilter, '-password').sort('-createdAt').lean();
      result.donors = donors.map(d => ({
        'First Name':    d.firstName || '',
        'Last Name':     d.lastName  || '',
        'Email':         d.email     || '',
        'Phone':         d.mobile    || '',
        'Blood Type':    d.bloodType || '',
        'Address':       d.address   || '',
        'City':          d.city      || '',
        'Country':       d.country   || '',
        'Available':     d.isAvailable !== false ? 'Yes' : 'No',
        'Last Donation': d.lastDonationDate ? new Date(d.lastDonationDate).toISOString().split('T')[0] : '',
        'Registered On': new Date(d.createdAt).toISOString().split('T')[0],
        'Last Updated':  d.updatedAt ? new Date(d.updatedAt).toISOString().split('T')[0] : '',
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

    res.json({ success: true, user });
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
});

// PUT /api/auth/profile — update own profile (username, email, bloodType + donor fields)
app.put('/api/auth/profile', authenticate, async (req, res) => {
  try {
    const { firstName, lastName, username, email, bloodType, isAvailable, address, city, lastDonationDate } = req.body;
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
    if (city !== undefined)           user.city             = city ? city.trim() : '';
    if (lastDonationDate !== undefined) user.lastDonationDate = lastDonationDate ? new Date(lastDonationDate) : null;

    await user.save();

    // No separate Donor record to sync — all fields stored directly on User.

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
      city:             user.city || '',
      lastDonationDate: user.lastDonationDate || null,
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

    await Notification.deleteMany({ username: user.username });
    await User.findByIdAndDelete(user._id);
    console.log(`🗑 Self-deleted: ${user.username} (mobile: ${user.mobile || 'none'})`);
    res.json({ success: true, message: 'Your account has been permanently deleted.' });
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
    const notifications = await Notification.find({
      username: req.user.username,
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

// ─── SUPPORT CONTACT FORM ────────────────────────────────────
// POST /api/support/send
// Public endpoint — no auth required (user may not be logged in).
// Body: { fromName, fromEmail, subject, message, attachments? }
app.post('/api/support/send', async (req, res) => {
  try {
    const { fromName, fromEmail, subject, message, attachments } = req.body;

    // ── Validate ──────────────────────────────────────────
    if (!fromName || !fromEmail || !subject || !message) {
      return res.status(400).json({
        success: false,
        error: 'fromName, fromEmail, subject and message are required.',
      });
    }
    const emailRegex = /^[\w.-]+@[\w.-]+\.\w{2,}$/;
    if (!emailRegex.test(fromEmail)) {
      return res.status(400).json({ success: false, error: 'Invalid email address.' });
    }

    // ── Check mail is configured ──────────────────────────
    if (!mailTransporter) {
      console.warn('Support email attempted but MAIL_USER/MAIL_PASS not configured.');
      return res.status(503).json({
        success: false,
        error: 'Mail service is not configured on the server.',
      });
    }

    const toAddress = MAIL_TO || MAIL_USER; // fallback: send to sender account
    const attachmentNote = attachments && attachments.trim()
      ? `\n\n📎 Attachments mentioned: ${attachments}\n(Files cannot be sent through the app — the user may follow up separately.)`
      : '';

    // ── Send ──────────────────────────────────────────────
    await mailTransporter.sendMail({
      from:    `"HSBlood Support" <${MAIL_USER}>`,
      replyTo: `"${fromName}" <${fromEmail}>`,
      to:      toAddress,
      subject: `[HSBlood Support] ${subject}`,
      text: [
        `From: ${fromName} <${fromEmail}>`,
        `Subject: ${subject}`,
        '',
        message,
        attachmentNote,
        '',
        '---',
        'Sent via HSBlood Mobile App',
      ].join('\n'),
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#DC2626;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h2 style="color:white;margin:0;font-size:18px;">🩸 HSBlood Support Request</h2>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr>
                <td style="padding:6px 0;color:#6b7280;width:90px;vertical-align:top;"><strong>From</strong></td>
                <td style="padding:6px 0;color:#111827;">${fromName} &lt;${fromEmail}&gt;</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;vertical-align:top;"><strong>Subject</strong></td>
                <td style="padding:6px 0;color:#111827;">${subject}</td>
              </tr>
            </table>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
            <div style="color:#374151;line-height:1.6;white-space:pre-wrap;">${message}</div>
            ${attachments ? `<div style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:8px;color:#92400e;">📎 <strong>Attachments mentioned:</strong> ${attachments}</div>` : ''}
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
            <p style="color:#9ca3af;font-size:12px;margin:0;">
              Sent via HSBlood Mobile App · Reply to this email to respond to ${fromName}
            </p>
          </div>
        </div>
      `,
    });

    console.log(`📧 Support email sent — from: ${fromEmail}, subject: "${subject}"`);
    res.json({ success: true });

  } catch(err) {
    console.error('Support email error:', err.message || err);
    res.status(500).json({ success: false, error: friendlyError(err, 'SupportEmail') });
  }
});

// ── UPDATE DONATION STATUS (requester or admin) ──────────────
// When marked Completed:
//   1. Update lastDonationDate on User + Donor
//   2. Decrement remainingUnits on THIS requirement; mark Fulfilled if done
//   3. Remove all other Pending pledges by this donor from other requirements
//      and restore those requirements' remainingUnits
app.post('/api/requirements/:id/donations/:donorUsername/status', authenticate, async (req, res) => {
  try {
    const { donationStatus } = req.body;
    if (!['Pending', 'Completed'].includes(donationStatus))
      return res.status(400).json({ success: false, error: 'Status must be Pending or Completed.' });

    const req_ = await BloodRequirement.findById(req.params.id);
    if (!req_) return res.status(404).json({ success: false, error: 'Requirement not found.' });

    const isAdmin_    = req.user.role === 'admin';
    const isRequester = req_.createdBy === req.user.username;
    if (!isAdmin_ && !isRequester)
      return res.status(403).json({ success: false, error: 'Only the requester or admin can update donation status.' });

    const donorUsername = req.params.donorUsername;
    const donation = req_.donations.find(d => d.donorUsername === donorUsername);
    if (!donation)
      return res.status(404).json({ success: false, error: 'Donation record not found.' });

    // Already completed — nothing to do
    if (donation.donationStatus === 'Completed' && donationStatus === 'Completed')
      return res.json({ success: true, message: 'Already marked as Completed.', donationStatus });

    donation.donationStatus = donationStatus;
    req_.updatedAt = new Date();

    if (donationStatus === 'Completed') {
      // 1. Count only COMPLETED donations (not pending pledges) to determine remaining units
      //    We do this before marking the current one completed so we don't double-count.
      const completedBefore = req_.donations.filter(
        d => d.donorUsername !== donorUsername && d.donationStatus === 'Completed'
      ).length;
      // After this completion, total completed = completedBefore + 1
      const totalCompleted = completedBefore + 1;
      req_.remainingUnits = Math.max(0, req_.unitsRequired - totalCompleted);
      if (req_.remainingUnits <= 0) { req_.remainingUnits = 0; req_.status = 'Fulfilled'; }

      // If this requirement is now Fulfilled, remove ALL other Pending pledges on it
      // (no more donors needed — clear their obligations)
      if (req_.status === 'Fulfilled') {
        req_.donations = req_.donations.filter(
          d => d.donorUsername === donorUsername || d.donationStatus === 'Completed'
        );
        console.log(`✅ Req ${req_._id} Fulfilled — cleared remaining pending pledges`);
      }

      await req_.save();

      // 2. Update lastDonationDate on User + linked Donor
      const completionDate = new Date();
      const donorUser = await User.findOne({ username: donorUsername });
      if (donorUser) {
        await User.findByIdAndUpdate(donorUser._id, { lastDonationDate: completionDate, isAvailable: false });
        console.log(`✅ lastDonationDate updated and isAvailable set to false for ${donorUsername} on completion`);
      }

      // 3. Remove all OTHER Pending pledges by this donor from other requirements.
      //    Since pledging never decremented remainingUnits, we do NOT restore them here.
      const otherReqs = await BloodRequirement.find({
        _id: { $ne: req_._id },
        donations: { $elemMatch: { donorUsername: donorUsername, donationStatus: 'Pending' } },
      });

      for (const other of otherReqs) {
        const idx = other.donations.findIndex(
          d => d.donorUsername === donorUsername && d.donationStatus === 'Pending'
        );
        if (idx !== -1) {
          other.donations.splice(idx, 1);
          // remainingUnits is NOT restored — pledging never changed it, so nothing to undo.
          other.updatedAt = new Date();
          await other.save();
          console.log(`🗑 Removed pending pledge by ${donorUsername} from req ${other._id}`);
        }
      }

      res.json({
        success: true,
        message: 'Donation marked as Completed. Last donation date updated and other pending pledges cleared.',
        donationStatus,
        remainingUnits: req_.remainingUnits,
        requirementStatus: req_.status,
      });
    } else {
      // Reverting to Pending — just save
      await req_.save();
      res.json({ success: true, message: 'Donation set back to Pending.', donationStatus });
    }
  } catch(err) { res.status(500).json({ success: false, error: friendlyError(err, 'Server') }); }
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