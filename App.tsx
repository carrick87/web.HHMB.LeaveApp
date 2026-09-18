import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { LeaveRequest, LeaveStatus, LeaveType, User, UserRole, Department, LeaveTypeConfig, Attachment, Branch } from './types';
import { generateLeaveReason } from './services/geminiService';
import { 
    getLeaveDaysBetween, 
    formatDateWithDay, 
    getReturnToWorkDateWithDay,
    shouldExcludeDateForLeave,
    leaveTypeUsesCalendarDays,
    isPublicHoliday,
    getDayName,
    setPublicHolidaysCache,
    getPublicHolidayName,
    ensureHolidaysLoadedForYear
} from './utils/dateUtils';
import { 
    checkLeaveConflicts, 
    formatConflictingRequests, 
    getSuggestedActions 
} from './utils/leaveConflictUtils';
import { 
    onAuthStateChanged, 
    signInUser,
    bootstrapSuperAdmin,
    resolveSignedInUserProfile,
    isUsersCollectionEmpty,
    sendPasswordResetEmailToUser,
    signOutUser,
    addDocument,
    getCollection,
    updateDocument,
    deleteDocument,
    getDocument,
    listenToCollection,
    listenToDocument,
    listenToLeaveRequestsForUser,
    getLeaveRequestsForUser,
    fetchUsersByIds,
    fetchSuperAdminUsers,
    createAdminUser,
    updateUserRole,
    updateUserLeaveDays,
    toggleUserStatus,
    sendLeaveRequestNotification,
    sendLeaveDecisionNotification,
    updateUserEmail,
    clearAllLeaveRequests,
    updateUserVerificationStatus,
    updateUser,
    getDefaultPublicHolidaySet,
    listenToBranches,
} from './services/firebaseService';
import { emailService, sendLeaveCancellationRequestNotification, sendLeaveCancellationDecisionNotification } from './services/emailService';
import { auth } from './services/firebaseConfig';
import { validateFilesForStorage, convertFilesToStoredFiles, convertStoredFilesToFiles, formatFileSize, downloadStoredFile, type StoredFile } from './utils/fileStorage';
import LeaveSummary from './components/LeaveSummary';
import RequesterLeaveInsight from './components/RequesterLeaveInsight';
import UserManagement from './components/UserManagement';
import DepartmentSettings from './components/DepartmentSettings';
import BranchSettings from './components/BranchSettings';
import UserProfile from './components/UserProfile';
import Tools from './components/Tools';
import EmailSetup from './components/EmailSetup';
import EmployeeUploadPage from './components/EmployeeUploadPage';
import LeaveBalanceUpload from './components/LeaveBalanceUpload';
import PublicHolidayUpload from './components/PublicHolidayUpload';
import StatisticsView from './components/StatisticsView';
import { getPayGroup, resolveRequestPayGroup } from './utils/payGroupUtils';
import { getLeaveTypeAccentClass, getLeaveTypeColor as getLeaveTypeChipClass } from './utils/leaveTypeStyles';
import { getEffectiveUserBranch, legacyEmpNumberBranchPrefix } from './utils/departmentSettingsHelpers';
import { DashboardIcon, CalendarIcon, HistoryIcon, CheckCircleIcon, UsersIcon, BuildingOfficeIcon, SparklesIcon, ChevronDownIcon, ChevronUpIcon, AppLogo, UserIcon, MenuIcon, ArrowLeftIcon, UploadIcon, TrashIcon, XIcon, WrenchScrewdriverIcon, DocumentTextIcon } from './components/Icons';

type DataLoadMode = 'full' | 'scoped';

const resolveDataLoadMode = (user: User, departments: Department[]): DataLoadMode => {
    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) return 'full';
    if (departments.some(d => d.approverIds?.includes(user.id))) return 'full';
    return 'scoped';
};

const mergeScopedUsers = (self: User | null, approvers: User[]): User[] => {
    const merged = new Map<string, User>();
    if (self) merged.set(self.id, self);
    approvers.forEach(u => merged.set(u.id, u));
    return Array.from(merged.values());
};

// --- UTILITY FUNCTIONS ---
// Tracks a CSS media query and re-renders when it flips. Used to render only one
// of mobile/desktop list views at a time instead of mounting both via CSS hide.
const useMediaQuery = (query: string): boolean => {
    const getMatch = () =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(query).matches
            : false;
    const [matches, setMatches] = useState<boolean>(getMatch);
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(query);
        const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
        setMatches(mq.matches);
        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', handler);
            return () => mq.removeEventListener('change', handler);
        } else {
            (mq as any).addListener(handler);
            return () => (mq as any).removeListener(handler);
        }
    }, [query]);
    return matches;
};

const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
};

const formatTableDate = (dateString: string): string => formatDate(dateString);

const formatSubmissionDateTime = (requestedAt: string, requestedAtTime?: string): string => {
    const date = new Date(requestedAt);
    if (isNaN(date.getTime())) return requestedAt;
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const dateStr = `${day}/${month}/${year}`;
    
    if (requestedAtTime) {
        try {
            const timeDate = new Date(requestedAtTime);
            if (!isNaN(timeDate.getTime())) {
                const timeStr = timeDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                return `${dateStr} ${timeStr}`;
            }
        } catch (e) {
            // Fall through to return just date
        }
    }
    
    return dateStr;
};

const getDaysBetween = (
    startDate: string,
    endDate: string,
    startTime: 'AM' | 'PM',
    endTime: 'AM' | 'PM',
    payGroup: string = '5',
    leaveType?: LeaveType | string
): number => {
    return getLeaveDaysBetween(startDate, endDate, startTime, endTime, payGroup, leaveType);
};

// Export utility function for leave requests
const exportApprovedLeaveRequests = (
    requests: LeaveRequest[],
    users: User[],
    departments: Department[],
    monthFilter: string,
    yearFilter: string,
    currentUser?: User,
    userId?: string,
    options?: {
        statusFilter?: string;
        employeeNumberFilter?: string;
        employeeNameFilter?: string;
        matchApprovalsTable?: boolean;
    }
) => {
    // Import XLSX library dynamically
    import('xlsx').then(XLSX => {
        const {
            statusFilter = 'all',
            employeeNumberFilter = '',
            employeeNameFilter = '',
            matchApprovalsTable = false
        } = options || {};

        const getUserById = (id: string) => users.find(u => u.id === id);
        const getRequesterInfo = (request: LeaveRequest) => {
            const requester = getUserById(request.userId);
            return {
                requester,
                requesterName: requester?.name || request.requesterName || 'Unknown User',
                requesterEmployeeNumber: requester?.employeeNumber || request.employeeNumber || 'N/A',
                requesterDepartmentId: requester?.departmentId || request.requesterDepartmentId,
                isDeletedUser: !requester
            };
        };

        // By default we export approved only; approvals page can request exact table matching.
        let exportableRequests = matchApprovalsTable
            ? [...requests]
            : requests.filter(r => r.status === LeaveStatus.APPROVED);
        
        // If userId is provided, filter to only that user's requests (for history view)
        if (userId) {
            exportableRequests = exportableRequests.filter(r => r.userId === userId);
        } else if (currentUser) {
            // Apply the same filtering logic as approvableRequests to respect admin visibility
            // Calculate admin managed departments
            const adminManagedDepartmentIds = (() => {
                if (currentUser.role !== UserRole.ADMIN) return [];
                const ids = new Set<string>();
                if (currentUser.adminDepartments) {
                    currentUser.adminDepartments.forEach(id => ids.add(id));
                }
                departments.forEach(dept => {
                    if (dept.approverIds?.includes(currentUser.id)) {
                        ids.add(dept.id);
                    }
                });
                return Array.from(ids);
            })();
            
            exportableRequests = exportableRequests.filter(r => {
                // Get requester info - use stored info if user is deleted, otherwise get from users array
                const requesterInfo = getRequesterInfo(r);
                const requesterDepartmentId = requesterInfo.requesterDepartmentId;
                const isDeletedUser = requesterInfo.isDeletedUser;
                
                // For SUPER_ADMIN, show all requests
                if (currentUser.role === UserRole.SUPER_ADMIN) {
                    return true;
                }
                
                // For deleted users without department info, only SUPER_ADMIN can see them
                if (isDeletedUser && !requesterDepartmentId) {
                    return false;
                }
                
                // For ADMIN role, filter by assigned departments OR if they are approvers
                if (currentUser.role === UserRole.ADMIN) {
                    if (!requesterDepartmentId) {
                        return false;
                    }
                    
                    // Check if admin manages this department (for viewing purposes)
                    const isAdminDept = adminManagedDepartmentIds.length > 0 && adminManagedDepartmentIds.includes(requesterDepartmentId);
                    
                    // Check if admin is also an approver in this department
                    const requesterDepartment = departments.find(d => d.id === requesterDepartmentId);
                    const isDeptApprover = requesterDepartment?.approverIds?.includes(currentUser.id) || false;
                    
                    // Admin can VIEW requests if they manage the department OR if they are an approver
                    return isAdminDept || isDeptApprover;
                }
                
                // For NORMAL role: check if user is assigned as approver in the requester's department
                if (!requesterDepartmentId) {
                    return false;
                }
                const requesterDepartment = departments.find(d => d.id === requesterDepartmentId);
                return requesterDepartment?.approverIds?.includes(currentUser.id) || false;
            });
        }

        // Apply status filter when matching approvals table exactly.
        if (matchApprovalsTable) {
            exportableRequests = exportableRequests.filter(r => statusFilter === 'all' || r.status === statusFilter);
        }
        
        // Apply month and year filters
        let filteredRequests = exportableRequests.filter(r => {
            if (monthFilter === 'all' && yearFilter === 'all') {
                return true;
            }
            
            const requestDate = new Date(r.startDate);
            const requestMonth = requestDate.getMonth() + 1;
            const requestYear = requestDate.getFullYear();
            
            const monthMatch = monthFilter === 'all' || requestMonth.toString() === monthFilter;
            const yearMatch = yearFilter === 'all' || requestYear.toString() === yearFilter;
            
            return monthMatch && yearMatch;
        });

        // Apply employee number/name filters to match approvals table behavior.
        filteredRequests = filteredRequests.filter(r => {
            const requesterInfo = getRequesterInfo(r);
            const requesterEmployeeNumber = requesterInfo.requesterEmployeeNumber.toLowerCase();
            const requesterName = requesterInfo.requesterName.toLowerCase();
            const employeeNumberMatch = !employeeNumberFilter || requesterEmployeeNumber.includes(employeeNumberFilter.toLowerCase());
            const employeeNameMatch = !employeeNameFilter || requesterName.includes(employeeNameFilter.toLowerCase());
            return employeeNumberMatch && employeeNameMatch;
        });
        
        // Generate export data with headers
        const exportData = [matchApprovalsTable
            ? ['Date', 'Time Period', 'Employee Name', 'Employee No.', 'Duration (Days)', 'Leave Type', 'Status', 'Department']
            : ['Date', 'Time Period', 'Employee Name', 'Employee No.', 'Duration (Days)', 'Leave Type', 'Department']
        ];
        
        filteredRequests.forEach(request => {
            // Use stored requester info if user is deleted
            const requester = users.find(u => u.id === request.userId);
            const requesterName = requester?.name || request.requesterName || 'Unknown User';
            const requesterEmployeeNumber = requester?.employeeNumber || request.employeeNumber || 'N/A';
            const requesterDepartmentId = requester?.departmentId || request.requesterDepartmentId;
            const requesterPayGroup = resolveRequestPayGroup(request, requester);
            
            // Skip if we can't identify the requester
            if (!requesterName || requesterName === 'Unknown User') return;
            
            const department = departments.find(d => d.id === requesterDepartmentId);
            const startDate = new Date(request.startDate);
            const endDate = new Date(request.endDate);
            
            // Generate entries for each working day in the leave period (exclude weekends and public holidays)
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dateString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                
                // Skip excluded dates (weekends and public holidays) except maternity/paternity
                if (shouldExcludeDateForLeave(request.leaveType, dateString, requesterPayGroup)) {
                    continue;
                }
                
                const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                
                // Determine if it's a full day or half day
                let timePeriod = 'AM';
                let duration = 1.0;
                
                // If it's the start date and start time is PM, it's a half day
                if (d.toDateString() === startDate.toDateString() && request.startTime === 'PM') {
                    timePeriod = 'PM';
                    duration = 0.5;
                }
                // If it's the end date and end time is AM, it's a half day
                else if (d.toDateString() === endDate.toDateString() && request.endTime === 'AM') {
                    timePeriod = 'AM';
                    duration = 0.5;
                }
                // If it's a single day with different start/end times, it's a full day
                else if (startDate.toDateString() === endDate.toDateString() && request.startTime !== request.endTime) {
                    timePeriod = 'AM'; // Default to AM for full day
                    duration = 1.0;
                }
                
                exportData.push(matchApprovalsTable
                    ? [
                        dateStr,
                        timePeriod,
                        requesterName.toUpperCase(),
                        requesterEmployeeNumber,
                        duration.toString(),
                        request.leaveType,
                        request.status,
                        department?.name || 'Unknown'
                    ]
                    : [
                        dateStr,
                        timePeriod,
                        requesterName.toUpperCase(),
                        requesterEmployeeNumber,
                        duration.toString(),
                        request.leaveType,
                        department?.name || 'Unknown'
                    ]);
            }
        });
        
        // Sort by date (skip header row)
        const dataRows = exportData.slice(1);
        dataRows.sort((a, b) => {
            const dateA = a[0];
            const dateB = b[0];
            return new Date(dateA.split('/').reverse().join('-')).getTime() - new Date(dateB.split('/').reverse().join('-')).getTime();
        });
        
        // Reconstruct exportData with sorted rows
        const sortedExportData = [exportData[0], ...dataRows];
        
        // Create workbook and worksheet
        const ws = XLSX.utils.aoa_to_sheet(sortedExportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Approved Leave');
        
        // Generate filename
        const monthName = monthFilter === 'all' ? 'All' : new Date(0, parseInt(monthFilter) - 1).toLocaleString('default', { month: 'long' });
        const yearName = yearFilter === 'all' ? 'All' : yearFilter;
        const fileName = matchApprovalsTable
            ? `approvals-export-${monthName}-${yearName}.xlsx`
            : userId
                ? `my-approved-leave-${monthName}-${yearName}.xlsx`
                : `approved-leave-${monthName}-${yearName}.xlsx`;
        
        // Download file
        XLSX.writeFile(wb, fileName);
    }).catch(error => {
        console.error('Error loading XLSX library:', error);
        alert('Error generating Excel file. Please try again.');
    });
};

