// Email Service for Leave Application System
// EmailJS with console fallback

import { doc, setDoc, getDoc } from 'firebase/firestore';
import { firestore } from './firebaseConfig';
import {
  getLeaveDaysBetween,
  formatDateWithDay,
  getReturnToWorkDateWithDay,
  leaveTypeUsesCalendarDays,
} from '../utils/dateUtils';
import { getLeaveTypeHex, LEAVE_APPROVED_EMAIL_HTML } from '../utils/leaveTypeStyles';

function buildLeaveSummaryText(
  leaveType: string,
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  payGroup: string
): { workingDays: number; leaveSummary: string; returnToWork: ReturnType<typeof getReturnToWorkDateWithDay> } {
  const workingDays = getLeaveDaysBetween(
    startDate,
    endDate,
    startTime as 'AM' | 'PM',
    endTime as 'AM' | 'PM',
    payGroup,
    leaveType
  );
  const startDateFormatted = formatDateWithDay(startDate);
  const endDateFormatted = formatDateWithDay(endDate);
  const returnToWork = getReturnToWorkDateWithDay(endDate, endTime as 'AM' | 'PM', payGroup, leaveType);
  const daysLabel = leaveTypeUsesCalendarDays(leaveType) ? 'Leave Days' : 'Working Days';
  const leaveSummary = `${daysLabel}: ${workingDays} day(s)
From: ${startDateFormatted} (${startTime})
To: ${endDateFormatted} (${endTime})
Back To Work on: ${returnToWork.dayName}, ${returnToWork.date} (${returnToWork.time})`;
  return { workingDays, leaveSummary, returnToWork };
}

// EmailJS Configuration
declare global {
  interface Window {
    emailjs?: {
      init: (apiKey: string | { publicKey: string; blockHeadless?: boolean; limitRate?: any }) => void;
      send: (serviceId: string, templateId: string, params: any) => Promise<any>;
    };
  }
}

// Email template interface
interface EmailTemplate {
  id: string;
  subject: string;
  body: string;
  type: 'leave_request' | 'leave_submitted' | 'leave_approved' | 'leave_rejected' | 'leave_cancelled' | 'leave_amended' | 'leave_cancellation_request' | 'leave_cancellation_rejected';
  lastUpdated: string;
}

// Email configuration interface
interface EmailConfig {
  provider: 'emailjs' | 'console';
  serviceId?: string;
  templateId?: string;
  fromEmail: string;
  fromName: string;
  updatedAt: string;
}

// Email result interface
interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider?: string;
}

// Load EmailJS dynamically
function loadEmailJS(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.emailjs) {
      resolve(window.emailjs);
      return;
    }

    // Try multiple CDN URLs for EmailJS v4
    const cdnUrls = [
      'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js',
      'https://unpkg.com/@emailjs/browser@4/dist/email.min.js',
      'https://cdn.skypack.dev/@emailjs/browser@4'
    ];

    let currentIndex = 0;

    const tryLoadScript = () => {
      if (currentIndex >= cdnUrls.length) {
        reject(new Error('All EmailJS CDN URLs failed to load'));
        return;
      }

      const script = document.createElement('script');
      script.src = cdnUrls[currentIndex];
      
      script.onload = () => {
        setTimeout(() => {
          if (window.emailjs || (window as any).EmailJS) {
            const emailjsInstance = window.emailjs || (window as any).EmailJS;
            console.log(`📧 EmailJS v4 loaded from: ${cdnUrls[currentIndex]}`);
            resolve(emailjsInstance);
          } else {
            console.warn(`📧 EmailJS script loaded but not available from: ${cdnUrls[currentIndex]}`);
            currentIndex++;
            tryLoadScript();
          }
        }, 100);
      };
      
      script.onerror = () => {
        console.warn(`📧 Failed to load EmailJS from: ${cdnUrls[currentIndex]}`);
        currentIndex++;
        tryLoadScript();
      };
      
      document.head.appendChild(script);
    };

    tryLoadScript();
  });
}

// Email Service Class
class EmailService {
  private config: EmailConfig | null = null;
  private retryCount = 3;
  private retryDelay = 1000; // 1 second

  constructor() {
    this.loadConfiguration();
  }

