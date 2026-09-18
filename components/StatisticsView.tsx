import React, { useState, useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    PieChart,
    Pie,
    Cell,
    LabelList,
    LineChart,
    Line,
} from 'recharts';
import { User, UserRole, Department, LeaveRequest, LeaveStatus, LeaveType, Branch } from '../types';
import { shouldExcludeDateForLeave } from '../utils/dateUtils';
import { resolveRequestPayGroup } from '../utils/payGroupUtils';
import { getEffectiveUserBranch, formatBranchLabel } from '../utils/departmentSettingsHelpers';

/** Measures container width after layout (fixes mobile flex / overflow-hidden giving 0 width). */
const ChartWrapper: React.FC<{ height: number; children: (width: number) => React.ReactNode }> = ({ height, children }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;

        const measure = () => {
            let w = el.getBoundingClientRect().width;
            if (w <= 0 && el.parentElement) {
                w = el.parentElement.getBoundingClientRect().width;
            }
            if (w > 0) setWidth(Math.floor(w));
        };

        measure();
        const t1 = requestAnimationFrame(() => {
            measure();
            requestAnimationFrame(measure);
        });

        const ro = new ResizeObserver(() => measure());
        ro.observe(el);
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);

        return () => {
            cancelAnimationFrame(t1);
            ro.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
        };
    }, []);

    return (
        <div ref={ref} className="block w-full min-w-0 max-w-full box-border" style={{ height }}>
            {width > 0 ? children(width) : <div className="w-full" style={{ height }} aria-hidden />}
        </div>
    );
};

interface StatisticsViewProps {
    currentUser: User;
    users: User[];
    departments: Department[];
    leaveRequests: LeaveRequest[];
    branches: Branch[];
}

const STATUS_COLORS: Record<string, string> = {
    [LeaveStatus.APPROVED]: '#22c55e',
    [LeaveStatus.PENDING]: '#eab308',
    [LeaveStatus.REJECTED]: '#ef4444',
    [LeaveStatus.CANCELLED]: '#6b7280',
    [LeaveStatus.CANCELLATION_PENDING]: '#f97316',
    [LeaveStatus.AMENDED]: '#8b5cf6',
};

