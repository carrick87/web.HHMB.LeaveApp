/**
 * Cloud Function: resetUserPassword
 * 
 * This Cloud Function allows Super Admins to directly set a new password for users.
 * It uses Firebase Admin SDK to update passwords.
 * 
 * Setup Instructions:
 * 1. Install Firebase Admin SDK: npm install firebase-admin firebase-functions
 * 2. Deploy this function: firebase deploy --only functions:resetUserPassword
 * 3. The function URL will be available at: https://[region]-[project-id].cloudfunctions.net/resetUserPassword
 * 
 * Security:
 * - The function verifies that the caller is a Super Admin by checking their auth token
 * - Only Super Admins can reset passwords
 * - Passwords must be at least 6 characters long
 * - The function uses Firebase Admin SDK to update passwords directly
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });

// Initialize Admin SDK (if not already initialized)
if (!admin.apps.length) {
    admin.initializeApp();
}

exports.resetUserPassword = functions.https.onRequest((req, res) => {
    // Use cors middleware to handle CORS properly
    return cors(req, res, async () => {
        // Only allow POST requests
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        try {
            // Get authorization token from header
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization token' });
                return;
            }

            const token = authHeader.split('Bearer ')[1];

            // Verify the token and get user info
            const decodedToken = await admin.auth().verifyIdToken(token);
            const adminUserId = decodedToken.uid;

            // Get admin user document from Firestore to check role
            const adminUserDoc = await admin.firestore().collection('users').doc(adminUserId).get();
            if (!adminUserDoc.exists) {
                res.status(403).json({ error: 'Forbidden: Admin user not found' });
                return;
            }

            const adminUserData = adminUserDoc.data();
            if (adminUserData.role !== 'Super Admin') {
                res.status(403).json({ error: 'Forbidden: Only Super Admins can reset passwords' });
                return;
            }

            // Get request body
            const { userId, authEmail, newPassword } = req.body;

            if (!userId || !authEmail || !newPassword) {
                res.status(400).json({ error: 'Missing required fields: userId, authEmail, newPassword' });
                return;
            }

            // Validate password length
            if (newPassword.length < 6) {
                res.status(400).json({ error: 'Password must be at least 6 characters long' });
                return;
            }

            // Get user by email using Admin SDK
            let userRecord;
            try {
                userRecord = await admin.auth().getUserByEmail(authEmail);
            } catch (error) {
                res.status(404).json({ error: 'User not found with the provided email' });
                return;
            }

            // Update password directly using Admin SDK
            await admin.auth().updateUser(userRecord.uid, {
                password: newPassword
            });

            // Log the password reset action
            console.log(`Password reset for user ${userId} (${authEmail}) by Super Admin ${adminUserId}`);

            res.status(200).json({ 
                success: true, 
                message: 'Password reset successfully'
            });

        } catch (error) {
            console.error('Error resetting password:', error);
            res.status(500).json({ 
                error: 'Internal server error', 
                message: error.message 
            });
        }
    });
});