  // Load email configuration from Firebase
  private async loadConfiguration(): Promise<void> {
    try {
      const configDoc = await getDoc(doc(firestore, 'email_config', 'settings'));
      if (configDoc.exists()) {
        const data = configDoc.data();
        const emailjsConfig = data.emailjs || {};
        this.config = {
          provider: 'emailjs',
          serviceId: emailjsConfig.serviceId,
          templateId: emailjsConfig.templateId,
          fromEmail: data.fromEmail || 'noreply@example.com',
          fromName: data.fromName || 'LeaveApp',
          updatedAt: data.updatedAt || new Date().toISOString()
        };
        console.log('📧 Email configuration loaded');
        if (!emailjsConfig.serviceId || !emailjsConfig.publicKey) {
          console.warn('⚠️ EmailJS is not fully configured. Please configure EmailJS in Email Setup page.');
        }
      } else {
        // Default configuration
        this.config = {
          provider: 'emailjs',
          fromEmail: 'noreply@example.com',
          fromName: 'LeaveApp',
          updatedAt: new Date().toISOString()
        };
        console.log('📧 Using default email configuration (EmailJS)');
      }
    } catch (error: any) {
      // Permission denied is expected for unauthenticated users - suppress error
      if (error.code !== 'permission-denied') {
        console.warn('Failed to load email configuration:', error);
      }
      this.config = {
        provider: 'emailjs',
        fromEmail: 'noreply@example.com',
        fromName: 'LeaveApp',
        updatedAt: new Date().toISOString()
      };
    }
  }
  
  // Public method to reload configuration
  public async reloadConfiguration(): Promise<void> {
    await this.loadConfiguration();
  }

  // Ensure configuration is loaded
  private async ensureConfigLoaded(): Promise<EmailConfig> {
    if (!this.config) {
      await this.loadConfiguration();
    }
    return this.config!;
  }

  // Send email with EmailJS
  private async sendWithEmailJS(to: string | string[], subject: string, content: string, cc?: string[], templateVariables?: Record<string, string>): Promise<EmailResult> {
    try {
      const emailjs = await loadEmailJS();
      const config = await this.ensureConfigLoaded();
      
      // Get EmailJS specific configuration
      const configDoc = await getDoc(doc(firestore, 'email_config', 'settings'));
      const emailjsConfig = configDoc.exists() ? (configDoc.data() as any).emailjs || {} : {};
      const serviceId = emailjsConfig.serviceId;
      const publicKey = emailjsConfig.publicKey;
      
      if (!serviceId || !publicKey) {
        throw new Error('EmailJS configuration incomplete - missing serviceId or publicKey');
      }

      // Initialize EmailJS v4 SDK
      try {
        if (emailjs.init && typeof emailjs.init === 'function') {
          try {
            emailjs.init({
              publicKey: publicKey,
              blockHeadless: true,
              limitRate: {
                id: 'leave-app',
                throttle: 10000, // 10 seconds between requests
              },
            });
            console.log('📧 EmailJS v4 SDK initialized');
          } catch (v4Error) {
            console.warn('📧 v4 init with options failed, trying publicKey only:', v4Error);
            emailjs.init(publicKey);
            console.log('📧 EmailJS initialized with publicKey only');
          }
        } else {
          throw new Error('EmailJS init method not available');
        }
      } catch (initError) {
        console.error('📧 EmailJS initialization failed:', initError);
        throw new Error(`EmailJS initialization failed: ${(initError as Error).message}`);
      }

      // Use template ID from config or default
      const templateId = emailjsConfig.templateId || 'template_simple';

      const templateParams: Record<string, any> = {
        to_name: Array.isArray(to) ? to[0].split('@')[0] : to.split('@')[0],
        to_email: Array.isArray(to) ? to.join(', ') : to,
        user_email: Array.isArray(to) ? to[0] : to,
        email: Array.isArray(to) ? to[0] : to,
        from_name: config.fromName || 'LeaveApp',
        from_email: config.fromEmail || 'noreply@example.com',
        reply_to: config.fromEmail || 'noreply@example.com',
        subject: subject,
        message: content,
        html_message: this.convertToHTML(content),
        app_url: window.location.origin,
        company: 'LeaveApp',
        timestamp: new Date().toISOString(),
        footer_message: 'If you have any questions, please contact HR department.',
        status: 'Pending',
        status_class: 'pending'
      };

      // Add CC emails if provided (EmailJS template should reference cc_emails)
      if (cc && cc.length > 0) {
        templateParams.cc_emails = cc.join(', ');
      } else {
        templateParams.cc_emails = 'None';
      }

      // Merge template variables
      if (templateVariables) {
        Object.entries(templateVariables).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            templateParams[key] = value;
          }
        });
        
