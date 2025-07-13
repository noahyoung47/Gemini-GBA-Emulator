import { Cpu } from '../Cpu';

// --- Helper Functions ---
export function barrelShift(cpu: Cpu, type: number, val: number, amount: number) {
    if (amount === 0) {
        const oldCarry = (cpu.cpsr >> 29) & 1;
        switch (type) {
            case 0: // LSL #0 - value is unchanged, carry is unaffected
                return { val, carry: oldCarry };
            case 1: // LSR #32
                return { val: 0, carry: (val >>> 31) & 1 };
            case 2: // ASR #32
                const signBit = (val >> 31) & 1;
                return { val: signBit ? 0xFFFFFFFF : 0, carry: signBit };
            case 3: // RRX #1
                return { val: (oldCarry << 31) | (val >>> 1), carry: val & 1 };
        }
    }
    // Logic for amount > 0
    let carry = 0;
    switch (type) {
        case 0: // LSL
            if (amount >= 32) return { val: 0, carry: amount == 32 ? val & 1 : 0 };
            carry = (val >> (32 - amount)) & 1;
            return { val: val << amount, carry };
        case 1: // LSR
            if (amount >= 32) return { val: 0, carry: amount == 32 ? (val >> 31) & 1 : 0 };
            carry = (val >> (amount - 1)) & 1;
            return { val: val >>> amount, carry };
        case 2: // ASR
            if (amount >= 32) amount = 31;
            carry = (val >> (amount - 1)) & 1;
            return { val: val >> amount, carry };
        case 3: // ROR
            amount %= 32;
            if(amount === 0) return { val: val, carry: (val >> 31) & 1 };
            carry = (val >> (amount - 1)) & 1;
            return { val: (val >>> amount) | (val << (32 - amount)), carry };
    }
    return { val, carry: (cpu.cpsr >> 29) & 1 };
}


export function aluAdd(op1: number, op2: number, cFlag: number) {
    const res = (op1 + op2 + cFlag) >>> 0;
    const c = ((op1 >>> 0) + (op2 >>> 0) + cFlag) > 0xFFFFFFFF;
    const v = (~(op1 ^ op2) & (op1 ^ res)) >>> 31;
    return { result: res, carry: c ? 1 : 0, overflow: v & 1 };
}

export function aluSub(op1: number, op2: number, cFlag: number) {
    const res = (op1 - op2 - (1 - cFlag)) >>> 0;
    const c = (op1 >>> 0) >= ((op2 >>> 0) + (1 - cFlag));
    const v = ((op1 ^ op2) & (op1 ^ res)) >>> 31;
    return { result: res, carry: c ? 1 : 0, overflow: v & 1 };
}

export function setFlags(cpu: Cpu, result: number, carry: number, overflow: number) {
    let n = (result >> 31) & 1;
    let z = result === 0 ? 1 : 0;
    cpu.cpsr = (cpu.cpsr & 0x0FFFFFFF) | (n << 31) | (z << 30) | (carry << 29) | (overflow << 28);
}

export function setFlags64(cpu: Cpu, result: bigint, carry: number, overflow: number) {
    let n = (result >> 63n) & 1n;
    let z = result === 0n ? 1 : 0;
    cpu.cpsr = (cpu.cpsr & 0x0FFFFFFF) | (Number(n) << 31) | (z << 30) | (carry << 29) | (overflow << 28);
}

export function countSetBits(n: number): number {
    let count = 0;
    while (n > 0) {
        n &= (n - 1);
        count++;
    }
    return count;
}
