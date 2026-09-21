import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { User, PublicHolidaySet, PublicHoliday } from '../types';
import { 
    getPublicHolidaySets, 
    addPublicHolidaySet, 
    updatePublicHolidaySet, 
    deletePublicHolidaySet,
    setDefaultPublicHolidaySet
} from '../services/firebaseService';
import { UploadIcon, DownloadIcon, XIcon, TrashIcon } from './Icons';
import { downloadPublicHolidayUploadTemplate } from '../utils/uploadTemplates';

interface PublicHolidayUploadProps {
    currentUser: User;
    onUploadComplete: () => void;
}

const PublicHolidayUpload: React.FC<PublicHolidayUploadProps> = ({ currentUser, onUploadComplete }) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [holidaySets, setHolidaySets] = useState<PublicHolidaySet[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [previewData, setPreviewData] = useState<PublicHoliday[]>([]);
    const [setName, setSetName] = useState<string>('');
    const [year, setYear] = useState<number>(new Date().getFullYear());
    const [isDefault, setIsDefault] = useState<boolean>(false);
    const [editingSetId, setEditingSetId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [manualHolidayDate, setManualHolidayDate] = useState('');
    const [manualHolidayName, setManualHolidayName] = useState('');

    // Load existing public holiday sets
    useEffect(() => {
        loadHolidaySets();
    }, []);

    const loadHolidaySets = async () => {
        setIsLoading(true);
        try {
            const sets = await getPublicHolidaySets();
            setHolidaySets(sets);
        } catch (err) {
            console.error('Error loading public holiday sets:', err);
            setError('Failed to load public holiday sets');
        } finally {
            setIsLoading(false);
        }
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
        setSetName('');
        setYear(new Date().getFullYear());
        setIsDefault(false);
        setEditingSetId(null);

        try {
            // Read Excel file
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

            // Parse dates and holiday names from Excel
            // Expected format: Column A = Date, Column C = Holiday Name (optional)
            // Use Map to handle duplicate dates (keep the last occurrence)
            const parsedHolidaysMap = new Map<string, PublicHoliday>();
            const skippedRows: number[] = [];
            
            // Try to detect header row (skip first row if it contains text like "Date", "Holiday", etc.)
            let startRow = 0;
            if (data.length > 0) {
                const firstRow = data[0];
                const firstCell = String(firstRow[0] || '').toLowerCase();
                if (firstCell.includes('date') || firstCell.includes('holiday') || firstCell === '') {
                    startRow = 1;
                }
            }

            for (let i = startRow; i < data.length; i++) {
                const row = data[i];
                const dateCell = row[0];
                const nameCell = row[2] || ''; // Column C - Holiday name
                
                if (!dateCell) {
                    skippedRows.push(i + 1); // Track skipped rows for debugging
                    continue; // Skip empty rows
                }

                let dateString: string = '';

                // Handle different date formats
                if (dateCell instanceof Date) {
                    // Excel date object
                    const year = dateCell.getFullYear();
                    const month = String(dateCell.getMonth() + 1).padStart(2, '0');
                    const day = String(dateCell.getDate()).padStart(2, '0');
                    dateString = `${year}-${month}-${day}`;
                } else if (typeof dateCell === 'number') {
                    // Excel serial date number
                    const excelEpoch = new Date(1899, 11, 30);
                    const date = new Date(excelEpoch.getTime() + dateCell * 86400000);
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    dateString = `${year}-${month}-${day}`;
                } else {
                    // String date - try to parse
                    const dateStr = String(dateCell).trim();
                    if (!dateStr) {
                        skippedRows.push(i + 1);
                        continue;
                    }

                    const yearFirstMatch = dateStr.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
                    const dayFirstMatch = dateStr.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
                    let parsed = false;

                    if (yearFirstMatch) {
                        dateString = `${yearFirstMatch[1]}-${yearFirstMatch[2]}-${yearFirstMatch[3]}`;
                        parsed = true;
                    } else if (dayFirstMatch) {
                        dateString = `${dayFirstMatch[3]}-${dayFirstMatch[2]}-${dayFirstMatch[1]}`;
                        parsed = true;
                    }

                    if (!parsed) {
                        // Try native Date parsing
                        const date = new Date(dateStr);
                        if (!isNaN(date.getTime())) {
                            const year = date.getFullYear();
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const day = String(date.getDate()).padStart(2, '0');
                            dateString = `${year}-${month}-${day}`;
                        } else {
                            skippedRows.push(i + 1);
                            continue; // Skip invalid dates
                        }
                    }
                }

                // Validate date string format
                if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    const holidayName = String(nameCell || '').trim() || 'Public Holiday'; // Default name if not provided
                    // Use Map to handle duplicates - if same date appears multiple times, keep the last one
                    parsedHolidaysMap.set(dateString, {
                        date: dateString,
                        name: holidayName
                    });
                } else {
                    skippedRows.push(i + 1);
                }
            }

            // Convert Map to array
            const parsedHolidays = Array.from(parsedHolidaysMap.values());

            if (parsedHolidays.length === 0) {
                setError('No valid dates found in the Excel file. Please ensure dates are in Column A.');
                return;
            }

            // Sort by date
            parsedHolidays.sort((a, b) => a.date.localeCompare(b.date));
            
            // Validate all dates are in correct format
            const invalidDates = parsedHolidays.filter(h => !h.date.match(/^\d{4}-\d{2}-\d{2}$/));
            if (invalidDates.length > 0) {
                console.warn('Found invalid date formats:', invalidDates);
            }

            // Detect year from dates in the file (use the most common year)
            const yearCounts = new Map<number, number>();
            parsedHolidays.forEach(holiday => {
                const holidayYear = parseInt(holiday.date.split('-')[0]);
                if (holidayYear > 1900 && holidayYear < 2100) {
                    yearCounts.set(holidayYear, (yearCounts.get(holidayYear) || 0) + 1);
                }
            });
            
            // Find the year with the most holidays
            let detectedYear = new Date().getFullYear();
            let maxCount = 0;
            yearCounts.forEach((count, year) => {
                if (count > maxCount) {
                    maxCount = count;
                    detectedYear = year;
                }
            });
            
            // Check if file contains dates from multiple years
            const uniqueYears = Array.from(yearCounts.keys()).sort();
            if (uniqueYears.length > 1) {
                setError(`⚠️ File contains dates from multiple years (${uniqueYears.join(', ')}). Year set to ${detectedYear} (most common). Please verify and adjust the Year field if needed.`);
            }
            
            // Also check filename as hint, but prioritize dates over filename when they conflict
            const filenameYearMatch = file.name.match(/-(\d{2})\./);
            if (filenameYearMatch) {
                const twoDigitYear = parseInt(filenameYearMatch[1]);
                const currentCentury = Math.floor(new Date().getFullYear() / 100) * 100;
                const filenameYear = currentCentury + twoDigitYear;
                const filenameYearCount = yearCounts.get(filenameYear) || 0;
                
                // Only use filename year if:
                // 1. It's the most common year (same as detected), OR
                // 2. It has at least 80% of the max count (very close), OR  
                // 3. Years are within 1 year of each other and filename year exists
                // Otherwise, always prefer the most common year from dates
                if (filenameYear === detectedYear) {
                    // Filename matches detected year - perfect
                    // Keep detectedYear as is
                } else if (filenameYearCount >= maxCount * 0.8) {
                    // Filename year has almost as many dates - use it if it's more recent
                    if (filenameYear > detectedYear) {
                        detectedYear = filenameYear;
                    }
                } else if (filenameYearCount > 0 && Math.abs(filenameYear - detectedYear) <= 1 && uniqueYears.length === 2) {
                    // Only two years, close together - prefer the one with more dates
                    // (detectedYear already has maxCount, so keep it)
                }
                // In all other cases, stick with detectedYear (most common from dates)
            }
            
            setYear(detectedYear);

            // Extract name from filename (e.g., "PH-SABAH-25.xlsx" -> "Sabah 2025")
            const filenameWithoutExt = file.name.replace(/\.(xlsx|xls)$/i, '');
            const nameMatch = filenameWithoutExt.match(/PH-([A-Z]+)-?\d*/i);
            if (nameMatch) {
                const location = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1).toLowerCase();
                setSetName(`${location} ${year}`);
            } else {
                setSetName(filenameWithoutExt.replace(/PH-?/i, ''));
            }

            setPreviewData(parsedHolidays);
        } catch (err) {
            console.error('Error parsing Excel file:', err);
            setError('Failed to parse Excel file. Please ensure it is a valid Excel file.');
        }
    };

    const handleUpload = async () => {
        if (previewData.length === 0) {
            setError('Please add at least one public holiday date.');
            return;
        }

        if (!setName.trim()) {
            setError('Please enter a name for this public holiday set.');
            return;
        }

        setIsUploading(true);
        setError(null);
        setSuccess(null);

        try {
            // Validate and normalize all dates before uploading
            const validatedHolidays = previewData.map(holiday => {
                // Ensure date is in YYYY-MM-DD format
                if (!holiday.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    // Try to parse and reformat
                    const date = new Date(holiday.date);
                    if (!isNaN(date.getTime())) {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        return {
                            date: `${year}-${month}-${day}`,
                            name: holiday.name
                        };
                    }
                }
                return holiday;
            });
            
            const holidaySetData: Omit<PublicHolidaySet, 'id' | 'uploadedAt' | 'updatedAt'> & {
                uploadedBy: string;
                updatedBy: string;
            } = {
                name: setName.trim(),
                year: year,
                holidays: validatedHolidays,
                isDefault: isDefault,
                uploadedBy: currentUser.id,
                updatedBy: currentUser.id
            };

            if (editingSetId) {
                // Update existing set
                await updatePublicHolidaySet(editingSetId, holidaySetData);
                setSuccess(`Public holiday set "${setName}" updated successfully!`);
            } else {
                // Add new set
                await addPublicHolidaySet(holidaySetData);
                setSuccess(`Public holiday set "${setName}" uploaded successfully!`);
            }

            // Reset form
            setSelectedFile(null);
            setPreviewData([]);
            setSetName('');
            setYear(new Date().getFullYear());
            setIsDefault(false);
            setEditingSetId(null);
            setManualHolidayDate('');
            setManualHolidayName('');
            
            // Reload holiday sets
            await loadHolidaySets();
            onUploadComplete();
        } catch (err: any) {
            console.error('Error uploading public holiday set:', err);
            setError(err.message || 'Failed to upload public holiday set.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleEdit = (set: PublicHolidaySet) => {
        setEditingSetId(set.id);
        setSetName(set.name);
        setYear(set.year);
        setIsDefault(set.isDefault);
        setPreviewData(sortHolidays(set.holidays));
        setSelectedFile(null);
        setError(null);
        setSuccess(null);
        setManualHolidayDate('');
        setManualHolidayName('');
        
        // Scroll to upload form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Are you sure you want to delete the public holiday set "${name}"? This action cannot be undone.`)) {
            return;
        }

        try {
            await deletePublicHolidaySet(id);
            setSuccess(`Public holiday set "${name}" deleted successfully!`);
            await loadHolidaySets();
            onUploadComplete();
        } catch (err: any) {
            console.error('Error deleting public holiday set:', err);
            setError(err.message || 'Failed to delete public holiday set.');
        }
    };

    const handleSetDefault = async (id: string) => {
        try {
            await setDefaultPublicHolidaySet(id, currentUser.id);
            setSuccess('Default public holiday set updated successfully!');
            await loadHolidaySets();
            onUploadComplete();
        } catch (err: any) {
            console.error('Error setting default public holiday set:', err);
            setError(err.message || 'Failed to set default public holiday set.');
        }
    };

    const handleDownloadHolidays = (holidays: PublicHoliday[], name?: string) => {
        setIsDownloading(true);
        setError(null);
        try {
            downloadPublicHolidayUploadTemplate(holidays, name);
        } catch (err: any) {
            console.error('Failed to download public holiday template:', err);
            setError(err.message || 'Failed to download public holiday template.');
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDownloadTemplate = () => {
        if (previewData.length > 0) {
            handleDownloadHolidays(previewData, setName.trim() || 'current');
            return;
        }
        const defaultSet = holidaySets.find(set => set.isDefault) || holidaySets[0];
        if (defaultSet) {
            handleDownloadHolidays(defaultSet.holidays, defaultSet.name);
            return;
        }
        handleDownloadHolidays([], 'template');
    };

    const normalizeDateInput = (dateValue: string): string | null => {
        const trimmed = dateValue.trim();
        if (!trimmed) return null;

        const yearFirstMatch = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
        if (yearFirstMatch) {
            return `${yearFirstMatch[1]}-${yearFirstMatch[2]}-${yearFirstMatch[3]}`;
        }

        const dayFirstMatch = trimmed.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
        if (dayFirstMatch) {
            return `${dayFirstMatch[3]}-${dayFirstMatch[2]}-${dayFirstMatch[1]}`;
        }

        const parsedDate = new Date(trimmed);
        if (isNaN(parsedDate.getTime())) return null;

        const parsedYear = parsedDate.getFullYear();
        const parsedMonth = String(parsedDate.getMonth() + 1).padStart(2, '0');
        const parsedDay = String(parsedDate.getDate()).padStart(2, '0');
        return `${parsedYear}-${parsedMonth}-${parsedDay}`;
    };

    const sortHolidays = (holidays: PublicHoliday[]): PublicHoliday[] =>
        [...holidays].sort((a, b) => a.date.localeCompare(b.date));

    const handleAddManualHoliday = () => {
        const normalizedDate = normalizeDateInput(manualHolidayDate);
        if (!normalizedDate) {
            setError('Please enter a valid holiday date.');
            return;
        }

        const holidayName = manualHolidayName.trim() || 'Public Holiday';
        setPreviewData(current => {
            const withoutSameDate = current.filter(holiday => holiday.date !== normalizedDate);
            return sortHolidays([...withoutSameDate, { date: normalizedDate, name: holidayName }]);
        });
        setManualHolidayDate('');
        setManualHolidayName('');
        setError(null);
    };

    const handleDeleteManualHoliday = (date: string) => {
        setPreviewData(current => current.filter(holiday => holiday.date !== date));
        setError(null);
    };

    const formatDate = (dateString: string): string => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    
    const formatHolidayDate = (holiday: PublicHoliday): string => {
        return formatDate(holiday.date);
    };

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-text-primary mb-2">Public Holiday Management</h1>
                <p className="text-text-secondary">Upload and manage public holiday sets for the leave system</p>
            </div>

            {/* Success/Error Messages */}
            {success && (
                <div className="p-4 bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg">
                    {success}
                </div>
            )}
            {error && (
                <div className="p-4 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg">
                    {error}
                </div>
            )}

            {/* Upload Form */}
            <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                <h2 className="text-xl font-semibold text-text-primary mb-4">
                    {editingSetId ? 'Edit Public Holiday Set' : 'Upload New Public Holiday Set'}
                </h2>
                
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                            Excel File (.xlsx or .xls)
                        </label>
                        <div className="flex items-center gap-4 flex-wrap">
                            <label className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-focus transition-colors cursor-pointer">
                                <UploadIcon className="w-4 h-4" />
                                {selectedFile ? 'Change File' : 'Select File'}
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                />
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
                            {selectedFile && (
                                <div className="flex items-center gap-2 text-text-primary">
                                    <span>{selectedFile.name}</span>
                                    <button
                                        onClick={() => {
                                            setSelectedFile(null);
                                            setPreviewData([]);
                                            setSetName('');
                                            setYear(new Date().getFullYear());
                                            setIsDefault(false);
                                            setEditingSetId(null);
                                            setManualHolidayDate('');
                                            setManualHolidayName('');
                                        }}
                                        className="text-red-600 hover:text-red-800"
                                    >
                                        <XIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-text-muted mt-2">
                            Expected format: Dates in Column A (YYYY-MM-DD, DD/MM/YYYY, or Excel date format). Holiday names in Column C are optional.
                        </p>
                    </div>

                    {(previewData.length > 0 || editingSetId) && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-2">
                                    Set Name *
                                </label>
                                <input
                                    type="text"
                                    value={setName}
                                    onChange={(e) => setSetName(e.target.value)}
                                    className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-text-primary"
                                    placeholder="e.g., Sabah 2025"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-2">
                                    Year *
                                </label>
                                <input
                                    type="number"
                                    value={year}
                                    onChange={(e) => {
                                        setYear(parseInt(e.target.value) || new Date().getFullYear());
                                        setError(null); // Clear error when user manually changes year
                                    }}
                                    className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-text-primary"
                                    min="2000"
                                    max="2100"
                                    required
                                />
                                {previewData.length > 0 && (() => {
                                    const years = new Set(previewData.map(h => parseInt(h.date.split('-')[0])));
                                    const yearList = Array.from(years).sort();
                                    if (yearList.length > 1) {
                                        return (
                                            <p className="text-xs text-yellow-600 mt-1">
                                                ⚠️ File contains dates from multiple years: {yearList.join(', ')}. 
                                                Please ensure the Year field matches the intended calendar year.
                                            </p>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="isDefault"
                                    checked={isDefault}
                                    onChange={(e) => setIsDefault(e.target.checked)}
                                    className="w-4 h-4 text-primary bg-surface-light border-border rounded focus:ring-primary"
                                />
                                <label htmlFor="isDefault" className="text-sm font-medium text-text-secondary">
                                    Set as default public holiday calendar for {year} (one default per year)
                                </label>
                            </div>

                            <div>
                                <div className="bg-surface-light border border-border rounded-md p-4 mb-4">
                                    <label className="block text-sm font-medium text-text-secondary mb-3">
                                        Manually Add Holiday Date
                                    </label>
                                    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-3">
                                        <input
                                            type="date"
                                            value={manualHolidayDate}
                                            onChange={(e) => setManualHolidayDate(e.target.value)}
                                            className="bg-card-bg border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-text-primary"
                                        />
                                        <input
                                            type="text"
                                            value={manualHolidayName}
                                            onChange={(e) => setManualHolidayName(e.target.value)}
                                            className="bg-card-bg border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-text-primary"
                                            placeholder="Holiday name (optional)"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleAddManualHoliday}
                                            className="bg-primary text-white px-4 py-3 rounded-lg font-medium hover:bg-primary-focus transition-colors"
                                        >
                                            Add Date
                                        </button>
                                    </div>
                                    <p className="text-xs text-text-muted mt-2">
                                        Adding an existing date will update its holiday name.
                                    </p>
                                </div>

                                <label className="block text-sm font-medium text-text-secondary mb-2">
                                    Preview ({previewData.length} unique holidays found)
                                </label>
                                {previewData.length > 0 && (
                                    <p className="text-xs text-text-muted mb-2">
                                        Dates are sorted chronologically. Duplicate dates (if any) will use the last occurrence.
                                    </p>
                                )}
                                <div className="bg-surface-light border border-border rounded-md p-4 max-h-64 overflow-y-auto">
                                    <div className="space-y-2">
                                        {previewData.length === 0 ? (
                                            <div className="text-sm text-text-muted text-center py-4">
                                                No holiday dates in this set. Add a date above before saving.
                                            </div>
                                        ) : (
                                            previewData.map((holiday, index) => (
                                                <div key={`${holiday.date}-${index}`} className="text-sm text-text-primary flex items-center gap-2">
                                                    <span className="font-medium min-w-[100px]">{formatDate(holiday.date)}</span>
                                                    <span className="text-text-secondary">-</span>
                                                    <span className="flex-1">{holiday.name}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteManualHoliday(holiday.date)}
                                                        className="text-red-400 hover:text-red-300 p-1 rounded"
                                                        title={`Delete ${holiday.name}`}
                                                    >
                                                        <TrashIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={handleUpload}
                                disabled={isUploading || !setName.trim() || previewData.length === 0}
                                className="w-full bg-primary text-white px-4 py-3 rounded-lg font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isUploading 
                                    ? (editingSetId ? 'Updating...' : 'Uploading...') 
                                    : (editingSetId ? 'Update Public Holiday Set' : 'Upload Public Holiday Set')
                                }
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Existing Public Holiday Sets */}
            <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                <h2 className="text-xl font-semibold text-text-primary mb-4">Existing Public Holiday Sets</h2>
                
                {isLoading ? (
                    <div className="text-center py-8 text-text-muted">Loading...</div>
                ) : holidaySets.length === 0 ? (
                    <div className="text-center py-8 text-text-muted">No public holiday sets uploaded yet.</div>
                ) : (
                    <div className="space-y-4">
                        {holidaySets.map((set) => (
                            <div
                                key={set.id}
                                className={`p-4 rounded-lg border ${
                                    set.isDefault 
                                        ? 'bg-primary/10 border-primary' 
                                        : 'bg-surface-light border-border'
                                }`}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <h3 className="text-lg font-semibold text-text-primary">
                                                {set.name}
                                            </h3>
                                            {set.isDefault && (
                                                <span className="px-2 py-1 bg-primary text-white text-xs font-medium rounded">
                                                    Default
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-text-muted mb-2">
                                            Year: {set.year} • {set.holidays.length} holiday{set.holidays.length !== 1 ? 's' : ''}
                                        </p>
                                        <p className="text-xs text-text-muted">
                                            Uploaded: {new Date(set.uploadedAt).toLocaleDateString('en-GB', { 
                                                day: '2-digit', 
                                                month: 'short', 
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 ml-4">
                                        {!set.isDefault && (
                                            <button
                                                onClick={() => handleSetDefault(set.id)}
                                                className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-blue-700 transition-colors"
                                                title={`Set as default calendar for ${set.year}`}
                                            >
                                                Set as Default ({set.year})
                                            </button>
                                        )}
                                        {set.isDefault && (
                                            <span className="text-xs text-text-muted">
                                                Default for {set.year}
                                            </span>
                                        )}
                                        <button
                                            onClick={() => handleDownloadHolidays(set.holidays, set.name)}
                                            disabled={isDownloading}
                                            className="flex items-center gap-1 bg-primary/20 text-primary text-xs px-3 py-1.5 rounded-md hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <DownloadIcon className="w-3.5 h-3.5" />
                                            Download
                                        </button>
                                        <button
                                            onClick={() => handleEdit(set)}
                                            className="bg-primary text-white text-xs px-3 py-1.5 rounded-md hover:bg-primary-focus transition-colors"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(set.id, set.name)}
                                            className="bg-red-600 text-white text-xs px-3 py-1.5 rounded-md hover:bg-red-700 transition-colors"
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PublicHolidayUpload;

