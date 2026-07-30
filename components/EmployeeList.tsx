import React, { useState, useEffect } from 'react';
import { getEmployees, deleteEmployee, clearAllEmployees } from '../services/firebaseService';
import { TrashIcon } from './Icons';
import { User as AppUser } from '../types';

interface EmployeeListProps {
    users: AppUser[];
    onUpdate?: () => void;
}

const EmployeeList: React.FC<EmployeeListProps> = ({ users, onUpdate }) => {
    const [employees, setEmployees] = useState<Array<{ id: string; employeeNumber: string; employeeName: string; payGroup?: string }>>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isExporting, setIsExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadEmployees();
    }, []);

    const loadEmployees = async () => {
        try {
            setIsLoading(true);
            const data = await getEmployees();
            // Sort by employee number
            data.sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
            setEmployees(data);
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

    // Helper function to extract branch from employee number (first 2 characters)
    const getBranch = (employeeNumber: string): string => {
        return employeeNumber.substring(0, 2);
    };

    const hasSignedUp = (employeeNumber: string): boolean =>
        users.some(u => u.employeeNumber?.trim() === employeeNumber.trim());

    const getPayGroupLabel = (payGroup?: string): string => {
        return payGroup === '6' ? '6' : '5';
    };

    const getSignUpStatusLabel = (employeeNumber: string): string =>
        hasSignedUp(employeeNumber) ? 'Signed up' : 'Not signed up';

    const filteredEmployees = employees.filter(emp => 
        emp.employeeNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        getPayGroupLabel(emp.payGroup).toLowerCase().includes(searchTerm.toLowerCase())
    );

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
                    getBranch(emp.employeeNumber),
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
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-text-secondary">Loading employees...</p>
                </div>
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
                        <button
                            onClick={handleClearAll}
                            className="bg-red-500/20 text-red-400 px-4 py-2 rounded-lg font-medium hover:bg-red-500/30 transition-colors flex items-center gap-2"
                        >
                            <TrashIcon className="w-4 h-4" />
                            Clear All
                        </button>
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
                        onChange={(e) => setSearchTerm(e.target.value)}
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
                                    <th className="p-3 text-left text-text-secondary font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredEmployees.map((employee) => (
                                    <tr key={employee.id} className="border-b border-border last:border-b-0 hover:bg-slate-700 transition-colors">
                                        <td className="p-3 text-text-primary font-medium">{employee.employeeNumber}</td>
                                        <td className="p-3 text-text-primary font-medium">{getBranch(employee.employeeNumber)}</td>
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
                                        <td className="p-3">
                                            <button
                                                onClick={() => handleDelete(employee.id, employee.employeeNumber)}
                                                className="p-2 text-red-400 hover:bg-red-500/20 rounded-md transition-colors"
                                                title="Delete Employee"
                                            >
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : employees.length === 0 ? (
                <div className="p-12 text-center">
                    <div className="text-6xl mb-4">👥</div>
                    <p className="text-text-primary text-lg font-medium mb-2">No employees found</p>
                    <p className="text-text-muted">Upload an Excel file to add employees to the master list.</p>
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

