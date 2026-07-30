import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Department, User } from '../types';
import { BRANCH_LIST, filterDepartments, buildUserMaps, hasDuplicateDepartmentName, isValidEmail, normalizeEmail } from '../utils/departmentSettingsHelpers';
import { createDepartment, updateDepartment, updateUser, deleteDepartment } from '../services/firebaseService';
import { PlusIcon, ArrowLeftIcon, BuildingOfficeIcon } from './Icons';

interface DepartmentSettingsProps {
    departments: Department[];
    users: User[];
    onDepartmentUpdate: () => void;
}

type Mode = 'view' | 'create';

const DepartmentSettings: React.FC<DepartmentSettingsProps> = ({ departments, users, onDepartmentUpdate }) => {
    const [branchFilter, setBranchFilter] = useState<string>('all');
    const [search, setSearch] = useState('');
    const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
    const [mode, setMode] = useState<Mode>('view');
    const [mobileShowDetail, setMobileShowDetail] = useState(false);

    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const [createName, setCreateName] = useState('');
    const [createBranch, setCreateBranch] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const [basicsName, setBasicsName] = useState('');
    const [basicsBranch, setBasicsBranch] = useState('');
    const [basicsSavedFlash, setBasicsSavedFlash] = useState(false);
    const basicsFlashTimeoutRef = useRef<number | null>(null);

    const [approverSearch, setApproverSearch] = useState('');
    const [ccInput, setCcInput] = useState('');
    const [ccInputError, setCcInputError] = useState<string | null>(null);

    const [memberSearch, setMemberSearch] = useState('');
    const [pendingReassign, setPendingReassign] = useState<{ userId: string; userName: string; fromDeptName: string } | null>(null);
    const [isReassigning, setIsReassigning] = useState(false);
    const [isChipSaving, setIsChipSaving] = useState(false);

    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const { membersByDeptId, byId } = useMemo(() => buildUserMaps(users), [users]);

    const visibleDepartments = useMemo(
        () => filterDepartments(departments, { branchFilter, search }),
        [departments, branchFilter, search]
    );

    const selectedDepartment = useMemo(
        () => departments.find(d => d.id === selectedDepartmentId) ?? null,
        [departments, selectedDepartmentId]
    );

    useEffect(() => {
        setBasicsName(selectedDepartment?.name ?? '');
        setBasicsBranch(selectedDepartment?.branch ?? '');
    }, [selectedDepartmentId, selectedDepartment?.name, selectedDepartment?.branch]);

    useEffect(() => {
        setApproverSearch('');
        setCcInput('');
        setCcInputError(null);
        setMemberSearch('');
        setPendingReassign(null);
        setPendingDeleteId(null);
        setIsChipSaving(false);
    }, [selectedDepartmentId]);

    useEffect(() => {
        return () => {
            if (basicsFlashTimeoutRef.current) {
                window.clearTimeout(basicsFlashTimeoutRef.current);
            }
        };
    }, []);

    const getSummary = (department: Department) => {
        const approverCount = department.approverIds?.length ?? 0;
        const ccCount = department.ccEmails?.length ?? 0;
        const memberCount = membersByDeptId.get(department.id)?.length ?? 0;
        return { approverCount, ccCount, memberCount };
    };

    const handleSelectDepartment = (departmentId: string) => {
        setSelectedDepartmentId(departmentId);
        setMode('view');
        setMobileShowDetail(true);
        setError(null);
        setSuccess(null);
    };

    const handleNewDepartment = () => {
        setMode('create');
        setMobileShowDetail(true);
        setCreateName('');
        setCreateBranch('');
        setError(null);
        setSuccess(null);
    };

    const handleCancelCreate = () => {
        setMode('view');
        if (!selectedDepartmentId) {
            setMobileShowDetail(false);
        }
        setError(null);
    };

    const handleMobileBack = () => {
        setMobileShowDetail(false);
        if (mode === 'create') {
            setMode('view');
        }
    };

    const handleCreateSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        const trimmed = createName.trim();
        if (!trimmed) {
            setError('Department name is required.');
            return;
        }
        if (!createBranch) {
            setError('Branch code is required.');
            return;
        }
        if (hasDuplicateDepartmentName(departments, createBranch, trimmed)) {
            setError('A department with this name already exists for this branch.');
            return;
        }

        setIsSaving(true);
        try {
            const id = await createDepartment(trimmed, createBranch, [], []);
            onDepartmentUpdate();
            setSelectedDepartmentId(id);
            setMode('view');
            setSuccess('Department created.');
        } catch (err) {
            console.error('Failed to create department:', err);
            setError('Failed to create department. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const flashBasicsSaved = () => {
        setBasicsSavedFlash(true);
        if (basicsFlashTimeoutRef.current) {
            window.clearTimeout(basicsFlashTimeoutRef.current);
        }
        basicsFlashTimeoutRef.current = window.setTimeout(() => setBasicsSavedFlash(false), 2000);
    };

    const handleBasicsSave = async () => {
        if (!selectedDepartment) return;

        const trimmedName = basicsName.trim();
        const nameChanged = trimmedName !== selectedDepartment.name;
        const branchChanged = basicsBranch !== (selectedDepartment.branch ?? '');
        if (!nameChanged && !branchChanged) return;

        setError(null);

        if (!basicsBranch || !BRANCH_LIST.includes(basicsBranch as typeof BRANCH_LIST[number])) {
            setError('Branch code is required.');
            setBasicsBranch(selectedDepartment.branch ?? '');
            return;
        }
        if (!trimmedName) {
            setError('Department name is required.');
            setBasicsName(selectedDepartment.name);
            return;
        }
        if (hasDuplicateDepartmentName(departments, basicsBranch, trimmedName, selectedDepartment.id)) {
            setError('A department with this name already exists for this branch.');
            return;
        }

        try {
            await updateDepartment(selectedDepartment.id, { name: trimmedName, branch: basicsBranch });
            onDepartmentUpdate();
            flashBasicsSaved();
        } catch (err) {
            console.error('Failed to update department:', err);
            setError('Failed to save changes. Please try again.');
        }
    };

    const handleBasicsNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
        }
    };

    const matchingApprovers = useMemo(() => {
        const query = approverSearch.trim().toLowerCase();
        if (!query || !selectedDepartment) return [];
        const currentIds = new Set(selectedDepartment.approverIds ?? []);
        return users
            .filter(u =>
                u.isActive &&
                !currentIds.has(u.id) &&
                (u.name.toLowerCase().includes(query) || u.employeeNumber.toLowerCase().includes(query))
            )
            .slice(0, 10);
    }, [approverSearch, selectedDepartment, users]);

    const handleAddApprover = async (userId: string) => {
        if (!selectedDepartment || isChipSaving) return;
        const current = selectedDepartment.approverIds ?? [];
        setApproverSearch('');
        if (current.includes(userId)) return;

        setError(null);
        setIsChipSaving(true);
        try {
            await updateDepartment(selectedDepartment.id, { approverIds: [...current, userId] });
            onDepartmentUpdate();
        } catch (err) {
            console.error('Failed to add approver:', err);
            setError('Failed to add approver. Please try again.');
        } finally {
            setIsChipSaving(false);
        }
    };

    const handleRemoveApprover = async (userId: string) => {
        if (!selectedDepartment || isChipSaving) return;
        const next = (selectedDepartment.approverIds ?? []).filter(id => id !== userId);

        setError(null);
        setIsChipSaving(true);
        try {
            await updateDepartment(selectedDepartment.id, { approverIds: next });
            onDepartmentUpdate();
        } catch (err) {
            console.error('Failed to remove approver:', err);
            setError('Failed to remove approver. Please try again.');
        } finally {
            setIsChipSaving(false);
        }
    };

    const handleAddCc = async () => {
        if (!selectedDepartment || isChipSaving) return;
        const trimmed = ccInput.trim();
        if (!trimmed) return;

        if (!isValidEmail(trimmed)) {
            setCcInputError('Enter a valid email address.');
            return;
        }

        const normalized = normalizeEmail(trimmed);
        const existing = selectedDepartment.ccEmails ?? [];
        if (existing.some(email => normalizeEmail(email) === normalized)) {
            setCcInputError('This email is already on the list.');
            return;
        }

        setCcInputError(null);
        setError(null);
        setIsChipSaving(true);
        try {
            await updateDepartment(selectedDepartment.id, { ccEmails: [...existing, normalized] });
            onDepartmentUpdate();
            setCcInput('');
        } catch (err) {
            console.error('Failed to add CC email:', err);
            setError('Failed to add CC email. Please try again.');
        } finally {
            setIsChipSaving(false);
        }
    };

    const handleCcInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddCc();
        }
    };

    const handleRemoveCc = async (email: string) => {
        if (!selectedDepartment || isChipSaving) return;
        const next = (selectedDepartment.ccEmails ?? []).filter(e => e !== email);

        setError(null);
        setIsChipSaving(true);
        try {
            await updateDepartment(selectedDepartment.id, { ccEmails: next });
            onDepartmentUpdate();
        } catch (err) {
            console.error('Failed to remove CC email:', err);
            setError('Failed to remove CC email. Please try again.');
        } finally {
            setIsChipSaving(false);
        }
    };

    const currentMembers = useMemo(
        () => (selectedDepartment ? membersByDeptId.get(selectedDepartment.id) ?? [] : []),
        [membersByDeptId, selectedDepartment]
    );

    const matchingMembers = useMemo(() => {
        const query = memberSearch.trim().toLowerCase();
        if (!query || !selectedDepartment) return [];
        return users
            .filter(u =>
                u.isActive &&
                u.departmentId !== selectedDepartment.id &&
                (u.name.toLowerCase().includes(query) || u.employeeNumber.toLowerCase().includes(query))
            )
            .slice(0, 10);
    }, [memberSearch, selectedDepartment, users]);

    const handleAssignMember = async (user: User) => {
        if (!selectedDepartment || isChipSaving) return;
        setMemberSearch('');
        setError(null);

        if (user.departmentId && user.departmentId !== selectedDepartment.id) {
            const fromDeptName = departments.find(d => d.id === user.departmentId)?.name ?? 'another department';
            setPendingReassign({ userId: user.id, userName: user.name, fromDeptName });
            return;
        }

        setIsChipSaving(true);
        try {
            await updateUser(user.id, { departmentId: selectedDepartment.id });
            onDepartmentUpdate();
        } catch (err) {
            console.error('Failed to assign member:', err);
            setError('Failed to assign member. Please try again.');
        } finally {
            setIsChipSaving(false);
        }
    };

    const handleConfirmReassign = async () => {
        if (!pendingReassign || !selectedDepartment) return;
        setError(null);
        setIsReassigning(true);
        try {
            await updateUser(pendingReassign.userId, { departmentId: selectedDepartment.id });
            onDepartmentUpdate();
            setPendingReassign(null);
        } catch (err) {
            console.error('Failed to reassign member:', err);
            setError('Failed to reassign member. Please try again.');
        } finally {
            setIsReassigning(false);
        }
    };

    const handleCancelReassign = () => {
        setPendingReassign(null);
    };

    const handleUnassignMember = async (userId: string) => {
        if (isChipSaving) return;
        setError(null);
        setIsChipSaving(true);
        try {
            await updateUser(userId, { departmentId: null });
            onDepartmentUpdate();
        } catch (err) {
            console.error('Failed to unassign member:', err);
            setError('Failed to unassign member. Please try again.');
        } finally {
            setIsChipSaving(false);
        }
    };

    const pendingDeleteDepartment = useMemo(
        () => (pendingDeleteId ? departments.find(d => d.id === pendingDeleteId) ?? null : null),
        [departments, pendingDeleteId]
    );

    const handleDeleteClick = (department: Department) => {
        setError(null);
        setSuccess(null);
        const memberCount = membersByDeptId.get(department.id)?.length ?? 0;
        if (memberCount > 0) {
            setError(`Cannot delete: ${memberCount} member(s) still assigned. Unassign or reassign them first.`);
            return;
        }
        setPendingDeleteId(department.id);
    };

    const handleConfirmDelete = async () => {
        if (!pendingDeleteId) return;
        setIsDeleting(true);
        setError(null);
        try {
            await deleteDepartment(pendingDeleteId);
            onDepartmentUpdate();
            setPendingDeleteId(null);
            setSelectedDepartmentId(null);
            setMobileShowDetail(false);
            setSuccess('Department deleted.');
        } catch (err) {
            console.error('Failed to delete department:', err);
            setError('Failed to delete department. Please try again.');
            setPendingDeleteId(null);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleCancelDelete = () => {
        setPendingDeleteId(null);
    };

    return (
        <div className="animate-fade-in">
            <div className="flex justify-between items-center mb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-text-primary">Department Settings</h1>
                    <p className="text-text-secondary mt-2">Manage departments, approvers, and notification settings by branch</p>
                </div>
                <button
                    onClick={handleNewDepartment}
                    className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-focus transition-colors flex items-center gap-2 shadow-elegant shrink-0"
                >
                    <PlusIcon className="w-5 h-5" />
                    New Department
                </button>
            </div>

            {error && (
                <div className="mb-4 p-4 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg">
                    {error}
                </div>
            )}
            {success && (
                <div className="mb-4 p-4 bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg">
                    {success}
                </div>
            )}

            <div className="department-settings-split flex flex-col gap-4 md:flex-row md:items-stretch">
                {/* Left: department list */}
                <div
                    className={`department-settings-list flex flex-col w-full bg-card-bg rounded-xl shadow-elegant border border-border overflow-hidden${
                        mobileShowDetail ? ' is-mobile-hidden' : ''
                    }`}
                >
                    <div className="shrink-0 p-4 border-b border-border space-y-3">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search departments..."
                            className="w-full bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary"
                        />
                        <div>
                            <label className="block text-xs font-medium text-text-secondary mb-1">Branch</label>
                            <select
                                value={branchFilter}
                                onChange={(e) => setBranchFilter(e.target.value)}
                                className="w-full bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary"
                            >
                                <option value="all">All branches</option>
                                {BRANCH_LIST.map(branch => (
                                    <option key={branch} value={branch}>Branch {branch}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto">
                        {visibleDepartments.length === 0 ? (
                            <div className="p-8 text-center">
                                <BuildingOfficeIcon className="w-10 h-10 text-text-muted mx-auto mb-3" />
                                <p className="text-sm text-text-secondary">
                                    {search.trim() || branchFilter !== 'all' ? 'No departments match your filters.' : 'No departments yet.'}
                                </p>
                            </div>
                        ) : (
                            <ul>
                                {visibleDepartments.map(department => {
                                    const { approverCount, ccCount, memberCount } = getSummary(department);
                                    const isSelected = department.id === selectedDepartmentId && mode === 'view';
                                    return (
                                        <li key={department.id}>
                                            <button
                                                onClick={() => handleSelectDepartment(department.id)}
                                                className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${
                                                    isSelected
                                                        ? 'border-l-4 border-l-primary bg-primary/5'
                                                        : 'border-l-4 border-l-transparent hover:bg-surface-light'
                                                }`}
                                            >
                                                <div className="font-medium text-text-primary truncate">{department.name}</div>
                                                <div className="text-xs text-text-muted mt-0.5">Branch {department.branch || '-'}</div>
                                                <div className={`text-xs mt-1 ${approverCount === 0 ? 'text-amber-600' : 'text-text-secondary'}`}>
                                                    {approverCount} approver{approverCount !== 1 ? 's' : ''} · {ccCount} CC · {memberCount} member{memberCount !== 1 ? 's' : ''}
                                                </div>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>

                {/* Right: detail panel */}
                <div
                    className={`department-settings-detail flex flex-col flex-1 min-w-0 overflow-y-auto bg-card-bg rounded-xl shadow-elegant border border-border${
                        mobileShowDetail ? '' : ' is-mobile-hidden'
                    }`}
                >
                    {mode === 'create' ? (
                        <div className="p-6">
                            <button
                                onClick={handleMobileBack}
                                className="md:hidden flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mb-4"
                            >
                                <ArrowLeftIcon className="w-4 h-4" />
                                Back to list
                            </button>
                            <h2 className="text-xl font-semibold text-text-primary mb-4">Create New Department</h2>
                            <form onSubmit={handleCreateSubmit} className="space-y-4 max-w-xl">
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-1">Department Name</label>
                                    <input
                                        type="text"
                                        value={createName}
                                        onChange={(e) => setCreateName(e.target.value)}
                                        placeholder="Enter department name"
                                        className="w-full bg-surface-light border border-border rounded-md p-3 text-text-primary focus:ring-primary focus:border-primary"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-1">Branch Code</label>
                                    <select
                                        value={createBranch}
                                        onChange={(e) => setCreateBranch(e.target.value)}
                                        className="w-full bg-surface-light border border-border rounded-md p-3 text-text-primary focus:ring-primary focus:border-primary"
                                        required
                                    >
                                        <option value="">Select Branch</option>
                                        {BRANCH_LIST.map(branch => (
                                            <option key={branch} value={branch}>Branch {branch}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="submit"
                                        disabled={isSaving}
                                        className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSaving ? 'Creating...' : 'Create Department'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCancelCreate}
                                        className="bg-surface-light text-text-primary border border-border px-6 py-3 rounded-lg font-medium hover:bg-surface transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </div>
                    ) : selectedDepartment ? (
                        <div className="p-6 space-y-4">
                            <button
                                onClick={handleMobileBack}
                                className="md:hidden flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary"
                            >
                                <ArrowLeftIcon className="w-4 h-4" />
                                Back to list
                            </button>
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <h2 className="text-xl font-semibold text-text-primary truncate">{selectedDepartment.name}</h2>
                                    <p className="text-sm text-text-secondary mt-1">
                                        Branch {selectedDepartment.branch || '-'} · {currentMembers.length} member{currentMembers.length !== 1 ? 's' : ''}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteClick(selectedDepartment)}
                                    className="shrink-0 text-sm font-medium text-red-400 hover:text-red-300 border border-red-500/30 hover:bg-red-500/10 px-4 py-2 rounded-md transition-colors"
                                >
                                    Delete
                                </button>
                            </div>
                            <div className="p-5 rounded-lg border border-border bg-surface-light/40">
                                <div className="flex items-center gap-2 mb-3">
                                    <h3 className="text-sm font-semibold text-text-primary">Basics</h3>
                                    {basicsSavedFlash && (
                                        <span className="text-xs font-medium text-green-500 animate-fade-in">Saved</span>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-text-secondary mb-1">Department Name</label>
                                        <input
                                            type="text"
                                            value={basicsName}
                                            onChange={(e) => setBasicsName(e.target.value)}
                                            onBlur={handleBasicsSave}
                                            onKeyDown={handleBasicsNameKeyDown}
                                            placeholder="Enter department name"
                                            className="w-full bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-text-secondary mb-1">Branch Code</label>
                                        <select
                                            value={basicsBranch}
                                            onChange={(e) => setBasicsBranch(e.target.value)}
                                            onBlur={handleBasicsSave}
                                            className="w-full bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary"
                                        >
                                            <option value="">Select Branch</option>
                                            {BRANCH_LIST.map(branch => (
                                                <option key={branch} value={branch}>Branch {branch}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div className="p-5 rounded-lg border border-border bg-surface-light/40">
                                <h3 className="text-sm font-semibold text-text-primary mb-3">Approvers</h3>
                                <div className="space-y-2 mb-3">
                                    {(selectedDepartment.approverIds ?? []).length === 0 ? (
                                        <p className="text-sm text-text-muted">No approvers assigned yet.</p>
                                    ) : (
                                        (selectedDepartment.approverIds ?? []).map(id => {
                                            const user = byId.get(id);
                                            return (
                                                <div
                                                    key={id}
                                                    className="flex items-center justify-between gap-3 bg-surface border border-border rounded-md px-3 py-2"
                                                >
                                                    <div className="min-w-0">
                                                        <div className={`text-sm truncate ${user ? 'text-text-primary' : 'text-red-400 italic'}`}>
                                                            {user ? user.name : '(Deleted)'}
                                                        </div>
                                                        {user && (
                                                            <div className="text-xs text-text-muted">#{user.employeeNumber}</div>
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveApprover(id)}
                                                        disabled={isChipSaving}
                                                        className="text-xs font-medium text-red-400 hover:text-red-300 px-2 py-1 rounded-md hover:bg-surface-light transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        aria-label="Remove approver"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={approverSearch}
                                        onChange={(e) => setApproverSearch(e.target.value)}
                                        disabled={isChipSaving}
                                        placeholder="Search by name or employee number..."
                                        className="w-full bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    {approverSearch.trim() !== '' && matchingApprovers.length > 0 && (
                                        <ul className="absolute z-10 mt-1 w-full bg-card-bg border border-border rounded-md shadow-elegant max-h-56 overflow-y-auto">
                                            {matchingApprovers.map(u => (
                                                <li key={u.id}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAddApprover(u.id)}
                                                        disabled={isChipSaving}
                                                        className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {u.name} <span className="text-text-muted text-xs">#{u.employeeNumber}</span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>

                            <div className="p-5 rounded-lg border border-border bg-surface-light/40">
                                <h3 className="text-sm font-semibold text-text-primary mb-3">CC Emails</h3>
                                <div className="space-y-2 mb-3">
                                    {(selectedDepartment.ccEmails ?? []).length === 0 ? (
                                        <p className="text-sm text-text-muted">No CC emails added yet.</p>
                                    ) : (
                                        (selectedDepartment.ccEmails ?? []).map(email => (
                                            <div
                                                key={email}
                                                className="flex items-center justify-between gap-3 bg-surface border border-border rounded-md px-3 py-2"
                                            >
                                                <span className="text-sm text-text-primary break-all min-w-0">{email}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveCc(email)}
                                                    disabled={isChipSaving}
                                                    className="text-xs font-medium text-red-400 hover:text-red-300 px-2 py-1 rounded-md hover:bg-surface-light transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    aria-label="Remove CC email"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={ccInput}
                                        onChange={(e) => {
                                            setCcInput(e.target.value);
                                            if (ccInputError) setCcInputError(null);
                                        }}
                                        onKeyDown={handleCcInputKeyDown}
                                        disabled={isChipSaving}
                                        placeholder="name@example.com"
                                        className="flex-1 min-w-0 bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddCc}
                                        disabled={isChipSaving}
                                        className="bg-surface-light text-text-primary border border-border px-4 py-2 rounded-md text-sm font-medium hover:bg-surface transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Add
                                    </button>
                                </div>
                                {ccInputError && (
                                    <p className="mt-2 text-xs text-red-400">{ccInputError}</p>
                                )}
                            </div>

                            <div className="p-5 rounded-lg border border-border bg-surface-light/40">
                                <h3 className="text-sm font-semibold text-text-primary mb-3">
                                    Members <span className="text-text-muted font-normal">({currentMembers.length})</span>
                                </h3>
                                <div className="space-y-2 mb-3">
                                    {currentMembers.length === 0 ? (
                                        <p className="text-sm text-text-muted">No members assigned yet.</p>
                                    ) : (
                                        currentMembers.map(member => (
                                            <div
                                                key={member.id}
                                                className="flex items-center justify-between gap-3 bg-surface border border-border rounded-md px-3 py-2"
                                            >
                                                <div className="min-w-0">
                                                    <div className="text-sm text-text-primary truncate">{member.name}</div>
                                                    <div className="text-xs text-text-muted">#{member.employeeNumber}</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleUnassignMember(member.id)}
                                                    disabled={isChipSaving}
                                                    className="text-xs font-medium text-red-400 hover:text-red-300 px-2 py-1 rounded-md hover:bg-surface-light transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    Unassign
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={memberSearch}
                                        onChange={(e) => setMemberSearch(e.target.value)}
                                        disabled={isChipSaving}
                                        placeholder="Search by name or employee number..."
                                        className="w-full bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    {memberSearch.trim() !== '' && matchingMembers.length > 0 && (
                                        <ul className="absolute z-10 mt-1 w-full bg-card-bg border border-border rounded-md shadow-elegant max-h-56 overflow-y-auto">
                                            {matchingMembers.map(u => (
                                                <li key={u.id}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAssignMember(u)}
                                                        disabled={isChipSaving}
                                                        className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {u.name} <span className="text-text-muted text-xs">#{u.employeeNumber}</span>
                                                        {u.departmentId && (
                                                            <span className="text-text-muted text-xs">
                                                                {' '}· currently in {departments.find(d => d.id === u.departmentId)?.name ?? 'another department'}
                                                            </span>
                                                        )}
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-8">
                            <BuildingOfficeIcon className="w-12 h-12 text-text-muted mb-4" />
                            <p className="text-text-primary text-lg font-medium mb-1">Select a department</p>
                            <p className="text-text-secondary text-sm mb-6 max-w-xs">
                                Choose a department from the list to view and manage its approvers, CC emails, and members.
                            </p>
                            <button
                                onClick={handleNewDepartment}
                                className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-focus transition-colors flex items-center gap-2 shadow-elegant"
                            >
                                <PlusIcon className="w-5 h-5" />
                                New Department
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {pendingReassign && selectedDepartment && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 max-w-md w-full">
                        <h2 className="text-lg font-semibold text-text-primary mb-2">Move member?</h2>
                        <p className="text-sm text-text-secondary mb-6">
                            Move <strong className="text-text-primary">{pendingReassign.userName}</strong> from{' '}
                            <strong className="text-text-primary">{pendingReassign.fromDeptName}</strong> to{' '}
                            <strong className="text-text-primary">{selectedDepartment.name}</strong>?
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={handleConfirmReassign}
                                disabled={isReassigning}
                                className="flex-1 bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isReassigning ? 'Moving...' : 'Move member'}
                            </button>
                            <button
                                type="button"
                                onClick={handleCancelReassign}
                                disabled={isReassigning}
                                className="flex-1 bg-surface-light text-text-primary border border-border px-4 py-2 rounded-lg font-medium hover:bg-surface transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {pendingDeleteDepartment && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 max-w-md w-full">
                        <h2 className="text-lg font-semibold text-text-primary mb-2">Delete department?</h2>
                        <p className="text-sm text-text-secondary mb-6">
                            Delete <strong className="text-text-primary">{pendingDeleteDepartment.name}</strong>? This cannot be undone.
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={handleConfirmDelete}
                                disabled={isDeleting}
                                className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isDeleting ? 'Deleting...' : 'Delete department'}
                            </button>
                            <button
                                type="button"
                                onClick={handleCancelDelete}
                                disabled={isDeleting}
                                className="flex-1 bg-surface-light text-text-primary border border-border px-4 py-2 rounded-lg font-medium hover:bg-surface transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DepartmentSettings;
