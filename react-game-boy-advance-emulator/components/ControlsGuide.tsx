
import React from 'react';

const ControlItem: React.FC<{ kbd: string, label: string }> = ({ kbd, label }) => (
    <div className="flex items-center justify-center space-x-2">
        <kbd className="px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg shadow-sm">
            {kbd}
        </kbd>
        <span className="text-sm text-gray-300">{label}</span>
    </div>
);

export const ControlsGuide: React.FC = () => {
    return (
        <div className="p-4 bg-gray-800 rounded-lg border border-gray-700 mt-6">
            <h3 className="text-lg font-bold text-green-400 mb-4 text-center">Controls</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                    <h4 className="font-bold text-indigo-400 mb-2 text-center">Keyboard</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-gray-300 justify-items-center">
                        <ControlItem kbd="↑↓←→" label="D-Pad" />
                        <ControlItem kbd="X" label="A" />
                        <ControlItem kbd="Z" label="B" />
                        <ControlItem kbd="A" label="L" />
                        <ControlItem kbd="S" label="R" />
                        <ControlItem kbd="Enter" label="Start" />
                        <ControlItem kbd="Backspace" label="Select" />
                    </div>
                </div>
                 <div>
                    <h4 className="font-bold text-indigo-400 mb-2 text-center">Gamepad</h4>
                     <p className="text-xs text-center text-gray-400 mb-3">(Standard Layout, e.g., Xbox/PS)</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-gray-300 justify-items-center">
                        <ControlItem kbd="D-Pad/Stick" label="D-Pad" />
                        <ControlItem kbd="A/Cross" label="B" />
                        <ControlItem kbd="B/Circle" label="A" />
                        <ControlItem kbd="L-Shoulder" label="L" />
                        <ControlItem kbd="R-Shoulder" label="R" />
                        <ControlItem kbd="Start" label="Start" />
                        <ControlItem kbd="Back/Select" label="Select" />
                    </div>
                </div>
            </div>
        </div>
    );
};
