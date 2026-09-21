import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { User, LeaveBalanceHistory } from '../types';
import { uploadLeaveBalanceHistory, getEmployees, getAllLeaveBalanceHistory, getAllCurrentLeaveBalances } from '../services/firebaseService';
import { downloadLeaveBalanceUploadTemplate } from '../utils/uploadTemplates';
import { UploadIcon, DownloadIcon, XIcon } from './Icons';

interface LeaveBalanceUploadProps {
    currentUser: User;
    users: User[];
    onUploadComplete: () => void;
}

interface Employee {
    id: string;
    employeeNumber: string;
    employeeName: string;
}

const LeaveBalanceUpload: React.FC<LeaveBalanceUploadProps> = ({ currentUser, users, onUploadComplete }) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [effectiveDate, setEffectiveDate] = useState<string>('');
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [previewData, setPreviewData] = useState<Array<{ employeeNumber: string; leaveBalance: number; employeeName?: string; isInMasterList: boolean; hasSignedUp: boolean }>>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [uploadHistory, setUploadHistory] = useState<LeaveBalanceHistory[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);

    // Load employees from master list
    useEffect(() => {
        const loadEmployees = async () => {
            try {
                const employeeList = await getEmployees();
                setEmployees(employeeList);
            } catch (err) {
                console.error('Error loading employees:', err);
            }
        };
        loadEmployees();
    }, []);

    // Load upload history
    const loadUploadHistory = async () => {
        setIsLoadingHistory(true);
        try {
            const history = await getAllLeaveBalanceHistory();
            setUploadHistory(history);
        } catch (err) {
            console.error('Error loading upload history:', err);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    // Load history on component mount and after upload
    useEffect(() => {
        loadUploadHistory();
    }, []);

    // Format date for display
    const formatDate = (dateString: string): string => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.name.match(/\.(xlsx|xls)$/i)) {
            setError('Please select a valid Excel file (.xlsx or .xls)');
            return;
        }

        setSelectedFile(file);
        setError(null);
        setSuccess(null);
        setPreviewData([]);

        try {
            // Read Excel file
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

            // Parse data: Column A = Employee Number, Column H = Leave Balance
            const parsedData: Array<{ employeeNumber: string; leaveBalance: number; employeeName?: string; isInMasterList: boolean; hasSignedUp: boolean }> = [];
            
            // Skip header row (row 0) and process from row 1
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                const empNo = String(row[0] || '').trim(); // Column A (index 0)
                const leaveBal = row[7]; // Column H (index 7)

                if (!empNo) continue; // Skip empty rows

                // Validate leave balance
                const balance = typeof leaveBal === 'number' ? leaveBal : parseFloat(String(leaveBal || '0'));
                if (isNaN(balance)) {
                    console.warn(`Invalid leave balance for employee ${empNo}: ${leaveBal}`);
                    continue;
                }

                // Find employee name from master list
                const employee = employees.find(e => e.employeeNumber === empNo);
                // Check if user has signed up
                const user = users.find(u => u.employeeNumber === empNo);
                
                parsedData.push({
                    employeeNumber: empNo,
                    leaveBalance: balance,
                    employeeName: employee?.employeeName || user?.name,
                    isInMasterList: !!employee,
                    hasSignedUp: !!user
                });
            }

            if (parsedData.length === 0) {
                setError('No valid data found in the Excel file. Please check the format.');
                return;
            }

            setPreviewData(parsedData);
        } catch (err) {
            console.error('Error reading Excel file:', err);
            setError('Failed to read Excel file. Please ensure it is a valid Excel file.');
        }
    };

    const handleUpload = async () => {
        if (!selectedFile || !effectiveDate || previewData.length === 0) {
            setError('Please select a file, set an effective date, and ensure data is loaded.');
            return;
        }

        setIsUploading(true);
        setError(null);
        setSuccess(null);

        try {
            // Generate batch ID for this upload
            const batchId = `batch_${Date.now()}_${currentUser.id}`;

            // Prepare leave balance history records
            const balanceRecords: Omit<LeaveBalanceHistory, 'id'>[] = previewData.map(item => ({
                employeeNumber: item.employeeNumber,
                leaveBalance: item.leaveBalance,
                effectiveDate: effectiveDate,
                uploadedAt: new Date().toISOString(),
                uploadedBy: currentUser.id,
                uploadBatchId: batchId
            }));

            // Upload to Firebase (creates leave balance history for all employees, even if they haven't signed up)
            await uploadLeaveBalanceHistory(balanceRecords);

            // Update current leave balance for users that have signed up
            // This makes the uploaded balance their current leaveDaysTotal
            const updatePromises = previewData.map(async (item) => {
                const user = users.find(u => u.employeeNumber === item.employeeNumber);
                if (user) {
                    // Update user's current leave balance to match the uploaded balance
                    const { updateUserLeaveDays } = await import('../services/firebaseService');
                    await updateUserLeaveDays(user.id, item.leaveBalance);
                }
            });

            await Promise.all(updatePromises);

            setSuccess(`Successfully uploaded leave balance for ${previewData.length} employee(s).`);
            setSelectedFile(null);
            setEffectiveDate('');
            setPreviewData([]);
            
            // Reset file input
            const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
            if (fileInput) fileInput.value = '';

            // Reload history after upload
            await loadUploadHistory();

            // Callback to refresh data
            setTimeout(() => {
                onUploadComplete();
            }, 1000);
        } catch (err) {
            console.error('Error uploading leave balance:', err);
            setError(err instanceof Error ? err.message : 'Failed to upload leave balance. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleClear = () => {
        setSelectedFile(null);
        setEffectiveDate('');
        setPreviewData([]);
        setError(null);
        setSuccess(null);
        const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
    };

    const handleDownloadTemplate = async () => {
        setIsDownloading(true);
        setError(null);
        try {
            const currentBalances = await getAllCurrentLeaveBalances();
            const balanceByNumber = new Map<string, number>();
            for (const record of currentBalances) {
                balanceByNumber.set(record.employeeNumber, record.leaveBalance);
            }
            const userByNumber = new Map<string, User>();
            for (const user of users) {
                if (user.employeeNumber) userByNumber.set(user.employeeNumber, user);
            }
            const rows = employees.map(emp => {
                const current = balanceByNumber.get(emp.employeeNumber);
                const signedUp = userByNumber.get(emp.employeeNumber);
                const leaveBalance =
                    typeof current === 'number'
                        ? current
                        : typeof signedUp?.leaveDaysTotal === 'number'
                            ? signedUp.leaveDaysTotal
                            : 0;
                return {
                    employeeNumber: emp.employeeNumber,
                    employeeName: emp.employeeName,
                    leaveBalance,
                };
            });
            downloadLeaveBalanceUploadTemplate(rows);
        } catch (err) {
            console.error('Failed to download leave balance template:', err);
            setError(err instanceof Error ? err.message : 'Failed to download leave balance template.');
        } finally {
            setIsDownloading(false);
        }
    };

    // Get today's date in YYYY-MM-DD format for date input
    const today = new Date().toISOString().split('T')[0];

    return (
        <div className="animate-fade-in">
            <div className="mb-6">
                <h1 className="text-3xl font-bold mb-2">Leave Balance Upload</h1>
                <p className="text-text-muted">
                    Upload an Excel file to update employee leave balances. Column A should contain Employee Numbers and Column H should contain Leave Balances.
                </p>
            </div>

            <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 mb-6">
                <div className="space-y-4">
                    {/* Effective Date Selection */}
                    <div>
                        <label htmlFor="effective-date" className="block text-sm font-medium text-text-primary mb-2">
                            Effective Date <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="effective-date"
                            type="date"
                            value={effectiveDate}
                            onChange={(e) => setEffectiveDate(e.target.value)}
                            max={today}
                            className="w-full bg-surface border border-border rounded-md px-4 py-2 text-text-primary focus:ring-primary focus:border-primary"
                            disabled={isUploading}
                        />
                        <p className="text-xs text-text-muted mt-1">
                            This date represents when the leave balance becomes effective (as of date).
                        </p>
                    </div>

                    {/* File Selection */}
                    <div>
                        <label htmlFor="excel-file-input" className="block text-sm font-medium text-text-primary mb-2">
                            Excel File <span className="text-red-500">*</span>
                        </label>
                        <div className="flex items-center gap-4 flex-wrap">
                            <label
                                htmlFor="excel-file-input"
                                className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-md cursor-pointer hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <UploadIcon className="w-5 h-5" />
                                <span>{selectedFile ? 'Change File' : 'Select Excel File'}</span>
                            </label>
                            <button
                                type="button"
                                onClick={handleDownloadTemplate}
                                disabled={isDownloading || isUploading}
                                className="flex items-center gap-2 bg-primary/20 text-primary px-4 py-2 rounded-lg font-medium hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <DownloadIcon className="w-4 h-4" />
                                {isDownloading ? 'Downloading…' : 'Download template'}
                            </button>
                            <input
                                id="excel-file-input"
                                type="file"
                                accept=".xlsx,.xls"
                                onChange={handleFileSelect}
                                className="hidden"
                                disabled={isUploading}
                            />
                            {selectedFile && (
                                <div className="flex items-center gap-2 text-text-primary">
                                    <span className="text-sm">{selectedFile.name}</span>
                                    <button
                                        onClick={handleClear}
                                        className="text-red-500 hover:text-red-700"
                                        disabled={isUploading}
                                    >
                                        <XIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-text-muted mt-1">
                            Expected format: Column A = Employee Number, Column H = Leave Balance
                        </p>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-md p-4">
                            <p className="text-sm text-red-800">{error}</p>
                        </div>
                    )}

                    {/* Success Message */}
                    {success && (
                        <div className="bg-green-50 border border-green-200 rounded-md p-4">
                            <p className="text-sm text-green-800">{success}</p>
                        </div>
                    )}

                    {/* Preview Data */}
                    {previewData.length > 0 && (
                        <div className="mt-6">
                            <h3 className="text-lg font-semibold text-text-primary mb-4">
                                Preview ({previewData.length} employee(s))
                            </h3>
                            <div className="border border-border rounded-md overflow-hidden">
                                <div className="max-h-96 overflow-y-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-surface-light sticky top-0">
                                            <tr>
                                                <th className="px-4 py-2 text-left text-text-primary font-medium">Employee No.</th>
                                                <th className="px-4 py-2 text-left text-text-primary font-medium">Employee Name</th>
                                                <th className="px-4 py-2 text-right text-text-primary font-medium">Leave Balance</th>
                                                <th className="px-4 py-2 text-center text-text-primary font-medium">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewData.map((item, index) => (
                                                <tr key={index} className="border-t border-border hover:bg-surface-light">
                                                    <td className="px-4 py-2 text-text-primary">{item.employeeNumber}</td>
                                                    <td className="px-4 py-2 text-text-muted">
                                                        {item.employeeName || <span className="text-yellow-600">Not in master list</span>}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-text-primary font-medium">
                                                        {item.leaveBalance.toFixed(1)}
                                                    </td>
                                                    <td className="px-4 py-2 text-center text-text-muted text-xs">
                                                        {item.hasSignedUp ? (
                                                            <span className="text-green-600">Signed Up</span>
                                                        ) : (
                                                            <span className="text-blue-600">Not Signed Up</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Upload Button */}
                    {previewData.length > 0 && effectiveDate && (
                        <div className="flex justify-end gap-4 pt-4">
                            <button
                                onClick={handleClear}
                                className="px-4 py-2 border border-border rounded-md text-text-primary hover:bg-surface-light transition-colors"
                                disabled={isUploading}
                            >
                                Clear
                            </button>
                            <button
                                onClick={handleUpload}
                                disabled={isUploading || !effectiveDate}
                                className="px-6 py-2 bg-primary text-white rounded-md hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isUploading ? (
                                    <>
                                        <span className="animate-spin">⏳</span>
                                        <span>Uploading...</span>
                                    </>
                                ) : (
                                    <>
                                        <UploadIcon className="w-5 h-5" />
                                        <span>Upload Leave Balance</span>
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Upload History Section */}
            <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-text-primary">Upload History</h2>
                    <button
                        onClick={loadUploadHistory}
                        disabled={isLoadingHistory}
                        className="px-4 py-2 bg-secondary text-white rounded-md hover:bg-secondary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                        {isLoadingHistory ? 'Loading...' : 'Refresh'}
                    </button>
                </div>
                
                {isLoadingHistory ? (
                    <div className="text-center py-8 text-text-muted">Loading history...</div>
                ) : uploadHistory.length === 0 ? (
                    <div className="text-center py-8 text-text-muted">No upload history found.</div>
                ) : (
                    <div className="border border-border rounded-md overflow-hidden">
                        <div className="max-h-96 overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-surface-light sticky top-0">
                                    <tr>
                                        <th className="px-4 py-2 text-left text-text-primary font-medium">Employee No.</th>
                                        <th className="px-4 py-2 text-left text-text-primary font-medium">Employee Name</th>
                                        <th className="px-4 py-2 text-right text-text-primary font-medium">Leave Balance</th>
                                        <th className="px-4 py-2 text-left text-text-primary font-medium">Effective Date</th>
                                        <th className="px-4 py-2 text-left text-text-primary font-medium">Uploaded Date</th>
                                        <th className="px-4 py-2 text-center text-text-primary font-medium">Sign Up Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {uploadHistory.map((record) => {
                                        // Find employee name from master list or users
                                        const employee = employees.find(e => e.employeeNumber === record.employeeNumber);
                                        const user = users.find(u => u.employeeNumber === record.employeeNumber);
                                        const employeeName = employee?.employeeName || user?.name || 'Not in master list';
                                        const hasSignedUp = !!user;

                                        return (
                                            <tr key={record.id} className="border-t border-border hover:bg-surface-light">
                                                <td className="px-4 py-2 text-text-primary">{record.employeeNumber}</td>
                                                <td className="px-4 py-2 text-text-muted">
                                                    {employeeName === 'Not in master list' ? (
                                                        <span className="text-yellow-600">{employeeName}</span>
                                                    ) : (
                                                        employeeName
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 text-right text-text-primary font-medium">
                                                    {record.leaveBalance.toFixed(1)}
                                                </td>
                                                <td className="px-4 py-2 text-text-muted">
                                                    {new Date(record.effectiveDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                </td>
                                                <td className="px-4 py-2 text-text-muted">
                                                    {formatDate(record.uploadedAt)}
                                                </td>
                                                <td className="px-4 py-2 text-center text-muted text-xs">
                                                    {hasSignedUp ? (
                                                        <span className="text-green-600 font-medium">Signed Up</span>
                                                    ) : (
                                                        <span className="text-blue-600 font-medium">Not Signed Up</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
                {uploadHistory.length > 0 && (
                    <p className="text-xs text-text-muted mt-4">
                        Showing {uploadHistory.length} uploaded record(s). Most recent uploads appear first.
                    </p>
                )}
            </div>
        </div>
    );
};

export default LeaveBalanceUpload;