// Access Denied Component
const ChangelogView: React.FC = () => {
    return (
        <div className="animate-fade-in p-6 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-text-primary mb-6">Changelog</h1>
            
            <div className="space-y-8">
                {/* Version 0.1.0-beta */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 0.1.0-beta</h2>
                        <span className="text-sm text-text-muted">18 Sep 2026 (Latest)</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• HHMB LeaveApp beta: Harrisons Holdings (Malaysia) Berhad branding and @harrisons.com.my email sign-in</li>
                        <li>• Manageable branches catalog in Firestore (Super Admin Branches page: add, edit, deactivate, delete with confirmation)</li>
                        <li>• Employee registration requires an explicit branch selection; user.branch is stored on create (no emp-number prefix default)</li>
                        <li>• Effective branch helper: branchOverride → branch → legacy emp-number prefix; UI filters use Firestore branch options</li>
                    </ul>
                </div>

                {/* Version 1.5.1 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.5.1</h2>
                        <span className="text-sm text-text-muted">22 Jul 2026, 4:07 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Dashboard: show latest iOS and Android app versions under the mobile store badges</li>
                        <li>• Approvals: fix row hover highlight staying in sync across request details and the sticky Action column</li>
                    </ul>
                </div>

                {/* Version 1.5.0 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.5.0</h2>
                        <span className="text-sm text-text-muted">15 Jul 2026, 10:57 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Redesign Department Settings as a master–detail workspace (list + detail)</li>
                        <li>• Search and branch filter; manage Approvers, CC emails, and Members with autosave from one place</li>
                        <li>• Dual-pane layout with independent scroll; on mobile, full-screen detail with Back</li>
                        <li>• Approver/CC as readable full-width rows; detail pane uses the available width</li>
                    </ul>
                </div>

                {/* Version 1.4.18 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.18</h2>
                        <span className="text-sm text-text-muted">15 Jul 2026, 3:38 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Sign-in and sign-up: Google Play badge shown beside App Store under “Also available on mobile”</li>
                    </ul>
                </div>

                {/* Version 1.4.17 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.17</h2>
                        <span className="text-sm text-text-muted">15 Jul 2026, 3:33 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Approvals: requester leave insight summarizes YTD patterns, notice vs usual, duration, and last similar leave</li>
                        <li>• Insight panel redesigned to match Leave Summary (structured sections, leave-type dots, request/day pills)</li>
                        <li>• Replaced hard-to-see expand chevron with a labeled Details / Hide control (desktop Actions column and mobile full-width)</li>
                    </ul>
                </div>

                {/* Version 1.4.16 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.16</h2>
                        <span className="text-sm text-text-muted">15 Jul 2026, 2:57 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Leave Approved email header and accents now use leave-type colors (matching Approvals/History palette)</li>
                        <li>• Updated footer copyright year to 2026</li>
                    </ul>
                </div>

                {/* Version 1.4.15 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.15</h2>
                        <span className="text-sm text-text-muted">15 Jul 2026, 2:25 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Approval Requests and Leave History rows now show a 6px left accent bar colored by leave type</li>
                        <li>• Shared leave-type color helper used by Approvals, History, and Calendar for consistent palette</li>
                    </ul>
                </div>

                {/* Version 1.4.14 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.14</h2>
                        <span className="text-sm text-text-muted">8 Jul 2026, 8:52 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Added Google Play badge on Dashboard linking to HAR LeaveApp on Android</li>
                        <li>• New reusable GooglePlayBadge component with official Google Play badge artwork</li>
                        <li>• Updated "Take LeaveApp on the go" copy to reference phone instead of iPhone only</li>
                    </ul>
                </div>

                {/* Version 1.4.13 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.13</h2>
                        <span className="text-sm text-text-muted">6 Jul 2026, 3:31 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Fixed Dashboard "Monthly Leave Days" chart selecting the wrong month when clicking a bar — April and other non-contiguous months now show the correct leave details</li>
                        <li>• Added favicon and apple-touch-icon assets with proper link tags for browser tabs and home-screen shortcuts</li>
                    </ul>
                </div>

                {/* Version 1.4.12 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.12</h2>
                        <span className="text-sm text-text-muted">6 Jul 2026, 10:31 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Fixed supporting document downloads on iOS Safari appending a .txt extension to every attachment</li>
                        <li>• Replaced data-URL downloads with blob-based handling and correct MIME types for PDF and image attachments</li>
                        <li>• Added iOS Web Share fallback so approvers can save attachments via the native share sheet when needed</li>
                    </ul>
                </div>

                {/* Version 1.4.11 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.11</h2>
                        <span className="text-sm text-text-muted">3 Jul 2026, 8:33 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Improved approval expanded view with left-aligned Reason, Leave Summary, and Supporting Documents</li>
                        <li>• Moved Supporting Documents below Leave Summary for a clearer review flow</li>
                        <li>• Replaced white attachment cards with dark-themed rows and a more visible Download button</li>
                    </ul>
                </div>

                {/* Version 1.4.10 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.10</h2>
                        <span className="text-sm text-text-muted">22 Jun 2026, 12:29 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Fixed User Profile "Created At" showing Invalid Date by supporting both ISO strings and Firestore timestamps</li>
                    </ul>
                </div>

                {/* Version 1.4.9 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.9</h2>
                        <span className="text-sm text-text-muted">22 Jun 2026, 12:21 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Reduced Firestore reads for normal (non-approver) users with scoped real-time listeners on own profile and leave requests</li>
                        <li>• Department approver user docs fetched only as needed for Apply leave and email notifications</li>
                        <li>• Leave balance history on Dashboard and Leave Summary now reads only the latest record instead of full history</li>
                        <li>• Admin, Super Admin, and Normal approver data loading unchanged</li>
                    </ul>
                </div>

                {/* Version 1.4.8 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.8</h2>
                        <span className="text-sm text-text-muted">15 Jun 2026, 12:45 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Added App Store badge on login and sign-up pages linking to HAR LeaveApp on iPhone</li>
                        <li>• Added "Take LeaveApp on the go" App Store section on Dashboard, placed below Total Annual Leave Days and Pending Requests</li>
                        <li>• New reusable AppStoreBadge component with official Apple badge artwork</li>
                    </ul>
                </div>

                {/* Version 1.4.7 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.7</h2>
                        <span className="text-sm text-text-muted">5 Jun 2026, 11:05 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Fixed pay group 6 Saturday leave showing 1 working day in the approval Leave Summary but 0 working days in approval emails — emails, export, and statistics now use the same pay group resolution as the Leave Summary</li>
                    </ul>
                </div>

                {/* Version 1.4.6 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.6</h2>
                        <span className="text-sm text-text-muted">4 Jun 2026, 04:12 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Fixed Apply for Leave live summary for Maternity and Paternity — it now uses the selected leave type instead of always calculating as Annual Leave, so calendar days and excluded-weekend sections display correctly</li>
                    </ul>
                </div>

                {/* Version 1.4.5 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.5</h2>
                        <span className="text-sm text-text-muted">4 Jun 2026, 03:30 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Maternity and Paternity leave now count calendar days — Saturdays, Sundays, and public holidays are included in leave day totals</li>
                        <li>• Calendar days apply consistently on the apply form, leave summary, approvals and history tables, Excel export, leave calendar, dashboard monthly chart, statistics, and email notifications</li>
                        <li>• Fixed History page export so it correctly exports only your own leave requests</li>
                    </ul>
                </div>

                {/* Version 1.4.4 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.4</h2>
                        <span className="text-sm text-text-muted">9 May 2026, 09:30 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Statistics "On Leave Today" KPI, branch table column, and department drill-down now respect each employee's working week — paygroup 5 staff are no longer counted as on leave on Saturdays, and nobody is counted on Sundays or public holidays</li>
                        <li>• Paygroup 6 staff (6-day work week) continue to show as on leave on Saturdays, unchanged</li>
                    </ul>
                </div>

                {/* Version 1.4.3 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.3</h2>
                        <span className="text-sm text-text-muted">9 May 2026, 09:00 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Fixed Approvals page browser hang for Super Admins / users with many requests (commit time per render reduced by ~60%, JS work cached across re-renders)</li>
                        <li>• Approvals page now renders only the desktop table or the mobile cards based on viewport, instead of mounting both views simultaneously</li>
                        <li>• User and department lookups inside the Approvals page now use O(1) maps instead of linear scans over 1000+ users / 250+ departments</li>
                        <li>• Approval list filter and sort results are memoized, so re-renders triggered by background data updates no longer recompute the full list</li>
                    </ul>
                </div>

                {/* Version 1.4.2 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.2</h2>
                        <span className="text-sm text-text-muted">9 May 2026, 08:20 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Fixed Dashboard "Monthly Leave Days" chart briefly showing "No approved leave days yet" on first login over slow connections — it now shows a loading skeleton until your leave data arrives, then renders the chart</li>
                        <li>• Firestore listener errors are now surfaced in the browser console instead of being silently swallowed, making future connectivity issues easier to diagnose</li>
                    </ul>
                </div>

                {/* Version 1.4.1 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4.1</h2>
                        <span className="text-sm text-text-muted">9 May 2026, 02:51 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Fixed runtime error on the Changelog page introduced in v1.4 (a literal `{'{currentYear}'}` placeholder in the changelog text)</li>
                    </ul>
                </div>

                {/* Version 1.4 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.4</h2>
                        <span className="text-sm text-text-muted">9 May 2026, 02:47 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Dashboard: removed the "Approved Annual Leave" KPI card (now a 2-column KPI row of Total Annual Leave Days and Pending Requests)</li>
                        <li>• Dashboard: added a "Monthly Leave Days" stacked bar chart for the current year, showing approved leave days you've taken each month, broken down by leave type (Sick = red)</li>
                        <li>• Dashboard: click any month bar or month label to drill down and see the underlying leave dates (date range, time, reason, days in that month, with cross-month splits noted)</li>
                        <li>• Day allocation respects pay-group weekends, public holidays, and AM/PM half-days, so leaves spanning month boundaries are split correctly</li>
                    </ul>
                </div>

                {/* Version 1.3 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.3</h2>
                        <span className="text-sm text-text-muted">7 May 2026, 03:54 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Statistics: expanded KPI row with year-over-year trends, average approval time, approval rate, and last-updated timestamp</li>
                        <li>• Statistics: added CSV export of the currently filtered requests</li>
                        <li>• Statistics: added "Applied leave (ever)" metric — active employees who have ever applied leave vs total active, by branch and overall</li>
                        <li>• Statistics: replaced the donut with "Requests by branch" plus a quick insights panel, and added a weekday line chart and leave balance snapshot</li>
                        <li>• Statistics: replaced the flat department list with a Branch → Department → Employee drill-down table (departments sorted A–Z)</li>
                        <li>• Fixed login race: "Department Assignment Pending" warning no longer appears for users on slow connections while departments are still loading</li>
                    </ul>
                </div>

                {/* Version 1.2.1 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.2.1</h2>
                        <span className="text-sm text-text-muted">4 May 2026, 01:15 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Fixed Statistics charts appearing as tiny icons on mobile (mobile CSS no longer forces 20px sizing on recharts chart SVGs)</li>
                        <li>• Improved Statistics chart sizing with measured widths, full-bleed layout on small screens, and corrected branch display labels</li>
                    </ul>
                </div>

                {/* Version 1.2 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.2</h2>
                        <span className="text-sm text-text-muted">4 May 2026, 10:29 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Added Statistics dashboard page with KPI cards, monthly request trend chart, status breakdown pie chart, leave type breakdown, and branch headcount table</li>
                        <li>• Statistics page scoped by role: Super Admin sees all branches, Admin sees their branches, Approvers see their departments</li>
                        <li>• Added password auto-generation on Reset Password modal with Regenerate button and Show/Hide toggle</li>
                        <li>• Added copyable professional reply message after a successful password reset (password shown once, cleared on dismiss)</li>
                    </ul>
                </div>

                {/* Version 1.1 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.1</h2>
                        <span className="text-sm text-text-muted">28 Apr 2026, 03:16 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Added Paygroup support to Employee Master upload and listing (5-day and 6-day workers)</li>
                        <li>• Updated leave calendar and working-day calculations so paygroup 6 includes Saturday</li>
                        <li>• Added Paygroup display and fallback syncing in User Profile</li>
                        <li>• Added sortable and filterable Paygroup column in User Management</li>
                    </ul>
                </div>

                {/* Version 1.0.12 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.12</h2>
                        <span className="text-sm text-text-muted">24 Apr 2026, 03:10 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Added Employee Master List export to Excel including Branch and Sign up status columns</li>
                        <li>• Updated Approval export to exactly match table filters (status, month/year, employee number, employee name)</li>
                        <li>• Updated approvals visibility: own approved/cancelled records are now shown, while own actionable requests remain hidden</li>
                    </ul>
                </div>

                {/* Version 1.0.11 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.11</h2>
                        <span className="text-sm text-text-muted">24 Apr 2026, 12:09 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Added Super Admin branch override when editing a user (optional branch vs employee number prefix)</li>
                        <li>• Added Branch column (sortable and filterable) to User Management between employee number and name</li>
                        <li>• Removed per-row Restore Leave Requests action button from User Management (restore modal and logic retained)</li>
                    </ul>
                </div>

                {/* Version 1.0.10 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.10</h2>
                        <span className="text-sm text-text-muted">22 Apr 2026, 03:43 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Updated sign-up fallback leave balance to default to 0 when balance lookup is unavailable</li>
                        <li>• Added date and time labels for each changelog version entry</li>
                        <li>• Standardized changelog time display to 12-hour format (hh:mm AM/PM)</li>
                    </ul>
                </div>

                {/* Version 1.0.9 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.9</h2>
                        <span className="text-sm text-text-muted">22 Apr 2026, 03:06 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Updated footer and login page version display to v1.0.9</li>
                        <li>• Updated footer and login page copyright text</li>
                        <li>• Added duplicate department name check within each branch in Department Settings</li>
                        <li>• Sorted department dropdown in Dashboard TO DO - Department Assignment section</li>
                    </ul>
                </div>

                {/* Version 1.0.8 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.8</h2>
                        <span className="text-sm text-text-muted">12 Feb 2026, 01:11 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Moved Release Notes from footer to sidebar</li>
                        <li>• Added Changelog / Release Notes page (v1.0.0 to v1.0.8)</li>
                    </ul>
                </div>

                {/* Version 1.0.7 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.7</h2>
                        <span className="text-sm text-text-muted">10 Feb 2026, 10:54 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Added "LeaveApp" title to the sign-in page</li>
                        <li>• Removed "Sign In" label below the title</li>
                        <li>• Updated password reset flow to direct users to contact their administrator</li>
                        <li>• Increased font size of password reset message</li>
                        <li>• Sorted department dropdown by department name in user management</li>
                        <li>• Made leave days column uneditable in user management</li>
                        <li>• Limited export function in approval view to only show data that admins are allowed to see</li>
                        <li>• Added "as of" date for total annual leave day balance in leave summary</li>
                    </ul>
                </div>

                {/* Version 1.0.6 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.6</h2>
                        <span className="text-sm text-text-muted">10 Feb 2026, 10:29 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Added public holiday display in calendar month view</li>
                        <li>• Added public holiday display in calendar week view</li>
                        <li>• Hide user leave requests on public holidays in both month and week views</li>
                        <li>• Removed explanatory note about pending leave days from dashboard</li>
                    </ul>
                </div>

                {/* Version 1.0.5 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.5</h2>
                        <span className="text-sm text-text-muted">10 Feb 2026, 02:10 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Restricted "Leave Balance Upload" view to Super Admin only</li>
                        <li>• Restricted "Public Holidays" view to Super Admin only</li>
                        <li>• Restricted "User Management" view to Super Admin only</li>
                        <li>• Fixed Admin user history view to only show their own leave history</li>
                        <li>• Removed department assignment section from Admin user dashboard</li>
                        <li>• Ensured admins without approver role cannot action on approval requests</li>
                        <li>• Deployed Firestore security rules</li>
                    </ul>
                </div>

                {/* Version 1.0.4 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.4</h2>
                        <span className="text-sm text-text-muted">07 Feb 2026, 04:50 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Fixed bug where not all users could see custom leave types</li>
                        <li>• Standardized export button size across all views (History, Approval, Calendar)</li>
                        <li>• Moved "Clear All Leave Requests" button to Tools view</li>
                        <li>• Moved "Export Departments" button to Tools view</li>
                        <li>• Changed "Employee Name" column to "Name" in approval view</li>
                        <li>• Fixed alignment of "Approve" and "Reject" buttons in approval view</li>
                        <li>• Ensured action buttons are visible on all screen sizes, including iPad Pro</li>
                        <li>• Standardized font sizes and improved alignment in approval view for small screen resolutions</li>
                        <li>• Added version numbers to footer and login page</li>
                    </ul>
                </div>

                {/* Version 1.0.3 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.3</h2>
                        <span className="text-sm text-text-muted">31 Jan 2026, 11:22 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Excluded weekends and public holidays from calendar and approval views</li>
                        <li>• Excluded weekends and public holidays from exported leave data</li>
                        <li>• Ensured deleted users' leave requests remain visible in approval and calendar views</li>
                        <li>• Added complete user deletion functionality while retaining leave requests</li>
                        <li>• Implemented automatic restoration of leave requests and approver assignments based on employeeNumber</li>
                        <li>• Added direct password reset functionality for Super Admins</li>
                    </ul>
                </div>

                {/* Version 1.0.2 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.2</h2>
                        <span className="text-sm text-text-muted">06 Feb 2026, 08:24 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Added new custom leave types functionality</li>
                        <li>• Implemented reordering of leave types in Leave Type Configuration page</li>
                        <li>• Set calendar view to start on Monday</li>
                        <li>• Added "MON, TUE" labels to calendar day headers</li>
                    </ul>
                </div>

                {/* Version 1.0.1 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.1</h2>
                        <span className="text-sm text-text-muted">01 Feb 2026, 07:09 PM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Removed confirmation emails to requester after leave application</li>
                        <li>• Initial version number display</li>
                    </ul>
                </div>

                {/* Version 1.0.0 */}
                <div className="bg-card-bg border border-border rounded-lg p-6 shadow-elegant-lg">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-semibold text-text-primary">Version 1.0.0</h2>
                        <span className="text-sm text-text-muted">07 Sep 2025, 10:36 AM</span>
                    </div>
                    <ul className="space-y-2 text-text-secondary">
                        <li>• Initial release of LeaveApp</li>
                        <li>• Core leave application functionality</li>
                        <li>• User authentication and role-based access control</li>
                        <li>• Leave request submission and approval workflow</li>
                        <li>• Calendar view for leave tracking</li>
                        <li>• Department management</li>
                        <li>• Email notifications</li>
                        <li>• Leave balance management</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

const AccessDeniedView: React.FC<{ pageName: string }> = ({ pageName }) => (
    <div className="animate-fade-in flex flex-col items-center justify-center min-h-[60vh]">
        <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-8 max-w-md text-center">
            <div className="mb-4">
                <svg className="mx-auto h-16 w-16 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <h2 className="text-2xl font-bold text-text-primary mb-2">Access Denied</h2>
            <p className="text-text-secondary mb-4">
                You do not have permission to access the <strong>{pageName}</strong> page.
            </p>
            <p className="text-sm text-text-muted">
                Please contact your administrator if you believe you should have access to this page.
            </p>
        </div>
    </div>
);

const StatCard: React.FC<{ title: string; value: number | string; colorClass: string }> = ({ title, value, colorClass }) => (
    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-text-secondary mb-2">{title}</h3>
        <p className={`text-3xl font-bold ${colorClass}`}>{value}</p>
    </div>
);

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LABELS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LEAVE_TYPE_PALETTE = ['#3b82f6', '#06b6d4', '#a855f7', '#10b981', '#f59e0b', '#64748b', '#ec4899', '#14b8a6', '#f97316', '#84cc16'];

const formatYMD = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
};

const formatLeaveDateShort = (dateString: string): string => {
    if (!dateString) return '';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const getLeaveTypeColor = (type: string, idx: number): string => {
    const lower = (type || '').toLowerCase();
    if (lower.includes('sick')) return '#ef4444';
    return LEAVE_TYPE_PALETTE[idx % LEAVE_TYPE_PALETTE.length]!;
};

const MonthlyTrendChartTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    const visible = payload.filter((p: any) => p && typeof p.value === 'number' && p.value > 0);
    if (visible.length === 0) return null;
    const total = visible.reduce((acc: number, p: any) => acc + (p.value || 0), 0);
    return (
        <div className="bg-card-bg border border-border rounded-md shadow-md px-3 py-2 text-xs">
            <div className="font-semibold text-text-primary mb-1">{label}</div>
            {visible.map((p: any) => (
                <div key={p.dataKey} className="flex items-center gap-2 text-text-secondary">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
                    <span className="flex-1">{p.dataKey}</span>
                    <span className="font-medium text-text-primary">{Number(p.value).toFixed(1)}</span>
                </div>
            ))}
            <div className="mt-1 pt-1 border-t border-border flex justify-between text-text-primary font-semibold">
                <span>Total</span>
                <span>{total.toFixed(1)}</span>
            </div>
            <div className="mt-1 text-[10px] text-text-muted italic">Click bar for details</div>
        </div>
    );
};

interface MonthLeaveDetail {
    request: LeaveRequest;
    daysInMonth: number;
    totalDays: number;
}

const MonthAxisTick: React.FC<any> = ({ x, y, payload, isSelected, onClickMonth }) => {
    const label = payload?.value as string;
    return (
        <g
            transform={`translate(${x},${y})`}
            style={{ cursor: 'pointer' }}
            onClick={() => onClickMonth?.(label)}
        >
            <rect x={-14} y={-2} width={28} height={20} fill="transparent" />
            <text
                x={0}
                y={0}
                dy={12}
                textAnchor="middle"
                fill={isSelected ? '#e2e8f0' : '#94a3b8'}
                fontSize={11}
                fontWeight={isSelected ? 600 : 400}
            >
                {label}
            </text>
        </g>
    );
};

const MonthlyLeaveTrendCard: React.FC<{ userRequests: LeaveRequest[]; userPayGroup: string; requestsLoaded: boolean }> = ({ userRequests, userPayGroup, requestsLoaded }) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [chartWidth, setChartWidth] = useState(0);
    const [selectedMonthIdx, setSelectedMonthIdx] = useState<number | null>(null);
    const chartHeight = 280;

    useLayoutEffect(() => {
        const el = wrapperRef.current;
        if (!el) return;
        const measure = () => {
            let w = el.getBoundingClientRect().width;
            if (w <= 0 && el.parentElement) {
                w = el.parentElement.getBoundingClientRect().width;
            }
            if (w > 0) setChartWidth(Math.floor(w));
        };
        measure();
        const raf = requestAnimationFrame(() => {
            measure();
            requestAnimationFrame(measure);
        });
        const ro = new ResizeObserver(() => measure());
        ro.observe(el);
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
        };
    }, []);

    const currentYear = new Date().getFullYear();

    const { chartData, leaveTypes, totalDays, monthDetails } = useMemo(() => {
        const monthBuckets: Record<string, number>[] = MONTH_LABELS.map(() => ({}));
        const requestPerMonth: Map<string, number>[] = MONTH_LABELS.map(() => new Map<string, number>());
        const requestTotals: Map<string, number> = new Map();
        const typesSeen = new Set<string>();
        let total = 0;

        const approved = userRequests.filter(r => r.status === LeaveStatus.APPROVED);

        approved.forEach(req => {
            const start = new Date(req.startDate);
            const end = new Date(req.endDate);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
            const cursor = new Date(start);
            while (cursor <= end) {
                if (cursor.getFullYear() === currentYear) {
                    const dateStr = formatYMD(cursor);
                    if (!shouldExcludeDateForLeave(req.leaveType, dateStr, userPayGroup)) {
                        let weight = 1;
                        if (req.startDate === req.endDate) {
                            weight = req.startTime !== req.endTime ? 1 : 0.5;
                        } else if (dateStr === req.startDate && req.startTime === 'PM') {
                            weight = 0.5;
                        } else if (dateStr === req.endDate && req.endTime === 'AM') {
                            weight = 0.5;
                        }
                        const monthIdx = cursor.getMonth();
                        const bucket = monthBuckets[monthIdx]!;
                        bucket[req.leaveType] = (bucket[req.leaveType] ?? 0) + weight;
                        typesSeen.add(req.leaveType);
                        total += weight;

                        const monthMap = requestPerMonth[monthIdx]!;
                        monthMap.set(req.id, (monthMap.get(req.id) ?? 0) + weight);
                        requestTotals.set(req.id, (requestTotals.get(req.id) ?? 0) + weight);
                    }
                }
                cursor.setDate(cursor.getDate() + 1);
            }
        });

        const types = Array.from(typesSeen).sort();
        const data = MONTH_LABELS.map((label, i) => {
            const row: Record<string, number | string> = { month: label };
            types.forEach(t => {
                row[t] = Number(((monthBuckets[i]?.[t]) ?? 0).toFixed(2));
            });
            return row;
        });

        const byId = new Map(approved.map(r => [r.id, r] as const));
        const details: MonthLeaveDetail[][] = MONTH_LABELS.map((_, i) => {
            const arr: MonthLeaveDetail[] = [];
            requestPerMonth[i]!.forEach((daysInMonth, reqId) => {
                const r = byId.get(reqId);
                if (r) {
                    arr.push({
                        request: r,
                        daysInMonth: Number(daysInMonth.toFixed(2)),
                        totalDays: Number((requestTotals.get(reqId) ?? 0).toFixed(2)),
                    });
                }
            });
            arr.sort((a, b) => a.request.startDate.localeCompare(b.request.startDate));
            return arr;
        });

        return { chartData: data, leaveTypes: types, totalDays: total, monthDetails: details };
    }, [userRequests, userPayGroup, currentYear]);

    const typeIndexMap = useMemo(() => {
        const m = new Map<string, number>();
        leaveTypes.forEach((t, i) => m.set(t, i));
        return m;
    }, [leaveTypes]);

    const handleBarClick = useCallback((barData: any, _index: number) => {
        const monthLabel = barData?.payload?.month ?? barData?.month;
        const idx = typeof monthLabel === 'string' ? MONTH_LABELS.indexOf(monthLabel) : -1;
        if (idx < 0) return;
        setSelectedMonthIdx(prev => (prev === idx ? null : idx));
    }, []);

    const selectedDetails = selectedMonthIdx !== null ? monthDetails[selectedMonthIdx] : null;

    return (
        <div className="mt-6 bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1 mb-4">
                <div>
                    <h2 className="text-xl font-semibold text-text-primary">Monthly Leave Days &mdash; {currentYear}</h2>
                    <p className="text-sm text-text-muted mt-1">
                        Approved leave days you've taken each month, broken down by leave type. Click a month to see the dates.
                    </p>
                </div>
                <div className="text-sm text-text-secondary">
                    Total: <span className="font-semibold text-text-primary">{totalDays.toFixed(1)}</span> day{totalDays === 1 ? '' : 's'}
                </div>
            </div>

            <div
                ref={wrapperRef}
                className={`block w-full min-w-0 max-w-full box-border ${requestsLoaded && leaveTypes.length > 0 ? 'cursor-pointer' : ''}`}
                style={{ height: chartHeight }}
            >
                {!requestsLoaded ? (
                    <div className="h-full w-full flex flex-col items-center justify-center gap-3" aria-label="Loading leave data">
                        <div className="flex items-end gap-2 h-32">
                            {[0.4, 0.6, 0.5, 0.8, 0.55, 0.7, 0.45, 0.65, 0.5, 0.75, 0.6, 0.5].map((h, i) => (
                                <div
                                    key={i}
                                    className="w-4 rounded-t bg-text-muted/20 animate-pulse"
                                    style={{ height: `${Math.round(h * 100)}%`, animationDelay: `${i * 80}ms` }}
                                />
                            ))}
                        </div>
                        <div className="text-xs text-text-muted">Loading your leave data&hellip;</div>
                    </div>
                ) : leaveTypes.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-text-muted">
                        No approved leave days yet for {currentYear}.
                    </div>
                ) : chartWidth > 0 ? (
                    <BarChart
                        width={chartWidth}
                        height={chartHeight}
                        data={chartData}
                        margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                        <XAxis
                            dataKey="month"
                            tick={(props) => (
                                <MonthAxisTick
                                    {...props}
                                    isSelected={selectedMonthIdx !== null && MONTH_LABELS[selectedMonthIdx] === props.payload?.value}
                                    onClickMonth={(label) => {
                                        const idx = MONTH_LABELS.indexOf(label);
                                        if (idx >= 0) setSelectedMonthIdx(prev => (prev === idx ? null : idx));
                                    }}
                                />
                            )}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals />
                        <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} content={<MonthlyTrendChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" />
                        {selectedMonthIdx !== null && (
                            <ReferenceLine
                                x={MONTH_LABELS[selectedMonthIdx]}
                                stroke="#94a3b8"
                                strokeDasharray="3 3"
                                ifOverflow="extendDomain"
                            />
                        )}
                        {leaveTypes.map((type, i) => (
                            <Bar
                                key={type}
                                dataKey={type}
                                stackId="leave"
                                fill={getLeaveTypeColor(type, i)}
                                radius={i === leaveTypes.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                                onClick={handleBarClick}
                                style={{ cursor: 'pointer' }}
                            />
                        ))}
                    </BarChart>
                ) : (
                    <div className="w-full h-full" aria-hidden />
                )}
            </div>

            {selectedMonthIdx !== null && (
                <div className="mt-5 border-t border-border pt-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-text-primary">
                            {MONTH_LABELS_FULL[selectedMonthIdx]} {currentYear} &mdash; Leave details
                        </h3>
                        <button
                            type="button"
                            onClick={() => setSelectedMonthIdx(null)}
                            className="text-xs text-text-muted hover:text-text-primary underline-offset-2 hover:underline"
                        >
                            Clear
                        </button>
                    </div>
                    {!selectedDetails || selectedDetails.length === 0 ? (
                        <p className="text-sm text-text-muted">No leave taken in {MONTH_LABELS_FULL[selectedMonthIdx]}.</p>
                    ) : (
                        <ul className="divide-y divide-border">
                            {selectedDetails.map((d, i) => {
                                const colorIdx = typeIndexMap.get(d.request.leaveType) ?? 0;
                                const color = getLeaveTypeColor(d.request.leaveType, colorIdx);
                                const isSpan = d.request.startDate !== d.request.endDate;
                                const dateRange = isSpan
                                    ? `${formatLeaveDateShort(d.request.startDate)} (${d.request.startTime}) → ${formatLeaveDateShort(d.request.endDate)} (${d.request.endTime})`
                                    : `${formatLeaveDateShort(d.request.startDate)} (${d.request.startTime}–${d.request.endTime})`;
                                const crossesMonth = Math.abs(d.totalDays - d.daysInMonth) > 0.001;
                                return (
                                    <li key={`${d.request.id}-${i}`} className="py-3 flex flex-row items-start justify-between gap-3">
                                        <div className="flex items-start gap-3 min-w-0 flex-1">
                                            <span className="inline-block w-2.5 h-2.5 rounded-sm mt-1.5 flex-shrink-0" style={{ backgroundColor: color }} />
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-text-primary">
                                                    {d.request.leaveType}
                                                </div>
                                                <div className="text-xs text-text-secondary break-words">
                                                    {dateRange}
                                                </div>
                                                {d.request.reason && (
                                                    <div className="text-xs text-text-muted mt-1 truncate max-w-xl" title={d.request.reason}>
                                                        {d.request.reason}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-xs text-right flex-shrink-0 whitespace-nowrap">
                                            <div className="font-semibold text-text-primary">
                                                {d.daysInMonth.toFixed(1)} day{d.daysInMonth === 1 ? '' : 's'}
                                            </div>
                                            {crossesMonth && (
                                                <div className="text-text-muted">
                                                    of {d.totalDays.toFixed(1)} total
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
};

const LeaveTypeConfigView: React.FC<{ user: User }> = ({ user }) => {
    const [leaveTypeConfigs, setLeaveTypeConfigs] = useState<LeaveTypeConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newLeaveTypeName, setNewLeaveTypeName] = useState('');
    const [newLeaveTypeRequiresDoc, setNewLeaveTypeRequiresDoc] = useState(false);

    useEffect(() => {
        const loadConfigs = async () => {
            try {
                const configs = await getCollection('leaveTypeConfigs') as LeaveTypeConfig[];
                
                // Initialize default configs for enum types if they don't exist
                const enumTypes = Object.values(LeaveType);
                const existingTypes = configs.map(c => c.leaveType);
                const missingEnumTypes = enumTypes.filter(t => !existingTypes.includes(t));
                
                if (missingEnumTypes.length > 0) {
                    const maxOrder = configs.length > 0 
                        ? Math.max(...configs.map(c => c.order || 0)) 
                        : -1;
                    
                    const newConfigs = missingEnumTypes.map((leaveType, index) => ({
                        leaveType,
                        requiresSupportingDocument: false,
                        order: maxOrder + index + 1,
                        isCustom: false,
                        updatedAt: new Date().toISOString(),
                        updatedBy: user.id
                    }));
                    
                    for (const config of newConfigs) {
                        await addDocument('leaveTypeConfigs', config);
                    }
                    
                    // Reload after adding defaults
                    const updatedConfigs = await getCollection('leaveTypeConfigs') as LeaveTypeConfig[];
                    setLeaveTypeConfigs(updatedConfigs);
                } else {
                    // Ensure all configs have order field
                    const configsWithOrder = configs.map((config, index) => ({
                        ...config,
                        order: config.order !== undefined ? config.order : index,
                        isCustom: config.isCustom !== undefined ? config.isCustom : !enumTypes.includes(config.leaveType as LeaveType)
                    }));
                    
                    // Sort by order
                    configsWithOrder.sort((a, b) => (a.order || 0) - (b.order || 0));
                    setLeaveTypeConfigs(configsWithOrder);
                }
            } catch (error) {
                console.error('Failed to load leave type configurations:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadConfigs();
    }, [user.id]);

    const updateLeaveTypeConfig = async (leaveType: LeaveType | string, requiresSupportingDocument: boolean) => {
        try {
            const existingConfig = leaveTypeConfigs.find(config => config.leaveType === leaveType);
            
            if (existingConfig) {
                await updateDocument('leaveTypeConfigs', existingConfig.id, {
                    requiresSupportingDocument,
                    updatedAt: new Date().toISOString(),
                    updatedBy: user.id
                });
            } else {
                const maxOrder = leaveTypeConfigs.length > 0 
                    ? Math.max(...leaveTypeConfigs.map(c => c.order || 0)) 
                    : 0;
                
                await addDocument('leaveTypeConfigs', {
                    leaveType,
                    requiresSupportingDocument,
                    order: maxOrder + 1,
                    isCustom: !Object.values(LeaveType).includes(leaveType as LeaveType),
                    updatedAt: new Date().toISOString(),
                    updatedBy: user.id,
                    createdAt: new Date().toISOString(),
                    createdBy: user.id
                });
            }
            
            // Reload configs
            const configs = await getCollection('leaveTypeConfigs') as LeaveTypeConfig[];
            const sortedConfigs = configs.sort((a, b) => (a.order || 0) - (b.order || 0));
            setLeaveTypeConfigs(sortedConfigs);
        } catch (error) {
            console.error('Failed to update leave type configuration:', error);
            alert('Failed to update configuration. Please try again.');
        }
    };

    const addNewLeaveType = async () => {
        if (!newLeaveTypeName.trim()) {
            alert('Please enter a leave type name');
            return;
        }
        
        // Check if leave type already exists
        const exists = leaveTypeConfigs.some(c => 
            c.leaveType.toLowerCase() === newLeaveTypeName.trim().toLowerCase()
        );
        
        if (exists) {
            alert('This leave type already exists');
            return;
        }
        
        try {
            const maxOrder = leaveTypeConfigs.length > 0 
                ? Math.max(...leaveTypeConfigs.map(c => c.order || 0)) 
                : 0;
            
            await addDocument('leaveTypeConfigs', {
                leaveType: newLeaveTypeName.trim(),
                requiresSupportingDocument: newLeaveTypeRequiresDoc,
                order: maxOrder + 1,
                isCustom: true,
                updatedAt: new Date().toISOString(),
                updatedBy: user.id,
                createdAt: new Date().toISOString(),
                createdBy: user.id
            });
            
            // Reload configs
            const configs = await getCollection('leaveTypeConfigs') as LeaveTypeConfig[];
            const sortedConfigs = configs.sort((a, b) => (a.order || 0) - (b.order || 0));
            setLeaveTypeConfigs(sortedConfigs);
            
            // Reset form
            setNewLeaveTypeName('');
            setNewLeaveTypeRequiresDoc(false);
            setShowAddForm(false);
        } catch (error) {
            console.error('Failed to add leave type:', error);
            alert('Failed to add leave type. Please try again.');
        }
    };

    const deleteLeaveType = async (configId: string, leaveType: string | LeaveType) => {
        if (!confirm(`Are you sure you want to delete "${leaveType}"? This action cannot be undone.`)) {
            return;
        }
        
        try {
            await deleteDocument('leaveTypeConfigs', configId);
            
            // Reload configs
            const configs = await getCollection('leaveTypeConfigs') as LeaveTypeConfig[];
            const sortedConfigs = configs.sort((a, b) => (a.order || 0) - (b.order || 0));
            setLeaveTypeConfigs(sortedConfigs);
        } catch (error) {
            console.error('Failed to delete leave type:', error);
            alert('Failed to delete leave type. Please try again.');
        }
    };

    const moveLeaveType = async (index: number, direction: 'up' | 'down') => {
        if ((direction === 'up' && index === 0) || 
            (direction === 'down' && index === leaveTypeConfigs.length - 1)) {
            return;
        }
        
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        const configs = [...leaveTypeConfigs];
        const [moved] = configs.splice(index, 1);
        configs.splice(newIndex, 0, moved);
        
        // Update orders
        const updatedConfigs = configs.map((config, i) => ({
            ...config,
            order: i
        }));
        
        try {
            // Update all orders in batch
            for (const config of updatedConfigs) {
                await updateDocument('leaveTypeConfigs', config.id, {
                    order: config.order,
                    updatedAt: new Date().toISOString(),
                    updatedBy: user.id
                });
            }
            
            setLeaveTypeConfigs(updatedConfigs);
        } catch (error) {
            console.error('Failed to reorder leave types:', error);
            alert('Failed to reorder leave types. Please try again.');
        }
    };

    if (isLoading) {
        return (
            <div className="animate-fade-in">
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            </div>
        );
    }

    const sortedConfigs = [...leaveTypeConfigs].sort((a, b) => (a.order || 0) - (b.order || 0));

    return (
        <div className="animate-fade-in">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">Leave Type Configuration</h1>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                    {showAddForm ? 'Cancel' : '+ Add New Leave Type'}
                </button>
            </div>
            
            {/* Add New Leave Type Form */}
            {showAddForm && (
                <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6 mb-6">
                    <h2 className="text-xl font-semibold text-text-primary mb-4">Add New Leave Type</h2>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="newLeaveTypeName" className="block text-sm font-medium text-text-secondary mb-1">
                                Leave Type Name
                            </label>
                            <input
                                id="newLeaveTypeName"
                                type="text"
                                value={newLeaveTypeName}
                                onChange={(e) => setNewLeaveTypeName(e.target.value)}
                                placeholder="e.g., Study Leave, Unpaid Leave"
                                className="w-full px-3 py-2 border border-border rounded-md bg-surface-light text-text-primary focus:ring-primary focus:border-primary"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                id="newLeaveTypeRequiresDoc"
                                type="checkbox"
                                checked={newLeaveTypeRequiresDoc}
                                onChange={(e) => setNewLeaveTypeRequiresDoc(e.target.checked)}
                                className="w-4 h-4 text-primary border-border rounded focus:ring-primary"
                            />
                            <label htmlFor="newLeaveTypeRequiresDoc" className="text-sm text-text-secondary">
                                Require supporting documents
                            </label>
                        </div>
                        <button
                            onClick={addNewLeaveType}
                            className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg font-medium transition-colors"
                        >
                            Add Leave Type
                        </button>
                    </div>
                </div>
            )}
            
            <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                <h2 className="text-xl font-semibold text-text-primary mb-4">
                    Supporting Document Requirements
                </h2>
                <p className="text-text-muted mb-6">
                    Configure which leave types require supporting documents to be uploaded. Drag to reorder or use the arrow buttons.
                </p>
                
                <div className="space-y-4">
                    {sortedConfigs.map((config, index) => {
                        const requiresSupportingDocument = config.requiresSupportingDocument || false;
                        const isCustom = config.isCustom || false;
                        
                        return (
                            <div key={config.id} className="flex items-center gap-4 p-4 bg-surface-light rounded-lg">
                                {/* Reorder Buttons */}
                                <div className="flex flex-col gap-1">
                                    <button
                                        onClick={() => moveLeaveType(index, 'up')}
                                        disabled={index === 0}
                                        className={`p-1 rounded ${index === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-surface text-text-secondary'}`}
                                        title="Move up"
                                    >
                                        ↑
                                    </button>
                                    <button
                                        onClick={() => moveLeaveType(index, 'down')}
                                        disabled={index === sortedConfigs.length - 1}
                                        className={`p-1 rounded ${index === sortedConfigs.length - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-surface text-text-secondary'}`}
                                        title="Move down"
                                    >
                                        ↓
                                    </button>
                                </div>
                                
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-medium text-text-primary">{config.leaveType}</h3>
                                        {isCustom && (
                                            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                                                Custom
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-text-muted">
                                        {requiresSupportingDocument 
                                            ? 'Supporting documents are required' 
                                            : 'Supporting documents are optional'
                                        }
                                    </p>
                                </div>
                                
                                <label className="flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={requiresSupportingDocument}
                                        onChange={(e) => updateLeaveTypeConfig(config.leaveType, e.target.checked)}
                                        className="sr-only"
                                    />
                                    <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        requiresSupportingDocument ? 'bg-primary' : 'bg-gray-300'
                                    }`}>
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                            requiresSupportingDocument ? 'translate-x-6' : 'translate-x-1'
                                        }`} />
                                    </div>
                                </label>
                                
                                {/* Delete Button for Custom Types */}
                                {isCustom && (
                                    <button
                                        onClick={() => deleteLeaveType(config.id, config.leaveType)}
                                        className="text-red-500 hover:text-red-700 p-2 rounded hover:bg-red-50 transition-colors"
                                        title="Delete leave type"
                                    >
                                        🗑️
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// --- VIEW COMPONENTS ---
type View = 'dashboard' | 'apply' | 'history' | 'approvals' | 'calendar' | 'profile' | 'users' | 'departments' | 'branches' | 'email-setup' | 'leave-type-config' | 'employee-upload' | 'leave-balance-upload' | 'public-holidays' | 'changelog' | 'statistics' | 'tools';

// Component for assigning department to a user (used in TO DO section)
const UserDepartmentAssignmentItem: React.FC<{
    targetUser: User;
    departments: Department[];
    onUserUpdate: () => void;
}> = ({ targetUser, departments, onUserUpdate }) => {
    const [selectedDeptId, setSelectedDeptId] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    
    // Get departments for this user's branch, sorted by name
    const userBranch = getEffectiveUserBranch(targetUser);
    const availableDepartments = useMemo(
        () =>
            departments
                .filter(dept => dept.branch?.toUpperCase() === userBranch.toUpperCase())
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
        [departments, userBranch]
    );

    const handleAssignDepartment = async () => {
        if (!selectedDeptId) return;
        
        setIsSaving(true);
        try {
            await updateUser(targetUser.id, { departmentId: selectedDeptId });
            onUserUpdate(); // Refresh user list
        } catch (error) {
            console.error('Failed to assign department:', error);
            alert('Failed to assign department. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="bg-surface-light rounded-lg p-4 border border-border">
            <div className="flex items-center justify-between">
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                            <UserIcon className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <div className="font-medium text-text-primary">{targetUser.name}</div>
                            <div className="text-sm text-text-muted">
                                {targetUser.employeeNumber} • Branch {userBranch}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3 ml-4">
                    <select
                        value={selectedDeptId}
                        onChange={(e) => setSelectedDeptId(e.target.value)}
                        className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary min-w-[200px]"
                        disabled={isSaving}
                    >
                        <option value="">Select Department</option>
                        {availableDepartments.map(dept => (
                            <option key={dept.id} value={dept.id}>
                                {dept.name}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={handleAssignDepartment}
                        disabled={!selectedDeptId || isSaving}
                        className="bg-primary text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSaving ? 'Saving...' : 'Assign & Save'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const DashboardView: React.FC<{ user: User; requests: LeaveRequest[]; requestsLoaded: boolean; departments: Department[]; departmentsLoaded: boolean; users: User[]; onUserUpdate: () => void }> = ({ user, requests, requestsLoaded, departments, departmentsLoaded, users, onUserUpdate }) => {
    const [lastBalanceUpdate, setLastBalanceUpdate] = useState<{ effectiveDate: string } | null>(null);
    
    const userRequests = requests.filter(r => r.userId === user.id);
    const userPayGroup = getPayGroup(user);

    // Filter requests relative to latest balance upload (if any)
    const requestsSinceLastBalance = useMemo(() => {
        if (!lastBalanceUpdate) return userRequests;
        const effective = lastBalanceUpdate.effectiveDate;
        return userRequests.filter(r => r.startDate >= effective);
    }, [userRequests, lastBalanceUpdate]);

    const pendingRequests = requestsSinceLastBalance.filter(r => r.status === LeaveStatus.PENDING).length;

    const userDepartment = departments.find(dept => dept.id === user.departmentId);
    const hasDepartment = user.departmentId && userDepartment;
    const showNoDepartmentWarning = departmentsLoaded && !hasDepartment;

    // Upcoming leave (future-dated approved or pending)
    const today = new Date().toISOString().split('T')[0];
    const upcomingRequests = userRequests
        .filter(r => 
            (r.status === LeaveStatus.PENDING || r.status === LeaveStatus.APPROVED) &&
            r.startDate >= today
        )
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    // Format date for display
    const formatDisplayDate = (dateString: string): string => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    // Fetch the most recent leave balance update
    useEffect(() => {
        const fetchLastBalanceUpdate = async () => {
            if (!user.employeeNumber) {
                setLastBalanceUpdate(null);
                return;
            }

            try {
                const { getLatestLeaveBalanceHistory } = await import('./services/firebaseService');
                const latest = await getLatestLeaveBalanceHistory(user.employeeNumber);
                
                if (latest) {
                    setLastBalanceUpdate({
                        effectiveDate: latest.effectiveDate
                    });
                } else {
                    setLastBalanceUpdate(null);
                }
            } catch (error) {
                console.error('Error fetching last balance update:', error);
                setLastBalanceUpdate(null);
            }
        };

        fetchLastBalanceUpdate();
    }, [user.employeeNumber]);

    return (
        <div className="animate-fade-in">
            <h1 className="text-3xl font-bold mb-6">Welcome back, {user.name.split(' ')[0]}!</h1>
            
            {/* Department Assignment Warning */}
            {showNoDepartmentWarning && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 mb-6">
                    <div className="flex items-start">
                        <div className="flex-shrink-0">
                            <div className="text-2xl">⚠️</div>
                        </div>
                        <div className="ml-3">
                            <h3 className="text-lg font-medium text-yellow-800">
                                Department Assignment Pending
                            </h3>
                            <div className="mt-2 text-sm text-yellow-700">
                                <p>
                                    You don't have a department assigned yet. You can still access your profile and view your leave history, 
                                    but you'll need to be assigned to a department before you can apply for leave.
                                </p>
                                <p className="mt-2">
                                    <strong>Next steps:</strong> Contact your HR department or supervisor to get assigned to a department.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <StatCard 
                    title={lastBalanceUpdate 
                        ? `Total Annual Leave Days (as of ${formatDisplayDate(lastBalanceUpdate.effectiveDate)})` 
                        : "Total Annual Leave Days"} 
                    value={user.leaveDaysTotal} 
                    colorClass="text-primary" 
                />
                <StatCard title="Pending Requests" value={pendingRequests} colorClass="text-yellow-400" />
            </div>

            <MonthlyLeaveTrendCard userRequests={userRequests} userPayGroup={userPayGroup} requestsLoaded={requestsLoaded} />
            
            {/* Upcoming Leave */}
            {upcomingRequests.length > 0 && (
                <div className="mt-6 bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                    <h2 className="text-xl font-semibold text-text-primary mb-3">Upcoming Leave</h2>
                    <p className="text-sm text-text-muted mb-4">
                        These are your upcoming approved or pending leave requests starting from today onwards.
                    </p>
                    <div className="divide-y divide-border">
                        {upcomingRequests.map((req) => {
                            const days = getDaysBetween(req.startDate, req.endDate, req.startTime, req.endTime, userPayGroup, req.leaveType);
                            const start = formatDisplayDate(req.startDate);
                            const end = formatDisplayDate(req.endDate);
                            return (
                                <div key={req.id} className="py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                    <div>
                                        <div className="text-sm font-medium text-text-primary">
                                            {req.leaveType} &middot; {days.toFixed(1)} day{days !== 1 ? 's' : ''}
                                        </div>
                                        <div className="text-xs text-text-muted">
                                            {start} ({req.startTime}) &rarr; {end} ({req.endTime})
                                        </div>
                                        {req.reason && (
                                            <div className="text-xs text-text-muted mt-1 truncate max-w-md" title={req.reason}>
                                                {req.reason}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-xs font-semibold">
                                        <span className={
                                            req.status === LeaveStatus.APPROVED
                                                ? 'text-green-600'
                                                : req.status === LeaveStatus.PENDING
                                                ? 'text-yellow-600'
                                                : 'text-text-muted'
                                        }>
                                            {req.status}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* TO DO Section for Super Admin Users - Users without Department */}
            {user.role === UserRole.SUPER_ADMIN && (() => {
                // Super Admin sees all users without department
                const usersWithoutDepartment = users.filter(u => {
                    if (!u.employeeNumber || u.employeeNumber.length < 2) return false;
                    if (u.departmentId) return false; // Has department, skip
                    if (!u.isActive) return false; // Skip inactive users
                    return true;
                });

                if (usersWithoutDepartment.length === 0) return null;

                return (
                    <div className="mt-6 bg-card-bg rounded-xl shadow-elegant-lg border border-border overflow-hidden">
                        <div className="p-6 border-b border-border">
                            <h2 className="text-xl font-semibold text-text-primary">TO DO - Department Assignment</h2>
                            <p className="text-sm text-text-muted mt-1">
                                All users without department assignment
                            </p>
                        </div>
                        <div className="p-6">
                            <div className="space-y-4">
                                {usersWithoutDepartment.map((targetUser) => (
                                    <UserDepartmentAssignmentItem
                                        key={targetUser.id}
                                        targetUser={targetUser}
                                        departments={departments}
                                        onUserUpdate={onUserUpdate}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

const ApplyLeaveView: React.FC<{ 
    user: User; 
    departments: Department[];
    departmentsLoaded: boolean;
    users: User[];
    leaveRequests: LeaveRequest[];
    onApply: (request: Omit<LeaveRequest, 'id' | 'status' | 'requestedAt'>) => void 
}> = ({ user, departments, departmentsLoaded, users, leaveRequests, onApply }) => {
    const [leaveType, setLeaveType] = useState<LeaveType | string>(LeaveType.ANNUAL);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [startTime, setStartTime] = useState<'AM' | 'PM'>('AM');
    const [endTime, setEndTime] = useState<'AM' | 'PM'>('PM');
    const [reason, setReason] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [lastSubmissionTime, setLastSubmissionTime] = useState(0);
    const [cooldownSeconds, setCooldownSeconds] = useState(0);
    const [leaveTypeConfigs, setLeaveTypeConfigs] = useState<LeaveTypeConfig[]>([]);
    const [attachments, setAttachments] = useState<StoredFile[]>([]);
    const [publicHolidayWarning, setPublicHolidayWarning] = useState<string>('');
    const [holidaysInRange, setHolidaysInRange] = useState<Array<{ date: string; name: string }>>([]);
    const [isLoadingHolidays, setIsLoadingHolidays] = useState(false);

    // Load holidays for the date range when dates change
    useEffect(() => {
        if (!startDate || !endDate) {
            setHolidaysInRange([]);
            return;
        }
        
        const loadHolidaysInRange = async () => {
            setIsLoadingHolidays(true);
            const start = new Date(startDate);
            const end = new Date(endDate);
            const foundHolidays: Array<{ date: string; name: string }> = [];
            
            // Get all unique years in the range
            const years = new Set<number>();
            const current = new Date(start);
            while (current <= end) {
                years.add(current.getFullYear());
                current.setDate(current.getDate() + 1);
            }
            
                                    // Helper function to format date without timezone issues
                                    const formatDateToYYYYMMDD = (date: Date): string => {
                                        const year = date.getFullYear();
                                        const month = String(date.getMonth() + 1).padStart(2, '0');
                                        const day = String(date.getDate()).padStart(2, '0');
                                        return `${year}-${month}-${day}`;
                                    };
                                    
                                    // Ensure holidays are loaded for all years in range
                                    await Promise.all(Array.from(years).map(year => ensureHolidaysLoadedForYear(year)));
                                    
                                    // Now check for holidays
                                    const checkCurrent = new Date(start);
                                    while (checkCurrent <= end) {
                                        const dateString = formatDateToYYYYMMDD(checkCurrent);
                                        if (isPublicHoliday(dateString)) {
                                            const holidayName = getPublicHolidayName(dateString) || 'Public Holiday';
                                            foundHolidays.push({ date: dateString, name: holidayName });
                                        }
                                        checkCurrent.setDate(checkCurrent.getDate() + 1);
                                    }
            
            setHolidaysInRange(foundHolidays);
            setIsLoadingHolidays(false);
        };
        
        loadHolidaysInRange();
    }, [startDate, endDate]);

    // Cooldown timer effect
    useEffect(() => {
        if (cooldownSeconds > 0) {
            const timer = setTimeout(() => {
                setCooldownSeconds(cooldownSeconds - 1);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [cooldownSeconds]);


    // Load leave type configurations
    useEffect(() => {
        const loadLeaveTypeConfigs = async () => {
            try {
                const configs = await getCollection('leaveTypeConfigs') as LeaveTypeConfig[];
                setLeaveTypeConfigs(configs);
            } catch (error: any) {
                // Log error but don't block the UI - users will still see enum types
                console.error('Failed to load leave type configurations:', error);
            }
        };
        loadLeaveTypeConfigs();
    }, []);

    const handleGenerateReason = async () => {
        if (!startDate || !endDate) {
            alert('Please select dates first');
            return;
        }
        
        setIsGenerating(true);
        try {
            const workingDays = getLeaveDaysBetween(startDate, endDate, 'AM', 'PM', getPayGroup(user), leaveType);
            const generatedReason = await generateLeaveReason(leaveType, workingDays);
        setReason(generatedReason);
        } catch (error) {
            console.error('Failed to generate reason:', error);
            alert('Failed to generate reason. Please try again.');
        } finally {
        setIsGenerating(false);
        }
    };



    const getCurrentLeaveTypeConfig = () => {
        return leaveTypeConfigs.find(config => config.leaveType === leaveType);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const validation = validateFilesForStorage(files);
        
        if (!validation.isValid) {
            alert(validation.errors.join('\n'));
            return;
        }
        
        try {
            const storedFiles = await convertFilesToStoredFiles(files, user.id);
            setAttachments(prev => [...prev, ...storedFiles]);
        } catch (error) {
            console.error('Error processing files:', error);
            alert('Failed to process files. Please try again.');
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // Check if user has a department assigned
        if (!hasDepartment) {
            alert('You need to be assigned to a department before you can apply for leave. Please contact your administrator.');
            return;
        }
        
        // Prevent multiple rapid submissions
        const now = Date.now();
        const timeSinceLastSubmission = now - lastSubmissionTime;
        const minTimeBetweenSubmissions = 3000; // 3 seconds minimum between submissions
        
        if (timeSinceLastSubmission < minTimeBetweenSubmissions) {
            const remainingSeconds = Math.ceil((minTimeBetweenSubmissions - timeSinceLastSubmission) / 1000);
            setCooldownSeconds(remainingSeconds);
            alert(`Please wait ${remainingSeconds} more seconds before submitting again.`);
            return;
        }
        
        if (isSubmitting) {
            alert('Your leave request is already being submitted. Please wait...');
            return;
        }
        
        // Check if supporting documents are required
        const currentConfig = getCurrentLeaveTypeConfig();
        if (currentConfig?.requiresSupportingDocument && attachments.length === 0) {
            alert(`Supporting documents are required for ${leaveType}. Please upload at least one document.`);
            return;
        }

        // Basic validation
        if (!startDate || !endDate) {
            alert('Please fill in all required fields.');
            return;
        }

        const usesCalendarDays = leaveTypeUsesCalendarDays(leaveType);

        if (!usesCalendarDays) {
            if (startDate && isPublicHoliday(startDate)) {
                const confirmed = confirm(`The selected start date (${formatDateWithDay(startDate)}) is a public holiday. Public holidays are automatically excluded from working days calculation. Do you want to continue?`);
                if (!confirmed) return;
            }

            if (endDate && isPublicHoliday(endDate)) {
                const confirmed = confirm(`The selected end date (${formatDateWithDay(endDate)}) is a public holiday. Public holidays are automatically excluded from working days calculation. Do you want to continue?`);
                if (!confirmed) return;
            }
        }

        const leaveDays = getLeaveDaysBetween(startDate, endDate, startTime, endTime, getPayGroup(user), leaveType);
        if (leaveDays === 0) {
            alert(
                usesCalendarDays
                    ? 'The selected leave period has 0 leave days. Please select a valid date range.'
                    : 'The selected leave period has 0 working days. Please select a different date range that includes at least one working day.'
            );
            return;
        }
        
        setIsSubmitting(true);
        setLastSubmissionTime(now);
        
        try {
            // Attachments are already validated when uploaded

            await onApply({
                userId: user.id,
                leaveType,
                startDate,
                endDate,
                startTime,
                endTime,
                payGroup: getPayGroup(user),
                reason,
                attachments: attachments, // Pass files directly
            });
            
            // Reset form only after successful submission
            setLeaveType(LeaveType.ANNUAL);
            setStartDate('');
            setEndDate('');
            setStartTime('AM');
            setEndTime('PM');
            setReason('');
            setAttachments([]);
        } catch (error) {
            console.error('Error submitting leave request:', error);
            alert('Failed to submit leave request. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const userDepartment = departments.find(dept => dept.id === user.departmentId);
    const departmentApprovers = userDepartment?.approverIds?.map(id => users.find(user => user.id === id)).filter(Boolean) || [];
    const departmentCCEmails = userDepartment?.ccEmails || [];

    // Check if user has a department assigned
    const hasDepartment = user.departmentId && userDepartment;
    const showNoDepartmentWarning = departmentsLoaded && !hasDepartment;

    return (
        <div className="animate-fade-in">
            {/* Department Assignment Warning */}
            {showNoDepartmentWarning && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 mb-6">
                    <div className="flex items-start">
                        <div className="flex-shrink-0">
                            <div className="text-2xl">⚠️</div>
                        </div>
                        <div className="ml-3">
                            <h3 className="text-lg font-medium text-yellow-800">
                                Department Assignment Required
                            </h3>
                            <div className="mt-2 text-sm text-yellow-700">
                                <p>
                                    You don't have a department assigned yet. Please contact your administrator 
                                    to assign you to a department before you can apply for leave.
                                </p>
                                <p className="mt-2">
                                    <strong>What you can do:</strong>
                                </p>
                                <ul className="list-disc list-inside mt-1 space-y-1">
                                    <li>Contact your HR department or supervisor</li>
                                    <li>Wait for your administrator to assign you to a department</li>
                                    <li>You can still view your profile and other features</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            <h1 className="text-3xl font-bold mb-6">Apply for Leave</h1>
            <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-8 max-w-4xl mx-auto">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="leaveType" className="block text-sm font-medium text-text-secondary mb-1">Leave Type</label>
                        <select 
                            id="leaveType" 
                            value={leaveType} 
                            onChange={e => setLeaveType(e.target.value as LeaveType)} 
                            className="w-full bg-surface-light border-border rounded-md p-2 focus:ring-primary focus:border-primary"
                        >
                            {(() => {
                                // Get all leave types from configs (sorted by order) and enum types
                                const configTypes = leaveTypeConfigs
                                    .sort((a, b) => (a.order || 0) - (b.order || 0))
                                    .map(c => c.leaveType);
                                const enumTypes = Object.values(LeaveType);
                                // Combine and deduplicate
                                const allTypes = [...new Set([...configTypes, ...enumTypes])];
                                return allTypes.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ));
                            })()}
                        </select>
                    </div>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label htmlFor="startDate" className="block text-sm font-medium text-text-secondary mb-1">Start Date</label>
                                <input 
                                    type="date" 
                                    id="startDate" 
                                    value={startDate} 
                                    onChange={async e => {
                                        const selectedDate = e.target.value;
                                        setStartDate(selectedDate);
                                        
                                        // Ensure holidays are loaded for the selected date's year
                                        if (selectedDate) {
                                            const dateYear = new Date(selectedDate).getFullYear();
                                            await ensureHolidaysLoadedForYear(dateYear);
                                            
                                            if (isPublicHoliday(selectedDate) && !leaveTypeUsesCalendarDays(leaveType)) {
                                                const holidayName = getPublicHolidayName(selectedDate) || 'Public Holiday';
                                                setPublicHolidayWarning(`⚠️ ${formatDateWithDay(selectedDate)} (${holidayName}) is a public holiday. Public holidays are automatically excluded from leave calculations.`);
                                            } else if (isPublicHoliday(selectedDate) && leaveTypeUsesCalendarDays(leaveType)) {
                                                const holidayName = getPublicHolidayName(selectedDate) || 'Public Holiday';
                                                setPublicHolidayWarning(`ℹ️ ${formatDateWithDay(selectedDate)} (${holidayName}) is a public holiday and will be included in your leave day count.`);
                                            } else {
                                                setPublicHolidayWarning('');
                                            }
                                        }
                                    }} 
                                    className="w-full bg-surface-light border-border rounded-md p-2 focus:ring-primary focus:border-primary"
                                />
                            </div>
                            <div>
                                <label htmlFor="endDate" className="block text-sm font-medium text-text-secondary mb-1">End Date</label>
                                <input 
                                    type="date" 
                                    id="endDate" 
                                    value={endDate} 
                                    onChange={async e => {
                                        const selectedDate = e.target.value;
                                        setEndDate(selectedDate);
                                        
                                        // Ensure holidays are loaded for the selected date's year
                                        if (selectedDate) {
                                            const dateYear = new Date(selectedDate).getFullYear();
                                            await ensureHolidaysLoadedForYear(dateYear);
                                            
                                            if (isPublicHoliday(selectedDate) && !leaveTypeUsesCalendarDays(leaveType)) {
                                                const holidayName = getPublicHolidayName(selectedDate) || 'Public Holiday';
                                                setPublicHolidayWarning(`⚠️ ${formatDateWithDay(selectedDate)} (${holidayName}) is a public holiday. Public holidays are automatically excluded from leave calculations.`);
                                            } else if (isPublicHoliday(selectedDate) && leaveTypeUsesCalendarDays(leaveType)) {
                                                const holidayName = getPublicHolidayName(selectedDate) || 'Public Holiday';
                                                setPublicHolidayWarning(`ℹ️ ${formatDateWithDay(selectedDate)} (${holidayName}) is a public holiday and will be included in your leave day count.`);
                                            } else {
                                                setPublicHolidayWarning('');
                                            }
                                        }
                                    }} 
                                    min={startDate || undefined}
                                    disabled={!startDate}
                                    className={`w-full bg-surface-light border-border rounded-md p-2 focus:ring-primary focus:border-primary ${!startDate ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    title={!startDate ? 'Please select a start date first' : ''}
                                />
                            </div>
                        </div>
                        
                        {/* Public Holiday Warning */}
                        {publicHolidayWarning && (
                            <div className="bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 rounded-lg p-3 text-sm">
                                {publicHolidayWarning}
                            </div>
                        )}
                        
                        {/* Check for public holidays in date range */}
                        {startDate && endDate && (
                            <>
                                {isLoadingHolidays && (
                                    <div className="bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg p-3 text-sm">
                                        <p>Loading public holidays...</p>
                                    </div>
                                )}
                                {!isLoadingHolidays && holidaysInRange.length > 0 && (
                                    <div className="bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg p-3 text-sm">
                                        <p className="font-medium mb-1">📅 Public Holidays in Selected Range:</p>
                                        <ul className="list-disc list-inside space-y-1">
                                            {holidaysInRange.map(holiday => (
                                                <li key={holiday.date}>
                                                    <span className="font-medium">{formatDateWithDay(holiday.date)}</span>
                                                    {' - '}
                                                    <span>{holiday.name}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        <p className="mt-2 text-xs">
                                            {leaveTypeUsesCalendarDays(leaveType)
                                                ? 'These dates are included in your leave day count (maternity/paternity).'
                                                : 'These dates will be automatically excluded from working days calculation.'}
                                        </p>
                                    </div>
                                )}
                            </>
                        )}
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label htmlFor="startTime" className="block text-sm font-medium text-text-secondary mb-1">Start Time</label>
                                <select id="startTime" value={startTime} onChange={e => setStartTime(e.target.value as 'AM' | 'PM')} className="w-full bg-surface-light border-border rounded-md p-2 focus:ring-primary focus:border-primary">
                                    <option value="AM">AM</option>
                                    <option value="PM">PM</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="endTime" className="block text-sm font-medium text-text-secondary mb-1">End Time</label>
                                <select id="endTime" value={endTime} onChange={e => setEndTime(e.target.value as 'AM' | 'PM')} className="w-full bg-surface-light border-border rounded-md p-2 focus:ring-primary focus:border-primary">
                                    <option value="AM">AM</option>
                                    <option value="PM">PM</option>
                                </select>
                            </div>
                        </div>
                        
                        {/* Leave Summary */}
                        {startDate && endDate && (
                            <div className="bg-surface-light p-4 rounded-lg border border-border">
                                <h3 className="font-semibold text-text-primary mb-3">Leave Summary</h3>
                                <LeaveSummary 
                                    request={{
                                        startDate,
                                        endDate,
                                        startTime,
                                        endTime,
                                        userId: user.id,
                                        leaveType,
                                        payGroup: getPayGroup(user),
                                        reason: '',
                                        status: LeaveStatus.PENDING,
                                        requestedAt: '',
                                        id: ''
                                    }}
                                    users={users}
                                    departments={departments}
                                />
                                
                                {/* Approver and CC Information */}
                                <div className="mt-4 pt-4 border-t border-border">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-sm font-medium text-text-secondary mb-1">Approver(s):</p>
                                            <p className="text-text-primary">
                                                {departmentApprovers.length > 0 
                                                    ? departmentApprovers.map(approver => approver?.name).join(', ')
                                                    : 'No approvers assigned'
                                                }
                                            </p>
                                </div>
                                        <div>
                                            <p className="text-sm font-medium text-text-secondary mb-1">CC Emails:</p>
                                            <p className="text-text-primary">
                                                {departmentCCEmails.length > 0 
                                                    ? departmentCCEmails.join(', ')
                                                    : 'None'
                                                }
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                
                            </div>
                        )}
                    </div>
                    <div>
                        <label htmlFor="reason" className="block text-sm font-medium text-text-secondary mb-1">Reason</label>
                        <textarea id="reason" rows={4} value={reason} onChange={e => setReason(e.target.value)} className="w-full bg-surface-light border-border rounded-md p-2 focus:ring-primary focus:border-primary" placeholder="Please provide a reason for your leave..."></textarea>
                        <button 
                            type="button" 
                            onClick={handleGenerateReason}
                            disabled={isGenerating || !startDate || !endDate}
                            className="mt-2 bg-secondary text-white px-4 py-2 rounded-md hover:bg-secondary-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? 'Generating...' : '✨ Generate with AI'}
                        </button>
                    </div>
                    
                    {/* Supporting Documents Section */}
                    <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                            Supporting Documents
                            {getCurrentLeaveTypeConfig()?.requiresSupportingDocument && (
                                <span className="text-red-500 ml-1">*</span>
                            )}
                        </label>
                        
                        {getCurrentLeaveTypeConfig()?.requiresSupportingDocument && (
                            <p className="text-sm text-text-muted mb-2">
                                Supporting documents are required for {leaveType}
                            </p>
                        )}
                        
                        <div className="border-2 border-dashed border-border rounded-lg p-4">
                            <input
                                type="file"
                                id="attachments"
                                multiple
                                accept="image/*,.pdf"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                            <label
                                htmlFor="attachments"
                                className="cursor-pointer flex flex-col items-center justify-center py-4"
                            >
                                <svg className="w-8 h-8 text-text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                                <span className="text-sm text-text-muted">
                                    Click to upload images or PDF files (max 1MB each, up to 3 files)
                                </span>
                            </label>
                        </div>
                        
                        {/* Display uploaded files */}
                        {attachments.length > 0 && (
                            <div className="mt-3 space-y-2">
                                {attachments.map((file, index) => (
                                    <div key={index} className="flex items-center justify-between bg-surface-light p-2 rounded">
                                        <div className="flex items-center gap-2">
                                            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                            <span className="text-sm text-text-primary">{file.fileName}</span>
                                            <span className="text-xs text-text-muted">
                                                ({formatFileSize(file.fileSize)})
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeAttachment(index)}
                                            className="text-red-500 hover:text-red-700"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    <button 
                        type="submit" 
                        disabled={isSubmitting || isGenerating || cooldownSeconds > 0 || !hasDepartment}
                        className="w-full bg-primary text-white font-bold py-3 px-4 rounded-md hover:bg-primary-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isSubmitting && (
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                            </svg>
                        )}
                        {cooldownSeconds > 0 && (
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.31-8.86c-1.77-.45-2.34-.94-2.34-1.67 0-.84.79-1.43 2.1-1.43 1.38 0 1.9.66 1.94 1.64h1.71c-.05-1.34-.87-2.57-2.49-2.97V5H11.9v1.69c-1.51.32-2.72 1.3-2.72 2.81 0 1.79 1.49 2.69 3.66 3.21 1.95.46 2.34 1.15 2.34 1.87 0 .53-.39 1.39-2.1 1.39-1.6 0-2.23-.72-2.32-1.64H8.04c.1 1.7 1.36 2.66 2.86 2.97V19h2.34v-1.67c1.52-.29 2.72-1.16 2.72-2.97-.01-2.2-1.9-2.96-3.65-3.22z"/>
                            </svg>
                        )}
                        {isSubmitting ? 'Submitting...' : cooldownSeconds > 0 ? `Wait ${cooldownSeconds}s` : showNoDepartmentWarning ? 'Department Required' : 'Submit Request'}
                    </button>
                </form>
            </div>
        </div>
    );
};

const HistoryView: React.FC<{ 
    user: User; 
    requests: LeaveRequest[]; 
    users: User[];
    departments: Department[];
    onCancel: (requestId: string) => Promise<void>;
}> = ({ user, requests, users, departments, onCancel }) => {
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [monthFilter, setMonthFilter] = useState<string>('all');
    const [yearFilter, setYearFilter] = useState<string>('all');
    const [sortField, setSortField] = useState<'requestedAt' | 'startDate' | 'endDate' | 'days' | 'status' | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    
    const getBranchForUser = (u?: User | null, employeeNumber?: string): string => {
        if (u) return getEffectiveUserBranch(u);
        return legacyEmpNumberBranchPrefix(employeeNumber);
    };

    const getRequestPayGroup = (request: LeaveRequest): string =>
        resolveRequestPayGroup(request, users.find(u => u.id === request.userId));
    
    // Filter requests to show only the current user's own requests
    // All users (including ADMIN) see only their own leave history
    const userRequests = requests.filter(r => {
        // For active users, match by userId
        if (r.userId === user.id) {
            return true;
        }
        // For deleted users, match by employeeNumber if stored in the request
        if (r.employeeNumber && r.employeeNumber === user.employeeNumber) {
            return true;
        }
        return false;
    });
    
    // Toggle row expansion
    const toggleRowExpansion = (requestId: string) => {
        setExpandedRows(prev => {
            const newSet = new Set(prev);
            if (newSet.has(requestId)) {
                newSet.delete(requestId);
            } else {
                newSet.add(requestId);
            }
            return newSet;
        });
    };

    // Get unique years from requests
    const availableYears = Array.from(new Set(
        userRequests.map(r => new Date(r.startDate).getFullYear())
    )).sort((a, b) => b - a);

    const filteredRequests = userRequests.filter(r => {
        const statusMatch = statusFilter === 'all' || r.status === statusFilter;
        
        if (monthFilter === 'all' && yearFilter === 'all') {
            return statusMatch;
        }
        
        const requestDate = new Date(r.startDate);
        const requestMonth = requestDate.getMonth() + 1; // getMonth() returns 0-11
        const requestYear = requestDate.getFullYear();
        
        const monthMatch = monthFilter === 'all' || requestMonth.toString() === monthFilter;
        const yearMatch = yearFilter === 'all' || requestYear.toString() === yearFilter;
        
        return statusMatch && monthMatch && yearMatch;
    });

    // Handle sorting
    const handleSort = (field: 'requestedAt' | 'startDate' | 'endDate' | 'days' | 'status') => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    // Sort filtered requests
    const sortedAndFilteredRequests = useMemo(() => {
        let sorted = [...filteredRequests];
        
        if (sortField) {
            sorted.sort((a, b) => {
                let aValue: any;
                let bValue: any;
                
                switch (sortField) {
                    case 'requestedAt':
                        aValue = new Date(a.requestedAt).getTime();
                        bValue = new Date(b.requestedAt).getTime();
                        break;
                    case 'startDate':
                        aValue = new Date(a.startDate).getTime();
                        bValue = new Date(b.startDate).getTime();
                        break;
                    case 'endDate':
                        aValue = new Date(a.endDate).getTime();
                        bValue = new Date(b.endDate).getTime();
                        break;
                    case 'days':
                        aValue = getLeaveDaysBetween(a.startDate, a.endDate, a.startTime, a.endTime, getPayGroup(user), a.leaveType);
                        bValue = getLeaveDaysBetween(b.startDate, b.endDate, b.startTime, b.endTime, getPayGroup(user), b.leaveType);
                        break;
                    case 'status':
                        aValue = a.status;
                        bValue = b.status;
                        break;
                    default:
                        return 0;
                }
                
                if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            });
        } else {
            // Default sort by requested date (newest first)
            sorted.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
        }
        
        return sorted;
    }, [filteredRequests, sortField, sortDirection]);

    const getUserById = (userId: string) => users.find(u => u.id === userId);

    // Get approver name
    const getApproverName = (request: LeaveRequest): string => {
        if (request.status === LeaveStatus.APPROVED && request.approvedBy) {
            return getUserById(request.approvedBy)?.name || 'Unknown';
        }
        if (request.status === LeaveStatus.REJECTED && request.rejectedBy) {
            return getUserById(request.rejectedBy)?.name || 'Unknown';
        }
        return '-';
    };
    
    return (
      <div className="animate-fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold">Leave History</h1>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
                    {/* Filters */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto">
                        {/* Status Filter */}
                        <div className="flex items-center gap-2">
                            <label htmlFor="statusFilter" className="text-xs sm:text-sm font-medium text-text-secondary">
                                Status:
                            </label>
                            <select
                                id="statusFilter"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="bg-surface-light border border-border rounded-md px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-text-primary focus:ring-primary focus:border-primary"
                            >
                                <option value="all">All Status</option>
                                <option value={LeaveStatus.PENDING}>Pending</option>
                                <option value={LeaveStatus.CANCELLATION_PENDING}>Cancellation Pending</option>
                                <option value={LeaveStatus.APPROVED}>Approved</option>
                                <option value={LeaveStatus.REJECTED}>Rejected</option>
                                <option value={LeaveStatus.CANCELLED}>Cancelled</option>
                            </select>
                        </div>
                        
                        {/* Month Filter */}
                        <div className="flex items-center gap-2">
                            <label htmlFor="monthFilter" className="text-xs sm:text-sm font-medium text-text-secondary">
                                Month:
                            </label>
                            <select
                                id="monthFilter"
                                value={monthFilter}
                                onChange={(e) => setMonthFilter(e.target.value)}
                                className="bg-surface-light border border-border rounded-md px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-text-primary focus:ring-primary focus:border-primary"
                            >
                                <option value="all">All Months</option>
                                <option value="1">January</option>
                                <option value="2">February</option>
                                <option value="3">March</option>
                                <option value="4">April</option>
                                <option value="5">May</option>
                                <option value="6">June</option>
                                <option value="7">July</option>
                                <option value="8">August</option>
                                <option value="9">September</option>
                                <option value="10">October</option>
                                <option value="11">November</option>
                                <option value="12">December</option>
                            </select>
                        </div>
                        
                        {/* Year Filter */}
                        <div className="flex items-center gap-2">
                            <label htmlFor="yearFilter" className="text-xs sm:text-sm font-medium text-text-secondary">
                                Year:
                            </label>
                            <select
                                id="yearFilter"
                                value={yearFilter}
                                onChange={(e) => setYearFilter(e.target.value)}
                                className="bg-surface-light border border-border rounded-md px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-text-primary focus:ring-primary focus:border-primary"
                            >
                                <option value="all">All Years</option>
                                {availableYears.map(year => (
                                    <option key={year} value={year.toString()}>{year}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                        {/* Export Button */}
                        <button 
                            onClick={() => exportApprovedLeaveRequests(requests, users, departments, monthFilter, yearFilter, undefined, user.id)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                            title="Export your approved leave requests for the selected month/year"
                        >
                            <span className="hidden sm:inline">📄</span>
                            <span>Export</span>
                        </button>
                        
                    </div>
                </div>
            </div>

            {/* Desktop Table / Mobile Card Design */}
            {sortedAndFilteredRequests.length > 0 ? (
                <>
                    {/* Desktop Table View */}
                    <div className="hidden md:block bg-surface rounded-lg shadow-lg border border-border overflow-hidden">
                        <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
                            <table className="w-full min-w-[640px]">
                            <thead className="bg-surface-light">
                                <tr>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                                        <button
                                            onClick={() => handleSort('requestedAt')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors"
                                        >
                                            Submitted
                                            {sortField === 'requestedAt' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Leave type</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                                        <button
                                            onClick={() => handleSort('startDate')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors"
                                        >
                                            From
                                            {sortField === 'startDate' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                                        <button
                                            onClick={() => handleSort('endDate')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors"
                                        >
                                            To
                                            {sortField === 'endDate' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                                        <button
                                            onClick={() => handleSort('days')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors"
                                        >
                                            Days
                                            {sortField === 'days' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                                        <button
                                            onClick={() => handleSort('status')}
                                            className="flex items-center gap-1 hover:text-primary transition-colors"
                                        >
                                            Status
                                            {sortField === 'status' && (
                                                <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                                            )}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Reason</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Approver</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedAndFilteredRequests.map(r => {
                                    const workingDays = getLeaveDaysBetween(r.startDate, r.endDate, r.startTime, r.endTime, getPayGroup(user), r.leaveType);
                                    const approverName = getApproverName(r);
                                    
                                    return (
                                        <React.Fragment key={r.id}>
                                        <tr className={`border-b border-border last:border-b-0 hover:bg-surface-light transition-colors ${getLeaveTypeAccentClass(r.leaveType)}`}>
                                            <td className="px-4 py-3 text-text-primary text-xs">
                                                <div className="font-medium">{formatSubmissionDateTime(r.requestedAt, r.requestedAtTime)}</div>
                                            </td>
                                            <td className="px-4 py-3 text-text-primary">{r.leaveType}</td>
                                            <td className="px-4 py-3 text-text-primary">{formatTableDate(r.startDate)}</td>
                                            <td className="px-4 py-3 text-text-primary">{formatTableDate(r.endDate)}</td>
                                            <td className="px-4 py-3 text-text-primary">{workingDays}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                                                    r.status === LeaveStatus.APPROVED ? 'bg-green-100 text-green-800' :
                                                    r.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-800' :
                                                    r.status === LeaveStatus.PENDING ? 'bg-yellow-100 text-yellow-800' :
                                                    r.status === LeaveStatus.CANCELLATION_PENDING ? 'bg-orange-100 text-orange-800' :
                                                    r.status === LeaveStatus.CANCELLED ? 'bg-gray-100 text-gray-800' :
                                                    'bg-blue-100 text-blue-800'
                                                }`}>
                                                    {r.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-text-primary">{r.reason}</td>
                                            <td className="px-4 py-3 text-text-primary">{approverName}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => toggleRowExpansion(r.id)}
                                                        className="text-primary hover:text-primary/80 transition-colors"
                                                        title={expandedRows.has(r.id) ? 'Collapse Summary' : 'Expand Summary'}
                                                    >
                                                        {expandedRows.has(r.id) ? (
                                                            <ChevronUpIcon className="w-5 h-5" />
                                                        ) : (
                                                            <ChevronDownIcon className="w-5 h-5" />
                                                        )}
                                                    </button>
                                                    {(r.status === LeaveStatus.PENDING || r.status === LeaveStatus.APPROVED) && (
                                                        <>
                                                            <button
                                                                onClick={async () => {
                                                                    if (r.status === LeaveStatus.APPROVED) {
                                                                        const confirmed = confirm('Cancelling this approved leave requires approval from your approver. Continue?');
                                                                        if (!confirmed) return;
                                                                    }
                                                                    await onCancel(r.id);
                                                                }}
                                                                className="text-red-600 hover:text-red-800 transition-colors"
                                                                title={r.status === LeaveStatus.APPROVED ? 'Request Cancellation' : 'Cancel Request'}
                                                            >
                                                                <TrashIcon className="w-5 h-5" />
                                                            </button>
                                                        </>
                                                    )}
                                                    {r.status === LeaveStatus.CANCELLATION_PENDING && (
                                                        <span className="text-xs text-orange-600 font-medium">Cancellation Pending Approval</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                        {expandedRows.has(r.id) && (
                                            <tr className="bg-surface-light">
                                                <td colSpan={8} className="px-4 py-4">
                                                    <LeaveSummary 
                                                        request={r}
                                                        users={users}
                                                        departments={departments}
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-4">
                        {sortedAndFilteredRequests.map(r => {
                            const workingDays = getLeaveDaysBetween(r.startDate, r.endDate, r.startTime, r.endTime, getPayGroup(user), r.leaveType);
                            const approverName = getApproverName(r);
                            
                            return (
                                <div key={r.id} className={`bg-surface rounded-lg shadow-lg border border-border p-4 ${getLeaveTypeAccentClass(r.leaveType)}`}>
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="font-semibold text-text-primary">{r.leaveType}</span>
                                                <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                                                    r.status === LeaveStatus.APPROVED ? 'bg-green-100 text-green-800' :
                                                    r.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-800' :
                                                    r.status === LeaveStatus.PENDING ? 'bg-yellow-100 text-yellow-800' :
                                                    r.status === LeaveStatus.CANCELLATION_PENDING ? 'bg-orange-100 text-orange-800' :
                                                    r.status === LeaveStatus.CANCELLED ? 'bg-gray-100 text-gray-800' :
                                                    'bg-blue-100 text-blue-800'
                                                }`}>
                                                    {r.status}
                                                </span>
                                            </div>
                                            <div className="space-y-1 text-sm">
                                                <div className="text-text-primary">
                                                    <span className="text-text-muted">From: </span>
                                                    {formatTableDate(r.startDate)}
                                                </div>
                                                <div className="text-text-primary">
                                                    <span className="text-text-muted">To: </span>
                                                    {formatTableDate(r.endDate)}
                                                </div>
                                                <div className="text-text-primary">
                                                    <span className="text-text-muted">Days: </span>
                                                    {workingDays}
                                                </div>
                                                {approverName !== '-' && (
                                                    <div className="text-text-primary">
                                                        <span className="text-text-muted">Approver: </span>
                                                        {approverName}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2 ml-2">
                                            <button
                                                onClick={() => toggleRowExpansion(r.id)}
                                                className="text-primary hover:text-primary/80 transition-colors p-1"
                                                title={expandedRows.has(r.id) ? 'Collapse Summary' : 'Expand Summary'}
                                            >
                                                {expandedRows.has(r.id) ? (
                                                    <ChevronUpIcon className="w-5 h-5" />
                                                ) : (
                                                    <ChevronDownIcon className="w-5 h-5" />
                                                )}
                                            </button>
                                            {(r.status === LeaveStatus.PENDING || r.status === LeaveStatus.APPROVED) && (
                                                <button
                                                    onClick={async () => {
                                                        if (r.status === LeaveStatus.APPROVED) {
                                                            const confirmed = confirm('Cancelling this approved leave will credit the days back to your balance. Continue?');
                                                            if (!confirmed) return;
                                                        }
                                                        await onCancel(r.id);
                                                    }}
                                                    className="text-red-600 hover:text-red-800 transition-colors p-1"
                                                    title={r.status === LeaveStatus.APPROVED ? 'Cancel Approved Leave' : 'Cancel Request'}
                                                >
                                                    <TrashIcon className="w-5 h-5" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-sm text-text-primary mb-2">
                                        <span className="text-text-muted">Reason: </span>
                                        {r.reason || 'N/A'}
                                    </div>
                                    {expandedRows.has(r.id) && (
                                        <div className="mt-3 pt-3 border-t border-border">
                                            <LeaveSummary 
                                                request={r}
                                                users={users}
                                                departments={departments}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : (
                <div className="bg-surface rounded-lg shadow-lg border border-border p-12 text-center">
                    <div className="text-6xl mb-4">📋</div>
                    <p className="text-text-primary text-lg font-medium mb-2">
                        {(() => {
                            const hasFilters = statusFilter !== 'all' || monthFilter !== 'all' || yearFilter !== 'all';
                            if (!hasFilters) return 'No leave requests yet';
                            
                            const filterParts = [];
                            if (statusFilter !== 'all') filterParts.push(statusFilter.toLowerCase());
                            if (monthFilter !== 'all') {
                                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                                                  'July', 'August', 'September', 'October', 'November', 'December'];
                                filterParts.push(monthNames[parseInt(monthFilter) - 1]);
                            }
                            if (yearFilter !== 'all') filterParts.push(yearFilter);
                            
                            return `No requests found for ${filterParts.join(' ')}`;
                        })()}
                    </p>
                    <p className="text-text-muted">
                        {(() => {
                            const hasFilters = statusFilter !== 'all' || monthFilter !== 'all' || yearFilter !== 'all';
                            if (!hasFilters) return 'Your leave history will appear here once you submit requests.';
                            return 'Try adjusting the filters to see other requests.';
                        })()}
                    </p>
                </div>
            )}
        </div>
    );
};

const ApprovalsView: React.FC<{ 
    user: User; 
    requests: LeaveRequest[]; 
    users: User[];
    departments: Department[];
    onApprove: (requestId: string, comments?: string) => void;
    onReject: (requestId: string, rejectionReason: string, comments?: string) => void;
}> = ({ user, requests, users, departments, onApprove, onReject }) => {
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [monthFilter, setMonthFilter] = useState<string>('all');
    const [yearFilter, setYearFilter] = useState<string>('all');
    const [employeeNumberFilter, setEmployeeNumberFilter] = useState<string>('');
    const [employeeNameFilter, setEmployeeNameFilter] = useState<string>('');
    const [rejectionModal, setRejectionModal] = useState<{
        isOpen: boolean;
        requestId: string;
        requesterName: string;
    }>({
        isOpen: false,
        requestId: '',
        requesterName: ''
    });
    
    const [rejectionReason, setRejectionReason] = useState('');
    const [comments, setComments] = useState('');
    const [approvalSortField, setApprovalSortField] = useState<'requestedAt' | 'employeeNumber' | 'employeeName' | 'startDate' | 'endDate' | 'days' | 'status' | null>(null);
    const [approvalSortDirection, setApprovalSortDirection] = useState<'asc' | 'desc'>('desc');
    const [expandedApprovalRows, setExpandedApprovalRows] = useState<Set<string>>(new Set());

    // Render only the appropriate list (desktop vs mobile) instead of both via CSS.
    // Halves the React element / DOM tree on every render of ApprovalsView.
    const isDesktop = useMediaQuery('(min-width: 768px)');

    // O(1) lookup tables for users and departments. Without these, every row's
    // getRequesterInfo / departments.find was a linear scan over all users (1000+) /
    // departments (250+), summing to ~1.8 M comparisons per render in this codebase.
    const usersById = useMemo(() => {
        const m = new Map<string, User>();
        for (const u of users) m.set(u.id, u);
        return m;
    }, [users]);
    const departmentsById = useMemo(() => {
        const m = new Map<string, Department>();
        for (const d of departments) m.set(d.id, d);
        return m;
    }, [departments]);

    const adminManagedDepartmentIds = useMemo(() => {
        if (user.role !== UserRole.ADMIN) return [];
        const ids = new Set<string>();
        if (user.adminDepartments) {
            user.adminDepartments.forEach(id => ids.add(id));
        }
        departments.forEach(dept => {
            if (dept.approverIds?.includes(user.id)) {
                ids.add(dept.id);
            }
        });
        return Array.from(ids);
    }, [user, departments]);

    const handleRejectWithReason = () => {
        if (!rejectionReason.trim()) {
            alert('Please provide a rejection reason');
            return;
        }
        
        onReject(rejectionModal.requestId, rejectionReason, comments);
        setRejectionModal({ isOpen: false, requestId: '', requesterName: '' });
        setRejectionReason('');
        setComments('');
    };

    const getUserById = (userId: string) => usersById.get(userId);

    // Helper function to get requester info (works for both active and deleted users)
    const getRequesterInfo = (request: LeaveRequest) => {
        const requester = getUserById(request.userId);
        return {
            requester,
            requesterName: requester?.name || request.requesterName || 'Unknown User',
            requesterEmployeeNumber: requester?.employeeNumber || request.employeeNumber || 'N/A',
            requesterDepartmentId: requester?.departmentId || request.requesterDepartmentId,
            isDeletedUser: !requester
        };
    };

    const getRequestPayGroup = (request: LeaveRequest): string =>
        resolveRequestPayGroup(request, getRequesterInfo(request).requester);
    
    // Helper: effective branch for a user profile (or legacy emp-number prefix for deleted users)
    const getBranchForUser = (u?: User | null, employeeNumber?: string): string => {
        if (u) return getEffectiveUserBranch(u);
        return legacyEmpNumberBranchPrefix(employeeNumber);
    };
    
    // Get the current user's assigned branches (for Admin role) or own branch
    const userAssignedBranches = user.role === UserRole.ADMIN && user.branches && user.branches.length > 0
        ? user.branches
        : user.role === UserRole.ADMIN
        ? (() => {
            const own = getEffectiveUserBranch(user);
            return own ? [own] : [];
          })()
        : [];
    
    // Get requests that need approval from this user
    // Get departments that this user can approve for (for display purposes)
    const userDepartments = (() => {
        if (user.role === UserRole.SUPER_ADMIN) {
            return departments;
        } else if (user.role === UserRole.ADMIN) {
            if (adminManagedDepartmentIds.length === 0) {
                return [];
            }
            return departments.filter(d => adminManagedDepartmentIds.includes(d.id));
        } else if (user.role === UserRole.NORMAL) {
            return departments.filter(d => d.approverIds?.includes(user.id));
        }
        return [];
    })();
    
    const approvableRequests = useMemo(() => {
        return requests.filter(r => {
            // Show PENDING, APPROVED, CANCELLATION_PENDING, and CANCELLED (approved cancellations) requests
            const isPending = r.status === LeaveStatus.PENDING;
            const isApproved = r.status === LeaveStatus.APPROVED;
            const isCancellationPending = r.status === LeaveStatus.CANCELLATION_PENDING;
            const isApprovedCancellation = r.status === LeaveStatus.CANCELLED && r.cancellationApprovedBy; // Cancelled through approval workflow

            if (!isPending && !isApproved && !isCancellationPending && !isApprovedCancellation) {
                return false;
            }

            // Own requests: hide actionable items (cannot self-approve), but keep informational approved/cancelled records visible.
            if (r.userId === user.id) {
                return !isPending && !isCancellationPending;
            }

            // Get requester info - use stored info if user is deleted, otherwise get from users array
            const requesterInfo = getRequesterInfo(r);
            const requesterDepartmentId = requesterInfo.requesterDepartmentId;
            const isDeletedUser = requesterInfo.isDeletedUser;

            // For SUPER_ADMIN, show all requests (including from deleted users, even without department info)
            if (user.role === UserRole.SUPER_ADMIN) {
                return true;
            }

            // For deleted users without department info, only SUPER_ADMIN can see them
            if (isDeletedUser && !requesterDepartmentId) {
                return false;
            }

            // For ADMIN role, filter by assigned departments (adminDepartments) OR if they are approvers
            if (user.role === UserRole.ADMIN) {
                if (!requesterDepartmentId) {
                    return false;
                }

                const isAdminDept = adminManagedDepartmentIds.length > 0 && adminManagedDepartmentIds.includes(requesterDepartmentId);

                const requesterDepartment = departmentsById.get(requesterDepartmentId);
                const isDeptApprover = requesterDepartment?.approverIds?.includes(user.id) || false;

                return isAdminDept || isDeptApprover;
            }

            // For NORMAL role: check if user is assigned as approver in the requester's department
            if (!requesterDepartmentId) {
                return false;
            }
            const requesterDepartment = departmentsById.get(requesterDepartmentId);
            return requesterDepartment?.approverIds?.includes(user.id) || false;
        }).sort((a, b) => {
            // Sort by priority: CANCELLATION_PENDING > PENDING > APPROVED > CANCELLED
            const statusPriority = {
                [LeaveStatus.CANCELLATION_PENDING]: 1,
                [LeaveStatus.PENDING]: 2,
                [LeaveStatus.APPROVED]: 3,
                [LeaveStatus.CANCELLED]: 4
            };
            const aPriority = statusPriority[a.status] || 5;
            const bPriority = statusPriority[b.status] || 5;

            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }

            // If same status, sort by date
            if (a.status === LeaveStatus.CANCELLED && b.status === LeaveStatus.CANCELLED) {
                const aDate = a.cancellationApprovedAt ? new Date(a.cancellationApprovedAt).getTime() : 0;
                const bDate = b.cancellationApprovedAt ? new Date(b.cancellationApprovedAt).getTime() : 0;
                return bDate - aDate;
            }
            if (a.status === LeaveStatus.APPROVED && b.status === LeaveStatus.APPROVED) {
                const aDate = a.approvedAt ? new Date(a.approvedAt).getTime() : 0;
                const bDate = b.approvedAt ? new Date(b.approvedAt).getTime() : 0;
                return bDate - aDate;
            }
            return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
        });
    }, [requests, usersById, departmentsById, adminManagedDepartmentIds, user.id, user.role]);

    // Get unique years from approvable requests
    const availableYears = useMemo(() => Array.from(new Set(
        approvableRequests.map(r => new Date(r.startDate).getFullYear())
    )).sort((a, b) => b - a), [approvableRequests]);

    const filteredApprovalRequests = useMemo(() => {
        return approvableRequests.filter(r => {
            const statusMatch = statusFilter === 'all' || r.status === statusFilter;

            const requesterInfo = getRequesterInfo(r);
            const requesterEmployeeNumber = requesterInfo.requesterEmployeeNumber.toLowerCase();
            const requesterName = requesterInfo.requesterName.toLowerCase();

            const employeeNumberMatch = !employeeNumberFilter || requesterEmployeeNumber.includes(employeeNumberFilter.toLowerCase());
            const employeeNameMatch = !employeeNameFilter || requesterName.includes(employeeNameFilter.toLowerCase());

            if (monthFilter === 'all' && yearFilter === 'all') {
                return statusMatch && employeeNumberMatch && employeeNameMatch;
            }

            const requestDate = new Date(r.startDate);
            const requestMonth = requestDate.getMonth() + 1;
            const requestYear = requestDate.getFullYear();

            const monthMatch = monthFilter === 'all' || requestMonth.toString() === monthFilter;
            const yearMatch = yearFilter === 'all' || requestYear.toString() === yearFilter;

            return statusMatch && monthMatch && yearMatch && employeeNumberMatch && employeeNameMatch;
        });
    }, [approvableRequests, usersById, statusFilter, monthFilter, yearFilter, employeeNumberFilter, employeeNameFilter]);

    const toggleApprovalRowExpansion = (requestId: string) => {
        setExpandedApprovalRows(prev => {
            const newSet = new Set(prev);
            if (newSet.has(requestId)) {
                newSet.delete(requestId);
            } else {
                newSet.add(requestId);
            }
            return newSet;
        });
    };

    const handleApprovalSort = (field: 'requestedAt' | 'employeeNumber' | 'employeeName' | 'startDate' | 'endDate' | 'days' | 'status') => {
        if (approvalSortField === field) {
            setApprovalSortDirection(approvalSortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setApprovalSortField(field);
            setApprovalSortDirection('asc');
        }
    };
    
    const sortedApprovalRequests = useMemo(() => {
        const sorted = [...filteredApprovalRequests];
        sorted.sort((a, b) => {
            if (!approvalSortField) {
                return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
            }
            const requesterInfoA = getRequesterInfo(a);
            const requesterInfoB = getRequesterInfo(b);
            let aValue: any;
            let bValue: any;
            
            switch (approvalSortField) {
                case 'requestedAt':
                    aValue = new Date(a.requestedAt).getTime();
                    bValue = new Date(b.requestedAt).getTime();
                    break;
                case 'employeeNumber':
                    aValue = requesterInfoA.requesterEmployeeNumber;
                    bValue = requesterInfoB.requesterEmployeeNumber;
                    break;
                case 'employeeName':
                    aValue = requesterInfoA.requesterName;
                    bValue = requesterInfoB.requesterName;
                    break;
                case 'startDate':
                    aValue = new Date(a.startDate).getTime();
                    bValue = new Date(b.startDate).getTime();
                    break;
                case 'endDate':
                    aValue = new Date(a.endDate).getTime();
                    bValue = new Date(b.endDate).getTime();
                    break;
                case 'days':
                    aValue = getLeaveDaysBetween(a.startDate, a.endDate, a.startTime, a.endTime, getRequestPayGroup(a), a.leaveType);
                    bValue = getLeaveDaysBetween(b.startDate, b.endDate, b.startTime, b.endTime, getRequestPayGroup(b), b.leaveType);
                    break;
                case 'status':
                    aValue = a.status;
                    bValue = b.status;
                    break;
                default:
                    aValue = 0;
                    bValue = 0;
            }
            
            if (aValue < bValue) return approvalSortDirection === 'asc' ? -1 : 1;
            if (aValue > bValue) return approvalSortDirection === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [filteredApprovalRequests, approvalSortField, approvalSortDirection, users]);

    // Pending request count (including cancellation pending)
    const pendingCount = approvableRequests.filter(r => r.status === LeaveStatus.PENDING || r.status === LeaveStatus.CANCELLATION_PENDING).length;

    return (
        <div className="animate-fade-in">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Approval Requests</h1>
                    {pendingCount > 0 && (
                        <p className="text-sm sm:text-base text-text-secondary mt-2">
                            <span className="font-semibold text-primary">{pendingCount}</span> pending request{pendingCount !== 1 ? 's' : ''} awaiting your approval
                        </p>
                    )}
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
                    {/* Filters */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto">
                        {/* Status Filter */}
                        <div className="flex items-center gap-2">
                            <label htmlFor="approvalStatusFilter" className="text-sm font-medium text-text-secondary whitespace-nowrap">
                                Status:
                            </label>
                            <select
                                id="approvalStatusFilter"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary min-w-[120px]"
                            >
                                <option value="all">All Status</option>
                                <option value={LeaveStatus.PENDING}>Pending</option>
                                <option value={LeaveStatus.CANCELLATION_PENDING}>Cancellation Pending</option>
                                <option value={LeaveStatus.APPROVED}>Approved</option>
                                <option value={LeaveStatus.REJECTED}>Rejected</option>
                                <option value={LeaveStatus.CANCELLED}>Cancelled</option>
                            </select>
                            </div>
                        
                        {/* Month Filter */}
                        <div className="flex items-center gap-2">
                            <label htmlFor="approvalMonthFilter" className="text-sm font-medium text-text-secondary whitespace-nowrap">
                                Month:
                            </label>
                            <select 
                                id="approvalMonthFilter"
                                value={monthFilter}
                                onChange={(e) => setMonthFilter(e.target.value)}
                                className="bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary min-w-[130px]"
                            >
                                <option value="all">All Months</option>
                                <option value="1">January</option>
                                <option value="2">February</option>
                                <option value="3">March</option>
                                <option value="4">April</option>
                                <option value="5">May</option>
                                <option value="6">June</option>
                                <option value="7">July</option>
                                <option value="8">August</option>
                                <option value="9">September</option>
                                <option value="10">October</option>
                                <option value="11">November</option>
                                <option value="12">December</option>
                                            </select>
                                        </div>
                        
                        {/* Year Filter */}
                        <div className="flex items-center gap-2">
                            <label htmlFor="approvalYearFilter" className="text-sm font-medium text-text-secondary whitespace-nowrap">
                                Year:
                            </label>
                            <select 
                                id="approvalYearFilter"
                                value={yearFilter}
                                onChange={(e) => setYearFilter(e.target.value)}
                                className="bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary min-w-[100px]"
                            >
                                <option value="all">All Years</option>
                                {availableYears.map(year => (
                                    <option key={year} value={year.toString()}>{year}</option>
                                                ))}
                                            </select>
                                        </div>
                        
                        {/* Employee Number Filter */}
                        <div className="flex items-center gap-2">
                            <label htmlFor="approvalEmployeeNumberFilter" className="text-sm font-medium text-text-secondary whitespace-nowrap">
                                Emp No:
                            </label>
                            <input
                                type="text"
                                id="approvalEmployeeNumberFilter"
                                value={employeeNumberFilter}
                                onChange={(e) => setEmployeeNumberFilter(e.target.value)}
                                placeholder="Filter..."
                                className="bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary w-32 sm:w-40"
                            />
                        </div>
                        
                        {/* Employee Name Filter */}
                        <div className="flex items-center gap-2">
                            <label htmlFor="approvalEmployeeNameFilter" className="text-sm font-medium text-text-secondary whitespace-nowrap">
                                Name:
                            </label>
                            <input
                                type="text"
                                id="approvalEmployeeNameFilter"
                                value={employeeNameFilter}
                                onChange={(e) => setEmployeeNameFilter(e.target.value)}
                                placeholder="Filter..."
                                className="bg-surface-light border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:ring-primary focus:border-primary w-32 sm:w-40"
                            />
                        </div>
                                        </div>
                    
                    <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                        {/* Export Button */}
                        <button 
                            onClick={() =>
                                exportApprovedLeaveRequests(requests, users, departments, monthFilter, yearFilter, user, undefined, {
                                    statusFilter,
                                    employeeNumberFilter,
                                    employeeNameFilter,
                                    matchApprovalsTable: true
                                })
                            }
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                            title="Export current approval table with applied filters"
                        >
                            <span className="hidden sm:inline">📄</span>
                            <span>Export</span>
                        </button>
                        
                </div>
            </div>
                        </div>
            
            <div>
                {sortedApprovalRequests.length > 0 ? (
                    <>
                        {/* Desktop Table View - rendered only when viewport is md+ */}
                        {isDesktop && (
                        <div className="bg-surface rounded-lg shadow-lg border border-border overflow-hidden">
                            <div className="overflow-x-auto -webkit-overflow-scrolling-touch relative">
                                <table className="w-full" style={{ minWidth: 'max-content' }}>
                            <thead className="bg-surface-light">
                                <tr>
                                    <th className="px-3 py-3 text-left text-sm font-semibold text-text-primary whitespace-nowrap">Submitted</th>
                                    <th className="px-3 py-3 text-left text-sm font-semibold text-text-primary whitespace-nowrap w-20">Emp No.</th>
                                    <th className="px-3 py-3 text-left text-sm font-semibold text-text-primary whitespace-nowrap min-w-[150px]">Name</th>
                                    <th className="px-3 py-3 text-left text-sm font-semibold text-text-primary whitespace-nowrap min-w-[100px]">Leave Type</th>
                                    <th className="px-3 py-3 text-left text-sm font-semibold text-text-primary whitespace-nowrap min-w-[120px]">From</th>
                                    <th className="px-3 py-3 text-left text-sm font-semibold text-text-primary whitespace-nowrap min-w-[120px]">To</th>
                                    <th className="px-3 py-3 text-center text-sm font-semibold text-text-primary whitespace-nowrap w-16">Days</th>
                                    <th className="px-3 py-3 text-left text-sm font-semibold text-text-primary whitespace-nowrap min-w-[90px]">Status</th>
                                    <th className="px-3 py-3 text-left text-sm font-semibold text-text-primary whitespace-nowrap min-w-[150px]">Reason</th>
                                    <th className="px-3 py-3 text-left text-sm font-semibold text-text-primary whitespace-nowrap sticky right-0 bg-surface-light z-10 min-w-[200px] shadow-[2px_0_4px_rgba(0,0,0,0.1)]">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedApprovalRequests.map(r => {
                                    const requesterInfo = getRequesterInfo(r);
                                    const requesterName = requesterInfo.requesterName;
                                    const requesterEmployeeNumber = requesterInfo.requesterEmployeeNumber;
                                    const requesterDepartmentId = requesterInfo.requesterDepartmentId;
                                    const isDeletedUser = requesterInfo.isDeletedUser;
                                    const workingDays = getLeaveDaysBetween(r.startDate, r.endDate, r.startTime, r.endTime, getRequestPayGroup(r), r.leaveType);
                                    
                                    return (
                                        <React.Fragment key={r.id}>
                                            <tr className={`border-b border-border last:border-b-0 group ${getLeaveTypeAccentClass(r.leaveType)}`}>
                                                <td className="px-3 py-3 text-text-primary text-sm whitespace-nowrap transition-colors group-hover:bg-surface-light">
                                                    <div className="font-medium">{formatSubmissionDateTime(r.requestedAt, r.requestedAtTime)}</div>
                                                </td>
                                                <td className="px-3 py-3 text-text-primary text-sm whitespace-nowrap transition-colors group-hover:bg-surface-light">
                                                    <div>{requesterEmployeeNumber}</div>
                                                </td>
                                                <td className="px-3 py-3 text-text-primary text-sm transition-colors group-hover:bg-surface-light">
                                                    <div className="font-medium whitespace-nowrap">
                                                        {requesterName}
                                                        {isDeletedUser && <span className="text-xs text-red-400 ml-1">(Deleted)</span>}
                                                    </div>
                                                    <div className="text-xs text-text-muted mt-0.5">{departments.find(d => d.id === requesterDepartmentId)?.name || 'No Department'}</div>
                                                </td>
                                                <td className="px-3 py-3 text-text-primary text-sm whitespace-nowrap transition-colors group-hover:bg-surface-light">{r.leaveType}</td>
                                                <td className="px-3 py-3 text-text-primary text-sm whitespace-nowrap transition-colors group-hover:bg-surface-light">{formatTableDate(r.startDate)} ({r.startTime})</td>
                                                <td className="px-3 py-3 text-text-primary text-sm whitespace-nowrap transition-colors group-hover:bg-surface-light">{formatTableDate(r.endDate)} ({r.endTime})</td>
                                                <td className="px-3 py-3 text-text-primary text-sm text-center whitespace-nowrap transition-colors group-hover:bg-surface-light">{workingDays}</td>
                                                <td className="px-3 py-3 text-sm whitespace-nowrap transition-colors group-hover:bg-surface-light">
                                                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
                                                        r.status === LeaveStatus.APPROVED ? 'bg-green-100 text-green-800' :
                                                        r.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-800' :
                                                        r.status === LeaveStatus.PENDING ? 'bg-yellow-100 text-yellow-800' :
                                                        r.status === LeaveStatus.CANCELLATION_PENDING ? 'bg-orange-100 text-orange-800' :
                                                        r.status === LeaveStatus.CANCELLED ? 'bg-gray-100 text-gray-800' :
                                                        'bg-blue-100 text-blue-800'
                                                    }`}>
                                                        {r.status}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-3 text-text-primary text-sm truncate max-w-[200px] transition-colors group-hover:bg-surface-light" title={r.reason}>{r.reason || 'N/A'}</td>
                                                <td className={`px-3 py-3 text-sm sticky right-0 z-10 whitespace-nowrap shadow-[2px_0_4px_rgba(0,0,0,0.1)] transition-colors group-hover:bg-surface-light ${expandedApprovalRows.has(r.id) ? 'bg-surface-light' : 'bg-surface'}`}>
                                                    <div className="flex items-center gap-1.5 flex-nowrap">
                                                        <button
                                                            onClick={() => toggleApprovalRowExpansion(r.id)}
                                                            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border transition-colors font-medium whitespace-nowrap flex-shrink-0 ${
                                                                expandedApprovalRows.has(r.id)
                                                                    ? 'bg-primary/15 border-primary/50 text-primary'
                                                                    : 'bg-transparent border-border text-text-primary hover:border-primary/50 hover:text-primary'
                                                            }`}
                                                            title={expandedApprovalRows.has(r.id) ? 'Hide details' : 'Show details'}
                                                            aria-expanded={expandedApprovalRows.has(r.id)}
                                                        >
                                                            {expandedApprovalRows.has(r.id) ? 'Hide' : 'Details'}
                                                            {expandedApprovalRows.has(r.id) ? (
                                                                <ChevronUpIcon className="w-3.5 h-3.5" />
                                                            ) : (
                                                                <ChevronDownIcon className="w-3.5 h-3.5" />
                                                            )}
                                                        </button>
                                                        {(r.status === LeaveStatus.PENDING || r.status === LeaveStatus.CANCELLATION_PENDING) && (() => {
                                                            // Check if user can approve this request
                                                            const canApprove = (() => {
                                                                if (user.role === UserRole.SUPER_ADMIN) return true;
                                                                if (user.role === UserRole.NORMAL) {
                                                                    const requesterDepartment = departments.find(d => d.id === requesterDepartmentId);
                                                                    return requesterDepartment?.approverIds?.includes(user.id) || false;
                                                                }
                                                                if (user.role === UserRole.ADMIN) {
                                                                    // Admin can only approve if they are explicitly an approver, not just because they manage the department
                                                                    const requesterDepartment = departments.find(d => d.id === requesterDepartmentId);
                                                                    return requesterDepartment?.approverIds?.includes(user.id) || false;
                                                                }
                                                                return false;
                                                            })();
                                                            
                                                            if (canApprove) {
                                                                return (
                                                                    <>
                                                                        <button
                                                                            onClick={() => onApprove(r.id)}
                                                                            className={`text-white text-xs px-2.5 py-1.5 rounded-md transition-colors font-medium whitespace-nowrap flex-shrink-0 ${
                                                                                r.status === LeaveStatus.CANCELLATION_PENDING 
                                                                                    ? 'bg-orange-600 hover:bg-orange-700' 
                                                                                    : 'bg-green-600 hover:bg-green-700'
                                                                            }`}
                                                                        >
                                                                            {r.status === LeaveStatus.CANCELLATION_PENDING ? 'Approve' : 'Approve'}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => setRejectionModal({
                                                                                isOpen: true,
                                                                                requestId: r.id,
                                                                                requesterName: requesterName
                                                                            })}
                                                                            className="bg-red-600 text-white text-xs px-2.5 py-1.5 rounded-md hover:bg-red-700 transition-colors font-medium whitespace-nowrap flex-shrink-0"
                                                                        >
                                                                            {r.status === LeaveStatus.CANCELLATION_PENDING ? 'Reject' : 'Reject'}
                                                                        </button>
                                                                    </>
                                                                );
                                                            }
                                                            if (user.role === UserRole.ADMIN && !canApprove) {
                                                                return <span className="text-xs text-text-muted italic whitespace-nowrap">View Only</span>;
                                                            }
                                                            return null;
                                                        })()}
                                                        {r.status === LeaveStatus.CANCELLED && r.cancellationApprovedBy && (
                                                            <span className="text-xs text-text-muted italic whitespace-nowrap">Cancellation Approved</span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {expandedApprovalRows.has(r.id) && (
                                                <tr className="bg-surface-light">
                                                    <td colSpan={10} className="px-4 py-4">
                                                        <div className="space-y-4 text-left max-w-2xl">
                                                            <div>
                                                                <p className="text-sm text-text-secondary font-medium mb-2">Reason</p>
                                                                <p className="text-text-primary text-sm">{r.reason}</p>
                                                                <p className="text-xs text-text-muted mt-2">
                                                                    Requested on {formatDate(r.requestedAt)}
                                                                    {r.requestedAtTime && ` at ${new Date(r.requestedAtTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
                                                                </p>
                                                                {r.status === LeaveStatus.REJECTED && r.rejectionReason && (
                                                                    <p className="text-xs text-red-500 mt-2">Rejection Reason: {r.rejectionReason}</p>
                                                                )}
                                                            </div>
                                                            <RequesterLeaveInsight
                                                                request={r}
                                                                requests={requests}
                                                                users={users}
                                                            />
                                                            <LeaveSummary 
                                                                request={r}
                                                                users={users}
                                                                departments={departments}
                                                                showApproverInfo
                                                                requests={requests}
                                                            />
                                                            {r.attachments && r.attachments.length > 0 && (
                                                                <div>
                                                                    <p className="text-sm text-text-secondary font-medium mb-2">Supporting Documents</p>
                                                                    <div className="space-y-1.5">
                                                                        {r.attachments.map((attachment) => (
                                                                            <div key={attachment.id} className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-border hover:border-primary/30 hover:bg-primary/5 transition-colors group">
                                                                                <DocumentTextIcon className="w-4 h-4 text-text-muted flex-shrink-0" />
                                                                                <div className="flex-1 min-w-0">
                                                                                    <p className="text-sm font-medium text-text-primary truncate">{attachment.fileName}</p>
                                                                                    <p className="text-xs text-text-muted">{formatFileSize(attachment.fileSize)} · {formatDate(attachment.uploadedAt)}</p>
                                                                                </div>
                                                                                <button
                                                                                    onClick={() => downloadStoredFile(attachment)}
                                                                                    className="flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/80 active:scale-95 transition-all"
                                                                                >
                                                                                    Download
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                            </table>
                        </div>
                    </div>
                    )}

                    {/* Mobile Card View - rendered only when viewport is below md */}
                    {!isDesktop && (
                    <div className="space-y-4">
                        {sortedApprovalRequests.map(r => {
                            const requesterInfo = getRequesterInfo(r);
                            const requesterName = requesterInfo.requesterName;
                            const requesterEmployeeNumber = requesterInfo.requesterEmployeeNumber;
                            const requesterDepartmentId = requesterInfo.requesterDepartmentId;
                            const isDeletedUser = requesterInfo.isDeletedUser;
                            const workingDays = getLeaveDaysBetween(r.startDate, r.endDate, r.startTime, r.endTime, getRequestPayGroup(r), r.leaveType);
                            
                            return (
                                <div key={r.id} className={`bg-surface rounded-lg shadow-lg border border-border p-4 ${getLeaveTypeAccentClass(r.leaveType)}`}>
                                    <div className="flex justify-between items-start mb-3 gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <span className="text-sm font-semibold text-text-primary break-words">
                                                    {requesterName}
                                                    {isDeletedUser && <span className="text-xs text-red-400 ml-1">(Deleted)</span>}
                                                </span>
                                                <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                                                    r.status === LeaveStatus.APPROVED ? 'bg-green-100 text-green-800' :
                                                    r.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-800' :
                                                    r.status === LeaveStatus.PENDING ? 'bg-yellow-100 text-yellow-800' :
                                                    r.status === LeaveStatus.CANCELLATION_PENDING ? 'bg-orange-100 text-orange-800' :
                                                    r.status === LeaveStatus.CANCELLED ? 'bg-gray-100 text-gray-800' :
                                                    'bg-blue-100 text-blue-800'
                                                }`}>
                                                    {r.status}
                                                </span>
                                            </div>
                                            <div className="text-xs text-text-muted mb-3">
                                                {departments.find(d => d.id === requesterDepartmentId)?.name || 'No Department'}
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                                <div className="text-text-primary">
                                                    <span className="text-text-muted text-xs">Emp No:</span>
                                                    <div className="font-medium mt-0.5">{requesterEmployeeNumber}</div>
                                                </div>
                                                <div className="text-text-primary">
                                                    <span className="text-text-muted text-xs">Days:</span>
                                                    <div className="font-medium mt-0.5">{workingDays}</div>
                                                </div>
                                                <div className="text-text-primary col-span-2">
                                                    <span className="text-text-muted text-xs">Leave Type:</span>
                                                    <div className="font-medium mt-0.5">{r.leaveType}</div>
                                                </div>
                                                <div className="text-text-primary col-span-2">
                                                    <span className="text-text-muted text-xs">From:</span>
                                                    <div className="font-medium mt-0.5">{formatTableDate(r.startDate)} ({r.startTime})</div>
                                                </div>
                                                <div className="text-text-primary col-span-2">
                                                    <span className="text-text-muted text-xs">To:</span>
                                                    <div className="font-medium mt-0.5">{formatTableDate(r.endDate)} ({r.endTime})</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-sm text-text-primary mb-3 pt-3 border-t border-border">
                                        <span className="text-text-muted text-xs block mb-1">Reason:</span>
                                        <div className="break-words">{r.reason || 'N/A'}</div>
                                    </div>
                                    <button
                                        onClick={() => toggleApprovalRowExpansion(r.id)}
                                        className={`w-full inline-flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md border transition-colors font-medium ${
                                            expandedApprovalRows.has(r.id)
                                                ? 'bg-primary/15 border-primary/50 text-primary'
                                                : 'bg-transparent border-border text-text-primary hover:border-primary/50 hover:text-primary'
                                        }`}
                                        aria-expanded={expandedApprovalRows.has(r.id)}
                                    >
                                        {expandedApprovalRows.has(r.id) ? 'Hide details' : 'Details'}
                                        {expandedApprovalRows.has(r.id) ? (
                                            <ChevronUpIcon className="w-4 h-4" />
                                        ) : (
                                            <ChevronDownIcon className="w-4 h-4" />
                                        )}
                                    </button>
                                    {(() => {
                                        // Check if user can approve this request
                                        const canApprove = (() => {
                                            if (user.role === UserRole.SUPER_ADMIN) return true;
                                            if (user.role === UserRole.NORMAL) {
                                                const requesterDepartment = departments.find(d => d.id === requesterDepartmentId);
                                                return requesterDepartment?.approverIds?.includes(user.id) || false;
                                            }
                                            if (user.role === UserRole.ADMIN) {
                                                // Admin can only approve if they are explicitly an approver, not just because they manage the department
                                                const requesterDepartment = departments.find(d => d.id === requesterDepartmentId);
                                                return requesterDepartment?.approverIds?.includes(user.id) || false;
                                            }
                                            return false;
                                        })();
                                        
                                        if ((r.status === LeaveStatus.PENDING || r.status === LeaveStatus.CANCELLATION_PENDING) && canApprove) {
                                            return (
                                                <div className="flex gap-2 mt-3">
                                                    <button
                                                        onClick={() => onApprove(r.id)}
                                                        className={`flex-1 text-white text-sm px-3 py-2 rounded-md transition-colors font-medium whitespace-nowrap ${
                                                            r.status === LeaveStatus.CANCELLATION_PENDING 
                                                                ? 'bg-orange-600 hover:bg-orange-700' 
                                                                : 'bg-green-600 hover:bg-green-700'
                                                        }`}
                                                    >
                                                        {r.status === LeaveStatus.CANCELLATION_PENDING ? 'Approve' : 'Approve'}
                                                    </button>
                                                    <button
                                                        onClick={() => setRejectionModal({
                                                            isOpen: true,
                                                            requestId: r.id,
                                                            requesterName: requesterName
                                                        })}
                                                        className="flex-1 bg-red-600 text-white text-sm px-3 py-2 rounded-md hover:bg-red-700 transition-colors font-medium whitespace-nowrap"
                                                    >
                                                        {r.status === LeaveStatus.CANCELLATION_PENDING ? 'Reject' : 'Reject'}
                                                    </button>
                                                </div>
                                            );
                                        }
                                        
                                        if ((r.status === LeaveStatus.PENDING || r.status === LeaveStatus.CANCELLATION_PENDING) && user.role === UserRole.ADMIN && !canApprove) {
                                            return (
                                                <div className="text-xs text-text-muted italic mt-3">View Only</div>
                                            );
                                        }
                                        
                                        return null;
                                    })()}
                                    {r.status === LeaveStatus.CANCELLED && r.cancellationApprovedBy && (
                                        <div className="text-xs text-text-muted italic mt-2">Cancellation Approved - No action required</div>
                                    )}
                                    {expandedApprovalRows.has(r.id) && (
                                        <div className="mt-3 pt-3 border-t border-border">
                                            <div className="space-y-4 text-left max-w-2xl">
                                                <div>
                                                    <p className="text-sm text-text-secondary font-medium mb-1">Reason</p>
                                                    <p className="text-text-primary text-sm">{r.reason}</p>
                                                    <p className="text-xs text-text-muted mt-1">
                                                        Requested on {formatDate(r.requestedAt)}
                                                        {r.requestedAtTime && ` at ${new Date(r.requestedAtTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
                                                    </p>
                                                    {r.status === LeaveStatus.REJECTED && r.rejectionReason && (
                                                        <p className="text-xs text-red-500 mt-1">Rejection Reason: {r.rejectionReason}</p>
                                                    )}
                                                </div>
                                                <RequesterLeaveInsight
                                                    request={r}
                                                    requests={requests}
                                                    users={users}
                                                />
                                                <LeaveSummary 
                                                    request={r}
                                                    users={users}
                                                    departments={departments}
                                                    showApproverInfo
                                                    requests={requests}
                                                />
                                                {r.attachments && r.attachments.length > 0 && (
                                                    <div>
                                                        <p className="text-sm text-text-secondary font-medium mb-2">Supporting Documents</p>
                                                        <div className="space-y-1.5">
                                                            {r.attachments.map((attachment) => (
                                                                <div key={attachment.id} className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-border hover:border-primary/30 hover:bg-primary/5 transition-colors group">
                                                                    <DocumentTextIcon className="w-4 h-4 text-text-muted flex-shrink-0" />
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-sm font-medium text-text-primary truncate">{attachment.fileName}</p>
                                                                        <p className="text-xs text-text-muted">{formatFileSize(attachment.fileSize)} · {formatDate(attachment.uploadedAt)}</p>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => downloadStoredFile(attachment)}
                                                                        className="flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/80 active:scale-95 transition-all"
                                                                    >
                                                                        Download
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    )}
                </>
                ) : (
                    <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-8 sm:p-12 text-center">
                        <div className="text-4xl sm:text-6xl mb-4">✅</div>
                        <p className="text-text-primary text-base sm:text-lg font-medium mb-2">
                            {(() => {
                                const hasFilters = statusFilter !== 'all' || monthFilter !== 'all' || yearFilter !== 'all' || employeeNumberFilter || employeeNameFilter;
                                if (!hasFilters) return 'No pending approvals';
                                
                                const filterParts = [];
                                if (statusFilter !== 'all') filterParts.push(statusFilter.toLowerCase());
                                if (monthFilter !== 'all') {
                                    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                                                      'July', 'August', 'September', 'October', 'November', 'December'];
                                    filterParts.push(monthNames[parseInt(monthFilter) - 1]);
                                }
                                if (yearFilter !== 'all') filterParts.push(yearFilter);
                                
                                return `No requests found for ${filterParts.join(' ')}`;
                            })()}
                        </p>
                        <p className="text-sm sm:text-base text-text-muted">
                            {(() => {
                                const hasFilters = statusFilter !== 'all' || monthFilter !== 'all' || yearFilter !== 'all';
                                if (!hasFilters) return 'Leave requests requiring your approval will appear here.';
                                return 'Try adjusting the filters to see other requests.';
                            })()}
                        </p>
                    </div>
                )}
            </div>

            {/* Rejection Reason Modal */}
            {rejectionModal.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-surface p-4 sm:p-6 rounded-lg shadow-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <h3 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4">Reject Leave Request</h3>
                        <p className="text-sm sm:text-base text-text-muted mb-4">Rejecting leave request from <strong>{rejectionModal.requesterName}</strong></p>
                        
                        <div className="space-y-4">
                                <div>
                                <label className="block text-sm font-medium text-text-primary mb-2">Rejection Reason *</label>
                                <textarea 
                                    value={rejectionReason}
                                    onChange={(e) => setRejectionReason(e.target.value)}
                                    placeholder="Please provide a reason for rejection..."
                                        className="w-full bg-surface-light border-border rounded-md p-3 text-sm focus:ring-primary focus:border-primary"
                                    rows={3}
                                        required 
                                    />
                                </div>

                                <div>
                                <label className="block text-sm font-medium text-text-primary mb-2">Additional Comments (Optional)</label>
                                <textarea 
                                    value={comments}
                                    onChange={(e) => setComments(e.target.value)}
                                    placeholder="Any additional comments..."
                                        className="w-full bg-surface-light border-border rounded-md p-3 text-sm focus:ring-primary focus:border-primary"
                                    rows={2}
                                    />
                                </div>
                            </div>

                        <div className="flex flex-col sm:flex-row gap-2 mt-6">
                                <button 
                                onClick={handleRejectWithReason}
                                className="flex-1 bg-red-600 text-white font-bold py-2.5 sm:py-3 px-4 rounded-md hover:bg-red-700 transition-colors text-sm sm:text-base"
                                >
                                Reject Request
                                </button>
                                <button 
                                    onClick={() => {
                                    setRejectionModal({ isOpen: false, requestId: '', requesterName: '' });
                                    setRejectionReason('');
                                    setComments('');
                                    }}
                                    className="flex-1 bg-gray-600 text-white font-bold py-2.5 sm:py-3 px-4 rounded-md hover:bg-gray-700 transition-colors text-sm sm:text-base"
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

// --- CALENDAR VIEW COMPONENT ---
const CalendarView: React.FC<{ 
    user: User; 
    requests: LeaveRequest[]; 
    users: User[];
    departments: Department[];
}> = ({ user, requests, users, departments }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [branchFilter, setBranchFilter] = useState<string>('all');
    const [departmentFilter, setDepartmentFilter] = useState<string>('all');
    const [calendarView, setCalendarView] = useState<'month' | 'week'>('month');
    const [expandedDay, setExpandedDay] = useState<string | null>(null);

    const adminManagedDepartmentIds = useMemo(() => {
        if (user.role !== UserRole.ADMIN) return [];
        const ids = new Set<string>();
        if (user.adminDepartments) {
            user.adminDepartments.forEach(id => ids.add(id));
        }
        departments.forEach(dept => {
            if (dept.approverIds?.includes(user.id)) {
                ids.add(dept.id);
            }
        });
        return Array.from(ids);
    }, [user, departments]);

    const getBranchForUser = (u?: User | null, employeeNumber?: string): string => {
        if (u) return getEffectiveUserBranch(u);
        return legacyEmpNumberBranchPrefix(employeeNumber);
    };

    const getRequestPayGroup = (request: LeaveRequest): string =>
        resolveRequestPayGroup(request, users.find(u => u.id === request.userId));

    // Get leave requests for calendar display
    // Calendar shows only approved leave for everyone (including the current user)
    const calendarRequests = requests.filter(r => r.status === LeaveStatus.APPROVED);
    
    // Get available branches based on user role
    // For ADMIN: show branches from their assigned departments
    // For SUPER_ADMIN: show all branches
    // For NORMAL approvers: show branches from departments where they are approvers
    const getAvailableBranches = () => {
        if (user.role === UserRole.SUPER_ADMIN) {
            // Super Admin can see all branches
            return Array.from(
                new Set(
                    departments
                        .filter(dept => dept.branch)
                        .map(dept => dept.branch!)
                )
            ).sort();
        } else if (user.role === UserRole.ADMIN) {
            if (user.branches && user.branches.length > 0) {
                // Admin can see assigned branches
                return user.branches.sort();
            }
            if (adminManagedDepartmentIds.length > 0) {
                return Array.from(
                    new Set(
                        departments
                            .filter(dept => adminManagedDepartmentIds.includes(dept.id) && dept.branch)
                            .map(dept => dept.branch!)
                    )
                ).sort();
            }
            return (() => { const own = getEffectiveUserBranch(user); return own ? [own] : []; })();
        } else {
            // For NORMAL: show branches from departments where they are approvers
            const approverDepartments = departments.filter(dept => dept.approverIds?.includes(user.id));
            const approverBranches = Array.from(
                new Set(
                    approverDepartments
                        .filter(dept => dept.branch)
                        .map(dept => dept.branch!)
                )
            ).sort();
            // If user is an approver, show those branches; otherwise show all
            return approverBranches.length > 0 ? approverBranches : Array.from(
                new Set(
                    departments
                        .filter(dept => dept.branch)
                        .map(dept => dept.branch!)
                )
            ).sort();
        }
    };
    
    const availableBranches = getAvailableBranches();
    
    // Get departments filtered by selected branch and user permissions
    const availableDepartments = (() => {
        let depts = departments.filter(dept => 
            users.some(u => u.departmentId === dept.id)
        );
        
        if (user.role === UserRole.ADMIN) {
            depts = depts.filter(dept => {
                const isAdminDept = user.adminDepartments?.includes(dept.id) ?? false;
                const isDeptApprover = dept.approverIds?.includes(user.id) ?? false;
                return isAdminDept || isDeptApprover;
            });
        } else if (user.role === UserRole.NORMAL) {
            const approverDepts = departments.filter(dept => dept.approverIds?.includes(user.id));
            if (approverDepts.length > 0) {
                depts = approverDepts;
            } else {
                // If not an approver, show no departments (they only see their own leaves)
                depts = [];
            }
        }
        
        // If a specific branch is selected, further filter by that branch
        if (branchFilter !== 'all') {
            depts = depts.filter(dept => 
                dept.branch?.toUpperCase() === branchFilter.toUpperCase()
            );
        }
        
        return depts;
    })();
    
    // Filter by branch first, then department
    // For NORMAL role: show requests from departments where they are approvers
    // For ADMIN role: show requests from departments they manage or where they are approvers
    const filteredRequests = calendarRequests.filter(r => {
        // Get requester info - use stored info if user is deleted, otherwise get from users array
        const requester = users.find(u => u.id === r.userId);
        const requesterDepartmentId = requester?.departmentId || r.requesterDepartmentId;
        const requesterEmployeeNumber = requester?.employeeNumber || r.employeeNumber;
        
        const isSelf = r.userId === user.id;
        
        // Always show the user's own leave entries (even if they lack a department)
        if (isSelf) {
            if (branchFilter !== 'all' && requesterEmployeeNumber) {
                const requesterBranch = getBranchForUser(requester, requesterEmployeeNumber);
                if (requesterBranch !== branchFilter) return false;
            }
            if (departmentFilter !== 'all' && requesterDepartmentId && requesterDepartmentId !== departmentFilter) {
                return false;
            }
            return true;
        }
        
        // For deleted users without stored department info, skip (unless Super Admin)
        if (!requesterDepartmentId && !r.requesterDepartmentId) {
            // Super Admin can see all requests, even from deleted users without department info
            if (user.role === UserRole.SUPER_ADMIN) {
                return true;
            }
            return false;
        }
        
        // For NORMAL role: show requests from departments where they are approvers
        if (user.role === UserRole.NORMAL) {
            const requesterDepartment = departments.find(d => d.id === requesterDepartmentId);
            if (requesterDepartment?.approverIds?.includes(user.id)) {
                // Check branch and department filters
                if (branchFilter !== 'all' && requesterEmployeeNumber) {
                    const requesterBranch = getBranchForUser(requester, requesterEmployeeNumber);
                    if (requesterBranch !== branchFilter) return false;
                }
                if (departmentFilter !== 'all' && requesterDepartmentId !== departmentFilter) {
                    return false;
                }
                return true;
            }
            return false;
        }
        
        if (user.role === UserRole.ADMIN) {
            const requesterDepartment = departments.find(d => d.id === requesterDepartmentId);
            const isAdminDept = user.adminDepartments?.includes(requesterDepartmentId) ?? false;
            const isDeptApprover = requesterDepartment?.approverIds?.includes(user.id) ?? false;
            if (!isAdminDept && !isDeptApprover) return false;
        }
        
        // Filter by branch if specified
        if (branchFilter !== 'all' && requesterEmployeeNumber) {
            const requesterBranch = getBranchForUser(requester, requesterEmployeeNumber);
            if (requesterBranch !== branchFilter) return false;
        }
        
        // Filter by department if specified
        if (departmentFilter !== 'all') {
            if (requesterDepartmentId !== departmentFilter) return false;
        }
        
        return true;
    });
    
    // Reset department filter when branch changes
    const handleBranchChange = (branch: string) => {
        setBranchFilter(branch);
        setDepartmentFilter('all'); // Reset department filter when branch changes
    };

    // Helper function to determine if a day is full day, half day AM, or half day PM
    const getDayType = (date: Date, request: LeaveRequest): 'full' | 'am' | 'pm' => {
        const startDate = new Date(request.startDate);
        const endDate = new Date(request.endDate);
        const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const startDateString = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
        const endDateString = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
        
        // Single day leave
        if (startDateString === endDateString) {
            if (request.startTime === 'AM' && request.endTime === 'PM') {
                return 'full'; // Full day
            } else if (request.startTime === 'AM' && request.endTime === 'AM') {
                return 'am'; // Half day AM
            } else if (request.startTime === 'PM' && request.endTime === 'PM') {
                return 'pm'; // Half day PM
            }
        }
        
        // Multi-day leave
        if (dateString === startDateString) {
            // First day
            if (request.startTime === 'PM') {
                return 'pm'; // Half day PM
            }
        } else if (dateString === endDateString) {
            // Last day
            if (request.endTime === 'AM') {
                return 'am'; // Half day AM
            }
        }
        
        // Middle days or full day
        return 'full';
    };

    // Create a lookup table: date string -> array of leave users with time info
    const createLeaveLookupTable = () => {
        const lookupTable: { [dateString: string]: Array<{ name: string; leaveType: LeaveType; department: string; dayType: 'full' | 'am' | 'pm' }> } = {};
        
        filteredRequests.forEach(request => {
            const requester = users.find(u => u.id === request.userId);
            // Use stored info if user is deleted
            const requesterName = requester?.name || request.requesterName || 'Unknown User';
            const requesterDepartmentId = requester?.departmentId || request.requesterDepartmentId;
            const department = departments.find(d => d.id === requesterDepartmentId);
            
            // Include requests even if user is deleted (use stored info)
            if (requesterName) {
                // Generate only working dates in the leave range (exclude weekends and public holidays)
                const startDate = new Date(request.startDate);
                const endDate = new Date(request.endDate);
                
                for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                    const dateString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    
                    // Skip excluded dates (weekends and public holidays)
                    if (shouldExcludeDateForLeave(request.leaveType, dateString, getRequestPayGroup(request))) {
                        continue;
                    }
                    
                    if (!lookupTable[dateString]) {
                        lookupTable[dateString] = [];
                    }
                    
                    const dayType = getDayType(d, request);
                    
                    lookupTable[dateString].push({
                        name: requesterName,
                        leaveType: request.leaveType,
                        department: department?.name || 'Unknown',
                        dayType: dayType
                    });
                }
            }
        });
        
        return lookupTable;
    };

    const leaveLookupTable = createLeaveLookupTable();

    // Generate calendar days for current month
    const generateCalendarDays = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDate = new Date(firstDay);
        // Start from Monday: getDay() returns 0 (Sunday) to 6 (Saturday)
        // Convert to Monday-based: 0 (Sunday) -> 6, 1 (Monday) -> 0, 2 (Tuesday) -> 1, etc.
        const dayOfWeek = firstDay.getDay();
        const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday is 0, Sunday is 6
        startDate.setDate(startDate.getDate() - daysToSubtract);
        
        const days = [];
        const currentDay = new Date(startDate);
        
        // Generate 42 days (6 weeks)
        for (let i = 0; i < 42; i++) {
            days.push(new Date(currentDay));
            currentDay.setDate(currentDay.getDate() + 1);
        }
        
        return days;
    };

    // Get leave users for a specific date using lookup table
    const getLeaveUsersForDate = (date: Date) => {
        // Use local date to avoid timezone issues
        const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return leaveLookupTable[dateString] || [];
    };

    // Get indicator for day type
    const getDayTypeIndicator = (dayType: 'full' | 'am' | 'pm') => {
        switch (dayType) {
            case 'am':
                return '🌅 AM';
            case 'pm':
                return '🌇 PM';
            case 'full':
            default:
                return '📅';
        }
    };

    // Navigate months
    const navigateMonth = (direction: 'prev' | 'next') => {
        const newDate = new Date(currentDate);
        if (direction === 'prev') {
            newDate.setMonth(newDate.getMonth() - 1);
        } else {
            newDate.setMonth(newDate.getMonth() + 1);
        }
        setCurrentDate(newDate);
    };

    const calendarDays = generateCalendarDays();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Get week days for week view (Monday to Sunday)
    const getWeekDays = () => {
        const startOfWeek = new Date(currentDate);
        const day = startOfWeek.getDay();
        // Calculate days to subtract to get to Monday
        // getDay() returns 0 (Sunday) to 6 (Saturday)
        // Convert to Monday-based: 0 (Sunday) -> 6, 1 (Monday) -> 0, 2 (Tuesday) -> 1, etc.
        const daysToSubtract = day === 0 ? 6 : day - 1;
        startOfWeek.setDate(startOfWeek.getDate() - daysToSubtract);
        
        const days = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);
            days.push(date);
        }
        return days;
    };

    // Navigate weeks
    const navigateWeek = (direction: 'prev' | 'next') => {
        const newDate = new Date(currentDate);
        if (direction === 'prev') {
            newDate.setDate(newDate.getDate() - 7);
        } else {
            newDate.setDate(newDate.getDate() + 7);
        }
        setCurrentDate(newDate);
    };

    // Get leave requests for a specific user and date with day type info
    const getLeaveForUserAndDate = (userId: string, date: Date) => {
        const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        // Use same logic as month view: do not show leave on excluded dates (weekends and public holidays)
        const requestForUser = filteredRequests.find(r => {
            if (r.userId !== userId) return false;
            const startDate = new Date(r.startDate);
            const endDate = new Date(r.endDate);
            const checkDate = new Date(dateString);
            return checkDate >= startDate && checkDate <= endDate;
        });
        if (requestForUser && shouldExcludeDateForLeave(requestForUser.leaveType, dateString, getRequestPayGroup(requestForUser))) {
            return [];
        }

        return filteredRequests
            .filter(r => {
                if (r.userId !== userId) return false;
                const startDate = new Date(r.startDate);
                const endDate = new Date(r.endDate);
                const checkDate = new Date(dateString);
                return checkDate >= startDate && checkDate <= endDate;
            })
            .filter(r => !shouldExcludeDateForLeave(r.leaveType, dateString, getRequestPayGroup(r)))
            .map(r => ({
                ...r,
                dayType: getDayType(date, r)
            }));
    };

    // Get color for leave type
    // Get users to display in week view
    const getUsersForWeekView = () => {
        if (user.role === UserRole.NORMAL) {
            const approverDepartmentIds = departments
                .filter(d => d.approverIds?.includes(user.id))
                .map(d => d.id);

            return users
                .filter(u => {
                    const isSelf = u.id === user.id;

                    if (!isSelf) {
                        if (approverDepartmentIds.length === 0) return false;
                        if (!u.departmentId || !approverDepartmentIds.includes(u.departmentId)) return false;
                    }

                    if (branchFilter !== 'all') {
                        const userBranch = getEffectiveUserBranch(u);
                        if (userBranch !== branchFilter) return false;
                    }

                    if (departmentFilter !== 'all') {
                        if (!u.departmentId || u.departmentId !== departmentFilter) return false;
                    }

                    return true;
                })
                .sort((a, b) => a.name.localeCompare(b.name));
        }

        // ADMIN / SUPER_ADMIN: show users in departments they manage or approve (plus themselves),
        // respecting branch/department filters
        return users
            .filter(u => {
                const isSelf = u.id === user.id;

                if (branchFilter !== 'all') {
                    const userBranch = getEffectiveUserBranch(u);
                    if (userBranch !== branchFilter) return false;
                }

                if (departmentFilter !== 'all') {
                    if (!u.departmentId || u.departmentId !== departmentFilter) return false;
                }

                if (user.role === UserRole.ADMIN) {
                    if (!isSelf) {
                        if (!u.departmentId) return false;
                        const dept = departments.find(d => d.id === u.departmentId);
                        const isAdminDept = user.adminDepartments?.includes(u.departmentId) ?? false;
                        const isDeptApprover = dept?.approverIds?.includes(user.id) ?? false;
                        if (!isAdminDept && !isDeptApprover) return false;
                    }
                }

                return true;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    };

    return (
        <div className="animate-fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold">Leave Calendar</h1>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
                    {/* View Toggle */}
                    <div className="flex items-center gap-1 sm:gap-2 bg-surface-light p-1 rounded-lg w-full sm:w-auto">
                        <button
                            onClick={() => setCalendarView('month')}
                            className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-md text-sm sm:text-base font-medium transition-colors ${
                                calendarView === 'month'
                                    ? 'bg-primary text-white'
                                    : 'text-text-muted hover:text-text-primary'
                            }`}
                        >
                            Month
                        </button>
                        <button
                            onClick={() => setCalendarView('week')}
                            className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-md text-sm sm:text-base font-medium transition-colors ${
                                calendarView === 'week'
                                    ? 'bg-primary text-white'
                                    : 'text-text-muted hover:text-text-primary'
                            }`}
                        >
                            Week
                        </button>
                    </div>
                    {/* Filters - Show for users who can see multiple departments (approvers, admins, super admins) */}
                    {((user.role === UserRole.NORMAL && departments.some(d => d.approverIds?.includes(user.id))) || user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) && (
                        <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto">
                            {/* Branch Filter */}
                            <div className="flex items-center gap-2">
                                <label htmlFor="branchFilter" className="text-xs sm:text-sm font-medium text-text-secondary">
                                    Branch:
                                </label>
                                <select
                                    id="branchFilter"
                                    value={branchFilter}
                                    onChange={(e) => handleBranchChange(e.target.value)}
                                    className="bg-surface-light border border-border rounded-md px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-text-primary focus:ring-primary focus:border-primary"
                                >
                                    <option value="all">All Branches</option>
                                    {availableBranches.map(branch => (
                                        <option key={branch} value={branch}>Branch {branch}</option>
                                    ))}
                                </select>
                            </div>
                            
                            {/* Department Filter */}
                            <div className="flex items-center gap-2">
                                <label htmlFor="departmentFilter" className="text-xs sm:text-sm font-medium text-text-secondary">
                                    Dept:
                                </label>
                                <select
                                    id="departmentFilter"
                                    value={departmentFilter}
                                    onChange={(e) => setDepartmentFilter(e.target.value)}
                                    className="bg-surface-light border border-border rounded-md px-2 sm:px-3 py-1.5 sm:py-2 text-sm text-text-primary focus:ring-primary focus:border-primary"
                                    disabled={branchFilter !== 'all' && availableDepartments.length === 0}
                                >
                                    <option value="all">All Departments</option>
                                    {availableDepartments.map(dept => (
                                        <option key={dept.id} value={dept.id}>{dept.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}
                    
                    {/* Info message for normal users who are not approvers */}
                    {user.role === UserRole.NORMAL && !departments.some(d => d.approverIds?.includes(user.id)) && (
                        <div className="text-xs sm:text-sm text-text-muted italic">
                            Showing your approved leave requests only
                        </div>
                    )}

                    {/* Export Button */}
                    <button 
                        onClick={() => exportApprovedLeaveRequests(requests, users, departments, (currentDate.getMonth() + 1).toString(), currentDate.getFullYear().toString(), user)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                        title="Export approved leave requests for the current month"
                    >
                        <span className="hidden sm:inline">📄</span>
                        <span>Export</span>
                    </button>
                </div>
            </div>

            {/* Calendar Navigation */}
            <div className="flex justify-between items-center mb-4 sm:mb-6 gap-2">
                <button 
                    onClick={() => calendarView === 'month' ? navigateMonth('prev') : navigateWeek('prev')}
                    className="bg-primary hover:bg-primary-dark text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-medium transition-colors"
                >
                    <span className="hidden sm:inline">← </span>Prev
                </button>
                <h2 className="text-lg sm:text-2xl font-semibold text-text-primary text-center flex-1">
                    {calendarView === 'month' 
                        ? `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`
                        : (() => {
                            const weekDays = getWeekDays();
                            const start = weekDays[0];
                            const end = weekDays[6];
                            return `${start.getDate()} ${monthNames[start.getMonth()].substring(0, 3)} ${start.getFullYear()} - ${end.getDate()} ${monthNames[end.getMonth()].substring(0, 3)} ${end.getFullYear()}`;
                        })()
                    }
                </h2>
                <button 
                    onClick={() => calendarView === 'month' ? navigateMonth('next') : navigateWeek('next')}
                    className="bg-primary hover:bg-primary-dark text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-medium transition-colors"
                >
                    Next<span className="hidden sm:inline"> →</span>
                </button>
            </div>

            {/* Week View */}
            {calendarView === 'week' && (
                <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border overflow-hidden">
                    <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
                        <table className="w-full border-collapse min-w-[600px]">
                            <thead>
                                <tr className="bg-surface-light border-b border-border">
                                    <th className="p-2 sm:p-4 text-left font-semibold text-xs sm:text-sm text-text-secondary border-r border-border sticky left-0 bg-surface-light z-10 min-w-[120px] sm:min-w-[200px]">
                                        Team Member
                                    </th>
                                    {getWeekDays().map((day, index) => {
                                        const isToday = day.toDateString() === new Date().toDateString();
                                        const dayString = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
                                        const isHoliday = isPublicHoliday(dayString);
                                        const holidayName = isHoliday ? (getPublicHolidayName(dayString) || 'Public Holiday') : null;
                                        
                                        // Since getWeekDays() returns days starting from Monday, we can use index directly
                                        return (
                                            <th 
                                                key={index}
                                                className={`p-2 sm:p-4 text-center font-semibold text-text-secondary border-r border-border last:border-r-0 min-w-[100px] sm:min-w-[150px] ${
                                                    isToday ? 'bg-primary/20 border-2 border-primary' : ''
                                                }`}
                                            >
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <div className="text-xs sm:text-sm">{dayNames[index].toUpperCase()}</div>
                                                    <div className={`text-sm sm:text-lg font-bold ${isToday ? 'text-primary' : 'text-text-primary'}`}>
                                                        {day.getDate()}
                                                    </div>
                                                    {isHoliday && (
                                                        <span
                                                            className="mt-0.5 inline-flex items-center rounded-full bg-red-100 text-red-700 border border-red-300 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium"
                                                            title={holidayName || 'Public Holiday'}
                                                        >
                                                            PH
                                                        </span>
                                                    )}
                                                </div>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {getUsersForWeekView().map((employee) => {
                                    const employeeDept = departments.find(d => d.id === employee.departmentId);
                                    return (
                                        <tr key={employee.id} className="border-b border-border hover:bg-surface-light/50 transition-colors">
                                            <td className="p-2 sm:p-4 border-r border-border sticky left-0 bg-card-bg z-10">
                                                <div>
                                                    <div className="font-medium text-xs sm:text-sm text-text-primary">{employee.name}</div>
                                                    <div className="text-xs text-text-muted">{employeeDept?.name || 'No Department'}</div>
                                                </div>
                                            </td>
                                            {getWeekDays().map((day, dayIndex) => {
                                                const isToday = day.toDateString() === new Date().toDateString();
                                                const leaves = getLeaveForUserAndDate(employee.id, day);
                                                return (
                                                    <td 
                                                        key={dayIndex}
                                                        className={`p-1 sm:p-2 border-r border-border last:border-r-0 align-top ${
                                                            isToday ? 'bg-primary/10 border-2 border-primary' : ''
                                                        }`}
                                                    >
                                                        <div className="space-y-1">
                                                            {leaves.map((leave, leaveIndex) => {
                                                                const indicator = getDayTypeIndicator(leave.dayType);
                                                                const dayTypeText = leave.dayType === 'full' ? 'Full Day' : leave.dayType === 'am' ? 'Half Day (AM)' : 'Half Day (PM)';
                                                                return (
                                                                    <div
                                                                        key={leaveIndex}
                                                                        className={`text-[10px] sm:text-xs p-1 sm:p-2 rounded border ${getLeaveTypeChipClass(leave.leaveType)}`}
                                                                        title={`${leave.leaveType} - ${dayTypeText}${leave.reason ? ': ' + leave.reason : ''}`}
                                                                    >
                                                                        <div className="font-medium flex items-center gap-1">
                                                                            <span className="text-[8px] sm:text-[10px]">{indicator}</span>
                                                                            <span className="truncate">{leave.leaveType}</span>
                                                                        </div>
                                                                        {leave.reason && (
                                                                            <div className="text-[9px] sm:text-xs mt-1 opacity-90 truncate" title={leave.reason}>
                                                                                {leave.reason}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Month View */}
            {calendarView === 'month' && (
                <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border overflow-hidden">
                {/* Day Headers */}
                <div className="grid grid-cols-7 bg-surface-light border-b border-border">
                    {dayNames.map(day => (
                        <div key={day} className="p-2 sm:p-4 text-center font-semibold text-xs sm:text-sm text-text-secondary border-r border-border last:border-r-0">
                            {day.toUpperCase()}
                    </div>
                    ))}
                </div>

                {/* Calendar Days */}
                <div className="grid grid-cols-7">
                    {calendarDays.map((day, index) => {
                        const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                        const isToday = day.toDateString() === new Date().toDateString();
                        // Simple date string for comparison - use local date to avoid timezone issues
                        const dayString = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
                        const isHoliday = isPublicHoliday(dayString);
                        const holidayName = isHoliday ? (getPublicHolidayName(dayString) || 'Public Holiday') : null;
                        const leaveUsers = getLeaveUsersForDate(day);
                        // Show fewer items on mobile (handled via CSS), but slice for performance
                        const maxVisible = 4;
                        const visibleUsers = leaveUsers.slice(0, maxVisible);
                        const extraCount = leaveUsers.length - visibleUsers.length;
                        
                        return (
                            <div
                                key={index}
                                className={`min-h-[80px] sm:min-h-[120px] p-1 sm:p-2 border-r border-b border-border last:border-r-0 ${
                                    isToday 
                                        ? 'bg-primary/20 border-2 border-primary' 
                                        : isCurrentMonth 
                                            ? 'bg-card-bg' 
                                            : 'bg-surface-light'
                                }`}
                            >
                                {/* Day Number + Public Holiday label */}
                                <div className="flex items-center justify-between gap-1 mb-1 sm:mb-2">
                                    <div className={`text-xs sm:text-sm font-medium ${
                                        isToday 
                                            ? 'text-primary font-bold' 
                                            : isCurrentMonth 
                                                ? 'text-text-primary' 
                                                : 'text-text-muted'
                                    }`}>
                                        {day.getDate()}
                                    </div>
                                    {isHoliday && (
                                        <span className="ml-1 inline-flex items-center rounded-full bg-red-100 text-red-700 border border-red-300 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium truncate"
                                              title={holidayName || 'Public Holiday'}>
                                            PH
                                        </span>
                                    )}
                                </div>
                                
                                {/* Leave Users - Using Lookup Table */}
                                <div className="space-y-0.5 sm:space-y-1">
                                    {visibleUsers.map((user, userIndex) => {
                                        let bgColor = 'bg-emerald-300 text-emerald-900'; // Annual (default)
                                        if (user.leaveType === LeaveType.SICK) {
                                            bgColor = 'bg-pink-300 text-pink-900';
                                        } else if (user.leaveType === LeaveType.MATERNITY) {
                                            bgColor = 'bg-purple-300 text-purple-900';
                                        } else if (user.leaveType === LeaveType.COMPASSIONATE) {
                                            bgColor = 'bg-orange-300 text-orange-900';
                                        } else if (user.leaveType === LeaveType.PATERNITY) {
                                            bgColor = 'bg-blue-300 text-blue-900';
                                        }
                                        
                                        const indicator = getDayTypeIndicator(user.dayType);
                                        
                                        return (
                                            <div
                                                key={`${dayString}-${userIndex}`}
                                                className={`text-[9px] sm:text-[11px] px-1 sm:px-1.5 py-0.5 rounded ${bgColor} flex items-center gap-0.5 sm:gap-1 cursor-pointer`}
                                                onClick={() => setExpandedDay(dayString)}
                                                title={`${user.name} - ${user.leaveType} (${user.department}) - ${user.dayType === 'full' ? 'Full Day' : user.dayType === 'am' ? 'Half Day (AM)' : 'Half Day (PM)'}`}
                                            >
                                                <span className="text-[7px] sm:text-[9px]">{indicator}</span>
                                                <span className="truncate">{user.name}</span>
                                            </div>
                                        );
                                    })}
                                    {extraCount > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setExpandedDay(dayString)}
                                            className="text-[9px] sm:text-[11px] text-primary hover:underline w-full text-left"
                                        >
                                            +{extraCount} more
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            )}

            {/* Expanded Day Details for Month View */}
            {expandedDay && (
                <div className="mt-4 bg-slate-800 rounded-xl shadow-2xl border-2 border-primary/50 p-4 sm:p-6 backdrop-blur-sm">
                    <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-600">
                        <h3 className="text-lg sm:text-xl font-bold text-white">
                            📅 Leave details for {new Date(expandedDay).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </h3>
                        <button
                            type="button"
                            onClick={() => setExpandedDay(null)}
                            className="text-lg text-slate-300 hover:text-white hover:bg-slate-700 rounded-full p-1.5 w-8 h-8 flex items-center justify-center transition-colors"
                            aria-label="Close"
                        >
                            ✕
                        </button>
                    </div>
                    <div className="space-y-3">
                        {getLeaveUsersForDate(new Date(expandedDay)).map((user, idx) => {
                            let bgColor = 'bg-emerald-400 text-emerald-950'; // Annual default - brighter for better visibility
                            if (user.leaveType === LeaveType.SICK) {
                                bgColor = 'bg-pink-400 text-pink-950';
                            } else if (user.leaveType === LeaveType.MATERNITY) {
                                bgColor = 'bg-purple-400 text-purple-950';
                            } else if (user.leaveType === LeaveType.COMPASSIONATE) {
                                bgColor = 'bg-orange-400 text-orange-950';
                            } else if (user.leaveType === LeaveType.PATERNITY) {
                                bgColor = 'bg-blue-400 text-blue-950';
                            }
                            const indicator = getDayTypeIndicator(user.dayType);
                            return (
                                <div
                                    key={`${expandedDay}-detail-${idx}`}
                                    className={`flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 py-3 rounded-lg border-2 shadow-md ${bgColor.replace('bg-', 'border-')} ${bgColor}`}
                                >
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-semibold">{indicator}</span>
                                        <span className="text-sm font-bold">{user.name}</span>
                                        <span className="text-xs font-medium opacity-90">({user.department})</span>
                                    </div>
                                    <span className="text-sm font-bold mt-1 sm:mt-0">{user.leaveType}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Legend */}
            <div className="mt-4 sm:mt-6 bg-card-bg rounded-xl shadow-elegant-lg border border-border p-3 sm:p-4">
                <h3 className="text-base sm:text-lg font-semibold text-text-primary mb-3">Legend</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                    <div>
                        <h4 className="text-sm font-medium text-text-secondary mb-2">Leave Types</h4>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded bg-emerald-300"></div>
                                <span className="text-sm text-text-secondary">Annual Leave</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded bg-pink-300"></div>
                                <span className="text-sm text-text-secondary">Sick Leave</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded bg-purple-300"></div>
                                <span className="text-sm text-text-secondary">Maternity Leave</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded bg-orange-300"></div>
                                <span className="text-sm text-text-secondary">Compassionate Leave</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded bg-blue-300"></div>
                                <span className="text-sm text-text-secondary">Paternity Leave</span>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h4 className="text-sm font-medium text-text-secondary mb-2">Day Type Indicators</h4>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-sm">📅</span>
                                <span className="text-sm text-text-secondary">Full Day (1.0 day)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm">🌅 AM</span>
                                <span className="text-sm text-text-secondary">Half Day Morning (0.5 day)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm">🌇 PM</span>
                                <span className="text-sm text-text-secondary">Half Day Afternoon (0.5 day)</span>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h4 className="text-sm font-medium text-text-secondary mb-2">Calendar Indicators</h4>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 bg-primary/20 border-2 border-primary rounded"></div>
                                <span className="text-sm text-text-secondary">Today</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 bg-surface-light rounded"></div>
                                <span className="text-sm text-text-secondary">Other Month</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 bg-card-bg border border-border rounded"></div>
                                <span className="text-sm text-text-secondary">Current Month</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- AUTHENTICATION COMPONENTS ---
const AuthFormContainer: React.FC<{ title: string, children: React.ReactNode }> = ({ title, children }) => {
    const appVersion = '0.1.0-beta';
    return (
        <div className="min-h-screen flex items-center justify-center bg-background animate-fade-in">
            <div className="w-full max-w-md p-8 space-y-8 bg-surface rounded-xl shadow-lg">
                <div className="text-center">
                    <div className="flex flex-col items-center mb-4">
                        <AppLogo className="h-16 w-auto" />
                    </div>
                    <h2 className="text-3xl font-bold text-text-primary">{title}</h2>
                    <p className="mt-2 text-xs font-medium tracking-[0.15em] uppercase text-text-muted">
                        Harrisons Holdings (Malaysia) Berhad
                    </p>
                </div>
                {children}
                <div className="text-center pt-4">
                    <p className="text-slate-400 text-sm">© 2026 Harrisons Holdings (Malaysia) Berhad | v{appVersion}</p>
                </div>
            </div>
        </div>
    );
};

const LoginView: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isSigningIn, setIsSigningIn] = useState(false);
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [needsBootstrap, setNeedsBootstrap] = useState(false);
    const [checkingBootstrap, setCheckingBootstrap] = useState(true);

    useEffect(() => {
        isUsersCollectionEmpty()
            .then((empty) => setNeedsBootstrap(empty))
            .catch(() => setNeedsBootstrap(false))
            .finally(() => setCheckingBootstrap(false));
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setIsSigningIn(true);
        try {
            await signInUser(email, password);
        } catch (err: any) {
            console.error('Sign-in error:', err);
            let message = 'Failed to sign in.';
            if (err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password' || err?.code === 'auth/user-not-found') {
                message = 'Invalid email or password.';
            } else if (err?.code === 'auth/too-many-requests') {
                message = 'Too many failed attempts. Please try again later.';
            } else if (err?.code === 'auth/operation-not-allowed') {
                message = 'Email/password sign-in is not enabled. Enable it in Firebase Authentication.';
            } else if (err?.message) {
                message = err.message;
            }
            setError(message);
        } finally {
            setIsSigningIn(false);
        }
    };

    const handleBootstrap = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }
        setIsSigningIn(true);
        try {
            await bootstrapSuperAdmin(name, email, password);
            setNeedsBootstrap(false);
        } catch (err: any) {
            setError(err?.message || 'Failed to create administrator account.');
        } finally {
            setIsSigningIn(false);
        }
    };

    const handleForgotPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        if (!email.trim()) {
            setError('Enter your email address first.');
            return;
        }
        setIsSigningIn(true);
        try {
            await sendPasswordResetEmailToUser(email);
            setSuccess('If an account exists for that email, a password reset link has been sent.');
        } catch (err: any) {
            setError(err?.message || 'Failed to send password reset email.');
        } finally {
            setIsSigningIn(false);
        }
    };

    if (checkingBootstrap) {
        return (
            <AuthFormContainer title="LeaveApp">
                <p className="text-center text-text-secondary text-sm">Loading…</p>
            </AuthFormContainer>
        );
    }

    if (needsBootstrap) {
        return (
            <AuthFormContainer title="LeaveApp">
                <form onSubmit={handleBootstrap} className="space-y-4">
                    <p className="text-sm text-text-secondary text-center">
                        Create the first Super Admin account for Harrisons Holdings (Malaysia) Berhad.
                    </p>
                    <input
                        type="text"
                        placeholder="Full name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="w-full bg-surface-light border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                    />
                    <input
                        type="email"
                        placeholder="Email (@harrisons.com.my)"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        className="w-full bg-surface-light border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                    />
                    <input
                        type="password"
                        placeholder="Password (min 6 characters)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        className="w-full bg-surface-light border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                    />
                    <input
                        type="password"
                        placeholder="Confirm password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        className="w-full bg-surface-light border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                    />
                    <button
                        type="submit"
                        disabled={isSigningIn}
                        className="w-full bg-primary text-white font-bold py-3 px-4 rounded-md hover:bg-primary-focus transition-colors disabled:opacity-60"
                    >
                        {isSigningIn ? 'Creating…' : 'Create Super Admin'}
                    </button>
                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                </form>
            </AuthFormContainer>
        );
    }

    return (
        <AuthFormContainer title="LeaveApp">
            {showForgotPassword ? (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                    <p className="text-sm text-text-secondary">
                        Enter your @harrisons.com.my email. Firebase will send a password reset link.
                    </p>
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        className="w-full bg-surface-light border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                    />
                    <button
                        type="submit"
                        disabled={isSigningIn}
                        className="w-full bg-primary text-white font-bold py-3 px-4 rounded-md hover:bg-primary-focus transition-colors disabled:opacity-60"
                    >
                        {isSigningIn ? 'Sending…' : 'Send reset link'}
                    </button>
                    <div className="text-center">
                        <button
                            type="button"
                            onClick={() => {
                                setShowForgotPassword(false);
                                setError('');
                                setSuccess('');
                            }}
                            className="text-primary hover:text-primary-focus text-sm"
                        >
                            Back to sign in
                        </button>
                    </div>
                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                    {success && <p className="text-green-600 text-sm text-center">{success}</p>}
                </form>
            ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                    <p className="text-sm text-text-secondary text-center">
                        Sign in with your @harrisons.com.my email. Accounts are created by your LeaveApp administrator.
                    </p>
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        className="w-full bg-surface-light border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        className="w-full bg-surface-light border-border rounded-md p-3 focus:ring-primary focus:border-primary"
                    />
                    <button
                        type="submit"
                        disabled={isSigningIn}
                        className="w-full bg-primary text-white font-bold py-3 px-4 rounded-md hover:bg-primary-focus transition-colors disabled:opacity-60"
                    >
                        {isSigningIn ? 'Signing in…' : 'Sign In'}
                    </button>
                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                    {success && <p className="text-green-600 text-sm text-center">{success}</p>}
                    <div className="text-center space-y-2 pt-1">
                        <button
                            type="button"
                            onClick={() => {
                                setShowForgotPassword(true);
                                setError('');
                                setSuccess('');
                            }}
                            className="text-primary hover:text-primary-focus text-sm"
                        >
                            Forgot your password?
                        </button>
                        <p className="text-text-muted text-sm">
                            Need an account? Ask your branch LeaveApp administrator to register your email.
                        </p>
                    </div>
                </form>
            )}
        </AuthFormContainer>
    );
};

// --- CONFLICT RESOLUTION MODAL ---
const ConflictResolutionModal: React.FC<{
    isOpen: boolean;
    conflictData: {
        conflictingRequests: LeaveRequest[];
        conflictMessage: string;
        suggestedActions: ReturnType<typeof getSuggestedActions>;
        newRequestData: Omit<LeaveRequest, 'id' | 'status' | 'requestedAt'>;
    } | null;
    onResolve: (action: 'proceed' | 'cancel' | 'cancelExisting') => void;
}> = ({ isOpen, conflictData, onResolve }) => {
    const [isProcessing, setIsProcessing] = React.useState(false);
    
    // Reset processing state when modal closes
    React.useEffect(() => {
        if (!isOpen) {
            setIsProcessing(false);
        }
    }, [isOpen]);
    
    if (!isOpen || !conflictData) return null;

    const handleResolve = async (action: 'proceed' | 'cancel' | 'cancelExisting') => {
        if (isProcessing) return; // Prevent double-clicking
        
        setIsProcessing(true);
        try {
            await onResolve(action);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-surface p-6 rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <h3 className="text-xl font-bold mb-4 text-yellow-600">⚠️ Conflicting Leave Requests</h3>
                
                <div className="mb-4">
                    <p className="text-text-primary mb-2">{conflictData.conflictMessage}</p>
                    
                    <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200 mb-4">
                        <h4 className="font-semibold text-yellow-800 mb-2">Conflicting Requests:</h4>
                        <pre className="text-sm text-yellow-700 whitespace-pre-wrap font-mono">
                            {formatConflictingRequests(conflictData.conflictingRequests)}
                        </pre>
                    </div>
                    
                    {conflictData.suggestedActions.message && (
                        <p className="text-text-secondary mb-4">
                            <strong>Suggestion:</strong> {conflictData.suggestedActions.message}
                        </p>
                    )}
                </div>
                
                <div className="flex flex-wrap gap-2">
                    <button 
                        onClick={() => handleResolve('proceed')}
                        disabled={isProcessing}
                        className={`px-4 py-2 rounded-md transition-colors flex items-center gap-2 ${
                            isProcessing 
                                ? 'bg-gray-400 text-gray-700 cursor-not-allowed' 
                                : 'bg-orange-600 text-white hover:bg-orange-700'
                        }`}
                    >
                        {isProcessing ? (
                            <>
                                <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full"></div>
                                Processing...
                            </>
                        ) : (
                            'Proceed Anyway'
                        )}
                    </button>
                    {conflictData.suggestedActions.cancellableRequests.length > 0 && (
                        <button 
                            onClick={() => handleResolve('cancelExisting')}
                            disabled={isProcessing}
                            className={`px-4 py-2 rounded-md transition-colors ${
                                isProcessing 
                                    ? 'bg-gray-400 text-gray-700 cursor-not-allowed' 
                                    : 'bg-red-600 text-white hover:bg-red-700'
                            }`}
                        >
                            Cancel Conflicting Request(s)
                        </button>
                    )}
                    
                    <button 
                        onClick={() => handleResolve('cancel')}
                        disabled={isProcessing}
                        className={`px-4 py-2 rounded-md transition-colors ${
                            isProcessing 
                                ? 'bg-gray-400 text-gray-700 cursor-not-allowed' 
                                : 'bg-gray-600 text-white hover:bg-gray-700'
                        }`}
                    >
                        Cancel This Request
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- MAIN APP SHELL ---
const AppShell: React.FC<{
    currentUser: User;
    users: User[];
    departments: Department[];
    departmentsLoaded: boolean;
    leaveRequests: LeaveRequest[];
    leaveRequestsLoaded: boolean;
    branches: Branch[];
    onReloadData: () => void;
    onUpdateCurrentUser: (userId: string) => Promise<void>;
    onLocalUserUpdate: (updatedUser: User) => void;
    onBranchesReload?: () => void;
}> = ({ currentUser, users, departments, departmentsLoaded, leaveRequests, leaveRequestsLoaded, branches, onReloadData, onUpdateCurrentUser, onLocalUserUpdate, onBranchesReload }) => {
    const [activeView, setActiveView] = useState<View>('dashboard');
    const [sidebarMinimized, setSidebarMinimized] = useState(false);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    
    // Initialize public holidays cache on mount - load for current year and next year
    useEffect(() => {
        const loadPublicHolidays = async () => {
            try {
                const currentYear = new Date().getFullYear();
                const nextYear = currentYear + 1;
                
                // Load current year
                const defaultSet = await getDefaultPublicHolidaySet(currentYear);
                if (defaultSet && defaultSet.holidays && Array.isArray(defaultSet.holidays)) {
                    const holidays = defaultSet.holidays.map((h: any) => {
                        if (typeof h === 'string') {
                            return { date: h, name: 'Public Holiday' };
                        }
                        return h;
                    });
                    setPublicHolidaysCache(holidays, currentYear);
                }
                
                // Also pre-load next year to handle future date selections
                try {
                    const nextYearSet = await getDefaultPublicHolidaySet(nextYear);
                    if (nextYearSet && nextYearSet.holidays && Array.isArray(nextYearSet.holidays)) {
                        const nextYearHolidays = nextYearSet.holidays.map((h: any) => {
                            if (typeof h === 'string') {
                                return { date: h, name: 'Public Holiday' };
                            }
                            return h;
                        });
                        setPublicHolidaysCache(nextYearHolidays, nextYear);
                    }
                } catch (nextYearError) {
                    // Silently fail for next year - it might not exist yet
                    console.log(`No default calendar found for ${nextYear}`);
                }
            } catch (error) {
                console.error('Error loading public holidays:', error);
                // Fallback to hardcoded holidays if Firebase fails
            }
        };
        loadPublicHolidays();
    }, []);

    // Handle hash-based routing for email links
    useEffect(() => {
        const handleHashChange = () => {
            const hash = window.location.hash.slice(1); // Remove the '#'
            if (hash && ['dashboard', 'apply', 'history', 'approvals', 'calendar', 'profile', 'users', 'departments', 'branches', 'email-setup', 'leave-type-config', 'employee-upload', 'leave-balance-upload', 'public-holidays', 'changelog', 'statistics', 'tools'].includes(hash)) {
                setActiveView(hash as View);
            }
        };
        
        // Check hash on mount
        handleHashChange();
        
        // Listen for hash changes
        window.addEventListener('hashchange', handleHashChange);
        
        return () => {
            window.removeEventListener('hashchange', handleHashChange);
        };
    }, []);
    
    // Data loading functions for callbacks
    const handleReloadPublicHolidays = async () => {
        try {
            const currentYear = new Date().getFullYear();
            const defaultSet = await getDefaultPublicHolidaySet(currentYear);
            if (defaultSet && defaultSet.holidays && Array.isArray(defaultSet.holidays)) {
                // Handle both old format (string[]) and new format (PublicHoliday[])
                const holidays = defaultSet.holidays.map((h: any) => {
                    if (typeof h === 'string') {
                        // Old format - just date string
                        return { date: h, name: 'Public Holiday' };
                    }
                    // New format - object with date and name
                    return h;
                });
                setPublicHolidaysCache(holidays, currentYear);
            }
        } catch (error) {
            console.error('Error loading public holidays:', error);
        }
    };

    const handleUserUpdate = () => {
        onReloadData();
    };

    const handleProfileUpdate = async (updatedUser: User) => {
        onLocalUserUpdate(updatedUser);
        await onUpdateCurrentUser(updatedUser.id);
    };

    const handleDepartmentUpdate = () => {
        onReloadData();
    };
    
    // Conflict resolution modal state
    const [conflictModal, setConflictModal] = useState<{
        isOpen: boolean;
        conflictData: {
            conflictingRequests: LeaveRequest[];
            conflictMessage: string;
            suggestedActions: ReturnType<typeof getSuggestedActions>;
            newRequestData: Omit<LeaveRequest, 'id' | 'status' | 'requestedAt'>;
        } | null;
    }>({
        isOpen: false,
        conflictData: null
    });

    const handleClearAllRequests = async (): Promise<{ success: boolean; count: number }> => {
        // Note: Confirmation and success/error messages are handled by the Tools component
        const result = await clearAllLeaveRequests();
        return result;
    };

    const handleApplyLeave = async (newRequestData: Omit<LeaveRequest, 'id' | 'status' | 'requestedAt'>) => {
        // Check if working days equals 0
        const leaveDays = getLeaveDaysBetween(
            newRequestData.startDate,
            newRequestData.endDate,
            newRequestData.startTime,
            newRequestData.endTime,
            getPayGroup(currentUser),
            newRequestData.leaveType
        );
        if (leaveDays === 0) {
            const usesCalendarDays = leaveTypeUsesCalendarDays(newRequestData.leaveType);
            alert(
                usesCalendarDays
                    ? 'The selected leave period has 0 leave days. Please select a valid date range.'
                    : 'The selected leave period has 0 working days. Please select a different date range that includes at least one working day.'
            );
            return;
        }

        // Check for conflicts with existing leave requests
        const conflictCheck = checkLeaveConflicts(
            newRequestData.startDate,
            newRequestData.endDate,
            leaveRequests,
            currentUser.id
        );

        if (conflictCheck.hasConflict) {
            const suggestedActions = getSuggestedActions(conflictCheck.conflictingRequests);
            
            // Show conflict resolution modal
            setConflictModal({
                isOpen: true,
                conflictData: {
                    conflictingRequests: conflictCheck.conflictingRequests,
                    conflictMessage: conflictCheck.conflictMessage,
                    suggestedActions,
                    newRequestData: newRequestData
                }
            });
            // Return early to show the modal - don't throw error
            return;
        }

        // No conflicts, proceed with submission
        await submitNewRequest(newRequestData);
    };

    const submitNewRequest = async (newRequestData: Omit<LeaveRequest, 'id' | 'status' | 'requestedAt'>) => {
        const newRequest = {
            ...newRequestData,
            employeeNumber: currentUser.employeeNumber, // Add employee number for data restoration
            requesterName: currentUser.name, // Store requester name for display when user is deleted
            requesterDepartmentId: currentUser.departmentId, // Store department ID for filtering when user is deleted
            status: LeaveStatus.PENDING,
            requestedAt: new Date().toISOString(),
            requestedAtTime: new Date().toISOString(),
        };
        try {
            await addDocument('leaveRequests', newRequest);
            
            // Send email notifications
            const requester = currentUser;
            const department = departments.find(dept => dept.id === requester.departmentId);
            const approvers = department?.approverIds?.map(id => users.find(user => user.id === id)).filter(Boolean) || [];
            const ccEmails = department?.ccEmails || [];
            
            // If no approvers found in department, include super admins as fallback
            let notificationRecipients = approvers.map(approver => approver.email).filter(Boolean) as string[];
            
            if (notificationRecipients.length === 0) {
                const superAdmins = resolveDataLoadMode(currentUser, departments) === 'scoped'
                    ? await fetchSuperAdminUsers()
                    : users.filter(user => user.role === UserRole.SUPER_ADMIN);
                notificationRecipients = superAdmins.map(admin => admin.email).filter(Boolean);
            }
            
            if (notificationRecipients.length > 0) {
                // Convert StoredFile objects back to File objects for email
                const emailAttachments = newRequest.attachments ? convertStoredFilesToFiles(newRequest.attachments) : [];
                
                await sendLeaveRequestNotification(
                    requester.name,
                    requester.email,
                    notificationRecipients,
                    [], // No CC recipients for submission notifications
                    newRequest.leaveType,
                    newRequest.startDate,
                    newRequest.endDate,
                    newRequest.startTime,
                    newRequest.endTime,
                    newRequest.reason,
                    department?.name || 'No Department Assigned',
                    emailAttachments,
                    getPayGroup(requester)
                );
            }
            
            alert('Leave request submitted successfully!');
        } catch (error) {
            console.error("Error submitting leave request: ", error);
            alert('Failed to submit leave request.');
        }
    };

    const handleResolveConflict = async (action: 'proceed' | 'cancel' | 'cancelExisting') => {
        const conflictData = conflictModal.conflictData;
        if (!conflictData) return;

        switch (action) {
            case 'proceed':
                await submitNewRequest(conflictData.newRequestData);
                setConflictModal({ isOpen: false, conflictData: null });
                break;
            
            case 'cancel':
                setConflictModal({ isOpen: false, conflictData: null });
                break;
            
            case 'cancelExisting':
                for (const request of conflictData.suggestedActions.cancellableRequests) {
                    await handleCancelRequest(request.id, { silent: true });
                }
                await submitNewRequest(conflictData.newRequestData);
                setConflictModal({ isOpen: false, conflictData: null });
                break;
        }
    };

    const handleApproveRequest = async (requestId: string, comments: string = '') => {
        try {
            const request = leaveRequests.find(r => r.id === requestId);
            if (!request) {
                alert('Request not found.');
                return;
            }

            // Check if this is a cancellation request
            if (request.status === LeaveStatus.CANCELLATION_PENDING) {
                // Approve cancellation - set to CANCELLED
                await updateDocument('leaveRequests', requestId, { 
                    status: LeaveStatus.CANCELLED,
                    cancellationApprovedAt: new Date().toISOString(),
                    cancellationApprovedBy: currentUser.id,
                    cancelledAt: new Date().toISOString(),
                    cancelledAtTime: new Date().toISOString(),
                    cancelledBy: request.cancellationRequestedBy || currentUser.id,
                    comments
                });
                
                // Send cancellation approval notification
                const requester = users.find(u => u.id === request.userId);
                const department = departments.find(dept => dept.id === requester?.departmentId);
                const ccEmails = department?.ccEmails || [];
                
                if (requester) {
                    await sendLeaveCancellationDecisionNotification(
                        requester.name,
                        requester.email,
                        currentUser.name,
                        request.leaveType,
                        request.startDate,
                        request.endDate,
                        request.startTime,
                        request.endTime,
                        request.reason,
                        "Approved" as const,
                        ccEmails,
                        undefined, // No rejection reason for approved cancellation
                        resolveRequestPayGroup(request, requester)
                    );
                }
                
                alert('Cancellation approved successfully. The days have been credited back to the balance.');
            } else {
                // Regular approval
                await updateDocument('leaveRequests', requestId, { 
                    status: LeaveStatus.APPROVED, 
                    approvedBy: currentUser.id,
                    approvedAt: new Date().toISOString(),
                    approvedAtTime: new Date().toISOString(),
                    comments
                });
                
                // Send approval notification
                const requester = users.find(u => u.id === request.userId);
                const department = departments.find(dept => dept.id === requester?.departmentId);
                const ccEmails = department?.ccEmails || [];
                
                if (requester) {
                    await sendLeaveDecisionNotification(
                        requester.name,
                        requester.email,
                        currentUser.name,
                        request.leaveType,
                        request.startDate,
                        request.endDate,
                        request.startTime,
                        request.endTime,
                        "Approved" as const,
                        ccEmails,
                        comments || '',
                        '', // No rejection reason for approved requests
                        resolveRequestPayGroup(request, requester)
                    );
                }
                
                alert('Request approved successfully!');
            }
        } catch (error) {
            console.error("Error approving request: ", error);
            alert('Failed to approve request.');
        }
    };

    const handleRejectRequest = async (requestId: string, rejectionReason: string, comments: string = '') => {
        try {
            const request = leaveRequests.find(r => r.id === requestId);
            if (!request) {
                alert('Request not found.');
                return;
            }

            // Check if this is a cancellation request
            if (request.status === LeaveStatus.CANCELLATION_PENDING) {
                // Reject cancellation request - restore to APPROVED
                await updateDocument('leaveRequests', requestId, { 
                    status: LeaveStatus.APPROVED,
                    cancellationRejectedAt: new Date().toISOString(),
                    cancellationRejectedBy: currentUser.id,
                    cancellationRejectionReason: rejectionReason,
                    comments
                });
                
                // Send cancellation rejection notification
                const requester = users.find(u => u.id === request.userId);
                const department = departments.find(dept => dept.id === requester?.departmentId);
                const ccEmails = department?.ccEmails || [];
                
                if (requester) {
                    await sendLeaveCancellationDecisionNotification(
                        requester.name,
                        requester.email,
                        currentUser.name,
                        request.leaveType,
                        request.startDate,
                        request.endDate,
                        request.startTime,
                        request.endTime,
                        request.reason,
                        "Rejected" as const,
                        ccEmails,
                        rejectionReason || '',
                        resolveRequestPayGroup(request, requester)
                    );
                }
                
                alert('Cancellation request rejected. Leave remains approved.');
            } else {
                // Regular rejection
                await updateDocument('leaveRequests', requestId, { 
                    status: LeaveStatus.REJECTED, 
                    rejectedBy: currentUser.id,
                    rejectedAt: new Date().toISOString(),
                    rejectedAtTime: new Date().toISOString(),
                    rejectionReason,
                    comments
                });
                
                // Send rejection notification
                const requester = users.find(u => u.id === request.userId);
                const department = departments.find(dept => dept.id === requester?.departmentId);
                const ccEmails = department?.ccEmails || [];
                    
                if (requester) {
                    await sendLeaveDecisionNotification(
                        requester.name,
                        requester.email,
                        currentUser.name,
                        request.leaveType,
                        request.startDate,
                        request.endDate,
                        request.startTime,
                        request.endTime,
                        "Rejected" as const,
                        ccEmails,
                        comments || '',
                        rejectionReason || '',
                        resolveRequestPayGroup(request, requester)
                    );
                }
                
                alert('Request rejected successfully!');
            }
        } catch (error) {
            console.error("Error rejecting request: ", error);
            alert('Failed to reject request.');
        }
    };

    const handleCancelRequest = async (requestId: string, options: { silent?: boolean } = {}) => {
        const { silent = false } = options;

        const request = leaveRequests.find(r => r.id === requestId);
        if (!request) {
            if (!silent) {
                alert('Leave request not found.');
            }
            return;
        }

        if (request.status !== LeaveStatus.PENDING && request.status !== LeaveStatus.APPROVED && request.status !== LeaveStatus.CANCELLATION_PENDING) {
            if (!silent) {
                alert('Only pending or approved requests can be cancelled.');
            }
            return;
        }

        try {
            // If approved, require approval for cancellation
            if (request.status === LeaveStatus.APPROVED) {
                // Get requester and department info
                const requester = users.find(u => u.id === request.userId);
                if (!requester) {
                    if (!silent) {
                        alert('Requester not found.');
                    }
                    return;
                }

                const department = departments.find(dept => dept.id === requester.departmentId);
                if (!department || !department.approverIds || department.approverIds.length === 0) {
                    if (!silent) {
                        alert('No approver found for this department.');
                    }
                    return;
                }

                // Get original approver
                const originalApprover = request.approvedBy ? users.find(u => u.id === request.approvedBy) : null;
                const originalApproverName = originalApprover ? originalApprover.name : 'Approver';
                const approvedDate = request.approvedAt ? new Date(request.approvedAt).toLocaleDateString() : 'N/A';

                // Update status to CANCELLATION_PENDING
                await updateDocument('leaveRequests', requestId, { 
                    status: LeaveStatus.CANCELLATION_PENDING,
                    cancellationRequestedAt: new Date().toISOString(),
                    cancellationRequestedBy: currentUser.id
                });

                // Get approver emails
                const approverEmails = department.approverIds
                    .map(id => users.find(u => u.id === id))
                    .filter(Boolean)
                    .map(u => u!.email);
                const ccEmails = department.ccEmails || [];

                // Send cancellation request notification to approvers
                await sendLeaveCancellationRequestNotification(
                    requester.name,
                    requester.email,
                    approverEmails,
                    ccEmails,
                    request.leaveType,
                    request.startDate,
                    request.endDate,
                    request.startTime,
                    request.endTime,
                    request.reason,
                    department.name,
                    originalApproverName,
                    approvedDate,
                    resolveRequestPayGroup(request, requester)
                );

                if (!silent) {
                    alert('Cancellation request submitted. Waiting for approver approval.');
                }
            } else {
                // For PENDING requests, cancel directly
                await updateDocument('leaveRequests', requestId, { 
                    status: LeaveStatus.CANCELLED, 
                    cancelledBy: currentUser.id,
                    cancelledAt: new Date().toISOString(),
                    cancelledAtTime: new Date().toISOString()
                });
                if (!silent) {
                    alert('Request cancelled successfully!');
                }
            }
        } catch (error) {
            console.error("Error cancelling request: ", error);
            if (!silent) {
                alert('Failed to cancel request.');
            }
        }
    };

    const NavItem: React.FC<{ icon: React.ReactNode; label: string; view: View; isMobile?: boolean }> = ({ icon, label, view, isMobile = false }) => (
        <button
            onClick={() => {
                setActiveView(view);
                window.location.hash = view; // Update URL hash
                if (isMobile) {
                    setMobileSidebarOpen(false);
                }
            }}
            className={`sidebar-item ${activeView === view ? 'sidebar-item-active' : 'sidebar-item-inactive'}`}
        >
            <div className="flex items-center">
            {icon}
                {(isMobile || !sidebarMinimized) && <span className="ml-3">{label}</span>}
            </div>
        </button>
    );

    const Footer: React.FC = () => {
        const appVersion = '0.1.0-beta'; // Application version
        return (
            <footer className="bg-slate-800 border-t border-slate-700 p-4 text-center">
                <p className="text-slate-400 text-sm">© 2026 Harrisons Holdings (Malaysia) Berhad | v{appVersion}</p>
            </footer>
        );
    };

    // Close mobile sidebar when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (mobileSidebarOpen && !target.closest('.mobile-sidebar') && !target.closest('.mobile-menu-button')) {
                setMobileSidebarOpen(false);
            }
        };

        if (mobileSidebarOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            // Prevent body scroll when sidebar is open
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.body.style.overflow = '';
        };
    }, [mobileSidebarOpen]);

    return (
        <div className="flex h-screen bg-background text-text-primary overflow-hidden">
            {/* Mobile Sidebar Overlay */}
            <div 
                className={`mobile-sidebar-overlay ${mobileSidebarOpen ? '' : 'hidden'}`}
                onClick={() => setMobileSidebarOpen(false)}
            />

            {/* Mobile Sidebar */}
            <div className={`mobile-sidebar flex flex-col ${mobileSidebarOpen ? 'open' : ''}`}>
                <div className="flex-shrink-0 p-4 border-b border-border">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <AppLogo className="h-10 w-auto" />
                            <div>
                                <p className="text-sm text-text-secondary">Welcome back</p>
                                <p className="font-semibold text-base">{currentUser.name}</p>
                                <p className="text-xs text-text-muted">{currentUser.employeeNumber}</p>
                            </div>
                        </div>
                        <button 
                            onClick={() => setMobileSidebarOpen(false)}
                            className="mobile-menu-button"
                            aria-label="Close menu"
                        >
                            <XIcon className="w-6 h-6" />
                        </button>
                    </div>
                </div>
                
                <nav className="flex-1 p-4 space-y-2 overflow-y-auto -webkit-overflow-scrolling-touch min-h-0">
                    <NavItem icon={<DashboardIcon className="w-5 h-5"/>} label="Dashboard" view="dashboard" isMobile />
                    <NavItem icon={<CalendarIcon className="w-5 h-5"/>} label="Apply for Leave" view="apply" isMobile />
                    <NavItem icon={<HistoryIcon className="w-5 h-5"/>} label="Leave History" view="history" isMobile />
                    <NavItem icon={<CalendarIcon className="w-5 h-5"/>} label="Leave Calendar" view="calendar" isMobile />
                    {((currentUser.role === UserRole.NORMAL && departments.some(d => d.approverIds?.includes(currentUser.id))) || currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SUPER_ADMIN) && (
                        <NavItem icon={<CheckCircleIcon className="w-5 h-5"/>} label="Approvals" view="approvals" isMobile />
                    )}
                    {((currentUser.role === UserRole.NORMAL && departments.some(d => d.approverIds?.includes(currentUser.id))) || currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SUPER_ADMIN) && (
                        <NavItem icon={<span className="text-lg">📊</span>} label="Statistics" view="statistics" isMobile />
                    )}
                    <NavItem icon={<UserIcon className="w-5 h-5"/>} label="Profile" view="profile" isMobile />
                    <NavItem icon={<DocumentTextIcon className="w-5 h-5"/>} label="Release Notes" view="changelog" isMobile />
                    {currentUser.role === UserRole.SUPER_ADMIN && (
                        <>
                            <NavItem icon={<UsersIcon className="w-5 h-5"/>} label="User Management" view="users" isMobile />
                            <NavItem icon={<UploadIcon className="w-5 h-5"/>} label="Employee Upload" view="employee-upload" isMobile />
                            <NavItem icon={<BuildingOfficeIcon className="w-5 h-5"/>} label="Branches" view="branches" isMobile />
                            <NavItem icon={<BuildingOfficeIcon className="w-5 h-5"/>} label="Departments" view="departments" isMobile />
                            <NavItem icon={<SparklesIcon className="w-5 h-5"/>} label="Email Setup" view="email-setup" isMobile />
                            <NavItem icon={<CheckCircleIcon className="w-5 h-5"/>} label="Leave Type Config" view="leave-type-config" isMobile />
                            <NavItem icon={<UploadIcon className="w-5 h-5"/>} label="Leave Balance Upload" view="leave-balance-upload" isMobile />
                            <NavItem icon={<span className="text-lg">📅</span>} label="Public Holidays" view="public-holidays" isMobile />
                            <NavItem icon={<WrenchScrewdriverIcon className="w-5 h-5"/>} label="Tools" view="tools" isMobile />
                        </>
                    )}
                    {currentUser.role === UserRole.ADMIN && (
                        <NavItem icon={<UploadIcon className="w-5 h-5"/>} label="Employee Register" view="employee-upload" isMobile />
                    )}
                </nav>
                
                <div className="flex-shrink-0 p-4 border-t border-border">
                    <button 
                        onClick={() => {
                            signOutUser();
                            setMobileSidebarOpen(false);
                        }}
                        className="w-full text-left text-text-muted hover:text-text-primary transition-colors py-3 px-4 rounded-lg hover:bg-surface-light"
                    >
                        Sign Out
                    </button>
                </div>
            </div>

            {/* Desktop Sidebar */}
            <div className={`desktop-sidebar ${sidebarMinimized ? 'w-16' : 'w-56'} bg-surface border-r border-border flex flex-col transition-all duration-300 ${sidebarMinimized ? 'sidebar-minimized' : ''}`}>
                <div className="p-3 border-b border-border">
                    <div className="flex items-center justify-between">
                        {!sidebarMinimized && <AppLogo className="h-8 w-auto" />}
                        <button 
                            onClick={() => setSidebarMinimized(!sidebarMinimized)}
                            className="text-text-muted hover:text-text-primary p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
                            aria-label={sidebarMinimized ? "Expand sidebar" : "Minimize sidebar"}
                        >
                            {sidebarMinimized ? <MenuIcon className="w-5 h-5" /> : <ArrowLeftIcon className="w-5 h-5" />}
                        </button>
                    </div>
                    {!sidebarMinimized && (
                        <div className="mt-2">
                            <p className="text-xs text-text-secondary">Welcome back</p>
                            <p className="font-semibold text-sm truncate">{currentUser.name}</p>
                            <p className="text-xs text-text-muted truncate">{currentUser.employeeNumber}</p>
                        </div>
                    )}
                </div>
                
                <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                        <NavItem icon={<DashboardIcon className="w-5 h-5"/>} label="Dashboard" view="dashboard" />
                        <NavItem icon={<CalendarIcon className="w-5 h-5"/>} label="Apply for Leave" view="apply" />
                    <NavItem icon={<HistoryIcon className="w-5 h-5"/>} label="Leave History" view="history" />
                        <NavItem icon={<CalendarIcon className="w-5 h-5"/>} label="Leave Calendar" view="calendar" />
                        {((currentUser.role === UserRole.NORMAL && departments.some(d => d.approverIds?.includes(currentUser.id))) || currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SUPER_ADMIN) && (
                            <NavItem icon={<CheckCircleIcon className="w-5 h-5"/>} label="Approvals" view="approvals" />
                        )}
                        {((currentUser.role === UserRole.NORMAL && departments.some(d => d.approverIds?.includes(currentUser.id))) || currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SUPER_ADMIN) && (
                            <NavItem icon={<span className="text-lg">📊</span>} label="Statistics" view="statistics" />
                        )}
                    <NavItem icon={<UserIcon className="w-5 h-5"/>} label="Profile" view="profile" />
                    <NavItem icon={<DocumentTextIcon className="w-5 h-5"/>} label="Release Notes" view="changelog" />
                    {currentUser.role === UserRole.SUPER_ADMIN && (
                        <>
                            <NavItem icon={<UsersIcon className="w-5 h-5"/>} label="User Management" view="users" />
                            <NavItem icon={<UploadIcon className="w-5 h-5"/>} label="Employee Upload" view="employee-upload" />
                            <NavItem icon={<BuildingOfficeIcon className="w-5 h-5"/>} label="Branches" view="branches" />
                            <NavItem icon={<BuildingOfficeIcon className="w-5 h-5"/>} label="Departments" view="departments" />
                            <NavItem icon={<SparklesIcon className="w-5 h-5"/>} label="Email Setup" view="email-setup" />
                            <NavItem icon={<CheckCircleIcon className="w-5 h-5"/>} label="Leave Type Config" view="leave-type-config" />
                            <NavItem icon={<UploadIcon className="w-5 h-5"/>} label="Leave Balance Upload" view="leave-balance-upload" />
                            <NavItem icon={<span className="text-lg">📅</span>} label="Public Holidays" view="public-holidays" />
                            <NavItem icon={<WrenchScrewdriverIcon className="w-5 h-5"/>} label="Tools" view="tools" />
                            </>
                        )}
                    {currentUser.role === UserRole.ADMIN && (
                        <NavItem icon={<UploadIcon className="w-5 h-5"/>} label="Employee Register" view="employee-upload" />
                    )}
                    </nav>
                
                <div className="p-3 border-t border-border flex-shrink-0">
                    <button 
                        onClick={signOutUser}
                        className="w-full text-left text-text-muted hover:text-text-primary transition-colors py-2 px-2 min-h-[44px] flex items-center"
                    >
                        {!sidebarMinimized ? 'Sign Out' : '↩'}
                    </button>
                </div>
                   </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden main-content-mobile">
                {/* Mobile Header */}
                <div className="mobile-header">
                    <button 
                        onClick={() => setMobileSidebarOpen(true)}
                        className="mobile-menu-button"
                        aria-label="Open menu"
                    >
                        <MenuIcon className="w-6 h-6" />
                    </button>
                    <h1 className="text-text-primary flex-1 text-center">
                        {activeView === 'dashboard' ? 'Dashboard' :
                         activeView === 'apply' ? 'Apply for Leave' :
                         activeView === 'history' ? 'Leave History' :
                         activeView === 'approvals' ? 'Approvals' :
                         activeView === 'calendar' ? 'Leave Calendar' :
                         activeView === 'profile' ? 'Profile' :
                         activeView === 'users' ? 'User Management' :
                         activeView === 'employee-upload' ? 'Employee Upload' :
                         activeView === 'leave-balance-upload' ? 'Leave Balance Upload' :
                         activeView === 'public-holidays' ? 'Public Holidays' :
                         activeView === 'branches' ? 'Branches' :
                         activeView === 'departments' ? 'Departments' :
                         activeView === 'email-setup' ? 'Email Setup' :
                         activeView === 'leave-type-config' ? 'Leave Type Config' :
                         activeView === 'tools' ? 'Tools' :
                         activeView === 'changelog' ? 'Changelog' :
                         'Leave Management'}
                    </h1>
                    <div className="w-11"></div> {/* Spacer for symmetry */}
                </div>
                
                <main className="flex-1 overflow-y-auto p-4 md:p-8" style={{ paddingTop: '0' }}>
                    {activeView === 'dashboard' && <DashboardView user={currentUser} requests={leaveRequests} requestsLoaded={leaveRequestsLoaded} departments={departments} departmentsLoaded={departmentsLoaded} users={users} onUserUpdate={handleUserUpdate} />}
                    {activeView === 'apply' && <ApplyLeaveView user={currentUser} departments={departments} departmentsLoaded={departmentsLoaded} users={users} leaveRequests={leaveRequests} onApply={handleApplyLeave} />}
                    {activeView === 'history' && <HistoryView user={currentUser} requests={leaveRequests} users={users} departments={departments} onCancel={handleCancelRequest} />}
                    {activeView === 'approvals' && (
                        (currentUser.role === UserRole.NORMAL && departments.some(d => d.approverIds?.includes(currentUser.id))) || 
                        currentUser.role === UserRole.ADMIN || 
                        currentUser.role === UserRole.SUPER_ADMIN
                    ) && <ApprovalsView user={currentUser} requests={leaveRequests} users={users} departments={departments} onApprove={handleApproveRequest} onReject={handleRejectRequest} />}
                    {activeView === 'approvals' && !(
                        (currentUser.role === UserRole.NORMAL && departments.some(d => d.approverIds?.includes(currentUser.id))) || 
                        currentUser.role === UserRole.ADMIN || 
                        currentUser.role === UserRole.SUPER_ADMIN
                    ) && <AccessDeniedView pageName="Approvals" />}
                    {activeView === 'calendar' && <CalendarView user={currentUser} requests={leaveRequests} users={users} departments={departments} />}
                    {activeView === 'profile' && <UserProfile user={currentUser} departments={departments} onProfileUpdate={handleProfileUpdate} />}
                    {activeView === 'users' && currentUser.role === UserRole.SUPER_ADMIN && <UserManagement users={users} departments={departments} currentUser={currentUser} branches={branches} onUserUpdate={handleUserUpdate} />}
                    {activeView === 'users' && currentUser.role !== UserRole.SUPER_ADMIN && <AccessDeniedView pageName="User Management" />}
                    {activeView === 'employee-upload' && (currentUser.role === UserRole.SUPER_ADMIN || currentUser.role === UserRole.ADMIN) && (
                        <EmployeeUploadPage
                            users={users}
                            departments={departments}
                            currentUser={currentUser}
                            branches={branches}
                            onUploadComplete={handleUserUpdate}
                        />
                    )}
                    {activeView === 'employee-upload' && currentUser.role !== UserRole.SUPER_ADMIN && currentUser.role !== UserRole.ADMIN && (
                        <AccessDeniedView pageName="Employee Upload" />
                    )}
                    {activeView === 'leave-balance-upload' && currentUser.role === UserRole.SUPER_ADMIN && <LeaveBalanceUpload currentUser={currentUser} users={users} onUploadComplete={handleUserUpdate} />}
                    {activeView === 'leave-balance-upload' && currentUser.role !== UserRole.SUPER_ADMIN && <AccessDeniedView pageName="Leave Balance Upload" />}
                    {activeView === 'public-holidays' && currentUser.role === UserRole.SUPER_ADMIN && <PublicHolidayUpload currentUser={currentUser} onUploadComplete={handleReloadPublicHolidays} />}
                    {activeView === 'public-holidays' && currentUser.role !== UserRole.SUPER_ADMIN && <AccessDeniedView pageName="Public Holidays" />}
                    {activeView === 'branches' && currentUser.role === UserRole.SUPER_ADMIN && (
                        <BranchSettings branches={branches} onBranchesChange={onBranchesReload} />
                    )}
                    {activeView === 'branches' && currentUser.role !== UserRole.SUPER_ADMIN && (
                        <AccessDeniedView pageName="Branches" />
                    )}
                    {activeView === 'departments' && currentUser.role === UserRole.SUPER_ADMIN && (
                        <DepartmentSettings departments={departments} users={users} branches={branches} onDepartmentUpdate={handleDepartmentUpdate} />
                    )}
                    {activeView === 'departments' && currentUser.role !== UserRole.SUPER_ADMIN && <AccessDeniedView pageName="Departments" />}
                    {activeView === 'email-setup' && currentUser.role === UserRole.SUPER_ADMIN && <EmailSetup currentUser={currentUser} />}
                    {activeView === 'email-setup' && currentUser.role !== UserRole.SUPER_ADMIN && <AccessDeniedView pageName="Email Setup" />}
                    {activeView === 'leave-type-config' && currentUser.role === UserRole.SUPER_ADMIN && <LeaveTypeConfigView user={currentUser} />}
                    {activeView === 'leave-type-config' && currentUser.role !== UserRole.SUPER_ADMIN && <AccessDeniedView pageName="Leave Type Config" />}
                    {activeView === 'tools' && currentUser.role === UserRole.SUPER_ADMIN && <Tools currentUser={currentUser} onClearAll={handleClearAllRequests} departments={departments} users={users} />}
                    {activeView === 'tools' && currentUser.role !== UserRole.SUPER_ADMIN && <AccessDeniedView pageName="Tools" />}
                    {activeView === 'changelog' && <ChangelogView />}
                    {activeView === 'statistics' && (
                        (currentUser.role === UserRole.NORMAL && departments.some(d => d.approverIds?.includes(currentUser.id))) ||
                        currentUser.role === UserRole.ADMIN ||
                        currentUser.role === UserRole.SUPER_ADMIN
                    ) && <StatisticsView currentUser={currentUser} users={users} departments={departments} leaveRequests={leaveRequests} branches={branches} />}
                    {activeView === 'statistics' && !(
                        (currentUser.role === UserRole.NORMAL && departments.some(d => d.approverIds?.includes(currentUser.id))) ||
                        currentUser.role === UserRole.ADMIN ||
                        currentUser.role === UserRole.SUPER_ADMIN
                    ) && <AccessDeniedView pageName="Statistics" />}
                </main>
                <Footer />
            </div>

            {/* Conflict Resolution Modal */}
            <ConflictResolutionModal
                isOpen={conflictModal.isOpen}
                conflictData={conflictModal.conflictData}
                onResolve={handleResolveConflict}
            />
        </div>
    );
};

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    const [authState, setAuthState] = useState<{ status: 'loading' | 'signedIn' | 'signedOut'; user: User | null }>({ status: 'loading', user: null });
    
    const [users, setUsers] = useState<User[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
    const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
    const [leaveRequestsLoaded, setLeaveRequestsLoaded] = useState(false);
    const [branches, setBranches] = useState<Branch[]>([]);
    const scopedSelfRef = useRef<User | null>(null);
    const scopedApproversRef = useRef<User[]>([]);

    const reloadBranches = useCallback(async () => {
        try {
            const list = await getCollection<Branch>('branches');
            setBranches(list.sort((a, b) => a.code.localeCompare(b.code)));
        } catch (error) {
            console.error('Failed to reload branches:', error);
        }
    }, []);

    const handleLocalUserUpdate = (updatedUser: User) => {
        setUsers(prevUsers =>
            prevUsers.map(user => user.id === updatedUser.id ? { ...user, ...updatedUser } : user)
        );

        setAuthState(prevState => {
            if (prevState.status === 'signedIn' && prevState.user && prevState.user.id === updatedUser.id) {
                return {
                    ...prevState,
                    user: { ...prevState.user, ...updatedUser }
                };
            }
            return prevState;
        });
    };

    // Initialize email service on app startup
    useEffect(() => {
        const initializeEmailService = async () => {
            try {
                // The robust email service auto-initializes on first use
                console.log('Email service initialized');
        } catch (error) {
                console.log('Email service not configured yet');
        }
        };
        
        initializeEmailService();
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(async (firebaseUser) => {
            if (firebaseUser) {
                try {
                    const profile = await resolveSignedInUserProfile(firebaseUser);
                    setAuthState({
                        status: 'signedIn',
                        user: {
                            ...profile,
                            id: firebaseUser.uid,
                            email: profile.email || firebaseUser.email || '',
                            emailVerified: firebaseUser.emailVerified
                        } as User
                    });
                } catch (error) {
                    console.error('Error resolving signed-in user profile:', error);
                    setAuthState({ status: 'signedOut', user: null });
                }
            } else {
                setAuthState({ status: 'signedOut', user: null });
            }
        });
        return () => unsubscribe();
    }, []);

    // Auto-fix missing email fields for existing users (only for old accounts without email)
    // Note: Don't overwrite user-provided emails with generated @system.local emails
    useEffect(() => {
        const fixUserEmails = async () => {
            if (authState.status === 'signedIn' && authState.user && users.length > 0) {
                for (const user of users) {
                    // Only update if email is missing AND it's not a generated @system.local email
                    const firebaseEmail = authState.user.email;
                    const isGeneratedEmail = firebaseEmail && firebaseEmail.endsWith('@system.local');
                    
                    if (!user.email && authState.user.id === user.id && !isGeneratedEmail) {
                        try {
                            await updateUserEmail(user.id, firebaseEmail);
                            console.log(`Updated email for user ${user.id}`);
                        } catch (error) {
                            console.error(`Failed to update email for user ${user.id}:`, error);
                        }
                    }
                }
            }
        };

        fixUserEmails();
    }, [authState, users]);

    // Sync authState.user with users array when users are updated (e.g., by Super Admin)
    useEffect(() => {
        if (authState.status === 'signedIn' && authState.user && users.length > 0) {
            const updatedUser = users.find(u => u.id === authState.user!.id);
            if (updatedUser) {
                // Check if any important fields have changed (handle undefined/null for departmentId)
                const currentDeptId = authState.user.departmentId || '';
                const updatedDeptId = updatedUser.departmentId || '';
                const hasChanges = 
                    updatedUser.name !== authState.user.name ||
                    updatedUser.email !== authState.user.email ||
                    updatedDeptId !== currentDeptId ||
                    updatedUser.role !== authState.user.role ||
                    updatedUser.leaveDaysTotal !== authState.user.leaveDaysTotal;
                
                if (hasChanges) {
                    console.log('🔄 Syncing user profile with updated data:', {
                        oldDepartment: currentDeptId,
                        newDepartment: updatedDeptId,
                        changes: {
                            name: updatedUser.name !== authState.user.name,
                            email: updatedUser.email !== authState.user.email,
                            department: updatedDeptId !== currentDeptId,
                            role: updatedUser.role !== authState.user.role,
                            leaveDays: updatedUser.leaveDaysTotal !== authState.user.leaveDaysTotal
                        }
                    });
                    // Update authState.user with the latest data from Firestore
                    setAuthState(prev => {
                        if (!prev.user) return prev;
                        return {
                            ...prev,
                            user: {
                                ...prev.user,
                                ...updatedUser,
                                // Preserve email from authState if it's the user-provided email
                                email: updatedUser.email || prev.user.email
                            }
                        };
                    });
                }
            }
        }
    }, [users, authState.status, authState.user]);

    useEffect(() => {
        if (authState.status === 'signedIn') {
            const unsubscribeDepartments = listenToCollection('departments', (fetchedDepartments) => {
                setDepartments(fetchedDepartments as Department[]);
                setDepartmentsLoaded(true);
            });
            const unsubscribeBranches = listenToBranches((fetchedBranches) => {
                setBranches(fetchedBranches);
            });

            return () => {
                unsubscribeDepartments();
                unsubscribeBranches();
            };
        } else {
            setDepartments([]);
            setDepartmentsLoaded(false);
            setBranches([]);
        }
    }, [authState.status]);

    useEffect(() => {
        if (authState.status !== 'signedIn' || !authState.user) {
            setUsers([]);
            setLeaveRequests([]);
            setLeaveRequestsLoaded(false);
            scopedSelfRef.current = null;
            scopedApproversRef.current = [];
            return;
        }

        const user = authState.user;
        const mode = resolveDataLoadMode(user, departments);
        const cleanups: (() => void)[] = [];

        if (mode === 'full') {
            scopedSelfRef.current = null;
            scopedApproversRef.current = [];

            const unsubscribeUsers = listenToCollection('users', (fetchedUsers) => {
                setUsers(fetchedUsers as User[]);
            });
            const unsubscribeRequests = listenToCollection('leaveRequests', (fetchedRequests) => {
                setLeaveRequests(fetchedRequests as LeaveRequest[]);
                setLeaveRequestsLoaded(true);
            });
            cleanups.push(unsubscribeUsers, unsubscribeRequests);
        } else {
            const unsubscribeSelf = listenToDocument<User>('users', user.id, (self) => {
                scopedSelfRef.current = self;
                setUsers(mergeScopedUsers(self, scopedApproversRef.current));
            });
            const unsubscribeRequests = listenToLeaveRequestsForUser(user.id, (fetchedRequests) => {
                setLeaveRequests(fetchedRequests);
                setLeaveRequestsLoaded(true);
            });
            cleanups.push(unsubscribeSelf, unsubscribeRequests);
        }

        return () => {
            cleanups.forEach(fn => fn());
        };
    }, [authState.status, authState.user?.id, authState.user?.role, departments]);

    useEffect(() => {
        if (authState.status !== 'signedIn' || !authState.user) return;

        const user = authState.user;
        const mode = resolveDataLoadMode(user, departments);
        if (mode !== 'scoped') return;

        const userDept = departments.find(d => d.id === user.departmentId);
        const approverIds = userDept?.approverIds || [];

        let cancelled = false;
        fetchUsersByIds(approverIds).then(approvers => {
            if (cancelled) return;
            scopedApproversRef.current = approvers;
            setUsers(mergeScopedUsers(scopedSelfRef.current, approvers));
        });

        return () => {
            cancelled = true;
        };
    }, [authState.status, authState.user?.id, authState.user?.role, authState.user?.departmentId, departments]);

    if (authState.status === 'loading') {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <p className="text-text-primary">Loading Application...</p>
            </div>
        );
    }
    
    if (authState.status === 'signedIn' && authState.user) {
        return <AppShell 
            currentUser={authState.user} 
            users={users} 
            departments={departments} 
            departmentsLoaded={departmentsLoaded}
            leaveRequests={leaveRequests}
            leaveRequestsLoaded={leaveRequestsLoaded}
            branches={branches}
            onBranchesReload={reloadBranches}
            onReloadData={async () => {
                if (!authState.user) return;
                try {
                    const mode = resolveDataLoadMode(authState.user, departments);
                    if (mode === 'full') {
                        const [usersData, departmentsData, requestsData, branchesData] = await Promise.all([
                            getCollection<User>('users'),
                            getCollection<Department>('departments'),
                            getCollection<LeaveRequest>('leaveRequests'),
                            getCollection<Branch>('branches')
                        ]);
                        setUsers(usersData);
                        setDepartments(departmentsData);
                        setLeaveRequests(requestsData);
                        setBranches(branchesData.sort((a, b) => a.code.localeCompare(b.code)));
                    } else {
                        const user = authState.user;
                        const userDept = departments.find(d => d.id === user.departmentId);
                        const approverIds = userDept?.approverIds || [];
                        const [selfDoc, requestsData, approvers, branchesData] = await Promise.all([
                            getDocument<User>('users', user.id),
                            getLeaveRequestsForUser(user.id),
                            fetchUsersByIds(approverIds),
                            getCollection<Branch>('branches')
                        ]);
                        scopedSelfRef.current = selfDoc;
                        scopedApproversRef.current = approvers;
                        setUsers(mergeScopedUsers(selfDoc, approvers));
                        setLeaveRequests(requestsData);
                        setBranches(branchesData.sort((a, b) => a.code.localeCompare(b.code)));
                    }
                } catch (error) {
                    console.error('Failed to reload data:', error);
                }
            }}
            onUpdateCurrentUser={async (userId: string) => {
                // Update current user data
                try {
                    const updatedUserDoc = await getDocument('users', userId);
                    if (updatedUserDoc) {
                        setAuthState(prev => ({ ...prev, user: updatedUserDoc as User }));
                    }
                } catch (error) {
                    console.error('Failed to update current user:', error);
                }
            }}
            onLocalUserUpdate={handleLocalUserUpdate}
        />;
    }

    return <LoginView />;
};

export default App;
