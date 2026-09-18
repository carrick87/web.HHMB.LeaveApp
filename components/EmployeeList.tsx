import React, { useState, useEffect, useMemo } from 'react';
import { getEmployees, deleteEmployee, clearAllEmployees } from '../services/firebaseService';
import { TrashIcon } from './Icons';
import { User as AppUser } from '../types';
import PageLoadingOverlay from './PageLoadingOverlay';
import { getEffectiveUserBranch, legacyEmpNumberBranchPrefix } from '../utils/departmentSettingsHelpers';

const EMPLOYEES_PAGE_SIZE = 50;

interface EmployeeListProps {
    users: AppUser[];
    onUpdate?: () => void;
    allowedBranches?: string[];
    canManage?: boolean;
}

const EmployeeList: React.FC<EmployeeListProps> = ({ users, onUpdate, allowedBranches, canManage = true }) => {
    const [employees, setEmployees] = useState<Array<{ id: string; employeeNumber: string; employeeName: string; payGroup?: string }>>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isExporting, setIsExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [employeePage, setEmployeePage] = useState(1);

    const branchScopeKey = allowedBranches ? allowedBranches.join(',') : '';

    const usersByEmployeeNumber = useMemo(() => {
        const map = new Map<string, AppUser>();
        for (const user of users) {
            const number = user.employeeNumber?.trim();
            if (number) map.set(number.toLowerCase(), user);
        }
        return map;
    }, [users]);

    const resolveEmployeeBranch = (employeeNumber: string): string => {
        const user = usersByEmployeeNumber.get(employeeNumber.trim().toLowerCase());
        if (user) return getEffectiveUserBranch(user);
        return legacyEmpNumberBranchPrefix(employeeNumber);
    };

    useEffect(() => {
        loadEmployees();
    }, [branchScopeKey]);

    const loadEmployees = async () => {
        try {
            setIsLoading(true);
            const data = await getEmployees();
            // Sort by employee number
            data.sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
            const scoped = allowedBranches
                ? data.filter((emp) => allowedBranches.includes(resolveEmployeeBranch(emp.employeeNumber)))
                : data;
            setEmployees(scoped);
            setError(null);
        } catch (err) {
            setError('Failed to load employees');
            console.error('Error loading employees:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (employeeId: string, employeeNumber: string) => {
        if (!confirm(`Are you sure you want to delete employee ${employeeNumber}?`)) return;

        try {
            await deleteEmployee(employeeId);
            await loadEmployees();
            if (onUpdate) onUpdate();
        } catch (err) {
            setError('Failed to delete employee');
            console.error('Error deleting employee:', err);
        }
    };

    const handleClearAll = async () => {
        if (!confirm('Are you sure you want to delete ALL employees? This action cannot be undone.')) return;

        try {
            await clearAllEmployees();
            await loadEmployees();
            if (onUpdate) onUpdate();
        } catch (err) {
            setError('Failed to clear employees');
            console.error('Error clearing employees:', err);
        }
    };

    const signedUpNumbers = useMemo(() => {
        const numbers = new Set<string>();
        for (const user of users) {
            const number = user.employeeNumber?.trim();
            if (number) numbers.add(number);
        }
        return numbers;
    }, [users]);

    const hasSignedUp = (employeeNumber: string): boolean =>
        signedUpNumbers.has(employeeNumber.trim());

    const getPayGroupLabel = (payGroup?: string): string => {
        return payGroup === '6' ? '6' : '5';
    };

    const getSignUpStatusLabel = (employeeNumber: string): string =>
        hasSignedUp(employeeNumber) ? 'Signed up' : 'Not signed up';

    const searchLower = searchTerm.toLowerCase();
    const filteredEmployees = employees.filter(emp => 
        emp.employeeNumber.toLowerCase().includes(searchLower) ||
        emp.employeeName.toLowerCase().includes(searchLower) ||
        getPayGroupLabel(emp.payGroup).toLowerCase().includes(searchLower)
    );
    const employeeTotalPages = Math.max(1, Math.ceil(filteredEmployees.length / EMPLOYEES_PAGE_SIZE));
    const safePage = Math.min(employeePage, employeeTotalPages);
    const pageStart = (safePage - 1) * EMPLOYEES_PAGE_SIZE;
    const pagedEmployees = filteredEmployees.slice(pageStart, pageStart + EMPLOYEES_PAGE_SIZE);

    const handleExportToExcel = async () => {
        if (employees.length === 0) return;

        setIsExporting(true);
        try {
            const XLSX = await import('xlsx');
            const exportData: (string | number)[][] = [
                ['Employee Number', 'Branch', 'Employee Name', 'Paygroup', 'Sign up status']
            ];
            for (const emp of employees) {
                exportData.push([
                    emp.employeeNumber,
                    resolveEmployeeBranch(emp.employeeNumber),
                    emp.employeeName,
                    getPayGroupLabel(emp.payGroup),
                    getSignUpStatusLabel(emp.employeeNumber)
                ]);
            }
            const ws = XLSX.utils.aoa_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Employee Master List');
            const dateStr = new Date().toISOString().split('T')[0];
            XLSX.writeFile(wb, `employee-master-list-${dateStr}.xlsx`);
        } catch (err) {
            console.error('Export failed:', err);
            setError('Failed to export to Excel. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="relative min-h-[400px]">
                <PageLoadingOverlay message="Loading employees…" />
            </div>
        );
    }

    return (
        <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-xl font-semibold text-text-primary">Employee Master List</h2>
                    <p className="text-sm text-text-secondary mt-1">Total: {employees.length} employee(s)</p>
                </div>
                {employees.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={handleExportToExcel}
                            disabled={isExporting}
                            className="bg-primary/20 text-primary px-4 py-2 rounded-lg font-medium hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isExporting ? 'Exporting…' : 'Export to Excel'}
                        </button>
                        {canManage && (
                            <button
                                onClick={handleClearAll}
                                className="bg-red-500/20 text-red-400 px-4 py-2 rounded-lg font-medium hover:bg-red-500/30 transition-colors flex items-center gap-2"
                            >
                                <TrashIcon className="w-4 h-4" />
                                Clear All
                            </button>
                        )}
                    </div>
                )}
            </div>

            {error && (
                <div className="mb-4 p-4 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg">
                    {error}
                </div>
            )}

            {/* Search */}
            {employees.length > 0 && (
                <div className="mb-4">
                    <input
                        type="text"
                        placeholder="Search by employee number or name..."
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setEmployeePage(1);
                        }}
                        className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-white placeholder-text-secondary"
                    />
                </div>
            )}

            {/* Employees Table */}
            {filteredEmployees.length > 0 ? (
                <div className="bg-surface-light rounded-lg border border-border overflow-hidden">
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-surface border-b border-border sticky top-0">
                                <tr>
                                    <th className="p-3 text-left text-text-secondary font-medium">Employee Number</th>
                                    <th className="p-3 text-left text-text-secondary font-medium">Branch</th>
                                    <th className="p-3 text-left text-text-secondary font-medium">Employee Name</th>
                                    <th className="p-3 text-left text-text-secondary font-medium">Paygroup</th>
                                    <th className="p-3 text-left text-text-secondary font-medium">Sign up status</th>
                                    {canManage && (
                                        <th className="p-3 text-left text-text-secondary font-medium">Actions</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {pagedEmployees.map((employee) => (
                                    <tr key={employee.id} className="border-b border-border last:border-b-0 hover:bg-slate-700 transition-colors">
                                        <td className="p-3 text-text-primary font-medium">{employee.employeeNumber}</td>
                                        <td className="p-3 text-text-primary font-medium">{resolveEmployeeBranch(employee.employeeNumber)}</td>
                                        <td className="p-3 text-text-primary">{employee.employeeName}</td>
                                        <td className="p-3 text-text-primary">{getPayGroupLabel(employee.payGroup)}</td>
                                        <td className="p-3">
                                            <span
                                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                    hasSignedUp(employee.employeeNumber)
                                                        ? 'bg-green-500/20 text-green-400'
                                                        : 'bg-slate-600/40 text-slate-300'
                                                }`}
                                            >
                                                {getSignUpStatusLabel(employee.employeeNumber)}
                                            </span>
                                        </td>
                                        {canManage && (
                                            <td className="p-3">
                                                <button
                                                    onClick={() => handleDelete(employee.id, employee.employeeNumber)}
                                                    className="p-2 text-red-400 hover:bg-red-500/20 rounded-md transition-colors"
                                                    title="Delete Employee"
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border">
                        <p className="text-sm text-text-muted">
                            Showing {pageStart + 1}
                            &ndash;{Math.min(pageStart + EMPLOYEES_PAGE_SIZE, filteredEmployees.length)} of {filteredEmployees.length} employees
                        </p>
                        {employeeTotalPages > 1 && (
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setEmployeePage(p => Math.max(1, p - 1))}
                                    disabled={safePage === 1}
                                    className="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-text-primary hover:border-primary/40 hover:bg-primary/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Previous
                                </button>
                                <span className="text-sm text-text-secondary px-1">
                                    Page {safePage} of {employeeTotalPages}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setEmployeePage(p => Math.min(employeeTotalPages, p + 1))}
                                    disabled={safePage === employeeTotalPages}
                                    className="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-text-primary hover:border-primary/40 hover:bg-primary/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            ) : employees.length === 0 ? (
                <div className="p-12 text-center">
                    <div className="text-6xl mb-4">👥</div>
                    <p className="text-text-primary text-lg font-medium mb-2">No employees found</p>
                    <p className="text-text-muted">
                        {canManage
                            ? 'Upload an Excel file to add employees to the master list.'
                            : 'Use the form above to register employees for your branch.'}
                    </p>
                </div>
            ) : (
                <div className="p-12 text-center">
                    <p className="text-text-primary text-lg font-medium mb-2">No employees match your search</p>
                    <p className="text-text-muted">Try a different search term.</p>
                </div>
            )}
        </div>
    );
};

export default EmployeeList;

