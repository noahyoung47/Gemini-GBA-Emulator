
export const GBA_AUDIO_PROCESSOR = `
class GbaAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Float32Array(16384);
        this.readPos = 0;
        this.writePos = 0;
        this.samples = 0;

        this.port.onmessage = (e) => {
            const data = e.data;
            if (this.samples + data.length < this.buffer.length) {
                for (let i = 0; i < data.length; i++) {
                    this.buffer[this.writePos] = data[i];
                    this.writePos = (this.writePos + 1) % this.buffer.length;
                }
                this.samples += data.length;
            }
        };
    }

    process(inputs, outputs, parameters) {
        const outL = outputs[0][0];
        const outR = outputs[0].length > 1 ? outputs[0][1] : null;

        for (let i = 0; i < outL.length; i++) {
            if (this.samples > 0) {
                const sample = this.buffer[this.readPos];
                outL[i] = sample;
                if (outR) outR[i] = sample;
                this.readPos = (this.readPos + 1) % this.buffer.length;
                this.samples--;
            } else {
                outL[i] = 0;
                if (outR) outR[i] = 0;
            }
        }
        return true;
    }
}
registerProcessor('gba-audio-processor', GbaAudioProcessor);
`;
