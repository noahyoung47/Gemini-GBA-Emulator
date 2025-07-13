
import { Gba } from './Gba';
import { ApuState } from './types';
import { GBA_AUDIO_PROCESSOR } from './apu/audio-processor';
import { PulseChannel } from './apu/PulseChannel';
import { WaveChannel } from './apu/WaveChannel';
import { NoiseChannel } from './apu/NoiseChannel';

const SOUND_MAX = 2047;
const FRAME_SEQUENCER_RATE = 512;
const CYCLES_PER_FRAME_SEQUENCER_TICK = 16777216 / FRAME_SEQUENCER_RATE;

export class Apu {
    private gba: Gba;
    private audioCtx: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private gainNode: GainNode | null = null;
    private sampleRate = 44100;
    private sampleBuffer = new Float32Array(4096);
    private sampleBufferIndex = 0;

    // Registers
    soundCntL = 0;
    soundCntH = 0;
    soundCntX = 0;
    soundBias = 0x200;
    
    // FIFOs
    fifoA = new Int8Array(32);
    fifoB = new Int8Array(32);
    fifoA_head = 0; fifoA_tail = 0; fifoA_count = 0;
    fifoB_head = 0; fifoB_tail = 0; fifoB_count = 0;
    
    private apuCycles = 0;
    private frameSequencerCycles = 0;
    private frameSequencerStep = 0;

    // Legacy Channels
    ch1 = new PulseChannel();
    ch2 = new PulseChannel();
    ch3 = new WaveChannel();
    ch4 = new NoiseChannel();
    
    constructor(gba: Gba) {
        this.gba = gba;
    }

    reset() {
        this.soundCntL = 0;
        this.soundCntH = 0;
        this.soundCntX = 0;
        this.soundBias = 0x200;
        this.fifoA.fill(0); this.fifoB.fill(0);
        this.fifoA_head = 0; this.fifoA_tail = 0; this.fifoA_count = 0;
        this.fifoB_head = 0; this.fifoB_tail = 0; this.fifoB_count = 0;
        this.ch3.waveRam.fill(0);
        this.apuCycles = 0;
        this.frameSequencerCycles = 0;
        this.frameSequencerStep = 0;
        
        [this.ch1, this.ch2, this.ch3, this.ch4].forEach(ch => Object.assign(ch, new (ch.constructor as any)()));
    }

    getState(): ApuState {
        // Simplified state for now, full state would be large
        return { 
            soundCntL: this.soundCntL, soundCntH: this.soundCntH, soundCntX: this.soundCntX,
            fifoA: this.fifoA, fifoB: this.fifoB,
            fifoA_head: this.fifoA_head, fifoA_tail: this.fifoA_tail, fifoA_count: this.fifoA_count,
            fifoB_head: this.fifoB_head, fifoB_tail: this.fifoB_tail, fifoB_count: this.fifoB_count,
            waveRam: this.ch3.waveRam, apuCycles: this.apuCycles
        };
    }

    loadState(state: ApuState) {
        Object.assign(this, state);
    }

