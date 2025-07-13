import { Cpu, CpuMode } from '../Cpu';
import { barrelShift, aluAdd, aluSub, setFlags, countSetBits } from './helpers';


// --- THUMB Opcode Handlers ---
type ThumbOpcodeHandler = (cpu: Cpu, instruction: number) => void;

function unhandledThumb(cpu: Cpu, instruction: number) {
    const pc = cpu.isThumbMode() ? cpu.pc - 4 : cpu.pc - 8;
    cpu.logUnhandledOpcode(instruction, true, pc);
    cpu.triggerException(0x04, CpuMode.UND);
}

// Format 1: move shifted register
function thumbMoveShiftedRegister(cpu: Cpu, inst: number) {
    const op = (inst >> 11) & 3;
    const imm = (inst >> 6) & 0x1F;
    const rd = inst & 7;
    const rs = (inst >> 3) & 7;
    const rsVal = cpu.getReg(rs);
    const { val, carry } = barrelShift(cpu, op, rsVal, imm);
    cpu.setReg(rd, val);
    setFlags(cpu, val, carry, (cpu.cpsr >> 28) & 1);
}

// Format 2: add/subtract
function thumbAddSub(cpu: Cpu, inst: number) {
    const isSub = (inst >> 9) & 1;
    const rd = inst & 7;
    const rs = (inst >> 3) & 7;
    const rn_imm = (inst >> 6) & 7;
    const rsVal = cpu.getReg(rs);
    const op2 = (inst >> 10) & 1 ? rn_imm : cpu.getReg(rn_imm);
    const { result, carry, overflow } = isSub ? aluSub(rsVal, op2, 1) : aluAdd(rsVal, op2, 0);
    cpu.setReg(rd, result);
    setFlags(cpu, result, carry, overflow);
}

// Format 3: move/compare/add/subtract immediate
function thumbDataProcImm(cpu: Cpu, inst: number) {
    const op = (inst >> 11) & 3;
    const rd = (inst >> 8) & 7;
    const imm = inst & 0xFF;
    let result = 0, carry = 0, overflow = 0, rdVal = cpu.getReg(rd);
    switch(op) {
        case 0: result = imm; cpu.setReg(rd, result); setFlags(cpu, result, (cpu.cpsr >> 29) & 1, (cpu.cpsr >> 28) & 1); break; // MOV
        case 1: ({ result, carry, overflow } = aluSub(rdVal, imm, 1)); setFlags(cpu, result, carry, overflow); break; // CMP
        case 2: ({ result, carry, overflow } = aluAdd(rdVal, imm, 0)); cpu.setReg(rd, result); setFlags(cpu, result, carry, overflow); break; // ADD
        case 3: ({ result, carry, overflow } = aluSub(rdVal, imm, 1)); cpu.setReg(rd, result); setFlags(cpu, result, carry, overflow); break; // SUB
    }
}

// Format 4: ALU operations
function thumbAlu(cpu: Cpu, inst: number) {
    const op = (inst >> 6) & 0xF;
    const rd = inst & 7;
    const rs = (inst >> 3) & 7;
    let rdVal = cpu.getReg(rd), rsVal = cpu.getReg(rs);
    let result = 0, carry = (cpu.cpsr >> 29) & 1, overflow = (cpu.cpsr >> 28) & 1;
    switch(op) {
        case 0x0: result = rdVal & rsVal; break; // AND
        case 0x1: result = rdVal ^ rsVal; break; // EOR
        case 0x2: ({val: result, carry} = barrelShift(cpu, 0, rdVal, rsVal & 0xFF)); break; // LSL
        case 0x3: ({val: result, carry} = barrelShift(cpu, 1, rdVal, rsVal & 0xFF)); break; // LSR
        case 0x4: ({val: result, carry} = barrelShift(cpu, 2, rdVal, rsVal & 0xFF)); break; // ASR
        case 0x5: ({result, carry, overflow} = aluAdd(rdVal, rsVal, carry)); break; // ADC
        case 0x6: ({result, carry, overflow} = aluSub(rdVal, rsVal, carry)); break; // SBC
        case 0x7: ({val: result, carry} = barrelShift(cpu, 3, rdVal, rsVal & 0xFF)); break; // ROR
        case 0x8: result = rdVal & rsVal; break; // TST
        case 0x9: ({result, carry, overflow} = aluSub(0, rsVal, 1)); break; // NEG
        case 0xA: ({result, carry, overflow} = aluSub(rdVal, rsVal, 1)); break; // CMP
        case 0xB: ({result, carry, overflow} = aluAdd(rdVal, rsVal, 0)); break; // CMN
        case 0xC: result = rdVal | rsVal; break; // ORR
        case 0xD: result = rdVal * rsVal; cpu.gba.tick(1); break; // MUL
        case 0xE: result = rdVal & ~rsVal; break; // BIC
        case 0xF: result = ~rsVal; break; // MVN
    }
    if (op !== 0x8 && op !== 0xA && op !== 0xB) {
        cpu.setReg(rd, result);
    }
    setFlags(cpu, result, carry, overflow);
}

