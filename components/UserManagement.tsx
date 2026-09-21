import React, { useState, useMemo, useEffect } from 'react';
import { User, UserRole, Department, LeaveRequest, LeaveStatus, Branch } from '../types';
import { createUser, updateUser, deleteUser, updateUserRole, updateUserLeaveDays, toggleUserStatus, resetUserPassword, getOrphanedLeaveRequests, restoreLeaveRequestsByUserIds } from '../services/firebaseService';
import { generateSecurePassword } from '../utils/passwordUtils';
import { ChevronDownIcon, PlusIcon, PencilIcon, TrashIcon, UserIcon, BuildingOfficeIcon } from './Icons';
import AssignDepartmentWizard from './AssignDepartmentWizard';
import {
    getEffectiveUserBranch as resolveEffectiveUserBranch,
    getAdminAllowedBranches,
    legacyEmpNumberBranchPrefix,
    getAvailableBranchOptions,
    formatBranchLabel,
} from '../utils/departmentSettingsHelpers';

function buildPasswordResetReplyMessage(displayName: string, password: string): string {
    const first = displayName.trim().split(/\s+/)[0] || displayName.trim() || 'there';
    return `Dear ${first},

Your password for the Leave Application system has been reset.

Your new temporary password is: ${password}

Please sign in at your earliest convenience and change your password from your profile or the sign-in flow.

If you did not expect this email, please contact the MIS Department.

Kind regards,

LeaveApp`;
}

interface UserManagementProps {
    users: User[];
    departments: Department[];
    currentUser: User;
    branches: Branch[];
    onUserUpdate: () => void;
}

