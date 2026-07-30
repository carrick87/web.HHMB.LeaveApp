import React, { useState } from 'react';
import { emailService } from '../services/emailService';
import EmailServiceTest from './EmailServiceTest';
import EmailTemplate from './EmailTemplate';
import RobustEmailConfig from './RobustEmailConfig';

const EmailSetup: React.FC<{ currentUser: any }> = ({ currentUser }) => {
    const [activeTab, setActiveTab] = useState<'config' | 'test' | 'templates'>('config');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const tabs = [
        { id: 'config', label: 'Email Configuration', icon: '⚙️' },
        { id: 'test', label: 'Test Email', icon: '🚀' },
        { id: 'templates', label: 'Email Templates', icon: '📝' }
    ] as const;

    return (
        <div className="animate-fade-in">
            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">Email Setup</h1>
                <p className="text-text-muted">
                    Configure EmailJS settings, test email delivery, and manage email templates for the leave application system.
                </p>
            </div>

            {/* Message Display */}
            {message && (
                <div className={`mb-6 p-4 rounded-lg ${
                    message.type === 'success' 
                        ? 'bg-success/10 border border-success/20 text-success' 
                        : 'bg-danger/10 border border-danger/20 text-danger'
                }`}>
                    <div className="flex items-center gap-2">
                        <span>{message.type === 'success' ? '✅' : '❌'}</span>
                        <span className="font-medium">{message.text}</span>
                    </div>
                </div>
            )}

            {/* Tab Navigation */}
            <div className="mb-8">
                <div className="flex space-x-1 bg-surface-light p-1 rounded-lg">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-md font-medium transition-all ${
                                activeTab === tab.id
                                    ? 'bg-primary text-white shadow-md'
                                    : 'text-text-muted hover:text-text-primary hover:bg-surface'
                            }`}
                        >
                            <span>{tab.icon}</span>
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <div className="bg-surface rounded-lg shadow-lg border border-border">
                {activeTab === 'config' && (
                    <div className="p-6">
                        <RobustEmailConfig onConfigUpdate={() => setMessage({ type: 'success', text: 'Email configuration updated successfully!' })} />
                    </div>
                )}

                {activeTab === 'test' && (
                    <div className="p-6">
                        <div className="mb-6">
                            <h2 className="text-xl font-semibold mb-2">🚀 Test Email Service</h2>
                            <p className="text-text-muted text-sm">
                                Test the email service to verify EmailJS is configured correctly.
                            </p>
                        </div>
                        <EmailServiceTest currentUser={currentUser} />
                    </div>
                )}

                {activeTab === 'templates' && (
                    <div className="p-6">
                        <div className="mb-6">
                            <h2 className="text-xl font-semibold mb-2">Email Templates</h2>
                            <p className="text-text-muted text-sm">
                                Customize the email templates used for leave request notifications, approvals, and rejections.
                            </p>
                        </div>
                        <EmailTemplate currentUser={currentUser} />
                    </div>
                )}
            </div>

        </div>
    );
};

export default EmailSetup;
