import { Cpu, CpuMode } from '../Cpu';
import { barrelShift, aluAdd, aluSub, setFlags, setFlags64, countSetBits } from './helpers';

// --- ARM Opcode Handlers ---
type ArmOpcodeHandler = (cpu: Cpu, instruction: number) => void;

function unhandledArm(cpu: Cpu, instruction: number) {
    const pc = cpu.isThumbMode() ? cpu.pc - 4 : cpu.pc - 8;
    cpu.logUnhandledOpcode(instruction, false, pc);
    cpu.triggerException(0x04, CpuMode.UND);
}

function armUndefined(cpu: Cpu, instruction: number) {
    cpu.triggerException(0x04, CpuMode.UND);
}

const armOpcodes: ArmOpcodeHandler[] = new Array(0x1000).fill(unhandledArm);

function armBranch(cpu: Cpu, instruction: number) {
    // BLX instructions are misidentified as B/BL due to the dispatch table encoding.
    // We check for the '1111' condition field here to correctly dispatch to BLX.
    if ((instruction >>> 28) === 0b1111) {
        armBranchExchangeLinkImm(cpu, instruction);
        return;
    }

    let offset = instruction & 0x00FFFFFF;
    if (offset & 0x00800000) {
        offset |= 0xFF000000; // Sign extend
    }
    offset <<= 2;

    if ((instruction >> 24) & 1) { // Branch with Link
        cpu.setReg(14, (cpu.pc - 4));
    }
    
    cpu.pc += offset;
    cpu.fillPipeline();
    cpu.gba.tick(2);
}

function armBranchExchange(cpu: Cpu, instruction: number) {
    const rn = instruction & 0xF;
    const addr = cpu.getReg(rn);
    
    if (addr & 1) {
        cpu.setThumbMode(true);
        cpu.pc = addr & ~1;
    } else {
        cpu.setThumbMode(false);
        cpu.pc = addr & ~3;
    }
    cpu.fillPipeline();
    cpu.gba.tick(2);
}

function armBranchExchangeLinkImm(cpu: Cpu, instruction: number) {
    let offset = instruction & 0x00FFFFFF;
    if (offset & 0x00800000) {
        offset |= 0xFF000000; // Sign extend 24-bit value
    }

    const h = (instruction >> 24) & 1;
    
    // Store return address. This is an ARM instruction, so return is to ARM mode.
    cpu.setReg(14, (cpu.pc - 4));
    
    // Target address is PC-relative. PC holds addr of current instruction + 8.
    const target = cpu.pc + (offset << 2) + (h << 1);
    
    cpu.pc = target;
    cpu.setThumbMode(true); // BLX always switches to THUMB state.
    cpu.fillPipeline();
    cpu.gba.tick(2);
}


