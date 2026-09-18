import React, { useMemo, useState } from 'react';
import { Branch, Department, User, UserRole } from '../types';
import EmployeeUpload from './EmployeeUpload';
import EmployeeList from './EmployeeList';
import BranchEmployeeRegister from './BranchEmployeeRegister';
import UnassignedEmployeesList from './UnassignedEmployeesList';
import { getAdminAllowedBranches } from '../utils/departmentSettingsHelpers';

interface EmployeeUploadPageProps {
    onUploadComplete?: () => void;
    users: User[];
    departments: Department[];
    currentUser: User;
    branches: Branch[];
}

const EmployeeUploadPage: React.FC<EmployeeUploadPageProps> = ({
    onUploadComplete,
    users,
    departments,
    currentUser,
    branches,
}) => {
    const [refreshKey, setRefreshKey] = useState(0);
    const isSuperAdmin = currentUser.role === UserRole.SUPER_ADMIN;
    const isAdmin = currentUser.role === UserRole.ADMIN;

    const allowedBranches = useMemo(() => {
        const allowed = getAdminAllowedBranches(currentUser);
        return allowed === null ? undefined : allowed;
    }, [currentUser]);

    const handleUploadComplete = () => {
        setRefreshKey(prev => prev + 1);
        if (onUploadComplete) {
            onUploadComplete();
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-text-primary">Employee Master List</h1>
                <p className="text-text-secondary mt-2">
                    {isAdmin
                        ? 'Register new employees for your assigned branches (employee number, name, email, pay group, and branch).'
                        : 'Upload, register, and manage the employee master list. Provisioned users sign in with email and password.'}
                </p>
            </div>

            {(isAdmin || isSuperAdmin) && (
                <BranchEmployeeRegister
                    currentUser={currentUser}
                    branches={branches}
                    onComplete={handleUploadComplete}
                />
            )}

            {(isAdmin || isSuperAdmin) && (
                <UnassignedEmployeesList
                    currentUser={currentUser}
                    users={users}
                    departments={departments}
                    onAssigned={handleUploadComplete}
                />
            )}

            {isSuperAdmin && (
                <EmployeeUpload onUploadComplete={handleUploadComplete} />
            )}

            <div className={isSuperAdmin ? 'mt-8' : ''}>
                <EmployeeList
                    key={refreshKey}
                    users={users}
                    onUpdate={handleUploadComplete}
                    allowedBranches={allowedBranches}
                    canManage={isSuperAdmin}
                />
            </div>
        </div>
    );
};

export default EmployeeUploadPage;
