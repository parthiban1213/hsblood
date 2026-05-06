// ══════════════════════════════════════════════════════════════
// HSBlood — js/config.js
// API URL configuration and environment detection
// ══════════════════════════════════════════════════════════════

// ── API URL auto-detection ─────────────────────────────────────
// Set RENDER_URL to your Render deployment URL (no trailing slash).
// Leave blank to always use localhost (local dev only).
const RENDER_URL = 'https://hsblood.onrender.com';

// ── Cloudinary (support form file uploads) ─────────────────────
// Same credentials as the mobile app.
// Sign up free at cloudinary.com — no card required.
const CLOUDINARY_CLOUD_NAME    = 'dywlppbqa';    // ← replace
const CLOUDINARY_UPLOAD_PRESET = 'tnblood'; // ← replace // 

const API = (() => {
  const h = window.location.hostname;
  // Running on Render itself — same origin, use relative path
  if (RENDER_URL && window.location.origin === RENDER_URL) return '/api';
  // Opened as a local file (file://) or localhost → use localhost
  if (!h || h === 'localhost' || h === '127.0.0.1') return `http://localhost:3000/api`;
  // LAN IP (192.168.x.x / 10.x.x.x / 172.x.x.x) → backend on same machine
  if (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(h))
    return `http://${h}:3000/api`;
  // Any other origin (GitHub Pages, Netlify, etc.) → use Render URL if configured
  if (RENDER_URL) return RENDER_URL + '/api';
  // Fallback: same hostname port 3000
  return `http://${h}:3000/api`;
})();
let currentUser = null;
let authToken   = null;
let allDonors   = [];
let donorView   = 'table';
