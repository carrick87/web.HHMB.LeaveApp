# LeaveApp

A leave management web app built with React, TypeScript, Vite, and Firebase. Deploy as a static site on **Vercel**; Firebase handles auth, data, and storage. Email notifications use **EmailJS** (configured in the admin UI).

## Features

- Firebase Auth with role-based access (Employee, Approver, Super Admin)
- Leave requests: submit, approve, reject, cancel, amend
- Working-day calculations (weekends + public holidays)
- Department approvers and CC emails
- Email notifications via EmailJS
- Excel export, statistics, and admin tools
- Optional Google Drive attachments and Gemini leave-reason suggestions

## Prerequisites

- Node.js 18+
- A [Firebase](https://console.firebase.google.com/) project with **Authentication** (Email/Password), **Firestore**, and **Storage**
- A [Vercel](https://vercel.com/) account
- An [EmailJS](https://www.emailjs.com/) account (for email notifications)

## Quick start (local)

```bash
git clone https://github.com/carrick87/leave-app.git
cd leave-app
npm install
cp .env.example .env.local
```

Edit `.env.local` with your Firebase web app config (Firebase Console → Project settings → Your apps).

```bash
npm run dev
```

Open `http://localhost:5173`.

## Firebase setup

1. Create a Firebase project.
2. Enable **Authentication** → Email/Password.
3. Create a **Firestore** database.
4. Enable **Storage**.
5. Deploy security rules — see [FIRESTORE-RULES-SETUP.md](./FIRESTORE-RULES-SETUP.md).
6. If Storage uploads fail from your domain, configure CORS — see [setup-firebase-cors.md](./setup-firebase-cors.md).
7. Copy the web app config values into `.env.local` / Vercel env vars (see `.env.example`).

### Optional: restrict signup to your company domain

```bash
VITE_ALLOWED_EMAIL_DOMAIN=yourcompany.com
```

Leave empty to allow any email domain.

### Optional: admin password reset Cloud Function

See [CLOUD-FUNCTION-SETUP.md](./CLOUD-FUNCTION-SETUP.md).

## Email (EmailJS)

1. Sign in as a Super Admin.
2. Open **Email Setup** in the app.
3. Enter your EmailJS service ID, template ID, and public key.
4. Set from name / from email to match your EmailJS service.

Templates support leave request, approval, rejection, cancellation, and amendment flows.

## Deploy to Vercel

1. Push this repo to GitHub (or import it in Vercel).
2. In Vercel: **Add New Project** → import the repo.
3. Framework preset: **Vite** (or leave defaults; `vercel.json` sets build → `dist`).
4. Add the same `VITE_*` variables from `.env.example` under **Project → Settings → Environment Variables**.
5. Deploy.

After deploy, update Firebase Storage CORS (`cors.json`) and any Google API key HTTP referrers to include `https://your-app.vercel.app`.

### CLI alternative

```bash
npm i -g vercel
vercel
```

## Branding

- Replace `public/appstore.png` (and favicons under `public/`) with your logo.
- Footer copyright text lives in `App.tsx` (search for `©`).

## Optional integrations

| Integration | Docs |
|-------------|------|
| Google Drive attachments | [GOOGLE-DRIVE-SETUP.md](./GOOGLE-DRIVE-SETUP.md) |
| Drive OAuth2 | [GOOGLE-DRIVE-OAUTH2-SETUP.md](./GOOGLE-DRIVE-OAUTH2-SETUP.md) |
| Gemini leave reasons | Set `GEMINI_API_KEY` in env |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Local Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |

## Project structure

```
├── components/     # UI components
├── services/       # Firebase, email, storage helpers
├── utils/          # Date, leave, conflict helpers
├── public/         # Static assets (logo, favicons)
├── functions/      # Optional Firebase Cloud Functions
├── firestore.rules
├── vercel.json
└── .env.example
```

## License

MIT — see [LICENSE](./LICENSE).
