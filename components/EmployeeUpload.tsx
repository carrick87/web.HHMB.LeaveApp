import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { bulkSaveEmployees } from '../services/firebaseService';
import { UploadIcon, CheckCircleIcon, XCircleIcon } from './Icons';

interface EmployeeUploadProps {
    onUploadComplete: () => void;
}

interface EmployeeRow {
    employeeNumber: string;
    employeeName: string;
    payGroup: '5' | '6';
}

interface UploadResult {
    success: boolean;
    employeeNumber: string;
    employeeName: string;
    payGroup: string;
    message: string;
}

const EmployeeUpload: React.FC<EmployeeUploadProps> = ({ onUploadComplete }) => {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [results, setResults] = useState<UploadResult[]>([]);
    const [preview, setPreview] = useState<EmployeeRow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const normalizePayGroup = (value: unknown): '5' | '6' => {
        return value?.toString().trim() === '6' ? '6' : '5';
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        // Validate file type
        const validTypes = [
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel.sheet.macroEnabled.12'
        ];
        const validExtensions = ['.xls', '.xlsx'];

        const fileExtension = selectedFile.name.toLowerCase().substring(selectedFile.name.lastIndexOf('.'));
        const isValidType = validTypes.includes(selectedFile.type) || validExtensions.includes(fileExtension);

        if (!isValidType) {
            setError('Please upload a valid Excel file (.xls or .xlsx)');
            setFile(null);
            setPreview([]);
            return;
        }

        setFile(selectedFile);
        setError(null);
        setSuccess(null);
        setResults([]);

        // Parse file for preview
        parseFileForPreview(selectedFile);
    };

    const parseFileForPreview = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

                // Extract Column A (employee number), Column B (name), and Column C (paygroup)
                const employees: EmployeeRow[] = [];
                for (let i = 0; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    const employeeNumber = row[0]?.toString().trim() || '';
                    const employeeName = row[1]?.toString().trim() || '';
                    const payGroup = normalizePayGroup(row[2]);

                    if (i === 0 && employeeNumber.toLowerCase().includes('employee') && employeeName.toLowerCase().includes('name')) {
                        continue;
                    }

                    // Skip empty rows
                    if (employeeNumber && employeeName) {
                        employees.push({ employeeNumber, employeeName, payGroup });
                    }
                }

                setPreview(employees.slice(0, 10)); // Show first 10 for preview
            } catch (err) {
                setError('Failed to parse Excel file. Please ensure it is a valid Excel file.');
                console.error('Error parsing file:', err);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleUpload = async () => {
        if (!file) {
            setError('Please select a file first');
            return;
        }

        setIsProcessing(true);
        setError(null);
        setSuccess(null);
        setResults([]);

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

            // Extract employees from Column A, Column B, and Column C
            const employees: EmployeeRow[] = [];
            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                const employeeNumber = row[0]?.toString().trim() || '';
                const employeeName = row[1]?.toString().trim() || '';
                const payGroup = normalizePayGroup(row[2]);

                if (i === 0 && employeeNumber.toLowerCase().includes('employee') && employeeName.toLowerCase().includes('name')) {
                    continue;
                }

                // Skip empty rows
                if (employeeNumber && employeeName) {
                    employees.push({ employeeNumber, employeeName, payGroup });
                }
            }

            if (employees.length === 0) {
                setError('No valid employee data found in the file. Please ensure Column A contains employee numbers and Column B contains employee names. Column C is optional and only needs 6 for 6-day workers.');
                setIsProcessing(false);
                return;
            }

            // Save employees to Firebase
            const uploadResults = await bulkSaveEmployees(employees);

            // Convert results to UploadResult format
            const formattedResults: UploadResult[] = uploadResults.map(result => ({
                success: result.success,
                employeeNumber: result.employeeNumber,
                employeeName: result.employeeName,
                payGroup: result.payGroup || '5',
                message: result.success ? 'Employee saved successfully' : (result.error || 'Failed to save employee')
            }));

            setResults(formattedResults);

            const successCount = formattedResults.filter(r => r.success).length;
            const errorCount = formattedResults.filter(r => !r.success).length;

            if (successCount > 0) {
                setSuccess(`Successfully saved ${successCount} employee(s). ${errorCount > 0 ? `${errorCount} error(s) occurred.` : ''}`);
                onUploadComplete();
            } else {
                setError(`Failed to save employees. ${errorCount} error(s) occurred.`);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to process file');
            console.error('Upload error:', err);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 mb-8">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                    <UploadIcon className="w-5 h-5 text-primary" />
                </div>
                <div>
                    <h2 className="text-xl font-semibold text-text-primary">Upload Employee Master List</h2>
                    <p className="text-sm text-text-secondary">Upload Excel file with employee numbers (Column A), names (Column B), and optional paygroup (Column C: enter 6 for 6-day workers, otherwise defaults to 5)</p>
                </div>
            </div>

            {/* Success/Error Messages */}
            {success && (
                <div className="mb-4 p-4 bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg">
                    {success}
                </div>
            )}
            {error && (
                <div className="mb-4 p-4 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg">
                    {error}
                </div>
            )}

            {/* File Upload */}
            <div className="mb-6">
                <label className="block text-sm font-medium text-text-secondary mb-2">Excel File</label>
                <div className="flex items-center gap-4">
                    <label className="flex-1 cursor-pointer">
                        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary transition-colors">
                            <UploadIcon className="w-8 h-8 text-text-secondary mx-auto mb-2" />
                            <p className="text-text-primary font-medium">
                                {file ? file.name : 'Click to select Excel file (.xls, .xlsx)'}
                            </p>
                            <p className="text-sm text-text-secondary mt-1">
                                Column A: Employee Number | Column B: Employee Name | Column C: Paygroup (6 only; blank/other = 5)
                            </p>
                        </div>
                        <input
                            type="file"
                            accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            onChange={handleFileChange}
                            className="hidden"
                            disabled={isProcessing}
                        />
                    </label>
                </div>
            </div>

            {/* Preview */}
            {preview.length > 0 && (
                <div className="mb-6">
                    <h3 className="text-sm font-medium text-text-secondary mb-2">Preview (First 10 rows)</h3>
                    <div className="bg-surface-light rounded-lg border border-border overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-surface border-b border-border">
                                <tr>
                                    <th className="p-3 text-left text-text-secondary font-medium">Employee Number</th>
                                    <th className="p-3 text-left text-text-secondary font-medium">Employee Name</th>
                                    <th className="p-3 text-left text-text-secondary font-medium">Paygroup</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.map((emp, idx) => (
                                    <tr key={idx} className="border-b border-border last:border-b-0">
                                        <td className="p-3 text-text-primary">{emp.employeeNumber}</td>
                                        <td className="p-3 text-text-primary">{emp.employeeName}</td>
                                        <td className="p-3 text-text-primary">{emp.payGroup}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Upload Button */}
            <button
                onClick={handleUpload}
                disabled={!file || isProcessing}
                className="w-full bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                {isProcessing ? (
                    <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Processing...
                    </>
                ) : (
                    <>
                        <UploadIcon className="w-5 h-5" />
                        Upload and Save Employees
                    </>
                )}
            </button>

            {/* Results Table */}
            {results.length > 0 && (
                <div className="mt-6">
                    <h3 className="text-sm font-medium text-text-secondary mb-2">Upload Results</h3>
                    <div className="bg-surface-light rounded-lg border border-border overflow-hidden max-h-96 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-surface border-b border-border sticky top-0">
                                <tr>
                                    <th className="p-3 text-left text-text-secondary font-medium">Status</th>
                                    <th className="p-3 text-left text-text-secondary font-medium">Employee Number</th>
                                    <th className="p-3 text-left text-text-secondary font-medium">Employee Name</th>
                                    <th className="p-3 text-left text-text-secondary font-medium">Paygroup</th>
                                    <th className="p-3 text-left text-text-secondary font-medium">Message</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.map((result, idx) => (
                                    <tr key={idx} className="border-b border-border last:border-b-0">
                                        <td className="p-3">
                                            {result.success ? (
                                                <CheckCircleIcon className="w-5 h-5 text-green-400" />
                                            ) : (
                                                <XCircleIcon className="w-5 h-5 text-red-400" />
                                            )}
                                        </td>
                                        <td className="p-3 text-text-primary">{result.employeeNumber}</td>
                                        <td className="p-3 text-text-primary">{result.employeeName}</td>
                                        <td className="p-3 text-text-primary">{result.payGroup}</td>
                                        <td className={`p-3 ${result.success ? 'text-green-400' : 'text-red-400'}`}>
                                            {result.message}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmployeeUpload;
