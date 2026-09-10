# City Winery — Concert Intelligence

Internal programming database. Live data from Google Sheets, hosted on Netlify, login-protected.

---

## One-time setup (takes ~20 minutes)

### Step 1 — Push to GitHub

1. Go to https://github.com/slipetz12-boop
2. Click **New repository** → name it `cw-concerts` → Create
3. Upload all these files (drag the whole folder into the GitHub UI, or use git CLI)

### Step 2 — Connect Netlify to GitHub

1. Log in to Netlify → **Add new site** → **Import from Git**
2. Choose GitHub → select `cw-concerts`
3. Build settings are automatic (netlify.toml handles everything)
4. Click **Deploy site**

### Step 3 — Create a Google Service Account (for reading your Sheet)

This gives the app read-only access to your Google Sheet without exposing your personal credentials.

1. Go to https://console.cloud.google.com
2. Create a new project (or use an existing one) — name it `cw-concerts`
3. Enable the **Google Sheets API**: APIs & Services → Enable APIs → search "Sheets" → Enable
4. Create credentials: APIs & Services → Credentials → **Create Credentials** → **Service Account**
   - Name: `cw-sheets-reader`
   - Role: Viewer
   - Click Done
5. Click the service account → **Keys** tab → **Add Key** → **JSON** → Download the file
6. Open that JSON file — copy the entire contents

### Step 4 — Share your Google Sheet with the service account

1. Open your `2016_2026 CW Bible` Google Sheet
2. Click **Share**
3. Paste the `client_email` from the JSON file (looks like `cw-sheets-reader@yourproject.iam.gserviceaccount.com`)
4. Set to **Viewer** → Share

### Step 5 — Set environment variables in Netlify

Go to **Netlify → your site → Site configuration → Environment variables** and add:

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT` | Paste the entire JSON file contents as one line |
| `JWT_SECRET` | Any long random string, e.g. `cw-secret-2024-xK9mP2` |
| `USERS` | Comma-separated `username:password` pairs (see below) |

**USERS format:**
```
shlomo:YourPassword1,rhiannon:HerPassword2,michael:HisPassword3
```

Add one entry per team member. Usernames are case-insensitive.

### Step 6 — Trigger a redeploy

Netlify → Deploys → **Trigger deploy** → Deploy site

Your app is now live at your Netlify URL (e.g. `https://cw-concerts.netlify.app`)

---

## Adding team members

Go to Netlify → Environment variables → edit `USERS` → add `newname:password` to the list → redeploy.

## Changing passwords

Same as above — edit the `USERS` variable.

## Data stays live

The app reads directly from your Google Sheet every 30 minutes (cached). When you add a new monthly tab or update existing data, it will appear automatically within 30 minutes. No uploads needed.

## Forcing a data refresh

Add `?refresh=1` to the URL, or simply wait for the 30-minute cache to expire.

---

## File structure

```
cw-concerts/
├── netlify.toml              — Netlify build config
├── package.json              — Dependencies
├── netlify/functions/
│   ├── auth.js               — Login endpoint
│   └── shows.js              — Data fetch from Google Sheets
└── public/
    ├── index.html            — Main app
    ├── login.html            — Login page
    ├── css/app.css           — Styles
    └── js/app.js             — All client-side logic
```
