
import React from 'react';

interface ControlsProps {
    onJoypadDown: (key: string) => void;
    onJoypadUp: (key: string) => void;
}

const DPadButton: React.FC<{
    direction: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
    className?: string;
    onJoypadDown: (key: string) => void;
    onJoypadUp: (key: string) => void;
}> = ({ direction, className, onJoypadDown, onJoypadUp }) => {
    const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        onJoypadDown(direction);
    };

    const handleMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        onJoypadUp(direction);
    };

    return (
        <button
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => onJoypadUp(direction)}
            onTouchStart={handleMouseDown}
            onTouchEnd={handleMouseUp}
            className={`select-none transition-transform active:scale-90 ${className}`}
            aria-label={`D-Pad ${direction}`}
        />
    );
};

export const Controls: React.FC<ControlsProps> = ({ onJoypadDown, onJoypadUp }) => {
    return (
        <div className="relative w-28 h-28">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 w-full h-1/3 rounded-sm"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 w-1/3 h-full rounded-sm"></div>
            <DPadButton direction="UP" className="absolute bg-gray-800 w-1/3 h-1/3 top-0 left-1/3 rounded-t-sm" onJoypadDown={onJoypadDown} onJoypadUp={onJoypadUp} />
            <DPadButton direction="DOWN" className="absolute bg-gray-800 w-1/3 h-1/3 bottom-0 left-1/3 rounded-b-sm" onJoypadDown={onJoypadDown} onJoypadUp={onJoypadUp} />
            <DPadButton direction="LEFT" className="absolute bg-gray-800 w-1/3 h-1/3 left-0 top-1/3 rounded-l-sm" onJoypadDown={onJoypadDown} onJoypadUp={onJoypadUp} />
            <DPadButton direction="RIGHT" className="absolute bg-gray-800 w-1/3 h-1/3 right-0 top-1/3 rounded-r-sm" onJoypadDown={onJoypadDown} onJoypadUp={onJoypadUp} />
        </div>
    );
};
