import { LeaveRequest, LeaveStatus, User } from '../types';
import { getLeaveDaysBetween } from './dateUtils';
import { resolveRequestPayGroup } from './payGroupUtils';

export interface LeaveTypeMixStat {
  leaveType: string;
  count: number;
  days: number;
}

export interface InsightRow {
  label: string;
  value: string;
  /** When set, UI can show leave-type accent and split request/day metrics */
  leaveType?: string;
  requestCount?: number;
  totalDays?: number;
}

export interface InsightSection {
  title: string;
  rows: InsightRow[];
}

export interface RequesterLeaveInsightResult {
  hasHistory: boolean;
  /** @deprecated Prefer `sections` for display */
  summary: string;
  flags: string[];
  sections: InsightSection[];
  ytdMix: LeaveTypeMixStat[];
  sameTypeYtdCount: number;
  avgNoticeDays: number | null;
  currentNoticeDays: number | null;
  avgSameTypeDays: number | null;
  currentDays: number;
  lastSameType: LeaveRequest | null;
  rejectedLast12Months: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / MS_PER_DAY);
}

function formatShortDate(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function formatDays(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} day${rounded === 1 ? '' : 's'}`;
}

function requestDays(req: LeaveRequest, requester?: User): number {
  try {
    const payGroup = resolveRequestPayGroup(req, requester);
    return getLeaveDaysBetween(
      req.startDate,
      req.endDate,
      req.startTime,
      req.endTime,
      payGroup,
      req.leaveType
    );
  } catch {
    return 1;
  }
}

function noticeDaysFor(req: LeaveRequest): number | null {
  const submittedRaw = req.requestedAtTime || req.requestedAt;
  if (!submittedRaw) return null;
  const submitted = new Date(submittedRaw.includes('T') || submittedRaw.includes(' ')
    ? submittedRaw
    : `${submittedRaw}T00:00:00`);
  if (isNaN(submitted.getTime())) return null;
  return daysBetween(submitted, parseLocalDate(req.startDate));
}

function isSameRequester(req: LeaveRequest, current: LeaveRequest): boolean {
  if (current.userId && req.userId === current.userId) return true;
  if (current.employeeNumber && req.employeeNumber && req.employeeNumber === current.employeeNumber) {
    return true;
  }
  return false;
}

function formatMixValue(stat: LeaveTypeMixStat): string {
  const requestLabel = stat.count === 1 ? 'request' : 'requests';
  return `${stat.count} ${requestLabel} · ${formatDays(stat.days)} total`;
}

/**
 * Builds factual leave-pattern insight for a requester relative to the current request.
 * Does not recommend approve/reject.
 */
export function buildRequesterLeaveInsight(
  current: LeaveRequest,
  allRequests: LeaveRequest[],
  requester?: User
): RequesterLeaveInsightResult {
  const currentDays = requestDays(current, requester);
  const currentNotice = noticeDaysFor(current);
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());

  const history = allRequests.filter(r =>
    r.id !== current.id &&
    isSameRequester(r, current) &&
    r.status !== LeaveStatus.AMENDED
  );

  if (history.length === 0) {
    return {
      hasHistory: false,
      summary: 'No prior leave requests on record.',
      flags: [],
      sections: [],
      ytdMix: [],
      sameTypeYtdCount: 0,
      avgNoticeDays: null,
      currentNoticeDays: currentNotice,
      avgSameTypeDays: null,
      currentDays,
      lastSameType: null,
      rejectedLast12Months: 0,
    };
  }

  const mixEligible = (r: LeaveRequest) =>
    r.status === LeaveStatus.APPROVED || r.status === LeaveStatus.PENDING;

  const ytdRequests = history.filter(r => {
    if (!mixEligible(r)) return false;
    const start = parseLocalDate(r.startDate);
    return start >= yearStart && start <= now;
  });

  // Include current pending request in same-type YTD count as "Nth this year"
  const sameTypeYtdPrior = ytdRequests.filter(r => r.leaveType === current.leaveType).length;
  const sameTypeYtdCount = sameTypeYtdPrior + 1;

  const mixMap = new Map<string, LeaveTypeMixStat>();
  for (const r of ytdRequests) {
    const days = requestDays(r, requester);
    const existing = mixMap.get(r.leaveType) || { leaveType: r.leaveType, count: 0, days: 0 };
    existing.count += 1;
    existing.days += days;
    mixMap.set(r.leaveType, existing);
  }
  const ytdMix = Array.from(mixMap.values()).sort((a, b) => b.days - a.days || b.count - a.count);

  const noticeSamples = history
    .filter(mixEligible)
    .map(noticeDaysFor)
    .filter((n): n is number => n !== null && n >= 0);
  const avgNoticeDays = noticeSamples.length > 0
    ? noticeSamples.reduce((s, n) => s + n, 0) / noticeSamples.length
    : null;

  const sameTypeApprovedOrPending = history.filter(
    r => r.leaveType === current.leaveType && mixEligible(r)
  );
  const sameTypeDaySamples = sameTypeApprovedOrPending.map(r => requestDays(r, requester));
  const avgSameTypeDays = sameTypeDaySamples.length > 0
    ? sameTypeDaySamples.reduce((s, n) => s + n, 0) / sameTypeDaySamples.length
    : null;

  const lastSameType = [...history]
    .filter(r => r.leaveType === current.leaveType && r.status === LeaveStatus.APPROVED)
    .sort((a, b) => parseLocalDate(b.startDate).getTime() - parseLocalDate(a.startDate).getTime())[0] || null;

  const rejectedLast12Months = history.filter(r => {
    if (r.status !== LeaveStatus.REJECTED) return false;
    const ref = r.rejectedAtTime || r.rejectedAt || r.requestedAtTime || r.requestedAt;
    if (!ref) return false;
    const d = new Date(ref.includes('T') || ref.includes(' ') ? ref : `${ref}T00:00:00`);
    return !isNaN(d.getTime()) && d >= twelveMonthsAgo;
  }).length;

  const flags: string[] = [];
  if (
    currentNotice !== null &&
    avgNoticeDays !== null &&
    noticeSamples.length >= 2 &&
    currentNotice <= Math.max(0, avgNoticeDays - 3) &&
    currentNotice <= 2
  ) {
    flags.push('Shorter notice than usual');
  } else if (currentNotice !== null && currentNotice <= 1) {
    flags.push('Short notice');
  }

  if (sameTypeYtdCount >= 3 && current.leaveType.toLowerCase().includes('sick')) {
    flags.push('Frequent sick leave this year');
  } else if (sameTypeYtdCount >= 4) {
    flags.push(`Frequent ${current.leaveType} this year`);
  }

  if (
    avgSameTypeDays !== null &&
    sameTypeDaySamples.length >= 2 &&
    currentDays >= avgSameTypeDays * 2 &&
    currentDays - avgSameTypeDays >= 2
  ) {
    flags.push('Longer than their usual requests');
  }

  const sections: InsightSection[] = [];

  const ytdRows: InsightRow[] =
    ytdMix.length > 0
      ? ytdMix.map(stat => ({
          label: stat.leaveType,
          value: formatMixValue(stat),
          leaveType: stat.leaveType,
          requestCount: stat.count,
          totalDays: stat.days,
        }))
      : [{ label: 'Recorded leave', value: 'None earlier this year' }];
  sections.push({ title: 'This year', rows: ytdRows });

  const thisRequestRows: InsightRow[] = [];
  if (sameTypeYtdPrior > 0) {
    thisRequestRows.push({
      label: 'Same type this year',
      value: `${ordinal(sameTypeYtdCount)} ${current.leaveType} request`,
    });
  }
  if (avgNoticeDays !== null && currentNotice !== null && noticeSamples.length >= 1) {
    const avgRounded = Math.round(avgNoticeDays);
    thisRequestRows.push({
      label: 'Notice',
      value: `${formatDays(currentNotice)} ahead (usual ~${formatDays(avgRounded)})`,
    });
  } else if (currentNotice !== null) {
    thisRequestRows.push({
      label: 'Notice',
      value: `${formatDays(currentNotice)} before start date`,
    });
  }
  if (avgSameTypeDays !== null && sameTypeDaySamples.length >= 2) {
    thisRequestRows.push({
      label: 'Duration',
      value: `${formatDays(currentDays)} (usual ~${formatDays(avgSameTypeDays)})`,
    });
  } else {
    thisRequestRows.push({
      label: 'Duration',
      value: formatDays(currentDays),
    });
  }
  sections.push({ title: 'This request', rows: thisRequestRows });

  if (lastSameType) {
    const lastDays = requestDays(lastSameType, requester);
    const range =
      lastSameType.startDate === lastSameType.endDate
        ? formatShortDate(lastSameType.startDate)
        : `${formatShortDate(lastSameType.startDate)}–${formatShortDate(lastSameType.endDate)}`;
    sections.push({
      title: 'Last similar leave',
      rows: [
        {
          label: current.leaveType,
          value: `${range} · ${formatDays(lastDays)} · approved`,
          leaveType: current.leaveType,
        },
      ],
    });
  }

  if (rejectedLast12Months > 0) {
    sections.push({
      title: 'Outcomes',
      rows: [
        {
          label: 'Rejected',
          value: `${rejectedLast12Months} in last 12 months`,
        },
      ],
    });
  }

  const summary = sections
    .flatMap(s => s.rows.map(r => `${r.label}: ${r.value}`))
    .slice(0, 4)
    .join('. ');

  return {
    hasHistory: true,
    summary,
    flags,
    sections,
    ytdMix,
    sameTypeYtdCount,
    avgNoticeDays,
    currentNoticeDays: currentNotice,
    avgSameTypeDays,
    currentDays,
    lastSameType,
    rejectedLast12Months,
  };
}
