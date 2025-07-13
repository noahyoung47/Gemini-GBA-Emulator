
import { Cpu, CpuMode } from './Cpu';
import { Ppu } from './Ppu';
import { Apu } from './Apu';
import { Joypad } from './Joypad';
import { TimerController } from './Timer';
import { DmaController } from './Dma';
import { MmuState, SaveType } from './types';
import { Gba } from './Gba';
import { Eeprom } from './Eeprom';
import { handleSwi as handleSwiImpl } from './mmu/Swi';

export class Mmu {
    private gba: Gba;
    
    private bios: Uint8Array;
    private iwram = new Uint8Array(32 * 1024);
    private ewram = new Uint8Array(256 * 1024);
    
    public cpu: Cpu;
    public ppu: Ppu;
    public apu: Apu;
    public joypad: Joypad;
    public timers: TimerController;
    public dma: DmaController;
    public eeprom: Eeprom;

    private rom = new Uint8Array(0);
    private saveMemory = new Uint8Array(0);
    public saveType: SaveType = SaveType.NONE;
    
    public romTitle = '';
    
    // Serial communication (for test ROMs)
    private serialData = 0;
    private serialCtrl = 0;

    // Wait state control
    private waitCnt = 0;
    private lastAccessAddr = 0;
    private waitStateN = [4, 3, 2, 8];
    private waitStateS = [[2, 1], [4, 1], [8, 1]];

    // Flash memory state
    private flashState = 0;
    private flashCmd = 0;
    private flashBank = 0;
    private flashId = 0;
    
    public loadRam: () => void;

    constructor(gba: Gba, bios: Uint8Array) {
        this.gba = gba;
        this.cpu = gba.cpu;
        this.ppu = gba.ppu;
        this.apu = gba.apu;
        this.joypad = gba.joypad;
        this.timers = gba.timers;
        this.dma = gba.dma;
        this.eeprom = gba.eeprom;
        this.bios = bios;

        this.loadRam = () => {
            if (this.saveType === SaveType.NONE) return;
            const key = this.getSaveKey();
            if (!key) return;
        
            const savedData = localStorage.getItem(key);
            if (savedData) {
                try {
                    const bytes = Uint8Array.from(atob(savedData), c => c.charCodeAt(0));
                    this.loadRamData(bytes);
                } catch (e) {
                    console.error("Failed to load/decode save data.", e);
                }
            }
        };
    }
    
    getState(): MmuState {
        return {
            iwram: this.iwram,
            ewram: this.ewram,
            sram: this.saveMemory,
            rom: this.rom,
            waitCnt: this.waitCnt,
            saveType: this.saveType,
            flashState: this.flashState,
            flashCmd: this.flashCmd,
            flashBank: this.flashBank
        };
    }

    loadState(state: MmuState) {
        this.iwram.set(state.iwram);
        this.ewram.set(state.ewram);
        
        this.rom = state.rom;
        this.saveType = state.saveType;
        this.setupSaveMemory();
        this.saveMemory.set(state.sram);

        this.waitCnt = state.waitCnt;
        this.flashState = state.flashState;
        this.flashCmd = state.flashCmd;
        this.flashBank = state.flashBank;
    }
    
    loadRom(romData: Uint8Array, saveType: SaveType) {
        this.rom = romData;
        this.saveType = saveType;
        
        const titleBytes = romData.slice(0xA0, 0xAC);
        this.romTitle = new TextDecoder().decode(titleBytes).replace(/\0/g, '');

        this.setupSaveMemory();
    }

    private setupSaveMemory() {
        switch(this.saveType) {
            case SaveType.SRAM_64K:
                this.saveMemory = new Uint8Array(32 * 1024); // 32KB
                this.flashId = 0;
                break;
            case SaveType.FLASH_64K:
                this.saveMemory = new Uint8Array(64 * 1024).fill(0xFF);
                this.flashId = 0x1CC2; // Macronix
                break;
            case SaveType.FLASH_128K:
                this.saveMemory = new Uint8Array(128 * 1024).fill(0xFF);
                this.flashId = 0x1CC2; // Macronix
                break;
            case SaveType.EEPROM:
                this.saveMemory = this.eeprom.getMemory(); // Let EEPROM manage its own memory
                this.flashId = 0;
                break;
            default:
                this.saveMemory = new Uint8Array(0);
                this.flashId = 0;
                break;
        }
        
        this.flashState = 0;
        this.flashCmd = 0;
        this.flashBank = 0;
    }
    
