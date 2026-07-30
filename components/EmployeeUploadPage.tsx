import React, { useState } from 'react';
import { User } from '../types';
import EmployeeUpload from './EmployeeUpload';
import EmployeeList from './EmployeeList';

interface EmployeeUploadPageProps {
    onUploadComplete?: () => void;
    users: User[];
}

const EmployeeUploadPage: React.FC<EmployeeUploadPageProps> = ({ onUploadComplete, users }) => {
    const [refreshKey, setRefreshKey] = useState(0);

    const handleUploadComplete = () => {
        setRefreshKey(prev => prev + 1); // Trigger refresh of employee list
        if (onUploadComplete) {
            onUploadComplete();
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-text-primary">Employee Master List</h1>
                <p className="text-text-secondary mt-2">Upload and manage employee master list (Employee Number, Employee Name, and Paygroup)</p>
            </div>

            <EmployeeUpload onUploadComplete={handleUploadComplete} />
            
            <div className="mt-8">
                <EmployeeList key={refreshKey} users={users} onUpdate={handleUploadComplete} />
            </div>
        </div>
    );
};

export default EmployeeUploadPage;