// Format 5: Hi register operations/branch exchange
function thumbHighRegOp(cpu: Cpu, inst: number) {
    const op = (inst >> 8) & 3;
    const h1 = (inst >> 7) & 1;
    const h2 = (inst >> 6) & 1;
    const rd_hs = (inst & 7) + (h1 << 3);
    const rs = (inst >> 3) & 7;
    const hs = rs + (h2 << 3);

    const rsVal = (hs === 15) ? (cpu.pc & ~2) : cpu.getReg(hs);
    
    switch (op) {
        case 0b00: // ADD
            cpu.setReg(rd_hs, cpu.getReg(rd_hs) + rsVal);
            break;
        case 0b01: // CMP
            const { result, carry, overflow } = aluSub(cpu.getReg(rd_hs), rsVal, 1);
            setFlags(cpu, result, carry, overflow);
            break;
        case 0b10: // MOV
            cpu.setReg(rd_hs, rsVal);
            break;
        case 0b11: // BX
            const bxAddr = cpu.getReg(hs);
            if (bxAddr & 1) {
                cpu.setThumbMode(true);
                cpu.pc = bxAddr & ~1;
            } else {
                cpu.setThumbMode(false);
                cpu.pc = bxAddr & ~3;
            }
            cpu.fillPipeline();
            cpu.gba.tick(2);
            return;
    }
    if(rd_hs === 15) {
        cpu.pc &= ~1;
        cpu.fillPipeline();
        cpu.gba.tick(2);
    }
}

// Format 6: PC-relative LDR
function thumbPcRelLoad(cpu: Cpu, inst: number) {
    const rd = (inst >> 8) & 7;
    const offset = (inst & 0xFF) << 2;
    const addr = (cpu.pc & ~2) + offset;
    cpu.setReg(rd, cpu.bus.read32(addr));
    cpu.gba.tick(1);
}

// Format 7: LDR/STR with register offset
function thumbLdrStrRegOffset(cpu: Cpu, inst: number) {
    const isLoad = (inst >> 11) & 1;
    const isByte = (inst >> 10) & 1;
    const ro = (inst >> 6) & 7;
    const rb = (inst >> 3) & 7;
    const rd = inst & 7;
    const addr = cpu.getReg(rb) + cpu.getReg(ro);

    if (isLoad) {
        if (isByte) cpu.setReg(rd, cpu.bus.read8(addr));
        else cpu.setReg(rd, cpu.bus.read32(addr));
    } else {
        if (isByte) cpu.bus.write8(addr, cpu.getReg(rd));
        else cpu.bus.write32(addr, cpu.getReg(rd));
    }
}

// Format 8: LDR/STR with sign-extended byte/halfword
function thumbLdrStrSignExt(cpu: Cpu, inst: number) {
    const hFlag = (inst >> 11) & 1;
    const sFlag = (inst >> 10) & 1;
    const ro = (inst >> 6) & 7;
    const rb = (inst >> 3) & 7;
    const rd = inst & 7;
    const addr = cpu.getReg(rb) + cpu.getReg(ro);

    if (sFlag) { // LDRSH/LDRSB
        if (hFlag) { // LDRSH
            const val = cpu.bus.read16(addr);
            cpu.setReg(rd, val & 0x8000 ? val | 0xFFFF0000 : val);
        } else { // LDRSB
            const val = cpu.bus.read8(addr);
            cpu.setReg(rd, val & 0x80 ? val | 0xFFFFFF00 : val);
        }
    } else { // STRH/LDRH
        if (hFlag) { // LDRH
            cpu.setReg(rd, cpu.bus.read16(addr));
        } else { // STRH
            cpu.bus.write16(addr, cpu.getReg(rd));
        }
    }
}

// Format 9: LDR/STR with immediate offset
function thumbLdrStrImmOffset(cpu: Cpu, inst: number) {
    const isLoad = (inst >> 11) & 1;
    const isByte = (inst >> 12) & 1;
    const offset = ((inst >> 6) & 0x1F) << (isByte ? 0 : 2);
    const rb = (inst >> 3) & 7;
    const rd = inst & 7;
    const addr = cpu.getReg(rb) + offset;

    if (isLoad) {
        if (isByte) cpu.setReg(rd, cpu.bus.read8(addr));
        else cpu.setReg(rd, cpu.bus.read32(addr));
    } else {
        if (isByte) cpu.bus.write8(addr, cpu.getReg(rd) & 0xFF);
        else cpu.bus.write32(addr, cpu.getReg(rd));
    }
}

