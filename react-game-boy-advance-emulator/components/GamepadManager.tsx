
import React, { useEffect, useRef } from 'react';

interface GamepadManagerProps {
    onJoypadDown: (key: string) => void;
    onJoypadUp: (key: string) => void;
    onGamepadConnected: (gamepad: Gamepad) => void;
    onGamepadDisconnected: () => void;
}

const AXIS_THRESHOLD = 0.5;

const GAMEPAD_BUTTON_TO_GB_KEY: { [key: string]: string } = {
    'button_0': 'B', // 'A' on Xbox, 'Cross' on PS
    'button_1': 'A', // 'B' on Xbox, 'Circle' on PS
    'button_2': 'SELECT', // 'X' on Xbox, 'Square' on PS (often mapped to select for convenience)
    'button_3': 'START',  // 'Y' on Xbox, 'Triangle' on PS (often mapped to start for convenience)
    
    'button_4': 'L', // Left shoulder
    'button_5': 'R', // Right shoulder

    'button_8': 'SELECT', // 'Back' on Xbox, 'Select' on PS
    'button_9': 'START',  // 'Start' on Xbox, 'Start' on PS
    
    'button_12': 'UP',
    'button_13': 'DOWN',
    'button_14': 'LEFT',
    'button_15': 'RIGHT',
};

const AXIS_TO_GB_KEY: { [key: string]: [string, string] } = {
    '0': ['LEFT', 'RIGHT'], // Left Stick Horizontal
    '1': ['UP', 'DOWN'],    // Left Stick Vertical
    '2': ['LEFT', 'RIGHT'], // Right Stick Horizontal
    '3': ['UP', 'DOWN'],    // Right Stick Vertical
};

const ALL_GB_KEYS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'L', 'R', 'START', 'SELECT'];

export const GamepadManager: React.FC<GamepadManagerProps> = ({ 
    onJoypadDown, 
    onJoypadUp,
    onGamepadConnected,
    onGamepadDisconnected
}) => {
    const animationFrameId = useRef<number>(0);
    const prevPressedGBKeys = useRef<Set<string>>(new Set());
    const activeGamepadIndex = useRef<number | null>(null);

    const handleDisconnect = () => {
        if (activeGamepadIndex.current !== null) {
            activeGamepadIndex.current = null;
            onGamepadDisconnected();
            prevPressedGBKeys.current.forEach(key => onJoypadUp(key));
            prevPressedGBKeys.current.clear();
        }
    }

    const pollGamepads = () => {
        animationFrameId.current = requestAnimationFrame(pollGamepads);

        if (activeGamepadIndex.current === null) return;
        
        const gamepad = navigator.getGamepads()[activeGamepadIndex.current];
        
        if (!gamepad) {
            handleDisconnect();
            return;
        }

        const currentlyPressedGBKeys = new Set<string>();

        gamepad.buttons.forEach((button, index) => {
            const key = `button_${index}`;
            const gbKey = GAMEPAD_BUTTON_TO_GB_KEY[key];
            if (button.pressed && gbKey) {
                currentlyPressedGBKeys.add(gbKey);
            }
        });

        Object.entries(AXIS_TO_GB_KEY).forEach(([axisIndexStr, gbKeys]) => {
            const axisIndex = parseInt(axisIndexStr, 10);
            if (gamepad.axes.length > axisIndex) {
                const axisValue = gamepad.axes[axisIndex];
                const [negKey, posKey] = gbKeys;
                if (axisValue < -AXIS_THRESHOLD) {
                    currentlyPressedGBKeys.add(negKey);
                } else if (axisValue > AXIS_THRESHOLD) {
                    currentlyPressedGBKeys.add(posKey);
                }
            }
        });
        
        ALL_GB_KEYS.forEach(gbKey => {
            const isPressed = currentlyPressedGBKeys.has(gbKey);
            const wasPressed = prevPressedGBKeys.current.has(gbKey);

            if (isPressed && !wasPressed) {
                onJoypadDown(gbKey);
            } else if (!isPressed && wasPressed) {
                onJoypadUp(gbKey);
            }
        });

        prevPressedGBKeys.current = currentlyPressedGBKeys;
    };
    
    useEffect(() => {
        const connectHandler = (e: GamepadEvent) => {
            console.log('Gamepad connected:', e.gamepad.id);
            if (activeGamepadIndex.current === null) {
                activeGamepadIndex.current = e.gamepad.index;
                onGamepadConnected(e.gamepad);
                prevPressedGBKeys.current.clear();
            }
        };

        const disconnectHandler = (e: GamepadEvent) => {
            console.log('Gamepad disconnected:', e.gamepad.id);
            if (activeGamepadIndex.current === e.gamepad.index) {
                handleDisconnect();
            }
        };

        window.addEventListener('gamepadconnected', connectHandler);
        window.addEventListener('gamepaddisconnected', disconnectHandler);

        const gamepads = navigator.getGamepads();
        for (const gamepad of gamepads) {
            if (gamepad) {
                connectHandler({ gamepad } as GamepadEvent);
                break; 
            }
        }
        
        animationFrameId.current = requestAnimationFrame(pollGamepads);

        return () => {
            window.removeEventListener('gamepadconnected', connectHandler);
            window.removeEventListener('gamepaddisconnected', disconnectHandler);
            cancelAnimationFrame(animationFrameId.current);
            handleDisconnect();
        };
    }, [onJoypadDown, onJoypadUp, onGamepadConnected, onGamepadDisconnected]);

    return null;
};
