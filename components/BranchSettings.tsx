import React, { useEffect, useState } from 'react';
import { Branch } from '../types';
import {
    ensureBranchesSeeded,
    saveBranch,
    updateBranch,
    deleteBranch,
} from '../services/firebaseService';
import { formatBranchLabel } from '../utils/departmentSettingsHelpers';
import { PlusIcon, PencilIcon, CheckIcon, XIcon, TrashIcon } from './Icons';

interface BranchSettingsProps {
    branches: Branch[];
    onBranchesChange?: () => void;
}

const BranchSettings: React.FC<BranchSettingsProps> = ({ branches, onBranchesChange }) => {
    const [isSeeding, setIsSeeding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const [newCode, setNewCode] = useState('');
    const [newName, setNewName] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    const [editingCode, setEditingCode] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [pendingDeleteCode, setPendingDeleteCode] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const seed = async () => {
            if (branches.length > 0) return;
            setIsSeeding(true);
            setError(null);
            try {
                await ensureBranchesSeeded();
                if (!cancelled) onBranchesChange?.();
            } catch (err: any) {
                if (!cancelled) setError(err?.message || 'Failed to seed default branches');
            } finally {
                if (!cancelled) setIsSeeding(false);
            }
        };
        seed();
        return () => {
            cancelled = true;
        };
    }, [branches.length, onBranchesChange]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setIsCreating(true);
        try {
            await saveBranch(newCode, newName);
            setNewCode('');
            setNewName('');
            setSuccess('Branch created.');
            onBranchesChange?.();
        } catch (err: any) {
            setError(err?.message || 'Failed to create branch');
        } finally {
            setIsCreating(false);
        }
    };

    const startEdit = (branch: Branch) => {
        setEditingCode(branch.code);
        setEditName(branch.name || branch.code);
        setError(null);
        setSuccess(null);
    };

    const cancelEdit = () => {
        setEditingCode(null);
        setEditName('');
    };

    const saveEdit = async () => {
        if (!editingCode) return;
        setIsSavingEdit(true);
        setError(null);
        setSuccess(null);
        try {
            await updateBranch(editingCode, { name: editName });
            setSuccess('Branch updated.');
            setEditingCode(null);
            onBranchesChange?.();
        } catch (err: any) {
            setError(err?.message || 'Failed to update branch');
        } finally {
            setIsSavingEdit(false);
        }
    };

    const toggleActive = async (branch: Branch) => {
        setError(null);
        setSuccess(null);
        try {
            await updateBranch(branch.code, { isActive: branch.isActive === false });
            setSuccess(branch.isActive === false ? 'Branch activated.' : 'Branch deactivated.');
            onBranchesChange?.();
        } catch (err: any) {
            setError(err?.message || 'Failed to update branch status');
        }
    };

    const pendingDeleteBranch = pendingDeleteCode
        ? branches.find((b) => b.code === pendingDeleteCode) ?? null
        : null;

    const requestDelete = (branch: Branch) => {
        setError(null);
        setSuccess(null);
        setPendingDeleteCode(branch.code);
    };

    const cancelDelete = () => {
        if (isDeleting) return;
        setPendingDeleteCode(null);
    };

    const confirmDelete = async () => {
        if (!pendingDeleteCode) return;
        setIsDeleting(true);
        setError(null);
        setSuccess(null);
        try {
            await deleteBranch(pendingDeleteCode);
            if (editingCode === pendingDeleteCode) {
                setEditingCode(null);
                setEditName('');
            }
            setSuccess(`Branch ${pendingDeleteCode} deleted.`);
            setPendingDeleteCode(null);
            onBranchesChange?.();
        } catch (err: any) {
            setError(err?.message || 'Failed to delete branch');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="animate-fade-in space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-text-primary">Branches</h1>
                <p className="text-text-secondary mt-2">
                    Add and edit branch codes used for departments, admin scope, and employee registration.
                </p>
            </div>

            {error && (
                <div className="p-4 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg">{error}</div>
            )}
            {success && (
                <div className="p-4 bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg">{success}</div>
            )}
            {isSeeding && (
                <p className="text-sm text-text-muted">Seeding default branches…</p>
            )}

            <form onSubmit={handleCreate} className="bg-card-bg rounded-xl border border-border p-6 space-y-4">
                <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                    <PlusIcon className="w-5 h-5" />
                    Add branch
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">Code</label>
                        <input
                            type="text"
                            value={newCode}
                            onChange={(e) => setNewCode(e.target.value)}
                            placeholder="e.g. 10"
                            required
                            className="w-full bg-surface-light border border-border rounded-md p-3 text-text-primary"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-text-secondary mb-1">Name</label>
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="e.g. HQ"
                            className="w-full bg-surface-light border border-border rounded-md p-3 text-text-primary"
                        />
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={isCreating}
                    className="bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-focus disabled:opacity-50"
                >
                    {isCreating ? 'Creating…' : 'Create branch'}
                </button>
            </form>

            <div className="bg-card-bg rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-text-secondary border-b border-border bg-surface-light/50">
                                <th className="p-4 font-medium">Code</th>
                                <th className="p-4 font-medium">Name</th>
                                <th className="p-4 font-medium">Status</th>
                                <th className="p-4 font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {branches.map((branch) => (
                                <tr key={branch.code} className="border-b border-border last:border-b-0">
                                    <td className="p-4 font-medium text-text-primary">{branch.code}</td>
                                    <td className="p-4 text-text-primary">
                                        {editingCode === branch.code ? (
                                            <input
                                                type="text"
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                className="w-full max-w-xs bg-surface-light border border-border rounded-md p-2 text-text-primary"
                                            />
                                        ) : (
                                            formatBranchLabel(branch)
                                        )}
                                    </td>
                                    <td className="p-4">
                                        <span
                                            className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                                                branch.isActive === false
                                                    ? 'bg-red-500/20 text-red-400'
                                                    : 'bg-green-500/20 text-green-400'
                                            }`}
                                        >
                                            {branch.isActive === false ? 'Inactive' : 'Active'}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex flex-wrap gap-2">
                                            {editingCode === branch.code ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={saveEdit}
                                                        disabled={isSavingEdit}
                                                        className="p-2 text-green-400 hover:bg-green-500/20 rounded-md"
                                                        title="Save"
                                                    >
                                                        <CheckIcon className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={cancelEdit}
                                                        className="p-2 text-text-muted hover:bg-surface-light rounded-md"
                                                        title="Cancel"
                                                    >
                                                        <XIcon className="w-4 h-4" />
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => startEdit(branch)}
                                                    className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-md"
                                                    title="Edit name"
                                                >
                                                    <PencilIcon className="w-4 h-4" />
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => toggleActive(branch)}
                                                className="px-3 py-1 text-xs rounded-md border border-border text-text-secondary hover:bg-surface-light"
                                            >
                                                {branch.isActive === false ? 'Activate' : 'Deactivate'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => requestDelete(branch)}
                                                disabled={isDeleting}
                                                className="p-2 text-red-400 hover:bg-red-500/20 rounded-md disabled:opacity-50"
                                                title="Delete branch"
                                            >
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {branches.length === 0 && !isSeeding && (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-text-muted">
                                        No branches yet. Create one above.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {pendingDeleteBranch && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 max-w-md w-full">
                        <h2 className="text-lg font-semibold text-text-primary mb-2">Delete branch?</h2>
                        <p className="text-sm text-text-secondary mb-2">
                            Delete <strong className="text-text-primary">{formatBranchLabel(pendingDeleteBranch)}</strong>? This cannot be undone.
                        </p>
                        <p className="text-xs text-text-muted mb-6">
                            This removes it from the catalog. Existing users and departments that still reference code{' '}
                            <strong className="text-text-secondary">{pendingDeleteBranch.code}</strong> are not changed.
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={confirmDelete}
                                disabled={isDeleting}
                                className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isDeleting ? 'Deleting…' : 'Delete branch'}
                            </button>
                            <button
                                type="button"
                                onClick={cancelDelete}
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

export default BranchSettings;