        // Also add snake_case versions for EmailJS template compatibility
        const variableMappings: Record<string, string> = {
          employeeName: 'employee_name',
          departmentName: 'department',
          leaveType: 'leave_type',
          startDate: 'start_date',
          startTime: 'start_time',
          endDate: 'end_date',
          endTime: 'end_time',
          returnDate: 'return_date',
          backToWorkDate: 'return_date',
          returnTime: 'return_time',
          workingDays: 'working_days',
          leaveSummary: 'leave_summary',
          approverName: 'approver_name',
          approvedDate: 'approved_date',
          rejectedDate: 'rejected_date',
          rejectionReason: 'rejection_reason',
          leaveTypeColor: 'leave_type_color',
          cc_emails: 'cc_emails'
        };
        
        Object.entries(variableMappings).forEach(([camelKey, snakeKey]) => {
          if (templateVariables[camelKey] !== undefined && templateVariables[camelKey] !== null) {
            templateParams[snakeKey] = templateVariables[camelKey];
          }
        });
      }

      console.log('📧 Sending email via EmailJS:', { serviceId, templateId });

      // Send using EmailJS
      const response = await emailjs.send(serviceId, templateId, templateParams);
      
      return {
        success: true,
        messageId: response.text,
        provider: 'emailjs'
      };
    } catch (error: any) {
      console.error('📧 EmailJS error:', error);
      let errorMessage = 'Unknown EmailJS error';
      
      if (error.text) {
        errorMessage = `EmailJS API error: ${error.text}`;
      } else if (error.message) {
        errorMessage = `EmailJS error: ${error.message}`;
      } else if (typeof error === 'string') {
        errorMessage = `EmailJS error: ${error}`;
      } else {
        errorMessage = `EmailJS error: ${JSON.stringify(error)}`;
      }
      
      return {
        success: false,
        error: errorMessage,
        provider: 'emailjs'
      };
    }
  }

  // Fallback: Log to console
  private async sendWithConsole(to: string | string[], subject: string, content: string): Promise<EmailResult> {
    console.log('📧 EMAIL NOTIFICATION (Console Fallback)');
    console.log('='.repeat(50));
    console.log(`To: ${Array.isArray(to) ? to.join(', ') : to}`);
    console.log(`Subject: ${subject}`);
    console.log('Content:');
    console.log(content);
    console.log('='.repeat(50));
    
    return {
      success: true,
      messageId: 'console-logged',
      provider: 'console'
    };
  }

  // Convert plain text to HTML (pass through full HTML documents unchanged)
  private convertToHTML(textContent: string): string {
    const trimmed = textContent.trimStart();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
      return textContent;
    }
    return textContent
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  // Main send method
  async sendEmail(params: {
    to: string | string[];
    subject: string;
    text: string;
    html?: string;
    cc?: string[];
    attachments?: File[];
    templateVariables?: Record<string, string>;
  }): Promise<EmailResult> {
    const config = await this.ensureConfigLoaded();
    const { to, subject, text, cc, templateVariables } = params;

    // Check if EmailJS is configured
    const configDoc = await getDoc(doc(firestore, 'email_config', 'settings'));
    const emailjsConfig = configDoc.exists() ? (configDoc.data() as any).emailjs || {} : {};
    const isEmailJSConfigured = !!(emailjsConfig.serviceId && emailjsConfig.publicKey);

    // Try EmailJS first, then fallback to console
    if (isEmailJSConfigured) {
      for (let attempt = 1; attempt <= this.retryCount; attempt++) {
        try {
          console.log(`📧 Attempting to send email via EmailJS (attempt ${attempt}/${this.retryCount})`);
          const result = await this.sendWithEmailJS(to, subject, text, cc, templateVariables);
          
          if (result.success) {
            console.log('✅ Email sent successfully via EmailJS');
            return result;
          } else {
            console.warn(`❌ EmailJS failed (attempt ${attempt}):`, result.error);
            if (attempt === this.retryCount) break;
          }
        } catch (error) {
          console.error(`❌ EmailJS error (attempt ${attempt}):`, error);
          if (attempt === this.retryCount) break;
        }

        // Wait before retry
        if (attempt < this.retryCount) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
        }
      }
    } else {
      console.warn('⚠️ EmailJS not configured, using console fallback');
    }

    // Fallback to console
    console.warn('🔄 Using console fallback');
    return await this.sendWithConsole(to, subject, text);
  }

  // Test email functionality
  async testEmail(testEmail: string): Promise<EmailResult> {
    try {
      const templates = await getEmailTemplates();
      const leaveRequestTemplate = templates.find(t => t.type === 'leave_request');
      
      if (leaveRequestTemplate) {
        const templateVariables = {
          employeeName: 'Jane Doe',
          departmentName: 'CSD',
          leaveType: 'Annual Leave',
          startDate: 'Friday, 26/09/2025 (AM)',
          endDate: 'Saturday, 27/09/2025 (PM)',
          workingDays: '1',
          returnDate: 'Monday, 2025-09-29 (AM)',
          backToWorkDate: 'Monday, 2025-09-29 (AM)',
          reason: 'Test email from Leave Application System',
          status: 'Pending'
        };

        const processedSubject = processTemplate(leaveRequestTemplate.subject, templateVariables);
        const processedBody = processTemplate(leaveRequestTemplate.body, templateVariables);

        return await this.sendEmail({
          to: testEmail,
          subject: processedSubject,
          text: processedBody
        });
      } else {
        const messageContent = `Dear Approver,

A new leave request has been submitted by Jane Doe.

Leave Summary:
Employee: Jane Doe
Department: CSD
Leave Type: Annual Leave
Working Days: 1 day(s)
From: Friday, 26/09/2025 (AM)
To: Saturday, 27/09/2025 (PM)
Back To Work on: Monday, 2025-09-29 (AM)

Please review and approve/reject this request at your earliest convenience.

Best regards,
LeaveApp`;

        return await this.sendEmail({
          to: testEmail,
          subject: 'Leave Request Notification - LeaveApp',
          text: messageContent
        });
      }
    } catch (error) {
      console.error('Error in test email:', error);
      const messageContent = `Test email from LeaveApp.\n\nTimestamp: ${new Date().toISOString()}`;
      
      return await this.sendEmail({
        to: testEmail,
        subject: 'Test Email - LeaveApp',
        text: messageContent
      });
    }
  }
}

