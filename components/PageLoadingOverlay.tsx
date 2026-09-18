import React from 'react';

interface PageLoadingOverlayProps {
    variant?: 'fullscreen' | 'contained';
    message?: string;
}

const PageLoadingOverlay: React.FC<PageLoadingOverlayProps> = ({
    variant = 'contained',
    message = 'Loading…'
}) => {
    const positionClass = variant === 'fullscreen' ? 'fixed' : 'absolute';
    const atmosphereClass = variant === 'fullscreen' ? 'app-atmosphere' : '';

    return (
        <div
            className={`page-loading-overlay ${atmosphereClass} ${positionClass} top-0 right-0 bottom-0 left-0 z-50 flex flex-col items-center justify-center`}
            role="status"
            aria-live="polite"
            aria-busy="true"
        >
            <div className="page-loading-spinner" aria-hidden="true" />
            <p className="mt-4 text-sm text-text-secondary">{message}</p>
        </div>
    );
};

export default PageLoadingOverlay;
