/**
 * Cloud Functions for HHMB LeaveApp (web-hhmb-leaveapp only):
 * - registerBranchEmployees: Admin / Super Admin provisions employees by email for Google Sign-In
 *
 * No password-reset functions — users recover credentials via Google Account.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });

setGlobalOptions({
    region: 'us-central1',
});

if (!admin.apps.length) {
    admin.initializeApp();
}

const ALLOWED_EMAIL_DOMAIN = '@harrisons.com.my';
const MAX_REGISTER_BATCH = 25;

function getBranchPrefix(employeeNumber) {
    return String(employeeNumber || '').trim().substring(0, 2);
}

function getAllowedBranches(adminUserData) {
    if (adminUserData.role === 'Super Admin') {
        return null;
    }
    if (Array.isArray(adminUserData.branches) && adminUserData.branches.length > 0) {
        return adminUserData.branches.map((b) => String(b).trim()).filter(Boolean);
    }
    const own = getBranchPrefix(adminUserData.employeeNumber);
    return own ? [own] : [];
}

function isBranchAllowed(employeeNumber, allowedBranches) {
    if (allowedBranches === null) {
        return true;
    }
    const prefix = getBranchPrefix(employeeNumber);
    return Boolean(prefix) && allowedBranches.includes(prefix);
}

function provisionedDocId(email) {
    return String(email || '').trim().toLowerCase();
}

async function getCurrentLeaveBalanceAdmin(db, employeeNumber) {
    const snap = await db.collection('leaveBalanceCurrent')
        .where('employeeNumber', '==', employeeNumber)
        .limit(1)
        .get();
    if (snap.empty) {
        return 0;
    }
    const balance = snap.docs[0].data().leaveBalance;
    return typeof balance === 'number' ? balance : 0;
}

async function upsertEmployeeMaster(db, employeeNumber, employeeName, payGroup) {
    const snap = await db.collection('employees')
        .where('employeeNumber', '==', employeeNumber)
        .limit(1)
        .get();
    const payload = {
        employeeNumber,
        employeeName,
        payGroup,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (snap.empty) {
        await db.collection('employees').add({
            ...payload,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
    }
    await snap.docs[0].ref.update(payload);
}

async function registerOneEmployee(db, row, allowedBranches) {
    const employeeNumber = String(row?.employeeNumber || '').trim();
    const name = String(row?.name || '').trim();
    const email = String(row?.email || '').trim().toLowerCase();
    const payGroup = String(row?.payGroup || '').trim() === '6' ? '6' : String(row?.payGroup || '').trim() === '5' ? '5' : '';

    if (!employeeNumber) {
        throw new Error('Employee number is required');
    }
    if (employeeNumber.length < 4) {
        throw new Error('Employee number must be at least 4 characters');
    }
    if (!/^[A-Za-z0-9]+$/.test(employeeNumber)) {
        throw new Error('Employee number can only contain letters and numbers (no spaces or symbols)');
    }
    if (!name) {
        throw new Error('Name is required');
    }
    if (!email || !email.includes('@')) {
        throw new Error('A valid email address is required');
    }
    if (!email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
        throw new Error(`Only ${ALLOWED_EMAIL_DOMAIN} email addresses are allowed`);
    }
    if (payGroup !== '5' && payGroup !== '6') {
        throw new Error('Pay group must be 5 or 6');
    }
    if (!isBranchAllowed(employeeNumber, allowedBranches)) {
        throw new Error('Employee number is not in your assigned branch');
    }

    const existingByEmp = await db.collection('users')
        .where('employeeNumber', '==', employeeNumber)
        .limit(1)
        .get();
    if (!existingByEmp.empty) {
        throw new Error('An account with this employee number already exists');
    }

    const existingByEmail = await db.collection('users')
        .where('email', '==', email)
        .limit(1)
        .get();
    if (!existingByEmail.empty) {
        throw new Error('An account with this email already exists');
    }

    const provisionedRef = db.collection('provisionedUsers').doc(provisionedDocId(email));
    const existingProvision = await provisionedRef.get();
    if (existingProvision.exists) {
        const data = existingProvision.data() || {};
        if (data.claimedUid) {
            throw new Error('This email has already been used to sign in');
        }
        if (data.employeeNumber && data.employeeNumber !== employeeNumber) {
            throw new Error('This email is already provisioned for a different employee number');
        }
    }

    const conflictProvision = await db.collection('provisionedUsers')
        .where('employeeNumber', '==', employeeNumber)
        .limit(1)
        .get();
    if (!conflictProvision.empty) {
        const other = conflictProvision.docs[0];
        if (other.id !== provisionedDocId(email)) {
            throw new Error('This employee number is already provisioned for another email');
        }
    }

    await upsertEmployeeMaster(db, employeeNumber, name, payGroup);

    const leaveDaysTotal = await getCurrentLeaveBalanceAdmin(db, employeeNumber);
    await provisionedRef.set({
        name,
        email,
        employeeNumber,
        payGroup,
        role: 'Normal',
        leaveDaysTotal,
        isActive: true,
        claimedUid: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }, { merge: true });

    return {
        name,
        employeeNumber,
        email,
        payGroup
    };
}

exports.registerBranchEmployees = onRequest({ timeoutSeconds: 120, invoker: 'public' }, (req, res) => {
    return cors(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization token' });
                return;
            }

            const token = authHeader.split('Bearer ')[1];
            const decodedToken = await admin.auth().verifyIdToken(token);
            const adminUserId = decodedToken.uid;
            const db = admin.firestore();

            const adminUserDoc = await db.collection('users').doc(adminUserId).get();
            if (!adminUserDoc.exists) {
                res.status(403).json({ error: 'Forbidden: Admin user not found' });
                return;
            }

            const adminUserData = adminUserDoc.data() || {};
            if (adminUserData.role !== 'Admin' && adminUserData.role !== 'Super Admin') {
                res.status(403).json({ error: 'Forbidden: Only Admins can register employees' });
                return;
            }

            const employees = Array.isArray(req.body?.employees) ? req.body.employees : [];
            if (employees.length === 0) {
                res.status(400).json({ error: 'Add at least one employee before submitting' });
                return;
            }
            if (employees.length > MAX_REGISTER_BATCH) {
                res.status(400).json({ error: `You can register at most ${MAX_REGISTER_BATCH} employees at a time` });
                return;
            }

            const allowedBranches = getAllowedBranches(adminUserData);
            const seenNumbers = new Set();
            const seenEmails = new Set();
            const created = [];
            const failed = [];

            for (const row of employees) {
                const employeeNumber = String(row?.employeeNumber || '').trim();
                const name = String(row?.name || '').trim();
                const email = String(row?.email || '').trim().toLowerCase();

                if (employeeNumber && seenNumbers.has(employeeNumber.toLowerCase())) {
                    failed.push({
                        employeeNumber,
                        name,
                        email,
                        error: 'Duplicate employee number in this batch'
                    });
                    continue;
                }
                if (email && seenEmails.has(email)) {
                    failed.push({
                        employeeNumber,
                        name,
                        email,
                        error: 'Duplicate email in this batch'
                    });
                    continue;
                }
                if (employeeNumber) {
                    seenNumbers.add(employeeNumber.toLowerCase());
                }
                if (email) {
                    seenEmails.add(email);
                }

                try {
                    const result = await registerOneEmployee(db, row, allowedBranches);
                    created.push(result);
                } catch (error) {
                    failed.push({
                        employeeNumber,
                        name,
                        email,
                        error: error.message || 'Failed to register employee'
                    });
                }
            }

            console.log(`registerBranchEmployees: ${created.length} created, ${failed.length} failed by ${adminUserId}`);
            res.status(200).json({
                success: true,
                created,
                failed
            });
        } catch (error) {
            console.error('Error in registerBranchEmployees:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    });
});
