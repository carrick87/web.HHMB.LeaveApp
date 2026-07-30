import { LeaveType } from '../types';

/** Calendar chip / badge classes by leave type. */
export const getLeaveTypeColor = (leaveType: LeaveType | string): string => {
    switch (leaveType) {
        case LeaveType.ANNUAL:
            return 'bg-emerald-300 text-emerald-900 border-emerald-400';
        case LeaveType.SICK:
            return 'bg-pink-300 text-pink-900 border-pink-400';
        case LeaveType.MATERNITY:
            return 'bg-purple-300 text-purple-900 border-purple-400';
        case LeaveType.COMPASSIONATE:
            return 'bg-orange-300 text-orange-900 border-orange-400';
        case LeaveType.PATERNITY:
            return 'bg-blue-300 text-blue-900 border-blue-400';
        default:
            return 'bg-sky-300 text-sky-900 border-sky-400';
    }
};

/** Hex accent colors shared by UI bars and email templates. */
export const getLeaveTypeHex = (leaveType: LeaveType | string): string => {
    switch (leaveType) {
        case LeaveType.ANNUAL:
            return '#34d399';
        case LeaveType.SICK:
            return '#f472b6';
        case LeaveType.MATERNITY:
            return '#c084fc';
        case LeaveType.COMPASSIONATE:
            return '#fb923c';
        case LeaveType.PATERNITY:
            return '#60a5fa';
        default:
            return '#38bdf8';
    }
};

/** 6px inset left accent for Approvals table rows and mobile cards. */
export const getLeaveTypeAccentClass = (leaveType: LeaveType | string): string => {
    switch (leaveType) {
        case LeaveType.ANNUAL:
            return 'shadow-[inset_6px_0_0_#34d399]';
        case LeaveType.SICK:
            return 'shadow-[inset_6px_0_0_#f472b6]';
        case LeaveType.MATERNITY:
            return 'shadow-[inset_6px_0_0_#c084fc]';
        case LeaveType.COMPASSIONATE:
            return 'shadow-[inset_6px_0_0_#fb923c]';
        case LeaveType.PATERNITY:
            return 'shadow-[inset_6px_0_0_#60a5fa]';
        default:
            return 'shadow-[inset_6px_0_0_#38bdf8]';
    }
};

/** Leave Approved email HTML body (uses {leaveTypeColor} and other standard placeholders). */
export const LEAVE_APPROVED_EMAIL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Leave Approved Notification</title>
</head>
<body style="background:#F5F7FB; margin:0; padding:0;">
    <div style="width:100%; background:#F5F7FB; padding:0; font-family:Calibri,Arial,sans-serif;">
        <table align="center" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; margin:auto; background:#fff; border-radius:8px; overflow:hidden;">
            <tr>
                <td style="background:{leaveTypeColor}; padding:15px 18px;">
                    <span style="font-size:18pt; color:#fff; font-weight:bold;">
                        LeaveApp
                    </span>
                </td>
            </tr>
            <tr>
                <td style="padding:18px;">
                    <p style="margin-top:0; margin-bottom:9pt; font-size:10.5pt; color:#4B5563;">
                        Dear <b>{employeeName}</b>,
                    </p>
                    <p style="margin-top:0; margin-bottom:9pt; font-size:10.5pt; color:#4B5563;">
                        cc: <span style="color:#111827;">{cc_emails}</span>
                    </p>
                    <p style="font-size:11.5pt; color:{leaveTypeColor}; font-weight:bold;">
                        Your leave request has been <span style="text-transform:uppercase;">approved</span>.
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="width:100%; border-collapse:collapse; border:none; margin-bottom:30px; border-radius:8px; overflow:hidden;">
                        <tr style="background:#F9FAFB;">
                            <td style="padding:7.5pt; color:#374151; font-weight:bold; border:1px solid #E5E7EB; border-right:none; width:40%;">Leave Type</td>
                            <td style="padding:7.5pt; color:{leaveTypeColor}; font-weight:bold; border:1px solid #E5E7EB; border-left:none;">{leaveType}</td>
                        </tr>
                        <tr>
                            <td style="padding:7.5pt; color:#374151; font-weight:bold; border:1px solid #E5E7EB; border-right:none;">Start Date</td>
                            <td style="padding:7.5pt; color:#111827; border:1px solid #E5E7EB; border-left:none;">{startDate} ({startTime})</td>
                        </tr>
                        <tr style="background:#F9FAFB;">
                            <td style="padding:7.5pt; color:#374151; font-weight:bold; border:1px solid #E5E7EB; border-right:none;">End Date</td>
                            <td style="padding:7.5pt; color:#111827; border:1px solid #E5E7EB; border-left:none;">{endDate} ({endTime})</td>
                        </tr>
                        <tr>
                            <td style="padding:7.5pt; color:#374151; font-weight:bold; border:1px solid #E5E7EB; border-right:none;">Working Days</td>
                            <td style="padding:7.5pt; color:#111827; border:1px solid #E5E7EB; border-left:none;">{workingDays}</td>
                        </tr>
                        <tr style="background:#F9FAFB;">
                            <td style="padding:7.5pt; color:#374151; font-weight:bold; border:1px solid #E5E7EB; border-right:none;">Back to Work</td>
                            <td style="padding:7.5pt; color:#111827; border:1px solid #E5E7EB; border-left:none;">{backToWorkDate}</td>
                        </tr>
                        <tr>
                            <td style="padding:7.5pt; color:#374151; font-weight:bold; border:1px solid #E5E7EB; border-right:none;">Reason</td>
                            <td style="padding:7.5pt; color:#111827; border:1px solid #E5E7EB; border-left:none;">{reason}</td>
                        </tr>
                    </table>
                    <table width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:15px;">
                        <tr>
                            <td style="width:40%;padding:4px 0;color:#374151;font-weight:bold;">Approved by</td>
                            <td style="padding:4px 0;color:#111827;">{approverName}</td>
                        </tr>
                        <tr>
                            <td style="width:40%;padding:4px 0;color:#374151;font-weight:bold;">Approved on</td>
                            <td style="padding:4px 0;color:#111827;">{approvedDate}</td>
                        </tr>
                    </table>
                    <p style="font-size:11.5pt; color:#4B5563;">
                        Please ensure all your work is properly handed over before your leave period.
                    </p>
                </td>
            </tr>
        </table>
    </div>
</body>
</html>`;
