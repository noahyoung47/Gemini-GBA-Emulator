
import { Envelope } from './Envelope';

export class NoiseChannel {
    enabled = false;
    output = 0;

    length = 0;
    lengthEnabled = false;
    envelope = new Envelope();
    
    lfsr = 0x7FFF;
    lfsrWidth = 0;
    clockShift = 0;
    divisorCode = 0;
    
    timer = 0;
    
    step(cycles: number) {
        if (!this.enabled) return;
        this.timer -= cycles;
        while (this.timer <= 0) {
            const divisor = [8, 16, 32, 48, 64, 80, 96, 112][this.divisorCode] << this.clockShift;
            this.timer += divisor;

            const bit0 = this.lfsr & 1;
            const bit1 = (this.lfsr >> 1) & 1;
            const feedback = bit0 ^ bit1;

            this.lfsr = (this.lfsr >> 1) | (feedback << 14);

            if (this.lfsrWidth === 1) {
                this.lfsr = (this.lfsr & ~(1 << 6)) | (feedback << 6);
            }
            
            if ((this.lfsr & 1) === 0) {
                this.output = this.envelope.volume;
            } else {
                this.output = 0;
            }
        }
    }

    stepLength() {
        if (this.lengthEnabled && this.length > 0) {
            this.length--;
            if (this.length === 0) {
                this.enabled = false;
            }
        }
    }
    
    trigger() {
        this.enabled = true;
        if (this.length === 0) this.length = 64;
        const divisor = [8, 16, 32, 48, 64, 80, 96, 112][this.divisorCode] << this.clockShift;
        this.timer = divisor;
        this.envelope.trigger();
        this.lfsr = 0x7FFF;
    }

    getSample(): number {
        return this.enabled ? this.output : 0;
    }
}
