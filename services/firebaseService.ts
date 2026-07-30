import {
    onAuthStateChanged as firebaseOnAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    updatePassword,
    updateEmail,
    signOut,
    sendEmailVerification,
    sendPasswordResetEmail,
    type User as FirebaseUser
} from 'firebase/auth';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    deleteField,
    onSnapshot,
    serverTimestamp,
    query,
    where,
    orderBy,
    limit,
    writeBatch,
    documentId,
    type DocumentReference,
    type Query as FirestoreQuery
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from 'firebase/storage';
import { User, UserRole, LeaveBalanceHistory, PublicHolidaySet, LeaveRequest } from '../types';
import { auth, firestore, storage } from './firebaseConfig';

// --- AUTHENTICATION ---

export const onAuthStateChanged = (callback: (user: FirebaseUser | null) => void) => {
    return firebaseOnAuthStateChanged(auth, callback);
};


// Generate email from employee number for Firebase Auth compatibility
export const generateEmailFromEmployeeNumber = (employeeNumber: string): string => {
    // Clean employee number and use as email
    const cleanNumber = employeeNumber.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    // Ensure we have a valid employee number
    if (!cleanNumber || cleanNumber.length === 0) {
        throw new Error('Invalid employee number format');
    }
    return `${cleanNumber}@system.local`;
};

export const signInUser = async (employeeNumberOrEmail: string, password: string) => {
    // Try as employee number first (new format - generate email from employee number)
    try {
        const email = generateEmailFromEmployeeNumber(employeeNumberOrEmail);
        return await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
        // If it fails with invalid-credential or invalid-email, try as email (for backward compatibility)
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
            // Try as email address (for existing users created before employee number system)
            // This allows backward compatibility
            try {
                return await signInWithEmailAndPassword(auth, employeeNumberOrEmail, password);
            } catch (emailErr: any) {
                // If email login also fails, throw the original employee number error
                throw err;
            }
        }
        // Re-throw other errors
        throw err;
    }
};

export const signUpUser = async (employeeNumber: string, email: string, password: string, additionalData: { name: string, departmentId?: string }) => {
    // MANDATORY: Check if employee number already exists - duplicates are NOT allowed
    try {
        const employeeExists = await checkEmployeeNumberExists(employeeNumber);
        if (employeeExists) {
            throw new Error('An account with this employee number already exists. Please use a different employee number or contact administrator if you believe this is an error.');
        }
    } catch (checkErr: any) {
        // If permission denied, we cannot verify - block sign-up and ask user to contact admin
        if (checkErr.code === 'permission-denied') {
            throw new Error('Unable to verify employee number. Please contact administrator to resolve this issue.');
        }
        // Re-throw if it's a different error (like actually exists)
        throw checkErr;
    }
    
    // Generate a unique email for Firebase Auth (allows same email with different employee numbers)
    // Format: {employeeNumber}@system.local
    // This allows multiple users to have the same email address but different employee numbers
    const authEmail = generateEmailFromEmployeeNumber(employeeNumber);
    
    // Create account with generated email - this allows same email with different employee numbers
    const { user } = await createUserWithEmailAndPassword(auth, authEmail, password);
    
    await updateProfile(user, { displayName: additionalData.name });
    
    // No email verification required - users can sign in immediately after sign-up
    
    // Create user document in Firestore
    // User is authenticated at this point, so they can create their own document
    try {
        const masterEmployee = await getEmployeeByNumber(employeeNumber);
        const payGroup = masterEmployee?.payGroup === '6' ? '6' : '5';

        // Check if there's a current leave balance for this employee number
        let leaveDaysTotal = 0; // Default leave days when balance is unavailable
        try {
            const currentBalance = await getCurrentLeaveBalance(employeeNumber);
            if (currentBalance !== null) {
                leaveDaysTotal = currentBalance;
            }
        } catch (balanceError) {
            console.warn('Could not fetch current leave balance for new user, defaulting to 0:', balanceError);
            // Continue with default value if balance lookup fails
        }
        
        const userDocRef = doc(firestore, 'users', user.uid);
        const userData: any = {
            name: additionalData.name,
            email: email, // User-provided email (can be duplicate across users)
            authEmail: authEmail, // Internal email used for Firebase Auth (unique per employee number)
            employeeNumber: employeeNumber, // Store actual employee number
            payGroup: payGroup, // Copy paygroup from employee master list
            role: UserRole.NORMAL, // Default role
            leaveDaysTotal: leaveDaysTotal, // Use balance from reference table if available, otherwise default
            avatarUrl: `https://i.pravatar.cc/150?u=${user.uid}`,
            isActive: true,
            emailVerified: true, // Email verification not required - set to true by default
            createdAt: new Date().toISOString(),
        };
        
        // Only add departmentId if provided
        if (additionalData.departmentId) {
            userData.departmentId = additionalData.departmentId;
        }
        
        await setDoc(userDocRef, userData);
        
        // Restore leave requests for this employee number
        // This allows users who were deleted to get their leave history back when they sign up again
        try {
            await restoreLeaveRequestsForEmployee(employeeNumber, user.uid);
        } catch (restoreError) {
            // Log error but don't fail sign-up if restoration fails
            console.warn('Failed to restore leave requests for employee:', restoreError);
        }
        
        // Restore approver assignments in departments
        // This allows deleted approvers to be restored to their departments when they sign up again
        try {
            await restoreApproverInDepartments(employeeNumber, user.uid);
        } catch (restoreError) {
            // Log error but don't fail sign-up if restoration fails
            console.warn('Failed to restore approver in departments:', restoreError);
        }
        
        // Wait a moment to ensure Firestore document is fully written
        // This helps the auth state listener find the document immediately
        await new Promise(resolve => setTimeout(resolve, 300));
    } catch (docError: any) {
        // If document creation fails, the user account is still created in Firebase Auth
        // This is a critical error - user needs their Firestore document
        console.error('Failed to create user document in Firestore:', docError);
        
        // Re-throw the error so sign-up fails and user sees the error
        // This ensures the user knows there was a problem
        throw new Error(`Failed to create user profile. Please contact administrator. Error: ${docError.message || 'Permission denied'}`);
    }
    
    return user;
};

export const signOutUser = () => {
    return signOut(auth);
};

export const changeUserPassword = async (newPassword: string) => {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('No user is currently signed in');
    }
    
    return updatePassword(user, newPassword);
};

// --- FIRESTORE ---

// Generic function to get a collection
export const getCollection = async <T>(collectionName: string): Promise<T[]> => {
    const collectionRef = collection(firestore, collectionName);
    const querySnapshot = await getDocs(collectionRef);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
};

// Generic function to get a document
export const getDocument = async <T>(collectionName: string, docId: string): Promise<T | null> => {
    const docRef = doc(firestore, collectionName, docId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as T;
    }
    return null;
};

// Generic function to add a document
export const addDocument = (collectionName: string, data: object): Promise<DocumentReference> => {
    const collectionRef = collection(firestore, collectionName);
    return addDoc(collectionRef, {
        ...data,
        createdAt: serverTimestamp(),
    });
};

// Generic function to update a document
export const updateDocument = (collectionName: string, docId: string, data: object): Promise<void> => {
    const docRef = doc(firestore, collectionName, docId);
    return updateDoc(docRef, data as { [key: string]: any });
};

// Generic function to delete a document
export const deleteDocument = async (collectionName: string, docId: string): Promise<void> => {
    const docRef = doc(firestore, collectionName, docId);
    return deleteDoc(docRef);
};

