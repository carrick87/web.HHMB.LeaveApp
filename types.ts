
export enum UserRole {
  NORMAL = 'Normal',
  ADMIN = 'Admin',
  SUPER_ADMIN = 'Super Admin',
}

export enum LeaveStatus {
  PENDING = 'Pending',
  APPROVED = 'Approved',
  REJECTED = 'Rejected',
  CANCELLED = 'Cancelled',
  AMENDED = 'Amended',
  CANCELLATION_PENDING = 'Cancellation Pending',
}

export enum LeaveType {
  ANNUAL = 'Annual Leave',
  SICK = 'Sick Leave',
  MATERNITY = 'Maternity Leave',
  COMPASSIONATE = 'Compassionate Leave',
  PATERNITY = 'Paternity Leave',
}

export interface Department {
  id: string;
  name: string;
  branch?: string;
  approverIds?: string[]; // Array of user IDs who can approve leave requests for this department
  ccEmails?: string[]; // Array of email addresses to CC on all department notifications
}

export interface User {
  id: string;
  name: string;
  email: string; // User-provided email address (displayed in profile, can be duplicate across users)
  employeeNumber: string; // Unique employee number used for login
  branchOverride?: string; // Optional branch override set by Super Admin (e.g., '10')
  payGroup?: '5' | '6' | string; // '5' = 5 working days, '6' = 6 working days including Saturday
  role: UserRole;
  departmentId?: string; // Made optional
  avatarUrl: string;
  leaveDaysTotal: number;
  isActive: boolean; // For admin to enable/disable users
  emailVerified?: boolean; // Email verification status from Firebase Auth
  branches?: string[]; // Array of branch codes assigned to Admin role users (e.g., ['10', '11', '20'])
  approverDepartments?: string[]; // Array of department IDs where this user is an approver (for NORMAL role users)
  adminDepartments?: string[]; // Array of department IDs that Admin can view in calendar (for ADMIN role users)
  createdAt: string;
  lastLoginAt?: string;
}

// Import StoredFile type for attachments
export interface StoredFile {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  base64Data: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  employeeNumber?: string; // Employee number for data restoration when user signs up again
  payGroup?: '5' | '6' | string; // Paygroup captured at request time for working-day calculations
  requesterName?: string; // Requester name (stored for display when user is deleted)
  requesterDepartmentId?: string; // Requester department ID (stored for filtering when user is deleted)
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  startTime: 'AM' | 'PM'; // AM or PM for start date
  endTime: 'AM' | 'PM'; // AM or PM for end date
  reason?: string;
  status: LeaveStatus;
  requestedAt: string;
  requestedAtTime?: string; // ISO timestamp when request was submitted
  approvedAt?: string;
  approvedAtTime?: string; // ISO timestamp when approved
  approvedBy?: string; // User ID of the approver
  rejectedAt?: string;
  rejectedAtTime?: string; // ISO timestamp when rejected
  rejectedBy?: string; // User ID of the rejector
  rejectionReason?: string; // Specific reason for rejection
  cancelledAt?: string;
  cancelledAtTime?: string; // ISO timestamp when cancelled
  cancelledBy?: string; // User ID of the person who cancelled
  cancellationRequestedAt?: string; // ISO timestamp when cancellation was requested
  cancellationRequestedBy?: string; // User ID of the person who requested cancellation
  cancellationApprovedAt?: string; // ISO timestamp when cancellation was approved
  cancellationApprovedBy?: string; // User ID of the approver who approved cancellation
  cancellationRejectedAt?: string; // ISO timestamp when cancellation was rejected
  cancellationRejectedBy?: string; // User ID of the approver who rejected cancellation
  cancellationRejectionReason?: string; // Reason for rejecting cancellation request
  amendedAt?: string;
  amendedAtTime?: string; // ISO timestamp when amended
  amendedBy?: string; // User ID of the person who amended
  originalRequestId?: string; // Reference to original request if this is an amendment
  comments?: string; // Comments from approver/rejector
  attachments?: StoredFile[]; // Supporting documents stored in Firestore as base64
}

export interface Attachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
}

export interface LeaveTypeConfig {
  id: string;
  leaveType: LeaveType | string; // Support both enum and custom string types
  requiresSupportingDocument: boolean;
  order: number; // Order for display
  isCustom: boolean; // Whether this is a custom leave type (not from enum)
  updatedAt: string;
  updatedBy: string; // User ID of the super admin who updated this
  createdAt?: string; // For custom types
  createdBy?: string; // User ID who created this custom type
}

export interface SMTPConfig {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: string;
  employeeNumber: string;
  employeeName: string;
  payGroup?: '5' | '6' | string; // '5' = 5 working days, '6' = 6 working days including Saturday
  createdAt: string;
  updatedAt?: string;
}

export interface LeaveBalanceHistory {
  id: string;
  employeeNumber: string;
  leaveBalance: number;
  effectiveDate: string; // Date as of which this balance is effective
  uploadedAt: string; // ISO timestamp when uploaded
  uploadedBy: string; // User ID of the admin who uploaded
  uploadBatchId?: string; // Optional: ID to group multiple updates from same upload
}

export interface LeaveBalanceCurrent {
  id: string;
  employeeNumber: string;
  leaveBalance: number;
  effectiveDate: string; // Date as of which this balance is effective
  updatedAt: string; // ISO timestamp when last updated
  updatedBy: string; // User ID of the admin who updated
}

export interface PublicHoliday {
  date: string; // Date string in YYYY-MM-DD format
  name: string; // Holiday name (e.g., "New Year's Day", "Chinese New Year")
}

export interface PublicHolidaySet {
  id: string;
  name: string; // e.g., "Sabah 2025", "Sarawak 2025", "Default 2025"
  year: number; // Year this holiday set applies to
  holidays: PublicHoliday[]; // Array of holiday objects with date and name
  isDefault: boolean; // Whether this is the default public holiday set for all users
  uploadedAt: string; // ISO timestamp when uploaded
  uploadedBy: string; // User ID of the admin who uploaded
  updatedAt?: string; // ISO timestamp when last updated
  updatedBy?: string; // User ID of the admin who last updated
  description?: string; // Optional description
}
