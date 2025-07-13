import { Mmu } from './Mmu';
import { Cpu } from './Cpu';
import { INTERRUPTS } from '../constants';
import { DmaState } from './types';
import { Gba } from './Gba';

class DmaChannel {
    id: number;
    bus!: Mmu;
    cpu!: Cpu;
    gba: Gba;
    
    source = 0;
    dest = 0;
    count = 0;
    control = 0;

    constructor(id: number, gba: Gba) {
        this.id = id;
        this.gba = gba;
    }

    setBus(bus: Mmu) { this.bus = bus; }
    setCpu(cpu: Cpu) { this.cpu = cpu; }

    start() {
        let count = this.count === 0 ? (this.id === 3 ? 0x10000 : 0x4000) : this.count;
        let source = this.source;
        let dest = this.dest;

        const is32bit = (this.control >> 10) & 1;
        const destAdj = (this.control >> 5) & 3;
        const sourceAdj = (this.control >> 7) & 3;
        const chunkSize = is32bit ? 4 : 2;

        for (let i = 0; i < count; i++) {
            if (is32bit) {
                this.bus.write32(dest, this.bus.read32(source));
            } else {
                this.bus.write16(dest, this.bus.read16(source));
            }
            // Add 1I cycle for the DMA controller's internal operation,
            // in addition to the memory access cycles ticked by the MMU.
            this.gba.tick(1);

            switch (sourceAdj) {
                case 0: source += chunkSize; break; // Increment
                case 1: source -= chunkSize; break; // Decrement
                case 2: break; // Fixed
            }

            switch (destAdj) {
                case 0: dest += chunkSize; break;
                case 1: dest -= chunkSize; break;
                case 2: break;
                case 3: // Increment/Reload
                    dest += chunkSize;
                    if(this.getTimingMode() === 3) {
                       dest &= 0x040000A7; // Wrap around FIFO registers
                       if(dest < 0x040000A0) dest = 0x040000A0;
                    }
                    break;
            }
        }
        
        if (this.isIrqEnabled()) {
            this.gba.requestInterrupt(INTERRUPTS.DMA0 + this.id);
        }

        if (!((this.control >> 9) & 1)) { // Not repeating
            this.control &= ~0x8000;
        } else if (destAdj === 3) { // Reload destination for audio FIFO on repeat
            // this.dest is not modified so it's already reloaded implicitly.
        }
    }
    
    isEnabled = () => (this.control & 0x8000) !== 0;
    isIrqEnabled = () => (this.control & 0x4000) !== 0;
    getTimingMode = () => (this.control >> 12) & 3;
}

export class DmaController {
    bus!: Mmu;
    cpu!: Cpu;
    gba: Gba;
    private channels: DmaChannel[] = [];
    
    // A queue for DMA requests that occur during a DMA transfer
    private requestQueue: { timing: number, fifoA?: boolean }[] = [];

    constructor(gba: Gba) {
        this.gba = gba;
    }

    setBus(bus: Mmu) {
        this.bus = bus;
        this.channels.forEach(c => c.setBus(bus));
    }
    setCpu(cpu: Cpu) {
        this.cpu = cpu;
        if (this.channels.length === 0) {
            for (let i = 0; i < 4; i++) {
                this.channels.push(new DmaChannel(i, this.gba));
            }
        }
        this.channels.forEach(c => c.setCpu(cpu));
    }

    getState(): DmaState {
        return {
            channels: this.channels.map(c => ({
                source: c.source,
                dest: c.dest,
                count: c.count,
                control: c.control
            }))
        };
    }

    loadState(state: DmaState) {
        if (!state || !state.channels) return;
        state.channels.forEach((s, i) => {
            if (this.channels[i]) {
                this.channels[i].source = s.source;
                this.channels[i].dest = s.dest;
                this.channels[i].count = s.count;
                this.channels[i].control = s.control;
            }
        });
    }

    read(addr: number): number {
        const channelId = Math.floor((addr - 0x0B0) / 0xC);
        if (channelId < 0 || channelId > 3) return 0;
    
        const channel = this.channels[channelId];
        const baseAddr = 0xB0 + channelId * 0xC;
        const regOffset = addr - baseAddr;
    
        if (regOffset === 10) return channel.control & 0xFF;
        if (regOffset === 11) return (channel.control >> 8) & 0xFF;
    
        return 0;
    }

    write(addr: number, val: number) {
        const channelId = Math.floor((addr - 0x0B0) / 0xC);
        if (channelId < 0 || channelId > 3) return;
    
        const channel = this.channels[channelId];
        const baseAddr = 0xB0 + channelId * 0xC;
        const regOffset = addr - baseAddr;

        switch (regOffset) {
            case 0: channel.source = (channel.source & 0xFFFFFF00) | val; break;
            case 1: channel.source = (channel.source & 0xFFFF00FF) | (val << 8); break;
            case 2: channel.source = (channel.source & 0xFF00FFFF) | (val << 16); break;
            case 3:
                channel.source = (channel.source & 0x00FFFFFF) | (val << 24);
                // Apply final address mask based on channel
                if (channelId === 0) channel.source &= 0x07FFFFFF; // 27-bit
                else channel.source &= 0x0FFFFFFF; // 28-bit
                break;
            case 4: channel.dest = (channel.dest & 0xFFFFFF00) | val; break;
            case 5: channel.dest = (channel.dest & 0xFFFF00FF) | (val << 8); break;
            case 6: channel.dest = (channel.dest & 0xFF00FFFF) | (val << 16); break;
            case 7:
                channel.dest = (channel.dest & 0x00FFFFFF) | (val << 24);
                // Apply final address mask based on channel
                if (channelId === 3) channel.dest &= 0x0FFFFFFF; // 28-bit
                else channel.dest &= 0x07FFFFFF; // 27-bit
                break;
            case 8: channel.count = (channel.count & 0xFF00) | val; break;
            case 9: channel.count = (channel.count & 0x00FF) | (val << 8); break;
            case 10: channel.control = (channel.control & 0xFF00) | val; break;
            case 11: 
                const wasEnabled = channel.isEnabled();
                channel.control = (channel.control & 0x00FF) | (val << 8); 
                if (!wasEnabled && channel.isEnabled() && channel.getTimingMode() === 0) {
                    this.request(0);
                }
                break;
        }
    }
    
    private request(timingMode: number, fifoA?: boolean) {
        this.requestQueue.push({ timing: timingMode, fifoA });
    }
    
    public checkAndRun(): boolean {
        if (this.requestQueue.length === 0) return false;

        const request = this.requestQueue.shift()!;
        
        // Find highest priority channel that matches timing
        for (let i = 0; i < 4; i++) {
            const ch = this.channels[i];
            
            // Special case for FIFO DMA
            if (request.timing === 3) {
                if (ch.isEnabled() && ch.getTimingMode() === 3) {
                     // Check if this channel is for the requested FIFO by checking its destination address
                     const isForFifoA = ch.dest === 0x040000A0;
                     const isForFifoB = ch.dest === 0x040000A4;

                     if ((request.fifoA && isForFifoA) || (!request.fifoA && isForFifoB)) {
                        ch.start();
                        return true;
                     }
                }
            } else if (ch.isEnabled() && ch.getTimingMode() === request.timing) {
                ch.start();
                return true;
            }
        }
        return false;
    }

    onVblank() { this.request(1); }
    onHblank() { this.request(2); }
    onFifoRequest(fifoA: boolean) { this.request(3, fifoA); }
}