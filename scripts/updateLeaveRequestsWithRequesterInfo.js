/**
 * Script to update existing leave requests with requesterDepartmentId and requesterName
 * This is needed for old leave requests that were created before we added these fields
 * 
 * Usage:
 * 1. Make sure you have Firebase Admin SDK credentials set up
 * 2. Run: node scripts/updateLeaveRequestsWithRequesterInfo.js
 * 
 * This script will:
 * - Find all leave requests missing requesterDepartmentId or requesterName
 * - Look up the user's department and name from the users collection
 * - Update the leave requests with the stored information
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
// You need to download your service account key from Firebase Console
// and set the path below, or set GOOGLE_APPLICATION_CREDENTIALS environment variable
if (!admin.apps.length) {
    try {
        // Try to use environment variable first
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            const serviceAccount = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } else {
            // Or specify the path directly here
            const serviceAccountPath = path.join(__dirname, '../serviceAccountKey.json');
            const serviceAccount = require(serviceAccountPath);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
    } catch (error) {
        console.error('Error initializing Firebase Admin SDK:', error);
        console.error('\nPlease ensure you have:');
        console.error('1. Downloaded your Firebase service account key');
        console.error('2. Saved it as serviceAccountKey.json in the project root, OR');
        console.error('3. Set GOOGLE_APPLICATION_CREDENTIALS environment variable');
        process.exit(1);
    }
}

const db = admin.firestore();

async function updateLeaveRequestsWithRequesterInfo() {
    try {
        console.log('🔄 Starting update of leave requests with requester info...\n');

        // Get all leave requests
        const leaveRequestsSnapshot = await db.collection('leaveRequests').get();
        console.log(`📋 Found ${leaveRequestsSnapshot.size} total leave request(s)\n`);

        // Get all users to create a lookup map
        const usersSnapshot = await db.collection('users').get();
        const usersMap = new Map();
        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            usersMap.set(doc.id, {
                id: doc.id,
                name: userData.name,
                departmentId: userData.departmentId,
                employeeNumber: userData.employeeNumber
            });
        });
        console.log(`👥 Loaded ${usersMap.size} user(s) for lookup\n`);

        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        const batch = db.batch();
        let batchCount = 0;
        const BATCH_SIZE = 500; // Firestore batch limit

        // Process each leave request
        for (const requestDoc of leaveRequestsSnapshot.docs) {
            const requestData = requestDoc.data();
            const requestId = requestDoc.id;
            const userId = requestData.userId;

            // Check if update is needed
            const needsUpdate = !requestData.requesterDepartmentId || !requestData.requesterName;

            if (!needsUpdate) {
                skippedCount++;
                continue;
            }

            // Get user info
            const user = usersMap.get(userId);

            if (!user) {
                console.warn(`⚠️  User ${userId} not found for leave request ${requestId}`);
                errorCount++;
                continue;
            }

            // Prepare update data
            const updateData = {};
            
            if (!requestData.requesterDepartmentId && user.departmentId) {
                updateData.requesterDepartmentId = user.departmentId;
            }
            
            if (!requestData.requesterName && user.name) {
                updateData.requesterName = user.name;
            }
            
            if (!requestData.employeeNumber && user.employeeNumber) {
                updateData.employeeNumber = user.employeeNumber;
            }

            // Only update if there's data to update
            if (Object.keys(updateData).length > 0) {
                const requestRef = db.collection('leaveRequests').doc(requestId);
                batch.update(requestRef, updateData);
                batchCount++;
                updatedCount++;

                // Commit batch if we've reached the limit
                if (batchCount >= BATCH_SIZE) {
                    await batch.commit();
                    console.log(`✅ Committed batch of ${batchCount} updates`);
                    batchCount = 0;
                }
            } else {
                skippedCount++;
            }
        }

        // Commit remaining updates
        if (batchCount > 0) {
            await batch.commit();
            console.log(`✅ Committed final batch of ${batchCount} updates\n`);
        }

        console.log('='.repeat(50));
        console.log('📊 Update Summary:');
        console.log(`✅ Updated: ${updatedCount} leave request(s)`);
        console.log(`⏭️  Skipped: ${skippedCount} leave request(s) (already have requester info)`);
        console.log(`❌ Errors: ${errorCount} leave request(s) (user not found)`);
        console.log('='.repeat(50));

        if (errorCount > 0) {
            console.log('\n⚠️  Some leave requests could not be updated because their users were not found.');
            console.log('   These may be from deleted users. You may need to manually update them.');
        }

        console.log('\n✨ Update completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error updating leave requests:', error);
        process.exit(1);
    }
}

// Run the script
updateLeaveRequestsWithRequesterInfo();