// Create singleton instance
const emailServiceInstance = new EmailService();

// Export the instance and types
export { emailServiceInstance as emailService };

// Export reload method
export const reloadEmailConfiguration = async (): Promise<void> => {
  await emailServiceInstance.reloadConfiguration();
};
export type { EmailResult, EmailConfig };

// Function to fetch email templates from Firebase
async function getEmailTemplates(): Promise<EmailTemplate[]> {
  try {
    const templatesDoc = await getDoc(doc(firestore, 'email_templates', 'templates'));
    if (templatesDoc.exists()) {
      const data = templatesDoc.data();
      const existingTemplates = data.templates || [];
      
      const defaultTemplates = getDefaultTemplates();
      const existingTypes = existingTemplates.map((t: EmailTemplate) => t.type);
      const missingTemplates = defaultTemplates.filter(dt => !existingTypes.includes(dt.type));

      let updatedTemplates = [...existingTemplates];
      let needsPersist = false;

      if (missingTemplates.length > 0) {
        console.log(`📧 Found ${missingTemplates.length} missing templates, adding defaults`);
        updatedTemplates = [...updatedTemplates, ...missingTemplates];
        needsPersist = true;
      }

      // Ensure leave_approved uses leave-type color placeholder HTML
      const approvedIdx = updatedTemplates.findIndex((t: EmailTemplate) => t.type === 'leave_approved');
      if (approvedIdx >= 0 && !updatedTemplates[approvedIdx].body.includes('{leaveTypeColor}')) {
        console.log('📧 Updating leave_approved template to leave-type color HTML');
        updatedTemplates[approvedIdx] = {
          ...updatedTemplates[approvedIdx],
          body: LEAVE_APPROVED_EMAIL_HTML,
          lastUpdated: new Date().toISOString()
        };
        needsPersist = true;
      }

      if (needsPersist) {
        await setDoc(doc(firestore, 'email_templates', 'templates'), {
          templates: updatedTemplates,
          lastUpdated: new Date().toISOString()
        });
        return updatedTemplates;
      }

      return existingTemplates;
    } else {
      console.log('📧 No templates found in Firebase, creating default templates');
      const defaultTemplates = getDefaultTemplates();
      await setDoc(doc(firestore, 'email_templates', 'templates'), {
        templates: defaultTemplates,
        lastUpdated: new Date().toISOString()
      });
      return defaultTemplates;
    }
  } catch (error) {
    console.warn('Failed to fetch email templates from Firebase:', error);
    return getDefaultTemplates();
  }
}