    private getRomWait16(addr: number, seq: boolean): number {
        const region = addr >> 24;
        let setting, cycles;
    
        if (region >= 0x0E) { // SRAM
            setting = this.waitCnt & 3;
            return this.waitStateN[setting];
        }
    
        if (region >= 0x0C) { // Wait State 2
            setting = (this.waitCnt >> 8) & 3;
            if (seq) {
                const s_setting = (this.waitCnt >> 10) & 1;
                cycles = s_setting ? 1 : 8; // S-cycles for WS2 are 8 or 1
            } else {
                cycles = this.waitStateN[setting];
            }
        } else if (region >= 0x0A) { // Wait State 1
            setting = (this.waitCnt >> 5) & 3;
            if (seq) {
                const s_setting = (this.waitCnt >> 7) & 1;
                cycles = s_setting ? 1 : 4; // S-cycles for WS1 are 4 or 1
            } else {
                cycles = this.waitStateN[setting];
            }
        } else { // Wait State 0
            setting = (this.waitCnt >> 2) & 3;
            if (seq) {
                const s_setting = (this.waitCnt >> 4) & 1;
                cycles = s_setting ? 1 : 2; // S-cycles for WS0 are 2 or 1
            } else {
                cycles = this.waitStateN[setting];
            }
        }
        return cycles;
    }

    read8(addr: number): number {
        addr >>>= 0;
        this.lastAccessAddr = addr;
        
        switch (addr & 0x0F000000) {
            case 0x00000000: // BIOS region
                this.gba.tick(1);
                // If PC is outside the BIOS region, access is denied.
                if (addr >= 0x4000 || this.cpu.pc >= 0x4000) {
                    // Open bus behavior: if CPU has left BIOS, reading from BIOS area
                    // returns the last value fetched by the instruction pipeline.
                    return (this.cpu.pipeline[1] >> ((addr & 3) * 8)) & 0xFF;
                }
                return this.bios[addr];
            case 0x02000000: this.gba.tick(3); return this.ewram[addr & 0x3FFFF];
            case 0x03000000: this.gba.tick(1); return this.iwram[addr & 0x7FFF];
            case 0x04000000: this.gba.tick(1); return this.readIo(addr);
            case 0x05000000: this.gba.tick(1); return this.ppu.readPalette(addr);
            case 0x06000000: this.gba.tick(1); return this.ppu.readVram(addr);
            case 0x07000000: this.gba.tick(1); return this.ppu.readOam(addr);
            case 0x08000000: case 0x09000000: 
            case 0x0A000000: case 0x0B000000: 
            case 0x0C000000: case 0x0D000000:
                if (this.saveType === SaveType.EEPROM && (addr & 0x0F000000) === 0x0D000000) {
                    return this.eeprom.read();
                }
                this.gba.tick(this.getRomWait16(addr, false)); // 8-bit reads are always non-sequential
                const romAddr = addr & 0x1FFFFFF;
                if (romAddr >= this.rom.length) {
                    // Open bus behavior for unmapped ROM space
                    return (this.cpu.pipeline[1] >> ((addr & 3) * 8)) & 0xFF;
                }
                return this.rom[romAddr];
            case 0x0E000000: 
                this.gba.tick(this.getRomWait16(addr, false));
                return this.readSaveMemory(addr);
        }
        this.gba.tick(1);
        return 0xFF;
    }

    read16(addr: number): number {
        addr &= ~1;
        this.lastAccessAddr = addr;
        const region = addr & 0x0F000000;

        switch (region) {
            case 0x02000000: 
                this.gba.tick(3);
                const idx2 = addr & 0x3FFFF;
                return this.ewram[idx2] | (this.ewram[idx2 + 1] << 8);
            case 0x03000000:
                this.gba.tick(1);
                const idx3 = addr & 0x7FFF;
                return this.iwram[idx3] | (this.iwram[idx3 + 1] << 8);
            case 0x05000000: this.gba.tick(1); return this.ppu.readPalette16(addr);
            case 0x06000000: this.gba.tick(1); return this.ppu.readVram16(addr);
            case 0x07000000: this.gba.tick(1); return this.ppu.readOam16(addr);
            case 0x08000000: case 0x09000000: 
            case 0x0A000000: case 0x0B000000: 
            case 0x0C000000: case 0x0D000000:
                if (this.saveType === SaveType.EEPROM && region === 0x0D000000) {
                    // EEPROM is only accessible by DMA, which uses 16-bit reads.
                    // The DMA destination register will receive the single output bit in the LSB.
                    return this.eeprom.read();
                }
                this.gba.tick(this.getRomWait16(addr, false));
                const romAddr = addr & 0x1FFFFFF;
                if (romAddr + 1 >= this.rom.length) {
                    return this.read8(addr) | (this.read8(addr + 1) << 8);
                }
                return this.rom[romAddr] | (this.rom[romAddr + 1] << 8);
            default: return this.read8(addr) | (this.read8(addr + 1) << 8);
        }
    }

