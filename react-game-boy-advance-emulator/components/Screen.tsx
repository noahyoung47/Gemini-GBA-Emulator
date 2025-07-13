
import React from 'react';
import { SCREEN } from '../constants';

interface ScreenProps {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    isFullscreen: boolean;
    isRomLoaded: boolean;
}

export const Screen: React.FC<ScreenProps> = ({ canvasRef, isFullscreen, isRomLoaded }) => {
    const screenWrapperClasses = isFullscreen
        ? "bg-black p-0 shadow-none flex items-center justify-center w-full h-full"
        : "bg-gray-800 rounded-lg p-2 shadow-inner border-2 border-black";

    const canvasContainerClasses = isFullscreen
        ? "relative w-auto h-full bg-black"
        : "relative w-full bg-gray-900";

    return (
        <div className={screenWrapperClasses}>
            <div
                className={canvasContainerClasses}
                style={{ aspectRatio: `${SCREEN.WIDTH} / ${SCREEN.HEIGHT}` }}
            >
                 {!isRomLoaded && !isFullscreen && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-indigo-300 text-center p-4 rounded-sm">
                        <p>Upload a GBA ROM to start</p>
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    width={SCREEN.WIDTH}
                    height={SCREEN.HEIGHT}
                    className={`w-full h-full image-rendering-pixelated transition-opacity ${isRomLoaded ? 'opacity-100' : 'opacity-0'}`}
                    style={{ imageRendering: 'pixelated' }}
                />
            </div>
        </div>
    );
};
