# Firebase Cloud Function setup (optional)

Admin password reset uses a Firebase Cloud Function. Skip this if you do not need that feature.

## Prerequisites

- A Firebase project (same as the web app)
- Firebase CLI: `npm install -g firebase-tools`
- Blaze (pay-as-you-go) plan for Cloud Functions

## Deploy

```bash
cd functions
npm install
cd ..
firebase login
firebase use your-project-id
firebase deploy --only functions
```

## Configure the web app

Set in `.env.local` / Vercel env:

```bash
VITE_FUNCTIONS_URL=https://us-central1-your-project-id.cloudfunctions.net
```

If unset, the app derives the URL from `VITE_FIREBASE_PROJECT_ID` (us-central1).

## Verify

After deploy, the function URL looks like:

```
https://us-central1-your-project-id.cloudfunctions.net/resetUserPassword
```

Only authenticated Super Admins should be able to call it (see `functions/index.js` auth checks).
