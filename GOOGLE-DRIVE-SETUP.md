# Google Drive attachments (optional)

LeaveApp can attach files via the Google Drive API. This is optional; Firebase Storage can be used instead depending on your setup.

## Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Google Drive API**
3. Create an **API key**
4. Create a Drive folder for attachments and copy the folder ID from the URL
5. Restrict the API key to your Vercel domain(s) and localhost

## Environment

Add to `.env.local` / Vercel:

```bash
REACT_APP_GOOGLE_DRIVE_API_KEY=your_google_drive_api_key_here
REACT_APP_GOOGLE_DRIVE_FOLDER_ID=your_google_drive_folder_id_here
```

See also [`google-drive-config.template`](./google-drive-config.template).

## Allowed HTTP referrers (example)

- `http://localhost:5173/*`
- `https://your-app.vercel.app/*`
- `https://your-custom-domain.com/*`
