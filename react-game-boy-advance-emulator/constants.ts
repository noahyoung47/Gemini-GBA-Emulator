
export const CPU_CLOCK_SPEED = 16777216; // 16.78 MHz
export const FRAMES_PER_SECOND = 59.73;

// A full GBA frame takes 228 scanlines * 1232 cycles/scanline = 280896 cycles
export const CYCLES_PER_FRAME = 280896;

export const SCREEN = {
    WIDTH: 240,
    HEIGHT: 160,
};

export const INTERRUPTS = {
    VBLANK: 0,
    HBLANK: 1,
    VCOUNTER: 2,
    TIMER0: 3,
    TIMER1: 4,
    TIMER2: 5,
    TIMER3: 6,
    SERIAL: 7,
    DMA0: 8,
    DMA1: 9,
    DMA2: 10,
    DMA3: 11,
    KEYPAD: 12,
    GAMEPAK: 13,
};

// Mock info for demonstration purposes. These would need to be updated for GBA titles.
export const ROM_INFO: { [key: string]: { title: string; description: string } } = {
    'metroid_fusion.gba': {
        title: 'Metroid Fusion',
        description: 'Samus Aran explores the Biologic Space Laboratories station and confronts the parasitic X.'
    },
    'golden_sun.gba': {
        title: 'Golden Sun',
        description: 'A fantasy RPG following a group of magically-attuned "Adepts" on a world-saving quest.'
    },
    'advanced_wars.gba': {
        title: "Advance Wars",
        description: "A turn-based strategy game where you command the Orange Star Army against rival nations."
    },
    'zelda_minish_cap.gba': {
        title: "The Legend of Zelda: The Minish Cap",
        description: 'Link, with the help of a magical talking cap named Ezlo, can shrink to the size of the tiny Minish people.'
    }
};