// Function to get default email templates
function getDefaultTemplates(): EmailTemplate[] {
  return [
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
- Reason: {reason}

Leave Summary:
{leaveSummary}

Please review and approve/reject this request at your earliest convenience.

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
    }
  ];
}

// Function to process template variables
function processTemplate(template: string, variables: Record<string, string>): string {
  let processed = template;
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    processed = processed.replace(regex, value || '');
  });
  return processed;
}

// Send leave request notification to approvers and requester
export const sendLeaveRequestNotification = async (
  requesterName: string,
  requesterEmail: string,
  approverEmails: string[],
  ccEmails: string[],
  leaveType: string,
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  reason: string = '',
  departmentName: string = '',
  attachments?: File[],
  payGroup: string = '5'
): Promise<EmailResult[]> => {
  console.log(`📧 Sending leave request notification for ${requesterName}`);
  
  const { workingDays, leaveSummary, returnToWork } = buildLeaveSummaryText(
    leaveType,
    startDate,
    endDate,
    startTime,
    endTime,
    payGroup
  );
  const startDateFormatted = formatDateWithDay(startDate);
  const endDateFormatted = formatDateWithDay(endDate);

  const templates = await getEmailTemplates();
  const leaveRequestTemplate = templates.find(t => t.type === 'leave_request');
  
  // Construct approval page link
  const approvalLink = typeof window !== 'undefined' 
    ? `${window.location.origin}/#approvals`
    : 'https://your-domain.com/#approvals';

  const templateVariables = {
    employeeName: requesterName,
    departmentName: departmentName,
    leaveType: leaveType,
    startDate: startDateFormatted,
    endDate: endDateFormatted,
    startTime: startTime,
    endTime: endTime,
    workingDays: workingDays.toString(),
    reason: reason || 'N/A',
    leaveSummary: leaveSummary,
    approverName: 'Approver',
    returnDate: returnToWork.dayName + ', ' + returnToWork.date + ' (' + returnToWork.time + ')',
    backToWorkDate: returnToWork.dayName + ', ' + returnToWork.date + ' (' + returnToWork.time + ')',
    cc_emails: ccEmails.length > 0 ? ccEmails.join(', ') : 'None',
    approvalLink: approvalLink
  };

  const results: EmailResult[] = [];

  // Send to approvers (NO CC recipients for leave request submission)
  if (approverEmails.length > 0 && leaveRequestTemplate) {
    const processedSubject = processTemplate(leaveRequestTemplate.subject, templateVariables);
    const processedBody = processTemplate(leaveRequestTemplate.body, templateVariables);

    const approverResult = await emailServiceInstance.sendEmail({
      to: approverEmails,
      // CC recipients NOT included for leave request submission
      subject: processedSubject,
      text: processedBody,
      templateVariables: templateVariables
    });
    results.push(approverResult);
  }

  return results;
};