// Generic real-time listener for a collection
export const listenToCollection = <T>(
    collectionName: string,
    callback: (data: T[]) => void,
    onError?: (err: Error) => void
): (() => void) => {
    const q = collection(firestore, collectionName);
    const unsubscribe = onSnapshot(
        q,
        (querySnapshot) => {
            const data = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as unknown as T));
            callback(data);
        },
        (err) => {
            console.error(`[listenToCollection] ${collectionName} error:`, err);
            onError?.(err as unknown as Error);
        }
    );
    return unsubscribe;
};

// Real-time listener for a single document
export const listenToDocument = <T>(
    collectionName: string,
    docId: string,
    callback: (data: T | null) => void,
    onError?: (err: Error) => void
): (() => void) => {
    const docRef = doc(firestore, collectionName, docId);
    const unsubscribe = onSnapshot(
        docRef,
        (docSnap) => {
            if (docSnap.exists()) {
                callback({ id: docSnap.id, ...docSnap.data() } as unknown as T);
            } else {
                callback(null);
            }
        },
        (err) => {
            console.error(`[listenToDocument] ${collectionName}/${docId} error:`, err);
            onError?.(err as unknown as Error);
        }
    );
    return unsubscribe;
};

// Real-time listener for a Firestore query
export const listenToQuery = <T>(
    q: FirestoreQuery,
    callback: (data: T[]) => void,
    onError?: (err: Error) => void
): (() => void) => {
    const unsubscribe = onSnapshot(
        q,
        (querySnapshot) => {
            const data = querySnapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            } as unknown as T));
            callback(data);
        },
        (err) => {
            console.error('[listenToQuery] error:', err);
            onError?.(err as unknown as Error);
        }
    );
    return unsubscribe;
};

export const listenToLeaveRequestsForUser = (
    userId: string,
    callback: (data: LeaveRequest[]) => void,
    onError?: (err: Error) => void
): (() => void) => {
    const q = query(
        collection(firestore, 'leaveRequests'),
        where('userId', '==', userId)
    );
    return listenToQuery<LeaveRequest>(q, callback, onError);
};

export const getLeaveRequestsForUser = async (userId: string): Promise<LeaveRequest[]> => {
    const q = query(
        collection(firestore, 'leaveRequests'),
        where('userId', '==', userId)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
};

export const fetchUsersByIds = async (ids: string[]): Promise<User[]> => {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const users: User[] = [];
    const chunkSize = 10;

    for (let i = 0; i < uniqueIds.length; i += chunkSize) {
        const chunk = uniqueIds.slice(i, i + chunkSize);
        const q = query(
            collection(firestore, 'users'),
            where(documentId(), 'in', chunk)
        );
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((d) => {
            users.push({ id: d.id, ...d.data() } as User);
        });
    }

    return users;
};

export const fetchSuperAdminUsers = async (): Promise<User[]> => {
    const q = query(
        collection(firestore, 'users'),
        where('role', '==', UserRole.SUPER_ADMIN)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(d => ({ id: d.id, ...d.data() } as User));
};

// --- ADMIN FUNCTIONS ---

// Create admin user (for initial setup)
export const createAdminUser = async (email: string, password: string, name: string) => {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    
    await updateProfile(user, { displayName: name });
    
    // Create admin user document in Firestore
    const userDocRef = doc(firestore, 'users', user.uid);
    await setDoc(userDocRef, {
        name: name,
        email: email, // Store email in Firestore
        role: UserRole.SUPER_ADMIN,
        leaveDaysTotal: 30, // More leave days for admin
        avatarUrl: `https://i.pravatar.cc/150?u=${user.uid}`,
        isActive: true,
        emailVerified: true, // Admin users are considered pre-verified
        createdAt: new Date().toISOString(),
    });
    
    return user;
};

// Update user role (admin only)
export const updateUserRole = async (userId: string, newRole: UserRole) => {
    const docRef = doc(firestore, 'users', userId);
    return updateDoc(docRef, { role: newRole });
};

// Update user leave days (admin only)
export const updateUserLeaveDays = async (userId: string, leaveDays: number) => {
    const docRef = doc(firestore, 'users', userId);
    return updateDoc(docRef, { leaveDaysTotal: leaveDays });
};

// Toggle user active status (admin only)
export const toggleUserStatus = async (userId: string, isActive: boolean) => {
    const docRef = doc(firestore, 'users', userId);
    return updateDoc(docRef, { isActive });
};

// Update existing leave requests with requesterDepartmentId and requesterName
// This is useful for updating old leave requests that were created before these fields were added
// Only updates requests that are missing these fields
export const updateLeaveRequestsWithRequesterInfo = async (): Promise<{ updated: number; skipped: number; errors: number }> => {
    try {
        console.log('🔄 Starting update of leave requests with requester info...');

        // Get all users to create a lookup map
        const usersSnapshot = await getDocs(collection(firestore, 'users'));
        const usersMap = new Map<string, { name: string; departmentId?: string; employeeNumber?: string }>();
        usersSnapshot.forEach(doc => {
            const userData = doc.data() as User;
            usersMap.set(doc.id, {
                name: userData.name,
                departmentId: userData.departmentId || undefined,
                employeeNumber: userData.employeeNumber || undefined
            });
        });
        console.log(`👥 Loaded ${usersMap.size} user(s) for lookup`);

        // Get all leave requests
        const leaveRequestsSnapshot = await getDocs(collection(firestore, 'leaveRequests'));
        console.log(`📋 Found ${leaveRequestsSnapshot.size} total leave request(s)`);

        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        const batch = writeBatch(firestore);
        let batchCount = 0;
        const BATCH_SIZE = 500; // Firestore batch limit

        // Process each leave request
        for (const requestDoc of leaveRequestsSnapshot.docs) {
            const requestData = requestDoc.data() as LeaveRequest;
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
            const updateData: any = {};
            
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
            console.log(`✅ Committed final batch of ${batchCount} updates`);
        }

        const result = {
            updated: updatedCount,
            skipped: skippedCount,
            errors: errorCount
        };

        console.log('='.repeat(50));
        console.log('📊 Update Summary:');
        console.log(`✅ Updated: ${updatedCount} leave request(s)`);
        console.log(`⏭️  Skipped: ${skippedCount} leave request(s) (already have requester info)`);
        console.log(`❌ Errors: ${errorCount} leave request(s) (user not found)`);
        console.log('='.repeat(50));

        return result;
    } catch (error) {
        console.error('❌ Error updating leave requests:', error);
        throw error;
    }
};

// Restore leave requests for an employee when they sign up again
// This function finds all leave requests with the matching employeeNumber and updates their userId
export const restoreLeaveRequestsForEmployee = async (employeeNumber: string, newUserId: string): Promise<number> => {
    try {
        // Get user document to get name and departmentId for storing in leave requests
        const userDoc = await getDocument<User>('users', newUserId);
        if (!userDoc) {
            throw new Error('User document not found');
        }
        
        // Get all existing user IDs to identify orphaned requests
        const allUsersSnapshot = await getDocs(collection(firestore, 'users'));
        const existingUserIds = new Set(allUsersSnapshot.docs.map(doc => doc.id));
        
        // Strategy 1: Find all leave requests with this employee number
        const leaveRequestsByEmployeeNumberQuery = query(
            collection(firestore, 'leaveRequests'),
            where('employeeNumber', '==', employeeNumber)
        );
        const leaveRequestsByEmployeeNumberSnapshot = await getDocs(leaveRequestsByEmployeeNumberQuery);
        
        // Strategy 2: Find orphaned leave requests (where userId doesn't exist) that might belong to this user
        // We'll check these by matching employeeNumber or requesterName
        const allLeaveRequestsSnapshot = await getDocs(collection(firestore, 'leaveRequests'));
        const orphanedRequests: Array<{ doc: any; data: any }> = [];
        
        allLeaveRequestsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            // Check if this is an orphaned request (userId doesn't exist) that might belong to this user
            if (data.userId && !existingUserIds.has(data.userId)) {
                // Match by employeeNumber or requesterName
                if (data.employeeNumber === employeeNumber || 
                    (data.requesterName && userDoc.name && data.requesterName.toLowerCase() === userDoc.name.toLowerCase())) {
                    orphanedRequests.push({ doc, data });
                }
            }
        });
        
        // Combine both sets of requests to restore
        const requestsToRestore = new Set<string>(); // Use Set to avoid duplicates
        
        // Add requests found by employeeNumber
        leaveRequestsByEmployeeNumberSnapshot.docs.forEach(doc => {
            requestsToRestore.add(doc.id);
        });
        
        // Add orphaned requests
        orphanedRequests.forEach(({ doc }) => {
            requestsToRestore.add(doc.id);
        });
        
        if (requestsToRestore.size === 0) {
            console.log(`ℹ️ No leave requests found to restore for employee ${employeeNumber}`);
            return 0; // No leave requests to restore
        }
        
        // Update all matching leave requests to use the new userId and store requester info
        const updatePromises = Array.from(requestsToRestore).map(requestId => {
            const leaveRequestRef = doc(firestore, 'leaveRequests', requestId);
            const updateData: any = {
                userId: newUserId,
                employeeNumber: employeeNumber // Ensure employeeNumber is set
            };
            
            // Update requester info for display when user is deleted
            if (userDoc.name) {
                updateData.requesterName = userDoc.name;
            }
            if (userDoc.departmentId) {
                updateData.requesterDepartmentId = userDoc.departmentId;
            }
            
            return updateDoc(leaveRequestRef, updateData);
        });
        
        await Promise.all(updatePromises);
        
        console.log(`✅ Restored ${requestsToRestore.size} leave request(s) for employee ${employeeNumber} (user ${newUserId})`);
        return requestsToRestore.size;
    } catch (error) {
        console.error('Error restoring leave requests:', error);
        throw error;
    }
};