// Format 10: LDRH/STRH with immediate offset
function thumbLdrStrHalfword(cpu: Cpu, inst: number) {
    const isLoad = (inst >> 11) & 1;
    const offset = ((inst >> 6) & 0x1F) << 1;
    const rb = (inst >> 3) & 7;
    const rd = inst & 7;
    const addr = cpu.getReg(rb) + offset;

    if (isLoad) {
        cpu.setReg(rd, cpu.bus.read16(addr));
    } else {
        cpu.bus.write16(addr, cpu.getReg(rd) & 0xFFFF);
    }
}

// Format 11: SP-relative LDR/STR
function thumbSpRelLdrStr(cpu: Cpu, inst: number) {
    const isLoad = (inst >> 11) & 1;
    const rd = (inst >> 8) & 7;
    const offset = (inst & 0xFF) << 2;
    const addr = cpu.getReg(13) + offset;
    if (isLoad) {
        cpu.setReg(rd, cpu.bus.read32(addr));
    } else {
        cpu.bus.write32(addr, cpu.getReg(rd));
    }
}

// Format 12: Load Address
function thumbLoadAddress(cpu: Cpu, inst: number) {
    const useSp = (inst >> 11) & 1;
    const rd = (inst >> 8) & 7;
    const offset = (inst & 0xFF) << 2;
    const base = useSp ? cpu.getReg(13) : (cpu.pc & ~2);
    cpu.setReg(rd, base + offset);
}

// Format 13: Add offset to Stack Pointer
function thumbAddSp(cpu: Cpu, inst: number) {
    let sp = cpu.getReg(13);
    const imm = (inst & 0x7F) << 2;
    sp += ((inst >> 7) & 1) ? -imm : imm;
    cpu.setReg(13, sp);
}

// Format 14: PUSH/POP registers
function thumbPushPop(cpu: Cpu, inst: number) {
    let sp = cpu.getReg(13);
    const rlist = inst & 0xFF;
    const isPop = (inst >> 11) & 1;
    const pc_lr = (inst >> 8) & 1;

    if (isPop) { // POP
        let addr = sp;
        for (let i = 0; i < 8; i++) {
            if ((rlist >> i) & 1) {
                cpu.setReg(i, cpu.bus.read32(addr));
                addr += 4;
            }
        }
        if (pc_lr) {
            let val = cpu.bus.read32(addr);
            if (val & 1) {
                cpu.setThumbMode(true);
                cpu.pc = val & ~1;
            } else {
                cpu.setThumbMode(false);
                cpu.pc = val & ~3;
            }
            addr += 4;
            cpu.fillPipeline();
            cpu.gba.tick(2);
        }
        cpu.setReg(13, addr);
    } else { // PUSH
        const numRegs = countSetBits(rlist) + (pc_lr ? 1 : 0);
        let baseAddr = sp - numRegs * 4;
        let addr = baseAddr;
        cpu.setReg(13, baseAddr);

        for (let i = 0; i < 8; i++) {
            if ((rlist >> i) & 1) {
                cpu.bus.write32(addr, cpu.getReg(i));
                addr += 4;
            }
        }
        if (pc_lr) {
            cpu.bus.write32(addr, cpu.getReg(14));
        }
    }
}

// Format 15: Multiple LDM/STM
function thumbMultiLdrStr(cpu: Cpu, inst: number) {
    const isLoad = (inst >> 11) & 1;
    const rb = (inst >> 8) & 7;
    const rlist = inst & 0xFF;
    let addr = cpu.getReg(rb);
    const rbInList = (rlist >> rb) & 1;
    let wroteRb = false;
    
    if (rlist === 0) { // Empty rlist implies transfer R15, but address is for 16 regs
        const finalAddr = addr + 0x40;
        if (isLoad) {
            const val = cpu.bus.read32(addr);
            if (val & 1) { cpu.setThumbMode(true); cpu.pc = val & ~1; }
            else { cpu.setThumbMode(false); cpu.pc = val & ~3; }
            cpu.fillPipeline();
        } else {
            cpu.bus.write32(addr, cpu.pc - 2);
        }
        cpu.setReg(rb, finalAddr);
        return;
    }

    const finalAddr = addr + countSetBits(rlist) * 4;

    for (let i = 0; i < 8; i++) {
        if ((rlist >> i) & 1) {
            if (isLoad) {
                if (i === rb) wroteRb = true;
                cpu.setReg(i, cpu.bus.read32(addr));
            } else {
                let val = cpu.getReg(i);
                if (i === rb && rlist === (1 << i)) { // Storing only Rb
                    val = addr;
                } else if (i === rb) { // Storing Rb and other regs
                    val = addr;
                }
                cpu.bus.write32(addr, val);
            }
            addr += 4;
        }
    }

    if (isLoad) {
        if (!wroteRb) cpu.setReg(rb, finalAddr);
    } else {
        cpu.setReg(rb, finalAddr);
    }
}

