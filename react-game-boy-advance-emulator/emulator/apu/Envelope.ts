
export class Envelope {
    initialVolume = 0;
    direction = 0;
    stepTime = 0;
    
    volume = 0;
    counter = 0;

    step() {
        if (this.stepTime === 0) return;
        this.counter--;
        if (this.counter <= 0) {
            this.counter = this.stepTime;
            if (this.direction === 1) {
                if (this.volume < 15) this.volume++;
            } else {
                if (this.volume > 0) this.volume--;
            }
        }
    }
    
    trigger() {
        this.counter = this.stepTime;
        this.volume = this.initialVolume;
    }
}
