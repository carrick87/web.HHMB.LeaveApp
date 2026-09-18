import { Branch, Department, User, UserRole } from '../types';

/** Seed codes only — runtime source of truth is Firestore `branches`. */
export const DEFAULT_BRANCH_SEED_CODES = ['10', '11', '20', '21', '23', '24', '25', '30', '40', '45'] as const;

/** @deprecated Use Firestore branches / getAvailableBranchOptions(catalog, …). Kept for seed. */
export const BRANCH_LIST = DEFAULT_BRANCH_SEED_CODES;

export const legacyEmpNumberBranchPrefix = (employeeNumber?: string): string =>
  (employeeNumber || '').trim().substring(0, 2);

/**
 * Effective branch for a user:
 * Super Admin override → explicit branch → legacy emp-number prefix.
 */
export const getEffectiveUserBranch = (
  user: Pick<User, 'branch' | 'branchOverride' | 'employeeNumber'> | null | undefined
): string => {
  if (!user) return '';
  const override = (user.branchOverride || '').trim();
  if (override) return override;
  const explicit = (user.branch || '').trim();
  if (explicit) return explicit;
  return legacyEmpNumberBranchPrefix(user.employeeNumber);
};

/** @deprecated Prefer getEffectiveUserBranch */
export const getUserBranch = (user: User): string => getEffectiveUserBranch(user);

export const normalizeDepartmentName = (name: string) => name.trim().toLowerCase();

export const hasDuplicateDepartmentName = (
  allDepartments: Department[],
  branchCode: string,
  name: string,
  excludeDepartmentId?: string
): boolean => {
  const key = normalizeDepartmentName(name);
  if (!key) return false;
  return allDepartments.some(
    d =>
      d.branch?.toUpperCase() === branchCode.toUpperCase() &&
      normalizeDepartmentName(d.name) === key &&
      (excludeDepartmentId === undefined || d.id !== excludeDepartmentId)
  );
};

export const filterDepartments = (
  departments: Department[],
  opts: { branchFilter: string; search: string; allowedBranches?: string[] | null }
): Department[] => {
  const q = opts.search.trim().toLowerCase();
  const allowed =
    opts.allowedBranches === undefined || opts.allowedBranches === null
      ? null
      : new Set(opts.allowedBranches.map(branch => branch.toUpperCase()));

  return departments
    .filter(d => {
      const deptBranch = (d.branch || '').toUpperCase();
      if (allowed && !allowed.has(deptBranch)) {
        return false;
      }
      if (opts.branchFilter !== 'all' && deptBranch !== opts.branchFilter.toUpperCase()) {
        return false;
      }
      if (!q) return true;
      return d.name.toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

/** Active branch codes from catalog, optionally intersected with admin allowed set. */
export const getAvailableBranchOptions = (
  catalog: Array<Pick<Branch, 'code' | 'isActive'> | string>,
  allowedBranches: string[] | null
): string[] => {
  const codes = catalog
    .map((b) => (typeof b === 'string' ? b : b.isActive === false ? '' : b.code))
    .map((c) => String(c || '').trim())
    .filter(Boolean);

  const unique = [...new Set(codes)];
  if (allowedBranches === null) return unique.sort((a, b) => a.localeCompare(b));
  const allowed = new Set(allowedBranches.map((b) => b.toUpperCase()));
  return unique.filter((b) => allowed.has(b.toUpperCase())).sort((a, b) => a.localeCompare(b));
};

export const formatBranchLabel = (branch: Pick<Branch, 'code' | 'name'> | string): string => {
  if (typeof branch === 'string') return branch;
  if (branch.name && branch.name !== branch.code) return `${branch.code} — ${branch.name}`;
  return branch.code;
};

export const isBranchInAllowedSet = (
  branch: string | undefined,
  allowedBranches: string[] | null
): boolean => {
  if (allowedBranches === null) return true;
  const code = (branch || '').toUpperCase();
  if (!code) return false;
  return allowedBranches.some(b => b.toUpperCase() === code);
};

export const buildUserMaps = (users: User[]) => {
  const byId = new Map<string, User>();
  const membersByDeptId = new Map<string, User[]>();
  for (const u of users) {
    byId.set(u.id, u);
    if (!u.departmentId) continue;
    const list = membersByDeptId.get(u.departmentId) ?? [];
    list.push(u);
    membersByDeptId.set(u.departmentId, list);
  }
  for (const [, list] of membersByDeptId) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { byId, membersByDeptId };
};

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isValidEmail = (email: string) => normalizeEmail(email).includes('@');

export const isUserActive = (user: User): boolean => Boolean(user.isActive);

export const getAdminAllowedBranches = (user: User): string[] | null => {
  if (user.role === UserRole.SUPER_ADMIN) return null;
  if (user.branches && user.branches.length > 0) return user.branches;
  const effective = getEffectiveUserBranch(user);
  return effective ? [effective] : [];
};

export const filterUnassignedEmployees = (
  users: User[],
  allowedBranches: string[] | null
): User[] => {
  const allowed =
    allowedBranches === null
      ? null
      : new Set(allowedBranches.map(branch => branch.toUpperCase()));

  return users
    .filter(u => {
      if (!isUserActive(u)) return false;
      if (u.departmentId) return false;
      if (!u.employeeNumber) return false;
      if (allowed && !allowed.has(getEffectiveUserBranch(u).toUpperCase())) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
};

export const normalizeIdSetKey = (ids: string[]): string =>
  [...new Set(ids.filter(Boolean))].sort().join('|');

export const normalizeCcSetKey = (emails: string[]): string =>
  [...new Set(emails.map(normalizeEmail).filter(Boolean))].sort().join('|');

export type SimilarDepartmentKind = 'exact' | 'close';

export interface SimilarDepartmentMatch {
  department: Department;
  kind: SimilarDepartmentKind;
}

export const findSimilarDepartments = (
  departments: Department[],
  branchCode: string,
  approverIds: string[],
  ccEmails: string[]
): SimilarDepartmentMatch[] => {
  const branch = branchCode.trim().toUpperCase();
  if (!branch) return [];

  const approverKey = normalizeIdSetKey(approverIds);
  const ccKey = normalizeCcSetKey(ccEmails);
  const exact: SimilarDepartmentMatch[] = [];
  const close: SimilarDepartmentMatch[] = [];

  for (const department of departments) {
    if ((department.branch || '').toUpperCase() !== branch) continue;
    const departmentApproverKey = normalizeIdSetKey(department.approverIds ?? []);
    if (departmentApproverKey !== approverKey) continue;

    const departmentCcKey = normalizeCcSetKey(department.ccEmails ?? []);
    if (departmentCcKey === ccKey) {
      exact.push({ department, kind: 'exact' });
    } else {
      close.push({ department, kind: 'close' });
    }
  }

  const byName = (a: SimilarDepartmentMatch, b: SimilarDepartmentMatch) =>
    a.department.name.localeCompare(b.department.name, undefined, { sensitivity: 'base' });

  return [...exact.sort(byName), ...close.sort(byName)];
};
