# 🩸 HSBlood — Blood Donor Registry

## Project Structure

```
HS_Blood/
├── index.html              ← Entry point (open this in browser)
├── css/
│   └── main.css            ← All styles
├── js/
│   ├── config.js           ← API URL & environment detection
│   ├── utils.js            ← Toast, date format, avatar helpers
│   ├── api.js              ← Fetch wrapper, auth headers, progress bar
│   ├── auth.js             ← Login, logout, signup, session (24h)
│   ├── ui.js               ← Sidebar, navigation, role-based UI
│   ├── dashboard.js        ← Stats, blood type chart, recent donors
│   ├── donors.js           ← Donor list, card/table view, CRUD
│   ├── users.js            ← User management (admin only)
│   ├── delete.js           ← Shared delete confirmation modal
│   ├── requirements.js     ← Blood requirements, CRUD, status updates
│   ├── bulk.js             ← Bulk upload for donors, requirements, info
│   ├── duplicates.js       ← Live duplicate detection on all forms
│   ├── export.js           ← Data export (XLSX, CSV, JSON)
│   ├── info.js             ← Info directory, map view, geocoding, CRUD
│   └── animation.js        ← Blood drop loading animation
├── assets/                 ← Images, icons (add here as needed)
├── backend/
│   ├── server.js           ← Express API + MongoDB models
│   ├── package.json        ← Dependencies
│   ├── .env.example        ← Config template (copy to .env)
│   └── .env                ← Your secrets (never commit this!)
├── .gitignore
├── render.yaml             ← Render.com deployment config
├── start.sh                ← Run locally on Mac
├── DEPLOY.md               ← Free hosting guide (Render + GitHub Pages)
└── README.md
```

---

## Quick Start (Local)

```bash
# 1. Create your .env file
cp backend/.env.example backend/.env
# Open backend/.env and set your MONGO_URI

# 2. Start the server
bash start.sh
```

Then open **http://localhost:3000** in your browser.

---

## Manual start

```bash
cd backend
npm install
node server.js
```

---

## Adding a new feature

1. Add HTML to `index.html`
2. Add styles to `css/main.css`
3. Create a new file `js/myfeature.js`
4. Add `<script src="js/myfeature.js"></script>` to `index.html`

---

## Deployment (free, 24/7)

See **DEPLOY.md** for the full step-by-step guide:
- **Backend** → Render.com (free)
- **Frontend** → GitHub Pages (free)  
- **Database** → MongoDB Atlas (already configured)

For GitHub Pages, set the source to the root `/` folder —
`index.html` is already at the root. ✅
