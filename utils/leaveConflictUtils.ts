import { LeaveRequest, LeaveStatus } from '../types';

/**
 * Check if two date ranges overlap
 */
export function datesOverlap(
  start1: string, 
  end1: string, 
  start2: string, 
  end2: string
): boolean {
  const startDate1 = new Date(start1);
  const endDate1 = new Date(end1);
  const startDate2 = new Date(start2);
  const endDate2 = new Date(end2);

  // Check if the ranges overlap
  return startDate1 <= endDate2 && startDate2 <= endDate1;
}

/**
 * Check if a new leave request conflicts with existing requests
 */
export function checkLeaveConflicts(
  newStartDate: string,
  newEndDate: string,
  existingRequests: LeaveRequest[],
  currentUserId: string,
  excludeRequestId?: string // For amendments, exclude the original request
): {
  hasConflict: boolean;
  conflictingRequests: LeaveRequest[];
  conflictMessage: string;
} {
  const conflictingRequests: LeaveRequest[] = [];
  
  // Filter to only check requests for the same user
  const userRequests = existingRequests.filter(request => 
    request.userId === currentUserId && 
    request.id !== excludeRequestId // Exclude the request being amended
  );

  // Check for conflicts with approved or pending requests
  for (const request of userRequests) {
    if (request.status === LeaveStatus.APPROVED || request.status === LeaveStatus.PENDING) {
      if (datesOverlap(newStartDate, newEndDate, request.startDate, request.endDate)) {
        conflictingRequests.push(request);
      }
    }
  }

  const hasConflict = conflictingRequests.length > 0;
  
  let conflictMessage = '';
  if (hasConflict) {
    const approvedConflicts = conflictingRequests.filter(r => r.status === LeaveStatus.APPROVED);
    const pendingConflicts = conflictingRequests.filter(r => r.status === LeaveStatus.PENDING);
    
    if (approvedConflicts.length > 0 && pendingConflicts.length > 0) {
      conflictMessage = `Your leave request conflicts with ${approvedConflicts.length} approved and ${pendingConflicts.length} pending leave request(s).`;
    } else if (approvedConflicts.length > 0) {
      conflictMessage = `Your leave request conflicts with ${approvedConflicts.length} approved leave request(s).`;
    } else {
      conflictMessage = `Your leave request conflicts with ${pendingConflicts.length} pending leave request(s).`;
    }
    
    conflictMessage += ' Please cancel the conflicting request(s) before submitting a new one.';
  }

  return {
    hasConflict,
    conflictingRequests,
    conflictMessage
  };
}

/**
 * Format conflicting requests for display
 */
export function formatConflictingRequests(requests: LeaveRequest[]): string {
  return requests.map(request => {
    const statusText = request.status === LeaveStatus.APPROVED ? 'Approved' : 'Pending';
    return `• ${request.leaveType} (${request.startDate} to ${request.endDate}) - ${statusText}`;
  }).join('\n');
}

/**
 * Get suggested actions for conflicting requests
 */
export function getSuggestedActions(requests: LeaveRequest[]): {
  cancellableRequests: LeaveRequest[];
  message: string;
} {
  const cancellableRequests = requests.filter(r => 
    r.status === LeaveStatus.APPROVED || r.status === LeaveStatus.PENDING
  );

  let message = '';
  if (cancellableRequests.length > 0) {
    const approvedCount = cancellableRequests.filter(r => r.status === LeaveStatus.APPROVED).length;
    const pendingCount = cancellableRequests.filter(r => r.status === LeaveStatus.PENDING).length;

    const parts: string[] = [];
    if (approvedCount > 0) {
      parts.push(`${approvedCount} approved`);
    }
    if (pendingCount > 0) {
      parts.push(`${pendingCount} pending`);
    }

    message = `You can cancel ${parts.join(' and ')} request(s) to free up these dates.`;
  }

  return { cancellableRequests, message };
}