// Restore approver assignments in departments when a deleted approver signs up again
// This function finds departments with orphaned approver IDs (pointing to deleted users)
// and matches them to the new user based on employeeNumber from leave requests
export const restoreApproverInDepartments = async (employeeNumber: string, newUserId: string): Promise<number> => {
    try {
        // Get all departments
        const departmentsSnapshot = await getDocs(collection(firestore, 'departments'));
        if (departmentsSnapshot.empty) {
            return 0;
        }
        
        // Get all existing user IDs to identify orphaned approver IDs
        const allUsersSnapshot = await getDocs(collection(firestore, 'users'));
        const existingUserIds = new Set(allUsersSnapshot.docs.map(doc => doc.id));
        
        // Get all leave requests to find matches by employeeNumber
        const allLeaveRequestsSnapshot = await getDocs(collection(firestore, 'leaveRequests'));
        
        // Create a map: oldUserId -> employeeNumber (from leave requests)
        const userIdToEmployeeNumber = new Map<string, string>();
        allLeaveRequestsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.userId && data.employeeNumber) {
                // Only map if the userId doesn't exist (is orphaned)
                if (!existingUserIds.has(data.userId)) {
                    // If we already have a mapping, keep it (don't overwrite)
                    // If multiple employeeNumbers exist for same userId, we'll use the first one found
                    // In practice, all leave requests for a user should have the same employeeNumber
                    if (!userIdToEmployeeNumber.has(data.userId)) {
                        userIdToEmployeeNumber.set(data.userId, data.employeeNumber);
                    }
                }
            }
        });
        
        let restoredCount = 0;
        const updatePromises: Promise<void>[] = [];
        
        // Check each department for orphaned approver IDs
        departmentsSnapshot.docs.forEach(deptDoc => {
            const department = deptDoc.data();
            const approverIds = department.approverIds || [];
            
            // Find orphaned approver IDs that match this employeeNumber
            const orphanedApproverIds = approverIds.filter((approverId: string) => {
                // Check if this approver ID is orphaned (doesn't exist in users)
                if (existingUserIds.has(approverId)) {
                    return false; // User exists, not orphaned
                }
                
                // Check if this orphaned approver ID has leave requests with matching employeeNumber
                const mappedEmployeeNumber = userIdToEmployeeNumber.get(approverId);
                return mappedEmployeeNumber === employeeNumber;
            });
            
            // If we found matching orphaned approver IDs, replace them with the new user ID
            if (orphanedApproverIds.length > 0) {
                const newApproverIds = approverIds.map((approverId: string) => {
                    // Replace orphaned approver ID with new user ID
                    if (orphanedApproverIds.includes(approverId)) {
                        return newUserId;
                    }
                    return approverId;
                });
                
                // Remove duplicates (in case the new user ID is already in the list)
                const uniqueApproverIds = Array.from(new Set(newApproverIds));
                
                // Update the department
                updatePromises.push(
                    updateDoc(deptDoc.ref, { approverIds: uniqueApproverIds })
                        .then(() => {
                            restoredCount++;
                            console.log(`✅ Restored approver ${newUserId} in department ${department.name || deptDoc.id}`);
                        })
                );
            }
        });
        
        await Promise.all(updatePromises);
        
        if (restoredCount > 0) {
            console.log(`✅ Restored approver assignments in ${restoredCount} department(s) for employee ${employeeNumber} (user ${newUserId})`);
        } else {
            console.log(`ℹ️ No approver assignments found to restore for employee ${employeeNumber}`);
        }
        
        return restoredCount;
    } catch (error) {
        console.error('Error restoring approver in departments:', error);
        throw error;
    }
};

// Get orphaned leave requests (where userId doesn't exist in users collection)
// These are leave requests from deleted users that can potentially be restored
export const getOrphanedLeaveRequests = async (): Promise<LeaveRequest[]> => {
    try {
        const allUsersSnapshot = await getDocs(collection(firestore, 'users'));
        const existingUserIds = new Set(allUsersSnapshot.docs.map(doc => doc.id));
        
        const allLeaveRequestsSnapshot = await getDocs(collection(firestore, 'leaveRequests'));
        const orphanedRequests: LeaveRequest[] = [];
        
        allLeaveRequestsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.userId && !existingUserIds.has(data.userId)) {
                orphanedRequests.push({
                    id: doc.id,
                    ...data
                } as LeaveRequest);
            }
        });
        
        return orphanedRequests;
    } catch (error) {
        console.error('Error getting orphaned leave requests:', error);
        throw error;
    }
};

// Manually restore leave requests for a user by updating their userIds
export const restoreLeaveRequestsByUserIds = async (leaveRequestIds: string[], newUserId: string): Promise<number> => {
    try {
        // Get user document to get employeeNumber and other info
        const userDoc = await getDocument<User>('users', newUserId);
        if (!userDoc) {
            throw new Error('User not found');
        }
        
        const updatePromises = leaveRequestIds.map(requestId => {
            const leaveRequestRef = doc(firestore, 'leaveRequests', requestId);
            const updateData: any = {
                userId: newUserId
            };
            
            // Add employeeNumber if available
            if (userDoc.employeeNumber) {
                updateData.employeeNumber = userDoc.employeeNumber;
            }
            
            // Add requester info for display when user is deleted
            if (userDoc.name) {
                updateData.requesterName = userDoc.name;
            }
            if (userDoc.departmentId) {
                updateData.requesterDepartmentId = userDoc.departmentId;
            }
            
            return updateDoc(leaveRequestRef, updateData);
        });
        
        await Promise.all(updatePromises);
        
        console.log(`✅ Restored ${leaveRequestIds.length} leave request(s) for user ${newUserId}`);
        return leaveRequestIds.length;
    } catch (error) {
        console.error('Error restoring leave requests:', error);
        throw error;
    }
};