function armDataProcessing(cpu: Cpu, instruction: number) {
    const rd = (instruction >> 12) & 0xF;
    const rn = (instruction >> 16) & 0xF;
    const op2Info = instruction & 0xFFF;
    const setFlagsCondition = (instruction >> 20) & 1;
    
    let operand2: number;
    let shiftCarry = (cpu.cpsr >> 29) & 1;

    if (instruction & 0x02000000) { // Immediate operand
        const imm = op2Info & 0xFF;
        const rotate = ((op2Info >> 8) & 0xF) * 2;
        operand2 = (imm >>> rotate) | (imm << (32 - rotate));
        if (rotate !== 0 && setFlagsCondition) {
            shiftCarry = (operand2 >> 31) & 1;
        }
    } else { // Register operand
        const rm = op2Info & 0xF;
        const shiftType = (op2Info >> 5) & 3;
        let shiftAmount: number;
        let isShiftByReg = (op2Info & 0x10) !== 0;

        if (isShiftByReg) { // Shift by register
             const rs = (op2Info >> 8) & 0xF;
             shiftAmount = cpu.getReg(rs) & 0xFF;
             cpu.gba.tick(1);
        } else { // Shift by immediate
             shiftAmount = (op2Info >> 7) & 0x1F;
        }
        
        let rmVal;
        if (rm === 15) {
            rmVal = isShiftByReg ? cpu.pc + 4 : cpu.pc;
        } else {
            rmVal = cpu.getReg(rm);
        }

        if (isShiftByReg && shiftAmount === 0) {
            operand2 = rmVal;
            // carry unaffected
        } else if (!isShiftByReg && shiftAmount === 0 && shiftType !== 0) { // Special case for LSR/ASR/ROR imm=0
            const shiftResult = barrelShift(cpu, shiftType, rmVal, 0); // 0 means #32 or RRX
            operand2 = shiftResult.val;
            shiftCarry = shiftResult.carry;
        }
        else {
            const shiftResult = barrelShift(cpu, shiftType, rmVal, shiftAmount);
            operand2 = shiftResult.val;
            shiftCarry = shiftResult.carry;
        }
    }
    
    const rnVal = rn === 15 ? cpu.pc : cpu.getReg(rn);
    let result = 0, carry = shiftCarry, overflow = (cpu.cpsr >> 28) & 1;
    const op = (instruction >> 21) & 0xF;

    switch (op) {
        case 0x0: result = rnVal & operand2; break; // AND
        case 0x1: result = rnVal ^ operand2; break; // EOR
        case 0x2: ({ result, carry, overflow } = aluSub(rnVal, operand2, 1)); break; // SUB
        case 0x3: ({ result, carry, overflow } = aluSub(operand2, rnVal, 1)); break; // RSB
        case 0x4: ({ result, carry, overflow } = aluAdd(rnVal, operand2, 0)); break; // ADD
        case 0x5: ({ result, carry, overflow } = aluAdd(rnVal, operand2, (cpu.cpsr >> 29) & 1)); break; // ADC
        case 0x6: ({ result, carry, overflow } = aluSub(rnVal, operand2, (cpu.cpsr >> 29) & 1)); break; // SBC
        case 0x7: ({ result, carry, overflow } = aluSub(operand2, rnVal, (cpu.cpsr >> 29) & 1)); break; // RSC
        case 0x8: result = rnVal & operand2; break; // TST
        case 0x9: result = rnVal ^ operand2; break; // TEQ
        case 0xA: ({ result, carry, overflow } = aluSub(rnVal, operand2, 1)); break; // CMP
        case 0xB: ({ result, carry, overflow } = aluAdd(rnVal, operand2, 0)); break; // CMN
        case 0xC: result = rnVal | operand2; break; // ORR
        case 0xD: result = operand2; break; // MOV
        case 0xE: result = rnVal & ~operand2; break; // BIC
        case 0xF: result = ~operand2; break; // MVN
    }

    if (setFlagsCondition) {
        if (rd === 15) {
             cpu.cpsr = cpu.getSpsr();
        } else {
             setFlags(cpu, result, carry, overflow);
        }
    }
    
    if ((op >= 0x8 && op <= 0xB)) { // TST, TEQ, CMP, CMN do not write to rd
        // No operation
    } else {
        if (rd === 15) {
            cpu.pc = result;
            cpu.fillPipeline();
            cpu.gba.tick(2);
        } else {
            cpu.setReg(rd, result);
        }
    }
}

function armMultiply(cpu: Cpu, instruction: number) {
    const rd = (instruction >> 16) & 0xF;
    const rn = (instruction >> 12) & 0xF;
    const rs = (instruction >> 8) & 0xF;
    const rm = instruction & 0xF;
    
    let result = cpu.getReg(rm) * cpu.getReg(rs);
    if ((instruction >> 21) & 1) { // MLA
        result += cpu.getReg(rn);
        cpu.gba.tick(1);
    }
    
    cpu.setReg(rd, result);

    if ((instruction >> 20) & 1) { // Set flags
        setFlags(cpu, result, 0, (cpu.cpsr >> 28) & 1);
    }
    cpu.gba.tick(1);
}