// Format 16: Conditional branch
function thumbCondBranch(cpu: Cpu, inst: number) {
    const cond = (inst >> 8) & 0xF;
    if (cpu.checkCondition(cond)) {
        let offset = inst & 0xFF;
        if (offset & 0x80) offset |= 0xFFFFFF00;
        cpu.pc += offset << 1;
        cpu.fillPipeline();
        cpu.gba.tick(2);
    }
}

// Format 17: SWI
function thumbSwi(cpu: Cpu, inst: number) {
    cpu.bus.handleSwi(inst & 0xFF);
    cpu.gba.tick(2);
}

// Format 18: Unconditional branch
function thumbUncondBranch(cpu: Cpu, inst: number) {
    let offset = inst & 0x7FF;
    if (offset & 0x400) offset |= 0xFFFFF800;
    cpu.pc += offset << 1;
    cpu.fillPipeline();
    cpu.gba.tick(2);
}

// Format 19: Branch with link
function thumbBlPrefix(cpu: Cpu, inst: number) {
    let offset = inst & 0x7FF;
    if (offset & 0x400) offset |= 0xFFFFF800; // Sign extend
    cpu.setReg(14, cpu.pc + (offset << 12));
}

function thumbBl(cpu: Cpu, inst: number) {
    const offset = inst & 0x7FF;
    const oldPc = cpu.pc;
    cpu.pc = (cpu.getReg(14) + (offset << 1)) & ~1;
    cpu.setReg(14, (oldPc - 2) | 1); // Return address is next instruction, with THUMB bit set
    cpu.fillPipeline();
    cpu.gba.tick(2);
}


const thumbOpcodes: ThumbOpcodeHandler[] = new Array(1024).fill(unhandledThumb);

function initThumbOpcodes() {
    for (let i = 0; i < 1024; i++) {
        const inst = i << 6; 
        if ((inst & 0xE000) === 0x0000) {
            thumbOpcodes[i] = thumbMoveShiftedRegister;
        } else if ((inst & 0xF800) === 0x1800) {
            thumbOpcodes[i] = thumbAddSub;
        } else if ((inst & 0xE000) === 0x2000) {
            thumbOpcodes[i] = thumbDataProcImm;
        } else if ((inst & 0xFC00) === 0x4000) {
            thumbOpcodes[i] = thumbAlu;
        } else if ((inst & 0xFC00) === 0x4400) {
            thumbOpcodes[i] = thumbHighRegOp;
        } else if ((inst & 0xF800) === 0x4800) {
            thumbOpcodes[i] = thumbPcRelLoad;
        } else if ((inst & 0xF200) === 0x5000) {
             if ((inst >> 9) & 1) thumbOpcodes[i] = thumbLdrStrSignExt;
             else thumbOpcodes[i] = thumbLdrStrRegOffset;
        } else if ((inst & 0xE000) === 0x6000) {
            thumbOpcodes[i] = thumbLdrStrImmOffset;
        } else if ((inst & 0xF000) === 0x8000) {
            thumbOpcodes[i] = thumbLdrStrHalfword;
        } else if ((inst & 0xF000) === 0x9000) {
            thumbOpcodes[i] = thumbSpRelLdrStr;
        } else if ((inst & 0xF000) === 0xA000) {
            thumbOpcodes[i] = thumbLoadAddress;
        } else if ((inst & 0xFF00) === 0xB000) {
            thumbOpcodes[i] = thumbAddSp;
        } else if ((inst & 0xF600) === 0xB400) {
            thumbOpcodes[i] = thumbPushPop;
        } else if ((inst & 0xF000) === 0xC000) {
            thumbOpcodes[i] = thumbMultiLdrStr;
        } else if ((inst & 0xFF00) === 0xDF00) {
             thumbOpcodes[i] = thumbSwi;
        } else if ((inst & 0xF000) === 0xD000) {
             thumbOpcodes[i] = thumbCondBranch;
        } else if ((inst & 0xF000) === 0xE000) {
            thumbOpcodes[i] = thumbUncondBranch;
        } else if ((inst & 0xF800) === 0xF000) {
            thumbOpcodes[i] = thumbBlPrefix;
        } else if ((inst & 0xF800) === 0xF800) {
            thumbOpcodes[i] = thumbBl;
        }
    }
}
initThumbOpcodes();


export { thumbOpcodes };
