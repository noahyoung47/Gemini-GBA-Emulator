import React from 'react';
import { Screen } from './Screen';
import { Controls } from './Controls';

interface GbaShellProps {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    onJoypadDown: (key: string) => void;
    onJoypadUp: (key: string) => void;
    isFullscreen: boolean;
    isRomLoaded: boolean;
}

const ShoulderButton: React.FC<{
    side: 'L' | 'R';
    onJoypadDown: (key: string) => void;
    onJoypadUp: (key: string) => void;
}> = ({ side, onJoypadDown, onJoypadUp }) => {
    const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        onJoypadDown(side);
    };

    const handleMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        onJoypadUp(side);
    };

    const positionClass = side === 'L' ? 'left-0 rounded-tr-2xl rounded-bl-lg' : 'right-0 rounded-tl-2xl rounded-br-lg';
    const labelClass = side === 'L' ? 'pr-2' : 'pl-2';
    
    return (
        <button
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => onJoypadUp(side)}
            onTouchStart={handleMouseDown}
            onTouchEnd={handleMouseUp}
            className={`absolute top-0 w-24 h-8 bg-gray-500 hover:bg-gray-400 active:bg-gray-600 transition-colors z-10 flex items-center ${side === 'L' ? 'justify-end' : 'justify-start'} ${positionClass}`}
        >
            <span className={`text-lg font-bold text-gray-800 ${labelClass}`}>{side}</span>
        </button>
    );
};

export const GbaShell: React.FC<GbaShellProps> = ({ canvasRef, onJoypadDown, onJoypadUp, isFullscreen, isRomLoaded }) => {
    
    if (isFullscreen) {
        return <Screen canvasRef={canvasRef} isFullscreen={true} isRomLoaded={isRomLoaded} />;
    }

    return (
        <div className="relative bg-indigo-500 p-4 pt-10 rounded-2xl shadow-2xl border-4 border-indigo-700 w-full aspect-[10/6]">
            <ShoulderButton side="L" onJoypadDown={onJoypadDown} onJoypadUp={onJoypadUp} />
            <ShoulderButton side="R" onJoypadDown={onJoypadDown} onJoypadUp={onJoypadUp} />

            <div className="flex justify-between items-center h-full">
                <div className="w-1/4 flex justify-center">
                    <Controls onJoypadDown={onJoypadDown} onJoypadUp={onJoypadUp} />
                </div>
                
                <div className="w-1/2 flex flex-col items-center">
                    <div className="text-center mb-2">
                        <span className="font-sans font-bold italic text-md text-gray-700 align-middle">
                            GAME BOY <span className="text-sm">ADVANCE</span>
                        </span>
                    </div>
                    <Screen canvasRef={canvasRef} isFullscreen={false} isRomLoaded={isRomLoaded} />
                    <div className="text-center mt-2 flex gap-4">
                         <div className="flex flex-col items-center">
                            <button
                                onMouseDown={() => onJoypadDown('SELECT')}
                                onMouseUp={() => onJoypadUp('SELECT')}
                                onMouseLeave={() => onJoypadUp('SELECT')}
                                className="w-6 h-3 bg-gray-600 rounded-full border border-gray-700 active:bg-gray-500"
                            ></button>
                            <span className="text-xs text-gray-700 font-sans mt-1">SELECT</span>
                        </div>
                        <div className="flex flex-col items-center">
                            <button
                                onMouseDown={() => onJoypadDown('START')}
                                onMouseUp={() => onJoypadUp('START')}
                                onMouseLeave={() => onJoypadUp('START')}
                                className="w-6 h-3 bg-gray-600 rounded-full border border-gray-700 active:bg-gray-500"
                            ></button>
                            <span className="text-xs text-gray-700 font-sans mt-1">START</span>
                        </div>
                    </div>
                </div>

                <div className="w-1/4 flex flex-col justify-center items-center">
                    <div className="flex items-center justify-center space-x-4">
                        <button
                            onMouseDown={() => onJoypadDown('B')} onMouseUp={() => onJoypadUp('B')} onMouseLeave={() => onJoypadUp('B')}
                            className="w-12 h-12 bg-red-600 hover:bg-red-500 rounded-full text-white font-bold text-lg shadow-md border-2 border-red-800 flex items-center justify-center transform -rotate-12 active:scale-95 transition-transform"
                        >B</button>
                        <button
                            onMouseDown={() => onJoypadDown('A')} onMouseUp={() => onJoypadUp('A')} onMouseLeave={() => onJoypadUp('A')}
                            className="w-12 h-12 bg-green-600 hover:bg-green-500 rounded-full text-white font-bold text-lg shadow-md border-2 border-green-800 flex items-center justify-center transform -rotate-12 active:scale-95 transition-transform"
                        >A</button>
                    </div>
                </div>
            </div>
        </div>
    );
};