    async init() {
        if (!this.audioCtx) {
            try {
                this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: this.sampleRate });
                this.gainNode = this.audioCtx.createGain();
                this.gainNode.connect(this.audioCtx.destination);
                
                const blob = new Blob([GBA_AUDIO_PROCESSOR], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);

                await this.audioCtx.audioWorklet.addModule(url);
                this.workletNode = new AudioWorkletNode(this.audioCtx, 'gba-audio-processor');
                this.workletNode.connect(this.gainNode);
                URL.revokeObjectURL(url);
            } catch (e) {
                console.error("Web Audio API is not supported", e);
            }
        }
    }
    
    start() { if (this.audioCtx?.state === 'suspended') this.audioCtx.resume(); }
    stop() { if (this.audioCtx?.state === 'running') this.audioCtx.suspend(); }

    setVolume(level: number) {
        if (this.gainNode && this.audioCtx) {
            this.gainNode.gain.setValueAtTime(level, this.audioCtx.currentTime);
        }
    }

    step(cycles: number) {
        if ((this.soundCntX & 0x80) === 0) return;

        this.ch1.step(cycles);
        this.ch2.step(cycles);
        this.ch3.step(cycles);
        this.ch4.step(cycles);

        this.frameSequencerCycles += cycles;
        while(this.frameSequencerCycles >= CYCLES_PER_FRAME_SEQUENCER_TICK) {
            this.frameSequencerCycles -= CYCLES_PER_FRAME_SEQUENCER_TICK;
            
            if (this.frameSequencerStep % 2 === 0) { // 256 Hz
                this.ch1.stepLength();
                this.ch2.stepLength();
                this.ch3.stepLength();
                this.ch4.stepLength();
            }
            if (this.frameSequencerStep === 2 || this.frameSequencerStep === 6) { // 128 Hz
                 this.ch1.stepSweep();
            }
            if (this.frameSequencerStep === 7) { // 64 Hz
                this.ch1.envelope.step();
                this.ch2.envelope.step();
                this.ch4.envelope.step();
            }

            this.frameSequencerStep = (this.frameSequencerStep + 1) % 8;
        }

        this.apuCycles += cycles;
        const cyclesPerSample = 16777216 / this.sampleRate;
        
        while (this.apuCycles >= cyclesPerSample) {
            this.apuCycles -= cyclesPerSample;
            this.generateSample();
        }
    }
    
    generateSample() {
        let sampleL = 0, sampleR = 0;
        
        // Legacy channels
        const dmgVolumeRatio = [0.25, 0.5, 1.0, 1.0][this.soundCntH & 0x3];
        let s1 = this.ch1.getSample() * dmgVolumeRatio;
        let s2 = this.ch2.getSample() * dmgVolumeRatio;
        let s3 = this.ch3.getSample() * dmgVolumeRatio;
        let s4 = this.ch4.getSample() * dmgVolumeRatio;

        if((this.soundCntL >> 4) & 1) sampleL += s1;
        if((this.soundCntL >> 5) & 1) sampleL += s2;
        if((this.soundCntL >> 6) & 1) sampleL += s3;
        if((this.soundCntL >> 7) & 1) sampleL += s4;
        
        if((this.soundCntL >> 0) & 1) sampleR += s1;
        if((this.soundCntL >> 1) & 1) sampleR += s2;
        if((this.soundCntL >> 2) & 1) sampleR += s3;
        if((this.soundCntL >> 3) & 1) sampleR += s4;
        
        const masterVolL = (this.soundCntL >> 8) & 7;
        const masterVolR = (this.soundCntL >> 12) & 7;

        sampleL *= (masterVolL + 1);
        sampleR *= (masterVolR + 1);
        
        // FIFO channels
        const dmaVol = (this.soundCntH >> 2) & 1; // 0=50%, 1=100%
        let fifoA_sample = 0, fifoB_sample = 0;
        
        if (this.fifoA_count > 0) {
            fifoA_sample = this.fifoA[this.fifoA_head] * (dmaVol === 0 ? 0.5 : 1.0);
        }
        if (this.fifoB_count > 0) {
            fifoB_sample = this.fifoB[this.fifoB_head] * (dmaVol === 0 ? 0.5 : 1.0);
        }

        if((this.soundCntH >> 9) & 1) sampleL += fifoA_sample;
        if((this.soundCntH >> 8) & 1) sampleR += fifoA_sample;
        if((this.soundCntH >> 13) & 1) sampleL += fifoB_sample;
        if((this.soundCntH >> 12) & 1) sampleR += fifoB_sample;

        sampleL = Math.max(-2048, Math.min(2047, sampleL));
        sampleR = Math.max(-2048, Math.min(2047, sampleR));
        
        const finalSample = ((sampleL + sampleR) / 2) / SOUND_MAX;
        this.sampleBuffer[this.sampleBufferIndex++] = finalSample;
        
        if (this.sampleBufferIndex >= this.sampleBuffer.length) {
            this.workletNode?.port.postMessage(this.sampleBuffer.slice(0, this.sampleBufferIndex));
            this.sampleBufferIndex = 0;
        }
    }
    
    onTimerOverflow(timerId: number) {
        const dmaSoundAEnabled = (this.soundCntH >> 10) & 1;
        const dmaSoundBEnabled = (this.soundCntH >> 14) & 1;

        if (dmaSoundAEnabled && this.getTimer(true) === timerId && this.fifoA_count <= 16) {
            this.gba.dma.onFifoRequest(true);
        }
        if (dmaSoundBEnabled && this.getTimer(false) === timerId && this.fifoB_count <= 16) {
            this.gba.dma.onFifoRequest(false);
        }

        if (this.soundCntH & 0x200) { // FIFO A enabled
            if (this.getTimer(true) === timerId) {
                if (this.fifoA_count > 0) {
                    this.fifoA_head = (this.fifoA_head + 1) & 0x1F;
                    this.fifoA_count--;
                }
            }
        }
        if (this.soundCntH & 0x2000) { // FIFO B enabled
             if (this.getTimer(false) === timerId) {
                if (this.fifoB_count > 0) {
                    this.fifoB_head = (this.fifoB_head + 1) & 0x1F;
                    this.fifoB_count--;
                }
            }
        }
    }


    read(addr: number): number {
        addr &= 0xFF;
        switch(addr) {
            case 0x80: return this.soundCntL & 0xFF;
            case 0x81: return this.soundCntL >> 8;
            case 0x82: return this.soundCntH & 0xFF;
            case 0x83: return this.soundCntH >> 8;
            case 0x84: { // SOUNDCNT_X read is status
                let status = this.soundCntX & 0x80; // Keep master enable bit
                if(this.ch1.enabled) status |= 1;
                if(this.ch2.enabled) status |= 2;
                if(this.ch3.enabled) status |= 4;
                if(this.ch4.enabled) status |= 8;
                return status;
            }
            case 0x88: return this.soundBias & 0xFF;
            case 0x89: return this.soundBias >> 8;
        }
        return 0;
    }

    write(addr: number, val: number) {
        addr &= 0xFF;
        // Only channel registers are blocked when master sound is off.
        // Master control registers (0x80 and above) should always be writable.
        if ((this.soundCntX & 0x80) === 0 && addr < 0x80) return;

        switch(addr) {
            // CH1 Sweep
            case 0x60: this.ch1.sweepPace = (val >> 4) & 7; this.ch1.sweepDirection = (val >> 3) & 1; this.ch1.sweepShift = val & 7; break;
            // CH1 Length/Duty
            case 0x62: this.ch1.duty = val >> 6; this.ch1.length = 64 - (val & 0x3F); break;
            // CH1 Volume/Envelope
            case 0x63: this.ch1.envelope.initialVolume = val >> 4; this.ch1.envelope.direction = (val >> 3) & 1; this.ch1.envelope.stepTime = val & 7; break;
            // CH1 Freq Lo/Hi + Trigger
            case 0x64: this.ch1.freq = (this.ch1.freq & 0x700) | val; break;
            case 0x65: this.ch1.freq = (this.ch1.freq & 0xFF) | ((val & 7) << 8); this.ch1.lengthEnabled = !!((val >> 6) & 1); if (val & 0x80) this.ch1.trigger(); break;

            // CH2 Length/Duty
            case 0x68: this.ch2.duty = val >> 6; this.ch2.length = 64 - (val & 0x3F); break;
            // CH2 Volume/Envelope
            case 0x69: this.ch2.envelope.initialVolume = val >> 4; this.ch2.envelope.direction = (val >> 3) & 1; this.ch2.envelope.stepTime = val & 7; break;
            // CH2 Freq Lo/Hi + Trigger
            case 0x6C: this.ch2.freq = (this.ch2.freq & 0x700) | val; break;
            case 0x6D: this.ch2.freq = (this.ch2.freq & 0xFF) | ((val & 7) << 8); this.ch2.lengthEnabled = !!((val >> 6) & 1); if (val & 0x80) this.ch2.trigger(); break;

            // CH3 On/Off
            case 0x70: this.ch3.dacEnabled = (val & 0x80) !== 0; if(!this.ch3.dacEnabled) this.ch3.enabled = false; break;
            // CH3 Length
            case 0x72: this.ch3.length = 256 - val; break;
            // CH3 Volume
            case 0x73: this.ch3.volumeShift = (val >> 5) & 3; break;
            // CH3 Freq Lo/Hi + Trigger
            case 0x74: this.ch3.freq = (this.ch3.freq & 0x700) | val; break;
            case 0x75: this.ch3.freq = (this.ch3.freq & 0xFF) | ((val & 7) << 8); this.ch3.lengthEnabled = !!((val >> 6) & 1); if (val & 0x80) this.ch3.trigger(); break;

            // CH4 Length
            case 0x78: this.ch4.length = 64 - (val & 0x3F); break;
            // CH4 Volume/Envelope
            case 0x79: this.ch4.envelope.initialVolume = val >> 4; this.ch4.envelope.direction = (val >> 3) & 1; this.ch4.envelope.stepTime = val & 7; break;
            // CH4 Freq/Randomness
            case 0x7C: this.ch4.clockShift = val >> 4; this.ch4.lfsrWidth = (val >> 3) & 1; this.ch4.divisorCode = val & 7; break;
            // CH4 Trigger
            case 0x7D: this.ch4.lengthEnabled = !!((val >> 6) & 1); if(val & 0x80) this.ch4.trigger(); break;
            
            // --- Master Control ---
            case 0x80: this.soundCntL = (this.soundCntL & 0xFF00) | val; break;
            case 0x81: this.soundCntL = (this.soundCntL & 0x00FF) | (val << 8); break;
            case 0x82: 
                const oldH = this.soundCntH;
                this.soundCntH = (this.soundCntH & 0xFF00) | val; 
                if((oldH & 0x0800) && !(this.soundCntH & 0x0800)) { // Reset FIFO A
                     this.fifoA_head = 0; this.fifoA_tail = 0; this.fifoA_count = 0;
                }
                if((oldH & 0x8000) && !(this.soundCntH & 0x8000)) { // Reset FIFO B
                     this.fifoB_head = 0; this.fifoB_tail = 0; this.fifoB_count = 0;
                }
                break;
            case 0x83: this.soundCntH = (this.soundCntH & 0x00FF) | (val << 8); break;
            case 0x84: 
                const wasEnabled = this.soundCntX & 0x80;
                this.soundCntX = val;
                if (!(val & 0x80)) this.reset();
                if(!(wasEnabled) && (val & 0x80)) {
                    this.frameSequencerCycles = 0;
                    this.frameSequencerStep = 0;
                }
                break;
            
            case 0x88: this.soundBias = (this.soundBias & 0xFF00) | val; break;
            case 0x89: this.soundBias = (this.soundBias & 0x00FF) | (val << 8); break;
            
            // --- Wave RAM ---
            case 0x90: case 0x91: case 0x92: case 0x93: case 0x94: case 0x95: case 0x96: case 0x97:
            case 0x98: case 0x99: case 0x9A: case 0x9B: case 0x9C: case 0x9D: case 0x9E: case 0x9F:
                this.ch3.waveRam[addr - 0x90] = val;
                break;

            // --- FIFOs ---
            case 0xA0: case 0xA1: case 0xA2: case 0xA3: // FIFO A
                 if(this.fifoA_count < 32) { this.fifoA[this.fifoA_tail] = (val << 24) >> 24; this.fifoA_tail = (this.fifoA_tail + 1) & 0x1F; this.fifoA_count++; } break;
            case 0xA4: case 0xA5: case 0xA6: case 0xA7: // FIFO B
                 if(this.fifoB_count < 32) { this.fifoB[this.fifoB_tail] = (val << 24) >> 24; this.fifoB_tail = (this.fifoB_tail + 1) & 0x1F; this.fifoB_count++; } break;
        }
    }

    public getTimer(isA: boolean): number {
        return (this.soundCntH >> (isA ? 10 : 14)) & 1;
    }
}
