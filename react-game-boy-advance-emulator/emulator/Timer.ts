
import { Gba } from "./Gba";
import { INTERRUPTS } from "../constants";
import { TimerState } from "./types";

class Timer {
    gba: Gba;
    id: number;

    counter = 0;
    reload = 0;
    control = 0;
    cycles = 0;

    constructor(id: number, gba: Gba) {
        this.id = id;
        this.gba = gba;
    }
    
    step(cycles: number) {
        if (!this.isEnabled() || this.isCascading()) return false;
        
        this.cycles += cycles;
        const prescaler = [1, 64, 256, 1024][this.control & 3];
        let overflowed = false;
        
        while (this.cycles >= prescaler) {
            this.cycles -= prescaler;
            if (this.increment()) {
                overflowed = true;
            }
        }
        return overflowed;
    }

    increment(): boolean {
        this.counter++;
        if (this.counter > 0xFFFF) {
            this.counter = this.reload;
            if (this.isIrqEnabled()) {
                this.gba.requestInterrupt(INTERRUPTS.TIMER0 + this.id);
            }
            if (this.id === this.gba.apu.getTimer(true) || this.id === this.gba.apu.getTimer(false)) {
                this.gba.apu.onTimerOverflow(this.id);
            }
            return true;
        }
        return false;
    }

    isEnabled = () => (this.control & 0x80) !== 0;
    isCascading = () => (this.control & 0x04) !== 0;
    isIrqEnabled = () => (this.control & 0x40) !== 0;
}


export class TimerController {
    gba: Gba;
    private timers: Timer[] = [];

    constructor(gba: Gba) {
        this.gba = gba;
        for(let i=0; i<4; i++) {
            this.timers.push(new Timer(i, this.gba));
        }
    }
    
    reset() {
        this.timers.forEach(t => {
            t.counter = 0;
            t.reload = 0;
            t.control = 0;
            t.cycles = 0;
        });
    }

    getState(): TimerState {
        return {
            timers: this.timers.map(t => ({
                counter: t.counter,
                reload: t.reload,
                control: t.control,
                cycles: t.cycles,
            }))
        };
    }
    
    loadState(state: TimerState) {
        if (!state || !state.timers) return;
        state.timers.forEach((s, i) => {
            if (this.timers[i]) {
                this.timers[i].counter = s.counter;
                this.timers[i].reload = s.reload;
                this.timers[i].control = s.control;
                this.timers[i].cycles = s.cycles;
            }
        });
    }
    
    step(cycles: number) {
        let overflowed = [false, false, false, false];

        for(let i = 0; i < 4; i++) {
            if (this.timers[i].step(cycles)) {
                overflowed[i] = true;
            }
        }

        for (let i = 1; i < 4; i++) {
            if (this.timers[i].isEnabled() && this.timers[i].isCascading() && overflowed[i-1]) {
                if (this.timers[i].increment()) {
                    overflowed[i] = true;
                }
            }
        }
    }
    
    read(addr: number): number {
        const timerId = (addr - 0x100) >> 2;
        const reg = (addr - 0x100) & 3;
        
        if (reg === 0) return this.timers[timerId].counter & 0xFF;
        if (reg === 1) return this.timers[timerId].counter >> 8;
        return 0;
    }
    
    write(addr: number, val: number) {
        const timerId = (addr - 0x100) >> 2;
        const reg = (addr - 0x100) & 3;
        const timer = this.timers[timerId];

        switch(reg) {
            case 0: timer.reload = (timer.reload & 0xFF00) | val; break;
            case 1: timer.reload = (timer.reload & 0x00FF) | (val << 8); break;
            case 2:
                const wasEnabled = timer.isEnabled();
                timer.control = val;
                if(!wasEnabled && timer.isEnabled()) {
                    timer.counter = timer.reload;
                    timer.cycles = 0;
                }
                break;
        }
    }
}
