export function buildPasswordResetReplyMessage(displayName: string, password?: string): string {
    const first = displayName.trim().split(/\s+/)[0] || displayName.trim() || 'there';
    if (password) {
        return `Dear ${first},

Your LeaveApp password has been set.

Temporary password: ${password}

Please sign in and change your password from Profile.

Kind regards,

LeaveApp @ Harrisons Holdings (Malaysia) Berhad`;
    }
    return `Dear ${first},

To reset your LeaveApp password, use “Forgot your password?” on the sign-in page. A reset link will be sent to your email.

Kind regards,

LeaveApp @ Harrisons Holdings (Malaysia) Berhad`;
}
