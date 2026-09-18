# Firebase setup notes (HHMB / web-hhmb-leaveapp only)

Do **not** deploy anything to the HSSB Firebase project.

## Auth

- Google Sign-In only.
- Admin provisions users in-app (client writes to `provisionedUsers` + `employees`).
- First `@harrisons.com.my` Google sign-in on an empty `users` collection becomes Super Admin.

## Cloud Functions (optional)

`registerBranchEmployees` exists under `functions/` for Admin-SDK style provisioning, but the app uses **client-side registration** by default so the Spark plan works.

To deploy functions you must upgrade the project to **Blaze**:
https://console.firebase.google.com/project/web-hhmb-leaveapp/usage/details

```bash
firebase use web-hhmb-leaveapp
firebase deploy --only functions:registerBranchEmployees
```

## Rules

```bash
firebase deploy --only firestore:rules,storage --project web-hhmb-leaveapp
```
