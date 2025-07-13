import React, { useState, useRef, useEffect } from 'react';

interface FastForwardControlProps {
    speed: number;
    onSpeedChange: (speed: number) => void;
    isFullscreen: boolean;
}

const speedOptions = [2, 4, 6];

export const FastForwardControl: React.FC<FastForwardControlProps> = ({ speed, onSpeedChange, isFullscreen }) => {
    const [showSlider, setShowSlider] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const wrapperClasses = isFullscreen
        ? "absolute bottom-4 right-4 z-50"
        : "relative";

    const controlClasses = "flex items-center gap-2 p-2 rounded-lg text-white " + (isFullscreen ? "bg-black bg-opacity-60" : "bg-gray-800 border border-gray-700");

    const handlePresetClick = (presetSpeed: number) => {
        if (speed === presetSpeed) {
            onSpeedChange(1); // Toggle off
        } else {
            onSpeedChange(presetSpeed);
        }
    };
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setShowSlider(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);


    return (
        <div ref={wrapperRef} className={wrapperClasses}>
            <div className={controlClasses}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
                <div className="flex items-center gap-1">
                    {speedOptions.map(opt => (
                        <button
                            key={opt}
                            onClick={() => handlePresetClick(opt)}
                            className={`w-9 h-9 rounded-md text-xs font-semibold transition-colors flex items-center justify-center ${speed === opt ? 'bg-green-500 text-white shadow-lg' : 'bg-gray-600 hover:bg-gray-500'}`}
                            title={`Set speed to ${opt}x`}
                            aria-pressed={speed === opt}
                        >
                            {opt}x
                        </button>
                    ))}
                    <button
                        onClick={() => setShowSlider(!showSlider)}
                        className={`w-9 h-9 rounded-md transition-colors flex items-center justify-center ${showSlider ? 'bg-purple-500' : 'bg-gray-600 hover:bg-gray-500'}`}
                        aria-label="Custom speed slider"
                        title="Custom speed"
                        aria-expanded={showSlider}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4zM11 4a1 1 0 10-2 0v1.268a2 2 0 000 3.464V16a1 1 0 102 0V8.732a2 2 0 000-3.464V4zM15 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1z" />
                        </svg>
                    </button>
                </div>
                 {speed > 1 && !speedOptions.includes(speed) && (
                     <span className="text-sm font-semibold w-12 text-center text-purple-400">{speed.toFixed(1)}x</span>
                 )}
            </div>
            {showSlider && (
                <div className="absolute bottom-full mb-2 right-0 bg-black bg-opacity-80 p-3 rounded-lg w-56 shadow-2xl">
                     <div className="flex items-center gap-3">
                         <input
                            type="range"
                            min="1"
                            max="10"
                            step="0.1"
                            value={speed}
                            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                            aria-label="Custom speed"
                        />
                        <span className="text-sm font-semibold w-14 text-center text-purple-300 bg-gray-900 px-2 py-1 rounded-md">{speed.toFixed(1)}x</span>
                     </div>
                </div>
            )}
        </div>
    );
};