const LEAVE_TYPE_COLORS = ['#3b82f6', '#06b6d4', '#a855f7', '#f43f5e', '#10b981', '#f59e0b', '#64748b'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface OrgGroupStats {
    employees: number;
    active: number;
    onLeave: number;
    pctHead: string;
    pending: number;
    ytd: number;
    avgApprovalH: number | null;
}

function parseDateMs(s?: string): number | null {
    if (!s) return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
}

function approvalLeadTimeHours(r: LeaveRequest): number | null {
    const start = r.requestedAtTime ?? `${r.requestedAt}T12:00:00`;
    const end = r.approvedAtTime ?? r.approvedAt;
    const a = parseDateMs(start);
    const b = parseDateMs(end);
    if (a === null || b === null) return null;
    return Math.max(0, (b - a) / 3600000);
}

function formatTrend(curr: number, prev: number): string {
    if (!Number.isFinite(curr) || !Number.isFinite(prev)) return '';
    if (prev === 0 && curr === 0) return '0% vs last year';
    if (prev === 0) return '—';
    const pct = ((curr - prev) / prev) * 100;
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}% vs last year`;
}

function formatAvgLeadTime(h: number | null): string {
    if (h === null) return '—';
    if (h < 48) return `${h.toFixed(1)} h`;
    return `${(h / 24).toFixed(1)} d`;
}

function escapeCsvCell(v: string): string {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
}

function resolvePayGroup(request: LeaveRequest, userById: Map<string, User>): string {
    return resolveRequestPayGroup(request, userById.get(request.userId));
}

/**
 * "On leave today" only counts when today is actually a working day for the
 * employee. Paygroup '5' staff don't work Saturdays, paygroup '6' do; nobody
 * works on public holidays. Skipping these excluded days prevents false
 * positives like a Fri–Mon leave being counted on the Saturday in between.
 */
function isOnLeaveToday(request: LeaveRequest, today: string, payGroup: string = '5'): boolean {
    if (request.status !== LeaveStatus.APPROVED) return false;
    if (request.startDate > today || request.endDate < today) return false;
    if (shouldExcludeDateForLeave(request.leaveType, today, payGroup)) return false;
    return true;
}

function computeGroupStats(
    userIds: Set<string>,
    rosterUsers: User[],
    filteredRequests: LeaveRequest[],
    allLeaveRequests: LeaveRequest[],
    today: string,
    userById: Map<string, User>
): OrgGroupStats {
    const usersIn = rosterUsers.filter(u => userIds.has(u.id));
    const employees = usersIn.length;
    const active = usersIn.filter(u => u.isActive).length;
    const onLeave = allLeaveRequests.filter(
        r => userIds.has(r.userId) && isOnLeaveToday(r, today, resolvePayGroup(r, userById))
    ).length;
    const reqs = filteredRequests.filter(r => userIds.has(r.userId));
    const pending = reqs.filter(r => r.status === LeaveStatus.PENDING || r.status === LeaveStatus.CANCELLATION_PENDING).length;
    const times: number[] = [];
    reqs.forEach(r => {
        if (r.status !== LeaveStatus.APPROVED) return;
        const h = approvalLeadTimeHours(r);
        if (h !== null) times.push(h);
    });
    const avgH = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    const pctHead = active > 0 ? ((onLeave / active) * 100).toFixed(1) : '0.0';
    return { employees, active, onLeave, pctHead, pending, ytd: reqs.length, avgApprovalH: avgH };
}

const CustomTooltip: React.FC<{ active?: boolean; payload?: any[]; label?: string }> = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
        <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 shadow-lg text-xs">
            <p className="text-slate-300 font-medium mb-1">{label}</p>
            {payload.map((p: any, i: number) => (
                <p key={i} style={{ color: p.color }} className="leading-5">
                    {p.name}: <span className="font-semibold">{p.value}</span>
                </p>
            ))}
        </div>
    );
};

const PieTooltip: React.FC<{ active?: boolean; payload?: any[] }> = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;
    const item = payload[0];
    return (
        <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 shadow-lg text-xs">
            <p style={{ color: item.payload.fill }} className="font-semibold">{item.name}</p>
            <p className="text-slate-300">Count: <span className="font-semibold text-white">{item.value}</span></p>
            <p className="text-slate-300">Share: <span className="font-semibold text-white">{item.payload.pct}%</span></p>
        </div>
    );
};

interface KpiCardProps {
    label: string;
    value: number | string;
    sub?: string;
    trend?: string;
    accent?: string;
    icon: string;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, sub, trend, accent = 'text-primary', icon }) => (
    <div className="bg-card-bg border border-border rounded-xl p-4 sm:p-5 flex flex-col gap-1.5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
            <span className="text-text-muted text-xs font-medium uppercase tracking-wide leading-tight">{label}</span>
            <span className="text-2xl flex-shrink-0" aria-hidden>{icon}</span>
        </div>
        <p className={`text-2xl sm:text-3xl font-bold ${accent} tabular-nums`}>{value}</p>
        {trend ? <p className="text-text-muted text-xs tabular-nums">{trend}</p> : null}
        {sub && <p className="text-text-muted text-xs">{sub}</p>}
    </div>
);

const StatisticsView: React.FC<StatisticsViewProps> = ({ currentUser, users, departments, leaveRequests, branches }) => {
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedLeaveType, setSelectedLeaveType] = useState<string>('all');
    const [lastUpdated, setLastUpdated] = useState(() => new Date());
    const [branchExpanded, setBranchExpanded] = useState<Record<string, boolean>>({});
    const [deptExpanded, setDeptExpanded] = useState<Record<string, boolean>>({});

    const catalogCodes = useMemo(
        () => new Set(branches.filter((b) => b.isActive !== false).map((b) => b.code)),
        [branches]
    );
    const branchByCode = useMemo(() => {
        const map = new Map<string, Branch>();
        branches.forEach((b) => map.set(b.code, b));
        return map;
    }, [branches]);
    const labelFor = (code: string) => {
        const b = branchByCode.get(code);
        return b ? formatBranchLabel(b) : `Branch ${code}`;
    };

    const today = new Date().toISOString().split('T')[0]!;

    // --- Scope users by role ---
    const scopedUsers = useMemo<User[]>(() => {
        if (currentUser.role === UserRole.SUPER_ADMIN) return users;

        if (currentUser.role === UserRole.ADMIN) {
            const adminBranches = currentUser.branches ?? [];
            return users.filter(u => {
                const branch = getEffectiveUserBranch(u);
                return adminBranches.includes(branch);
            });
        }

        // Approver (Normal): users in departments where this user is an approver
        const approverDeptIds = departments
            .filter(d => d.approverIds?.includes(currentUser.id))
            .map(d => d.id);
        return users.filter(u => u.departmentId && approverDeptIds.includes(u.departmentId));
    }, [currentUser, users, departments]);

    const scopedUserIds = useMemo(() => new Set(scopedUsers.map(u => u.id)), [scopedUsers]);

    // --- Determine which branches are available in this scope ---
    const availableBranches = useMemo<string[]>(() => {
        const set = new Set<string>();
        scopedUsers.forEach(u => {
            const b = getEffectiveUserBranch(u);
            if (b && (catalogCodes.size === 0 || catalogCodes.has(b))) set.add(b);
        });
        const ordered = branches
            .filter((b) => b.isActive !== false && set.has(b.code))
            .map((b) => b.code);
        const extras = [...set].filter((c) => !ordered.includes(c)).sort();
        return [...ordered, ...extras];
    }, [scopedUsers, branches, catalogCodes]);

    const showBranchFilter = availableBranches.length > 1;

    // --- Branch-filtered users ---
    const branchFilteredUsers = useMemo<User[]>(() => {
        if (selectedBranch === 'all') return scopedUsers;
        return scopedUsers.filter(u => getEffectiveUserBranch(u) === selectedBranch);
    }, [scopedUsers, selectedBranch]);

    const branchFilteredUserIds = useMemo(() => new Set(branchFilteredUsers.map(u => u.id)), [branchFilteredUsers]);

    // --- Scoped requests (year + branch) ---
    const yearBranchRequests = useMemo<LeaveRequest[]>(() => {
        return leaveRequests.filter(r => {
            if (!branchFilteredUserIds.has(r.userId)) return false;
            const year = parseInt(r.requestedAt?.substring(0, 4) ?? r.startDate.substring(0, 4), 10);
            return year === selectedYear;
        });
    }, [leaveRequests, branchFilteredUserIds, selectedYear]);

    // Unique leave types from all scoped year-branch requests
    const availableLeaveTypes = useMemo<string[]>(() => {
        const set = new Set<string>();
        yearBranchRequests.forEach(r => set.add(r.leaveType));
        return Array.from(set).sort();
    }, [yearBranchRequests]);

    // Final filtered requests
    const filteredRequests = useMemo<LeaveRequest[]>(() => {
        if (selectedLeaveType === 'all') return yearBranchRequests;
        return yearBranchRequests.filter(r => r.leaveType === selectedLeaveType);
    }, [yearBranchRequests, selectedLeaveType]);

    const prevYearBranchRequests = useMemo<LeaveRequest[]>(() => {
        const y = selectedYear - 1;
        return leaveRequests.filter(r => {
            if (!branchFilteredUserIds.has(r.userId)) return false;
            const year = parseInt(r.requestedAt?.substring(0, 4) ?? r.startDate.substring(0, 4), 10);
            return year === y;
        });
    }, [leaveRequests, branchFilteredUserIds, selectedYear]);

    const prevFilteredRequests = useMemo<LeaveRequest[]>(() => {
        if (selectedLeaveType === 'all') return prevYearBranchRequests;
        return prevYearBranchRequests.filter(r => r.leaveType === selectedLeaveType);
    }, [prevYearBranchRequests, selectedLeaveType]);

    useEffect(() => {
        setLastUpdated(new Date());
    }, [selectedYear, selectedBranch, selectedLeaveType, branchFilteredUserIds]);

    const userById = useMemo(() => {
        const m = new Map<string, User>();
        users.forEach(u => m.set(u.id, u));
        return m;
    }, [users]);

    const deptById = useMemo(() => {
        const m = new Map<string, Department>();
        departments.forEach(d => m.set(d.id, d));
        return m;
    }, [departments]);

    // --- KPI derivations ---
    const activeEmployees = useMemo(() => branchFilteredUsers.filter(u => u.isActive).length, [branchFilteredUsers]);
    const inactiveEmployees = branchFilteredUsers.length - activeEmployees;

    const pendingCount = useMemo(
        () => filteredRequests.filter(r => r.status === LeaveStatus.PENDING || r.status === LeaveStatus.CANCELLATION_PENDING).length,
        [filteredRequests]
    );

    const prevPendingCount = useMemo(
        () => prevFilteredRequests.filter(r => r.status === LeaveStatus.PENDING || r.status === LeaveStatus.CANCELLATION_PENDING).length,
        [prevFilteredRequests]
    );

    const onLeaveTodayCount = useMemo(
        () => {
            // Use scoped users (not just year-filtered) for today check
            const scopedOnLeave = leaveRequests.filter(
                r => branchFilteredUserIds.has(r.userId) && isOnLeaveToday(r, today, resolvePayGroup(r, userById))
            );
            if (selectedLeaveType === 'all') return scopedOnLeave.length;
            return scopedOnLeave.filter(r => r.leaveType === selectedLeaveType).length;
        },
        [leaveRequests, branchFilteredUserIds, today, selectedLeaveType, userById]
    );

    // --- Monthly Trend ---
    const monthlyData = useMemo(() => {
        return MONTHS.map((month, idx) => {
            const monthStr = String(idx + 1).padStart(2, '0');
            const monthRequests = filteredRequests.filter(r => {
                const d = r.requestedAt ?? r.startDate;
                return d.substring(5, 7) === monthStr;
            });
            return {
                month,
                [LeaveStatus.APPROVED]: monthRequests.filter(r => r.status === LeaveStatus.APPROVED).length,
                [LeaveStatus.PENDING]: monthRequests.filter(r => r.status === LeaveStatus.PENDING || r.status === LeaveStatus.CANCELLATION_PENDING).length,
                [LeaveStatus.REJECTED]: monthRequests.filter(r => r.status === LeaveStatus.REJECTED).length,
                [LeaveStatus.CANCELLED]: monthRequests.filter(r => r.status === LeaveStatus.CANCELLED).length,
            };
        });
    }, [filteredRequests]);

    // --- Status Breakdown for Pie ---
    const statusData = useMemo(() => {
        const totals: Record<string, number> = {};
        filteredRequests.forEach(r => {
            const key = r.status === LeaveStatus.CANCELLATION_PENDING ? LeaveStatus.CANCELLATION_PENDING : r.status;
            totals[key] = (totals[key] ?? 0) + 1;
        });
        const total = filteredRequests.length || 1;
        return Object.entries(totals)
            .filter(([, v]) => v > 0)
            .map(([status, count]) => ({
                name: status,
                value: count,
                pct: ((count / total) * 100).toFixed(1),
                fill: STATUS_COLORS[status] ?? '#64748b',
            }));
    }, [filteredRequests]);

    // --- Leave Type Breakdown ---
    const leaveTypeData = useMemo(() => {
        const totals: Record<string, number> = {};
        filteredRequests.forEach(r => { totals[r.leaveType] = (totals[r.leaveType] ?? 0) + 1; });
        const total = filteredRequests.length || 1;
        return Object.entries(totals)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count], i) => ({
                type,
                count,
                pct: ((count / total) * 100).toFixed(1),
                fill: LEAVE_TYPE_COLORS[i % LEAVE_TYPE_COLORS.length]!,
            }));
    }, [filteredRequests]);

    // Set of user IDs that have ever submitted a leave request (any year, any status).
    const usersWithAnyRequest = useMemo(() => {
        const set = new Set<string>();
        leaveRequests.forEach(r => set.add(r.userId));
        return set;
    }, [leaveRequests]);

    // Active employees in scope (after branch filter) who have ever applied leave.
    const everAppliedActive = useMemo(
        () => branchFilteredUsers.filter(u => u.isActive && usersWithAnyRequest.has(u.id)).length,
        [branchFilteredUsers, usersWithAnyRequest]
    );
    const everAppliedPct = activeEmployees > 0 ? (everAppliedActive / activeEmployees) * 100 : null;

    // --- Branch Breakdown Table ---
    const branchTableData = useMemo(() => {
        return availableBranches.map(branch => {
            const branchUsers = scopedUsers.filter(u => getEffectiveUserBranch(u) === branch);
            const branchUserIds = new Set(branchUsers.map(u => u.id));
            const branchReqs = leaveRequests.filter(r => branchUserIds.has(r.userId));
            const branchYearReqs = branchReqs.filter(r => {
                const year = parseInt(r.requestedAt?.substring(0, 4) ?? r.startDate.substring(0, 4), 10);
                return year === selectedYear;
            });
            const onLeave = branchReqs.filter(r => isOnLeaveToday(r, today, resolvePayGroup(r, userById))).length;
            const active = branchUsers.filter(u => u.isActive).length;
            const applied = branchUsers.filter(u => u.isActive && usersWithAnyRequest.has(u.id)).length;
            const appliedPct = active > 0 ? ((applied / active) * 100).toFixed(1) : '0.0';
            const pending = branchYearReqs.filter(r => r.status === LeaveStatus.PENDING || r.status === LeaveStatus.CANCELLATION_PENDING).length;
            const pct = active > 0 ? ((onLeave / active) * 100).toFixed(1) : '0.0';
            return {
                branch,
                label: labelFor(branch),
                total: branchUsers.length,
                active,
                applied,
                appliedPct,
                onLeave,
                pct,
                pending,
                ytd: branchYearReqs.length,
            };
        });
    }, [availableBranches, scopedUsers, leaveRequests, selectedYear, today, usersWithAnyRequest, userById, branchByCode]);

    const dayOfWeekData = useMemo(() => {
        const counts: Record<string, number> = {};
        WEEKDAY_ORDER.forEach(d => { counts[d] = 0; });
        filteredRequests.forEach(r => {
            const raw = r.requestedAt ?? r.startDate;
            const t = parseDateMs(raw);
            if (t === null) return;
            const js = new Date(t).getDay();
            const idx = (js + 6) % 7;
            const label = WEEKDAY_ORDER[idx]!;
            counts[label] = (counts[label] ?? 0) + 1;
        });
        return WEEKDAY_ORDER.map(name => ({ name, count: counts[name] ?? 0 }));
    }, [filteredRequests]);

    const leadTimesCurrent = useMemo(() => {
        const hrs: number[] = [];
        filteredRequests.forEach(r => {
            if (r.status !== LeaveStatus.APPROVED) return;
            const h = approvalLeadTimeHours(r);
            if (h !== null) hrs.push(h);
        });
        return hrs;
    }, [filteredRequests]);

    const leadTimesPrev = useMemo(() => {
        const hrs: number[] = [];
        prevFilteredRequests.forEach(r => {
            if (r.status !== LeaveStatus.APPROVED) return;
            const h = approvalLeadTimeHours(r);
            if (h !== null) hrs.push(h);
        });
        return hrs;
    }, [prevFilteredRequests]);

    const avgApprovalHours = useMemo(
        () => (leadTimesCurrent.length ? leadTimesCurrent.reduce((a, b) => a + b, 0) / leadTimesCurrent.length : null),
        [leadTimesCurrent]
    );
    const prevAvgApprovalHours = useMemo(
        () => (leadTimesPrev.length ? leadTimesPrev.reduce((a, b) => a + b, 0) / leadTimesPrev.length : null),
        [leadTimesPrev]
    );

    const decidedCurrent = useMemo(
        () => filteredRequests.filter(r => r.status === LeaveStatus.APPROVED || r.status === LeaveStatus.REJECTED),
        [filteredRequests]
    );
    const decidedPrev = useMemo(
        () => prevFilteredRequests.filter(r => r.status === LeaveStatus.APPROVED || r.status === LeaveStatus.REJECTED),
        [prevFilteredRequests]
    );
    const approvalRatePct = useMemo(() => {
        if (decidedCurrent.length === 0) return null;
        const ap = decidedCurrent.filter(r => r.status === LeaveStatus.APPROVED).length;
        return (ap / decidedCurrent.length) * 100;
    }, [decidedCurrent]);
    const prevApprovalRatePct = useMemo(() => {
        if (decidedPrev.length === 0) return null;
        const ap = decidedPrev.filter(r => r.status === LeaveStatus.APPROVED).length;
        return (ap / decidedPrev.length) * 100;
    }, [decidedPrev]);

    /** Pie chart: requests grouped by employee branch (always). */
    const requestsByBranchDonutData = useMemo(() => {
        const totals: Record<string, number> = {};
        filteredRequests.forEach(r => {
            const u = userById.get(r.userId);
            const b = u ? getEffectiveUserBranch(u) : '';
            const label = b
                ? (catalogCodes.size === 0 || catalogCodes.has(b) ? labelFor(b) : `Branch ${b}`)
                : 'Unknown';
            totals[label] = (totals[label] ?? 0) + 1;
        });
        const total = filteredRequests.length || 1;
        const palette = [...LEAVE_TYPE_COLORS, '#ec4899', '#14b8a6', '#f97316'];
        return Object.entries(totals)
            .filter(([, c]) => c > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count], i) => ({
                name: name.length > 28 ? `${name.slice(0, 26)}…` : name,
                value: count,
                pct: ((count / total) * 100).toFixed(1),
                fill: palette[i % palette.length]!,
            }));
    }, [filteredRequests, userById, catalogCodes, branchByCode]);

    /** Branch → departments (A–Z) → employees (A–Z) for drill-down table. */
    const departmentHierarchy = useMemo(() => {
        const byBranch = new Map<string, User[]>();
        branchFilteredUsers.forEach(u => {
            const raw = getEffectiveUserBranch(u);
            const key = raw && (catalogCodes.size === 0 || catalogCodes.has(raw)) ? raw : '_other';
            if (!byBranch.has(key)) byBranch.set(key, []);
            byBranch.get(key)!.push(u);
        });

        const branchKeys: string[] = [];
        availableBranches.forEach(b => {
            if (byBranch.has(b)) branchKeys.push(b);
        });
        if (byBranch.has('_other')) branchKeys.push('_other');

        return branchKeys.map(branchCode => {
            const users = byBranch.get(branchCode)!;
            const byDept = new Map<string, User[]>();
            users.forEach(u => {
                const id = u.departmentId ?? '_none';
                if (!byDept.has(id)) byDept.set(id, []);
                byDept.get(id)!.push(u);
            });

            const departments = Array.from(byDept.entries())
                .map(([deptId, ulist]) => {
                    const name =
                        deptId === '_none'
                            ? 'Unassigned'
                            : (deptById.get(deptId)?.name ?? 'Unknown');
                    const userIdSet = new Set(ulist.map(u => u.id));
                    const stats = computeGroupStats(
                        userIdSet,
                        branchFilteredUsers,
                        filteredRequests,
                        leaveRequests,
                        today,
                        userById
                    );
                    const employees = ulist
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                        .map(u => ({
                            user: u,
                            stats: computeGroupStats(
                                new Set([u.id]),
                                branchFilteredUsers,
                                filteredRequests,
                                leaveRequests,
                                today,
                                userById
                            ),
                        }));
                    return { id: deptId, name, stats, employees };
                })
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

            const allIds = new Set(users.map(u => u.id));
            const aggregate = computeGroupStats(
                allIds,
                branchFilteredUsers,
                filteredRequests,
                leaveRequests,
                today,
                userById
            );
            const label =
                branchCode === '_other'
                    ? 'Other / unmapped branch'
                    : labelFor(branchCode);

            return { branch: branchCode, label, aggregate, departments };
        });
    }, [
        branchFilteredUsers,
        availableBranches,
        deptById,
        filteredRequests,
        leaveRequests,
        today,
        userById,
    ]);

    const leaveBalanceSnapshot = useMemo(() => {
        const activeList = branchFilteredUsers.filter(u => u.isActive);
        const low = activeList.filter(u => u.leaveDaysTotal <= 3).length;
        const high = activeList.filter(u => u.leaveDaysTotal >= 15).length;
        return { low, high, total: activeList.length };
    }, [branchFilteredUsers]);

    const quickInsights = useMemo(() => {
        const out: string[] = [];
        if (pendingCount > 10) {
            out.push(`Pending queue is elevated (${pendingCount} requests). Consider prioritizing approvals.`);
        }
        if (approvalRatePct !== null && decidedCurrent.length >= 5 && approvalRatePct < 70) {
            out.push(`Approval rate is ${approvalRatePct.toFixed(0)}% — rejection volume may warrant a review.`);
        }
        if (activeEmployees > 0 && onLeaveTodayCount / activeEmployees > 0.15) {
            out.push(`About ${((onLeaveTodayCount / activeEmployees) * 100).toFixed(0)}% of active staff are on leave today.`);
        }
        if (leaveTypeData[0] && filteredRequests.length >= 5) {
            const top = leaveTypeData[0]!;
            const share = (top.count / filteredRequests.length) * 100;
            if (share > 40) {
                out.push(`"${top.type}" accounts for ${share.toFixed(0)}% of requests in this view.`);
            }
        }
        if (avgApprovalHours !== null && avgApprovalHours > 48) {
            out.push(`Average approval time is about ${(avgApprovalHours / 24).toFixed(1)} days.`);
        }
        if (out.length === 0) {
            out.push('No notable patterns for the current filters — volumes look typical.');
        }
        return out.slice(0, 4);
    }, [pendingCount, approvalRatePct, decidedCurrent.length, activeEmployees, onLeaveTodayCount, leaveTypeData, filteredRequests.length, avgApprovalHours]);

    const yearOptions = [currentYear - 1, currentYear, currentYear + 1].filter(y => y <= currentYear + 1);

    const exportCsv = () => {
        const headers = ['id', 'userId', 'leaveType', 'status', 'startDate', 'endDate', 'requestedAt', 'approvedAt', 'rejectedAt'];
        const lines = [headers.join(',')];
        filteredRequests.forEach(r => {
            const row = [
                r.id,
                r.userId,
                String(r.leaveType),
                r.status,
                r.startDate,
                r.endDate,
                r.requestedAt ?? '',
                r.approvedAt ?? '',
                r.rejectedAt ?? '',
            ].map(v => escapeCsvCell(String(v ?? '')));
            lines.push(row.join(','));
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `leave-statistics-${selectedYear}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const deptRowKey = (branchCode: string, deptId: string) => `${branchCode}::${deptId}`;

    const renderStatsCells = (s: OrgGroupStats) => (
        <>
            <td className="px-4 py-3 text-right text-text-secondary tabular-nums">{s.employees}</td>
            <td className="px-4 py-3 text-right text-emerald-400 font-medium tabular-nums">{s.active}</td>
            <td className="px-4 py-3 text-right">
                <span className={s.onLeave > 0 ? 'text-orange-400 font-medium' : 'text-text-muted'}>{s.onLeave}</span>
            </td>
            <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                    <div className="w-16 bg-slate-700 rounded-full h-1.5">
                        <div
                            className="bg-orange-400/80 h-1.5 rounded-full"
                            style={{ width: `${Math.min(100, parseFloat(s.pctHead))}%` }}
                        />
                    </div>
                    <span className="text-text-muted text-xs w-10 text-right">{s.pctHead}%</span>
                </div>
            </td>
            <td className="px-4 py-3 text-right">
                <span className={s.pending > 0 ? 'text-yellow-400 font-medium' : 'text-text-muted'}>{s.pending}</span>
            </td>
            <td className="px-4 py-3 text-right text-text-secondary text-xs">
                {s.avgApprovalH !== null ? formatAvgLeadTime(s.avgApprovalH) : '—'}
            </td>
            <td className="px-4 py-3 text-right text-blue-400 font-medium tabular-nums">{s.ytd}</td>
        </>
    );

    return (
        <div className="space-y-6 w-full min-w-0 max-w-full overflow-x-hidden">
            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Statistics</h1>
                    <p className="text-text-muted text-sm mt-1">Leave activity overview for {selectedYear}</p>
                </div>
                <p className="text-text-muted text-xs tabular-nums">
                    Updated {lastUpdated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap gap-3 items-center bg-card-bg border border-border rounded-xl p-4">
                <div className="flex items-center gap-2">
                    <label className="text-text-muted text-xs font-medium uppercase tracking-wide">Year</label>
                    <select
                        value={selectedYear}
                        onChange={e => setSelectedYear(Number(e.target.value))}
                        className="bg-slate-700 border border-slate-600 rounded-md px-3 py-1.5 text-sm text-white focus:ring-primary focus:border-primary"
                    >
                        {yearOptions.map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </div>

                {showBranchFilter && (
                    <div className="flex items-center gap-2">
                        <label className="text-text-muted text-xs font-medium uppercase tracking-wide">Branch</label>
                        <select
                            value={selectedBranch}
                            onChange={e => setSelectedBranch(e.target.value)}
                            className="bg-slate-700 border border-slate-600 rounded-md px-3 py-1.5 text-sm text-white focus:ring-primary focus:border-primary"
                        >
                            <option value="all">All Branches</option>
                            {availableBranches.map(b => (
                                <option key={b} value={b}>{labelFor(b)}</option>
                            ))}
                        </select>
                    </div>
                )}

                {availableLeaveTypes.length > 1 && (
                    <div className="flex items-center gap-2">
                        <label className="text-text-muted text-xs font-medium uppercase tracking-wide">Leave Type</label>
                        <select
                            value={selectedLeaveType}
                            onChange={e => setSelectedLeaveType(e.target.value)}
                            className="bg-slate-700 border border-slate-600 rounded-md px-3 py-1.5 text-sm text-white focus:ring-primary focus:border-primary"
                        >
                            <option value="all">All Types</option>
                            {availableLeaveTypes.map(t => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </div>
                )}

                <button
                    type="button"
                    onClick={exportCsv}
                    className="ml-auto sm:ml-0 px-3 py-1.5 text-sm font-medium rounded-md bg-slate-600 hover:bg-slate-500 text-white border border-slate-500 transition-colors"
                >
                    Export CSV
                </button>

                <span className="w-full sm:w-auto sm:ml-auto text-xs text-text-muted text-right">
                    Showing {filteredRequests.length} request{filteredRequests.length !== 1 ? 's' : ''}
                    {selectedBranch !== 'all' ? ` · ${labelFor(selectedBranch)}` : ''}
                    {selectedLeaveType !== 'all' ? ` · ${selectedLeaveType}` : ''}
                </span>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 sm:gap-4">
                <KpiCard
                    label="Active Employees"
                    value={activeEmployees}
                    sub={inactiveEmployees > 0 ? `${inactiveEmployees} inactive` : 'Current roster'}
                    accent="text-emerald-400"
                    icon="👥"
                />
                <KpiCard
                    label="Applied leave (ever)"
                    value={`${everAppliedActive}/${activeEmployees}`}
                    sub={everAppliedPct !== null ? `${everAppliedPct.toFixed(1)}% participation` : 'No active employees'}
                    accent="text-teal-400"
                    icon="🧾"
                />
                <KpiCard
                    label={`Requests (${selectedYear})`}
                    value={filteredRequests.length}
                    trend={formatTrend(filteredRequests.length, prevFilteredRequests.length)}
                    sub={`${leaveTypeData.length} leave type${leaveTypeData.length !== 1 ? 's' : ''}`}
                    accent="text-blue-400"
                    icon="📋"
                />
                <KpiCard
                    label="Pending Approvals"
                    value={pendingCount}
                    trend={formatTrend(pendingCount, prevPendingCount)}
                    sub={pendingCount === 0 ? 'All clear' : 'Awaiting action'}
                    accent={pendingCount > 0 ? 'text-yellow-400' : 'text-emerald-400'}
                    icon="⏳"
                />
                <KpiCard
                    label="On Leave Today"
                    value={onLeaveTodayCount}
                    sub={activeEmployees > 0 ? `${((onLeaveTodayCount / activeEmployees) * 100).toFixed(1)}% of active headcount` : ''}
                    accent={onLeaveTodayCount > 0 ? 'text-orange-400' : 'text-emerald-400'}
                    icon="🏖️"
                />
                <KpiCard
                    label="Avg. approval time"
                    value={formatAvgLeadTime(avgApprovalHours)}
                    trend={
                        avgApprovalHours !== null && prevAvgApprovalHours !== null
                            ? formatTrend(avgApprovalHours, prevAvgApprovalHours)
                            : ''
                    }
                    sub={leadTimesCurrent.length ? `Based on ${leadTimesCurrent.length} approved` : 'No completed approvals'}
                    accent="text-cyan-400"
                    icon="⏱️"
                />
                <KpiCard
                    label="Approval rate"
                    value={approvalRatePct !== null ? `${approvalRatePct.toFixed(0)}%` : '—'}
                    trend={
                        approvalRatePct !== null && prevApprovalRatePct !== null
                            ? `${(approvalRatePct - prevApprovalRatePct).toFixed(1)} pp vs last year`
                            : ''
                    }
                    sub={decidedCurrent.length ? `Of ${decidedCurrent.length} approved or rejected` : 'No decided requests'}
                    accent="text-violet-400"
                    icon="✓"
                />
            </div>

            {/* Charts: break out of main p-4 on mobile so SVG uses full screen width */}
            <div className="-mx-4 md:mx-0 space-y-4">
            {/* Stacked trend + Requests by branch + insights */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 bg-card-bg border border-border rounded-xl p-3 sm:p-5 min-w-0 overflow-hidden">
                    <h2 className="text-base font-semibold text-text-primary mb-4">
                        Monthly request trend — {selectedYear}
                    </h2>
                    {filteredRequests.length === 0 ? (
                        <div className="flex items-center justify-center h-48 text-text-muted text-sm">No data for selected filters</div>
                    ) : (
                        <ChartWrapper height={260}>
                            {(w) => (
                                <BarChart width={w} height={260} data={monthlyData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                    <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                                    <Bar dataKey={LeaveStatus.APPROVED} name="Approved" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                                    <Bar dataKey={LeaveStatus.PENDING} name="Pending" stackId="a" fill="#eab308" />
                                    <Bar dataKey={LeaveStatus.REJECTED} name="Rejected" stackId="a" fill="#ef4444" />
                                    <Bar dataKey={LeaveStatus.CANCELLED} name="Cancelled" stackId="a" fill="#6b7280" radius={[3, 3, 0, 0]} />
                                </BarChart>
                            )}
                        </ChartWrapper>
                    )}
                </div>

                <div className="bg-card-bg border border-border rounded-xl p-3 sm:p-5 min-w-0 overflow-hidden flex flex-col gap-4">
                    <div>
                        <h2 className="text-base font-semibold text-text-primary mb-1">Requests by branch</h2>
                        <p className="text-text-muted text-xs">Share of filtered requests (by employee branch)</p>
                        {requestsByBranchDonutData.length === 0 ? (
                            <div className="flex items-center justify-center h-40 text-text-muted text-sm mt-4">No data</div>
                        ) : (
                            <>
                                <ChartWrapper height={200}>
                                    {(w) => {
                                        const outerR = Math.min(88, Math.max(56, w / 2 - 16));
                                        const innerR = Math.min(outerR * 0.55, 52);
                                        return (
                                            <PieChart width={w} height={200}>
                                                <Pie
                                                    data={requestsByBranchDonutData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={innerR}
                                                    outerRadius={outerR}
                                                    paddingAngle={2}
                                                    dataKey="value"
                                                >
                                                    {requestsByBranchDonutData.map((entry, i) => (
                                                        <Cell key={i} fill={entry.fill} stroke="transparent" />
                                                    ))}
                                                </Pie>
                                                <Tooltip content={<PieTooltip />} />
                                            </PieChart>
                                        );
                                    }}
                                </ChartWrapper>
                                <div className="mt-2 space-y-1.5 max-h-28 overflow-y-auto pr-1">
                                    {requestsByBranchDonutData.slice(0, 8).map((s, i) => (
                                        <div key={i} className="flex items-center justify-between text-xs gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.fill }} />
                                                <span className="text-text-secondary truncate" title={s.name}>{s.name}</span>
                                            </div>
                                            <span className="text-text-primary font-medium flex-shrink-0">{s.value} <span className="text-text-muted">({s.pct}%)</span></span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="border-t border-border pt-4">
                        <h3 className="text-sm font-semibold text-text-primary mb-2">Quick insights</h3>
                        <ul className="space-y-2 text-xs text-text-secondary leading-relaxed">
                            {quickInsights.map((line, i) => (
                                <li key={i} className="pl-3 border-l-2 border-primary/50">{line}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>

            {/* Status + day of week */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-card-bg border border-border rounded-xl p-3 sm:p-5 min-w-0 overflow-hidden">
                    <h2 className="text-base font-semibold text-text-primary mb-4">Status breakdown</h2>
                    {statusData.length === 0 ? (
                        <div className="flex items-center justify-center h-48 text-text-muted text-sm">No data</div>
                    ) : (
                        <>
                            <ChartWrapper height={200}>
                                {(w) => {
                                    const outerR = Math.min(88, Math.max(56, w / 2 - 16));
                                    const innerR = Math.min(outerR * 0.55, 52);
                                    return (
                                    <PieChart width={w} height={200}>
                                        <Pie
                                            data={statusData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={innerR}
                                            outerRadius={outerR}
                                            paddingAngle={2}
                                            dataKey="value"
                                        >
                                            {statusData.map((entry, i) => (
                                                <Cell key={i} fill={entry.fill} stroke="transparent" />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<PieTooltip />} />
                                    </PieChart>
                                    );
                                }}
                            </ChartWrapper>
                            <div className="mt-2 space-y-1.5">
                                {statusData.map((s, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.fill }} />
                                            <span className="text-text-secondary">{s.name}</span>
                                        </div>
                                        <span className="text-text-primary font-medium">{s.value} <span className="text-text-muted">({s.pct}%)</span></span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
                <div className="bg-card-bg border border-border rounded-xl p-3 sm:p-5 min-w-0 overflow-hidden">
                    <h2 className="text-base font-semibold text-text-primary mb-1">Requests by weekday</h2>
                    <p className="text-text-muted text-xs mb-4">Based on request date</p>
                    {filteredRequests.length === 0 ? (
                        <div className="flex items-center justify-center h-48 text-text-muted text-sm">No data</div>
                    ) : (
                        <ChartWrapper height={240}>
                            {(w) => (
                                <LineChart width={w} height={240} data={dayOfWeekData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Line type="monotone" dataKey="count" name="Requests" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3, fill: '#0ea5e9' }} />
                                </LineChart>
                            )}
                        </ChartWrapper>
                    )}
                </div>
            </div>

            {/* Leave type + balance snapshot */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Leave Type Breakdown */}
            <div className="bg-card-bg border border-border rounded-xl p-3 sm:p-5 min-w-0 overflow-hidden">
                <h2 className="text-base font-semibold text-text-primary mb-4">Leave Type Breakdown</h2>
                {leaveTypeData.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-text-muted text-sm">No data for selected filters</div>
                ) : (
                    <ChartWrapper height={Math.max(120, leaveTypeData.length * 48)}>
                        {(w) => {
                            const h = Math.max(120, leaveTypeData.length * 48);
                            const yAxisW = w < 380 ? 96 : 130;
                            const marginRight = w < 380 ? 44 : 60;
                            return (
                                <BarChart layout="vertical" width={w} height={h} data={leaveTypeData} margin={{ top: 0, right: marginRight, left: 4, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                                    <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <YAxis type="category" dataKey="type" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={yAxisW} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Bar dataKey="count" name="Requests" radius={[0, 4, 4, 0]}>
                                        {leaveTypeData.map((entry, i) => (
                                            <Cell key={i} fill={entry.fill} />
                                        ))}
                                        <LabelList
                                            dataKey="count"
                                            position="right"
                                            formatter={(v: number) => {
                                                const total = leaveTypeData.reduce((s, d) => s + d.count, 0) || 1;
                                                return `${v} (${((v / total) * 100).toFixed(0)}%)`;
                                            }}
                                            style={{ fill: '#94a3b8', fontSize: 11 }}
                                        />
                                    </Bar>
                                </BarChart>
                            );
                        }}
                    </ChartWrapper>
                )}
            </div>
            <div className="bg-card-bg border border-border rounded-xl p-3 sm:p-5 min-w-0 flex flex-col justify-between">
                <div>
                    <h2 className="text-base font-semibold text-text-primary mb-1">Leave balance snapshot</h2>
                    <p className="text-text-muted text-xs mb-4">Active employees in this view (current roster)</p>
                </div>
                <div className="space-y-3">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                        <p className="text-text-muted text-xs uppercase tracking-wide mb-1">Low balance</p>
                        <p className="text-2xl font-bold text-amber-400 tabular-nums">{leaveBalanceSnapshot.low}</p>
                        <p className="text-text-secondary text-xs mt-1">≤ 3 days remaining</p>
                    </div>
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                        <p className="text-text-muted text-xs uppercase tracking-wide mb-1">High unused</p>
                        <p className="text-2xl font-bold text-emerald-400 tabular-nums">{leaveBalanceSnapshot.high}</p>
                        <p className="text-text-secondary text-xs mt-1">≥ 15 days remaining</p>
                    </div>
                    <p className="text-text-muted text-xs">of {leaveBalanceSnapshot.total} active employees</p>
                </div>
            </div>
            </div>
            </div>

            {/* Branch → department → employee drill-down */}
            <div className="bg-card-bg border border-border rounded-xl overflow-hidden">
                <div className="p-5 border-b border-border">
                    <h2 className="text-base font-semibold text-text-primary">Department overview</h2>
                    <p className="text-text-muted text-xs mt-1">
                        {selectedYear} · grouped by branch, then department (A–Z). Expand rows to see employees.
                    </p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-800/50 text-left text-xs uppercase tracking-wide text-text-muted">
                                <th className="px-4 py-3 font-semibold">Branch / Department / Employee</th>
                                <th className="px-4 py-3 font-semibold text-right">Staff</th>
                                <th className="px-4 py-3 font-semibold text-right">Active</th>
                                <th className="px-4 py-3 font-semibold text-right">On leave today</th>
                                <th className="px-4 py-3 font-semibold text-right">% on leave</th>
                                <th className="px-4 py-3 font-semibold text-right">Pending</th>
                                <th className="px-4 py-3 font-semibold text-right">Avg approve</th>
                                <th className="px-4 py-3 font-semibold text-right">YTD</th>
                            </tr>
                        </thead>
                        <tbody>
                            {departmentHierarchy.map((b, bi) => (
                                <React.Fragment key={b.branch}>
                                    <tr className={`border-t border-border ${bi % 2 === 0 ? 'bg-slate-800/15' : ''} hover:bg-slate-700/25 transition-colors`}>
                                        <td className="px-4 py-3">
                                            <button
                                                type="button"
                                                onClick={() => setBranchExpanded(prev => ({ ...prev, [b.branch]: !prev[b.branch] }))}
                                                className="flex items-center gap-2 text-left font-semibold text-text-primary w-full"
                                            >
                                                <span className="text-text-muted w-4 flex-shrink-0 select-none" aria-hidden>
                                                    {branchExpanded[b.branch] ? '▼' : '▶'}
                                                </span>
                                                <span>{b.label}</span>
                                            </button>
                                        </td>
                                        {renderStatsCells(b.aggregate)}
                                    </tr>
                                    {branchExpanded[b.branch] && b.departments.map(d => {
                                        const dk = deptRowKey(b.branch, d.id);
                                        return (
                                            <React.Fragment key={dk}>
                                                <tr className="border-t border-border/50 bg-slate-900/20 hover:bg-slate-700/20">
                                                    <td className="px-4 py-2.5 pl-10">
                                                        <button
                                                            type="button"
                                                            onClick={() => setDeptExpanded(prev => ({ ...prev, [dk]: !prev[dk] }))}
                                                            className="flex items-center gap-2 text-left text-text-primary w-full"
                                                        >
                                                            <span className="text-text-muted w-4 flex-shrink-0 select-none" aria-hidden>
                                                                {deptExpanded[dk] ? '▼' : '▶'}
                                                            </span>
                                                            <span className="font-medium">{d.name}</span>
                                                        </button>
                                                    </td>
                                                    {renderStatsCells(d.stats)}
                                                </tr>
                                                {deptExpanded[dk] && d.employees.map(({ user: u, stats: es }) => (
                                                    <tr
                                                        key={u.id}
                                                        className="border-t border-border/40 bg-slate-900/10 hover:bg-slate-700/15"
                                                    >
                                                        <td className="px-4 py-2 pl-14 text-text-secondary">
                                                            <span className="text-text-primary">{u.name}</span>
                                                            <span className="text-text-muted text-xs ml-2 tabular-nums">{u.employeeNumber}</span>
                                                        </td>
                                                        {renderStatsCells(es)}
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                            {departmentHierarchy.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-4 py-8 text-center text-text-muted">No employees in scope</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Branch Breakdown Table */}
            {showBranchFilter && (
                <div className="bg-card-bg border border-border rounded-xl overflow-hidden">
                    <div className="p-5 border-b border-border">
                        <h2 className="text-base font-semibold text-text-primary">Branch Breakdown</h2>
                        <p className="text-text-muted text-xs mt-1">All branches · {selectedYear}</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-800/50 text-left text-xs uppercase tracking-wide text-text-muted">
                                    <th className="px-4 py-3 font-semibold">Branch</th>
                                    <th className="px-4 py-3 font-semibold text-right">Employees</th>
                                    <th className="px-4 py-3 font-semibold text-right">Active</th>
                                    <th className="px-4 py-3 font-semibold text-right">Applied (ever)</th>
                                    <th className="px-4 py-3 font-semibold text-right">% Applied</th>
                                    <th className="px-4 py-3 font-semibold text-right">On Leave Today</th>
                                    <th className="px-4 py-3 font-semibold text-right">% On Leave</th>
                                    <th className="px-4 py-3 font-semibold text-right">Pending</th>
                                    <th className="px-4 py-3 font-semibold text-right">YTD Requests</th>
                                </tr>
                            </thead>
                            <tbody>
                                {branchTableData.map((row, i) => (
                                    <tr key={row.branch} className={`border-t border-border ${i % 2 === 0 ? '' : 'bg-slate-800/20'} hover:bg-slate-700/30 transition-colors`}>
                                        <td className="px-4 py-3 font-medium text-text-primary">{row.label}</td>
                                        <td className="px-4 py-3 text-right text-text-secondary">{row.total}</td>
                                        <td className="px-4 py-3 text-right text-emerald-400 font-medium">{row.active}</td>
                                        <td className="px-4 py-3 text-right text-teal-400 font-medium tabular-nums">
                                            {row.applied}<span className="text-text-muted font-normal">/{row.active}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <div className="w-16 bg-slate-700 rounded-full h-1.5">
                                                    <div
                                                        className="bg-teal-400 h-1.5 rounded-full"
                                                        style={{ width: `${Math.min(100, parseFloat(row.appliedPct))}%` }}
                                                    />
                                                </div>
                                                <span className="text-text-muted text-xs w-10 text-right">{row.appliedPct}%</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className={row.onLeave > 0 ? 'text-orange-400 font-medium' : 'text-text-muted'}>{row.onLeave}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <div className="w-16 bg-slate-700 rounded-full h-1.5">
                                                    <div
                                                        className="bg-orange-400 h-1.5 rounded-full"
                                                        style={{ width: `${Math.min(100, parseFloat(row.pct))}%` }}
                                                    />
                                                </div>
                                                <span className="text-text-muted text-xs w-10 text-right">{row.pct}%</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className={row.pending > 0 ? 'text-yellow-400 font-medium' : 'text-text-muted'}>{row.pending}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right text-blue-400 font-medium">{row.ytd}</td>
                                    </tr>
                                ))}
                                {branchTableData.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-8 text-center text-text-muted">No branch data available</td>
                                    </tr>
                                )}
                            </tbody>
                            {branchTableData.length > 1 && (() => {
                                const totalActive = branchTableData.reduce((s, r) => s + r.active, 0);
                                const totalApplied = branchTableData.reduce((s, r) => s + r.applied, 0);
                                const totalAppliedPct = totalActive > 0 ? ((totalApplied / totalActive) * 100).toFixed(1) : '0.0';
                                return (
                                    <tfoot>
                                        <tr className="border-t-2 border-border bg-slate-800/40 font-semibold text-text-primary text-sm">
                                            <td className="px-4 py-3">Total</td>
                                            <td className="px-4 py-3 text-right">{branchTableData.reduce((s, r) => s + r.total, 0)}</td>
                                            <td className="px-4 py-3 text-right text-emerald-400">{totalActive}</td>
                                            <td className="px-4 py-3 text-right text-teal-400 tabular-nums">
                                                {totalApplied}<span className="text-text-muted font-normal">/{totalActive}</span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <div className="w-16 bg-slate-700 rounded-full h-1.5">
                                                        <div
                                                            className="bg-teal-400 h-1.5 rounded-full"
                                                            style={{ width: `${Math.min(100, parseFloat(totalAppliedPct))}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-text-muted text-xs w-10 text-right">{totalAppliedPct}%</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right text-orange-400">{branchTableData.reduce((s, r) => s + r.onLeave, 0)}</td>
                                            <td className="px-4 py-3 text-right" />
                                            <td className="px-4 py-3 text-right text-yellow-400">{branchTableData.reduce((s, r) => s + r.pending, 0)}</td>
                                            <td className="px-4 py-3 text-right text-blue-400">{branchTableData.reduce((s, r) => s + r.ytd, 0)}</td>
                                        </tr>
                                    </tfoot>
                                );
                            })()}
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StatisticsView;
