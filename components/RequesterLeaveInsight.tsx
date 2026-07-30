import React from 'react';
import { LeaveRequest, User } from '../types';
import {
  buildRequesterLeaveInsight,
  InsightRow,
} from '../utils/requesterLeaveInsights';
import { getLeaveTypeHex } from '../utils/leaveTypeStyles';

interface RequesterLeaveInsightProps {
  request: LeaveRequest;
  requests: LeaveRequest[];
  users: User[];
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

function MetricPills({ row }: { row: InsightRow }) {
  if (row.requestCount == null && row.totalDays == null) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 justify-end">
      {row.requestCount != null && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-surface-light text-text-primary border border-border">
          {row.requestCount} {row.requestCount === 1 ? 'request' : 'requests'}
        </span>
      )}
      {row.totalDays != null && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-surface-light text-text-primary border border-border">
          {Number.isInteger(row.totalDays)
            ? row.totalDays
            : Math.round(row.totalDays * 10) / 10}{' '}
          {row.totalDays === 1 ? 'day' : 'days'}
        </span>
      )}
    </div>
  );
}

function InsightRowView({ row, emphasizeValue }: { row: InsightRow; emphasizeValue?: boolean }) {
  const showPills = row.requestCount != null;
  const usualSplit = !showPills ? row.value.match(/^(.*?)\s*\((usual .+)\)$/) : null;
  const primaryValue = usualSplit ? usualSplit[1] : row.value;
  const secondaryValue = usualSplit ? usualSplit[2] : null;

  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        {row.leaveType && <LeaveTypeDot leaveType={row.leaveType} />}
        <span className="text-sm text-text-secondary truncate">{row.label}</span>
      </div>
      {showPills ? (
        <MetricPills row={row} />
      ) : (
        <div className="text-right min-w-0">
          <span
            className={`text-sm block ${
              emphasizeValue ? 'text-text-primary font-semibold' : 'text-text-primary font-medium'
            }`}
          >
            {primaryValue}
          </span>
          {secondaryValue && (
            <span className="text-xs text-text-muted block mt-0.5">{secondaryValue}</span>
          )}
        </div>
      )}
    </div>
  );
}

const RequesterLeaveInsight: React.FC<RequesterLeaveInsightProps> = ({
  request,
  requests,
  users,
}) => {
  const requester = users.find(u => u.id === request.userId);
  const insight = buildRequesterLeaveInsight(request, requests, requester);

  return (
    <div className="bg-accent/10 border border-accent/20 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="text-sm font-semibold text-text-primary">Requester leave insight</h4>
        {insight.flags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {insight.flags.map(flag => (
              <span
                key={flag}
                className="inline-block text-xs px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-200 border border-amber-500/30"
              >
                {flag}
              </span>
            ))}
          </div>
        )}
      </div>

      {!insight.hasHistory ? (
        <p className="text-sm text-text-muted">{insight.summary}</p>
      ) : (
        <div className="divide-y divide-accent/20">
          {insight.sections.map(section => (
            <div key={section.title} className="py-2.5 first:pt-0 last:pb-0">
              <p className="text-xs font-medium text-text-muted mb-1">{section.title}</p>
              <div>
                {section.rows.map(row => (
                  <InsightRowView
                    key={`${section.title}-${row.label}`}
                    row={row}
                    emphasizeValue={section.title === 'This request'}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RequesterLeaveInsight;