// Delete user completely (Super Admin only)
// This deletes the user document from Firestore
// Note: To delete from Firebase Auth, you need Admin SDK (Cloud Function or local script)
// 
// By default, leave requests are RETAINED (deleteLeaveRequests = false)
// This allows the user's leave history to be preserved if they sign up again
// Before deleting, we store requester info in leave requests so they remain visible in approval/calendar views
export const deleteUser = async (userId: string, deleteLeaveRequests: boolean = false) => {
    // Get user info before deletion
    const userDoc = await getDocument<User>('users', userId);
    if (!userDoc) {
        throw new Error('User not found');
    }
    
    // Optionally delete all leave requests for this user
    // Default is false - leave requests are retained for data preservation
    if (deleteLeaveRequests) {
        const leaveRequestsQuery = query(
            collection(firestore, 'leaveRequests'),
            where('userId', '==', userId)
        );
        const leaveRequestsSnapshot = await getDocs(leaveRequestsQuery);
        const deletePromises = leaveRequestsSnapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
    } else {
        // Before deleting user, update all their leave requests to store requester info
        // This ensures leave requests remain visible in approval and calendar views after user deletion
        const leaveRequestsQuery = query(
            collection(firestore, 'leaveRequests'),
            where('userId', '==', userId)
        );
        const leaveRequestsSnapshot = await getDocs(leaveRequestsQuery);
        
        if (!leaveRequestsSnapshot.empty) {
            const updatePromises = leaveRequestsSnapshot.docs.map(doc => {
                const leaveRequestRef = doc.ref;
                const updateData: any = {};
                
                // Store requester info for display when user is deleted
                if (userDoc.name && !doc.data().requesterName) {
                    updateData.requesterName = userDoc.name;
                }
                if (userDoc.departmentId && !doc.data().requesterDepartmentId) {
                    updateData.requesterDepartmentId = userDoc.departmentId;
                }
                if (userDoc.employeeNumber && !doc.data().employeeNumber) {
                    updateData.employeeNumber = userDoc.employeeNumber;
                }
                
                // Only update if there's data to update
                if (Object.keys(updateData).length > 0) {
                    return updateDoc(leaveRequestRef, updateData);
                }
                return Promise.resolve();
            });
            
            await Promise.all(updatePromises);
            console.log(`✅ Updated ${leaveRequestsSnapshot.size} leave request(s) with requester info before user deletion`);
        }
    }
    
    // Delete the user document from Firestore
    const userDocRef = doc(firestore, 'users', userId);
    await deleteDoc(userDocRef);
    
    // Note: Firebase Auth account deletion requires Admin SDK
    // The user's Auth account will remain but won't be able to sign in without the Firestore document
    // To fully delete from Auth, use a Cloud Function or Admin SDK script
    //
    // Note: Leave requests are retained by default with stored requester info.
    // They will remain visible in approval and calendar views even after user deletion.
    // If the user signs up again, their leave requests can be restored using the employeeNumber.
    //
    // Note: Approvers are NOT removed from department approver lists when a user is deleted.
    // This ensures that historical approval records and department configurations remain intact.
    // Deleted approvers will be displayed with a "(Deleted)" indicator in the department settings.
};

// Clear all leave requests (super admin only)
export const clearAllLeaveRequests = async () => {
    try {
        const leaveRequestsSnapshot = await getDocs(collection(firestore, 'leaveRequests'));
        const deletePromises = leaveRequestsSnapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        return { success: true, count: leaveRequestsSnapshot.size };
    } catch (error) {
        console.error('Error clearing leave requests:', error);
        throw error;
    }
};

// Update user email verification status in Firestore
export const updateUserVerificationStatus = async (userId: string, isEmailVerified: boolean) => {
    try {
        const userDocRef = doc(firestore, 'users', userId);
        await updateDoc(userDocRef, { 
            emailVerified: isEmailVerified,
            lastVerificationCheck: new Date().toISOString()
        });
        console.log(`Updated verification status for user ${userId}: ${isEmailVerified}`);
    } catch (error) {
        console.error('Error updating user verification status:', error);
        throw error;
    }
};

// --- USER MANAGEMENT ---

// Update existing user with email (for fixing existing users without email)
export const updateUserEmail = async (userId: string, email: string) => {
    const userDocRef = doc(firestore, 'users', userId);
    await updateDoc(userDocRef, {
        email: email,
        updatedAt: serverTimestamp()
    });
};

export const createUser = async (name: string, email: string, password: string, role: UserRole, departmentId?: string) => {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    
    await updateProfile(user, { displayName: name });
    
    // Create user document in Firestore
    const userDocRef = doc(firestore, 'users', user.uid);
    const userData: any = {
        name: name,
        email: email, // Store email in Firestore
        role: role,
        departmentId: departmentId || null,
        isActive: true,
        emailVerified: false, // New users need to verify email
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
    
    await setDoc(userDocRef, userData);
    
    return user;
};

export const updateUser = async (userId: string, userData: { name?: string, email?: string, role?: UserRole, departmentId?: string | null, branchOverride?: string | null, payGroup?: string, branches?: string[] | null, adminDepartments?: string[] | null }) => {
    const userDocRef = doc(firestore, 'users', userId);
    const updateData: any = {
        updatedAt: serverTimestamp()
    };
    
    // Only include fields that are defined
    if (userData.name !== undefined) updateData.name = userData.name;
    if (userData.email !== undefined) updateData.email = userData.email;
    if (userData.role !== undefined) updateData.role = userData.role;
    if (userData.departmentId !== undefined) {
        if (userData.departmentId === null || userData.departmentId === '') {
            updateData.departmentId = deleteField();
        } else {
            updateData.departmentId = userData.departmentId;
        }
    }
    if (userData.payGroup !== undefined) updateData.payGroup = userData.payGroup === '6' ? '6' : '5';
    if (userData.branchOverride !== undefined) {
        if (userData.branchOverride === null || userData.branchOverride === '') {
            updateData.branchOverride = deleteField();
        } else {
            updateData.branchOverride = userData.branchOverride;
        }
    }
    
    // Handle branches field: include it if it's an array, remove it if it's null
    if (userData.branches !== undefined) {
        if (userData.branches === null) {
            // Use deleteField() to remove the field from Firestore
            updateData.branches = deleteField();
        } else {
            updateData.branches = userData.branches;
        }
    }
    
    // Handle adminDepartments field: include it if it's an array, remove it if it's null
    if (userData.adminDepartments !== undefined) {
        if (userData.adminDepartments === null) {
            // Use deleteField() to remove the field from Firestore
            updateData.adminDepartments = deleteField();
        } else {
            updateData.adminDepartments = userData.adminDepartments;
        }
    }
    
    await updateDoc(userDocRef, updateData);
};

// --- DEPARTMENT MANAGEMENT ---

export const createDepartment = async (name: string, branch: string, approverIds: string[] = [], ccEmails: string[] = []) => {
    const departmentData = {
        name: name,
        branch: branch,
        approverIds: approverIds,
        ccEmails: ccEmails,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
    
    const docRef = await addDoc(collection(firestore, 'departments'), departmentData);
    return docRef.id;
};

export const updateDepartment = async (departmentId: string, departmentData: { name?: string; branch?: string; approverIds?: string[]; ccEmails?: string[] }) => {
    const departmentDocRef = doc(firestore, 'departments', departmentId);
    const updateData: any = {
        ...departmentData,
        updatedAt: serverTimestamp()
    };
    
    await updateDoc(departmentDocRef, updateData);
};

export const getUsersInDepartment = async (departmentId: string) => {
    const usersQuery = query(
        collection(firestore, 'users'),
        where('departmentId', '==', departmentId)
    );
    const usersSnapshot = await getDocs(usersQuery);
    return usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
};

export const deleteDepartment = async (departmentId: string) => {
    // First check if there are any users assigned to this department
    const usersInDepartment = await getUsersInDepartment(departmentId);
    
    if (usersInDepartment.length > 0) {
        throw new Error(`Cannot delete department. There are ${usersInDepartment.length} user(s) assigned to this department. Please reassign or remove users first.`);
    }
    
    // If no users are assigned, delete the department
    const departmentDocRef = doc(firestore, 'departments', departmentId);
    await deleteDoc(departmentDocRef);
};

// Send email verification
export const sendEmailVerificationToUser = async (user: FirebaseUser) => {
    return sendEmailVerification(user);
};

// Send password reset email
export const sendPasswordResetEmailToUser = async (email: string) => {
    return sendPasswordResetEmail(auth, email);
};

// Reset user password (Super Admin only)
// Uses Firebase Cloud Function to set a new password directly via Admin SDK
// Note: Passwords are hashed and cannot be viewed. Super Admin sets the new password directly.
export const resetUserPassword = async (userId: string, newPassword: string): Promise<void> => {
    // Validate password
    if (!newPassword || newPassword.length < 6) {
        throw new Error('Password must be at least 6 characters long');
    }
    
    // Get current user's auth token for authentication
    const currentUser = auth.currentUser;
    if (!currentUser) {
        throw new Error('You must be logged in to reset passwords');
    }
    
    // Get ID token for authentication
    const idToken = await currentUser.getIdToken();
    
    // Get user document to find their auth email
    const userDoc = await getDocument<User>('users', userId);
    if (!userDoc) {
        throw new Error('User not found');
    }
    
    // Get the auth email (either from authEmail field or generate from employeeNumber)
    let authEmail: string;
    if ((userDoc as any).authEmail) {
        authEmail = (userDoc as any).authEmail;
    } else if (userDoc.employeeNumber) {
        authEmail = generateEmailFromEmployeeNumber(userDoc.employeeNumber);
    } else {
        throw new Error('User does not have an employee number or auth email');
    }
    
    // Get Cloud Functions URL (set VITE_FUNCTIONS_URL or derive from Firebase project id)
    const functionsBase =
        import.meta.env.VITE_FUNCTIONS_URL ||
        `https://us-central1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;
    const functionsUrl = `${functionsBase.replace(/\/$/, '')}/resetUserPassword`;
    
    // Call Cloud Function to set new password
    try {
        const response = await fetch(functionsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                userId: userId,
                authEmail: authEmail,
                newPassword: newPassword
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `Failed to reset password: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.message || 'Failed to reset password');
        }
    } catch (error: any) {
        throw new Error(`Failed to reset password: ${error.message}`);
    }
};

