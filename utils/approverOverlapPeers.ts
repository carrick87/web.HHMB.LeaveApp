import {
  Department,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  User,
} from '../types';

export interface OverlapPeer {
  requestId: string;
  userId: string;
  name: string;
  employeeNumber: string;
  departmentName: string;
  leaveType: LeaveType | string;
  startDate: string;
  endDate: string;
  startTime: 'AM' | 'PM';
  endTime: 'AM' | 'PM';
  /** Single-day leave: Full day / AM / PM. Multi-day: empty (times shown on dates). */
  dayPartLabel: string;
  status: LeaveStatus;
  /** Inclusive calendar overlap days with the current request (date-only). */
  overlapDays: number;
}

export interface ApproverOverlapPeersResult {
  peers: OverlapPeer[];
  emptyMessage: string;
}

const EMPTY_NO_PEERS =
  'No other team members under you overlap these dates.';

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatShortDate(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Inclusive calendar-day overlap count for two YYYY-MM-DD ranges. */
export function countOverlapDays(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): number {
  if (aStart > aEnd || bStart > bEnd) return 0;
  if (aStart > bEnd || bStart > aEnd) return 0;
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  const ms =
    parseLocalDate(end).getTime() - parseLocalDate(start).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

/** Overall day-part for a single-day request (Full day / AM / PM). */
export function getRequestDayPartLabel(
  startDate: string,
  endDate: string,
  startTime: 'AM' | 'PM',
  endTime: 'AM' | 'PM'
): string {
  if (startDate !== endDate) return '';
  if (startTime === 'AM' && endTime === 'PM') return 'Full day';
  if (startTime === 'AM' && endTime === 'AM') return 'AM';
  if (startTime === 'PM' && endTime === 'PM') return 'PM';
  return 'Full day';
}

export function formatPeerDateRange(
  startDate: string,
  endDate: string,
  startTime?: 'AM' | 'PM',
  endTime?: 'AM' | 'PM'
): string {
  if (startDate === endDate) {
    return formatShortDate(startDate);
  }
  if (startTime && endTime) {
    return `${formatShortDate(startDate)} (${startTime}) – ${formatShortDate(endDate)} (${endTime})`;
  }
  return `${formatShortDate(startDate)} – ${formatShortDate(endDate)}`;
}

function datesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Departments where the current user is listed on `approverIds`.
 * If none (e.g. Super Admin not on any list), fall back to the requester's department.
 */
function resolvePeerDepartmentIds(
  currentUser: User,
  request: LeaveRequest,
  users: User[],
  departments: Department[]
): Set<string> {
  const asApprover = new Set(
    departments
      .filter(d => d.approverIds?.includes(currentUser.id))
      .map(d => d.id)
  );

  if (asApprover.size > 0) return asApprover;

  const requester =
    users.find(u => u.id === request.userId) ||
    (request.employeeNumber
      ? users.find(u => u.employeeNumber === request.employeeNumber)
      : undefined);
  const deptId = requester?.departmentId || request.requesterDepartmentId;
  if (deptId) return new Set([deptId]);
  return new Set();
}

function resolveUser(
  request: LeaveRequest,
  users: User[]
): User | undefined {
  return (
    users.find(u => u.id === request.userId) ||
    (request.employeeNumber
      ? users.find(u => u.employeeNumber === request.employeeNumber)
      : undefined)
  );
}

export function buildApproverOverlapPeers(args: {
  currentUser: User;
  request: LeaveRequest;
  requests: LeaveRequest[];
  users: User[];
  departments: Department[];
}): ApproverOverlapPeersResult {
  const { currentUser, request, requests, users, departments } = args;
  const peerDeptIds = resolvePeerDepartmentIds(
    currentUser,
    request,
    users,
    departments
  );

  if (peerDeptIds.size === 0) {
    return { peers: [], emptyMessage: EMPTY_NO_PEERS };
  }

  const departmentsById = new Map(departments.map(d => [d.id, d]));
  const requesterIds = new Set<string>([request.userId].filter(Boolean));
  if (request.employeeNumber) {
    users
      .filter(u => u.employeeNumber === request.employeeNumber)
      .forEach(u => requesterIds.add(u.id));
  }

  const peers: OverlapPeer[] = [];

  for (const other of requests) {
    if (other.id === request.id) continue;
    if (
      other.status !== LeaveStatus.PENDING &&
      other.status !== LeaveStatus.APPROVED
    ) {
      continue;
    }
    if (!datesOverlap(request.startDate, request.endDate, other.startDate, other.endDate)) {
      continue;
    }

    const otherUser = resolveUser(other, users);
    if (!otherUser) continue;
    if (requesterIds.has(otherUser.id)) continue;
    if (request.employeeNumber && otherUser.employeeNumber === request.employeeNumber) {
      continue;
    }

    const deptId = otherUser.departmentId || other.requesterDepartmentId;
    if (!deptId || !peerDeptIds.has(deptId)) continue;

    const dept = departmentsById.get(deptId);
    const startTime = other.startTime === 'PM' ? 'PM' : 'AM';
    const endTime = other.endTime === 'AM' ? 'AM' : 'PM';
    peers.push({
      requestId: other.id,
      userId: otherUser.id,
      name: otherUser.name || other.requesterName || 'Unknown',
      employeeNumber: otherUser.employeeNumber || other.employeeNumber || '',
      departmentName: dept?.name || 'Unknown',
      leaveType: other.leaveType,
      startDate: other.startDate,
      endDate: other.endDate,
      startTime,
      endTime,
      dayPartLabel: getRequestDayPartLabel(
        other.startDate,
        other.endDate,
        startTime,
        endTime
      ),
      status: other.status,
      overlapDays: countOverlapDays(
        request.startDate,
        request.endDate,
        other.startDate,
        other.endDate
      ),
    });
  }

  peers.sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
    return a.name.localeCompare(b.name);
  });

  return { peers, emptyMessage: EMPTY_NO_PEERS };
}
