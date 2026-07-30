import { Department, User } from '../types';

export const BRANCH_LIST = ['10', '11', '20', '21', '23', '24', '25', '30', '40', '45'] as const;

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
  opts: { branchFilter: string; search: string }
): Department[] => {
  const q = opts.search.trim().toLowerCase();
  return departments
    .filter(d => {
      if (opts.branchFilter !== 'all' && d.branch?.toUpperCase() !== opts.branchFilter.toUpperCase()) {
        return false;
      }
      if (!q) return true;
      return d.name.toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
