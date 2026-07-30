// Local employee storage service using localStorage
// This stores employee data locally so unauthenticated users can access it during sign-up

import { Employee } from '../types';

const STORAGE_KEY = 'leaveapp_employee_master_list';

export interface EmployeeData {
    employeeNumber: string;
    employeeName: string;
}

// Get all employees from local storage
export const getLocalEmployees = (): EmployeeData[] => {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) {
            console.log('No employee data found in localStorage. Key:', STORAGE_KEY);
            return [];
        }
        const employees = JSON.parse(data) as EmployeeData[];
        console.log(`Found ${employees.length} employees in localStorage`);
        return employees;
    } catch (error) {
        console.error('Error reading employees from local storage:', error);
        return [];
    }
};

// Save employees to local storage
export const saveLocalEmployees = (employees: EmployeeData[]): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(employees));
    } catch (error) {
        console.error('Error saving employees to local storage:', error);
        throw new Error('Failed to save employees. Storage may be full.');
    }
};

// Get employee by employee number (case-insensitive and flexible matching)
export const getLocalEmployeeByNumber = (employeeNumber: string): EmployeeData | null => {
    const employees = getLocalEmployees();
    const trimmedNumber = employeeNumber.trim();
    
    console.log(`Looking up employee number: "${trimmedNumber}" in ${employees.length} employees`);
    
    // Try exact match first
    let employee = employees.find(emp => emp.employeeNumber.trim() === trimmedNumber);
    
    // If no exact match, try case-insensitive
    if (!employee) {
        employee = employees.find(emp => 
            emp.employeeNumber.trim().toLowerCase() === trimmedNumber.toLowerCase()
        );
    }
    
    // If still no match, try partial match (in case of extra spaces or formatting)
    if (!employee) {
        employee = employees.find(emp => 
            emp.employeeNumber.trim().replace(/\s+/g, '') === trimmedNumber.replace(/\s+/g, '')
        );
    }
    
    if (employee) {
        console.log(`Found employee: ${employee.employeeNumber} - ${employee.employeeName}`);
    } else {
        console.log(`Employee number "${trimmedNumber}" not found. Available numbers (first 5):`, 
            employees.slice(0, 5).map(e => e.employeeNumber));
    }
    
    return employee || null;
};

// Add or update an employee
export const saveLocalEmployee = (employeeNumber: string, employeeName: string): void => {
    const employees = getLocalEmployees();
    const trimmedNumber = employeeNumber.trim();
    const existingIndex = employees.findIndex(emp => emp.employeeNumber.trim() === trimmedNumber);
    
    if (existingIndex >= 0) {
        // Update existing employee
        employees[existingIndex] = { employeeNumber: trimmedNumber, employeeName: employeeName.trim() };
    } else {
        // Add new employee
        employees.push({ employeeNumber: trimmedNumber, employeeName: employeeName.trim() });
    }
    
    // Sort by employee number
    employees.sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
    
    saveLocalEmployees(employees);
};

// Bulk save employees
export const bulkSaveLocalEmployees = (employees: EmployeeData[]): Array<{ success: boolean; employeeNumber: string; employeeName: string; error?: string }> => {
    const results: Array<{ success: boolean; employeeNumber: string; employeeName: string; error?: string }> = [];
    const currentEmployees = getLocalEmployees();
    const employeeMap = new Map<string, EmployeeData>();
    
    // Add existing employees to map
    currentEmployees.forEach(emp => {
        employeeMap.set(emp.employeeNumber.trim(), emp);
    });
    
    // Update or add new employees
    employees.forEach(emp => {
        try {
            const trimmedNumber = emp.employeeNumber.trim();
            const trimmedName = emp.employeeName.trim();
            
            if (!trimmedNumber || !trimmedName) {
                results.push({
                    success: false,
                    employeeNumber: emp.employeeNumber,
                    employeeName: emp.employeeName,
                    error: 'Employee number and name are required'
                });
                return;
            }
            
            employeeMap.set(trimmedNumber, { employeeNumber: trimmedNumber, employeeName: trimmedName });
            results.push({
                success: true,
                employeeNumber: trimmedNumber,
                employeeName: trimmedName
            });
        } catch (error: any) {
            results.push({
                success: false,
                employeeNumber: emp.employeeNumber,
                employeeName: emp.employeeName,
                error: error.message || 'Failed to save employee'
            });
        }
    });
    
    // Save all employees back to storage
    try {
        const updatedEmployees = Array.from(employeeMap.values());
        updatedEmployees.sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
        saveLocalEmployees(updatedEmployees);
    } catch (error: any) {
        // If bulk save fails, mark all as failed
        results.forEach(result => {
            if (result.success) {
                result.success = false;
                result.error = error.message || 'Failed to save to storage';
            }
        });
    }
    
    return results;
};

// Delete an employee
export const deleteLocalEmployee = (employeeNumber: string): void => {
    const employees = getLocalEmployees();
    const trimmedNumber = employeeNumber.trim();
    const filtered = employees.filter(emp => emp.employeeNumber.trim() !== trimmedNumber);
    saveLocalEmployees(filtered);
};

// Clear all employees
export const clearLocalEmployees = (): void => {
    localStorage.removeItem(STORAGE_KEY);
};

// Check if employee number exists
export const checkLocalEmployeeNumberExists = (employeeNumber: string): boolean => {
    const employee = getLocalEmployeeByNumber(employeeNumber);
    return employee !== null;
};

// Get total count of employees
export const getLocalEmployeeCount = (): number => {
    return getLocalEmployees().length;
};