function armMultiplyLong(cpu: Cpu, instruction: number) {
    const rdHi = (instruction >> 16) & 0xF;
    const rdLo = (instruction >> 12) & 0xF;
    const rs = (instruction >> 8) & 0xF;
    const rm = instruction & 0xF;

    const accumulate = (instruction >> 21) & 1;
    const signed = (instruction >> 22) & 1;
    const setFlagsCond = (instruction >> 20) & 1;

    let rmVal = BigInt(cpu.getReg(rm));
    let rsVal = BigInt(cpu.getReg(rs));
    if (signed) {
      if (rmVal & 0x80000000n) rmVal -= 0x100000000n;
      if (rsVal & 0x80000000n) rsVal -= 0x100000000n;
    }
    let result = rmVal * rsVal;

    if (accumulate) {
        const hi = BigInt(cpu.getReg(rdHi)) << 32n;
        const lo = BigInt(cpu.getReg(rdLo));
        result += hi | lo;
        cpu.gba.tick(1);
    }
    
    cpu.setReg(rdHi, Number((result >> 32n) & 0xFFFFFFFFn));
    cpu.setReg(rdLo, Number(result & 0xFFFFFFFFn));
    
    if (setFlagsCond) {
        setFlags64(cpu, result, 0, (cpu.cpsr >> 28) & 1);
    }
    
    cpu.gba.tick(2); // Cycle count estimate
}


function armLoadStore(cpu: Cpu, instruction: number) {
    const rd = (instruction >> 12) & 0xF;
    const rn = (instruction >> 16) & 0xF;
    const isLoad = (instruction >> 20) & 1;
    const isByte = (instruction >> 22) & 1;
    const writeback = (instruction >> 21) & 1;
    const preIndex = (instruction >> 24) & 1;
    const up = (instruction >> 23) & 1;
    
    let offset: number;
    if (instruction & 0x02000000) { // Register offset
        const rm = instruction & 0xF;
        const shiftType = (instruction >> 5) & 3;
        const shiftAmount = (instruction >> 7) & 0x1F;
        offset = barrelShift(cpu, shiftType, cpu.getReg(rm), shiftAmount).val;
    } else { // Immediate offset
        offset = instruction & 0xFFF;
    }

    let addr = cpu.getReg(rn);
    if (preIndex) {
        addr += up ? offset : -offset;
    }

    if(isLoad) {
        let val;
        if (isByte) {
            val = cpu.bus.read8(addr);
        } else { // Word access
            if ((addr & 3) !== 0) {
                // Handle unaligned LDR: ROR(word, (addr & 3) * 8)
                const alignedAddr = addr & ~3;
                const word = cpu.bus.read32(alignedAddr);
                const rotation = (addr & 3) * 8;
                val = (word >>> rotation) | (word << (32 - rotation));
            } else {
                val = cpu.bus.read32(addr);
            }
        }

        if (rd === 15) {
            cpu.pc = val & ~3; // LDR into R15 is a branch, does not change state
            cpu.fillPipeline();
            cpu.gba.tick(2);
        } else {
             cpu.setReg(rd, val);
        }
        if (!preIndex) {
             addr = cpu.getReg(rn) + (up ? offset : -offset);
        }
        if (writeback || !preIndex) {
             cpu.setReg(rn, addr);
        }
    } else { // Store
        const val = rd === 15 ? cpu.pc + 4 : cpu.getReg(rd);
        if (isByte) cpu.bus.write8(addr, val & 0xFF);
        else cpu.bus.write32(addr, val);
        if (!preIndex) {
            addr = cpu.getReg(rn) + (up ? offset : -offset);
        }
        if (writeback) {
             cpu.setReg(rn, addr);
        }
    }
}

