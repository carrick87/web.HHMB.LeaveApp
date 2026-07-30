import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { firestore } from '../services/firebaseConfig';

interface RobustEmailConfigProps {
  onConfigUpdate?: () => void;
}

const RobustEmailConfig: React.FC<RobustEmailConfigProps> = ({ onConfigUpdate }) => {
  const [formData, setFormData] = useState({
    serviceId: '',
    publicKey: '',
    templateId: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadConfiguration();
  }, []);

  const loadConfiguration = async () => {
    try {
      const configDoc = await getDoc(doc(firestore, 'email_config', 'settings'));
      if (configDoc.exists()) {
        const data = configDoc.data();
        const emailjsConfig = data.emailjs || {};
        setFormData({
          serviceId: emailjsConfig.serviceId || '',
          publicKey: emailjsConfig.publicKey || '',
          templateId: emailjsConfig.templateId || ''
        });
      }
    } catch (error: any) {
      // Permission denied is expected if user is not Super Admin - suppress error
      if (error.code !== 'permission-denied') {
        console.error('Failed to load email configuration:', error);
      }
    }
  };

  const handleSaveConfiguration = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      setMessage(null);

      if (!formData.serviceId || !formData.publicKey) {
        setMessage({ type: 'error', text: 'Service ID and Public Key are required' });
        return;
      }

      // Prepare the configuration
      const emailConfig = {
        provider: 'emailjs',
        primaryProvider: 'emailjs',
        fromEmail: 'noreply@example.com',
        fromName: 'LeaveApp',
        updatedAt: new Date().toISOString(),
        emailjs: {
          serviceId: formData.serviceId,
          publicKey: formData.publicKey,
          templateId: formData.templateId || undefined
        }
      };

      // Save to Firebase
      await setDoc(doc(firestore, 'email_config', 'settings'), emailConfig, { merge: true });

      setMessage({ 
        type: 'success', 
        text: 'EmailJS configuration saved successfully!' 
      });

      // Reload email service configuration to use the new settings
      try {
        const { reloadEmailConfiguration } = await import('../services/emailService');
        await reloadEmailConfiguration();
        console.log('📧 Email service configuration reloaded');
      } catch (error) {
        console.warn('Failed to reload email service configuration:', error);
      }

      onConfigUpdate?.();
    } catch (error) {
      console.error('Failed to save email configuration:', error);
      setMessage({ type: 'error', text: 'Failed to save email configuration' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-2xl font-bold text-text-primary mb-2">📧 EmailJS Configuration</h3>
        <p className="text-text-muted">
          Configure EmailJS to send email notifications. EmailJS is a browser-based email service with a free tier (200 emails/month).
        </p>
      </div>

      {/* Message Display */}
      {message && (
        <div className={`p-4 rounded-xl border mb-6 ${
          message.type === 'success' 
            ? 'bg-green-50 border-green-200 text-green-700' 
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <div className="flex items-center gap-2">
            <span>{message.type === 'success' ? '✅' : '❌'}</span>
            <span className="font-medium">{message.text}</span>
          </div>
        </div>
      )}

      {/* Configuration Form */}
      <div className="bg-card-bg rounded-xl shadow-elegant-lg border border-border p-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">⚡</span>
            <div>
              <h4 className="text-xl font-semibold text-text-primary">EmailJS</h4>
              <p className="text-text-muted text-sm">Browser-based email service (Free tier available)</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveConfiguration} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Service ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.serviceId}
              onChange={(e) => setFormData({ ...formData, serviceId: e.target.value })}
              placeholder="service_xxxxxxx"
              required
              className="w-full px-4 py-3 border border-border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
            />
            <p className="text-xs text-text-muted mt-1">Get this from your EmailJS dashboard after creating an Email Service</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Public Key <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.publicKey}
              onChange={(e) => setFormData({ ...formData, publicKey: e.target.value })}
              placeholder="Your EmailJS public key"
              required
              className="w-full px-4 py-3 border border-border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
            />
            <p className="text-xs text-text-muted mt-1">Get this from EmailJS Account → General settings</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Template ID <span className="text-gray-400">(Optional)</span>
            </label>
            <input
              type="text"
              value={formData.templateId}
              onChange={(e) => setFormData({ ...formData, templateId: e.target.value })}
              placeholder="template_xxxxxxx (uses generic if empty)"
              className="w-full px-4 py-3 border border-border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
            />
            <p className="text-xs text-text-muted mt-1">Optional: Create a template in EmailJS or leave empty to use a generic template</p>
          </div>
          
          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium transition-colors shadow-md"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.3"/>
                  <path d="M4,12a8,8 0 0,1 8,-8V2.5" stroke="currentColor" strokeWidth="4" fill="none"/>
                </svg>
                Saving...
              </>
            ) : (
              <>
                💾 Save Configuration
              </>
            )}
          </button>
        </form>

        {/* Setup Instructions */}
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
            <h5 className="font-semibold text-yellow-800 mb-3">📋 EmailJS Setup Guide</h5>
            <ol className="text-sm text-yellow-700 space-y-2 list-decimal list-inside">
              <li>Go to <a href="https://emailjs.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">emailjs.com</a> and create a free account (200 emails/month free)</li>
              <li>Create a new <strong>Email Service</strong> (Gmail, Outlook, etc.) and copy the <strong>Service ID</strong></li>
              <li>Get your <strong>Public Key</strong> from Account → General</li>
              <li><strong>Optional:</strong> Create a simple email template or use our built-in generic template</li>
              <li>Enter Service ID and Public Key above and save the configuration</li>
            </ol>
          </div>
          
          <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
            <h5 className="font-semibold text-green-800 mb-3">⚡ EmailJS Benefits</h5>
            <div className="grid grid-cols-2 gap-2 text-sm text-green-700">
              <div>• Rate limiting built-in</div>
              <div>• Headless browser protection</div>
              <div>• Simplified setup</div>
              <div>• No template required</div>
              <div>• Better error handling</div>
              <div>• Enhanced security</div>
            </div>
            <p className="text-xs text-green-600 mt-2">
              <strong>Note:</strong> You only need Service ID + Public Key. Template ID is optional - we'll use a generic template if not provided.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RobustEmailConfig;
