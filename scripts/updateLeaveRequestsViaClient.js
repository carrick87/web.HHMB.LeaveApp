/**
 * Client-side script to update leave requests with requesterDepartmentId
 * This can be run from the browser console or added as a utility function
 * 
 * Usage in browser console:
 * 1. Open browser console (F12)
 * 2. Copy and paste this entire script
 * 3. Call: updateLeaveRequestsWithRequesterInfo()
 * 
 * Or add this function to your app and call it from a Super Admin page
 */

async function updateLeaveRequestsWithRequesterInfo() {
    try {
        console.log('🔄 Starting update of leave requests with requester info...\n');

        // Import Firebase functions (adjust import path as needed)
        const { collection, getDocs, doc, updateDoc, query, writeBatch } = await import('firebase/firestore');
        const { firestore } = await import('./services/firebaseConfig');
        
        // Get all users to create a lookup map
        const usersSnapshot = await getDocs(collection(firestore, 'users'));
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

        // Get all leave requests
        const leaveRequestsSnapshot = await getDocs(collection(firestore, 'leaveRequests'));
        console.log(`📋 Found ${leaveRequestsSnapshot.size} total leave request(s)\n`);

        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        const batch = writeBatch(firestore);
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
                const requestRef = doc(firestore, 'leaveRequests', requestId);
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
        return {
            success: true,
            updated: updatedCount,
            skipped: skippedCount,
            errors: errorCount
        };
    } catch (error) {
        console.error('❌ Error updating leave requests:', error);
        throw error;
    }
}

// Export for use in modules, or make available globally
if (typeof window !== 'undefined') {
    window.updateLeaveRequestsWithRequesterInfo = updateLeaveRequestsWithRequesterInfo;
}

// For Node.js/CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = updateLeaveRequestsWithRequesterInfo;
}
