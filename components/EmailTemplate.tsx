import React, { useState, useEffect } from 'react';
import { UserRole } from '../types';
import { getDocument, updateDocument } from '../services/firebaseService';
import { LEAVE_APPROVED_EMAIL_HTML } from '../utils/leaveTypeStyles';
import { PencilIcon, CheckIcon, XIcon } from './Icons';

interface EmailTemplateProps {
    currentUser: any;
}

interface EmailTemplate {
    id: string;
    subject: string;
    body: string;
    type: 'leave_request' | 'leave_submitted' | 'leave_approved' | 'leave_rejected' | 'leave_cancelled' | 'leave_amended' | 'leave_cancellation_request' | 'leave_cancellation_rejected';
    lastUpdated: string;
}

const EmailTemplate: React.FC<EmailTemplateProps> = ({ currentUser }) => {
    const [templates, setTemplates] = useState<EmailTemplate[]>([]);
    const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({ subject: '', body: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const templateTypes = [
        { id: 'leave_request', name: 'Leave Request Notification', description: 'Sent when a new leave request is submitted' },
        { id: 'leave_submitted', name: 'Leave Request Submitted Confirmation', description: 'Sent to requester when their leave request is submitted' },
        { id: 'leave_approved', name: 'Leave Approved Notification', description: 'Sent when a leave request is approved' },
        { id: 'leave_rejected', name: 'Leave Rejected Notification', description: 'Sent when a leave request is rejected' },
        { id: 'leave_cancellation_request', name: 'Leave Cancellation Request', description: 'Sent to approvers when cancellation is requested for an approved leave' },
        { id: 'leave_cancelled', name: 'Leave Cancellation Approved', description: 'Sent to requester when cancellation is approved' },
        { id: 'leave_cancellation_rejected', name: 'Leave Cancellation Rejected', description: 'Sent to requester when cancellation request is rejected' },
        { id: 'leave_amended', name: 'Leave Amended Notification', description: 'Sent when a leave request is amended' }
    ];

    const defaultTemplates: EmailTemplate[] = [
        {
            id: 'leave_request',
            subject: 'New Leave Request - {employeeName}',
            body: `Dear {approverName},

A new leave request has been submitted by {employeeName}.

Leave Details:
- Employee: {employeeName}
- Department: {departmentName}
- Leave Type: {leaveType}
- Start Date: {startDate} ({startTime})
- End Date: {endDate} ({endTime})
- Working Days: {workingDays}
- Back To Work: {backToWorkDate}
- Reason: {reason}

Leave Summary:
{leaveSummary}

Please review and approve/reject this request at your earliest convenience.

Click here to view and approve/reject: {approvalLink}

Best regards,
LeaveApp`,
            type: 'leave_request',
            lastUpdated: new Date().toISOString()
        },
        {
            id: 'leave_submitted',
            subject: 'Leave Request Submitted Successfully - {employeeName}',
            body: `Dear {employeeName},

Your leave request has been submitted successfully and is now pending approval.

Leave Details:
- Leave Type: {leaveType}
- Start Date: {startDate} ({startTime})
- End Date: {endDate} ({endTime})
- Working Days: {workingDays}
- Back To Work: {backToWorkDate}
- Reason: {reason}

Leave Summary:
{leaveSummary}

Your request has been sent to the department approvers for review. You will be notified once a decision is made.

Please ensure proper handover of your duties if your leave is approved.

Best regards,
LeaveApp`,
            type: 'leave_submitted',
            lastUpdated: new Date().toISOString()
        },
        {
            id: 'leave_approved',
            subject: 'Leave Request Approved - {employeeName}',
            body: LEAVE_APPROVED_EMAIL_HTML,
            type: 'leave_approved',
            lastUpdated: new Date().toISOString()
        },
        {
            id: 'leave_rejected',
            subject: 'Leave Request Rejected - {employeeName}',
            body: `Dear {employeeName},

Your leave request has been rejected.

Leave Details:
- Leave Type: {leaveType}
- Start Date: {startDate} ({startTime})
- End Date: {endDate} ({endTime})
- Working Days: {workingDays}
- Back To Work: {backToWorkDate}
- Reason: {reason}

Leave Summary:
{leaveSummary}

Rejected by: {approverName}
Rejected on: {rejectedDate}
Rejection Reason: {rejectionReason}

Please contact your supervisor if you have any questions.

Best regards,
LeaveApp`,
            type: 'leave_rejected',
            lastUpdated: new Date().toISOString()
        },
        {
            id: 'leave_cancellation_request',
            subject: 'Leave Cancellation Request - {employeeName}',
            body: `Dear {approverName},

A cancellation request has been submitted for an approved leave by {employeeName}.

Leave Details:
- Employee: {employeeName}
- Department: {departmentName}
- Leave Type: {leaveType}
- Start Date: {startDate} ({startTime})
- End Date: {endDate} ({endTime})
- Working Days: {workingDays}
- Original Reason: {reason}

Leave Summary:
{leaveSummary}

This leave was originally approved on {approvedDate} by {originalApproverName}.

Please review and approve/reject this cancellation request at your earliest convenience.

Click here to view and approve/reject: {approvalLink}

Best regards,
LeaveApp`,
            type: 'leave_cancellation_request',
            lastUpdated: new Date().toISOString()
        },
        {
            id: 'leave_cancelled',
            subject: 'Leave Cancellation Approved - {employeeName}',
            body: `Dear {employeeName},

Your leave cancellation request has been approved.

Leave Details:
- Leave Type: {leaveType}
- Start Date: {startDate} ({startTime})
- End Date: {endDate} ({endTime})
- Working Days: {workingDays}
- Reason: {reason}

Leave Summary:
{leaveSummary}

Cancellation approved by: {approverName}
Cancellation approved on: {approvedDate}

The leave days have been credited back to your balance.

Best regards,
LeaveApp`,
            type: 'leave_cancelled',
            lastUpdated: new Date().toISOString()
        },
        {
            id: 'leave_cancellation_rejected',
            subject: 'Leave Cancellation Rejected - {employeeName}',
            body: `Dear {employeeName},

Your leave cancellation request has been rejected.

Leave Details:
- Leave Type: {leaveType}
- Start Date: {startDate} ({startTime})
- End Date: {endDate} ({endTime})
- Working Days: {workingDays}
- Reason: {reason}

Leave Summary:
{leaveSummary}

Rejected by: {approverName}
Rejected on: {rejectedDate}
Rejection Reason: {rejectionReason}

Your original leave approval remains valid. Please contact your supervisor if you have any questions.

Best regards,
LeaveApp`,
            type: 'leave_cancellation_rejected',
            lastUpdated: new Date().toISOString()
        },
        {
            id: 'leave_amended',
            subject: 'Leave Request Amended - {employeeName}',
            body: `Dear {approverName},

A leave request has been amended by {employeeName}.

Original Request:
- Leave Type: {originalLeaveType}
- Start Date: {originalStartDate} ({originalStartTime})
- End Date: {originalEndDate} ({originalEndTime})
- Working Days: {originalWorkingDays}

Amended Request:
- Leave Type: {leaveType}
- Start Date: {startDate} ({startTime})
- End Date: {endDate} ({endTime})
- Working Days: {workingDays}
- Back To Work: {backToWorkDate}
- Reason: {reason}

Leave Summary:
{leaveSummary}

Please review and approve/reject this amended request.

Best regards,
LeaveApp`,
            type: 'leave_amended',
            lastUpdated: new Date().toISOString()
        }
    ];

    useEffect(() => {
        loadTemplates();
    }, []);

    const loadTemplates = async () => {
        try {
            const templatesData = await getDocument('email_templates', 'templates');
            if (templatesData && templatesData.templates) {
                let loaded: EmailTemplate[] = templatesData.templates;
                const approvedIdx = loaded.findIndex(t => t.type === 'leave_approved');
                if (approvedIdx >= 0 && !loaded[approvedIdx].body.includes('{leaveTypeColor}')) {
                    loaded = loaded.map((t, i) =>
                        i === approvedIdx
                            ? { ...t, body: LEAVE_APPROVED_EMAIL_HTML, lastUpdated: new Date().toISOString() }
                            : t
                    );
                    await updateDocument('email_templates', 'templates', { templates: loaded });
                }
                setTemplates(loaded);
            } else {
                // Initialize with default templates
                setTemplates(defaultTemplates);
                // Use setDoc instead of updateDocument for initial creation
                const { setDoc, doc } = await import('firebase/firestore');
                const { firestore } = await import('../services/firebaseConfig');
                await setDoc(doc(firestore, 'email_templates', 'templates'), { templates: defaultTemplates });
            }
        } catch (error) {
            console.error('Error loading templates:', error);
            // If document doesn't exist, create it with default templates
            try {
                const { setDoc, doc } = await import('firebase/firestore');
                const { firestore } = await import('../services/firebaseConfig');
                await setDoc(doc(firestore, 'email_templates', 'templates'), { templates: defaultTemplates });
                setTemplates(defaultTemplates);
            } catch (createError) {
                console.error('Error creating templates document:', createError);
                setTemplates(defaultTemplates);
            }
        }
    };

    const startEdit = (template: EmailTemplate) => {
        setEditingTemplate(template.id);
        setEditForm({ subject: template.subject, body: template.body });
    };

    const cancelEdit = () => {
        setEditingTemplate(null);
        setEditForm({ subject: '', body: '' });
        setError(null);
        setSuccess(null);
    };

    const handleSave = async (templateId: string) => {
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const updatedTemplates = templates.map(template => 
                template.id === templateId 
                    ? { ...template, subject: editForm.subject, body: editForm.body, lastUpdated: new Date().toISOString() }
                    : template
            );

            await updateDocument('email_templates', 'templates', { templates: updatedTemplates });
            setTemplates(updatedTemplates);
            setEditingTemplate(null);
            setEditForm({ subject: '', body: '' });
            setSuccess('Template updated successfully!');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update template');
        } finally {
            setIsLoading(false);
        }
    };

    const resetToDefault = async (templateId: string) => {
        if (!confirm('Are you sure you want to reset this template to default? This will overwrite any custom changes.')) {
            return;
        }

        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const defaultTemplate = defaultTemplates.find(t => t.id === templateId);
            if (!defaultTemplate) return;

            const updatedTemplates = templates.map(template => 
                template.id === templateId 
                    ? { ...defaultTemplate, lastUpdated: new Date().toISOString() }
                    : template
            );

            await updateDocument('email_templates', 'templates', { templates: updatedTemplates });
            setTemplates(updatedTemplates);
            setSuccess('Template reset to default successfully!');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to reset template');
        } finally {
            setIsLoading(false);
        }
    };

    const getTemplate = (type: string) => {
        return templates.find(t => t.type === type) || defaultTemplates.find(t => t.type === type);
    };

    const getTemplateInfo = (type: string) => {
        return templateTypes.find(t => t.id === type);
    };

    if (currentUser.role !== UserRole.SUPER_ADMIN) {
        return (
            <div className="max-w-4xl mx-auto p-6">
                <div className="bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg p-6 text-center">
                    <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
                    <p>Only Super Administrators can access email template management.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-text-primary">Email Templates</h1>
                    <p className="text-text-secondary mt-1">Manage email notification templates for leave requests</p>
                </div>
            </div>

            {/* Success/Error Messages */}
            {success && (
                <div className="p-4 bg-green-500/20 border border-green-500/30 text-green-400 rounded-lg">
                    {success}
                </div>
            )}
            {error && (
                <div className="p-4 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg">
                    {error}
                </div>
            )}

            {/* Templates Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {templateTypes.map((templateType) => {
                    const template = getTemplate(templateType.id);
                    const isEditing = editingTemplate === templateType.id;

                    return (
                        <div key={templateType.id} className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h3 className="text-lg font-semibold text-text-primary">{templateType.name}</h3>
                                    <p className="text-sm text-text-muted">{templateType.description}</p>
                                </div>
                                <div className="flex gap-2">
                                    {!isEditing ? (
                                        <button
                                            onClick={() => startEdit(template!)}
                                            className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-md transition-colors"
                                            title="Edit Template"
                                        >
                                            <PencilIcon className="w-4 h-4" />
                                        </button>
                                    ) : (
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => handleSave(templateType.id)}
                                                disabled={isLoading}
                                                className="p-2 text-green-400 hover:bg-green-500/20 rounded-md transition-colors disabled:opacity-50"
                                                title="Save Changes"
                                            >
                                                <CheckIcon className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={cancelEdit}
                                                className="p-2 text-gray-400 hover:bg-gray-500/20 rounded-md transition-colors"
                                                title="Cancel"
                                            >
                                                <XIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {isEditing ? (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-text-secondary mb-2">Subject</label>
                                        <input
                                            type="text"
                                            value={editForm.subject}
                                            onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                                            className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-text-primary"
                                            placeholder="Email subject with variables like {employeeName}"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-text-secondary mb-2">Body</label>
                                        <textarea
                                            value={editForm.body}
                                            onChange={(e) => setEditForm({ ...editForm, body: e.target.value })}
                                            rows={12}
                                            className="w-full bg-surface-light border border-border rounded-md p-3 focus:ring-primary focus:border-primary text-text-primary"
                                            placeholder="Email body with variables like {employeeName}, {leaveType}, etc."
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-text-secondary mb-2">Subject</label>
                                        <div className="p-3 bg-surface-light border border-border rounded-md text-text-primary">
                                            {template?.subject}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-text-secondary mb-2">Body Preview</label>
                                        <div className="p-3 bg-surface-light border border-border rounded-md text-text-primary max-h-48 overflow-y-auto">
                                            <pre className="whitespace-pre-wrap text-sm">{template?.body}</pre>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center text-xs text-text-muted">
                                        <span>Last updated: {template?.lastUpdated ? new Date(template.lastUpdated).toLocaleString() : 'Never'}</span>
                                        <button
                                            onClick={() => resetToDefault(templateType.id)}
                                            className="text-accent hover:text-accent-light transition-colors"
                                        >
                                            Reset to Default
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Variables Help */}
            <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Available Variables</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <h4 className="font-medium text-text-secondary">Employee Information</h4>
                        <div className="space-y-1 text-sm">
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{employeeName}'}</code> - Employee name</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{departmentName}'}</code> - Department name</div>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-medium text-text-secondary">Leave Information</h4>
                        <div className="space-y-1 text-sm">
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{leaveType}'}</code> - Type of leave</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{startDate}'}</code> - Start date</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{endDate}'}</code> - End date</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{startTime}'}</code> - Start time (AM/PM)</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{endTime}'}</code> - End time (AM/PM)</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{workingDays}'}</code> - Working days</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{backToWorkDate}'}</code> - Next working day to return</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{reason}'}</code> - Leave reason</div>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-medium text-text-secondary">Approval Information</h4>
                        <div className="space-y-1 text-sm">
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{approverName}'}</code> - Approver name</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{approvedDate}'}</code> - Approval date</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{rejectionReason}'}</code> - Rejection reason</div>
                            <div><code className="bg-surface-light px-2 py-1 rounded">{'{leaveSummary}'}</code> - Full leave summary</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmailTemplate;
