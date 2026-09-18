import React, { useMemo, useState } from 'react';
import { Department, User } from '../types';
import {
    filterUnassignedEmployees,
    getAdminAllowedBranches,
    getUserBranch
} from '../utils/departmentSettingsHelpers';
import { UserIcon } from './Icons';
import AssignDepartmentWizard from './AssignDepartmentWizard';

interface UnassignedEmployeesListProps {
    currentUser: User;
    users: User[];
    departments: Department[];
    onAssigned: () => void;
}

const UnassignedEmployeesList: React.FC<UnassignedEmployeesListProps> = ({
    currentUser,
    users,
    departments,
    onAssigned
}) => {
    const [wizardUser, setWizardUser] = useState<User | null>(null);

    const allowedBranches = useMemo(() => getAdminAllowedBranches(currentUser), [currentUser]);
    const unassigned = useMemo(
        () => filterUnassignedEmployees(users, allowedBranches),
        [users, allowedBranches]
    );

    if (unassigned.length === 0) {
        return null;
    }

    return (
        <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 mb-8">
            <h2 className="text-xl font-semibold text-text-primary">Unassigned employees</h2>
            <p className="text-sm text-text-secondary mt-1 mb-4">
                These people do not have a department group yet. Assign one so they can apply for leave.
            </p>
            <div className="space-y-3">
                {unassigned.map(targetUser => {
                    const branch = getUserBranch(targetUser);
                    return (
                        <div
                            key={targetUser.id}
                            className="flex items-center justify-between gap-3 flex-wrap bg-surface-light rounded-lg p-4 border border-border"
                        >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center shrink-0">
                                    <UserIcon className="w-5 h-5 text-primary" />
                                </div>
                                <div className="min-w-0">
                                    <div className="font-medium text-text-primary truncate">{targetUser.name}</div>
                                    <div className="text-sm text-text-muted">
                                        {targetUser.employeeNumber} · Branch {branch || 'unknown'}
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setWizardUser(targetUser)}
                                className="bg-primary text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-primary-focus transition-colors shrink-0"
                            >
                                Assign department
                            </button>
                        </div>
                    );
                })}
            </div>

            {wizardUser && (
                <AssignDepartmentWizard
                    targetUser={wizardUser}
                    currentUser={currentUser}
                    departments={departments}
                    users={users}
                    onClose={() => setWizardUser(null)}
                    onAssigned={() => {
                        setWizardUser(null);
                        onAssigned();
                    }}
                />
            )}
        </div>
    );
};

export default UnassignedEmployeesList;
