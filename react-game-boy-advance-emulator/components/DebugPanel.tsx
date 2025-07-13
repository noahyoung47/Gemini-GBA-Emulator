
import React, { useState } from 'react';
import { Gba } from '../emulator/Gba';

export interface DebugInfo {
    registers: { [key: string]: string };
    iwram: Uint8Array;
}

interface DebugPanelProps {
    info: DebugInfo;
    gba: Gba;
}

const RegisterView: React.FC<{ registers: { [key: string]: string } }> = ({ registers }) => (
    <div>
        <h4 className="text-lg font-bold text-green-400 mb-2">CPU Registers</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm">
            {Object.entries(registers).map(([reg, value]) => (
                <div key={reg} className="flex space-x-2">
                    <span className="font-bold text-gray-300">{reg.padEnd(4, ' ')}:</span>
                    <span className="text-white">{value}</span>
                </div>
            ))}
        </div>
    </div>
);

const MemoryViewer: React.FC<{ memory: Uint8Array, startAddress: number }> = ({ memory, startAddress }) => {
    const rows = [];
    for (let i = 0; i < memory.length; i += 16) {
        const slice = memory.slice(i, i + 16);
        const address = (startAddress + i).toString(16).toUpperCase().padStart(8, '0');
        
        const hexBytes = Array.from(slice).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
        
        const asciiChars = Array.from(slice).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');

        rows.push(
            <tr key={address}>
                <td className="text-gray-500 pr-4">{address}</td>
                <td className="text-gray-200 pr-4">{hexBytes.padEnd(16 * 3 - 1, ' ')}</td>
                <td className="text-green-400">{asciiChars}</td>
            </tr>
        );
    }

    return (
        <div>
            <h4 className="text-lg font-bold text-green-400 mb-2 mt-4">Memory Viewer (IWRAM)</h4>
            <div className="bg-black p-2 rounded-md h-64 overflow-y-auto">
                <table className="w-full text-xs">
                    <tbody>{rows}</tbody>
                </table>
            </div>
        </div>
    );
};


export const DebugPanel: React.FC<DebugPanelProps> = ({ info, gba }) => {
    if (!info) return null;

    return (
        <div className="w-full max-w-4xl bg-gray-800 p-4 rounded-lg border border-gray-700 mt-4 text-left font-mono">
            <RegisterView registers={info.registers} />
            <MemoryViewer memory={info.iwram} startAddress={0x03000000} />
        </div>
    );
};