function armLoadStoreHalfwordSigned(cpu: Cpu, instruction: number) {
    const rd = (instruction >> 12) & 0xF;
    const rn = (instruction >> 16) & 0xF;
    const L = (instruction >> 20) & 1;
    const W = (instruction >> 21) & 1;
    const I = (instruction >> 22) & 1;
    const P = (instruction >> 24) & 1;
    const U = (instruction >> 23) & 1;
    const H = (instruction >> 5) & 1;
    const S = (instruction >> 6) & 1;

    let offset: number;
    if (I) { // Immediate offset
        offset = ((instruction & 0xF00) >> 4) | (instruction & 0xF);
    } else { // Register offset
        offset = cpu.getReg(instruction & 0xF);
    }

    let addr = cpu.getReg(rn);
    if (P) {
        addr += U ? offset : -offset;
    }

    if (L) { // Load
        let val = 0;
        if (S) { // Signed
            if (H) { // LDRSH
                val = cpu.bus.read16(addr);
                if (val & 0x8000) val |= 0xFFFF0000;
            } else { // LDRSB
                val = cpu.bus.read8(addr);
                if (val & 0x80) val |= 0xFFFFFF00;
            }
        } else { // Unsigned
            if (H) { // LDRH
                val = cpu.bus.read16(addr);
            } else { // LDRD - Not a valid GBA instruction
                unhandledArm(cpu, instruction); return;
            }
        }
        cpu.setReg(rd, val);

    } else { // Store
        if (H) { // STRH
            cpu.bus.write16(addr, cpu.getReg(rd) & 0xFFFF);
        } else { // STRD - Not a valid GBA instruction
            unhandledArm(cpu, instruction); return;
        }
    }

    if (W || !P) {
        const writebackAddr = cpu.getReg(rn) + (U ? offset : -offset);
        cpu.setReg(rn, writebackAddr);
    }
}

function armBlockLoadStore(cpu: Cpu, instruction: number) {
    const rn = (instruction >> 16) & 0xF;
    let rlist = instruction & 0xFFFF;
    let writeback = (instruction >> 21) & 1;
    const S = (instruction >> 22) & 1;
    const up = (instruction >> 23) & 1;
    const preIndex = (instruction >> 24) & 1;
    const isLoad = (instruction >> 20) & 1;

    if (rlist === 0) {
        // Empty rlist implies transfer R15, with a base offset of 0x40.
        const base = cpu.getReg(rn);
        let addr = base;
        
        if (up) {
            if (preIndex) addr += 4;
        } else { // Down
            addr -= 0x40;
            if (preIndex) addr += 4;
        }
        
        if (isLoad) {
            const val = cpu.bus.read32(addr);
            if (val & 1) {
                cpu.setThumbMode(true);
                cpu.pc = val & ~1;
            } else {
                cpu.setThumbMode(false);
                cpu.pc = val & ~3;
            }
            cpu.fillPipeline();
        } else { // Store
            cpu.bus.write32(addr, cpu.pc + 4);
        }
        if (writeback) {
            cpu.setReg(rn, base + (up ? 0x40 : -0x40));
        }
        cpu.gba.tick(3);
        return;
    }

    const numRegs = countSetBits(rlist);
    const initialRnVal = cpu.getReg(rn);
    
    let startAddr = initialRnVal;
    if (!up) { // Decrementing
        startAddr -= numRegs * 4;
    }
    if (preIndex && up) startAddr += 4;
    else if (preIndex && !up) startAddr -= 4;

    let currentAddr = startAddr;
    
    const currentMode = cpu.cpsr & 0x1F;
    const privileged = currentMode !== CpuMode.USER;
    const userBankTransfer = S && privileged && !(isLoad && (rlist >> 15) & 1);

    if (isLoad) {
        if ((rlist >> rn) & 1) writeback = 0; // LDM with Rn in list, no writeback
        for (let i = 0; i < 16; i++) {
            if ((rlist >> i) & 1) {
                const val = cpu.bus.read32(currentAddr);
                currentAddr += 4;

                if (i === 15) {
                    if (S && privileged) cpu.cpsr = cpu.getSpsr();
                    
                    if (val & 1) {
                        cpu.setThumbMode(true);
                        cpu.pc = val & ~1;
                    } else {
                        cpu.setThumbMode(false);
                        cpu.pc = val & ~3;
                    }
                    cpu.fillPipeline();
                    cpu.gba.tick(2); // Pipeline refill cycles
                    
                    // Instruction terminates after loading PC.
                    // Any subsequent registers in the list are not loaded.
                    if (writeback) {
                        cpu.setReg(rn, initialRnVal + (up ? (numRegs * 4) : -(numRegs * 4)));
                    }
                    return;
                } else if (userBankTransfer) {
                    cpu.setUserReg(i, val);
                } else {
                    cpu.setReg(i, val);
                }
            }
        }
        if (writeback) {
            cpu.setReg(rn, currentAddr);
        }

    } else { // Store
        let rnStored = false;
        for (let i = 0; i < 16; i++) {
            if ((rlist >> i) & 1) {
                let val;
                if (i === rn) {
                    // If Rn is the first register in the list to be stored, store the original value.
                    // Otherwise, store the written-back value.
                    val = rnStored ? initialRnVal + (up ? (numRegs * 4) : -(numRegs * 4)) : initialRnVal;
                    rnStored = true;
                } else if (i === 15) {
                    val = cpu.pc + 4;
                } else if (userBankTransfer) {
                    val = cpu.getUserReg(i);
                } else {
                    val = cpu.getReg(i);
                }
                cpu.bus.write32(currentAddr, val);
                currentAddr += 4;
            }
        }
        
        if (writeback) {
            cpu.setReg(rn, initialRnVal + (up ? (numRegs * 4) : -(numRegs * 4)));
        }
    }
}