    read32(addr: number): number {
        addr &= ~3;
        this.lastAccessAddr = addr;
        const region = addr & 0x0F000000;
        
        switch (region) {
            case 0x02000000: 
                this.gba.tick(6);
                const idx2 = addr & 0x3FFFF;
                return this.ewram[idx2] | (this.ewram[idx2+1] << 8) | (this.ewram[idx2+2] << 16) | (this.ewram[idx2+3] << 24);
            case 0x03000000: 
                this.gba.tick(1);
                const idx3 = addr & 0x7FFF;
                return this.iwram[idx3] | (this.iwram[idx3+1] << 8) | (this.iwram[idx3+2] << 16) | (this.iwram[idx3+3] << 24);
            case 0x08000000: case 0x09000000: 
            case 0x0A000000: case 0x0B000000: 
            case 0x0C000000: case 0x0D000000:
                 if (this.saveType === SaveType.EEPROM && region === 0x0D000000) {
                    // Treat 32-bit read as two 16-bit reads
                    return this.eeprom.read() | (this.eeprom.read() << 16);
                }
                this.gba.tick(this.getRomWait16(addr, false) + this.getRomWait16(addr + 2, true));
                const romAddr = addr & 0x1FFFFFF;
                 if (romAddr + 3 >= this.rom.length) {
                    return this.read16(addr) | (this.read16(addr + 2) << 16);
                }
                return this.rom[romAddr] | (this.rom[romAddr+1] << 8) | (this.rom[romAddr+2] << 16) | (this.rom[romAddr+3] << 24);
            default: return this.read16(addr) | (this.read16(addr + 2) << 16);
        }
    }

    write8(addr: number, val: number) {
        addr >>>= 0;
        val &= 0xFF;
        this.lastAccessAddr = addr;
        
        switch (addr & 0x0F000000) {
            case 0x02000000: this.gba.tick(3); this.ewram[addr & 0x3FFFF] = val; break;
            case 0x03000000: this.gba.tick(1); this.iwram[addr & 0x7FFF] = val; break;
            case 0x04000000: this.gba.tick(1); this.writeIo(addr, val); break;
            case 0x05000000: this.gba.tick(1); this.ppu.writePalette(addr, val); break;
            case 0x06000000: this.gba.tick(1); this.ppu.writeVram(addr, val); break;
            case 0x07000000: this.gba.tick(1); this.ppu.writeOam(addr, val); break;
            case 0x0E000000: 
                this.gba.tick(this.getRomWait16(addr, false));
                this.writeSaveMemory(addr, val); 
                break;
            default: this.gba.tick(1);
        }
    }
    
    write16(addr: number, val: number) {
        addr &= ~1;
        this.lastAccessAddr = addr;
        const region = addr & 0x0F000000;

        switch(region) {
            case 0x0D000000:
                if (this.saveType === SaveType.EEPROM) {
                    // EEPROM is only accessible by DMA, which uses 16-bit writes.
                    // Only bit 0 of the data is used for the serial protocol.
                    this.eeprom.write(val & 1);
                    return;
                }
                // Fall through for regular ROM (writes are ignored)
                this.gba.tick(this.getRomWait16(addr, false));
                break;
            case 0x02000000:
                this.gba.tick(3);
                const idx2 = addr & 0x3FFFF;
                this.ewram[idx2] = val & 0xFF; this.ewram[idx2 + 1] = val >> 8; 
                break;
            case 0x03000000:
                this.gba.tick(1);
                const idx3 = addr & 0x7FFF;
                this.iwram[idx3] = val & 0xFF; this.iwram[idx3 + 1] = val >> 8; 
                break;
            case 0x05000000: this.gba.tick(1); this.ppu.writePalette16(addr, val); break;
            case 0x06000000: this.gba.tick(1); this.ppu.writeVram16(addr, val); break;
            case 0x07000000: this.gba.tick(1); this.ppu.writeOam16(addr, val); break;
            default: this.write8(addr, val & 0xFF); this.write8(addr + 1, (val >> 8) & 0xFF);
        }
    }
    
