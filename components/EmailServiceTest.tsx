import React, { useState } from 'react';
import { testEmailService } from '../services/emailService';

interface EmailServiceTestProps {
  currentUser: any;
}

const EmailServiceTest: React.FC<EmailServiceTestProps> = ({ currentUser }) => {
  const [testEmail, setTestEmail] = useState(currentUser?.email || '');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleTest = async () => {
    if (!testEmail) {
      alert('Please enter a test email address');
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const result = await testEmailService(testEmail);
      setResult(result);
    } catch (error) {
      setResult({
        success: false,
        error: `Test failed: ${error}`,
        provider: 'unknown'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">🧪 Email Service Test</h3>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Test Email Address
          </label>
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter email to test"
          />
        </div>

        <button
          onClick={handleTest}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.3"/>
                <path d="M4,12a8,8 0 0,1 8,-8V2.5" stroke="currentColor" strokeWidth="4" fill="none"/>
              </svg>
              Testing...
            </>
          ) : (
            '📧 Send Test Email'
          )}
        </button>

        {result && (
          <div className={`p-4 rounded-md ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              {result.success ? (
                <span className="text-green-600 font-semibold">✅ Success!</span>
              ) : (
                <span className="text-red-600 font-semibold">❌ Failed</span>
              )}
              <span className="text-sm text-gray-600">via {result.provider || 'EmailJS'}</span>
            </div>
            
            {result.messageId && (
              <p className="text-sm text-gray-600 mb-1">
                <strong>Message ID:</strong> {result.messageId}
              </p>
            )}
            
            {result.error && (
              <p className="text-sm text-red-600">
                <strong>Error:</strong> {result.error}
              </p>
            )}
            
            {result.success && (
              <p className="text-sm text-green-600 mt-2">
                📧 Check your email inbox for the test message!
              </p>
            )}
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <h4 className="font-semibold text-blue-800 mb-2">📧 EmailJS Service</h4>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Browser-based email service</li>
            <li>• Free tier: 200 emails/month</li>
            <li>• Automatic retry on failure</li>
            <li>• Console fallback if EmailJS fails</li>
            <li>• Secure and reliable</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default EmailServiceTest;