function armMrs(cpu: Cpu, instruction: number) {
    const rd = (instruction >> 12) & 0xF;
    const useSpsr = (instruction >> 22) & 1;
    cpu.setReg(rd, useSpsr ? cpu.getSpsr() : cpu.cpsr);
}

function armMsr(cpu: Cpu, instruction: number) {
    const useSpsr = (instruction >> 22) & 1;
    const fieldMask = (instruction >> 16) & 0xF;
    let operand;
    
    if ((instruction >> 25) & 1) { // Immediate
        const imm = instruction & 0xFF;
        const rotate = ((instruction >> 8) & 0xF) * 2;
        operand = (imm >>> rotate) | (imm << (32 - rotate));
    } else { // Register
        operand = cpu.getReg(instruction & 0xF);
    }

    const currentMode = cpu.cpsr & 0x1F;
    const privileged = currentMode !== CpuMode.USER;
    let writeMask = 0;

    // Determine which fields to write based on field mask
    if (fieldMask & 0b1000) writeMask |= 0xFF000000; // f - flags
    // x, s fields are ignored on GBA
    if (fieldMask & 0b0001) { // c - control
        if (privileged) {
            writeMask |= 0x000000FF;
        } else {
            // Unprivileged can only write flags, not control bits.
            // This is implicitly handled as writeMask for control won't be set.
        }
    }

    if (useSpsr) {
        // Can only write to SPSR in modes that have one
        if (currentMode !== CpuMode.USER && currentMode !== CpuMode.SYS) {
            const currentSpsr = cpu.getSpsr();
            const newSpsr = (currentSpsr & ~writeMask) | (operand & writeMask);
            cpu.setSpsr(newSpsr);
        }
    } else { // Write to CPSR
        const oldCpsr = cpu.cpsr;
        // Apply write mask
        let newCpsr = (oldCpsr & ~writeMask) | (operand & writeMask);

        // If writing to control bits, validate the new mode.
        if ((writeMask & 0x1F) !== 0) {
            const newMode = newCpsr & 0x1F;
            const validModes = [
                CpuMode.USER, CpuMode.FIQ, CpuMode.IRQ, CpuMode.SVC,
                CpuMode.ABT, CpuMode.UND, CpuMode.SYS
            ];
            // @ts-ignore
            if (!validModes.includes(newMode)) {
                // The new mode is reserved/invalid. Real hardware behavior is
                // unpredictable. A safe emulation is to ignore the mode change.
                newCpsr = (newCpsr & ~0x1F) | (oldCpsr & 0x1F);
            }
        }

        const tBitChanged = (oldCpsr & 0x20) !== (newCpsr & 0x20);
        cpu.cpsr = newCpsr;
        
        if (tBitChanged) {
            cpu.fillPipeline();
        }
    }
}


