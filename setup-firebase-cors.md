# Firebase Storage CORS

If uploads fail with CORS errors from your Vercel domain, configure CORS on your Storage bucket.

## Option A: Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) → your Firebase project
2. **Cloud Storage** → select your bucket (usually `your-project-id.firebasestorage.app` or `your-project-id.appspot.com`)
3. **Configuration** → **CORS configuration** → edit using [`cors.json`](./cors.json)
4. Replace `https://your-app.vercel.app` with your real Vercel URL(s)

## Option B: gsutil

```bash
gcloud config set project your-project-id
# Edit cors.json origins first, then:
gsutil cors set cors.json gs://your-project-id.firebasestorage.app
```

## Verify

Retry a file upload from the deployed app. Confirm the bucket name matches Firebase Console → Storage.
