


import { Cpu, CpuMode } from './Cpu';
import { Mmu } from './Mmu';
import { Ppu } from './Ppu';
import { Joypad } from './Joypad';
import { TimerController } from './Timer';
import { Apu } from './Apu';
import { DmaController } from './Dma';
import { CYCLES_PER_FRAME, FRAMES_PER_SECOND } from '../constants';
import { GameState, GameStateWithMetadata, SaveType } from './types';
import { DebugInfo } from '../components/DebugPanel';
import { Eeprom } from './Eeprom';

export class Gba {
    cpu: Cpu;
    mmu: Mmu;
    ppu: Ppu;
    joypad: Joypad;
    timers: TimerController;
    apu: Apu;
    dma: DmaController;
    eeprom: Eeprom;

    private cyclesThisFrame = 0;

    private isRunning = false;
    private animationFrameId = 0;
    public speedMultiplier = 1.0;
    
    private lastFrameTime = 0;
    private accumulatedTime = 0;
    private readonly targetFrameTime = 1000 / FRAMES_PER_SECOND;
    private bios: Uint8Array;

    public serialBuffer: string[] = [];
    public postflg = 0;
    private halted = false;

    constructor(biosRom: Uint8Array, romData: Uint8Array) {
        this.bios = biosRom;
        
        // --- 1. Detect Save Type and Configure Components ---
        let saveType = SaveType.NONE;
        let eepromSize = 512; // Default to smaller 4Kbit size for games like Ruby
        
        if (romData.length > 0) {
            const romString = new TextDecoder("ascii").decode(romData.slice(0, 0x200));
            if (romString.includes("EEPROM_V")) {
                saveType = SaveType.EEPROM;
                // Heuristic: if ROM > 8MB (ie. 16MB or 32MB), assume larger 64Kbit EEPROM
                if (romData.length > 8 * 1024 * 1024) { 
                    eepromSize = 8192;
                    console.log("Detected 64Kbit EEPROM save type (likely Sapphire/Emerald).");
                } else {
                    console.log("Detected 4Kbit EEPROM save type (likely Ruby).");
                }
            } else if (romString.includes("FLASH1M_V") || romString.includes("FLASH_V")) {
                saveType = SaveType.FLASH_128K;
                console.log("Detected 128K FLASH save type.");
            } else if (romString.includes("FLASH512_V") || romString.includes("FLASH_512")) {
                saveType = SaveType.FLASH_64K;
                console.log("Detected 64K FLASH save type.");
            } else if (romString.includes("SRAM_V")) {
                saveType = SaveType.SRAM_64K;
                console.log("Detected SRAM save type.");
            }
        }
        
        // --- 2. Instantiate all components with correct config ---
        this.eeprom = new Eeprom(eepromSize);
        this.cpu = new Cpu(this);
        this.joypad = new Joypad();
        this.dma = new DmaController(this);
        this.ppu = new Ppu(this);
        this.apu = new Apu(this);
        this.timers = new TimerController(this);
        this.mmu = new Mmu(this, biosRom);

        // --- 3. Wire up components that need circular references ---
        this.joypad.setGba(this);
        this.cpu.bus = this.mmu;
        this.ppu.bus = this.mmu;
        this.dma.setCpu(this.cpu);
        this.dma.setBus(this.mmu);
        
        // --- 4. Load ROM and Reset System State ---
        if (romData.length > 0) {
            this.mmu.loadRom(romData, saveType);
            this.mmu.loadRam();
        }
        this.cpu.reset();
    }

    setScreen(ctx: CanvasRenderingContext2D) {
        this.ppu.setContext(ctx);
    }
    
    async initAudio() {
        await this.apu.init();
    }

    setVolume(level: number) {
        this.apu.setVolume(level);
    }
    
