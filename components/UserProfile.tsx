import React, { useEffect, useState } from 'react';
import { User, UserRole, Department } from '../types';
import { updateUser, changeUserPassword, getEmployeeByNumber } from '../services/firebaseService';
import { PencilIcon, UserIcon, CheckIcon, XIcon } from './Icons';

interface UserProfileProps {
    user: User;
    departments: Department[];
    onProfileUpdate: (updatedUser: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ user, departments, onProfileUpdate }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [editForm, setEditForm] = useState({
        name: user.name,
        email: user.email,
        departmentId: user.departmentId || ''
    });
    const [passwordForm, setPasswordForm] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [showPasswords, setShowPasswords] = useState({
        current: false,
        new: false,
        confirm: false
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [masterPayGroup, setMasterPayGroup] = useState<string | null>(null);

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

    // Helper function to extract branch from employee number (first 2 characters)
    const getBranch = (employeeNumber: string): string => {
        if (!employeeNumber || employeeNumber.length < 2) return '';
        return employeeNumber.substring(0, 2);
    };

    const getPayGroupLabel = (payGroup?: string): string => {
        if (payGroup === '6') return '6 - 6 working days (Saturday included)';
        if (payGroup === '5') return '5 - 5 working days';
        return '5 - 5 working days';
    };

    const formatUserDate = (value: unknown): string => {
        if (!value) return 'N/A';
        try {
            if (typeof value === 'object' && value !== null) {
                const timestamp = value as { toDate?: () => Date; seconds?: number };
                if (typeof timestamp.toDate === 'function') {
                    return timestamp.toDate().toLocaleDateString();
                }
                if (typeof timestamp.seconds === 'number') {
                    return new Date(timestamp.seconds * 1000).toLocaleDateString();
                }
            }
            if (typeof value === 'string' || typeof value === 'number') {
                const date = new Date(value);
                if (!isNaN(date.getTime())) return date.toLocaleDateString();
            }
        } catch {
            // fall through to N/A
        }
        return 'N/A';
    };

    const effectivePayGroup = user.payGroup === '6' || masterPayGroup === '6' ? '6' : '5';

    // Get filtered departments based on user's branch
    const getFilteredDepartments = (): Department[] => {
        if (!user.employeeNumber) return departments;
        const userBranch = getBranch(user.employeeNumber);
        if (!userBranch) return departments;
        return departments.filter(dept => dept.branch?.toUpperCase() === userBranch.toUpperCase());
    };

    useEffect(() => {
        // Validate current department belongs to user's branch
        let validDepartmentId = user.departmentId || '';
        if (user.employeeNumber && user.departmentId) {
            const userBranch = getBranch(user.employeeNumber);
            const currentDept = departments.find(d => d.id === user.departmentId);
            if (currentDept && currentDept.branch?.toUpperCase() !== userBranch.toUpperCase()) {
                // Department doesn't match branch - clear it
                validDepartmentId = '';
            }
        }
        
        setEditForm({
            name: user.name,
            email: user.email,
            departmentId: validDepartmentId
        });
    }, [user, departments]);

    useEffect(() => {
        let isCancelled = false;

        const loadPayGroup = async () => {
            if (!user.employeeNumber) {
                setMasterPayGroup('5');
                return;
            }

            if (user.payGroup) {
                setMasterPayGroup(user.payGroup === '6' ? '6' : '5');
                return;
            }

            try {
                const employee = await getEmployeeByNumber(user.employeeNumber);
                const payGroup = employee?.payGroup === '6' ? '6' : '5';

                if (isCancelled) return;
                setMasterPayGroup(payGroup);

                try {
                    await updateUser(user.id, { payGroup });
                    if (!isCancelled) {
                        onProfileUpdate({ ...user, payGroup });
                    }
                } catch (syncError) {
                    console.warn('Unable to sync user paygroup from employee master:', syncError);
                }
            } catch (err) {
                if (!isCancelled) {
                    setMasterPayGroup('5');
                }
                console.warn('Unable to fetch employee master paygroup:', err);
            }
        };

        loadPayGroup();

        return () => {
            isCancelled = true;
        };
    }, [user.id, user.employeeNumber, user.payGroup]);

    const handleSave = async (e: React.FormEvent | React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await updateUser(user.id, {
                name: editForm.name,
                email: editForm.email,
                departmentId: editForm.departmentId
            });

            const updatedUser: User = {
                ...user,
                name: editForm.name,
                email: editForm.email,
                departmentId: editForm.departmentId || undefined
            };

            setSuccess('Profile updated successfully!');
            setIsEditing(false);
            onProfileUpdate(updatedUser);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update profile');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancel = () => {
        setEditForm({
            name: user.name,
            email: user.email,
            departmentId: user.departmentId || ''
        });
        setIsEditing(false);
        setError(null);
        setSuccess(null);
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        // Validation
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            setError('New passwords do not match');
            setIsLoading(false);
            return;
        }

        if (passwordForm.newPassword.length < 6) {
            setError('New password must be at least 6 characters long');
            setIsLoading(false);
            return;
        }

        try {
            // Note: Firebase doesn't require current password for updatePassword
            // The user must be recently authenticated or we need to re-authenticate
            await changeUserPassword(passwordForm.newPassword);
            
            setSuccess('Password changed successfully!');
            setPasswordForm({
                currentPassword: '',
                newPassword: '',
                confirmPassword: ''
            });
            setIsChangingPassword(false);
        } catch (err) {
            if (err instanceof Error) {
                if (err.message.includes('requires-recent-login')) {
                    setError('For security reasons, please sign out and sign in again before changing your password.');
                } else {
                    setError(err.message);
                }
            } else {
                setError('Failed to change password');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancelPasswordChange = () => {
        setPasswordForm({
            currentPassword: '',
            newPassword: '',
            confirmPassword: ''
        });
        setIsChangingPassword(false);
        setError(null);
        setSuccess(null);
    };

    const togglePasswordVisibility = (field: 'current' | 'new' | 'confirm') => {
        setShowPasswords(prev => ({
            ...prev,
            [field]: !prev[field]
        }));
    };

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-text-primary">My Profile</h1>
                    <p className="text-text-secondary mt-1">Manage your personal information</p>
                </div>
                <div className="flex items-center gap-3">
                    {!isEditing && !isChangingPassword && (
                        <>
                            {/* Only show Edit Profile button for ADMIN and SUPER_ADMIN roles */}
                            {user.role !== UserRole.NORMAL && (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-focus transition-colors"
                                >
                                    <PencilIcon className="w-4 h-4" />
                                    Edit Profile
                                </button>
                            )}
                            <button
                                onClick={() => setIsChangingPassword(true)}
                                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                            >
                                🔒 Change Password
                            </button>
                        </>
                    )}
                    {isEditing && (
                        <div className="flex gap-2">
                            <button
                                onClick={handleSave}
                                disabled={isLoading}
                                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
                            >
                                <CheckIcon className="w-4 h-4" />
                                {isLoading ? 'Saving...' : 'Save'}
                            </button>
                            <button
                                onClick={handleCancel}
                                className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-700 transition-colors"
                            >
                                <XIcon className="w-4 h-4" />
                                Cancel
                            </button>
                        </div>
                    )}
                    {isChangingPassword && (
                        <div className="flex gap-2">
                            <button
                                onClick={handlePasswordChange}
                                disabled={isLoading}
                                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
                            >
                                <CheckIcon className="w-4 h-4" />
                                {isLoading ? 'Changing...' : 'Change Password'}
                            </button>
                            <button
                                onClick={handleCancelPasswordChange}
                                className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-700 transition-colors"
                            >
                                <XIcon className="w-4 h-4" />
                                Cancel
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Success/Error Messages */}
            {success && (
                <div className="p-4 bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg">
                    {success}
                </div>
            )}
            {error && (
                <div className="p-4 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg">
                    {error}
                </div>
            )}

            {/* Profile Information */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Profile Card */}
                <div className="lg:col-span-1">
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                        <div className="text-center">
                            <div className="w-24 h-24 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <UserIcon className="w-12 h-12 text-primary" />
                            </div>
                            <h2 className="text-xl font-semibold text-text-primary mb-2">{user.name}</h2>
                            <div className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)}`}>
                                {user.role}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Profile Details */}
                <div className="lg:col-span-2">
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                        <h3 className="text-lg font-semibold text-text-primary mb-6">Profile Information</h3>
                        
                        {isEditing && user.role !== UserRole.NORMAL ? (
                            <form onSubmit={handleSave} className="space-y-6">
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Full Name</label>
                                    <input
                                        type="text"
                                        value={editForm.name}
                                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                        className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-text-primary"
                                        required
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Email Address</label>
                                    <input
                                        type="email"
                                        value={editForm.email}
                                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                        className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-text-primary"
                                        required
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Department</label>
                                    <select
                                        value={editForm.departmentId}
                                        onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })}
                                        className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-text-primary"
                                        disabled={!user.employeeNumber}
                                    >
                                        <option value="">Select Department</option>
                                        {getFilteredDepartments().length > 0 ? (
                                            getFilteredDepartments().map(dept => (
                                                <option key={dept.id} value={dept.id}>
                                                    {dept.name} {dept.branch ? `(Branch ${dept.branch})` : ''}
                                                </option>
                                            ))
                                        ) : (
                                            <option value="" disabled>
                                                No departments available for Branch {user.employeeNumber ? getBranch(user.employeeNumber) : 'N/A'}
                                            </option>
                                        )}
                                    </select>
                                    {user.employeeNumber && (
                                        <p className="text-xs text-text-muted mt-1">
                                            Showing departments for Branch {getBranch(user.employeeNumber)}
                                        </p>
                                    )}
                                    {!user.employeeNumber && (
                                        <p className="text-xs text-text-warning mt-1">
                                            Employee number required to filter departments by branch
                                        </p>
                                    )}
                                </div>
                            </form>
                        ) : (
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Full Name</label>
                                    <div className={`p-3 bg-surface-light border border-border rounded-md text-text-primary ${user.role === UserRole.NORMAL ? 'opacity-75' : ''}`}>
                                        {user.name}
                                    </div>
                                    {user.role === UserRole.NORMAL && (
                                        <p className="text-xs text-text-muted mt-1">Contact your administrator to change your name</p>
                                    )}
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Email Address</label>
                                    <div className={`p-3 bg-surface-light border border-border rounded-md text-text-primary ${user.role === UserRole.NORMAL ? 'opacity-75' : ''}`}>
                                        {user.email}
                                    </div>
                                    {user.role === UserRole.NORMAL && (
                                        <p className="text-xs text-text-muted mt-1">Contact your administrator to change your email</p>
                                    )}
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Employee Number</label>
                                    <div className="p-3 bg-surface-light border border-border rounded-md text-text-primary">
                                        {user.employeeNumber || 'N/A'}
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Branch</label>
                                    <div className="p-3 bg-surface-light border border-border rounded-md text-text-primary font-medium">
                                        {user.employeeNumber ? getBranch(user.employeeNumber) : 'N/A'}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Paygroup</label>
                                    <div className="p-3 bg-surface-light border border-border rounded-md text-text-primary font-medium">
                                        {getPayGroupLabel(effectivePayGroup)}
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Department</label>
                                    <div className={`p-3 bg-surface-light border border-border rounded-md text-text-primary ${user.role === UserRole.NORMAL ? 'opacity-75' : ''}`}>
                                        {getDepartmentName(user.departmentId || '')}
                                    </div>
                                    {user.role === UserRole.NORMAL && (
                                        <p className="text-xs text-text-muted mt-1">Contact your administrator to change your department</p>
                                    )}
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Role</label>
                                    <div className="p-3 bg-surface-light border border-border rounded-md">
                                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)}`}>
                                            {user.role}
                                        </span>
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">User ID</label>
                                    <div className="p-3 bg-surface-light border border-border rounded-md text-text-primary font-mono text-sm">
                                        {user.id}
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-2">Status</label>
                                    <div className="p-3 bg-surface-light border border-border rounded-md">
                                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${user.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                            {user.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Password Change Section */}
            {isChangingPassword && (
                <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                    <h3 className="text-lg font-semibold text-text-primary mb-4">Change Password</h3>
                    <form onSubmit={handlePasswordChange} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-text-secondary mb-2">New Password</label>
                            <div className="relative">
                                <input
                                    type={showPasswords.new ? "text" : "password"}
                                    value={passwordForm.newPassword}
                                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                                    className="w-full bg-surface-light border border-border rounded-md p-3 pr-10 focus:ring-primary focus:border-primary text-text-primary"
                                    placeholder="Enter new password"
                                    required
                                    minLength={6}
                                />
                                <button
                                    type="button"
                                    onClick={() => togglePasswordVisibility('new')}
                                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-text-muted hover:text-text-primary"
                                >
                                    {showPasswords.new ? '🙈' : '👁️'}
                                </button>
                            </div>
                            <p className="text-xs text-text-muted mt-1">Password must be at least 6 characters long</p>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-text-secondary mb-2">Confirm New Password</label>
                            <div className="relative">
                                <input
                                    type={showPasswords.confirm ? "text" : "password"}
                                    value={passwordForm.confirmPassword}
                                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                                    className="w-full bg-surface-light border border-border rounded-md p-3 pr-10 focus:ring-primary focus:border-primary text-text-primary"
                                    placeholder="Confirm new password"
                                    required
                                    minLength={6}
                                />
                                <button
                                    type="button"
                                    onClick={() => togglePasswordVisibility('confirm')}
                                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-text-muted hover:text-text-primary"
                                >
                                    {showPasswords.confirm ? '🙈' : '👁️'}
                                </button>
                            </div>
                        </div>

                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                            <div className="flex items-start gap-2">
                                <span className="text-yellow-500 text-lg">⚠️</span>
                                <div className="text-sm text-yellow-400">
                                    <p className="font-medium mb-1">Security Notice:</p>
                                    <p>For security reasons, you may need to sign out and sign in again if you haven't done so recently before changing your password.</p>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
            )}

            {/* Additional Information */}
            <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Account Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">Created At</label>
                        <div className="p-3 bg-surface-light border border-border rounded-md text-text-primary">
                            {formatUserDate(user.createdAt)}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">Last Updated</label>
                        <div className="p-3 bg-surface-light border border-border rounded-md text-text-primary">
                            {formatUserDate((user as User & { updatedAt?: unknown }).updatedAt)}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UserProfile;
