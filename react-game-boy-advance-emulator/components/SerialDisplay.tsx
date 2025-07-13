
import React, { useRef, useEffect } from 'react';

interface SerialDisplayProps {
    output: string;
}

export const SerialDisplay: React.FC<SerialDisplayProps> = ({ output }) => {
    const scrollRef = useRef<HTMLPreElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [output]);

    return (
        <pre
            ref={scrollRef}
            className="bg-black text-white font-mono text-sm p-4 rounded-lg h-48 overflow-y-auto border border-gray-700 whitespace-pre-wrap break-words"
        >
            {output || "Awaiting serial output..."}
        </pre>
    );
};
