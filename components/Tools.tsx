import React, { useState } from 'react';
import { UserRole, Department, User } from '../types';
import { updateLeaveRequestsWithRequesterInfo, clearAllLeaveRequests } from '../services/firebaseService';
import { WrenchScrewdriverIcon } from './Icons';

interface ToolsProps {
    currentUser: {
        role: UserRole;
    };
    onClearAll?: () => Promise<{ success: boolean; count: number }>;
    departments?: Department[];
    users?: User[];
}

const Tools: React.FC<ToolsProps> = ({ currentUser, onClearAll, departments = [], users = [] }) => {
    const [isUpdatingLeaveRequests, setIsUpdatingLeaveRequests] = useState(false);
    const [isClearingAll, setIsClearingAll] = useState(false);
    const [isExportingDepartments, setIsExportingDepartments] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleUpdateLeaveRequestsWithRequesterInfo = async () => {
        if (!confirm('This will update all leave requests that are missing requesterDepartmentId or requesterName.\n\nThis is useful for old leave requests created before these fields were added.\n\nContinue?')) {
            return;
        }

        setIsUpdatingLeaveRequests(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await updateLeaveRequestsWithRequesterInfo();
            setSuccess(`Successfully updated ${result.updated} leave request(s). ${result.skipped} were already up-to-date. ${result.errors > 0 ? `${result.errors} had errors (user not found).` : ''}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update leave requests');
        } finally {
            setIsUpdatingLeaveRequests(false);
        }
    };

    const handleClearAllRequests = async () => {
        if (!confirm('Are you sure you want to clear ALL leave requests? This action cannot be undone.')) {
            return;
        }

        setIsClearingAll(true);
        setError(null);
        setSuccess(null);

        try {
            if (onClearAll) {
                const result = await onClearAll();
                if (result && typeof result === 'object' && 'count' in result) {
                    setSuccess(`Successfully cleared ${result.count} leave request(s).`);
                } else {
                    setSuccess('Successfully cleared all leave requests.');
                }
            } else {
                const result = await clearAllLeaveRequests();
                setSuccess(`Successfully cleared ${result.count} leave request(s).`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to clear leave requests');
        } finally {
            setIsClearingAll(false);
        }
    };

    const handleExportDepartments = async () => {
        if (departments.length === 0) {
            setError('No departments available to export.');
            return;
        }

        setIsExportingDepartments(true);
        setError(null);
        setSuccess(null);

        try {
            // Import XLSX library dynamically
            const XLSX = await import('xlsx');
            
            // Prepare export data
            const exportData: any[] = [];
            
            // Header row
            exportData.push([
                'Department Name',
                'Branch',
                'Approvers (Names)',
                'Approvers (Employee Numbers)',
                'CC Emails',
                'Users in Department (Names)',
                'Users in Department (Employee Numbers)',
                'User Count'
            ]);
            
            // Process each department
            for (const department of departments) {
                // Get approver names and employee numbers
                const approverNames: string[] = [];
                const approverEmployeeNumbers: string[] = [];
                
                if (department.approverIds && department.approverIds.length > 0) {
                    department.approverIds.forEach(approverId => {
                        const approver = users.find(u => u.id === approverId);
                        if (approver) {
                            approverNames.push(approver.name);
                            approverEmployeeNumbers.push(approver.employeeNumber || 'N/A');
                        } else {
                            approverNames.push(`User ${approverId.substring(0, 8)}... (Deleted)`);
                            approverEmployeeNumbers.push('N/A');
                        }
                    });
                }
                
                // Get users in this department
                const departmentUsers = users.filter(u => u.departmentId === department.id);
                const userNames = departmentUsers.map(u => u.name);
                const userEmployeeNumbers = departmentUsers.map(u => u.employeeNumber || 'N/A');
                
                // Add row
                exportData.push([
                    department.name || '',
                    department.branch || '',
                    approverNames.join('; ') || 'None',
                    approverEmployeeNumbers.join('; ') || 'None',
                    (department.ccEmails && department.ccEmails.length > 0) ? department.ccEmails.join('; ') : 'None',
                    userNames.join('; ') || 'None',
                    userEmployeeNumbers.join('; ') || 'None',
                    departmentUsers.length
                ]);
            }
            
            // Create workbook and worksheet
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(exportData);
            
            // Set column widths
            ws['!cols'] = [
                { wch: 25 }, // Department Name
                { wch: 10 }, // Branch
                { wch: 30 }, // Approvers (Names)
                { wch: 30 }, // Approvers (Employee Numbers)
                { wch: 30 }, // CC Emails
                { wch: 30 }, // Users in Department (Names)
                { wch: 30 }, // Users in Department (Employee Numbers)
                { wch: 12 }  // User Count
            ];
            
            XLSX.utils.book_append_sheet(wb, ws, 'Departments');
            
            // Generate filename with current date
            const currentDate = new Date();
            const dateStr = currentDate.toISOString().split('T')[0];
            const fileName = `departments-export-${dateStr}.xlsx`;
            
            // Write file
            XLSX.writeFile(wb, fileName);
            setSuccess(`Successfully exported ${departments.length} department(s).`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to export departments');
        } finally {
            setIsExportingDepartments(false);
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-4">
                    <WrenchScrewdriverIcon className="w-8 h-8 text-primary" />
                    <h1 className="text-3xl font-bold text-text-primary">Tools</h1>
                </div>
                <p className="text-text-secondary">Administrative tools for system maintenance</p>
            </div>

            {/* Success/Error Messages */}
            {success && (
                <div className="mb-6 p-4 bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg">
                    <p>{success}</p>
                </div>
            )}

            {error && (
                <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg">
                    <p>{error}</p>
                </div>
            )}

            {/* Tools Section */}
            <div className="space-y-6">
                {/* Update Leave Requests Info Tool */}
                <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="flex-1">
                            <h2 className="text-xl font-semibold text-text-primary mb-2">Update Leave Requests Info</h2>
                            <p className="text-text-secondary text-sm mb-2">
                                Update existing leave requests with requester department ID and name.
                            </p>
                            <p className="text-text-muted text-xs">
                                This tool is useful for updating old leave requests that were created before the requesterDepartmentId and requesterName fields were added. 
                                It ensures that leave requests from deleted users remain visible in the approval and calendar views.
                            </p>
                        </div>
                        <button
                            onClick={handleUpdateLeaveRequestsWithRequesterInfo}
                            disabled={isUpdatingLeaveRequests}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                            {isUpdatingLeaveRequests ? (
                                <span className="flex items-center gap-2">
                                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                                    Updating...
                                </span>
                            ) : (
                                'Update Leave Requests'
                            )}
                        </button>
                    </div>
                </div>

                {/* Export Departments Tool */}
                {currentUser.role === UserRole.SUPER_ADMIN && (
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div className="flex-1">
                                <h2 className="text-xl font-semibold text-text-primary mb-2">Export Departments</h2>
                                <p className="text-text-secondary text-sm mb-2">
                                    Export all departments with their approvers, CC emails, and assigned users.
                                </p>
                                <p className="text-text-muted text-xs">
                                    The export includes department name, branch, approver details, CC email addresses, and all users assigned to each department.
                                </p>
                            </div>
                            <button
                                onClick={handleExportDepartments}
                                disabled={isExportingDepartments || departments.length === 0}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                                {isExportingDepartments ? (
                                    <span className="flex items-center gap-2">
                                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                                        Exporting...
                                    </span>
                                ) : (
                                    'Export Departments'
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* Clear All Leave Requests Tool */}
                {currentUser.role === UserRole.SUPER_ADMIN && (
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div className="flex-1">
                                <h2 className="text-xl font-semibold text-text-primary mb-2">Clear All Leave Requests</h2>
                                <p className="text-text-secondary text-sm mb-2">
                                    Permanently delete all leave requests from the system.
                                </p>
                                <p className="text-text-muted text-xs">
                                    <strong className="text-red-400">Warning:</strong> This action cannot be undone. All leave requests and their history will be permanently deleted.
                                </p>
                            </div>
                            <button
                                onClick={handleClearAllRequests}
                                disabled={isClearingAll}
                                className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                                {isClearingAll ? (
                                    <span className="flex items-center gap-2">
                                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                                        Clearing...
                                    </span>
                                ) : (
                                    'Clear All Requests'
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* Placeholder for future tools */}
                <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 opacity-50">
                    <h2 className="text-xl font-semibold text-text-primary mb-2">More Tools Coming Soon</h2>
                    <p className="text-text-secondary text-sm">
                        Additional administrative tools will be added here in the future.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Tools;
