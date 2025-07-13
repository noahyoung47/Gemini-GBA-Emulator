
import { Mmu } from './Mmu';
import { Arm7tdmiState } from './types';
import { armOpcodes, thumbOpcodes } from './Opcodes';
import { Gba } from './Gba';

// --- Register constants for the 'r' array ---
const R13_USR = 13, R14_USR = 14, R15_PC = 15;
const R13_SVC = 16, R14_SVC = 17;
const R13_ABT = 18, R14_ABT = 19;
const R13_UND = 20, R14_UND = 21;
const R13_IRQ = 22, R14_IRQ = 23;
const R8_FIQ = 24, R9_FIQ = 25, R10_FIQ = 26, R11_FIQ = 27, R12_FIQ = 28, R13_FIQ = 29, R14_FIQ = 30;

// SPSR indices for the 'spsr' array
const SPSR_SVC = 0, SPSR_ABT = 1, SPSR_UND = 2, SPSR_IRQ = 3, SPSR_FIQ = 4;

export enum CpuMode {
    USER = 0b10000,
    FIQ  = 0b10001,
    IRQ  = 0b10010,
    SVC  = 0b10011,
    ABT  = 0b10111,
    UND  = 0b11011,
    SYS  = 0b11111,
}

export class Cpu {
    bus!: Mmu;
    gba: Gba;

    // Registers
    r = new Uint32Array(31); // GPRs + All Banked registers
    cpsr = 0;
    spsr = new Uint32Array(5);

    pipeline = new Uint32Array(2);

    // Interrupt control
    IME = 0;
    IE = 0;
    IF = 0;

    // Error logging state
    public consecutiveErrorCount = 0;
    
    constructor(gba: Gba) {
        this.gba = gba;
        // Defer reset to Gba constructor to ensure all components are wired
    }

    getState(): Arm7tdmiState {
        return { 
            r: this.r, cpsr: this.cpsr, spsr: this.spsr, pipeline: this.pipeline,
            IME: this.IME, IE: this.IE, IF: this.IF,
        };
    }

    loadState(state: Arm7tdmiState) {
        this.r.set(state.r);
        this.cpsr = state.cpsr;
        this.spsr.set(state.spsr);
        this.pipeline.set(state.pipeline);
        this.IME = state.IME;
        this.IE = state.IE;
        this.IF = state.IF;
        this.consecutiveErrorCount = 0;
    }
    
    reset() {
        this.r.fill(0);
        this.spsr.fill(0);
        
        this.setMode(CpuMode.SVC); 
        this.cpsr |= 0xC0; // FIQ/IRQ disabled
        
        this.r[R15_PC] = 0x00000000;
        this.pipeline.fill(0);
        
        this.IME = 0;
        this.IE = 0;
        this.IF = 0;
        this.consecutiveErrorCount = 0;
        
        this.bus = this.gba.mmu;

        this.setReg(13, 0x03007F00); // Main stack pointer (SVC)
        this.setMode(CpuMode.IRQ);
        this.setReg(13, 0x03007FA0); // IRQ stack pointer
        this.setMode(CpuMode.SYS);
        this.setReg(13, 0x03007F00); // System mode shares user stack
        this.setMode(CpuMode.SVC);
        this.fillPipeline();
    }

    fillPipeline() {
        if(this.isThumbMode()) {
            this.pc &= ~1;
            this.pipeline[0] = this.bus.read16(this.pc);
            this.pc += 2;
            this.pipeline[1] = this.bus.read16(this.pc);
        } else {
            this.pc &= ~3;
            this.pipeline[0] = this.bus.read32(this.pc);
            this.pc += 4;
            this.pipeline[1] = this.bus.read32(this.pc);
        }
    }
    