function armSwi(cpu: Cpu, instruction: number) {
    cpu.bus.handleSwi(instruction & 0xFFFFFF);
    cpu.gba.tick(2);
}

function armSwap(cpu: Cpu, instruction: number) {
    const rd = (instruction >> 12) & 0xF;
    const rn = (instruction >> 16) & 0xF;
    const rm = instruction & 0xF;
    const isByte = (instruction >> 22) & 1;
    const addr = cpu.getReg(rn);
    
    if (isByte) {
        const temp = cpu.bus.read8(addr);
        cpu.bus.write8(addr, cpu.getReg(rm) & 0xFF);
        cpu.setReg(rd, temp);
    } else {
        const temp = cpu.bus.read32(addr);
        const rotated = (temp >>> (8 * (addr & 3))) | (temp << (32 - (8 * (addr & 3))));
        cpu.bus.write32(addr, cpu.getReg(rm));
        cpu.setReg(rd, rotated);
    }
    cpu.gba.tick(1);
}


// --- ARM Opcode Table Population ---
for (let i = 0; i < 4096; i++) {
    const op = ((i & 0xFF0) << 16) | ((i & 0xF) << 4);

    if ((op & 0x0FFFFFF0) === 0x012FFF10) { armOpcodes[i] = armBranchExchange;
    } else if ((op & 0x0FB00FF0) === 0x01000090) { armOpcodes[i] = armSwap;
    } else if ((op & 0x0FBF0FFF) === 0x010F0000) { armOpcodes[i] = armMrs;
    } else if ((op & 0x0FB00000) === 0x01200000) { armOpcodes[i] = armMsr;
    } else if ((op & 0x0F8000F0) === 0x00800090) { armOpcodes[i] = armMultiplyLong;
    } else if ((op & 0x0FC000F0) === 0x00000090) { armOpcodes[i] = armMultiply;
    } else if ((op & 0x0E000090) === 0x00000090) { armOpcodes[i] = armLoadStoreHalfwordSigned;
    } else if ((op & 0x0C000000) === 0x00000000) { armOpcodes[i] = armDataProcessing;
    } else if ((op & 0x0C000000) === 0x04000000) { armOpcodes[i] = armLoadStore;
    } else if ((op & 0x0E000000) === 0x08000000) { armOpcodes[i] = armBlockLoadStore;
    } else if ((op & 0x0E000000) === 0x0A000000) { armOpcodes[i] = armBranch;
    } else if ((op & 0x0FE00000) === 0x0FA00000) { armOpcodes[i] = armBranchExchangeLinkImm;
    } else if ((op & 0x0F000000) === 0x0E000000) { // Coprocessor CDP, MCR, MRC
        armOpcodes[i] = armUndefined;
    } else if ((op & 0x0E000000) === 0x0C000000) { // Coprocessor LDC, STC
        armOpcodes[i] = armUndefined;
    } else if ((op & 0x0F000000) === 0x0F000000) { armOpcodes[i] = armSwi;
    }
}

export { armOpcodes };
