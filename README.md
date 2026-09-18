# HHMB LeaveApp

Leave management web app for **Harrisons Holdings (Malaysia) Berhad**, built with React, TypeScript, Vite, and Firebase.

**Current version:** `0.1.1-beta`

## Features

- Firebase Auth (Email/Password) with role-based access (Employee, Admin, Super Admin)
- Leave requests: submit, approve, reject, cancel, amend
- Working-day calculations (weekends + public holidays)
- Manageable branch catalog and department approvers / CC emails
- Employee registration with explicit branch selection
- Email notifications via EmailJS
- Excel export, statistics, and admin tools

## Prerequisites

- Node.js 18+
- A [Firebase](https://console.firebase.google.com/) project with **Authentication** (Email/Password), **Firestore**, and **Storage**
- A [Vercel](https://vercel.com/) account (optional hosting)
- An [EmailJS](https://www.emailjs.com/) account (for email notifications)

## Quick start (local)

```bash
git clone https://github.com/carrick87/web.HHMB.LeaveApp.git
cd web.HHMB.LeaveApp
npm install
cp .env.example .env.local
```

Edit `.env.local` with your Firebase web app config (Firebase Console → Project settings → Your apps).

```bash
npm run dev
```

Open `http://localhost:5173`.

## Firebase setup

1. Create a Firebase project (HHMB uses `web-hhmb-leaveapp`).
2. Enable **Authentication** → Email/Password.
3. Create a **Firestore** database.
4. Enable **Storage**.
5. Deploy security rules — see [FIRESTORE-RULES-SETUP.md](./FIRESTORE-RULES-SETUP.md).
6. Copy the web app config values into `.env.local` / Vercel env vars (see `.env.example`).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Local Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |

## Version History

### v0.1.1-beta (Current)

- Ported HSSB LeaveApp dark theme (atmosphere, shell, login chrome)
- HH logo favicon and page title: LeaveApp - Harrisons Holdings (Malaysia) Berhad
- Changelog trimmed to HHMB releases only

### v0.1.0-beta — first release

- First release of HHMB LeaveApp for Harrisons Holdings (Malaysia) Berhad
- Email/password sign-in for @harrisons.com.my accounts (admin-provisioned)
- Core leave workflow: apply, approve, reject, cancel, amend, calendar, and statistics
- Firestore-managed branches (Super Admin CRUD + delete confirmation)
- Employee registration requires branch select; persists `users.branch`
- Effective branch: `branchOverride` → `branch` → legacy emp-number prefix

## License

MIT — see [LICENSE](./LICENSE).
