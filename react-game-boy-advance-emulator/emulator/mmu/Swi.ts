
import { Gba } from '../Gba';
import { Cpu, CpuMode } from '../Cpu';

function swiCpuSet(gba: Gba, src: number, dest: number, ctrl: number) {
    let count = ctrl & 0x1FFFFF;
    if (count === 0) count = 0x100000;
    const is32bit = (ctrl >> 26) & 1;
    const isFill = (ctrl >> 24) & 1;
    const chunkSize = is32bit ? 4 : 2;

    if (isFill) {
        const fillValue = is32bit ? gba.mmu.read32(src) : gba.mmu.read16(src);
        for (let i = 0; i < count; i++) {
            if (is32bit) gba.mmu.write32(dest, fillValue);
            else gba.mmu.write16(dest, fillValue);
            dest += chunkSize;
        }
    } else {
        for (let i = 0; i < count; i++) {
            if (is32bit) gba.mmu.write32(dest, gba.mmu.read32(src));
            else gba.mmu.write16(dest, gba.mmu.read16(src));
            src += chunkSize;
            dest += chunkSize;
        }
    }
}

function swiCpuFastSet(gba: Gba, src: number, dest: number, ctrl: number) {
    let count = ctrl & 0x1FFFFF;
    if (count === 0) count = 0x20000;
    const isFill = (ctrl >> 24) & 1;
    const chunkSize = 4; // Always 32-bit

    if (isFill) {
        const fillValue = gba.mmu.read32(src);
        for (let i = 0; i < count; i++) {
            gba.mmu.write32(dest, fillValue);
            dest += chunkSize;
        }
    } else {
        for (let i = 0; i < count; i++) {
            gba.mmu.write32(dest, gba.mmu.read32(src));
            src += chunkSize;
            dest += chunkSize;
        }
    }
}

function swiLz77(gba: Gba, src: number, dest: number) {
    let destPtr = dest;
    let srcPtr = src;
    let header = gba.mmu.read32(srcPtr);
    srcPtr += 4;
    let remaining = header >> 8;

    while (remaining > 0) {
        const flags = gba.mmu.read8(srcPtr++);
        for (let i = 7; i >= 0; i--) {
            if (remaining <= 0) break;
            
            if (!((flags >> i) & 1)) { // Literal
                gba.mmu.write8(destPtr++, gba.mmu.read8(srcPtr++));
                remaining--;
            } else { // Compressed
                const b1 = gba.mmu.read8(srcPtr++);
                const b2 = gba.mmu.read8(srcPtr++);
                const length = (b1 >> 4) + 3;
                const disp = (((b1 & 0xF) << 8) | b2) + 1;
                
                let copySrc = destPtr - disp;
                for (let j = 0; j < length; j++) {
                    gba.mmu.write8(destPtr++, gba.mmu.read8(copySrc++));
                }
                remaining -= length;
            }
        }
    }
}

function swiRlUnComp(gba: Gba, src: number, dest: number) {
    let destPtr = dest;
    let srcPtr = src;

    let header = gba.mmu.read32(srcPtr);
    srcPtr += 4;
    let remaining = header >> 8;

    while (remaining > 0) {
        let flagByte = gba.mmu.read8(srcPtr++);
        if (flagByte & 0x80) { // Compressed
            const len = (flagByte & 0x7F) + 3;
            const data = gba.mmu.read8(srcPtr++);
            for (let i = 0; i < len; i++) {
                gba.mmu.write8(destPtr++, data);
            }
            remaining -= len;
        } else { // Uncompressed
            const len = flagByte + 1;
            for (let i = 0; i < len; i++) {
                gba.mmu.write8(destPtr++, gba.mmu.read8(srcPtr++));
            }
            remaining -= len;
        }
    }
}

function swiHuffman(gba: Gba, src: number, dest: number) {
    let destPtr = dest;
    let srcPtr = src;

    const header = gba.mmu.read32(srcPtr);
    srcPtr += 4;
    const dataBits = header >> 4;
    const treeSize = (gba.mmu.read8(srcPtr++) * 2) + 2;
    const treeRootOffset = srcPtr;
    srcPtr += treeSize;

    let bitsWritten = 0;
    let bitOffset = 0;
    
    while (bitsWritten < dataBits) {
        let nodeIndex = treeSize - 2; // Root of the tree is at the end
        while (true) {
            // Read one bit from the compressed data stream
            const bit = (gba.mmu.read8(srcPtr + Math.floor(bitOffset / 8)) >> (7 - (bitOffset % 8))) & 1;
            bitOffset++;
            
            // Traverse the tree
            const nodeVal = gba.mmu.read8(treeRootOffset + nodeIndex + bit);
            
            if (nodeVal & 0x80) { // Leaf node found
                gba.mmu.write8(destPtr++, nodeVal & 0x7F);
                bitsWritten += 8;
                break; 
            } else {
                // Not a leaf node, continue traversal. The offset is relative to the current node's position.
                const offset = (nodeVal & 0x7F) * 2;
                nodeIndex -= offset;
            }
        }
    }
}


