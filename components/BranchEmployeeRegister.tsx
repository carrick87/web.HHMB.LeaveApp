import React, { useEffect, useMemo, useState } from 'react';
import { Branch, User } from '../types';
import { PlusIcon, TrashIcon } from './Icons';
import {
    registerBranchEmployees,
    type BranchEmployeeCreated,
    type BranchEmployeeFailed
} from '../services/firebaseService';
import {
    getAdminAllowedBranches,
    getAvailableBranchOptions,
    formatBranchLabel,
} from '../utils/departmentSettingsHelpers';

interface BranchEmployeeRegisterProps {
    currentUser: User;
    branches: Branch[];
    onComplete?: () => void;
}

interface FormRow {
    id: string;
    employeeNumber: string;
    name: string;
    email: string;
    payGroup: '5' | '6' | '';
    error?: string;
}

const EMAIL_DOMAIN = '@harrisons.com.my';
const MAX_ROWS = 25;

const createEmptyRow = (): FormRow => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    employeeNumber: '',
    name: '',
    email: '',
    payGroup: '5'
});

const buildCredentialsMessage = (
    created: BranchEmployeeCreated[],
    branchLabel: string
): string => {
    const lines = created.map((emp) => {
        return `${emp.name}
Employee number: ${emp.employeeNumber}
Branch: ${emp.branch || branchLabel}
Email: ${emp.email}
Password: ${emp.password}`;
    });
    return `The following Leave Application accounts have been created.

Initial password is the employee number (padded with leading zeros to 6 characters if shorter). Sign in with email and password, then change the password from Profile.

${lines.join('\n\n')}`;
};

