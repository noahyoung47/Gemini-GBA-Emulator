import React from 'react';

interface ExitFullscreenButtonProps {
    onClick: () => void;
}

export const ExitFullscreenButton: React.FC<ExitFullscreenButtonProps> = ({ onClick }) => (
    <button
        onClick={onClick}
        className="absolute top-4 right-4 z-50 p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-75 transition-opacity"
        aria-label="Exit fullscreen"
        title="Exit fullscreen"
    >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6M9 21H3v-6M3 3l7 7M21 21l-7-7" />
        </svg>
    </button>
);