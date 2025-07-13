import React from 'react';

interface VolumeControlProps {
    volume: number;
    onVolumeChange: (volume: number) => void;
    isMuted: boolean;
}

export const VolumeControl: React.FC<VolumeControlProps> = ({ volume, onVolumeChange, isMuted }) => {
    const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        onVolumeChange(parseFloat(event.target.value));
    };

    const displayVolume = isMuted ? 0 : volume;

    return (
        <div className="flex items-center space-x-3 bg-gray-800 p-2 rounded-lg border border-gray-700">
             <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 transition-colors ${isMuted || volume === 0 ? 'text-gray-500' : 'text-green-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {isMuted || volume === 0 ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                )}
            </svg>
            <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={displayVolume}
                onChange={handleSliderChange}
                className="w-32 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-green-500 disabled:accent-gray-500"
                aria-label="Volume control"
                disabled={isMuted}
            />
        </div>
    );
};