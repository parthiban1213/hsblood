# 🚀 HSBlood — Free 24/7 Deployment Guide

Run your app 24/7 without your Mac — completely free.

```
Your Mac (can be OFF ✅)
         │
         ▼
   GitHub Pages          ← frontend (index.html) — free, always on
         │
         ▼  HTTPS API calls
    Render.com            ← backend (Node.js) — free, always on
         │
         ▼  MongoDB queries
   MongoDB Atlas          ← database — already in cloud ✅
```

---

## What you need (all free, no credit card)

| Service | What for | Sign up |
|---|---|---|
| GitHub | Store & deploy code | github.com |
| Render.com | Host the backend 24/7 | render.com |
| UptimeRobot | Keep Render awake | uptimerobot.com |

Your MongoDB Atlas is already set up ✅

---

## STEP 1 — Push code to GitHub

### 1a. Create a new repository on GitHub
1. Go to **github.com** → sign in to your account
2. Click **+** → **New repository**
3. Name: `hsblood` | Visibility: Private (recommended) | **No README**
4. Click **Create repository**

### 1b. Push from Terminal

Open Terminal and run these one by one:

```bash
# Go to your project folder (adjust path if different)
cd ~/Desktop/HSBlood_Deploy

# Initialise git
git init

# Set your identity for this project only
git config user.name "Your Name"
git config user.email "your-github-email@example.com"

# Stage all files
git add .

# First commit
git commit -m "Initial commit"

# Add your GitHub repo as remote
# Replace YOUR_USERNAME with your actual GitHub username
git remote add origin git@github.com:YOUR_USERNAME/hsblood.git

# Push
git push -u origin main
```

> If you get "error: src refspec main does not match any" run:
> `git branch -M main` then `git push -u origin main`

---

## STEP 2 — Deploy backend on Render.com

### 2a. Create a Render account
1. Go to **https://render.com**
2. Click **Get Started for Free**
3. Sign up with GitHub (easiest — links your repos automatically)

### 2b. Create a Web Service
1. Click **New +** → **Web Service**
2. Click **Connect a repository** → select `hsblood`
3. Fill in:

| Field | Value |
|---|---|
| Name | `hsblood` |
| Region | `Singapore` (closest to India) |
| Branch | `main` |
| Root Directory | `backend` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Instance Type | **Free** |

### 2c. Add environment variables
Click **Advanced** → **Add Environment Variable** — add all of these:

| Key | Value |
|---|---|
| `MONGO_URI` | `mongodb+srv://parthiban:parthiqa@cluster0.dztbd5l.mongodb.net/?appName=Cluster0` |
| `JWT_SECRET` | `bloodlink_super_secret_key_2024` |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | `admin123` |
| `USER_USERNAME` | `user` |
| `USER_PASSWORD` | `user123` |
| `PORT` | `3000` |

4. Click **Create Web Service**

Wait 2–3 minutes for the first deploy. ✅

### 2d. Copy your Render URL
Once deployed, you'll see a URL at the top like:
```
https://hsblood.onrender.com
```
**Copy this URL** — you need it in Step 3.

---

## STEP 3 — Connect frontend to Render

Open `frontend/index.html` in any text editor (TextEdit, VS Code, etc.)

Find this line (near the top of the `<script>` section):
```javascript
const RENDER_URL = '';
```

Change it to your Render URL:
```javascript
const RENDER_URL = 'https://hsblood.onrender.com';
```
(Use your actual URL, not this example.)

Save the file, then push the change to GitHub:
```bash
git add frontend/index.html
git commit -m "Set Render URL"
git push
```

---

## STEP 4 — Host frontend on GitHub Pages

1. Go to your `hsblood` repo on GitHub
2. Click **Settings** → **Pages** (left sidebar)
3. Under **Source**: select **Deploy from a branch**
4. Branch: `main` | Folder: `/frontend`
5. Click **Save**

Wait ~1 minute. GitHub gives you a URL like:
```
https://YOUR_USERNAME.github.io/hsblood/
```

**Share this URL** with anyone — it works on any device, even when your Mac is off. ✅

---

## STEP 5 — Keep Render awake (important!)

Render's free tier **sleeps after 15 minutes** of no traffic.
The first visit after sleep takes ~30 seconds to load.

Fix this for free with UptimeRobot:

1. Go to **https://uptimerobot.com** → create free account
2. Click **Add New Monitor**
3. Fill in:

| Field | Value |
|---|---|
| Monitor Type | HTTP(s) |
| Friendly Name | HSBlood |
| URL | `https://hsblood.onrender.com/api/health` |
| Monitoring Interval | Every 5 minutes |

4. Click **Create Monitor**

UptimeRobot pings your server every 5 minutes → it never sleeps → instant loads. ✅

---

## Done! ✅

| What | URL |
|---|---|
| Your app (share this) | `https://YOUR_USERNAME.github.io/hsblood/` |
| Backend API | `https://hsblood.onrender.com/api` |
| Health check | `https://hsblood.onrender.com/api/health` |

---

## Updating the app later

Every time you make changes:
```bash
git add .
git commit -m "Describe your change"
git push
```
- Render auto-redeploys the backend in ~2 minutes
- GitHub Pages auto-redeploys the frontend in ~1 minute

---

## Local development (your Mac)

To still run locally when needed:
```bash
bash start.sh
```
Then open `frontend/index.html` in your browser.
The frontend auto-detects localhost and uses `http://localhost:3000` — no config needed.

---

## Troubleshooting

**"Cannot connect to server" on the live site**
→ Check Render dashboard — is the service running?
→ Check UptimeRobot is set up so Render doesn't sleep

**Login not working on live site**
→ Make sure all environment variables are set in Render dashboard
→ Check MONGO_URI is correct

**Changes not showing after push**
→ Wait 2 minutes for Render to redeploy
→ Hard refresh browser: `Cmd + Shift + R`

**First load is slow (~30 seconds)**
→ Render is waking up from sleep → set up UptimeRobot (Step 5)
