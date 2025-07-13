
export class WaveChannel {
    enabled = false;
    output = 0;
    
    dacEnabled = false;
    length = 0;
    lengthEnabled = false;
    volumeShift = 0;
    freq = 0;
    
    timer = 0;
    waveRam = new Uint8Array(16);
    position = 0;
    
    step(cycles: number) {
        if (!this.enabled || !this.dacEnabled) return;

        this.timer -= cycles;
        while (this.timer <= 0) {
            this.timer += (2048 - this.freq) * 2;
            this.position = (this.position + 1) % 32;
            const sampleByte = this.waveRam[Math.floor(this.position / 2)];
            let sample = (this.position % 2 === 0) ? (sampleByte >> 4) : (sampleByte & 0xF);
            
            if (this.volumeShift > 0) {
                sample >>= (this.volumeShift - 1);
            }
            this.output = sample;
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
        if(!this.dacEnabled) return;
        this.enabled = true;
        if (this.length === 0) this.length = 256;
        this.timer = (2048 - this.freq) * 2;
        this.position = 0;
    }

    getSample(): number {
        return this.enabled ? this.output : 0;
    }
}
