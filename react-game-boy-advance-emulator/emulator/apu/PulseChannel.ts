
import { Envelope } from './Envelope';

const DUTY_PATTERNS = [
    [0, 1, 0, 0, 0, 0, 0, 0], // 12.5%
    [0, 1, 1, 0, 0, 0, 0, 0], // 25%
    [0, 1, 1, 1, 1, 0, 0, 0], // 50%
    [1, 0, 0, 1, 1, 1, 1, 1]  // 75%
];

export class PulseChannel {
    enabled = false;
    output = 0;
    
    // NR10 / NR20
    sweepPace = 0;
    sweepDirection = 0;
    sweepShift = 0;
    sweepCounter = 0;
    shadowFreq = 0;
    sweepEnabled = false;

    // NR11 / NR21
    duty = 0;
    length = 0;

    // NR12 / NR22
    envelope = new Envelope();

    // NR13 / NR23 / NR14 / NR24
    freq = 0;
    lengthEnabled = false;
    
    timer = 0;
    phase = 0;

    step(cycles: number) {
        if (!this.enabled) return;
        this.timer -= cycles;
        while (this.timer <= 0) {
            this.timer += (2048 - this.freq) * 4;
            this.phase = (this.phase + 1) % 8;
        }
        this.output = DUTY_PATTERNS[this.duty][this.phase] === 1 ? this.envelope.volume : 0;
    }

    stepLength() {
        if (this.lengthEnabled && this.length > 0) {
            this.length--;
            if (this.length === 0) {
                this.enabled = false;
            }
        }
    }
    
    stepSweep() {
        if (!this.sweepEnabled || this.sweepPace === 0) return;
        
        this.sweepCounter--;
        if (this.sweepCounter <= 0) {
            this.sweepCounter = this.sweepPace;
            let newFreq = this.shadowFreq >> this.sweepShift;
            if (this.sweepDirection === 1) { // Subtraction
                newFreq = this.shadowFreq - newFreq;
            } else {
                newFreq = this.shadowFreq + newFreq;
            }

            if (newFreq > 2047) {
                this.enabled = false;
            } else if (this.sweepShift > 0) {
                this.freq = newFreq;
                this.shadowFreq = newFreq;
            }
        }
    }

    trigger() {
        this.enabled = true;
        if (this.length === 0) this.length = 64;
        this.timer = (2048 - this.freq) * 4;
        this.envelope.trigger();

        this.shadowFreq = this.freq;
        this.sweepCounter = this.sweepPace;
        this.sweepEnabled = this.sweepPace > 0 || this.sweepShift > 0;
        if(this.sweepShift > 0) this.stepSweep(); // Initial calculation
    }
    
    getSample(): number {
        return this.enabled ? this.output : 0;
    }
}
