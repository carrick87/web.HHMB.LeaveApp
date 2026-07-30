/**
 * Script to delete a user from Firebase Auth using Admin SDK
 * 
 * This script can be run locally to delete users from Firebase Auth
 * when you don't have Cloud Functions available.
 * 
 * Usage:
 * 1. Install dependencies: npm install firebase-admin
 * 2. Set up Firebase Admin SDK credentials (see instructions below)
 * 3. Run: node scripts/deleteUserFromAuth.js <userId>
 * 
 * Setup Instructions:
 * 1. Go to Firebase Console > Project Settings > Service Accounts
 * 2. Click "Generate New Private Key"
 * 3. Save the JSON file as "firebase-admin-key.json" in the project root
 * 4. Update the path below if you saved it elsewhere
 * 
 * Note: Keep the key file secure and never commit it to version control!
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Admin SDK
try {
    const serviceAccount = require(path.join(__dirname, '../firebase-admin-key.json'));
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    
    console.log('✅ Firebase Admin SDK initialized');
} catch (error) {
    console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
    console.error('\nPlease ensure you have:');
    console.error('1. Created firebase-admin-key.json from Firebase Console');
    console.error('2. Installed firebase-admin: npm install firebase-admin');
    process.exit(1);
}

// Get user ID from command line arguments
const userId = process.argv[2];

if (!userId) {
    console.error('❌ Please provide a user ID');
    console.error('Usage: node scripts/deleteUserFromAuth.js <userId>');
    process.exit(1);
}

async function deleteUserFromAuth(userId) {
    try {
        // First, get the user's email from Firestore to find their Auth account
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
            console.log('⚠️  User document not found in Firestore (may have been deleted)');
            console.log('Attempting to delete from Auth using userId directly...');
        } else {
            const userData = userDoc.data();
            const authEmail = userData.authEmail || 
                            (userData.employeeNumber ? 
                                `${userData.employeeNumber.toLowerCase().replace(/[^a-z0-9]/g, '')}@system.local` : 
                                null);
            
            if (authEmail) {
                console.log(`📧 Found auth email: ${authEmail}`);
                try {
                    const authUser = await admin.auth().getUserByEmail(authEmail);
                    await admin.auth().deleteUser(authUser.uid);
                    console.log(`✅ Successfully deleted user from Firebase Auth (UID: ${authUser.uid})`);
                    return;
                } catch (error) {
                    if (error.code === 'auth/user-not-found') {
                        console.log('⚠️  User not found in Firebase Auth (may have been deleted already)');
                        return;
                    }
                    throw error;
                }
            }
        }
        
        // Fallback: try to delete using userId directly (if userId is the Auth UID)
        try {
            await admin.auth().deleteUser(userId);
            console.log(`✅ Successfully deleted user from Firebase Auth (UID: ${userId})`);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                console.log('⚠️  User not found in Firebase Auth');
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error('❌ Error deleting user from Firebase Auth:', error.message);
        process.exit(1);
    }
}

// Run the deletion
deleteUserFromAuth(userId)
    .then(() => {
        console.log('\n✅ Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Script failed:', error);
        process.exit(1);
    });
