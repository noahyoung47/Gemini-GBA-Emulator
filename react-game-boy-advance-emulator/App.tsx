
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Gba } from './emulator/Gba';
import { GbaShell } from './components/GbaShell';
import { StatusDisplay } from './components/StatusDisplay';
import { ROM_INFO } from './constants';
import { ControlsGuide } from './components/ControlsGuide';
import { VolumeControl } from './components/VolumeControl';
import { FullscreenButton } from './components/FullscreenButton';
import { ExitFullscreenButton } from './components/ExitFullscreenButton';
import { SaveStateUI } from './components/SaveStateUI';
import { GameState, GameStateWithMetadata } from './emulator/types';
import { FastForwardControl } from './components/FastForwardControl';
import { GamepadManager } from './components/GamepadManager';
import { DebugPanel, DebugInfo } from './components/DebugPanel';
import { SerialDisplay } from './components/SerialDisplay';

const App: React.FC = () => {
    const [gba, setGba] = useState<Gba | null>(null);
    const [isRomLoaded, setIsRomLoaded] = useState(false);
    const [status, setStatus] = useState<string>('Ready. Please upload a GBA ROM file.');
    const [romName, setRomName] = useState<string>('');
    const [volume, setVolume] = useState(0.5);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [saveStates, setSaveStates] = useState<(GameStateWithMetadata | null)[]>(new Array(5).fill(null));
    const [speed, setSpeed] = useState(1.0);
    const [showDebug, setShowDebug] = useState(false);
    const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
    const [serialOutput, setSerialOutput] = useState('');

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const saveFileInputRef = useRef<HTMLInputElement>(null);
    const stateFileInputRef = useRef<HTMLInputElement>(null);
    const fullscreenWrapperRef = useRef<HTMLDivElement>(null);

    // This effect manages the lifecycle of the GBA instance.
    useEffect(() => {
        // If we don't have a GBA instance or the ROM isn't loaded, do nothing.
        if (!gba || !isRomLoaded) {
            return;
        }
    
        // Start the GBA instance.
        gba.start();
    
        // Return a cleanup function. This will be called when the component
        // unmounts, or when the `gba` or `isRomLoaded` state changes.
        return () => {
            gba.stop();
        };
    }, [gba, isRomLoaded]); // Re-run this effect if gba or isRomLoaded changes.

    const handleSpeedChange = useCallback((newSpeed: number) => {
        setSpeed(newSpeed);
        if (gba) {
            gba.setSpeed(newSpeed);
            if (newSpeed > 1) {
                gba.setVolume(0); // Mute audio when fast-forwarding
            } else {
                gba.setVolume(volume); // Restore user-set volume
            }
        }
    }, [gba, volume]);

    const handleToggleFullscreen = useCallback(() => {
        const element = fullscreenWrapperRef.current;
        if (!element) return;

        if (!document.fullscreenElement) {
            element.requestFullscreen().catch(err => {
                alert(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else {
            document.exitFullscreen();
        }
    }, []);

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);
    
    // Poll for debug info when panel is open
    useEffect(() => {
        if (!gba || !showDebug) return;

        let animationFrameId: number;
        const pollDebugInfo = () => {
            setDebugInfo(gba.getDebugInfo());
            animationFrameId = requestAnimationFrame(pollDebugInfo);
        };
        animationFrameId = requestAnimationFrame(pollDebugInfo);

        return () => cancelAnimationFrame(animationFrameId);
    }, [showDebug, gba]);

    // Always poll for serial output
    useEffect(() => {
        if (!gba) return;
        
        let animationFrameId: number;
        const pollSerial = () => {
            const char = gba.getSerialChar();
            if (char) {
                setSerialOutput(prev => prev + char);
            }
            animationFrameId = requestAnimationFrame(pollSerial);
        };
        animationFrameId = requestAnimationFrame(pollSerial);

        return () => cancelAnimationFrame(animationFrameId);
    }, [gba]);
    
    const loadBios = async (): Promise<Uint8Array> => {
        try {
            console.log("Loading gba_bios.bin...");
            const response = await fetch('/gba_bios.bin');
            if (!response.ok) {
                 setStatus(`Error: Could not load gba_bios.bin. Status: ${response.status}`);
                throw new Error(`BIOS load failed: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
             if (arrayBuffer.byteLength !== 16384) {
                 console.warn(`BIOS file has unexpected size: ${arrayBuffer.byteLength} bytes. Expected 16384.`);
            }
            console.log("BIOS loaded successfully.");
            return new Uint8Array(arrayBuffer);
        } catch (error) {
            console.error(error);
            setStatus("Error: gba_bios.bin is required and could not be loaded. Please ensure it is in the project's root directory.");
            throw new Error("BIOS load failed");
        }
    }

    const handleRomUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                if (e.target?.result) {
                    try {
                        // Stop any existing GBA instance and reset state
                        if (gba) gba.stop();
                        setGba(null);
                        setIsRomLoaded(false);
                        setStatus('Initializing emulator...');
                        setSaveStates(new Array(5).fill(null));
                        handleSpeedChange(1.0);
                        setSerialOutput('');

                        const romBuffer = e.target.result as ArrayBuffer;
                        const romData = new Uint8Array(romBuffer);
                        const bios = await loadBios();
                        
                        // Pass ROM data to constructor for correct initialization
                        const newGba = new Gba(bios, romData);
                        
                        const canvas = canvasRef.current;

                        if (canvas) {
                            const ctx = canvas.getContext('2d');
                            if(ctx) {
                                newGba.setScreen(ctx);
                                await newGba.initAudio();
                                newGba.setVolume(volume);
                                newGba.setSpeed(1.0);

                                // Set the new GBA instance, which will trigger the useEffect to start it.
                                setGba(newGba);
                                setIsRomLoaded(true); 
                                setStatus(`Running: ${file.name}`);
                                setRomName(file.name);
                            }
                        }
                    } catch (error) {
                        console.error("Error loading ROM:", error);
                        setStatus(`Error: ${(error as Error).message}`);
                        setGba(null);
                        setIsRomLoaded(false);
                    }
                }
            };
            reader.readAsArrayBuffer(file);
        }
    };

    const triggerRomUpload = () => {
        fileInputRef.current?.click();
    };

    const handleVolumeChange = useCallback((newVolume: number) => {
        setVolume(newVolume);
        if (speed <= 1) {
            gba?.setVolume(newVolume);
        }
    }, [gba, speed]);

    const handleJoypadDown = useCallback((key: string) => {
        gba?.joypad.keyDown(key);
    }, [gba]);

    const handleJoypadUp = useCallback((key: string) => {
        gba?.joypad.keyUp(key);
    }, [gba]);
    
    const handleGamepadConnected = (gamepad: Gamepad) => {
        setStatus(`Gamepad connected: ${gamepad.id}`);
    };
    
    const handleGamepadDisconnected = () => {
        setStatus('Gamepad disconnected.');
    };

    useEffect(() => {
        const keyMap: { [key: string]: string } = {
            'ArrowUp': 'UP',
            'ArrowDown': 'DOWN',
            'ArrowLeft': 'LEFT',
            'ArrowRight': 'RIGHT',
            'x': 'A',
            'z': 'B',
            'a': 'L',
            's': 'R',
            'Enter': 'START',
            'Backspace': 'SELECT'
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (keyMap[e.key]) {
                e.preventDefault();
                handleJoypadDown(keyMap[e.key]);
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (keyMap[e.key]) {
                e.preventDefault();
                handleJoypadUp(keyMap[e.key]);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [handleJoypadDown, handleJoypadUp]);
    
    const getSaveFilename = (extension: string) => {
        if (!romName) return `game.${extension}`;
        const baseName = romName.replace(/\.(gba|agb|bin)$/i, '');
        return `${baseName}.${extension}`;
    }
    
    const handleDownloadCartridgeSave = () => {
        if (!gba) return;
        
        const ramData = gba.getRamData();
        if (!ramData || ramData.length === 0) {
            setStatus('This game does not have save data or RAM is empty.');
            return;
        }
    
        const blob = new Blob([ramData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = getSaveFilename('sav');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('Cartridge save (.sav) downloaded.');
    };
    
    const handleUploadCartridgeSaveClick = () => {
        saveFileInputRef.current?.click();
    };
    
    const handleCartridgeSaveUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!gba) return;
        const file = event.target.files?.[0];
    
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (e.target?.result) {
                    try {
                        const arrayBuffer = e.target.result as ArrayBuffer;
                        const saveData = new Uint8Array(arrayBuffer);
                        gba.loadRamData(saveData);
                        setStatus(`Loaded cartridge save from ${file.name}.`);
                    } catch (error) {
                        console.error("Error loading save data:", error);
                        setStatus(`Error: ${(error as Error).message}`);
                    }
                }
            };
            reader.readAsArrayBuffer(file);
            
            event.target.value = '';
        }
    };
    
    const handleSaveState = (slot: number) => {
        if (!gba || !romName) return;
        const stateData = gba.saveState(romName);
        const newStates = [...saveStates];
        newStates[slot] = stateData;
        setSaveStates(newStates);
        setStatus(`State saved to slot ${slot + 1}.`);
    };

    const handleLoadState = (slot: number) => {
        const stateToLoad = saveStates[slot];
        if (!gba || !isRomLoaded || !stateToLoad) return;
        
        try {
            // Stop current gba instance before loading state
            gba.stop();
            setIsRomLoaded(false);
            setGba(null);

            // Create a completely new GBA instance and load state into it.
            loadBios().then(bios => {
                const canvas = canvasRef.current;
                if (!canvas) {
                     setStatus(`Error loading state: Canvas not found.`);
                     return;
                }
                const ctx = canvas.getContext('2d');
                if(!ctx) {
                    setStatus(`Error loading state: Canvas context not found.`);
                    return;
                }
                
                // Construct with dummy ROM, as loadState will provide the real one.
                const newGba = new Gba(bios, new Uint8Array(0));
                newGba.setScreen(ctx);

                // This must happen *before* initializing audio
                newGba.loadState(stateToLoad.state);
                
                // Set audio/speed properties from the current UI state
                newGba.initAudio().then(() => {
                    newGba.setVolume(volume);
                    newGba.setSpeed(speed);

                    setGba(newGba);
                    setRomName(stateToLoad.romName);
                    setIsRomLoaded(true);
                    setStatus(`State loaded from slot ${slot + 1}.`);
                });
            });
        } catch(e) {
            setStatus(`Error loading state: ${(e as Error).message}`);
            console.error(e);
            // Attempt to restart the old instance if loading failed
            if (gba) {
                setGba(gba);
                setIsRomLoaded(true);
            }
        }
    };
    
    const handleDownloadAllStates = () => {
        if (saveStates.every(s => s === null)) {
            setStatus("No save states to download.");
            return;
        }
        
        const replacer = (key: string, value: any) => {
            if (value instanceof Uint8Array || value instanceof Uint32Array || value instanceof Int32Array) {
                return {
                    __type: value.constructor.name,
                    data: Array.from(value)
                };
            }
            return value;
        };

        const jsonString = JSON.stringify(saveStates, replacer);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = getSaveFilename('states.json');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('All save states downloaded.');
    };

    const handleUploadAllStatesClick = () => {
        stateFileInputRef.current?.click();
    };

    const handleStatesFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (e.target?.result) {
                    try {
                        const jsonString = e.target.result as string;
                        
                        const reviver = (key: string, value: any) => {
                            if (value && value.__type === 'Uint8Array') {
                                return new Uint8Array(value.data);
                            }
                            if (value && value.__type === 'Uint32Array') {
                                return new Uint32Array(value.data);
                            }
                            if (value && value.__type === 'Int32Array') {
                                return new Int32Array(value.data);
                            }
                            return value;
                        };
                        const loadedStates = JSON.parse(jsonString, reviver);

                        if (Array.isArray(loadedStates) && loadedStates.length === saveStates.length) {
                            setSaveStates(loadedStates as (GameStateWithMetadata | null)[]);
                            setStatus(`Save states loaded from ${file.name}.`);
                        } else {
                            throw new Error('Invalid or mismatched state file.');
                        }
                    } catch (error) {
                        console.error("Error loading state file:", error);
                        setStatus(`Error loading state file: ${(error as Error).message}`);
                    }
                }
            };
            reader.readAsText(file);
            event.target.value = '';
        }
    };

    const handleDumpState = () => {
        if (!gba || !isRomLoaded) {
            setStatus("Cannot dump state, no ROM loaded.");
            return;
        }
        const dump = gba.generateStateDump();
        setSerialOutput(prev => prev + dump);
        setStatus("State dumped to serial output.");
    };

    const handleCopySerialOutput = () => {
        if (!serialOutput) {
            setStatus("Nothing to copy.");
            return;
        }
        navigator.clipboard.writeText(serialOutput).then(() => {
            setStatus("Serial output copied to clipboard.");
        }).catch(err => {
            setStatus("Failed to copy to clipboard.");
            console.error('Failed to copy text: ', err);
        });
    };

    return (
        <div className={`min-h-screen bg-gray-900 text-white flex flex-col items-center p-4 font-mono ${isFullscreen ? 'p-0 justify-center' : 'justify-start'}`}>
            <GamepadManager
                onJoypadDown={handleJoypadDown}
                onJoypadUp={handleJoypadUp}
                onGamepadConnected={handleGamepadConnected}
                onGamepadDisconnected={handleGamepadDisconnected}
            />
            {!isFullscreen && (
                <header className="w-full max-w-4xl text-center mb-4">
                    <h1 className="text-4xl font-bold text-indigo-400 tracking-widest">REACT GAME BOY ADVANCE</h1>
                    <p className="text-gray-400">A GBA Emulator in TypeScript & React</p>
                </header>
            )}
            
            <div ref={fullscreenWrapperRef} className={`relative ${isFullscreen ? 'w-screen h-screen' : 'w-full max-w-2xl'}`}>
                <GbaShell 
                    canvasRef={canvasRef} 
                    onJoypadDown={handleJoypadDown}
                    onJoypadUp={handleJoypadUp}
                    isFullscreen={isFullscreen}
                    isRomLoaded={isRomLoaded}
                />
                {isFullscreen && <ExitFullscreenButton onClick={handleToggleFullscreen} />}

                {gba && isFullscreen && (
                    <FastForwardControl
                        speed={speed}
                        onSpeedChange={handleSpeedChange}
                        isFullscreen={true}
                    />
                )}
            </div>

            {!isFullscreen && (
                <footer className="w-full max-w-4xl text-center mt-4 space-y-4">
                    <StatusDisplay status={status} />
                    <div className="flex flex-wrap items-start justify-center gap-4">
                         <button 
                            onClick={triggerRomUpload}
                            className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg transition-colors duration-200 shadow-lg"
                        >
                            Upload ROM
                        </button>
                        <VolumeControl volume={volume} onVolumeChange={handleVolumeChange} isMuted={speed > 1} />
                        <FullscreenButton onClick={handleToggleFullscreen} />
                        <button
                            onClick={() => setShowDebug(!showDebug)}
                            className="p-2 bg-purple-800 rounded-lg border border-gray-700 hover:bg-gray-700 transition-colors"
                            aria-label="Toggle Debug Panel"
                        >
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 16v-2m8-10h2M4 12H2m15.364 6.364l1.414 1.414M4.222 5.636l1.414 1.414M19.778 5.636l-1.414 1.414M4.222 18.364l1.414-1.414M12 16a4 4 0 100-8 4 4 0 000 8z" /></svg>
                        </button>
                        <button
                            onClick={handleDumpState}
                            disabled={!gba || !isRomLoaded}
                            className="p-2 bg-yellow-800 rounded-lg border border-gray-700 hover:bg-gray-700 transition-colors disabled:opacity-50"
                            aria-label="Dump Emulator State"
                            title="Dump Emulator State"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </button>
                    </div>

                    {isRomLoaded && (
                         <div className="mt-4 flex justify-center">
                            <FastForwardControl
                                speed={speed}
                                onSpeedChange={handleSpeedChange}
                                isFullscreen={false}
                            />
                        </div>
                    )}
                    
                    {showDebug && debugInfo && gba && <DebugPanel info={debugInfo} gba={gba} />}

                    {isRomLoaded && (
                        <div className="w-full max-w-4xl mt-4 text-left">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-lg font-bold text-green-400">Serial Output / State Dumps</h3>
                                <button
                                    onClick={handleCopySerialOutput}
                                    className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-1 px-3 rounded text-xs transition-colors"
                                    title="Copy to Clipboard"
                                >
                                    Copy
                                </button>
                            </div>
                            <SerialDisplay output={serialOutput} />
                        </div>
                    )}

                    {isRomLoaded && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                            <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                                <h3 className="text-lg font-bold text-green-400 mb-3">Save States</h3>
                                <p className="text-xs text-gray-400 mb-4">Instantly save/load the exact game moment. Stored in your browser.</p>
                                <SaveStateUI states={saveStates} onSave={handleSaveState} onLoad={handleLoadState} />
                                <div className="flex justify-center gap-4 mt-4">
                                    <button onClick={handleDownloadAllStates} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md text-sm">Download States</button>
                                    <button onClick={handleUploadAllStatesClick} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md text-sm">Upload States</button>
                                </div>
                            </div>
                            <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                                <h3 className="text-lg font-bold text-green-400 mb-3">Cartridge Save (.sav)</h3>
                                <p className="text-xs text-gray-400 mb-4">Manage the game's own save file (SRAM, Flash, EEPROM). Compatibility may vary.</p>
                                <div className="flex justify-center gap-4 mt-4">
                                     <button
                                        onClick={handleUploadCartridgeSaveClick}
                                        disabled={!gba}
                                        className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200 shadow-lg disabled:bg-gray-600 disabled:opacity-75 disabled:cursor-not-allowed"
                                    >
                                        Upload .sav
                                    </button>
                                    <button
                                        onClick={handleDownloadCartridgeSave}
                                        disabled={!gba}
                                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200 shadow-lg disabled:bg-gray-600 disabled:opacity-75 disabled:cursor-not-allowed"
                                    >
                                        Download .sav
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <input type="file" ref={fileInputRef} onChange={handleRomUpload} className="hidden" accept=".gba,.agb,.bin"/>
                    <input type="file" ref={saveFileInputRef} onChange={handleCartridgeSaveUpload} className="hidden" accept=".sav" />
                    <input type="file" ref={stateFileInputRef} onChange={handleStatesFileUpload} className="hidden" accept=".json" />
                    
                    <ControlsGuide />
                     {romName && ROM_INFO[romName] && (
                        <div className="text-left bg-gray-800 p-4 rounded-lg border border-gray-700">
                            <h3 className="font-bold text-indigo-400">{ROM_INFO[romName].title}</h3>
                            <p className="text-sm text-gray-300">{ROM_INFO[romName].description}</p>
                        </div>
                     )}
                </footer>
            )}
        </div>
    );
};

export default App;
