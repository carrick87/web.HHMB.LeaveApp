import { GoogleGenAI } from "@google/genai";
import { LeaveType } from '../types';

export const generateLeaveReason = async (leaveType: LeaveType, days: number): Promise<string> => {
  try {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined') {
      // In browser environment, provide predefined suggestions instead of calling API
      const suggestions = {
        'Annual Leave': [
          'Family vacation and personal time off',
          'Rest and relaxation break',
          'Personal and family commitments',
          'Annual holiday planning',
          'Personal wellness and rejuvenation'
        ],
        'Sick Leave': [
          'Medical appointment and recovery',
          'Health recovery period',
          'Medical treatment and rest',
          'Illness recovery time',
          'Health-related absence'
        ],
        'Emergency Leave': [
          'Urgent family matter',
          'Unexpected personal emergency',
          'Critical family situation',
          'Emergency personal matter',
          'Urgent personal circumstances'
        ],
        'Maternity/Paternity Leave': [
          'Maternity/Paternity care responsibilities',
          'Newborn care and bonding time',
          'Family care during maternity period',
          'Child care responsibilities',
          'Family medical support'
        ]
      };
      
      const typeReasons = suggestions[leaveType] || suggestions['Annual Leave'];
      const randomIndex = Math.floor(Math.random() * typeReasons.length);
      return typeReasons[randomIndex];
    }

    // Server-side API call (if API key is available)
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('API key not configured');
    }

    const ai = new GoogleGenAI(apiKey);
    const prompt = `Write a brief and professional reason for a leave application. 
      The leave type is "${leaveType}" and the duration is ${days} day(s). 
      Keep it concise and suitable for a corporate environment. Do not include dates.`;
      
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text.trim();
  } catch (error) {
    console.error("Error generating leave reason:", error);
    // Provide a fallback based on leave type
    const fallbacks = {
      'Annual Leave': 'Personal time off for rest and relaxation',
      'Sick Leave': 'Medical leave for health recovery',
      'Emergency Leave': 'Urgent personal matter requiring immediate attention',
      'Maternity/Paternity Leave': 'Family care responsibilities'
    };
    return fallbacks[leaveType] || 'Personal leave for important matters';
  }
};