    getReg(reg: number): number {
        if (reg === 15) return this.pc;

        const mode = this.cpsr & 0x1F;
        if (mode === CpuMode.FIQ && reg >= 8 && reg < 13) {
            return this.r[R8_FIQ + (reg - 8)];
        }
        if (reg < 13) return this.r[reg];

        switch(mode) {
            case CpuMode.USER:
            case CpuMode.SYS:
                return reg === 13 ? this.r[R13_USR] : this.r[R14_USR];
            case CpuMode.SVC:
                return reg === 13 ? this.r[R13_SVC] : this.r[R14_SVC];
            case CpuMode.ABT:
                return reg === 13 ? this.r[R13_ABT] : this.r[R14_ABT];
            case CpuMode.UND:
                return reg === 13 ? this.r[R13_UND] : this.r[R14_UND];
            case CpuMode.IRQ:
                return reg === 13 ? this.r[R13_IRQ] : this.r[R14_IRQ];
            case CpuMode.FIQ:
                return reg === 13 ? this.r[R13_FIQ] : this.r[R14_FIQ];
        }
        return 0; // Should be unreachable
    }
    
    setReg(reg: number, val: number) {
        if (reg === 15) {
            this.r[R15_PC] = val;
            return;
        }

        const mode = this.cpsr & 0x1F;
        if (mode === CpuMode.FIQ && reg >= 8 && reg < 13) {
            this.r[R8_FIQ + (reg - 8)] = val;
            return;
        }
        if (reg < 13) {
            this.r[reg] = val;
            return;
        }

        switch(mode) {
            case CpuMode.USER: case CpuMode.SYS:
                if (reg === 13) this.r[R13_USR] = val; else this.r[R14_USR] = val; break;
            case CpuMode.SVC:
                if (reg === 13) this.r[R13_SVC] = val; else this.r[R14_SVC] = val; break;
            case CpuMode.ABT:
                if (reg === 13) this.r[R13_ABT] = val; else this.r[R14_ABT] = val; break;
            case CpuMode.UND:
                if (reg === 13) this.r[R13_UND] = val; else this.r[R14_UND] = val; break;
            case CpuMode.IRQ:
                if (reg === 13) this.r[R13_IRQ] = val; else this.r[R14_IRQ] = val; break;
            case CpuMode.FIQ:
                if (reg === 13) this.r[R13_FIQ] = val; else this.r[R14_FIQ] = val; break;
        }
    }

    public getUserReg(reg: number): number {
        if (reg < 13) return this.r[reg];
        if (reg === 13) return this.r[R13_USR];
        if (reg === 14) return this.r[R14_USR];
        return this.pc;
    }

    public setUserReg(reg: number, val: number) {
        if (reg < 13) { this.r[reg] = val; return; }
        if (reg === 13) { this.r[R13_USR] = val; return; }
        if (reg === 14) { this.r[R14_USR] = val; return; }
        if (reg === 15) { this.pc = val; }
    }

    get pc() { return this.r[R15_PC]; }
    set pc(val: number) { this.r[R15_PC] = val; }

    isThumbMode(): boolean { return (this.cpsr & 0x20) !== 0; }
    setThumbMode(val: boolean) {
        if (this.isThumbMode() !== val) {
            this.cpsr = val ? this.cpsr | 0x20 : this.cpsr & ~0x20;
        }
    }
    
    setMode(mode: CpuMode) {
        this.cpsr = (this.cpsr & ~0x1F) | mode;
    }

    getSpsr(): number {
        const mode = this.cpsr & 0x1F;
        switch(mode) {
            case CpuMode.SVC: return this.spsr[SPSR_SVC];
            case CpuMode.ABT: return this.spsr[SPSR_ABT];
            case CpuMode.UND: return this.spsr[SPSR_UND];
            case CpuMode.IRQ: return this.spsr[SPSR_IRQ];
            case CpuMode.FIQ: return this.spsr[SPSR_FIQ];
            default: return this.cpsr; // User/Sys mode has no SPSR
        }
    }
    
    setSpsr(val: number) {
        const mode = this.cpsr & 0x1F;
        switch(mode) {
            case CpuMode.SVC: this.spsr[SPSR_SVC] = val; break;
            case CpuMode.ABT: this.spsr[SPSR_ABT] = val; break;
            case CpuMode.UND: this.spsr[SPSR_UND] = val; break;
            case CpuMode.IRQ: this.spsr[SPSR_IRQ] = val; break;
            case CpuMode.FIQ: this.spsr[SPSR_FIQ] = val; break;
        }
    }

