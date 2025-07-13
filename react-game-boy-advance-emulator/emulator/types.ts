
export enum SaveType {
    NONE,
    SRAM_64K,
    FLASH_64K,
    FLASH_128K,
    EEPROM
}

export interface EepromState {
    size: number;
    data: Uint8Array;
    state: number;
    address: number;
    bit: number;
    readBits: number;
    writeBits: number;
    out: number;
}

export interface Arm7tdmiState {
    r: Uint32Array;
    cpsr: number;
    spsr: Uint32Array;
    pipeline: Uint32Array;
    IME: number;
    IE: number;
    IF: number;
}

export interface PpuState {
    vram: Uint8Array;
    oam: Uint8Array;
    paletteRam: Uint8Array;
    dispcnt: number;
    dispstat: number;
    vcount: number;
    bgcnt: Uint16Array;
    bghofs: Uint16Array;
    bgvofs: Uint16Array;
    bgpa: Int16Array;
    bgpb: Int16Array;
    bgpc: Int16Array;
    bgpd: Int16Array;
    bgx: Int32Array;
    bgy: Int32Array;
    winh: Uint16Array;
    winv: Uint16Array;
    winin: number;
    winout: number;
    bldcnt: number;
    bldalpha: number;
    bldy: number;
    cycles: number;
}

export interface ApuState {
    soundCntL: number;
    soundCntH: number;
    soundCntX: number;
    fifoA: Int8Array,
    fifoB: Int8Array,
    fifoA_head: number,
    fifoA_tail: number,
    fifoA_count: number,
    fifoB_head: number,
    fifoB_tail: number,
    fifoB_count: number,
    waveRam: Uint8Array,
    apuCycles: number
}

export interface MmuState {
    iwram: Uint8Array;
    ewram: Uint8Array;
    sram: Uint8Array;
    rom: Uint8Array;
    waitCnt: number;
    saveType: SaveType;
    flashState: number;
    flashCmd: number;
    flashBank: number;
}

export interface JoypadState {
    keyinput: number;
    keycnt: number;
}

export interface TimerState {
    timers: {
        counter: number;
        reload: number;
        control: number;
        cycles: number;
    }[];
}

export interface DmaState {
    channels: {
        source: number;
        dest: number;
        count: number;
        control: number;
    }[];
}


// Top-level state for the entire GBA system
export interface GameState {
    cpu: Arm7tdmiState;
    ppu: PpuState;
    apu: ApuState;
    mmu: MmuState;
    timers: TimerState;
    dma: DmaState;
    joypad: JoypadState;
    eeprom: EepromState;
}

export interface GameStateWithMetadata {
    timestamp: string;
    romName: string;
    state: GameState;
    screenshotDataUrl: string;
}