// Send leave approval/rejection notification to requester
export const sendLeaveDecisionNotification = async (
  requesterName: string,
  requesterEmail: string,
  approverName: string,
  leaveType: string,
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  status: 'Approved' | 'Rejected',
  ccEmails: string[],
  comments?: string,
  rejectionReason?: string,
  payGroup: string = '5'
): Promise<EmailResult> => {
  console.log(`📧 Sending leave decision notification: ${status}`);

  const { workingDays, leaveSummary, returnToWork } = buildLeaveSummaryText(
    leaveType,
    startDate,
    endDate,
    startTime,
    endTime,
    payGroup
  );
  const startDateFormatted = formatDateWithDay(startDate);
  const endDateFormatted = formatDateWithDay(endDate);

  const templates = await getEmailTemplates();
  const isApproved = status === 'Approved';
  const templateType = isApproved ? 'leave_approved' : 'leave_rejected';
  const template = templates.find(t => t.type === templateType);

  const templateVariables = {
    employeeName: requesterName,
    approverName: approverName,
    leaveType: leaveType,
    leaveTypeColor: getLeaveTypeHex(leaveType),
    startDate: startDateFormatted,
    endDate: endDateFormatted,
    startTime: startTime,
    endTime: endTime,
    workingDays: workingDays.toString(),
    leaveSummary: leaveSummary,
    approvedDate: new Date().toLocaleDateString(),
    rejectedDate: new Date().toLocaleDateString(),
    rejectionReason: rejectionReason || '',
    reason: comments || '',
    backToWorkDate: returnToWork.dayName + ', ' + returnToWork.date + ' (' + returnToWork.time + ')',
    cc_emails: ccEmails.length > 0 ? ccEmails.join(', ') : 'None'
  };

  if (template) {
    const processedSubject = processTemplate(template.subject, templateVariables);
    const processedBody = processTemplate(template.body, templateVariables);

    return await emailServiceInstance.sendEmail({
      to: requesterEmail,
      // CC recipients ONLY included when leave is APPROVED, not for rejection
      cc: (isApproved && ccEmails.length > 0) ? ccEmails : undefined,
      subject: processedSubject,
      text: processedBody,
      templateVariables: templateVariables
    });
  } else {
    const subject = `Leave Request ${status} - ${leaveType}`;
    const text = `Dear ${requesterName},

Your leave request has been ${status.toLowerCase()}.

Leave Details:
- Leave Type: ${leaveType}
- Status: ${status}
- ${isApproved ? 'Approved' : 'Rejected'} by: ${approverName}
${comments ? `- Comments: ${comments}` : ''}
${!isApproved && rejectionReason ? `- Rejection Reason: ${rejectionReason}` : ''}

${leaveSummary}

Best regards,
LeaveApp`;

    return await emailServiceInstance.sendEmail({
      to: requesterEmail,
      // CC recipients ONLY included when leave is APPROVED, not for rejection
      cc: (isApproved && ccEmails.length > 0) ? ccEmails : undefined,
      subject: subject,
      text: text
    });
  }
};

// Send leave cancellation request notification to approvers
export const sendLeaveCancellationRequestNotification = async (
  requesterName: string,
  requesterEmail: string,
  approverEmails: string[],
  ccEmails: string[],
  leaveType: string,
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  reason: string = '',
  departmentName: string = '',
  originalApproverName: string,
  approvedDate: string,
  payGroup: string = '5'
): Promise<EmailResult[]> => {
  console.log(`📧 Sending leave cancellation request notification for ${requesterName}`);
  
  const { workingDays, leaveSummary, returnToWork } = buildLeaveSummaryText(
    leaveType,
    startDate,
    endDate,
    startTime,
    endTime,
    payGroup
  );
  const startDateFormatted = formatDateWithDay(startDate);
  const endDateFormatted = formatDateWithDay(endDate);

  const templates = await getEmailTemplates();
  const cancellationRequestTemplate = templates.find(t => t.type === 'leave_cancellation_request');
  
  // Construct approval page link
  const approvalLink = typeof window !== 'undefined' 
    ? `${window.location.origin}/#approvals`
    : 'https://your-domain.com/#approvals';

  const templateVariables = {
    employeeName: requesterName,
    departmentName: departmentName,
    leaveType: leaveType,
    startDate: startDateFormatted,
    endDate: endDateFormatted,
    startTime: startTime,
    endTime: endTime,
    workingDays: workingDays.toString(),
    reason: reason || 'N/A',
    leaveSummary: leaveSummary,
    approverName: 'Approver',
    originalApproverName: originalApproverName,
    approvedDate: approvedDate,
    cc_emails: ccEmails.length > 0 ? ccEmails.join(', ') : 'None',
    approvalLink: approvalLink
  };

  const results: EmailResult[] = [];

  // Send to approvers
  if (approverEmails.length > 0 && cancellationRequestTemplate) {
    const processedSubject = processTemplate(cancellationRequestTemplate.subject, templateVariables);
    const processedBody = processTemplate(cancellationRequestTemplate.body, templateVariables);

    const approverResult = await emailServiceInstance.sendEmail({
      to: approverEmails,
      subject: processedSubject,
      text: processedBody,
      templateVariables: templateVariables
    });
    results.push(approverResult);
  }

  return results;
};