// --- EMPLOYEE MANAGEMENT ---

// Get all employees
export const getEmployees = async () => {
    return getCollection<{ id: string; employeeNumber: string; employeeName: string; payGroup?: string; createdAt: string; updatedAt?: string }>('employees');
};

// Get employee by employee number
export const getEmployeeByNumber = async (employeeNumber: string) => {
    const employeesQuery = query(
        collection(firestore, 'employees'),
        where('employeeNumber', '==', employeeNumber)
    );
    const employeesSnapshot = await getDocs(employeesQuery);
    if (!employeesSnapshot.empty) {
        const doc = employeesSnapshot.docs[0];
        return { id: doc.id, ...doc.data() } as { id: string; employeeNumber: string; employeeName: string; payGroup?: string; createdAt: string; updatedAt?: string };
    }
    return null;
};

// Check if employee number is already used by a user
export const checkEmployeeNumberExists = async (employeeNumber: string) => {
    const usersQuery = query(
        collection(firestore, 'users'),
        where('employeeNumber', '==', employeeNumber)
    );
    const usersSnapshot = await getDocs(usersQuery);
    return !usersSnapshot.empty;
};

// Create or update employee
export const saveEmployee = async (employeeNumber: string, employeeName: string, payGroup: string = '5') => {
    const normalizedPayGroup = payGroup === '6' ? '6' : '5';
    // Check if employee with this number already exists
    const employeesQuery = query(
        collection(firestore, 'employees'),
        where('employeeNumber', '==', employeeNumber)
    );
    const existingEmployees = await getDocs(employeesQuery);

    if (!existingEmployees.empty) {
        // Update existing employee
        const existingDoc = existingEmployees.docs[0];
        const docRef = doc(firestore, 'employees', existingDoc.id);
        await updateDoc(docRef, {
            employeeName: employeeName,
            payGroup: normalizedPayGroup,
            updatedAt: serverTimestamp()
        });
        await syncEmployeePayGroupToUser(employeeNumber, normalizedPayGroup);
        return existingDoc.id;
    } else {
        // Create new employee
        const employeeData = {
            employeeNumber: employeeNumber,
            employeeName: employeeName,
            payGroup: normalizedPayGroup,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        const docRef = await addDoc(collection(firestore, 'employees'), employeeData);
        await syncEmployeePayGroupToUser(employeeNumber, normalizedPayGroup);
        return docRef.id;
    }
};

const syncEmployeePayGroupToUser = async (employeeNumber: string, payGroup: string): Promise<void> => {
    const usersQuery = query(
        collection(firestore, 'users'),
        where('employeeNumber', '==', employeeNumber)
    );
    const usersSnapshot = await getDocs(usersQuery);
    await Promise.all(usersSnapshot.docs.map(userDoc => updateDoc(userDoc.ref, {
        payGroup,
        updatedAt: serverTimestamp()
    })));
};

// Bulk save employees
export const bulkSaveEmployees = async (employees: Array<{ employeeNumber: string; employeeName: string; payGroup?: string }>) => {
    const results = [];
    for (const employee of employees) {
        try {
            const id = await saveEmployee(employee.employeeNumber, employee.employeeName, employee.payGroup || '5');
            results.push({ success: true, employeeNumber: employee.employeeNumber, employeeName: employee.employeeName, payGroup: employee.payGroup || '5', id });
        } catch (error: any) {
            results.push({ success: false, employeeNumber: employee.employeeNumber, employeeName: employee.employeeName, payGroup: employee.payGroup || '5', error: error.message });
        }
    }
    return results;
};

// Delete employee
export const deleteEmployee = async (employeeId: string) => {
    const docRef = doc(firestore, 'employees', employeeId);
    await deleteDoc(docRef);
};

// Clear all employees
export const clearAllEmployees = async () => {
    try {
        const employeesSnapshot = await getDocs(collection(firestore, 'employees'));
        const deletePromises = employeesSnapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        return { success: true, count: employeesSnapshot.size };
    } catch (error) {
        console.error('Error clearing employees:', error);
        throw error;
    }
};

// --- EMAIL NOTIFICATIONS ---

const formatDateDDMMYYYY = (dateString: string) => {
    const date = new Date(dateString);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

// Send leave request notification to approvers and requester
export const sendLeaveRequestNotification = async (
    requesterName: string,
    requesterEmail: string,
    approverEmails: string[],
    ccEmails: string[],
    leaveType: string,
    startDate: string,
    endDate: string,
    startTime: string,
    endTime: string,
    reason: string = '',
    departmentName: string = '',
    attachments?: File[],
    payGroup: string = '5'
) => {
    try {
        // Import the email service functions
        const { sendLeaveRequestNotification: sendEmail } = await import('./emailService');
        
        // Use the new email service
        const results = await sendEmail(
            requesterName,
            requesterEmail,
            approverEmails,
            ccEmails,
            leaveType,
            startDate,
            endDate,
            startTime,
            endTime,
            reason,
            departmentName,
            attachments,
            payGroup
        );
        
        // Log results for debugging
        console.log('Email notification results:', results);
        
        return results;
    } catch (error) {
        console.error('Failed to send leave request notification:', error);
        
        // Fallback to console logging if email service fails
        const subject = `New Leave Request from ${requesterName}`;
        const approverMessage = `
Dear Approver,

A new leave request has been submitted and requires your approval:

Employee: ${requesterName}
Leave Type: ${leaveType}
Start Date: ${formatDateDDMMYYYY(startDate)} (${startTime})
End Date: ${formatDateDDMMYYYY(endDate)} (${endTime})
Reason: ${reason}

Please log in to the system to review and approve/reject this request.

Best regards,
LeaveApp
        `;

        console.log('=== EMAIL NOTIFICATION (FALLBACK) ===');
        console.log('TO APPROVERS:', approverEmails.join(', '));
        console.log('CC:', ccEmails.length > 0 ? ccEmails.join(', ') : 'None');
        console.log('SUBJECT:', subject);
        console.log('MESSAGE:', approverMessage);
        console.log('=====================================');
        
        return [{ success: false, error: 'Email service not available' }];
    }
};

// Send leave approval/rejection notification to requester
export const sendLeaveDecisionNotification = async (
    requesterName: string,
    requesterEmail: string,
    approverName: string,
    leaveType: string,
    startDate: string,
    endDate: string,
    startTime: string,
    endTime: string,
    status: 'Approved' | 'Rejected',
    ccEmails: string[],
    comments?: string,
    rejectionReason?: string,
    payGroup: string = '5'
) => {
    try {
        // Import the email service functions
        const { sendLeaveDecisionNotification: sendEmail } = await import('./emailService');
        
        // Use the new email service
        const result = await sendEmail(
            requesterName,
            requesterEmail,
            approverName,
            leaveType,
            startDate,
            endDate,
            startTime,
            endTime,
            status,
            ccEmails,
            comments,
            rejectionReason,
            payGroup
        );
        
        // Log result for debugging
        console.log('Email decision notification result:', result);
        
        return result;
    } catch (error) {
        console.error('Failed to send leave decision notification:', error);
        
        // Fallback to console logging if email service fails
        const subject = `Leave Request ${status} - ${leaveType}`;
        const message = `
Dear ${requesterName},

Your leave request has been ${status.toLowerCase()}:

Leave Type: ${leaveType}
Start Date: ${formatDateDDMMYYYY(startDate)} (${startTime})
End Date: ${formatDateDDMMYYYY(endDate)} (${endTime})
Status: ${status}
Approved by: ${approverName}
${comments ? `Comments: ${comments}` : ''}

${status === 'Approved' 
    ? 'Your leave has been approved. Please ensure proper handover of your duties before your leave period.'
    : 'Your leave request has been rejected. Please contact your supervisor if you have any questions.'
}

Best regards,
LeaveApp
        `;

        console.log('=== EMAIL NOTIFICATION (FALLBACK) ===');
        console.log('TO:', requesterEmail);
        console.log('CC:', ccEmails.length > 0 ? ccEmails.join(', ') : 'None');
        console.log('SUBJECT:', subject);
        console.log('MESSAGE:', message);
        console.log('=====================================');
        
        return { success: false, error: 'Email service not available' };
    }
};

// --- SMTP CONFIGURATION ---

// Get SMTP configuration
export const getSMTPConfig = async () => {
    try {
        const docRef = doc(firestore, 'config', 'smtp');
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data() : null;
    } catch (error) {
        console.error('Error getting SMTP config:', error);
        return null;
    }
};

// Save SMTP configuration
export const saveSMTPConfig = async (config: any) => {
    try {
        const docRef = doc(firestore, 'config', 'smtp');
        const configData = {
            ...config,
            updatedAt: new Date().toISOString(),
        };
        await setDoc(docRef, configData, { merge: true });
        return true;
    } catch (error) {
        console.error('Error saving SMTP config:', error);
        return false;
    }
};

// Test SMTP configuration
export const testSMTPConfig = async (config: any) => {
    // Note: In a real implementation, you would test the SMTP connection
    // For now, we'll simulate a test
    console.log('=== SMTP TEST ===');
    console.log('Testing SMTP configuration:', {
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username,
        fromEmail: config.fromEmail,
        fromName: config.fromName
    });
    console.log('SMTP test completed successfully');
    console.log('==================');
    
    // Simulate success
    return { success: true, message: 'SMTP configuration test successful!' };
};

// --- LEAVE BALANCE HISTORY ---

// Upload leave balance history records and update current balance reference table
export const uploadLeaveBalanceHistory = async (records: Omit<LeaveBalanceHistory, 'id'>[]): Promise<void> => {
    try {
        // Remove all existing history so that we only keep the latest upload
        const existingHistorySnapshot = await getDocs(collection(firestore, 'leaveBalanceHistory'));
        if (!existingHistorySnapshot.empty) {
            const MAX_BATCH_SIZE = 500;
            const deleteBatches: any[] = [];
            let currentDeleteBatch = writeBatch(firestore);
            let deleteCount = 0;

            existingHistorySnapshot.forEach((docSnapshot) => {
                if (deleteCount >= MAX_BATCH_SIZE) {
                    deleteBatches.push(currentDeleteBatch);
                    currentDeleteBatch = writeBatch(firestore);
                    deleteCount = 0;
                }
                currentDeleteBatch.delete(docSnapshot.ref);
                deleteCount++;
            });

            if (deleteCount > 0) {
                deleteBatches.push(currentDeleteBatch);
            }

            await Promise.all(deleteBatches.map(batch => batch.commit()));
            console.log(`Deleted ${existingHistorySnapshot.size} previous leave balance history records`);
        }

        // Upload history records
        const batchPromises = records.map(record => {
            return addDoc(collection(firestore, 'leaveBalanceHistory'), {
                ...record,
                createdAt: serverTimestamp()
            });
        });
        await Promise.all(batchPromises);
        console.log(`Uploaded ${records.length} leave balance history records`);
        
        // Replace all current leave balances with the new data
        const currentBalances = records.map(record => ({
            employeeNumber: record.employeeNumber,
            leaveBalance: record.leaveBalance,
            effectiveDate: record.effectiveDate
        }));
        
        await replaceAllCurrentLeaveBalances(currentBalances, records[0]?.uploadedBy || '');
        console.log(`Updated current leave balance reference table with ${currentBalances.length} records`);
    } catch (error) {
        console.error('Error uploading leave balance history:', error);
        throw new Error('Failed to upload leave balance history');
    }
};

// Get leave balance history for a specific employee number
export const getLeaveBalanceHistoryByEmployee = async (employeeNumber: string): Promise<LeaveBalanceHistory[]> => {
    try {
        const q = query(
            collection(firestore, 'leaveBalanceHistory'),
            where('employeeNumber', '==', employeeNumber)
        );
        const querySnapshot = await getDocs(q);
        const history: LeaveBalanceHistory[] = [];
        querySnapshot.forEach((doc) => {
            history.push({
                id: doc.id,
                ...doc.data()
            } as LeaveBalanceHistory);
        });
        // Sort by effective date descending (most recent first)
        history.sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime());
        return history;
    } catch (error) {
        console.error('Error getting leave balance history:', error);
        throw new Error('Failed to get leave balance history');
    }
};

// Get the most recent leave balance history record for an employee (1 doc read)
export const getLatestLeaveBalanceHistory = async (employeeNumber: string): Promise<LeaveBalanceHistory | null> => {
    try {
        const q = query(
            collection(firestore, 'leaveBalanceHistory'),
            where('employeeNumber', '==', employeeNumber),
            orderBy('effectiveDate', 'desc'),
            limit(1)
        );
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            return null;
        }

        const docSnap = querySnapshot.docs[0];
        return { id: docSnap.id, ...docSnap.data() } as LeaveBalanceHistory;
    } catch (error: unknown) {
        const firestoreError = error as { code?: string };
        if (firestoreError.code === 'failed-precondition') {
            const history = await getLeaveBalanceHistoryByEmployee(employeeNumber);
            return history.length > 0 ? history[0] : null;
        }
        console.error('Error getting latest leave balance history:', error);
        throw new Error('Failed to get latest leave balance history');
    }
};

