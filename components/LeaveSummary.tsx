import React, { useState, useEffect } from 'react';
import { LeaveRequest, User, Department } from '../types';
import { 
    getLeaveDaysBetween, 
    formatDateWithDay, 
    getReturnToWorkDateWithDay,
    leaveTypeUsesCalendarDays,
    shouldExcludeDateForLeave,
    isPublicHoliday,
    getPublicHolidayName
} from '../utils/dateUtils';
import { resolveRequestPayGroup } from '../utils/payGroupUtils';

interface LeaveSummaryProps {
    request: LeaveRequest;
    users: User[];
    departments: Department[];
    showApproverInfo?: boolean;
    requests?: LeaveRequest[]; // All leave requests for calculating balance
}

const LeaveSummary: React.FC<LeaveSummaryProps> = ({ 
    request, 
    users, 
    departments, 
    showApproverInfo = false,
    requests = []
}) => {
    const requester = users.find(u => u.id === request.userId);
    const requestPayGroup = resolveRequestPayGroup(request, requester);
    const usesCalendarDays = leaveTypeUsesCalendarDays(request.leaveType);
    let workingDays, returnToWork;
    
    try {
        workingDays = getLeaveDaysBetween(request.startDate, request.endDate, request.startTime, request.endTime, requestPayGroup, request.leaveType);
        returnToWork = getReturnToWorkDateWithDay(request.endDate, request.endTime, requestPayGroup, request.leaveType);
    } catch (error) {
        console.error('Error calculating dates in LeaveSummary:', error, 'Request:', request);
        // Fallback values
        workingDays = 1;
        const fallbackDate = new Date().toISOString().split('T')[0];
        returnToWork = {
            date: fallbackDate,
            dayName: 'Monday',
            time: 'AM'
        };
    }
    
    // Get excluded dates (weekends and public holidays) in the range
    const excludedDates: string[] = [];
    
    try {
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        
        // Validate dates
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            console.error('Invalid dates in request:', request);
        } else {
            // Helper function to format date without timezone issues
            const formatDateToYYYYMMDD = (date: Date): string => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };
            
            // Check from start date to end date
            const current = new Date(start);
            while (current <= end) {
                const dateString = formatDateToYYYYMMDD(current);
                if (shouldExcludeDateForLeave(request.leaveType, dateString, requestPayGroup)) {
                    excludedDates.push(dateString);
                }
                current.setDate(current.getDate() + 1);
            }
            
            // If end date is Saturday, also check Sunday
            if (end.getDay() === 6) { // Saturday
                const nextDay = new Date(end);
                nextDay.setDate(nextDay.getDate() + 1);
                const sundayString = formatDateToYYYYMMDD(nextDay);
                if (shouldExcludeDateForLeave(request.leaveType, sundayString, requestPayGroup)) {
                    excludedDates.push(sundayString);
                }
            }
        }
    } catch (error) {
        console.error('Error calculating excluded dates:', error);
    }
    
    // Separate public holidays for display (excluding weekends to save space)
    const publicHolidays = excludedDates
        .filter(date => isPublicHoliday(date))
        .map(date => ({
            date,
            name: getPublicHolidayName(date) || 'Public Holiday'
        }));
    
    // Get approver information if requested
    const department = requester?.departmentId ? departments.find(d => d.id === requester.departmentId) : null;
    const approvers = department?.approverIds?.map(id => users.find(u => u.id === id)).filter(Boolean) || [];
    const ccEmails = department?.ccEmails || [];
    
    // Fetch leave balance history to get "as of" date (always fetch if requester exists)
    const [lastBalanceUpdate, setLastBalanceUpdate] = useState<{ effectiveDate: string } | null>(null);
    
    useEffect(() => {
        const fetchLastBalanceUpdate = async () => {
            // Use stored employee number if requester is deleted
            const employeeNumber = requester?.employeeNumber || request.employeeNumber;
            if (!employeeNumber) {
                setLastBalanceUpdate(null);
                return;
            }

            try {
                const { getLatestLeaveBalanceHistory } = await import('../services/firebaseService');
                const latest = await getLatestLeaveBalanceHistory(employeeNumber);
                
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
    }, [requester?.employeeNumber, request.employeeNumber]);
    
    // Format date for display
    const formatDisplayDate = (dateString: string): string => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const decisionInfo = (() => {
        if (request.status === 'Approved' && request.approvedAtTime) {
            return {
                status: 'Approved',
                by: users.find(u => u.id === request.approvedBy)?.name || 'Approver',
                at: request.approvedAtTime
            };
        }
        if (request.status === 'Rejected' && request.rejectedAtTime) {
            return {
                status: 'Rejected',
                by: users.find(u => u.id === request.rejectedBy)?.name || 'Approver',
                at: request.rejectedAtTime,
                reason: request.rejectionReason
            };
        }
        if (request.status === 'Cancelled' && request.cancelledAtTime) {
            // Check if it was cancelled through approval workflow
            if (request.cancellationApprovedBy) {
                return {
                    status: 'Cancelled',
                    by: users.find(u => u.id === request.cancellationApprovedBy)?.name || 'Approver',
                    at: request.cancellationApprovedAt || request.cancelledAtTime,
                    isCancellationApproval: true,
                    originalApprovedBy: request.approvedBy ? users.find(u => u.id === request.approvedBy)?.name : null,
                    originalApprovedAt: request.approvedAtTime
                };
            } else {
                return {
                    status: 'Cancelled',
                    by: users.find(u => u.id === request.cancelledBy)?.name || 'Requester',
                    at: request.cancelledAtTime
                };
            }
        }
        return null;
    })();

    const formatDateTime = (dateString: string) => {
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return dateString;
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            return `${day}/${month}/${year} ${time}`;
        } catch (error) {
            console.error('Invalid date string:', dateString, error);
            return dateString;
        }
    };

    return (
        <div className="bg-accent/10 border border-accent/20 rounded-lg p-4 mt-4">
            <h4 className="text-sm font-semibold text-text-primary mb-2">Leave Summary</h4>
            <div className="text-sm text-text-secondary space-y-1">
                <p><strong>{usesCalendarDays ? 'Leave Days' : 'Working Days'}:</strong> {workingDays} day(s)</p>
                <p><strong>From:</strong> {formatDateWithDay(request.startDate)} ({request.startTime})</p>
                <p><strong>To:</strong> {formatDateWithDay(request.endDate)} ({request.endTime})</p>
                <p><strong>Back To Work on:</strong> {returnToWork.dayName}, {returnToWork.date} ({returnToWork.time})</p>
                
                {/* Show public holidays separately for better visibility */}
                {!usesCalendarDays && publicHolidays.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-accent/20">
                        <p className="text-xs font-medium text-text-primary mb-1">📅 Public Holidays (Excluded from Working Days):</p>
                        <div className="text-xs text-text-muted space-y-1">
                            {publicHolidays.map(holiday => (
                                <div key={holiday.date} className="flex items-start gap-2">
                                    <span className="text-yellow-500">🎉</span>
                                    <div>
                                        <span className="font-medium">{formatDateWithDay(holiday.date)}</span>
                                        {' - '}
                                        <span>{holiday.name}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                {/* Show weekends separately if any (excluding public holidays) */}
                {!usesCalendarDays && excludedDates.filter(date => !isPublicHoliday(date)).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-accent/20">
                        <p className="text-xs font-medium text-text-primary mb-1">Weekends (Excluded from Working Days):</p>
                        <div className="text-xs text-text-muted">
                            {excludedDates.filter(date => !isPublicHoliday(date)).map(date => (
                                <div key={date}>
                                    {formatDateWithDay(date)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                {/* Show approver information if requested */}
                {showApproverInfo && requester?.departmentId && (
                    <div className="mt-2 pt-2 border-t border-accent/20">
                        <p className="text-xs font-medium text-text-primary mb-1">Approval Information:</p>
                        {approvers.length > 0 ? (
                            <p className="text-xs text-text-secondary">
                                <strong>Approver(s):</strong> {approvers.map(a => a?.name).join(', ')}
                            </p>
                        ) : (
                            <p className="text-xs text-yellow-600">
                                <strong>Warning:</strong> No approvers assigned to department
                            </p>
                        )}
                        {ccEmails.length > 0 && (
                            <p className="text-xs text-text-secondary">
                                <strong>CC Emails:</strong> {ccEmails.join(', ')}
                            </p>
                        )}
                    </div>
                )}
                
                {/* Show leave balance information if available */}
                {(requester || request.requesterName) && (
                    <div className="mt-2 pt-2 border-t border-accent/20">
                        <p className="text-xs font-medium text-text-primary mb-1">Requester Leave Balance:</p>
                        <div className="text-xs text-text-secondary">
                            <p>
                                <strong>Total Annual Leave Days{lastBalanceUpdate ? ` (as of ${formatDisplayDate(lastBalanceUpdate.effectiveDate)})` : ''}:</strong> {(requester?.leaveDaysTotal ?? 0).toFixed(1)} day(s)
                            </p>
                        </div>
                    </div>
                )}

                {decisionInfo && (
                    <div className="mt-2 pt-2 border-t border-accent/20">
                        <p className="text-xs font-medium text-text-primary mb-1">Approval Activity:</p>
                        {decisionInfo.isCancellationApproval && (
                            <>
                                {request.cancellationRequestedBy && request.cancellationRequestedAt && (
                                    <p className="text-xs text-text-secondary mb-1">
                                        <strong>Cancellation Requested:</strong> {formatDateTime(request.cancellationRequestedAt)} by {users.find(u => u.id === request.cancellationRequestedBy)?.name || 'Unknown'}
                                    </p>
                                )}
                                {decisionInfo.originalApprovedBy && (
                                    <p className="text-xs text-text-secondary mb-1">
                                        <strong>Originally Approved By:</strong> {decisionInfo.originalApprovedBy}
                                        {decisionInfo.originalApprovedAt && ` on ${formatDateTime(decisionInfo.originalApprovedAt)}`}
                                    </p>
                                )}
                            </>
                        )}
                        <p className="text-xs text-text-secondary">
                            <strong>Status:</strong> {decisionInfo.status}
                        </p>
                        <p className="text-xs text-text-secondary">
                            <strong>{decisionInfo.isCancellationApproval ? 'Cancellation Approved By:' : 'By:'}</strong> {decisionInfo.by}
                        </p>
                        <p className="text-xs text-text-secondary">
                            <strong>{decisionInfo.isCancellationApproval ? 'Cancellation Approved Date & Time:' : 'Date & Time:'}</strong> {formatDateTime(decisionInfo.at)}
                        </p>
                        {decisionInfo.reason && (
                            <p className="text-xs text-red-500">
                                <strong>Reason:</strong> {decisionInfo.reason}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default LeaveSummary;