// Send leave cancellation decision notification to requester
export const sendLeaveCancellationDecisionNotification = async (
  requesterName: string,
  requesterEmail: string,
  approverName: string,
  leaveType: string,
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  reason: string = '',
  status: 'Approved' | 'Rejected',
  ccEmails: string[],
  rejectionReason?: string,
  payGroup: string = '5'
): Promise<EmailResult> => {
  console.log(`📧 Sending leave cancellation decision notification: ${status}`);

  const { workingDays, leaveSummary, returnToWork } = buildLeaveSummaryText(
    leaveType,
    startDate,
    endDate,
    startTime,
    endTime,
    payGroup
  );
  const startDateFormatted = formatDateWithDay(startDate);
  const endDateFormatted = formatDateWithDay(endDate);

  const templates = await getEmailTemplates();
  const isApproved = status === 'Approved';
  const templateType = isApproved ? 'leave_cancelled' : 'leave_cancellation_rejected';
  const template = templates.find(t => t.type === templateType);

  const templateVariables = {
    employeeName: requesterName,
    approverName: approverName,
    leaveType: leaveType,
    startDate: startDateFormatted,
    endDate: endDateFormatted,
    startTime: startTime,
    endTime: endTime,
    workingDays: workingDays.toString(),
    leaveSummary: leaveSummary,
    approvedDate: new Date().toLocaleDateString(),
    rejectedDate: new Date().toLocaleDateString(),
    rejectionReason: rejectionReason || '',
    reason: reason || 'N/A',
    backToWorkDate: returnToWork.dayName + ', ' + returnToWork.date + ' (' + returnToWork.time + ')',
    cc_emails: ccEmails.length > 0 ? ccEmails.join(', ') : 'None'
  };

  if (template) {
    const processedSubject = processTemplate(template.subject, templateVariables);
    const processedBody = processTemplate(template.body, templateVariables);

    return await emailServiceInstance.sendEmail({
      to: requesterEmail,
      // CC recipients ONLY included when cancellation is APPROVED
      cc: (isApproved && ccEmails.length > 0) ? ccEmails : undefined,
      subject: processedSubject,
      text: processedBody,
      templateVariables: templateVariables
    });
  } else {
    const subject = `Leave Cancellation ${status} - ${leaveType}`;
    const text = `Dear ${requesterName},

Your leave cancellation request has been ${status.toLowerCase()}.

Leave Details:
- Leave Type: ${leaveType}
- Status: ${status}
- ${isApproved ? 'Approved' : 'Rejected'} by: ${approverName}
${!isApproved && rejectionReason ? `- Rejection Reason: ${rejectionReason}` : ''}

${leaveSummary}

Best regards,
LeaveApp`;

    return await emailServiceInstance.sendEmail({
      to: requesterEmail,
      // CC recipients ONLY included when cancellation is APPROVED
      cc: (isApproved && ccEmails.length > 0) ? ccEmails : undefined,
      subject: subject,
      text: text
    });
  }
};

// Send password reset email
export const sendPasswordResetEmail = async (
  userEmail: string,
  resetLink: string
): Promise<EmailResult> => {
  const subject = 'Password Reset - LeaveApp';
  const text = `Dear User,

You have requested to reset your password for LeaveApp.

Please click the following link to reset your password:
${resetLink}

This link will expire in 1 hour for security reasons.

If you did not request this password reset, please ignore this email.

Best regards,
LeaveApp`;

  return await emailServiceInstance.sendEmail({
    to: userEmail,
    subject: subject,
    text: text
  });
};

// Test email function
export const testEmailService = async (testEmail: string): Promise<EmailResult> => {
  return await emailServiceInstance.testEmail(testEmail);
};