// Get leave balance as of a specific date for an employee
export const getLeaveBalanceAsOfDate = async (employeeNumber: string, asOfDate: string): Promise<number | null> => {
    try {
        const q = query(
            collection(firestore, 'leaveBalanceHistory'),
            where('employeeNumber', '==', employeeNumber),
            where('effectiveDate', '<=', asOfDate),
            orderBy('effectiveDate', 'desc'),
            limit(1)
        );
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            return null; // No history found
        }

        // Get the first (most recent) record
        const doc = querySnapshot.docs[0];
        const record = {
            id: doc.id,
            ...doc.data()
        } as LeaveBalanceHistory;

        return record.leaveBalance;
    } catch (error: any) {
        // If the error is about missing index, try without orderBy
        if (error.code === 'failed-precondition') {
            console.warn('Index not found, falling back to in-memory sorting');
            try {
                const q = query(
                    collection(firestore, 'leaveBalanceHistory'),
                    where('employeeNumber', '==', employeeNumber),
                    where('effectiveDate', '<=', asOfDate)
                );
                const querySnapshot = await getDocs(q);
                
                if (querySnapshot.empty) {
                    return null;
                }

                // Find the most recent record in memory
                let latestRecord: LeaveBalanceHistory | null = null;
                let latestDate = '';
                
                querySnapshot.forEach((doc) => {
                    const record = {
                        id: doc.id,
                        ...doc.data()
                    } as LeaveBalanceHistory;
                    
                    if (record.effectiveDate <= asOfDate && record.effectiveDate > latestDate) {
                        latestRecord = record;
                        latestDate = record.effectiveDate;
                    }
                });

                return latestRecord ? latestRecord.leaveBalance : null;
            } catch (fallbackError) {
                console.error('Error getting leave balance as of date (fallback):', fallbackError);
                throw new Error('Failed to get leave balance as of date');
            }
        }
        console.error('Error getting leave balance as of date:', error);
        throw new Error('Failed to get leave balance as of date');
    }
};

