import React from 'react';
import { GameStateWithMetadata } from '../emulator/types';

interface SaveStateUIProps {
    states: (GameStateWithMetadata | null)[];
    onSave: (slot: number) => void;
    onLoad: (slot: number) => void;
}

export const SaveStateUI: React.FC<SaveStateUIProps> = ({ states, onSave, onLoad }) => {
    
    const formatTimestamp = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleString();
    };

    return (
        <div className="space-y-3">
            {states.map((state, index) => (
                <div key={index} className="flex items-center justify-between bg-gray-700 p-2 rounded-lg">
                    <div className="flex items-center space-x-3">
                         <div className="w-20 h-16 bg-black rounded-md flex items-center justify-center overflow-hidden">
                            {state ? (
                                <img src={state.screenshotDataUrl} alt={`Save state ${index + 1}`} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-gray-400 text-xs">Empty</span>
                            )}
                        </div>
                        <div>
                            <p className="font-bold text-white">Slot {index + 1}</p>
                            <p className="text-xs text-gray-300">{state ? formatTimestamp(state.timestamp) : 'No data'}</p>
                        </div>
                    </div>
                    <div className="flex space-x-2">
                        <button
                            onClick={() => onSave(index)}
                            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-1 px-3 rounded-md text-sm transition-colors"
                        >
                            Save
                        </button>
                        <button
                            onClick={() => onLoad(index)}
                            disabled={!state}
                            className="bg-green-500 hover:bg-green-600 text-white font-bold py-1 px-3 rounded-md text-sm transition-colors disabled:bg-gray-600 disabled:opacity-50"
                        >
                            Load
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};
