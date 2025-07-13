import React from 'react';

interface FullscreenButtonProps {
    onClick: () => void;
}

export const FullscreenButton: React.FC<FullscreenButtonProps> = ({ onClick }) => (
    <button
        onClick={onClick}
        className="flex items-center justify-center p-2 bg-gray-800 rounded-lg border border-gray-700 hover:bg-gray-700 transition-colors"
        aria-label="Enter fullscreen"
        title="Enter fullscreen"
    >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1v4m0 0h-4m4 0l-5-5M4 16v4m0 0h4m-4 0l5-5m11 1v-4m0 0h-4m4 0l-5 5" />
        </svg>
    </button>
);