// Get all leave balance history (for admin view)
export const getAllLeaveBalanceHistory = async (): Promise<LeaveBalanceHistory[]> => {
    try {
        const querySnapshot = await getDocs(collection(firestore, 'leaveBalanceHistory'));
        const history: LeaveBalanceHistory[] = [];
        querySnapshot.forEach((doc) => {
            history.push({
                id: doc.id,
                ...doc.data()
            } as LeaveBalanceHistory);
        });
        // Sort by effective date descending, then by employee number
        history.sort((a, b) => {
            const dateCompare = new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime();
            if (dateCompare !== 0) return dateCompare;
            return a.employeeNumber.localeCompare(b.employeeNumber);
        });
        return history;
    } catch (error) {
        console.error('Error getting all leave balance history:', error);
        throw new Error('Failed to get leave balance history');
    }
};

// --- LEAVE BALANCE CURRENT (Reference Table) ---

// Replace all current leave balances (used when uploading new balance data)
export const replaceAllCurrentLeaveBalances = async (
    balances: Array<{ employeeNumber: string; leaveBalance: number; effectiveDate: string }>,
    updatedBy: string
): Promise<void> => {
    try {
        // First, delete all existing current balances (in batches if needed)
        const currentBalancesSnapshot = await getDocs(collection(firestore, 'leaveBalanceCurrent'));
        const MAX_BATCH_SIZE = 500; // Firestore batch limit
        
        // Delete existing records in batches
        const deleteBatches: any[] = [];
        let currentDeleteBatch = writeBatch(firestore);
        let deleteCount = 0;
        
        currentBalancesSnapshot.forEach((docSnapshot) => {
            if (deleteCount >= MAX_BATCH_SIZE) {
                deleteBatches.push(currentDeleteBatch);
                currentDeleteBatch = writeBatch(firestore);
                deleteCount = 0;
            }
            currentDeleteBatch.delete(docSnapshot.ref);
            deleteCount++;
        });
        
        if (deleteCount > 0) {
            deleteBatches.push(currentDeleteBatch);
        }
        
        // Execute all delete batches
        await Promise.all(deleteBatches.map(batch => batch.commit()));
        console.log(`Deleted ${currentBalancesSnapshot.size} existing leave balance records`);
        
        // Add all new records in batches
        const now = new Date().toISOString();
        const createBatches: any[] = [];
        let currentCreateBatch = writeBatch(firestore);
        let createCount = 0;
        
        balances.forEach((balance) => {
            if (createCount >= MAX_BATCH_SIZE) {
                createBatches.push(currentCreateBatch);
                currentCreateBatch = writeBatch(firestore);
                createCount = 0;
            }
            const docRef = doc(collection(firestore, 'leaveBalanceCurrent'));
            currentCreateBatch.set(docRef, {
                employeeNumber: balance.employeeNumber,
                leaveBalance: balance.leaveBalance,
                effectiveDate: balance.effectiveDate,
                updatedAt: now,
                updatedBy: updatedBy
            });
            createCount++;
        });
        
        if (createCount > 0) {
            createBatches.push(currentCreateBatch);
        }
        
        // Execute all create batches
        await Promise.all(createBatches.map(batch => batch.commit()));
        console.log(`Replaced ${balances.length} current leave balance records`);
    } catch (error) {
        console.error('Error replacing current leave balances:', error);
        throw new Error('Failed to replace current leave balances');
    }
};

// Get current leave balance for an employee
export const getCurrentLeaveBalance = async (employeeNumber: string): Promise<number | null> => {
    try {
        const q = query(
            collection(firestore, 'leaveBalanceCurrent'),
            where('employeeNumber', '==', employeeNumber),
            limit(1)
        );
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            return null; // No current balance found
        }
        
        const doc = querySnapshot.docs[0];
        const data = doc.data();
        return data.leaveBalance || null;
    } catch (error) {
        console.error('Error getting current leave balance:', error);
        throw new Error('Failed to get current leave balance');
    }
};

// --- FILE STORAGE ---

// Upload file to Firebase Storage
export const uploadFile = async (file: File, path: string): Promise<string> => {
    try {
        const storageRef = ref(storage, path);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        return downloadURL;
    } catch (error) {
        console.error('Error uploading file:', error);
        throw new Error('Failed to upload file');
    }
};

// Delete file from Firebase Storage
export const deleteFile = async (filePath: string): Promise<void> => {
    try {
        const storageRef = ref(storage, filePath);
        await deleteObject(storageRef);
    } catch (error) {
        console.error('Error deleting file:', error);
        throw new Error('Failed to delete file');
    }
};

// Generate unique file path for leave request attachments
export const generateAttachmentPath = (userId: string, requestId: string, fileName: string): string => {
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `leave-attachments/${userId}/${requestId}/${timestamp}_${sanitizedFileName}`;
};

// --- PUBLIC HOLIDAY SETS ---