const UserManagement: React.FC<UserManagementProps> = ({ users, departments, currentUser, branches, onUserUpdate }) => {
    const isSuperAdmin = currentUser.role === UserRole.SUPER_ADMIN;
    const isAdmin = currentUser.role === UserRole.ADMIN;

    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [showCreateUser, setShowCreateUser] = useState(false);
    const [wizardUser, setWizardUser] = useState<User | null>(null);
    const [userForm, setUserForm] = useState({
        name: '',
        email: '',
        password: '',
        role: UserRole.NORMAL,
        departmentId: '',
        branchOverride: '',
        branches: [] as string[],
        adminDepartments: [] as string[]
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [resettingPasswordFor, setResettingPasswordFor] = useState<User | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showResetPasswordPlain, setShowResetPasswordPlain] = useState(true);
    const [passwordResetReplyMessage, setPasswordResetReplyMessage] = useState<string | null>(null);
    const [replyCopied, setReplyCopied] = useState(false);
    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const [restoringForUser, setRestoringForUser] = useState<User | null>(null);
    const [orphanedRequests, setOrphanedRequests] = useState<LeaveRequest[]>([]);
    const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set());
    
    // Search and sort state
    const [searchTerm, setSearchTerm] = useState('');
    const [sortField, setSortField] = useState<keyof User | 'departmentName' | 'branch'>('employeeNumber');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [columnFilters, setColumnFilters] = useState<Record<string, string>>({
        employeeNumber: '',
        name: '',
        email: '',
        role: '',
        department: '',
        branch: '',
        payGroup: '',
        leaveDays: '',
        status: ''
    });

    const allowedBranches = useMemo(() => getAdminAllowedBranches(currentUser), [currentUser]);

    const canManageTargetUser = (user: User): boolean => {
        if (isSuperAdmin) return true;
        if (!isAdmin) return false;
        if (user.role !== UserRole.NORMAL) return false;
        if (!allowedBranches || allowedBranches.length === 0) return false;
        const userBranch = resolveEffectiveUserBranch(user);
        return Boolean(userBranch) && allowedBranches.includes(userBranch);
    };

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isSuperAdmin) {
            setError('Only Super Admin can create users.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await createUser(userForm.name, userForm.email, userForm.password, userForm.role, userForm.departmentId);
            setSuccess('User created successfully!');
            setUserForm({ name: '', email: '', password: '', role: UserRole.NORMAL, departmentId: '', branchOverride: '', branches: [], adminDepartments: [] });
            setShowCreateUser(false);
            onUserUpdate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create user');
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingUser) return;
        if (!isSuperAdmin) {
            setError('Only Super Admin can edit users.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const updateData: any = {
                name: userForm.name,
                email: userForm.email,
                role: userForm.role,
                departmentId: userForm.departmentId || null
            };

            // Super Admin can override branch for branch-based department filtering.
            if (currentUser.role === UserRole.SUPER_ADMIN) {
                updateData.branchOverride = userForm.branchOverride || null;
            }
            
            // Only include branches and adminDepartments if role is Admin
            if (userForm.role === UserRole.ADMIN) {
                updateData.branches = userForm.branches && userForm.branches.length > 0 ? userForm.branches : [];
                updateData.adminDepartments = userForm.adminDepartments && userForm.adminDepartments.length > 0 ? userForm.adminDepartments : [];
            } else {
                // When changing from Admin to other role, remove branches and adminDepartments fields
                updateData.branches = null;
                updateData.adminDepartments = null;
            }
            
            await updateUser(editingUser.id, updateData);
            setSuccess('User updated successfully!');
            setEditingUser(null);
            setUserForm({ name: '', email: '', password: '', role: UserRole.NORMAL, departmentId: '', branchOverride: '', branches: [], adminDepartments: [] });
            onUserUpdate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update user');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteUser = async (userId: string) => {
        if (!isSuperAdmin) {
            setError('Only Super Admin can delete users.');
            return;
        }
        const user = users.find(u => u.id === userId);
        if (!user) return;
        
        // Ask if they want to delete leave requests (default: NO - keep them)
        const deleteLeaveRequests = confirm(
            `⚠️ DELETE USER: ${user.name} ⚠️\n\n` +
            `This will PERMANENTLY DELETE the user account.\n\n` +
            `By default, leave requests will be RETAINED so that if the user signs up again with the same employee number (${user.employeeNumber || 'N/A'}), their leave history can be restored.\n\n` +
            `Do you want to ALSO DELETE all leave requests?\n\n` +
            `Click OK to delete leave requests, or Cancel to KEEP them (recommended).`
        );
        
        if (!confirm(
            `⚠️ FINAL CONFIRMATION ⚠️\n\n` +
            `You are about to PERMANENTLY DELETE:\n` +
            `- User: ${user.name}\n` +
            `- Employee Number: ${user.employeeNumber || 'N/A'}\n` +
            `- Email: ${user.email || 'N/A'}\n\n` +
            `${deleteLeaveRequests ? 
                '⚠️ Leave requests will ALSO be deleted.\n\n' : 
                '✅ Leave requests will be RETAINED.\n' +
                '   If the user signs up again with the same employee number,\n' +
                '   their leave history can be restored.\n\n'
            }` +
            `This action CANNOT be undone!\n\n` +
            `Are you absolutely sure?`
        )) {
            return;
        }

        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await deleteUser(userId, deleteLeaveRequests);
            const message = deleteLeaveRequests 
                ? `User ${user.name} has been permanently deleted from the system!`
                : `User ${user.name} has been permanently deleted from the system!\n\nLeave requests have been retained. If the user signs up again with employee number ${user.employeeNumber || 'N/A'}, their leave history can be restored.`;
            setSuccess(message);
            onUserUpdate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete user');
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateUserRole = async (userId: string, newRole: UserRole) => {
        if (!isSuperAdmin) {
            setError('Only Super Admin can change user roles.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await updateUserRole(userId, newRole);
            setSuccess('User role updated successfully!');
            onUserUpdate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update user role');
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateLeaveDays = async (userId: string, leaveDays: number) => {
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await updateUserLeaveDays(userId, leaveDays);
            setSuccess('Leave days updated successfully!');
            onUserUpdate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update leave days');
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleUserStatus = async (userId: string, isActive: boolean) => {
        const user = users.find(u => u.id === userId);
        if (!user || !canManageTargetUser(user)) {
            setError('You can only activate or deactivate Normal users in your assigned branches.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await toggleUserStatus(userId, isActive);
            setSuccess(`User ${isActive ? 'activated' : 'deactivated'} successfully!`);
            onUserUpdate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update user status');
        } finally {
            setIsLoading(false);
        }
    };

    const openPasswordResetModal = (user: User) => {
        if (!isSuperAdmin) {
            setError('Only Super Admin can reset passwords.');
            return;
        }
        setError(null);
        const p = generateSecurePassword();
        setNewPassword(p);
        setConfirmPassword(p);
        setShowResetPasswordPlain(true);
        setResettingPasswordFor(user);
    };

    const regenerateResetPassword = () => {
        const p = generateSecurePassword();
        setNewPassword(p);
        setConfirmPassword(p);
    };

    const handleResetPassword = async () => {
        if (!resettingPasswordFor) return;
        if (!isSuperAdmin) {
            setError('Only Super Admin can reset passwords.');
            return;
        }

        // Validate password
        if (!newPassword || newPassword.length < 6) {
            setError('Password must be at least 6 characters long');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        const plainUsed = newPassword;
        const userName = resettingPasswordFor.name;

        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await resetUserPassword(resettingPasswordFor.id, plainUsed);
            setResettingPasswordFor(null);
            setNewPassword('');
            setConfirmPassword('');
            setPasswordResetReplyMessage(buildPasswordResetReplyMessage(userName, plainUsed));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to reset password');
        } finally {
            setIsLoading(false);
        }
    };

    const copyPasswordResetReply = async () => {
        if (!passwordResetReplyMessage) return;
        try {
            await navigator.clipboard.writeText(passwordResetReplyMessage);
            setReplyCopied(true);
            window.setTimeout(() => setReplyCopied(false), 2000);
        } catch {
            setError('Could not copy to clipboard');
        }
    };

    const dismissPasswordResetReply = () => {
        setPasswordResetReplyMessage(null);
        setReplyCopied(false);
    };

    const cancelPasswordReset = () => {
        setResettingPasswordFor(null);
        setNewPassword('');
        setConfirmPassword('');
        setError(null);
        setSuccess(null);
    };

    // Load orphaned leave requests when restore modal opens
    useEffect(() => {
        if (showRestoreModal && currentUser.role === UserRole.SUPER_ADMIN) {
            const loadOrphanedRequests = async () => {
                try {
                    const requests = await getOrphanedLeaveRequests();
                    setOrphanedRequests(requests);
                } catch (err) {
                    console.error('Failed to load orphaned requests:', err);
                    setError('Failed to load orphaned leave requests');
                }
            };
            loadOrphanedRequests();
        }
    }, [showRestoreModal, currentUser.role]);

    const handleOpenRestoreModal = (user: User) => {
        if (!isSuperAdmin) {
            setError('Only Super Admin can restore leave requests.');
            return;
        }
        setRestoringForUser(user);
        setShowRestoreModal(true);
        setSelectedRequestIds(new Set());
        setError(null);
        setSuccess(null);
    };

    const handleCloseRestoreModal = () => {
        setShowRestoreModal(false);
        setRestoringForUser(null);
        setOrphanedRequests([]);
        setSelectedRequestIds(new Set());
        setError(null);
        setSuccess(null);
    };

    const toggleRequestSelection = (requestId: string) => {
        setSelectedRequestIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(requestId)) {
                newSet.delete(requestId);
            } else {
                newSet.add(requestId);
            }
            return newSet;
        });
    };

    const handleRestoreSelectedRequests = async () => {
        if (!isSuperAdmin) {
            setError('Only Super Admin can restore leave requests.');
            return;
        }
        if (!restoringForUser || selectedRequestIds.size === 0) {
            setError('Please select at least one leave request to restore');
            return;
        }

        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const requestIdsArray = Array.from(selectedRequestIds);
            const restoredCount = await restoreLeaveRequestsByUserIds(requestIdsArray, restoringForUser.id);
            setSuccess(`Successfully restored ${restoredCount} leave request(s) for ${restoringForUser.name}!`);
            setSelectedRequestIds(new Set());
            // Reload orphaned requests
            const requests = await getOrphanedLeaveRequests();
            setOrphanedRequests(requests);
            onUserUpdate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to restore leave requests');
        } finally {
            setIsLoading(false);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-GB', { 
            day: '2-digit', 
            month: 'short', 
            year: 'numeric' 
        });
    };

    const branchOptions = useMemo(() => getAvailableBranchOptions(branches, null), [branches]);
    const branchByCode = useMemo(() => {
        const map = new Map<string, Branch>();
        branches.forEach((b) => map.set(b.code, b));
        return map;
    }, [branches]);
    const labelFor = (code: string) => {
        const b = branchByCode.get(code);
        return b ? formatBranchLabel(b) : `Branch ${code}`;
    };

    // Effective branch for form editing (optional override from select)
    const getEffectiveUserBranch = (user: User | null, branchOverride?: string): string => {
        if (!user) return '';
        if (branchOverride !== undefined) {
            const o = branchOverride.trim();
            if (o) return o;
            const explicit = (user.branch || '').trim();
            if (explicit) return explicit;
            return legacyEmpNumberBranchPrefix(user.employeeNumber);
        }
        return resolveEffectiveUserBranch(user);
    };

    const getUserPayGroup = (user: User): string => {
        return user.payGroup === '6' ? '6' : '5';
    };

    // Get filtered departments based on user's branch
    const getFilteredDepartments = (user: User | null, branchOverride?: string): Department[] => {
        if (!user) return departments;
        const userBranch = getEffectiveUserBranch(user, branchOverride);
        if (!userBranch) return departments;
        return departments.filter(dept => dept.branch?.toUpperCase() === userBranch.toUpperCase());
    };

    const startEdit = (user: User) => {
        if (!isSuperAdmin) {
            setError('Only Super Admin can edit users.');
            return;
        }
        setEditingUser(user);
        
        // Validate current department belongs to user's branch
        let validDepartmentId = user.departmentId || '';
        if (user.employeeNumber && user.departmentId) {
            const userBranch = getEffectiveUserBranch(user);
            const currentDept = departments.find(d => d.id === user.departmentId);
            if (currentDept && currentDept.branch?.toUpperCase() !== userBranch.toUpperCase()) {
                // Department doesn't match branch - clear it
                validDepartmentId = '';
            }
        }
        
        setUserForm({
            name: user.name,
            email: user.email,
            password: '',
            role: user.role,
            departmentId: validDepartmentId,
            branchOverride: user.branchOverride || '',
            branches: user.role === UserRole.ADMIN ? (user.branches || []) : [],
            adminDepartments: user.role === UserRole.ADMIN ? (user.adminDepartments || []) : []
        });
        setShowCreateUser(false);
    };

    const cancelEdit = () => {
        setEditingUser(null);
        setUserForm({ name: '', email: '', password: '', role: UserRole.NORMAL, departmentId: '', branchOverride: '', branches: [], adminDepartments: [] });
        setShowCreateUser(false);
        setError(null);
        setSuccess(null);
    };

    const toggleBranch = (branch: string) => {
        const branches = userForm.branches.includes(branch)
            ? userForm.branches.filter(b => b !== branch)
            : [...userForm.branches, branch];
        setUserForm({ ...userForm, branches });
    };

    const getDepartmentName = (departmentId: string) => {
        const department = departments.find(d => d.id === departmentId);
        return department ? department.name : 'No Department';
    };

    const getRoleBadgeColor = (role: UserRole) => {
        switch (role) {
            case UserRole.SUPER_ADMIN:
                return 'bg-red-500/20 text-red-400';
            case UserRole.ADMIN:
                return 'bg-purple-500/20 text-purple-400';
            case UserRole.NORMAL:
                return 'bg-green-500/20 text-green-400';
            default:
                return 'bg-gray-500/20 text-gray-400';
        }
    };

    // Filter and sort users
    const filteredAndSortedUsers = React.useMemo(() => {
        let filtered = [...users];

        // Admin: Normal users in assigned branches only
        if (isAdmin) {
            const adminBranches = allowedBranches ?? [];
            filtered = filtered.filter(user => {
                if (user.role !== UserRole.NORMAL) return false;
                if (adminBranches.length === 0) return false;
                const userBranch = getEffectiveUserBranch(user);
                return Boolean(userBranch) && adminBranches.includes(userBranch);
            });
        }

        // Apply global search
        if (searchTerm) {
            const searchLower = searchTerm.toLowerCase();
            filtered = filtered.filter(user => 
                user.employeeNumber?.toLowerCase().includes(searchLower) ||
                user.name.toLowerCase().includes(searchLower) ||
                user.email?.toLowerCase().includes(searchLower) ||
                user.role.toLowerCase().includes(searchLower) ||
                getDepartmentName(user.departmentId || '').toLowerCase().includes(searchLower) ||
                getEffectiveUserBranch(user).toLowerCase().includes(searchLower) ||
                getUserPayGroup(user).includes(searchLower)
            );
        }

        // Apply column filters
        Object.entries(columnFilters).forEach(([key, value]) => {
            if (value) {
                const filterLower = value.toLowerCase();
                filtered = filtered.filter(user => {
                    switch (key) {
                        case 'employeeNumber':
                            return user.employeeNumber?.toLowerCase().includes(filterLower);
                        case 'name':
                            return user.name.toLowerCase().includes(filterLower);
                        case 'email':
                            return user.email?.toLowerCase().includes(filterLower);
                        case 'role':
                            return user.role.toLowerCase().includes(filterLower);
                        case 'department':
                            return getDepartmentName(user.departmentId || '').toLowerCase().includes(filterLower);
                        case 'branch':
                            return getEffectiveUserBranch(user).toLowerCase().includes(filterLower);
                        case 'payGroup':
                            return getUserPayGroup(user).includes(filterLower);
                        case 'leaveDays':
                            return user.leaveDaysTotal.toString().includes(filterLower);
                        case 'status':
                            return (user.isActive ? 'active' : 'inactive').includes(filterLower);
                        default:
                            return true;
                    }
                });
            }
        });

        // Sort users
        filtered.sort((a, b) => {
            let aValue: any;
            let bValue: any;

            if (sortField === 'departmentName') {
                aValue = getDepartmentName(a.departmentId || '');
                bValue = getDepartmentName(b.departmentId || '');
            } else if (sortField === 'branch') {
                aValue = getEffectiveUserBranch(a);
                bValue = getEffectiveUserBranch(b);
            } else if (sortField === 'payGroup') {
                aValue = getUserPayGroup(a);
                bValue = getUserPayGroup(b);
            } else {
                aValue = a[sortField as keyof User] || '';
                bValue = b[sortField as keyof User] || '';
            }

            // Handle comparison
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                const comparison = aValue.toLowerCase().localeCompare(bValue.toLowerCase());
                return sortDirection === 'asc' ? comparison : -comparison;
            } else if (typeof aValue === 'number' && typeof bValue === 'number') {
                return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
            } else {
                const aStr = String(aValue || '');
                const bStr = String(bValue || '');
                const comparison = aStr.localeCompare(bStr);
                return sortDirection === 'asc' ? comparison : -comparison;
            }
        });

        return filtered;
    }, [users, searchTerm, columnFilters, sortField, sortDirection, departments, currentUser, isAdmin, allowedBranches]);

    const handleSort = (field: keyof User | 'departmentName' | 'branch') => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const handleColumnFilter = (column: string, value: string) => {
        setColumnFilters(prev => ({
            ...prev,
            [column]: value
        }));
    };

    const clearFilters = () => {
        setSearchTerm('');
        setColumnFilters({
            employeeNumber: '',
            name: '',
            email: '',
            role: '',
            department: '',
            branch: '',
            payGroup: '',
            leaveDays: '',
            status: ''
        });
    };

    return (
        <div className="animate-fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-text-primary">User Management</h1>
                    <p className="text-text-secondary mt-2">
                        {isAdmin
                            ? 'Manage Normal users in your assigned branches'
                            : 'Manage system users, roles, and permissions'}
                    </p>
                    {isAdmin && allowedBranches && allowedBranches.length > 0 && (
                        <p className="text-sm text-text-muted mt-1">
                            Showing Normal users from branches: {allowedBranches.join(', ')}
                        </p>
                    )}
                    {isAdmin && (!allowedBranches || allowedBranches.length === 0) && (
                        <p className="text-sm text-text-muted mt-1">
                            No branches assigned. Ask a Super Admin to assign branches in User Management.
                        </p>
                    )}
                </div>
                {isSuperAdmin && (
                    <button
                        onClick={() => setShowCreateUser(true)}
                        className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-focus transition-colors flex items-center gap-2 shadow-elegant"
                    >
                        <PlusIcon className="w-5 h-5" />
                        Add New User
                    </button>
                )}
            </div>

            {/* Success/Error Messages */}
            {success && (
                <div className="mb-6 p-4 bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg">
                    {success}
                </div>
            )}
            {error && (
                <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg">
                    {error}
                </div>
            )}

            {/* Create/Edit User Form */}
            {isSuperAdmin && (showCreateUser || editingUser) && (
                <div className="mb-8 bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                    <h2 className="text-xl font-semibold text-text-primary mb-4">
                        {editingUser ? 'Edit User' : 'Create New User'}
                    </h2>
                    <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Name</label>
                                <input
                                    type="text"
                                    value={userForm.name}
                                    onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                                    className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Email</label>
                                <input
                                    type="email"
                                    value={userForm.email}
                                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                                    className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                                    required
                                />
                            </div>
                        </div>
                        
                        {!editingUser && (
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Password</label>
                                <input
                                    type="password"
                                    value={userForm.password}
                                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                                    className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                                    required={!editingUser}
                                />
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Role</label>
                                <select
                                    value={userForm.role}
                                    onChange={(e) => {
                                        const newRole = e.target.value as UserRole;
                                        setUserForm({ 
                                            ...userForm, 
                                            role: newRole,
                                            branches: newRole === UserRole.ADMIN ? userForm.branches : [],
                                            adminDepartments: newRole === UserRole.ADMIN ? userForm.adminDepartments : []
                                        });
                                    }}
                                    className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                                >
                                    <option value={UserRole.NORMAL}>Normal</option>
                                    <option value={UserRole.ADMIN}>Admin</option>
                                    <option value={UserRole.SUPER_ADMIN}>Super Admin</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Department</label>
                                <select
                                    value={userForm.departmentId}
                                    onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })}
                                    className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                                    disabled={editingUser ? (!editingUser.employeeNumber) : false}
                                >
                                    <option value="">Select Department</option>
                                    {editingUser && editingUser.employeeNumber ? (
                                        // When editing: filter by user's branch
                                        getFilteredDepartments(editingUser, userForm.branchOverride).length > 0 ? (
                                            getFilteredDepartments(editingUser, userForm.branchOverride)
                                                .sort((a, b) => a.name.localeCompare(b.name))
                                                .map(dept => (
                                                <option key={dept.id} value={dept.id}>
                                                    {dept.name} {dept.branch ? `(Branch ${dept.branch})` : ''}
                                                </option>
                                            ))
                                        ) : (
                                            <option value="" disabled>
                                                No departments available for Branch {getEffectiveUserBranch(editingUser, userForm.branchOverride) || 'N/A'}
                                            </option>
                                        )
                                    ) : (
                                        // When creating new user: show all departments (can't filter without employee number)
                                        departments
                                            .sort((a, b) => a.name.localeCompare(b.name))
                                            .map(dept => (
                                            <option key={dept.id} value={dept.id}>
                                                {dept.name} {dept.branch ? `(Branch ${dept.branch})` : ''}
                                            </option>
                                        ))
                                    )}
                                </select>
                                {editingUser && editingUser.employeeNumber ? (
                                    <p className="text-xs text-text-muted mt-1">
                                        Showing departments for Branch {getEffectiveUserBranch(editingUser, userForm.branchOverride)}
                                    </p>
                                ) : editingUser && !editingUser.employeeNumber ? (
                                    <p className="text-xs text-text-warning mt-1">
                                        Employee number required to filter departments by branch
                                    </p>
                                ) : (
                                    <p className="text-xs text-text-muted mt-1">
                                        All departments shown. User's department will be filtered by their branch after account creation.
                                    </p>
                                )}
                            </div>
                        </div>

                        {editingUser && currentUser.role === UserRole.SUPER_ADMIN && (
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-1">Branch Override</label>
                                <select
                                    value={userForm.branchOverride}
                                    onChange={(e) => {
                                        const nextOverride = e.target.value;
                                        const filteredDepartments = getFilteredDepartments(editingUser, nextOverride);
                                        const hasCurrentDepartment = filteredDepartments.some(d => d.id === userForm.departmentId);
                                        setUserForm({
                                            ...userForm,
                                            branchOverride: nextOverride,
                                            departmentId: hasCurrentDepartment ? userForm.departmentId : ''
                                        });
                                    }}
                                    className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                                >
                                    <option value="">
                                        Use registered / emp# branch ({resolveEffectiveUserBranch({
                                            branch: editingUser.branch,
                                            branchOverride: '',
                                            employeeNumber: editingUser.employeeNumber,
                                        }) || 'N/A'})
                                    </option>
                                    {branchOptions.map(branch => (
                                        <option key={branch} value={branch}>
                                            {labelFor(branch)}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-xs text-text-muted mt-1">
                                    Effective branch: {getEffectiveUserBranch(editingUser, userForm.branchOverride) || 'N/A'}
                                </p>
                            </div>
                        )}

                        {/* Branch Selection for Admin Role */}
                        {userForm.role === UserRole.ADMIN && (
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-3">
                                    Assigned Branches (Select branches this Admin can view)
                                </label>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    {branchOptions.map(branch => (
                                        <label key={branch} className="flex items-center gap-2 p-3 bg-surface-light rounded-md hover:bg-hover-bg transition-colors cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={userForm.branches.includes(branch)}
                                                onChange={() => {
                                                    const isRemoving = userForm.branches.includes(branch);
                                                    const branches = isRemoving
                                                        ? userForm.branches.filter(b => b !== branch)
                                                        : [...userForm.branches, branch];
                                                    // When branch is removed, also remove departments from that branch
                                                    const branchDepartments = departments
                                                        .filter(d => d.branch === branch)
                                                        .map(d => d.id);
                                                    const adminDepartments = isRemoving
                                                        ? userForm.adminDepartments.filter(d => !branchDepartments.includes(d))
                                                        : userForm.adminDepartments;
                                                    setUserForm({ ...userForm, branches, adminDepartments });
                                                }}
                                                className="w-4 h-4 text-primary bg-surface-light border-border rounded focus:ring-primary"
                                            />
                                            <span className="text-text-primary font-medium">{labelFor(branch)}</span>
                                        </label>
                                    ))}
                                </div>
                                {userForm.branches.length === 0 && (
                                    <p className="text-xs text-text-muted mt-2">No branches selected. Admin will not see any data.</p>
                                )}
                                
                                {/* Department Selection for Admin (only shown after branches are selected) */}
                                {userForm.branches.length > 0 && (
                                    <div className="mt-4">
                                        <label className="block text-sm font-medium text-text-secondary mb-3">
                                            Assigned Departments (Select departments this Admin can view in calendar)
                                        </label>
                                        <div className="max-h-60 overflow-y-auto border border-border rounded-md p-3 bg-surface-light">
                                            {departments
                                                .filter(dept => userForm.branches.includes(dept.branch || ''))
                                                .sort((a, b) => a.name.localeCompare(b.name))
                                                .map(dept => (
                                                    <label key={dept.id} className="flex items-center gap-2 p-2 hover:bg-hover-bg transition-colors cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={userForm.adminDepartments.includes(dept.id)}
                                                            onChange={() => {
                                                                const adminDepartments = userForm.adminDepartments.includes(dept.id)
                                                                    ? userForm.adminDepartments.filter(d => d !== dept.id)
                                                                    : [...userForm.adminDepartments, dept.id];
                                                                setUserForm({ ...userForm, adminDepartments });
                                                            }}
                                                            className="w-4 h-4 text-primary bg-surface-light border-border rounded focus:ring-primary"
                                                        />
                                                        <span className="text-text-primary">{dept.name} (Branch {dept.branch})</span>
                                                    </label>
                                                ))}
                                            {departments.filter(dept => userForm.branches.includes(dept.branch || '')).length === 0 && (
                                                <p className="text-sm text-text-muted">No departments available for selected branches.</p>
                                            )}
                                        </div>
                                        {userForm.adminDepartments.length === 0 && (
                                            <p className="text-xs text-text-muted mt-2">No departments selected. Admin will not see any calendar data.</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex gap-3 pt-4">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? 'Saving...' : (editingUser ? 'Update User' : 'Create User')}
                            </button>
                            <button
                                type="button"
                                onClick={cancelEdit}
                                className="bg-secondary text-white px-6 py-3 rounded-lg font-medium hover:bg-secondary-focus transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Search and Filter Bar */}
            <div className="mb-6 bg-card-bg rounded-xl shadow-elegant-lg border border-border p-4">
                <div className="flex flex-col md:flex-row gap-4 items-center">
                    <div className="flex-1 w-full">
                        <input
                            type="text"
                            placeholder="Search all columns..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-text-primary"
                        />
                    </div>
                    {(searchTerm || Object.values(columnFilters).some(v => v)) && (
                        <button
                            onClick={clearFilters}
                            className="px-4 py-3 bg-secondary text-white rounded-md hover:bg-secondary-focus transition-colors whitespace-nowrap"
                        >
                            Clear Filters
                        </button>
                    )}
                </div>
            </div>

            {/* Users Table */}
            <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border overflow-hidden">
                <div className="p-6 border-b border-border">
                    <h3 className="text-lg font-semibold text-text-primary">
                        All Users ({filteredAndSortedUsers.length} of {users.length})
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-surface-light">
                            <tr>
                                <th className="p-2 text-left text-sm font-semibold text-slate-300 w-24">
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onClick={() => handleSort('employeeNumber')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors text-left"
                                        >
                                            Emp No.
                                            {sortField === 'employeeNumber' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                        <input
                                            type="text"
                                            placeholder="Filter..."
                                            value={columnFilters.employeeNumber}
                                            onChange={(e) => handleColumnFilter('employeeNumber', e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary focus:border-primary"
                                        />
                                    </div>
                                </th>
                                <th className="p-2 text-left text-sm font-semibold text-slate-300 w-20">
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onClick={() => handleSort('branch')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors text-left"
                                        >
                                            Branch
                                            {sortField === 'branch' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                        <input
                                            type="text"
                                            placeholder="Filter..."
                                            value={columnFilters.branch}
                                            onChange={(e) => handleColumnFilter('branch', e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary focus:border-primary"
                                        />
                                    </div>
                                </th>
                                <th className="p-2 text-left text-sm font-semibold text-slate-300 w-20">
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onClick={() => handleSort('payGroup')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors text-left"
                                        >
                                            Paygroup
                                            {sortField === 'payGroup' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                        <input
                                            type="text"
                                            placeholder="Filter..."
                                            value={columnFilters.payGroup}
                                            onChange={(e) => handleColumnFilter('payGroup', e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary focus:border-primary"
                                        />
                                    </div>
                                </th>
                                <th className="p-4 text-left text-sm font-semibold text-slate-300">
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onClick={() => handleSort('name')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors text-left"
                                        >
                                            User
                                            {sortField === 'name' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                        <input
                                            type="text"
                                            placeholder="Filter..."
                                            value={columnFilters.name}
                                            onChange={(e) => handleColumnFilter('name', e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary focus:border-primary"
                                        />
                                    </div>
                                </th>
                                <th className="p-4 text-left text-sm font-semibold text-slate-300">
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onClick={() => handleSort('email')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors text-left"
                                        >
                                            Email
                                            {sortField === 'email' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                        <input
                                            type="text"
                                            placeholder="Filter..."
                                            value={columnFilters.email}
                                            onChange={(e) => handleColumnFilter('email', e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary focus:border-primary"
                                        />
                                    </div>
                                </th>
                                <th className="p-2 text-left text-sm font-semibold text-slate-300 w-28">
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onClick={() => handleSort('role')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors text-left"
                                        >
                                            Role
                                            {sortField === 'role' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                        <input
                                            type="text"
                                            placeholder="Filter..."
                                            value={columnFilters.role}
                                            onChange={(e) => handleColumnFilter('role', e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary focus:border-primary"
                                        />
                                    </div>
                                </th>
                                <th className="p-2 text-left text-sm font-semibold text-slate-300 w-28">
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onClick={() => handleSort('leaveDaysTotal')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors text-left"
                                        >
                                            Leave Days
                                            {sortField === 'leaveDaysTotal' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                        <input
                                            type="text"
                                            placeholder="Filter..."
                                            value={columnFilters.leaveDays}
                                            onChange={(e) => handleColumnFilter('leaveDays', e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary focus:border-primary"
                                        />
                                    </div>
                                </th>
                                <th className="p-2 text-left text-sm font-semibold text-slate-300 w-24">
                                    <div className="flex flex-col gap-2">
                                        <span>Status</span>
                                        <input
                                            type="text"
                                            placeholder="Filter..."
                                            value={columnFilters.status}
                                            onChange={(e) => handleColumnFilter('status', e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary focus:border-primary"
                                        />
                                    </div>
                                </th>
                                <th className="p-4 text-left text-sm font-semibold text-slate-300">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredAndSortedUsers.map((user) => (
                                <tr key={user.id} className="border-b border-slate-700 last:border-b-0 hover:bg-slate-700 transition-colors">
                                    <td className="p-2 w-24">
                                        <div className="font-medium text-white text-sm">{user.employeeNumber || 'N/A'}</div>
                                    </td>
                                    <td className="p-2 w-20">
                                        <div className="font-medium text-white text-sm">{getEffectiveUserBranch(user) || 'N/A'}</div>
                                    </td>
                                    <td className="p-2 w-20">
                                        <div className="font-medium text-white text-sm">{getUserPayGroup(user)}</div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                                                <UserIcon className="w-5 h-5 text-primary" />
                                            </div>
                                            <div>
                                                <div className="font-medium text-white">{user.name}</div>
                                                <div className="text-sm text-slate-400">{getDepartmentName(user.departmentId || '')}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4 text-slate-300">{user.email || 'No email'}</td>
                                    <td className="p-2 w-28">
                                        {isSuperAdmin ? (
                                            <select
                                                value={user.role}
                                                onChange={(e) => handleUpdateUserRole(user.id, e.target.value as UserRole)}
                                                className="text-xs bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white w-full"
                                            >
                                                {Object.values(UserRole).map(role => (
                                                    <option key={role} value={role}>{role}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)}`}>
                                                {user.role}
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-2 w-28">
                                        <input
                                            type="number"
                                            value={user.leaveDaysTotal}
                                            readOnly
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white cursor-not-allowed opacity-75"
                                        />
                                    </td>
                                    <td className="p-2 w-24">
                                        <button
                                            onClick={() => handleToggleUserStatus(user.id, !user.isActive)}
                                            className={`px-3 py-1 rounded-full text-xs font-medium ${
                                                user.isActive 
                                                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                                                    : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                            }`}
                                        >
                                            {user.isActive ? 'Active' : 'Inactive'}
                                        </button>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setWizardUser(user)}
                                                className="p-2 text-emerald-400 hover:bg-emerald-500/20 rounded-md transition-colors"
                                                title="Assign Department"
                                            >
                                                <BuildingOfficeIcon className="w-4 h-4" />
                                            </button>
                                            {isSuperAdmin && (
                                                <>
                                                    <button
                                                        onClick={() => startEdit(user)}
                                                        className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-md transition-colors"
                                                        title="Edit User"
                                                    >
                                                        <PencilIcon className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setSuccess(
                                                                `${user.name} signs in with email/password (${user.email || 'no email'}). They can use “Forgot password?” on the sign-in page, or change password in Profile.`
                                                            );
                                                        }}
                                                        className="p-2 text-yellow-400 hover:bg-yellow-500/20 rounded-md transition-colors"
                                                        title="Password help"
                                                    >
                                                        🔑
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteUser(user.id)}
                                                        className="p-2 text-red-400 hover:bg-red-500/20 rounded-md transition-colors"
                                                        title="Delete User"
                                                    >
                                                        <TrashIcon className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {filteredAndSortedUsers.length === 0 && (
                    <div className="p-12 text-center">
                        <div className="text-6xl mb-4">👥</div>
                        <p className="text-text-primary text-lg font-medium mb-2">
                            {searchTerm || Object.values(columnFilters).some(v => v) 
                                ? 'No users match your search criteria' 
                                : 'No users found'}
                        </p>
                        <p className="text-text-muted">
                            {searchTerm || Object.values(columnFilters).some(v => v)
                                ? 'Try adjusting your filters'
                                : isAdmin
                                    ? 'No Normal users in your assigned branches yet.'
                                    : 'Create your first user to get started.'}
                        </p>
                    </div>
                )}
            </div>

            {/* Password Reset Modal */}
            {isSuperAdmin && resettingPasswordFor && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 max-w-md w-full">
                        <h2 className="text-xl font-semibold text-text-primary mb-4">
                            Reset Password for {resettingPasswordFor.name}
                        </h2>
                        <div className="mb-6">
                            <p className="text-sm text-text-muted mb-4">
                                Set a new password for this user. The password will be immediately active.
                            </p>
                            <div className="text-sm text-text-secondary mb-4">
                                <p><strong>User Email:</strong> {resettingPasswordFor.email || 'N/A'}</p>
                                <p><strong>Employee Number:</strong> {resettingPasswordFor.employeeNumber || 'N/A'}</p>
                            </div>
                            
                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-sm text-text-muted">Generated passwords meet security requirements.</span>
                                    <button
                                        type="button"
                                        onClick={regenerateResetPassword}
                                        disabled={isLoading}
                                        className="text-sm px-3 py-1.5 rounded-md border border-border text-text-secondary hover:bg-surface-light transition-colors disabled:opacity-50"
                                    >
                                        Regenerate password
                                    </button>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-1 gap-2">
                                        <label htmlFor="newPassword" className="block text-sm font-medium text-text-secondary">
                                            New Password
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => setShowResetPasswordPlain((v) => !v)}
                                            className="text-xs text-primary hover:underline"
                                        >
                                            {showResetPasswordPlain ? 'Hide' : 'Show'}
                                        </button>
                                    </div>
                                    <input
                                        type={showResetPasswordPlain ? 'text' : 'password'}
                                        id="newPassword"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="Enter new password (min 6 characters)"
                                        className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary font-mono text-sm"
                                        disabled={isLoading}
                                        autoFocus
                                        autoComplete="new-password"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="confirmPassword" className="block text-sm font-medium text-text-secondary mb-1">
                                        Confirm Password
                                    </label>
                                    <input
                                        type={showResetPasswordPlain ? 'text' : 'password'}
                                        id="confirmPassword"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="Confirm new password"
                                        className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary font-mono text-sm"
                                        disabled={isLoading}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !isLoading) {
                                                handleResetPassword();
                                            }
                                        }}
                                        autoComplete="new-password"
                                    />
                                </div>
                            </div>
                            
                            {error && (
                                <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                                    <p className="text-sm text-red-400">{error}</p>
                                </div>
                            )}
                        </div>
                        
                        <div className="flex gap-3">
                            <button
                                onClick={handleResetPassword}
                                disabled={isLoading || !newPassword || !confirmPassword}
                                className="flex-1 bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? 'Resetting...' : 'Reset Password'}
                            </button>
                            <button
                                onClick={cancelPasswordReset}
                                disabled={isLoading}
                                className="flex-1 bg-secondary text-white px-4 py-2 rounded-lg font-medium hover:bg-secondary-focus transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {passwordResetReplyMessage && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 max-w-lg w-full">
                        <h2 className="text-xl font-semibold text-text-primary mb-2">
                            Password updated — message for user
                        </h2>
                        <p className="text-sm text-text-muted mb-4">
                            Copy this message and send it securely to the user. You will not see this password again in the app.
                        </p>
                        <textarea
                            readOnly
                            value={passwordResetReplyMessage}
                            rows={14}
                            className="w-full bg-surface-light border border-border rounded-md p-3 text-sm text-text-primary font-sans resize-y min-h-[200px] focus:ring-primary focus:border-primary"
                            onFocus={(e) => e.target.select()}
                        />
                        <div className="flex flex-wrap gap-3 mt-4">
                            <button
                                type="button"
                                onClick={copyPasswordResetReply}
                                className="flex-1 min-w-[120px] bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-focus transition-colors"
                            >
                                {replyCopied ? 'Copied!' : 'Copy to clipboard'}
                            </button>
                            <button
                                type="button"
                                onClick={dismissPasswordResetReply}
                                className="flex-1 min-w-[120px] bg-secondary text-white px-4 py-2 rounded-lg font-medium hover:bg-secondary-focus transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Restore Leave Requests Modal */}
            {isSuperAdmin && showRestoreModal && restoringForUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-semibold text-text-primary mb-4">
                            Restore Leave Requests for {restoringForUser.name}
                        </h2>
                        <p className="text-sm text-text-muted mb-4">
                            Select orphaned leave requests (from deleted users) to restore for this user.
                            Employee Number: <strong>{restoringForUser.employeeNumber || 'N/A'}</strong>
                        </p>

                        {orphanedRequests.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-text-muted">No orphaned leave requests found.</p>
                                <p className="text-sm text-text-muted mt-2">All leave requests are already assigned to active users.</p>
                            </div>
                        ) : (
                            <>
                                <div className="mb-4 flex items-center justify-between">
                                    <p className="text-sm text-text-secondary">
                                        Found {orphanedRequests.length} orphaned leave request(s). 
                                        Selected: {selectedRequestIds.size}
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setSelectedRequestIds(new Set(orphanedRequests.map(r => r.id)))}
                                            className="text-xs px-3 py-1 bg-primary/20 text-primary rounded hover:bg-primary/30"
                                        >
                                            Select All
                                        </button>
                                        <button
                                            onClick={() => setSelectedRequestIds(new Set())}
                                            className="text-xs px-3 py-1 bg-secondary/20 text-secondary rounded hover:bg-secondary/30"
                                        >
                                            Clear All
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-2 max-h-96 overflow-y-auto mb-4">
                                    {orphanedRequests.map((request) => (
                                        <div
                                            key={request.id}
                                            className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                                                selectedRequestIds.has(request.id)
                                                    ? 'bg-primary/20 border-primary'
                                                    : 'bg-surface-light border-border hover:bg-surface'
                                            }`}
                                            onClick={() => toggleRequestSelection(request.id)}
                                        >
                                            <div className="flex items-start gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRequestIds.has(request.id)}
                                                    onChange={() => toggleRequestSelection(request.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="mt-1 w-4 h-4 text-primary border-border rounded focus:ring-primary"
                                                />
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                                            request.status === LeaveStatus.APPROVED ? 'bg-green-500/20 text-green-400' :
                                                            request.status === LeaveStatus.PENDING ? 'bg-yellow-500/20 text-yellow-400' :
                                                            request.status === LeaveStatus.REJECTED ? 'bg-red-500/20 text-red-400' :
                                                            'bg-gray-500/20 text-gray-400'
                                                        }`}>
                                                            {request.status}
                                                        </span>
                                                        <span className="font-medium text-text-primary">{request.leaveType}</span>
                                                    </div>
                                                    <div className="text-sm text-text-secondary">
                                                        <p>
                                                            {formatDate(request.startDate)} ({request.startTime}) - 
                                                            {' '}{formatDate(request.endDate)} ({request.endTime})
                                                        </p>
                                                        {request.reason && (
                                                            <p className="mt-1 text-xs text-text-muted">Reason: {request.reason}</p>
                                                        )}
                                                        <p className="text-xs text-text-muted mt-1">
                                                            Requested: {formatDate(request.requestedAt)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={handleRestoreSelectedRequests}
                                        disabled={isLoading || selectedRequestIds.size === 0}
                                        className="flex-1 bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isLoading ? 'Restoring...' : `Restore ${selectedRequestIds.size} Selected Request(s)`}
                                    </button>
                                    <button
                                        onClick={handleCloseRestoreModal}
                                        disabled={isLoading}
                                        className="flex-1 bg-secondary text-white px-4 py-2 rounded-lg font-medium hover:bg-secondary-focus transition-colors disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            {wizardUser && (
                <AssignDepartmentWizard
                    targetUser={wizardUser}
                    currentUser={currentUser}
                    departments={departments}
                    users={users}
                    onClose={() => setWizardUser(null)}
                    onAssigned={() => {
                        setWizardUser(null);
                        onUserUpdate();
                    }}
                />
            )}
        </div>
    );
};

export default UserManagement;