const BranchEmployeeRegister: React.FC<BranchEmployeeRegisterProps> = ({
    currentUser,
    branches,
    onComplete,
}) => {
    const [rows, setRows] = useState<FormRow[]>([createEmptyRow()]);
    const [selectedBranch, setSelectedBranch] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [created, setCreated] = useState<BranchEmployeeCreated[] | null>(null);
    const [copied, setCopied] = useState(false);
    const [failedSummary, setFailedSummary] = useState<BranchEmployeeFailed[]>([]);

    const allowedBranches = useMemo(() => getAdminAllowedBranches(currentUser), [currentUser]);
    const branchOptions = useMemo(
        () => getAvailableBranchOptions(branches, allowedBranches),
        [branches, allowedBranches]
    );
    const branchByCode = useMemo(() => {
        const map = new Map<string, Branch>();
        branches.forEach((b) => map.set(b.code, b));
        return map;
    }, [branches]);
    const selectedBranchLabel = selectedBranch
        ? formatBranchLabel(branchByCode.get(selectedBranch) || selectedBranch)
        : '';

    useEffect(() => {
        if (branchOptions.length === 0) {
            setSelectedBranch('');
            return;
        }
        setSelectedBranch((prev) => (prev && branchOptions.includes(prev) ? prev : branchOptions[0]!));
    }, [branchOptions]);

    const credentialsMessage = created
        ? buildCredentialsMessage(created, selectedBranchLabel)
        : '';

    const updateRow = (id: string, field: keyof FormRow, value: string) => {
        setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value, error: undefined } : row)));
    };

    const addRow = () => {
        if (rows.length >= MAX_ROWS) {
            setError(`You can register at most ${MAX_ROWS} employees at a time.`);
            return;
        }
        setRows((prev) => [...prev, createEmptyRow()]);
        setError(null);
    };

    const removeRow = (id: string) => {
        setRows((prev) => (prev.length === 1 ? [createEmptyRow()] : prev.filter((row) => row.id !== id)));
    };

    const validateRow = (row: FormRow, seen: Set<string>): string | null => {
        const employeeNumber = row.employeeNumber.trim();
        const name = row.name.trim();
        const email = row.email.trim().toLowerCase();

        if (!employeeNumber && !name && !email) {
            return 'This row is empty. Fill it in or remove it.';
        }
        if (!employeeNumber) {
            return 'Employee number is required.';
        }
        if (employeeNumber.length < 4) {
            return 'Employee number must be at least 4 characters.';
        }
        if (!/^[A-Za-z0-9]+$/.test(employeeNumber)) {
            return 'Employee number can only contain letters and numbers (no spaces or symbols).';
        }
        if (seen.has(employeeNumber.toLowerCase())) {
            return 'Duplicate employee number in this list.';
        }
        if (!name) {
            return 'Name is required.';
        }
        if (!email || !email.includes('@')) {
            return 'A valid email address is required.';
        }
        if (!email.endsWith(EMAIL_DOMAIN)) {
            return `Only ${EMAIL_DOMAIN} email addresses are allowed.`;
        }
        if (row.payGroup !== '5' && row.payGroup !== '6') {
            return 'Select pay group 5 or 6.';
        }
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setFailedSummary([]);
        setCopied(false);

        if (!selectedBranch) {
            setError('Select a branch before registering employees.');
            return;
        }
        if (allowedBranches && !allowedBranches.includes(selectedBranch)) {
            setError('Selected branch is not in your assigned branches.');
            return;
        }

        const seen = new Set<string>();
        let hasError = false;
        const nextRows = rows.map((row) => {
            const rowError = validateRow(row, seen);
            if (!rowError && row.employeeNumber.trim()) {
                seen.add(row.employeeNumber.trim().toLowerCase());
            }
            if (rowError) {
                hasError = true;
            }
            return { ...row, error: rowError || undefined };
        });
        setRows(nextRows);

        if (hasError) {
            setError('Fix the highlighted rows before submitting.');
            return;
        }

        const payload = nextRows.map((row) => ({
            employeeNumber: row.employeeNumber.trim(),
            name: row.name.trim(),
            email: row.email.trim().toLowerCase(),
            payGroup: row.payGroup as '5' | '6',
            branch: selectedBranch,
        }));

        setIsSubmitting(true);
        try {
            const result = await registerBranchEmployees(payload);
            const failedByNumber = new Map(
                result.failed.map((item) => [item.employeeNumber.trim().toLowerCase(), item.error])
            );

            setRows((prev) => {
                const remaining = prev.filter((row) => failedByNumber.has(row.employeeNumber.trim().toLowerCase()));
                const withErrors = remaining.map((row) => ({
                    ...row,
                    error: failedByNumber.get(row.employeeNumber.trim().toLowerCase())
                }));
                return withErrors.length > 0 ? withErrors : [createEmptyRow()];
            });

            setFailedSummary(result.failed);
            if (result.created.length > 0) {
                setCreated(result.created);
            } else if (result.failed.length > 0) {
                setError('No accounts were created. See row errors below.');
            }

            if (result.created.length > 0 && onComplete) {
                onComplete();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to register employees.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const copyCredentials = async () => {
        if (!credentialsMessage) {
            return;
        }
        try {
            await navigator.clipboard.writeText(credentialsMessage);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            setError('Unable to copy. Select the text and copy it manually.');
        }
    };

    const closeResults = () => {
        setCreated(null);
        setCopied(false);
    };

    return (
        <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 mb-8">
            <div className="mb-6">
                <h2 className="text-xl font-semibold text-text-primary">Register employees</h2>
                <p className="text-sm text-text-secondary mt-1">
                    Add employees for a selected branch. Submit creates the master record and an Email/Password login (initial password = employee number, padded to 6 characters).
                </p>
            </div>

            {error && (
                <div className="mb-4 p-4 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg">
                    {error}
                </div>
            )}

            {failedSummary.length > 0 && created === null && (
                <div className="mb-4 p-4 bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-lg text-sm">
                    {failedSummary.length} row{failedSummary.length === 1 ? '' : 's'} could not be registered. Fix them and submit again.
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                        Branch <span className="text-red-400">*</span>
                    </label>
                    <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        className="w-full max-w-md bg-surface-light border border-border rounded-md p-2.5 text-text-primary focus:ring-primary focus:border-primary"
                        disabled={isSubmitting || branchOptions.length === 0}
                        required
                    >
                        {branchOptions.length === 0 ? (
                            <option value="">No branches available</option>
                        ) : (
                            branchOptions.map((code) => (
                                <option key={code} value={code}>
                                    {formatBranchLabel(branchByCode.get(code) || code)}
                                </option>
                            ))
                        )}
                    </select>
                    {branchOptions.length === 0 && (
                        <p className="text-xs text-amber-300 mt-1">
                            No active branches available. Ask a Super Admin to create branches first.
                        </p>
                    )}
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[720px]">
                        <thead>
                            <tr className="text-left text-text-secondary">
                                <th className="pb-2 font-medium pr-2">Employee number</th>
                                <th className="pb-2 font-medium pr-2">Name</th>
                                <th className="pb-2 font-medium pr-2">Email</th>
                                <th className="pb-2 font-medium pr-2 w-28">Pay group</th>
                                <th className="pb-2 font-medium w-12"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id} className="align-top">
                                    <td className="pb-3 pr-2">
                                        <input
                                            type="text"
                                            value={row.employeeNumber}
                                            onChange={(e) => updateRow(row.id, 'employeeNumber', e.target.value)}
                                            placeholder="e.g. 101234"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={`w-full bg-surface-light border rounded-md p-2.5 text-text-primary focus:ring-primary focus:border-primary ${
                                                row.error ? 'border-red-500/60' : 'border-border'
                                            }`}
                                            disabled={isSubmitting}
                                        />
                                    </td>
                                    <td className="pb-3 pr-2">
                                        <input
                                            type="text"
                                            value={row.name}
                                            onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                                            placeholder="Full name"
                                            className={`w-full bg-surface-light border rounded-md p-2.5 text-text-primary focus:ring-primary focus:border-primary ${
                                                row.error ? 'border-red-500/60' : 'border-border'
                                            }`}
                                            disabled={isSubmitting}
                                        />
                                    </td>
                                    <td className="pb-3 pr-2">
                                        <input
                                            type="email"
                                            value={row.email}
                                            onChange={(e) => updateRow(row.id, 'email', e.target.value)}
                                            placeholder={`name${EMAIL_DOMAIN}`}
                                            className={`w-full bg-surface-light border rounded-md p-2.5 text-text-primary focus:ring-primary focus:border-primary ${
                                                row.error ? 'border-red-500/60' : 'border-border'
                                            }`}
                                            disabled={isSubmitting}
                                        />
                                    </td>
                                    <td className="pb-3 pr-2">
                                        <select
                                            value={row.payGroup}
                                            onChange={(e) => updateRow(row.id, 'payGroup', e.target.value)}
                                            className={`w-full bg-surface-light border rounded-md p-2.5 text-text-primary focus:ring-primary focus:border-primary ${
                                                row.error ? 'border-red-500/60' : 'border-border'
                                            }`}
                                            disabled={isSubmitting}
                                        >
                                            <option value="5">5</option>
                                            <option value="6">6</option>
                                        </select>
                                    </td>
                                    <td className="pb-3">
                                        <button
                                            type="button"
                                            onClick={() => removeRow(row.id)}
                                            className="p-2 text-text-muted hover:text-red-400 transition-colors"
                                            disabled={isSubmitting}
                                            aria-label="Remove row"
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {rows.some((r) => r.error) && (
                    <ul className="text-sm text-red-400 space-y-1">
                        {rows.filter((r) => r.error).map((r) => (
                            <li key={r.id}>{r.employeeNumber || 'Row'}: {r.error}</li>
                        ))}
                    </ul>
                )}

                <div className="flex flex-wrap gap-3 pt-2">
                    <button
                        type="button"
                        onClick={addRow}
                        disabled={isSubmitting || rows.length >= MAX_ROWS}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-text-primary hover:bg-surface-light transition-colors disabled:opacity-50"
                    >
                        <PlusIcon className="w-4 h-4" />
                        Add row
                    </button>
                    <button
                        type="submit"
                        disabled={isSubmitting || branchOptions.length === 0}
                        className="bg-primary text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? 'Registering…' : 'Register employees'}
                    </button>
                </div>
            </form>

            {created && created.length > 0 && (
                <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <h3 className="text-lg font-semibold text-emerald-300">
                            Created {created.length} account{created.length === 1 ? '' : 's'}
                            {selectedBranchLabel ? ` · ${selectedBranchLabel}` : ''}
                        </h3>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={copyCredentials}
                                className="px-3 py-1.5 text-sm rounded-md bg-emerald-600/80 text-white hover:bg-emerald-600"
                            >
                                {copied ? 'Copied' : 'Copy credentials'}
                            </button>
                            <button
                                type="button"
                                onClick={closeResults}
                                className="px-3 py-1.5 text-sm rounded-md border border-border text-text-secondary hover:text-text-primary"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                    <pre className="whitespace-pre-wrap text-sm text-text-secondary bg-surface-light/50 p-3 rounded-md overflow-x-auto">
                        {credentialsMessage}
                    </pre>
                </div>
            )}
        </div>
    );
};

export default BranchEmployeeRegister;