    setSpeed(multiplier: number) {
        this.speedMultiplier = Math.max(0.1, multiplier);
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.apu.start();
        
        this.lastFrameTime = performance.now();
        this.accumulatedTime = 0;
        
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = requestAnimationFrame(this.runFrameLoop);
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;

        this.mmu.saveRam();

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = 0;
        }
        this.apu.stop();
    }

    public tick(cycles: number) {
        this.cyclesThisFrame += cycles;
        this.ppu.step(cycles);
        this.apu.step(cycles);
        this.timers.step(cycles);
    }

    public setHalted(value: boolean) {
        this.halted = value;
    }
    
    public getRamData(): Uint8Array | null {
        return this.mmu.getRamData();
    }
    
    public loadRamData(data: Uint8Array): void {
        this.mmu.loadRamData(data);
    }
    
    public saveState(romName: string): GameStateWithMetadata {
        const screenshotDataUrl = this.ppu.getCanvasDataURL();
        
        const state: GameState = {
            cpu: this.cpu.getState(),
            ppu: this.ppu.getState(),
            apu: this.apu.getState(),
            mmu: this.mmu.getState(),
            timers: this.timers.getState(),
            dma: this.dma.getState(),
            joypad: this.joypad.getState(),
            eeprom: this.eeprom.getState(),
        };

        return {
            timestamp: new Date().toISOString(),
            romName,
            screenshotDataUrl,
            state
        };
    }

    public loadState(state: GameState) {
        if (!state.mmu || !state.mmu.rom || state.mmu.rom.length === 0) {
            throw new Error("ROM data is missing from save state.");
        }
        
        // When loading state, we need to re-initialize components based on the loaded state
        this.eeprom.loadState(state.eeprom); // Load EEPROM state first as MMU depends on it
        this.mmu.loadRom(state.mmu.rom, state.mmu.saveType);
        this.mmu.loadState(state.mmu);

        this.cpu.loadState(state.cpu);
        this.ppu.loadState(state.ppu);
        this.apu.loadState(state.apu);
        this.timers.loadState(state.timers);
        this.dma.loadState(state.dma);
        this.joypad.loadState(state.joypad);
        
        console.log("GBA state loaded.");
    }
    
    private runSingleFrame() {
        this.cyclesThisFrame = 0;
        while (this.cyclesThisFrame < CYCLES_PER_FRAME) {
            if (this.halted) {
                // If halted, we only tick the system components to keep timers running
                // until an interrupt happens. We advance time by a small amount.
                this.tick(4);
                
                // An interrupt request (IE & IF being non-zero) wakes the CPU, 
                // even if interrupts are globally disabled by IME or masked in the CPSR.
                if ((this.cpu.IE & this.cpu.IF) !== 0) {
                    this.setHalted(false);
                }
                continue;
            }

            // DMA has priority over the CPU. A triggered DMA will run to completion here.
            if(this.dma.checkAndRun()) {
                continue;
            }
            
            this.cpu.step();
        }
    }
        
    public requestInterrupt(flag: number) {
        this.cpu.IF |= (1 << flag);
        
        // An interrupt can wake the CPU from a HALT state
        if (this.halted) {
             if ((this.cpu.IE & this.cpu.IF) !== 0) {
                 this.setHalted(false);
            }
        }
    }

    private runFrameLoop = (currentTime: number) => {
        if (!this.isRunning) return;
        this.animationFrameId = requestAnimationFrame(this.runFrameLoop);

        const deltaTime = currentTime - this.lastFrameTime;
        this.lastFrameTime = currentTime;
        this.accumulatedTime += deltaTime * this.speedMultiplier;

        // Cap accumulated time to prevent spiral of death if performance is poor
        const cap = 250 * Math.max(1, this.speedMultiplier);
        if (this.accumulatedTime > cap) {
            this.accumulatedTime = cap;
        }
        
        // Run frames to catch up to real time
        while (this.accumulatedTime >= this.targetFrameTime) {
            this.runSingleFrame();
            this.accumulatedTime -= this.targetFrameTime;
        }
    };

    public generateStateDump(): string {
        const hex = (n: number, pad = 8) => n.toString(16).toUpperCase().padStart(pad, '0');
        
        // CPU State
        const cpu = this.cpu;
        const cpsr = cpu.cpsr;
        const modeVal = cpsr & 0x1F;
        const modeNames: { [key: number]: string } = {
            [CpuMode.USER]: 'USR', [CpuMode.FIQ]: 'FIQ', [CpuMode.IRQ]: 'IRQ',
            [CpuMode.SVC]: 'SVC', [CpuMode.ABT]: 'ABT', [CpuMode.UND]: 'UND', [CpuMode.SYS]: 'SYS'
        };
        const cpsrFlags = `${(cpsr>>31)&1 ? 'N':'-'}${(cpsr>>30)&1 ? 'Z':'-'}${(cpsr>>29)&1 ? 'C':'-'}${(cpsr>>28)&1 ? 'V':'-'}`;
        const cpuDump = `[CPU]
  R0-R3:  ${hex(cpu.getReg(0))} ${hex(cpu.getReg(1))} ${hex(cpu.getReg(2))} ${hex(cpu.getReg(3))}
  R4-R7:  ${hex(cpu.getReg(4))} ${hex(cpu.getReg(5))} ${hex(cpu.getReg(6))} ${hex(cpu.getReg(7))}
  R8-R12: ${hex(cpu.getReg(8))} ${hex(cpu.getReg(9))} ${hex(cpu.getReg(10))} ${hex(cpu.getReg(11))} ${hex(cpu.getReg(12))}
  SP: ${hex(cpu.getReg(13))}  LR: ${hex(cpu.getReg(14))}  PC: ${hex(cpu.getReg(15))}
  CPSR: ${hex(cpsr)} (Mode: ${modeNames[modeVal] || '???'} T:${(cpsr>>5)&1} Flags:${cpsrFlags} IRQ:${(cpsr>>7)&1?'Off':'On'} FIQ:${(cpsr>>6)&1?'Off':'On'})
  Pipeline: [Fetch: ${hex(cpu.pipeline[1])}, Decode: ${hex(cpu.pipeline[0])}]
`;
    
        // Interrupt State
        const ie_if = cpu.IE & cpu.IF;
        const interruptNames = ['VBLANK','HBLANK','VCOUNT','TMR0','TMR1','TMR2','TMR3','SERIAL','DMA0','DMA1','DMA2','DMA3','KEYPAD','GAMEPAK'];
        let pendingIrqs = [];
        for(let i=0; i<14; i++) {
            if((ie_if >> i) & 1) pendingIrqs.push(interruptNames[i]);
        }
        const interruptDump = `[Interrupts]
  IME: ${cpu.IME}  IE: ${hex(cpu.IE, 4)}  IF: ${hex(cpu.IF, 4)}
  Pending & Enabled: ${pendingIrqs.length > 0 ? pendingIrqs.join(', ') : 'None'}
`;
    
        // PPU State
        const ppu = this.ppu;
        const dispcnt = ppu.dispcnt;
        const ppuDump = `[PPU]
  VCOUNT: ${ppu.vcount.toString().padStart(3, ' ')} DISPCNT: ${hex(dispcnt, 4)} (Mode:${dispcnt&7} BG:[${(dispcnt>>8)&1},${(dispcnt>>9)&1},${(dispcnt>>10)&1},${(dispcnt>>11)&1}] OBJ:${(dispcnt>>12)&1} WIN:[${(dispcnt>>13)&1},${(dispcnt>>14)&1},${(dispcnt>>15)&1}])
  DISPSTAT: ${hex(ppu.dispstat, 2)} (VBlank:${ppu.dispstat&1} HBlank:${(ppu.dispstat>>1)&1} VCount:${(ppu.dispstat>>2)&1} IRQ:[V:${(ppu.dispstat>>3)&1},H:${(ppu.dispstat>>4)&1},C:${(ppu.dispstat>>5)&1}])
`;
    
        // Timer State
        let timerDump = '[Timers]\n';
        const timerState = this.timers.getState();
        for(let i=0; i<4; i++) {
            const t = timerState.timers[i];
            const ctrl = t.control;
            const prescaler = [1,64,256,1024][ctrl&3];
            timerDump += `  TM${i}CNT: ${hex(ctrl, 2)} (Val:${hex(t.counter,4)}/${hex(t.reload,4)} Freq:${prescaler} IRQ:${(ctrl>>6)&1} Cascade:${(ctrl>>2)&1} On:${(ctrl>>7)&1})\n`;
        }
    
        // DMA State
        let dmaDump = '[DMA]\n';
        const dmaState = this.dma.getState();
        for(let i=0; i<4; i++) {
            const ch = dmaState.channels[i];
            const ctrl = ch.control;
            const timingModes = ['Immediate', 'VBlank', 'HBlank', 'Special'];
            dmaDump += `  DMA${i}CNT: ${hex(ctrl, 4)} (On:${(ctrl>>15)&1} IRQ:${(ctrl>>14)&1} Timing:${timingModes[(ctrl>>12)&3]} 32b:${(ctrl>>10)&1} Rep:${(ctrl>>9)&1})\n`;
        }
    
        const dump = `
--- GBA STATE DUMP ---
Timestamp: ${new Date().toISOString()}
${cpuDump}
${interruptDump}
${ppuDump}
${timerDump}
${dmaDump}--- END DUMP ---\n`;
    
        return dump;
    }

    public getDebugInfo(): DebugInfo {
        const formatHex = (n: number) => n.toString(16).toUpperCase().padStart(8, '0');
        const cpuState = this.cpu.getState();

        const registers: { [key:string]: string } = {};
        for(let i = 0; i < 13; i++) {
            registers[`R${i}`] = formatHex(this.cpu.getReg(i));
        }
        registers['SP'] = formatHex(this.cpu.getReg(13));
        registers['LR'] = formatHex(this.cpu.getReg(14));
        registers['PC'] = formatHex(this.cpu.getReg(15));
        registers['CPSR'] = formatHex(cpuState.cpsr);
        
        return {
            registers,
            iwram: this.mmu.getIwramSlice(0, 256),
        };
    }
    
    public getSerialChar(): string | null {
        if (this.serialBuffer.length > 0) {
            return this.serialBuffer.shift()!;
        }
        return null;
    }
}