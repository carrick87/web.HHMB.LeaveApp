import React, { useMemo, useState } from 'react';
import { Department, User, UserRole } from '../types';
import {
    buildUserMaps,
    findSimilarDepartments,
    getAdminAllowedBranches,
    getUserBranch,
    isUserActive,
    hasDuplicateDepartmentName,
    isValidEmail,
    normalizeEmail,
    type SimilarDepartmentMatch
} from '../utils/departmentSettingsHelpers';
import { createDepartment, updateUser, appendAdminManagedDepartment } from '../services/firebaseService';
import { ChevronDownIcon, ChevronUpIcon, UserIcon, XIcon } from './Icons';

interface AssignDepartmentWizardProps {
    targetUser: User;
    currentUser: User;
    departments: Department[];
    users: User[];
    onClose: () => void;
    onAssigned: () => void;
}

type WizardStep = 'approvers' | 'cc' | 'match' | 'create';

const STEP_LABELS: Record<WizardStep, string> = {
    approvers: 'Approvers',
    cc: 'CC emails',
    match: 'Matching groups',
    create: 'New group'
};

const AssignDepartmentWizard: React.FC<AssignDepartmentWizardProps> = ({
    targetUser,
    currentUser,
    departments,
    users,
    onClose,
    onAssigned
}) => {
    const [step, setStep] = useState<WizardStep>('approvers');
    const [approverIds, setApproverIds] = useState<string[]>([]);
    const [approverSearch, setApproverSearch] = useState('');
    const [ccEmails, setCcEmails] = useState<string[]>([]);
    const [ccInput, setCcInput] = useState('');
    const [ccInputError, setCcInputError] = useState<string | null>(null);
    const [matches, setMatches] = useState<SimilarDepartmentMatch[]>([]);
    const [expandedDeptIds, setExpandedDeptIds] = useState<Set<string>>(new Set());
    const [newGroupName, setNewGroupName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const userBranch = getUserBranch(targetUser);
    const allowedBranches = useMemo(() => getAdminAllowedBranches(currentUser), [currentUser]);
    const { byId, membersByDeptId } = useMemo(() => buildUserMaps(users), [users]);

    const selectedApprovers = useMemo(
        () => approverIds.map(id => byId.get(id)).filter((u): u is User => Boolean(u)),
        [approverIds, byId]
    );

    const matchingApprovers = useMemo(() => {
        const query = approverSearch.trim().toLowerCase();
        if (!query) return [];
        const selected = new Set(approverIds);
        const allowed =
            allowedBranches === null
                ? null
                : new Set(allowedBranches.map(branch => branch.toUpperCase()));
        return users
            .filter(u => {
                if (!isUserActive(u) || selected.has(u.id)) return false;
                if (allowed && !allowed.has(getUserBranch(u).toUpperCase())) return false;
                return (
                    u.name.toLowerCase().includes(query) ||
                    u.employeeNumber.toLowerCase().includes(query)
                );
            })
            .slice(0, 10);
    }, [approverSearch, approverIds, users, allowedBranches]);

    const addApprover = (userId: string) => {
        setApproverIds(prev => (prev.includes(userId) ? prev : [...prev, userId]));
        setApproverSearch('');
        setError(null);
    };

    const removeApprover = (userId: string) => {
        setApproverIds(prev => prev.filter(id => id !== userId));
    };

    const addCcEmail = () => {
        const trimmed = ccInput.trim();
        if (!trimmed) return;
        if (!isValidEmail(trimmed)) {
            setCcInputError('Enter a valid email address.');
            return;
        }
        const normalized = normalizeEmail(trimmed);
        if (ccEmails.some(email => normalizeEmail(email) === normalized)) {
            setCcInputError('This email is already on the list.');
            return;
        }
        setCcEmails(prev => [...prev, normalized]);
        setCcInput('');
        setCcInputError(null);
    };

    const handleCcKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCcEmail();
        }
    };

    const goFromApprovers = () => {
        if (approverIds.length === 0) {
            setError('Add at least one approver.');
            return;
        }
        setError(null);
        setStep('cc');
    };

    const goFromCc = () => {
        let emails = ccEmails;
        const trimmed = ccInput.trim();
        if (trimmed) {
            if (!isValidEmail(trimmed)) {
                setCcInputError('Enter a valid email address.');
                return;
            }
            const normalized = normalizeEmail(trimmed);
            if (!emails.some(email => normalizeEmail(email) === normalized)) {
                emails = [...emails, normalized];
                setCcEmails(emails);
            }
            setCcInput('');
            setCcInputError(null);
        }

        const found = findSimilarDepartments(departments, userBranch, approverIds, emails);
        setMatches(found);
        setError(null);
        setStep(found.length > 0 ? 'match' : 'create');
    };

    const goBack = () => {
        setError(null);
        if (step === 'cc') {
            setStep('approvers');
            return;
        }
        if (step === 'match') {
            setStep('cc');
            return;
        }
        if (step === 'create') {
            setStep(matches.length > 0 ? 'match' : 'cc');
        }
    };

    const toggleExpanded = (departmentId: string) => {
        setExpandedDeptIds(prev => {
            const next = new Set(prev);
            if (next.has(departmentId)) {
                next.delete(departmentId);
            } else {
                next.add(departmentId);
            }
            return next;
        });
    };

    const grantAdminDepartmentAccess = async (departmentId: string) => {
        if (currentUser.role !== UserRole.ADMIN) return;
        await appendAdminManagedDepartment(currentUser.id, departmentId);
    };

    const assignToDepartment = async (departmentId: string) => {
        setIsSaving(true);
        setError(null);
        try {
            await updateUser(targetUser.id, { departmentId });
            await grantAdminDepartmentAccess(departmentId);
            onAssigned();
        } catch (err) {
            console.error('Failed to assign department:', err);
            setError('Failed to assign this user. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const createAndAssign = async () => {
        const name = newGroupName.trim();
        if (!name) {
            setError('Enter a department group name.');
            return;
        }
        if (!userBranch) {
            setError('This user has no branch code on their employee number.');
            return;
        }
        if (hasDuplicateDepartmentName(departments, userBranch, name)) {
            setError(`A group named "${name}" already exists in branch ${userBranch}.`);
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            const departmentId = await createDepartment(name, userBranch, approverIds, ccEmails);
            await updateUser(targetUser.id, { departmentId });
            await grantAdminDepartmentAccess(departmentId);
            onAssigned();
        } catch (err) {
            console.error('Failed to create department group:', err);
            setError('Failed to create the group. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
            <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-xl font-semibold text-text-primary">Assign department</h2>
                        <p className="text-sm text-text-muted mt-1">
                            {targetUser.name} · {targetUser.employeeNumber} · Branch {userBranch || 'unknown'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-light rounded-md transition-colors disabled:opacity-50"
                        aria-label="Close"
                    >
                        <XIcon className="w-5 h-5" />
                    </button>
                </div>

                <p className="text-xs font-medium text-text-secondary mb-4">{STEP_LABELS[step]}</p>

                {error && (
                    <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg text-sm">
                        {error}
                    </div>
                )}

                {step === 'approvers' && (
                    <div>
                        <p className="text-sm text-text-secondary mb-3">
                            Type the approval name. You can add more than one approver.
                        </p>
                        <div className="space-y-2 mb-3">
                            {selectedApprovers.length === 0 ? (
                                <p className="text-sm text-text-muted">No approvers added yet.</p>
                            ) : (
                                selectedApprovers.map(user => (
                                    <div
                                        key={user.id}
                                        className="flex items-center justify-between gap-3 bg-surface border border-border rounded-md px-3 py-2"
                                    >
                                        <div className="min-w-0">
                                            <div className="text-sm text-text-primary truncate">{user.name}</div>
                                            <div className="text-xs text-text-muted">#{user.employeeNumber}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeApprover(user.id)}
                                            className="text-xs font-medium text-red-400 hover:text-red-300 px-2 py-1 rounded-md hover:bg-surface-light transition-colors shrink-0"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="relative">
                            <input
                                type="text"
                                value={approverSearch}
                                onChange={e => setApproverSearch(e.target.value)}
                                placeholder="Search by name or employee number"
                                className="w-full bg-surface-light border border-border rounded-md px-3 py-2.5 text-sm text-text-primary focus:ring-primary focus:border-primary"
                                autoFocus
                            />
                            {approverSearch.trim() !== '' && matchingApprovers.length > 0 && (
                                <ul className="absolute z-10 mt-1 w-full bg-card-bg border border-border rounded-md shadow-elegant max-h-56 overflow-y-auto">
                                    {matchingApprovers.map(u => (
                                        <li key={u.id}>
                                            <button
                                                type="button"
                                                onClick={() => addApprover(u.id)}
                                                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-light transition-colors"
                                            >
                                                {u.name}{' '}
                                                <span className="text-text-muted text-xs">#{u.employeeNumber}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {approverSearch.trim() !== '' && matchingApprovers.length === 0 && (
                                <p className="mt-2 text-sm text-text-muted">No matching users found.</p>
                            )}
                        </div>
                    </div>
                )}

                {step === 'cc' && (
                    <div>
                        <p className="text-sm text-text-secondary mb-3">
                            Add CC email addresses for leave notifications. You can skip this if none are needed.
                        </p>
                        <div className="space-y-2 mb-3">
                            {ccEmails.length === 0 ? (
                                <p className="text-sm text-text-muted">No CC emails added.</p>
                            ) : (
                                ccEmails.map(email => (
                                    <div
                                        key={email}
                                        className="flex items-center justify-between gap-3 bg-surface border border-border rounded-md px-3 py-2"
                                    >
                                        <span className="text-sm text-text-primary break-all min-w-0">{email}</span>
                                        <button
                                            type="button"
                                            onClick={() => setCcEmails(prev => prev.filter(e => e !== email))}
                                            className="text-xs font-medium text-red-400 hover:text-red-300 px-2 py-1 rounded-md hover:bg-surface-light transition-colors shrink-0"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="email"
                                value={ccInput}
                                onChange={e => {
                                    setCcInput(e.target.value);
                                    setCcInputError(null);
                                }}
                                onKeyDown={handleCcKeyDown}
                                placeholder="name@harrisons.com.my"
                                className="flex-1 bg-surface-light border border-border rounded-md px-3 py-2.5 text-sm text-text-primary focus:ring-primary focus:border-primary"
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={addCcEmail}
                                className="bg-secondary text-white px-4 py-2 rounded-lg font-medium hover:bg-secondary-focus transition-colors"
                            >
                                Add
                            </button>
                        </div>
                        {ccInputError && <p className="mt-2 text-sm text-red-400">{ccInputError}</p>}
                    </div>
                )}

                {step === 'match' && (
                    <div>
                        <p className="text-sm text-text-secondary mb-3">
                            Similar groups already exist in branch {userBranch}. Assign this user to one of them, or
                            create a new group.
                        </p>
                        <div className="space-y-3">
                            {matches.map(({ department, kind }) => {
                                const members = (membersByDeptId.get(department.id) ?? []).filter(isUserActive);
                                const expanded = expandedDeptIds.has(department.id);
                                const approverNames = (department.approverIds ?? [])
                                    .map(id => byId.get(id)?.name || '(Deleted)')
                                    .join(', ');
                                const ccList = (department.ccEmails ?? []).join(', ');

                                return (
                                    <div
                                        key={department.id}
                                        className="border border-border rounded-lg bg-surface-light/40 overflow-hidden"
                                    >
                                        <div className="p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="font-medium text-text-primary">{department.name}</div>
                                                    <p className="text-xs text-text-muted mt-1">
                                                        {kind === 'exact'
                                                            ? 'Same approvers and CC emails'
                                                            : 'Same approvers, different CC emails'}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => assignToDepartment(department.id)}
                                                    disabled={isSaving}
                                                    className="bg-primary text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                                                >
                                                    {isSaving ? 'Saving...' : 'Assign to this group'}
                                                </button>
                                            </div>
                                            <p className="text-sm text-text-secondary mt-3">
                                                Approvers: {approverNames || 'None'}
                                            </p>
                                            <p className="text-sm text-text-secondary mt-1">
                                                CC: {ccList || 'None'}
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => toggleExpanded(department.id)}
                                                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-focus"
                                            >
                                                {expanded ? (
                                                    <ChevronUpIcon className="w-4 h-4" />
                                                ) : (
                                                    <ChevronDownIcon className="w-4 h-4" />
                                                )}
                                                {members.length} member{members.length !== 1 ? 's' : ''}
                                            </button>
                                        </div>
                                        {expanded && (
                                            <div className="border-t border-border px-4 py-3 space-y-2">
                                                {members.length === 0 ? (
                                                    <p className="text-sm text-text-muted">No members in this group yet.</p>
                                                ) : (
                                                    members.map(member => (
                                                        <div key={member.id} className="flex items-center gap-2">
                                                            <UserIcon className="w-4 h-4 text-text-muted shrink-0" />
                                                            <div className="min-w-0">
                                                                <div className="text-sm text-text-primary truncate">
                                                                    {member.name}
                                                                </div>
                                                                <div className="text-xs text-text-muted">
                                                                    #{member.employeeNumber}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {step === 'create' && (
                    <div>
                        <p className="text-sm text-text-secondary mb-3">
                            {matches.length > 0
                                ? 'Create a new department group in this branch with the approvers and CC emails you entered.'
                                : `No similar group exists in branch ${userBranch}. Create a new one for this user.`}
                        </p>
                        <label className="block text-sm font-medium text-text-primary mb-2" htmlFor="new-group-name">
                            Group name
                        </label>
                        <input
                            id="new-group-name"
                            type="text"
                            value={newGroupName}
                            onChange={e => setNewGroupName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void createAndAssign();
                                }
                            }}
                            placeholder="e.g. Accounts"
                            className="w-full bg-surface-light border border-border rounded-md px-3 py-2.5 text-sm text-text-primary focus:ring-primary focus:border-primary"
                            autoFocus
                        />
                        <div className="mt-4 p-3 rounded-md border border-border bg-surface-light/40 text-sm text-text-secondary space-y-1">
                            <p>Branch: {userBranch || 'unknown'}</p>
                            <p>
                                Approvers:{' '}
                                {selectedApprovers.map(u => u.name).join(', ') || 'None'}
                            </p>
                            <p>CC: {ccEmails.join(', ') || 'None'}</p>
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap gap-3 mt-6">
                    {step !== 'approvers' && (
                        <button
                            type="button"
                            onClick={goBack}
                            disabled={isSaving}
                            className="bg-secondary text-white px-4 py-2 rounded-lg font-medium hover:bg-secondary-focus transition-colors disabled:opacity-50"
                        >
                            Back
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        className="px-4 py-2 rounded-lg font-medium text-text-secondary hover:bg-surface-light transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <div className="flex-1" />
                    {step === 'approvers' && (
                        <button
                            type="button"
                            onClick={goFromApprovers}
                            disabled={approverIds.length === 0}
                            className="bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next
                        </button>
                    )}
                    {step === 'cc' && (
                        <button
                            type="button"
                            onClick={goFromCc}
                            className="bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-focus transition-colors"
                        >
                            Next
                        </button>
                    )}
                    {step === 'match' && (
                        <button
                            type="button"
                            onClick={() => {
                                setError(null);
                                setStep('create');
                            }}
                            disabled={isSaving}
                            className="bg-secondary text-white px-4 py-2 rounded-lg font-medium hover:bg-secondary-focus transition-colors disabled:opacity-50"
                        >
                            Create a new group instead
                        </button>
                    )}
                    {step === 'create' && (
                        <button
                            type="button"
                            onClick={createAndAssign}
                            disabled={isSaving || !newGroupName.trim()}
                            className="bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSaving ? 'Creating...' : 'Create and assign'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AssignDepartmentWizard;