    write32(addr: number, val: number) {
        addr &= ~3;
        this.lastAccessAddr = addr;
        const region = addr & 0x0F000000;

        switch(region) {
             case 0x0D000000:
                if (this.saveType === SaveType.EEPROM) {
                    // Treat 32-bit write as two 16-bit writes
                    this.eeprom.write(val & 1);
                    this.eeprom.write((val >> 16) & 1);
                    return;
                }
                // Fall through for regular ROM (writes are ignored)
                this.gba.tick(this.getRomWait16(addr, false) + this.getRomWait16(addr + 2, true));
                break;
            case 0x02000000: 
                this.gba.tick(6);
                const idx2 = addr & 0x3FFFF;
                this.ewram[idx2] = val & 0xFF; this.ewram[idx2+1] = (val >> 8) & 0xFF; this.ewram[idx2+2] = (val >> 16) & 0xFF; this.ewram[idx2+3] = val >>> 24; 
                break;
            case 0x03000000: 
                this.gba.tick(1);
                const idx3 = addr & 0x7FFF;
                this.iwram[idx3] = val & 0xFF; this.iwram[idx3+1] = (val >> 8) & 0xFF; this.iwram[idx3+2] = (val >> 16) & 0xFF; this.iwram[idx3+3] = val >>> 24; 
                break;
            default: this.write16(addr, val & 0xFFFF); this.write16(addr + 2, (val >> 16) & 0xFFFF);
        }
    }

    private readIo(addr: number): number {
        const addrShort = addr & 0x3FF;
        if (addrShort < 0x60) return this.ppu.read(addrShort);
        if (addrShort >= 0x60 && addrShort < 0xB0) return this.apu.read(addrShort);
        if (addrShort >= 0xB0 && addrShort < 0xE0) return this.dma.read(addrShort);
        if (addrShort >= 0x100 && addrShort < 0x110) return this.timers.read(addrShort);
        
        switch (addrShort) {
            case 0x130: return this.joypad.read(0);
            case 0x131: return this.joypad.read(1);
            case 0x132: return this.joypad.read(2);
            case 0x133: return this.joypad.read(3);
            case 0x120: return this.serialData & 0xFF;
            case 0x121: return this.serialData >> 8;
            case 0x128: return this.serialCtrl;
            case 0x200: return this.cpu.IE & 0xFF;
            case 0x201: return this.cpu.IE >> 8;
            case 0x202: return this.cpu.IF & 0xFF;
            case 0x203: return this.cpu.IF >> 8;
            case 0x204: return this.waitCnt & 0xFF;
            case 0x205: return this.waitCnt >> 8;
            case 0x208: return this.cpu.IME & 0xFF;
            case 0x209: return this.cpu.IME >> 8;
            case 0x300: return this.gba.postflg;
        }
        return 0;
    }
    
    private writeIo(addr: number, val: number) {
        const addrShort = addr & 0x3FF;
        if (addrShort < 0x60) { this.ppu.write(addrShort, val); return; }
        if (addrShort >= 0x60 && addrShort < 0xB0) { this.apu.write(addrShort, val); return; }
        if (addrShort >= 0xB0 && addrShort < 0xE0) { this.dma.write(addrShort, val); return; }
        if (addrShort >= 0x100 && addrShort < 0x110) { this.timers.write(addrShort, val); return; }

        switch (addrShort) {
            case 0x130: this.joypad.write(0, val); break;
            case 0x131: this.joypad.write(1, val); break;
            case 0x132: this.joypad.write(2, val); break;
            case 0x133: this.joypad.write(3, val); break;
            case 0x120: this.serialData = (this.serialData & 0xFF00) | val; break;
            case 0x121: this.serialData = (this.serialData & 0x00FF) | (val << 8); break;
            case 0x128:
                this.serialCtrl = val;
                if (val === 0x81) {
                    const char = String.fromCharCode(this.serialData & 0xFF);
                    this.gba.serialBuffer.push(char);
                }
                break;
            case 0x200: this.cpu.IE = (this.cpu.IE & 0xFF00) | val; break;
            case 0x201: this.cpu.IE = (this.cpu.IE & 0x00FF) | (val << 8); break;
            case 0x202: this.cpu.IF &= ~(val); break;
            case 0x203: this.cpu.IF &= ~(val << 8); break;
            case 0x204: this.waitCnt = (this.waitCnt & 0xFF00) | val; break;
            case 0x205: this.waitCnt = (this.waitCnt & 0x00FF) | (val << 8); break;
            case 0x208: this.cpu.IME = val & 1; break;
            case 0x300: this.gba.postflg = val; break;
            case 0x301: if ((val & 0x80) === 0) { this.gba.setHalted(true); } break;
        }
    }

