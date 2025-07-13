import { Gba } from './Gba';
import { INTERRUPTS } from '../constants';
import { JoypadState } from './types';

export class Joypad {
    private gba!: Gba; // To be set by GBA constructor

    // KEYINPUT register at 0x4000130
    private keyinput = 0x03FF; // All keys up
    // KEYCNT register at 0x4000132
    private keycnt = 0;

    setGba(gba: Gba) {
        this.gba = gba;
    }

    getState(): JoypadState {
        return { keyinput: this.keyinput, keycnt: this.keycnt };
    }

    loadState(state: JoypadState) {
        this.keyinput = state.keyinput;
        this.keycnt = state.keycnt;
    }

    read(offset: number): number {
        switch(offset) {
            case 0: return this.keyinput & 0xFF;
            case 1: return this.keyinput >> 8;
            case 2: return this.keycnt & 0xFF;
            case 3: return this.keycnt >> 8;
        }
        return 0;
    }

    write(offset: number, val: number) {
        switch(offset) {
            case 2: this.keycnt = (this.keycnt & 0xFF00) | val; break;
            case 3: this.keycnt = (this.keycnt & 0x00FF) | (val << 8); break;
        }
    }
    
    private checkInterrupts() {
        if ((this.keycnt >> 14) & 1) { // IRQ Enable
            let conditionMet = false;
            let keysDown = (~this.keyinput) & 0x3FF;
            let requiredKeys = this.keycnt & 0x3FF;

            if ((this.keycnt >> 15) & 1) { // AND logic
                conditionMet = (keysDown & requiredKeys) === requiredKeys;
            } else { // OR logic
                conditionMet = (keysDown & requiredKeys) > 0;
            }

            if (conditionMet) {
                this.gba.requestInterrupt(INTERRUPTS.KEYPAD);
            }
        }
    }

    keyDown(key: string) {
        let bit = -1;
        switch (key) {
            case 'A': bit = 0; break;
            case 'B': bit = 1; break;
            case 'SELECT': bit = 2; break;
            case 'START': bit = 3; break;
            case 'RIGHT': bit = 4; break;
            case 'LEFT': bit = 5; break;
            case 'UP': bit = 6; break;
            case 'DOWN': bit = 7; break;
            case 'R': bit = 8; break;
            case 'L': bit = 9; break;
        }

        if (bit > -1) {
            this.keyinput &= ~(1 << bit);
            this.checkInterrupts();
        }
    }

    keyUp(key: string) {
        let bit = -1;
        switch (key) {
            case 'A': bit = 0; break;
            case 'B': bit = 1; break;
            case 'SELECT': bit = 2; break;
            case 'START': bit = 3; break;
            case 'RIGHT': bit = 4; break;
            case 'LEFT': bit = 5; break;
            case 'UP': bit = 6; break;
            case 'DOWN': bit = 7; break;
            case 'R': bit = 8; break;
            case 'L': bit = 9; break;
        }

        if (bit > -1) {
            this.keyinput |= (1 << bit);
        }
    }
}
