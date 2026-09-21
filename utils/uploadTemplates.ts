import * as XLSX from 'xlsx';
import { PublicHoliday } from '../types';

function todayStamp(): string {
  return new Date().toISOString().split('T')[0];
}

function slugSetName(name: string): string {
  const slug = name.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'set';
}

export function downloadAoaTemplate(
  filename: string,
  sheetName: string,
  rows: (string | number)[][]
): void {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export function buildEmployeeUploadRows(
  employees: Array<{ employeeNumber: string; employeeName: string; payGroup?: string }>
): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['Employee Number', 'Employee Name', 'Paygroup'],
  ];
  const sorted = [...employees].sort((a, b) =>
    a.employeeNumber.localeCompare(b.employeeNumber)
  );
  for (const emp of sorted) {
    rows.push([
      emp.employeeNumber,
      emp.employeeName,
      emp.payGroup === '6' ? '6' : '5',
    ]);
  }
  return rows;
}

export function downloadEmployeeUploadTemplate(
  employees: Array<{ employeeNumber: string; employeeName: string; payGroup?: string }>
): void {
  downloadAoaTemplate(
    `employee-upload-${todayStamp()}.xlsx`,
    'Employees',
    buildEmployeeUploadRows(employees)
  );
}

export function buildLeaveBalanceUploadRows(
  rows: Array<{ employeeNumber: string; employeeName: string; leaveBalance: number }>
): (string | number)[][] {
  const sheet: (string | number)[][] = [
    ['Employee Number', 'Employee Name', '', '', '', '', '', 'Leave Balance'],
  ];
  const sorted = [...rows].sort((a, b) =>
    a.employeeNumber.localeCompare(b.employeeNumber)
  );
  for (const row of sorted) {
    sheet.push([
      row.employeeNumber,
      row.employeeName,
      '',
      '',
      '',
      '',
      '',
      row.leaveBalance,
    ]);
  }
  return sheet;
}

export function downloadLeaveBalanceUploadTemplate(
  rows: Array<{ employeeNumber: string; employeeName: string; leaveBalance: number }>
): void {
  downloadAoaTemplate(
    `leave-balance-upload-${todayStamp()}.xlsx`,
    'Leave Balance',
    buildLeaveBalanceUploadRows(rows)
  );
}

export function buildPublicHolidayUploadRows(
  holidays: PublicHoliday[]
): (string | number)[][] {
  const sheet: (string | number)[][] = [['Date', '', 'Holiday Name']];
  const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  for (const holiday of sorted) {
    sheet.push([holiday.date, '', holiday.name || '']);
  }
  return sheet;
}

export function downloadPublicHolidayUploadTemplate(
  holidays: PublicHoliday[],
  setName?: string
): void {
  const fileSlug = setName ? slugSetName(setName) : 'template';
  downloadAoaTemplate(
    `public-holiday-${fileSlug}-${todayStamp()}.xlsx`,
    'Public Holidays',
    buildPublicHolidayUploadRows(holidays)
  );
}