export function handleSwi(gba: Gba, comment: number): void {
    const cpu = gba.cpu;
    const mmu = gba.mmu;

    const r0 = cpu.getReg(0);
    const r1 = cpu.getReg(1);
    const r2 = cpu.getReg(2);
    
    // This function emulates the GBA BIOS Software Interrupts.
    // Numbering is based on GBATEK documentation.
    switch (comment) {
        case 0x00: // SoftReset
            // The BIOS has already written to POSTFLG (0x4000300) before this.
            gba.postflg = 1;
            cpu.cpsr = (cpu.cpsr & ~0xFF) | CpuMode.SYS | 0xC0; // SYS mode, FIQ/IRQ disabled
            cpu.setReg(13, 0x03007F00); // System/User SP
            cpu.setReg(14, 0);
            (cpu.r as any)[22] = 0x03007FA0; // IRQ SP (accessing internal R13_IRQ)
            (cpu.r as any)[23] = 0; // R14_IRQ
            cpu.pc = 0x08000000;
            cpu.fillPipeline();
            break;
        
        case 0x01: // RegisterRamReset
            if ((r0 & 1)) mmu.getIwramSlice(0, 256*1024).fill(0); // EWRAM, though MMU manages it
            if ((r0 & 2)) mmu.getIwramSlice(0, 32*1024).fill(0); // IWRAM
            if ((r0 & 4)) gba.ppu.paletteRam.fill(0);
            if ((r0 & 8)) gba.ppu.vram.fill(0);
            if ((r0 & 16)) gba.ppu.oam.fill(0);
            break;
        
        case 0x02: // Halt
            gba.setHalted(true);
            break;

        case 0x03: // Stop
            // Enters a low-power stop state. For emulation, same as Halt.
            gba.setHalted(true);
            break;

        case 0x04: // IntrWait
            // r0=1: clear IE flags, r1=interrupt bits to wait for
            cpu.IE |= r1;
            gba.setHalted(true);
            break;

        case 0x05: // VBlankIntrWait
            // Alias for IntrWait(1,1) -> Wait for VBlank
            cpu.IE |= 1;
            gba.setHalted(true);
            break;
        
        case 0x06: // Div
            const num = r0, den = r1;
            if (den === 0) {
                cpu.setReg(0, -1); cpu.setReg(1, num); cpu.setReg(3, -1);
            } else {
                cpu.setReg(0, (num / den) | 0);
                cpu.setReg(1, num % den);
                cpu.setReg(3, Math.abs((num / den) | 0));
            }
            break;

        case 0x07: // DivArm
             // Not implemented / used by commercial games. Returns same as Div.
             handleSwi(gba, 0x06);
             break;
        
        case 0x08: // Sqrt
            let val = r0, root = 0, bit = 1 << 30;
            while (bit > val) bit >>= 2;
            while (bit !== 0) {
                if (val >= root + bit) {
                    val -= root + bit;
                    root = (root >> 1) + bit;
                } else {
                    root >>= 1;
                }
                bit >>= 2;
            }
            cpu.setReg(0, root);
            break;
        
        case 0x0A: // ArcTan2
            const x = r0, y = r1;
            cpu.setReg(0, Math.atan2(y, x) * 32768 / Math.PI);
            break;

        case 0x0B: // CpuSet
            swiCpuSet(gba, r0, r1, r2);
            break;

        case 0x0C: // CpuFastSet
            swiCpuFastSet(gba, r0, r1, r2);
            break;
            
        case 0x0D: // HuffmanDecompress
            swiHuffman(gba, r0, r1);
            break;

        case 0x0E: // RLUnCompWram
        case 0x0F: // RLUnCompVram
            swiRlUnComp(gba, r0, r1);
            break;

        case 0x10: // LZ77UnCompWram
        case 0x11: // LZ77UnCompVram
            swiLz77(gba, r0, r1);
            break;
        
        default:
            // Unhandled SWIs are ignored to prevent crashes on custom game SWIs.
            // console.warn(`Unhandled SWI: 0x${comment.toString(16)} at PC 0x${(cpu.pc-4).toString(16)}`);
            break;
    }
}
