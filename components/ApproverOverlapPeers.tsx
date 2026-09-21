import React, { useMemo } from 'react';
import {
  Department,
  LeaveRequest,
  LeaveStatus,
  User,
} from '../types';
import {
  buildApproverOverlapPeers,
  formatPeerDateRange,
} from '../utils/approverOverlapPeers';
import { getLeaveTypeHex } from '../utils/leaveTypeStyles';

const MAX_VISIBLE = 8;

interface ApproverOverlapPeersProps {
  currentUser: User;
  request: LeaveRequest;
  requests: LeaveRequest[];
  users: User[];
  departments: Department[];
}

function LeaveTypeDot({ leaveType }: { leaveType: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: getLeaveTypeHex(leaveType) }}
      aria-hidden
    />
  );
}

function StatusPill({ status }: { status: LeaveStatus }) {
  const isPending = status === LeaveStatus.PENDING;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${
        isPending
          ? 'bg-amber-500/15 text-amber-200 border-amber-500/30'
          : 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
      }`}
    >
      {isPending ? 'Pending' : 'Approved'}
    </span>
  );
}

const ApproverOverlapPeers: React.FC<ApproverOverlapPeersProps> = ({
  currentUser,
  request,
  requests,
  users,
  departments,
}) => {
  const { peers, emptyMessage } = useMemo(
    () =>
      buildApproverOverlapPeers({
        currentUser,
        request,
        requests,
        users,
        departments,
      }),
    [currentUser, request, requests, users, departments]
  );

  const visible = peers.slice(0, MAX_VISIBLE);
  const extraCount = peers.length - visible.length;

  return (
    <div className="bg-accent/10 border border-accent/20 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="text-sm font-semibold text-text-primary">Team also on leave</h4>
        {peers.length > 0 && (
          <span className="text-xs text-text-muted">
            {peers.length} {peers.length === 1 ? 'person' : 'people'}
          </span>
        )}
      </div>

      {peers.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyMessage}</p>
      ) : (
        <div className="divide-y divide-accent/20">
          {visible.map(peer => (
            <div
              key={peer.requestId}
              className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <LeaveTypeDot leaveType={String(peer.leaveType)} />
                  <span className="text-sm font-medium text-text-primary truncate">
                    {peer.name}
                  </span>
                </div>
                <p className="text-xs text-text-muted mt-0.5 truncate pl-4">
                  {peer.employeeNumber ? `${peer.employeeNumber} · ` : ''}
                  {peer.departmentName}
                </p>
                <p className="text-xs text-text-secondary mt-0.5 pl-4">
                  {String(peer.leaveType)} ·{' '}
                  {formatPeerDateRange(
                    peer.startDate,
                    peer.endDate,
                    peer.startTime,
                    peer.endTime
                  )}
                  {peer.overlapDays > 0 && (
                    <span className="text-text-muted">
                      {' '}
                      ({peer.overlapDays} overlap {peer.overlapDays === 1 ? 'day' : 'days'})
                    </span>
                  )}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-surface-light text-text-primary border border-border">
                  {peer.dayPartLabel || `${peer.startTime} → ${peer.endTime}`}
                </span>
                <StatusPill status={peer.status} />
              </div>
            </div>
          ))}
          {extraCount > 0 && (
            <p className="text-xs text-primary pt-2">+{extraCount} more</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ApproverOverlapPeers;