    checkInterrupts(): boolean {
        if (this.IME === 1 && (this.IE & this.IF) !== 0) {
            const irqDisabled = (this.cpsr >> 7) & 1;
            if (!irqDisabled) {
                this.triggerException(0x18, CpuMode.IRQ);
                return true;
            }
        }
        return false;
    }
    
    triggerException(targetAddr: number, mode: CpuMode) {
        const oldCpsr = this.cpsr;
        const returnPc = this.isThumbMode() ? this.pc - 2 : this.pc - 4;
        
        this.setMode(mode);
        this.setSpsr(oldCpsr);
        this.setReg(14, returnPc);
        
        this.cpsr |= 0x80; // Disable IRQ
        if (mode === CpuMode.FIQ) {
            this.cpsr |= 0x40;
        }
        
        this.setThumbMode(false);
        this.pc = targetAddr;
        this.fillPipeline();
    }

    step(): void {
        if (this.checkInterrupts()) return;

        const fetchedInstruction = this.pipeline[0];
        const currentPc = this.isThumbMode() ? this.pc - 4 : this.pc - 8;
        let handled = false;
        
        if (this.isThumbMode()) {
            this.pipeline[0] = this.pipeline[1];
            this.pc &= ~1;
            this.pipeline[1] = this.bus.read16(this.pc);
            this.pc = (this.pc + 2) | 0;
            
            const handler = thumbOpcodes[(fetchedInstruction >> 6)];
            if (handler) {
                handler(this, fetchedInstruction);
                handled = true;
            } else {
                 this.logUnhandledOpcode(fetchedInstruction, true, currentPc);
            }
        } else { // ARM Mode
            this.pipeline[0] = this.pipeline[1];
            this.pc &= ~3;
            this.pipeline[1] = this.bus.read32(this.pc);
            this.pc = (this.pc + 4) | 0;
            
            const cond = fetchedInstruction >>> 28;
            if (this.checkCondition(cond)) {
                const index = ((fetchedInstruction >> 16) & 0xFF0) | ((fetchedInstruction >> 4) & 0xF);
                const handler = armOpcodes[index];
                if (handler) {
                   handler(this, fetchedInstruction);
                   handled = true;
                } else {
                    this.logUnhandledOpcode(fetchedInstruction, false, currentPc);
                }
            } else {
                handled = true;
            }
        }

        this.gba.tick(1); // Base cycle for instruction execution
        
        if (handled) {
            this.consecutiveErrorCount = 0;
        }
    }

    logUnhandledOpcode(instruction: number, isThumb: boolean, pc: number) {
        this.consecutiveErrorCount++;
        if (this.consecutiveErrorCount > 100) return;

        const type = isThumb ? "THUMB" : "ARM";
        const instStr = isThumb ? instruction.toString(16).padStart(4, '0') : instruction.toString(16).padStart(8, '0');
        const pcStr = pc.toString(16).padStart(8, '0');
        console.error(`Unhandled ${type} instruction: 0x${instStr} at PC=0x${pcStr}`);
        
        if (this.consecutiveErrorCount === 100) {
             console.warn(`Suppressing further unhandled instruction logs to prevent spam.`);
        }
    }

    checkCondition(cond: number): boolean {
        const N = (this.cpsr >> 31) & 1;
        const Z = (this.cpsr >> 30) & 1;
        const C = (this.cpsr >> 29) & 1;
        const V = (this.cpsr >> 28) & 1;

        switch (cond) {
            case 0b0000: return Z === 1; // EQ
            case 0b0001: return Z === 0; // NE
            case 0b0010: return C === 1; // CS/HS
            case 0b0011: return C === 0; // CC/LO
            case 0b0100: return N === 1; // MI
            case 0b0101: return N === 0; // PL
            case 0b0110: return V === 1; // VS
            case 0b0111: return V === 0; // VC
            case 0b1000: return C === 1 && Z === 0; // HI
            case 0b1001: return C === 0 || Z === 1; // LS
            case 0b1010: return N === V; // GE
            case 0b1011: return N !== V; // LT
            case 0b1100: return Z === 0 && N === V; // GT
            case 0b1101: return Z === 1 || N !== V; // LE
            case 0b1110: return true; // AL
            case 0b1111: return true; // NV (Used for unconditional instructions in ARMv5+)
        }
        return false;
    }
}
