
import React from 'react';

interface StatusDisplayProps {
    status: string;
}

export const StatusDisplay: React.FC<StatusDisplayProps> = ({ status }) => {
    return (
        <div className="bg-black bg-opacity-50 p-2 rounded-md my-2 w-full max-w-2xl text-center">
            <p className="text-green-400 text-sm truncate">{status}</p>
        </div>
    );
};
