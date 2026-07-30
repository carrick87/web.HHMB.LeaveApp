import { LeaveRequest, User } from '../types';

/** User pay group: '6' = 6-day week (Saturday included), otherwise '5'. */
export function getPayGroup(user?: User | null): string {
  return user?.payGroup === '6' ? '6' : '5';
}

/**
 * Pay group for leave day calculations on an existing request.
 * If the request is explicitly pay group 6, use it; otherwise use the requester's
 * current profile (not a stale stored request.payGroup of '5').
 */
export function resolveRequestPayGroup(
  request: Pick<LeaveRequest, 'payGroup'>,
  requester?: User | null
): string {
  if (request.payGroup === '6') return '6';
  return getPayGroup(requester);
}
