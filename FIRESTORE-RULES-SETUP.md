# Firestore security rules

1. Open [Firebase Console](https://console.firebase.google.com/) → your project
2. **Firestore Database** → **Rules**
3. Paste the contents of [`firestore.rules`](./firestore.rules)
4. **Publish**

Or with the CLI:

```bash
firebase use your-project-id
firebase deploy --only firestore:rules
```

Review the rules before production and tighten them for your organization.