    public getRamData(): Uint8Array | null {
        if (this.saveType === SaveType.NONE) return null;
        return this.saveMemory;
    }

    public getIwramSlice(start: number, end: number): Uint8Array {
        return this.iwram.slice(start, end);
    }

    public loadRamData(data: Uint8Array) {
        if (this.saveType === SaveType.NONE) return;
        if (data.length > this.saveMemory.length) {
            console.warn("Save data is larger than save memory size, truncating.");
            this.saveMemory.set(data.slice(0, this.saveMemory.length));
        } else {
            this.saveMemory.fill(this.saveType === SaveType.SRAM_64K ? 0 : 0xFF);
            this.saveMemory.set(data);
        }
        if (this.saveType === SaveType.EEPROM) {
            this.eeprom.load(data);
        }
        console.log("External save data loaded.");
    }
    
    private getSaveKey(): string | null {
        if (!this.romTitle) return null;
        return `gba_save_${this.romTitle}`;
    }
    
    public saveRam() {
        if (this.saveType === SaveType.NONE) return;
        const key = this.getSaveKey();
        if (!key) return;
    
        try {
            const dataToSave = (this.saveType === SaveType.EEPROM) ? this.eeprom.getMemory() : this.saveMemory;
            const binaryString = Array.from(dataToSave, byte => String.fromCharCode(byte)).join('');
            const encoded = btoa(binaryString);
            localStorage.setItem(key, encoded);
        } catch (e) {
            console.error("Failed to save data.", e);
        }
    }

    private readSaveMemory(addr: number): number {
        switch (this.saveType) {
            case SaveType.SRAM_64K:
                return this.saveMemory[addr & 0x7FFF];
            case SaveType.FLASH_64K:
            case SaveType.FLASH_128K:
                if (this.flashState === 4) { // ID Mode
                    return (addr & 1) ? (this.flashId & 0xFF) : (this.flashId >> 8);
                }
                const flashAddr = (this.flashBank * 0x10000) + (addr & 0xFFFF);
                if (flashAddr >= this.saveMemory.length) return 0xFF;
                return this.saveMemory[flashAddr];
        }
        return 0xFF;
    }
    
    private writeSaveMemory(addr: number, val: number) {
        switch (this.saveType) {
            case SaveType.SRAM_64K:
                this.saveMemory[addr & 0x7FFF] = val;
                break;
            case SaveType.FLASH_64K:
            case SaveType.FLASH_128K:
                this.writeFlash(addr, val);
                break;
        }
    }

    private writeFlash(addr: number, val: number) {
        const addrRel = addr & 0xFFFF;
        
        switch (this.flashState) {
            case 0: // Idle
                if (addrRel === 0x5555 && val === 0xAA) this.flashState = 1;
                break;
            case 1: // Got AA
                if (addrRel === 0x2AAA && val === 0x55) this.flashState = 2;
                else this.flashState = 0;
                break;
            case 2: // Ready for command
                if (addrRel === 0x5555) {
                    switch (val) {
                        case 0x90: this.flashState = 4; break; // Read ID
                        case 0x80: this.flashState = 3; break; // Erase
                        case 0xA0: this.flashState = 5; break; // Write Byte
                        case 0xB0: this.flashState = 6; break; // Bank Switch
                        case 0xF0: this.flashState = 0; break; // Reset
                        default: this.flashState = 0;
                    }
                } else {
                    this.flashState = 0;
                }
                break;
            case 3: // Erase command
                if (val === 0x10 && addrRel === 0x5555) { // Chip Erase
                    this.saveMemory.fill(0xFF);
                } else if (val === 0x30) { // Sector Erase
                    const sectorAddr = (this.flashBank * 0x10000) + (addrRel & 0xF000);
                    this.saveMemory.fill(0xFF, sectorAddr, sectorAddr + 0x1000);
                }
                this.flashState = 0;
                break;
            case 5: // Write byte
                const writeAddr = (this.flashBank * 0x10000) + addrRel;
                this.saveMemory[writeAddr] &= val;
                this.flashState = 0;
                break;
            case 6: // Bank switch
                if (addrRel === 0x0000) {
                    this.flashBank = val & 1;
                }
                this.flashState = 0;
                break;
        }

        // Reset can happen from any state
        if (val === 0xF0) {
            this.flashState = 0;
        }
    }

    // --- SWI Handling ---
    public handleSwi(comment: number): void {
        handleSwiImpl(this.gba, comment);
    }
}
