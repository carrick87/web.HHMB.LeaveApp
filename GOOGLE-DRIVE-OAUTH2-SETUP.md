# Google Drive OAuth2 (optional advanced)

Use this only if you need user-scoped Drive access instead of an API key.

## Redirect URIs (examples)

- `http://localhost:5173/auth/callback`
- `https://your-app.vercel.app/auth/callback`

## Environment

```bash
REACT_APP_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
REACT_APP_GOOGLE_CLIENT_SECRET=your_client_secret
REACT_APP_GOOGLE_DRIVE_FOLDER_ID=your_folder_id
REACT_APP_GOOGLE_REDIRECT_URI=https://your-app.vercel.app/auth/callback
```

Never commit real client secrets. Prefer API-key setup in [`GOOGLE-DRIVE-SETUP.md`](./GOOGLE-DRIVE-SETUP.md) when possible.