// Get all public holiday sets
export const getPublicHolidaySets = async (): Promise<PublicHolidaySet[]> => {
    try {
        // Use single orderBy to avoid composite index requirement, then sort in memory
        const q = query(collection(firestore, 'publicHolidaySets'), orderBy('year', 'desc'));
        const querySnapshot = await getDocs(q);
        const sets = querySnapshot.docs.map(doc => {
            const data = doc.data();
            // Handle backward compatibility: convert old format (string[]) to new format (PublicHoliday[])
            let holidays = data.holidays || [];
            if (Array.isArray(holidays) && holidays.length > 0) {
                if (typeof holidays[0] === 'string') {
                    // Old format - convert to new format
                    holidays = holidays.map((date: string) => ({
                        date,
                        name: 'Public Holiday'
                    }));
                }
            }
            return {
                id: doc.id,
                ...data,
                holidays,
                uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || data.uploadedAt || new Date().toISOString(),
                updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt
            } as PublicHolidaySet;
        });
        
        // Sort by year (desc) then by name (asc) in memory
        return sets.sort((a, b) => {
            if (a.year !== b.year) {
                return b.year - a.year; // Descending by year
            }
            return a.name.localeCompare(b.name); // Ascending by name
        });
    } catch (error) {
        console.error('Error fetching public holiday sets:', error);
        throw error;
    }
};

// Get default public holiday set for a specific year
export const getDefaultPublicHolidaySet = async (year?: number): Promise<PublicHolidaySet | null> => {
    try {
        // If no year specified, use current year
        const targetYear = year || new Date().getFullYear();
        
        const q = query(
            collection(firestore, 'publicHolidaySets'), 
            where('isDefault', '==', true),
            where('year', '==', targetYear),
            limit(1)
        );
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) return null;
        const data = querySnapshot.docs[0].data();
        // Handle backward compatibility: convert old format (string[]) to new format (PublicHoliday[])
        let holidays = data.holidays || [];
        
        if (Array.isArray(holidays) && holidays.length > 0) {
            if (typeof holidays[0] === 'string') {
                // Old format - convert to new format
                holidays = holidays.map((date: string) => ({
                    date,
                    name: 'Public Holiday'
                }));
            } else {
                // New format - validate dates
                holidays = holidays.map((h: any) => {
                    if (h && h.date) {
                        // Ensure date is in correct format
                        if (!h.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            // Try to normalize
                            const date = new Date(h.date);
                            if (!isNaN(date.getTime())) {
                                const year = date.getFullYear();
                                const month = String(date.getMonth() + 1).padStart(2, '0');
                                const day = String(date.getDate()).padStart(2, '0');
                                return { date: `${year}-${month}-${day}`, name: h.name || 'Public Holiday' };
                            }
                            return null;
                        }
                        return { date: h.date, name: h.name || 'Public Holiday' };
                    }
                    return null;
                }).filter((h: any) => h !== null); // Remove invalid entries
            }
        }
        
        return {
            id: querySnapshot.docs[0].id,
            ...data,
            holidays,
            uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || data.uploadedAt || new Date().toISOString(),
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt
        } as PublicHolidaySet;
    } catch (error) {
        console.error('Error fetching default public holiday set:', error);
        throw error;
    }
};

// Get public holiday set by ID
export const getPublicHolidaySetById = async (id: string): Promise<PublicHolidaySet | null> => {
    try {
        const docRef = doc(firestore, 'publicHolidaySets', id);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return null;
        const data = docSnap.data();
        // Handle backward compatibility: convert old format (string[]) to new format (PublicHoliday[])
        let holidays = data.holidays || [];
        if (Array.isArray(holidays) && holidays.length > 0) {
            if (typeof holidays[0] === 'string') {
                // Old format - convert to new format
                holidays = holidays.map((date: string) => ({
                    date,
                    name: 'Public Holiday'
                }));
            }
        }
        return {
            id: docSnap.id,
            ...data,
            holidays,
            uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() || data.uploadedAt || new Date().toISOString(),
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt
        } as PublicHolidaySet;
    } catch (error) {
        console.error('Error fetching public holiday set:', error);
        throw error;
    }
};

// Add new public holiday set
export const addPublicHolidaySet = async (holidaySet: Omit<PublicHolidaySet, 'id' | 'uploadedAt' | 'updatedAt'>): Promise<string> => {
    try {
        // If this is set as default, unset all other defaults for the same year
        if (holidaySet.isDefault) {
            const existingDefaults = await getDocs(
                query(
                    collection(firestore, 'publicHolidaySets'), 
                    where('isDefault', '==', true),
                    where('year', '==', holidaySet.year)
                )
            );
            const batch = writeBatch(firestore);
            existingDefaults.docs.forEach(doc => {
                batch.update(doc.ref, { isDefault: false });
            });
            await batch.commit();
        }

        // Remove uploadedAt and updatedAt from holidaySet since we'll use serverTimestamp
        const { uploadedAt, updatedAt, ...holidaySetData } = holidaySet;
        
        const docRef = await addDoc(collection(firestore, 'publicHolidaySets'), {
            ...holidaySetData,
            uploadedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        
        return docRef.id;
    } catch (error) {
        console.error('Error adding public holiday set:', error);
        throw error;
    }
};

// Update public holiday set
export const updatePublicHolidaySet = async (id: string, updates: Partial<PublicHolidaySet>): Promise<void> => {
    try {
        const docRef = doc(firestore, 'publicHolidaySets', id);
        
        // If setting as default, unset all other defaults for the same year
        if (updates.isDefault === true) {
            // Get the current document to know the year
            const currentDoc = await getDoc(docRef);
            const currentYear = currentDoc.exists() ? currentDoc.data().year : updates.year;
            
            if (currentYear) {
                const existingDefaults = await getDocs(
                    query(
                        collection(firestore, 'publicHolidaySets'), 
                        where('isDefault', '==', true),
                        where('year', '==', currentYear)
                    )
                );
                const batch = writeBatch(firestore);
                existingDefaults.docs.forEach(doc => {
                    if (doc.id !== id) {
                        batch.update(doc.ref, { isDefault: false });
                    }
                });
                await batch.commit();
            }
        }

        // Remove updatedAt from updates since we'll use serverTimestamp
        const { updatedAt: _, ...updateData } = updates;
        await updateDoc(docRef, {
            ...updateData,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error('Error updating public holiday set:', error);
        throw error;
    }
};

// Delete public holiday set
export const deletePublicHolidaySet = async (id: string): Promise<void> => {
    try {
        const docRef = doc(firestore, 'publicHolidaySets', id);
        await deleteDoc(docRef);
    } catch (error) {
        console.error('Error deleting public holiday set:', error);
        throw error;
    }
};

// Set default public holiday set
export const setDefaultPublicHolidaySet = async (id: string, userId: string): Promise<void> => {
    try {
        // Get the document to know its year
        const docRef = doc(firestore, 'publicHolidaySets', id);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            throw new Error('Public holiday set not found');
        }
        
        const year = docSnap.data().year;
        
        // Unset all existing defaults for the same year
        const existingDefaults = await getDocs(
            query(
                collection(firestore, 'publicHolidaySets'), 
                where('isDefault', '==', true),
                where('year', '==', year)
            )
        );
        const batch = writeBatch(firestore);
        existingDefaults.docs.forEach(doc => {
            if (doc.id !== id) {
                batch.update(doc.ref, { isDefault: false });
            }
        });
        await batch.commit();

        // Set the new default
        await updateDoc(docRef, {
            isDefault: true,
            updatedAt: serverTimestamp(),
            updatedBy: userId
        });
    } catch (error) {
        console.error('Error setting default public holiday set:', error);
        throw error;
    }
};
