
import { Mmu } from './Mmu';
import { SCREEN, INTERRUPTS } from '../constants';
import { PpuState } from './types';
import { Gba } from './Gba';
import { renderBgs } from './ppu/backgrounds';
import { renderSprites } from './ppu/sprites';
import { composeScanline, Layer } from './ppu/scanline';

export class Ppu {
    bus!: Mmu;
    gba: Gba;
    ctx: CanvasRenderingContext2D | null = null;
    private imageData: ImageData | null = null;
    private frameBuffer = new Uint32Array(SCREEN.WIDTH * SCREEN.HEIGHT);
    
    // These memories are made public to allow the MMU to correctly
    // implement BIOS functions like SWI 02h (RegisterRamReset) which
    // directly manipulate these regions.
    public vram = new Uint8Array(96 * 1024);
    public oam = new Uint8Array(1 * 1024);
    public paletteRam = new Uint8Array(1 * 1024);

    // --- I/O Registers ---
    dispcnt = 0;
    dispstat = 0;
    vcount = 0;
    bgcnt = new Uint16Array(4);
    bghofs = new Uint16Array(4);
    bgvofs = new Uint16Array(4);

    // Affine BG params
    bgpa = new Int16Array(2);
    bgpb = new Int16Array(2);
    bgpc = new Int16Array(2);
    bgpd = new Int16Array(2);
    bgx = new Int32Array(2);
    bgy = new Int32Array(2);
    internal_bgx = new Int32Array(2);
    internal_bgy = new Int32Array(2);

    // Windowing
    winh = new Uint16Array(2);
    winv = new Uint16Array(2);
    winin = 0;
    winout = 0;
    
    // Blending
    bldcnt = 0;
    bldalpha = 0;
    bldy = 0;
    
    cycles = 0;

    // Public buffers for external renderers
    public lineBuffer = new Uint16Array(SCREEN.WIDTH);
    public layerBuffer: Uint16Array[][] = [];
    public layerPrio: Uint8Array[] = [];
    public visibleLayers: boolean[] = [];

    
    constructor(gba: Gba) {
        this.gba = gba;
        for (let i = 0; i < 6; i++) { // 4 BG layers + 1 OBJ layer + 1 BD layer
            this.layerBuffer.push([new Uint16Array(SCREEN.WIDTH), new Uint16Array(SCREEN.WIDTH)]);
            this.layerPrio.push(new Uint8Array(SCREEN.WIDTH));
        }
        this.reset();
    }

    getState(): PpuState {
        return {
            vram: this.vram, oam: this.oam, paletteRam: this.paletteRam,
            dispcnt: this.dispcnt, dispstat: this.dispstat, vcount: this.vcount,
            cycles: this.cycles,
            bgcnt: this.bgcnt, bghofs: this.bghofs, bgvofs: this.bgvofs,
            bgpa: this.bgpa, bgpb: this.bgpb, bgpc: this.bgpc, bgpd: this.bgpd,
            bgx: this.bgx, bgy: this.bgy, winh: this.winh, winv: this.winv,
            winin: this.winin, winout: this.winout, bldcnt: this.bldcnt,
            bldalpha: this.bldalpha, bldy: this.bldy,
        };
    }

    loadState(state: PpuState) {
        this.vram.set(state.vram);
        this.oam.set(state.oam);
        this.paletteRam.set(state.paletteRam);
        this.dispcnt = state.dispcnt;
        this.dispstat = state.dispstat;
        this.vcount = state.vcount;
        this.cycles = state.cycles;
        this.bgcnt.set(state.bgcnt); this.bghofs.set(state.bghofs); this.bgvofs.set(state.bgvofs);
        this.bgpa.set(state.bgpa); this.bgpb.set(state.bgpb); this.bgpc.set(state.bgpc); this.bgpd.set(state.bgpd);
        this.bgx.set(state.bgx); this.bgy.set(state.bgy);
        this.winh.set(state.winh); this.winv.set(state.winv);
        this.winin = state.winin; this.winout = state.winout;
        this.bldcnt = state.bldcnt;
        this.bldalpha = state.bldalpha;
        this.bldy = this.bldy;
    }

    reset() {
        this.vram.fill(0);
        this.oam.fill(0);
        this.paletteRam.fill(0);
        this.dispcnt = 0;
        this.dispstat = 0;
        this.vcount = 0;
        this.cycles = 0;
        
        this.bgcnt.fill(0); this.bghofs.fill(0); this.bgvofs.fill(0);
        this.bgpa.fill(0); this.bgpb.fill(0); this.bgpc.fill(0); this.bgpd.fill(0);
        this.bgx.fill(0); this.bgy.fill(0);
        this.internal_bgx.fill(0); this.internal_bgy.fill(0);
        this.winh.fill(0); this.winv.fill(0);
        this.winin = 0; this.winout = 0;
        this.bldcnt = 0;
        this.bldalpha = 0;
        this.bldy = 0;
    }

    setContext(ctx: CanvasRenderingContext2D) {
        this.ctx = ctx;
        this.imageData = this.ctx.createImageData(SCREEN.WIDTH, SCREEN.HEIGHT);
    }
    
    private isVramAccessible(): boolean {
        // VRAM is accessible during HBlank, VBlank. It is NOT accessible during HDraw.
        // A forced blank of the screen also allows access.
        if ((this.dispcnt & 0x80)) return true; // Forced blank
        if (this.vcount >= 160) return true; // VBlank period
        
        // During scanline rendering, only HBlank allows access.
        // dispstat bit 1 is the HBlank flag.
        if ((this.dispstat & 2) !== 0) return true; 

        return false;
    }

    step(cycles: number) {
        this.cycles += cycles;
        
        const vcountMatch = (this.dispstat >> 8) & 0xFF;
        if (this.vcount === vcountMatch) {
            this.dispstat |= 0x4; // V-Counter flag
            if (this.dispstat & 0x20) { // V-Counter IRQ
                this.gba.requestInterrupt(INTERRUPTS.VCOUNTER);
            }
        } else {
            this.dispstat &= ~0x4;
        }

        switch (this.dispstat & 3) {
            case 0: // HDraw
                if (this.cycles >= 960) {
                    this.cycles -= 960;
                    this.dispstat = (this.dispstat & ~3) | 1; // Enter HBlank
                    this.renderScanline();
                    if (this.dispstat & 0x10) {
                        this.gba.requestInterrupt(INTERRUPTS.HBLANK);
                    }
                    this.bus.dma.onHblank();
                }
                break;
            case 1: // HBlank
                if (this.cycles >= 272) {
                    this.cycles -= 272;
                    this.vcount++;
                    
                    this.internal_bgx[0] += this.bgpb[0];
                    this.internal_bgy[0] += this.bgpd[0];
                    this.internal_bgx[1] += this.bgpb[1];
                    this.internal_bgy[1] += this.bgpd[1];
                    
                    if (this.vcount === 160) {
                        this.dispstat |= 0x1;
                        this.dispstat = (this.dispstat & ~3) | 2; // Enter VBlank
                         if (this.dispstat & 0x08) {
                            this.gba.requestInterrupt(INTERRUPTS.VBLANK);
                        }
                        this.bus.dma.onVblank();
                        this.drawToCanvas();
                    } else {
                        this.dispstat &= ~3;
                    }
                }
                break;
            case 2: // VBlank
                if (this.cycles >= 1232) {
                    this.cycles -= 1232;
                    this.vcount++;
                    if (this.vcount > 227) {
                        this.vcount = 0;
                        this.dispstat &= ~3;
                        this.dispstat &= ~1;
                        this.internal_bgx.set(this.bgx);
                        this.internal_bgy.set(this.bgy);
                    }
                }
                break;
        }
    }
    
    private renderScanline() {
        if (this.vcount >= 160) return;
        
        const backdrop = this.readPalette16(0);
        this.layerBuffer[Layer.BD][0].fill(backdrop);
        this.layerPrio[Layer.BD].fill(65);

        for (let i = 0; i < Layer.OBJ; i++) {
            this.layerBuffer[i][0].fill(0);
            this.layerPrio[i].fill(64);
        }
        this.layerBuffer[Layer.OBJ][0].fill(0);
        this.layerBuffer[Layer.OBJ][1].fill(0); // For OBJ windowing
        this.layerPrio[Layer.OBJ].fill(64);

        if ((this.dispcnt >> 7) & 1) { // Forced Blank
            this.lineBuffer.fill(backdrop);
        } else {
            renderBgs(this);
            if ((this.dispcnt & 0x1000)) {
                renderSprites(this);
            }
            composeScanline(this, backdrop);
        }
    
        for (let x = 0; x < SCREEN.WIDTH; x++) {
            const bgr555 = this.lineBuffer[x];
            const r = (bgr555 & 0x1F) << 3;
            const g = ((bgr555 >> 5) & 0x1F) << 3;
            const b = ((bgr555 >> 10) & 0x1F) << 3;
            const fbIndex = this.vcount * SCREEN.WIDTH + x;
            this.frameBuffer[fbIndex] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
    }
    
    drawToCanvas() {
        if (!this.ctx || !this.imageData) return;
        this.imageData.data.set(new Uint8ClampedArray(this.frameBuffer.buffer));
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    getCanvasDataURL(): string {
        if (!this.ctx) return '';
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = SCREEN.WIDTH;
        tempCanvas.height = SCREEN.HEIGHT;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return '';
        
        // Downscale to a reasonable thumbnail size like 120x80
        tempCtx.imageSmoothingEnabled = false;
        tempCtx.drawImage(this.ctx.canvas, 0, 0, 120, 80);
        return tempCanvas.toDataURL('image/jpeg', 0.8);
    }
    
    private readReg16(val: number): number {
        return val;
    }

    read(addr: number): number {
        switch(addr) {
            case 0x00: return this.dispcnt & 0xFF;
            case 0x01: return this.dispcnt >> 8;
            case 0x04: return this.dispstat & 0xFF;
            case 0x05: return (this.dispstat >> 8) | this.vcount >> 8;
            case 0x06: return this.vcount & 0xFF;
            
            case 0x08: return this.bgcnt[0] & 0xFF;
            case 0x09: return this.bgcnt[0] >> 8;
            case 0x0A: return this.bgcnt[1] & 0xFF;
            case 0x0B: return this.bgcnt[1] >> 8;
            case 0x0C: return this.bgcnt[2] & 0xFF;
            case 0x0D: return this.bgcnt[2] >> 8;
            case 0x0E: return this.bgcnt[3] & 0xFF;
            case 0x0F: return this.bgcnt[3] >> 8;
            
            case 0x10: return this.bghofs[0] & 0xFF;
            case 0x11: return this.bghofs[0] >> 8;
            case 0x12: return this.bgvofs[0] & 0xFF;
            case 0x13: return this.bgvofs[0] >> 8;
            case 0x14: return this.bghofs[1] & 0xFF;
            case 0x15: return this.bghofs[1] >> 8;
            case 0x16: return this.bgvofs[1] & 0xFF;
            case 0x17: return this.bgvofs[1] >> 8;
            case 0x18: return this.bghofs[2] & 0xFF;
            case 0x19: return this.bghofs[2] >> 8;
            case 0x1A: return this.bgvofs[2] & 0xFF;
            case 0x1B: return this.bgvofs[2] >> 8;
            case 0x1C: return this.bghofs[3] & 0xFF;
            case 0x1D: return this.bghofs[3] >> 8;
            case 0x1E: return this.bgvofs[3] & 0xFF;
            case 0x1F: return this.bgvofs[3] >> 8;

            case 0x40: return this.winh[0] & 0xFF;
            case 0x41: return this.winh[0] >> 8;
            case 0x42: return this.winh[1] & 0xFF;
            case 0x43: return this.winh[1] >> 8;
            case 0x44: return this.winv[0] & 0xFF;
            case 0x45: return this.winv[0] >> 8;
            case 0x46: return this.winv[1] & 0xFF;
            case 0x47: return this.winv[1] >> 8;
            case 0x48: return this.winin & 0xFF;
            case 0x49: return this.winout & 0xFF;

            case 0x50: return this.bldcnt & 0xFF;
            case 0x51: return this.bldcnt >> 8;
            case 0x52: return this.bldalpha & 0xFF;
            case 0x53: return this.bldalpha >> 8;
            case 0x54: return this.bldy & 0xFF;
        }
        return 0;
     }

    write(addr: number, val: number) {
        switch(addr) {
            case 0x00: this.dispcnt = (this.dispcnt & 0xFF00) | val; break;
            case 0x01: this.dispcnt = (this.dispcnt & 0x00FF) | (val << 8); break;
            case 0x04: this.dispstat = (this.dispstat & 0xFF00) | (val & 0xF8); break;
            case 0x05: this.dispstat = (this.dispstat & 0x00FF) | (val << 8); break;
            
            case 0x08: this.bgcnt[0] = (this.bgcnt[0] & 0xFF00) | val; break;
            case 0x09: this.bgcnt[0] = (this.bgcnt[0] & 0x00FF) | (val << 8); break;
            case 0x0A: this.bgcnt[1] = (this.bgcnt[1] & 0xFF00) | val; break;
            case 0x0B: this.bgcnt[1] = (this.bgcnt[1] & 0x00FF) | (val << 8); break;
            case 0x0C: this.bgcnt[2] = (this.bgcnt[2] & 0xFF00) | val; break;
            case 0x0D: this.bgcnt[2] = (this.bgcnt[2] & 0x00FF) | (val << 8); break;
            case 0x0E: this.bgcnt[3] = (this.bgcnt[3] & 0xFF00) | val; break;
            case 0x0F: this.bgcnt[3] = (this.bgcnt[3] & 0x00FF) | (val << 8); break;

            case 0x10: this.bghofs[0] = (this.bghofs[0] & 0xFF00) | val; break;
            case 0x11: this.bghofs[0] = (this.bghofs[0] & 0x00FF) | (val << 8); break;
            case 0x12: this.bgvofs[0] = (this.bgvofs[0] & 0xFF00) | val; break;
            case 0x13: this.bgvofs[0] = (this.bgvofs[0] & 0x00FF) | (val << 8); break;

            case 0x14: this.bghofs[1] = (this.bghofs[1] & 0xFF00) | val; break;
            case 0x15: this.bghofs[1] = (this.bghofs[1] & 0x00FF) | (val << 8); break;
            case 0x16: this.bgvofs[1] = (this.bgvofs[1] & 0xFF00) | val; break;
            case 0x17: this.bgvofs[1] = (this.bgvofs[1] & 0x00FF) | (val << 8); break;

            case 0x18: this.bghofs[2] = (this.bghofs[2] & 0xFF00) | val; break;
            case 0x19: this.bghofs[2] = (this.bghofs[2] & 0x00FF) | (val << 8); break;
            case 0x1A: this.bgvofs[2] = (this.bgvofs[2] & 0xFF00) | val; break;
            case 0x1B: this.bgvofs[2] = (this.bgvofs[2] & 0x00FF) | (val << 8); break;

            case 0x1C: this.bghofs[3] = (this.bghofs[3] & 0xFF00) | val; break;
            case 0x1D: this.bghofs[3] = (this.bghofs[3] & 0x00FF) | (val << 8); break;
            case 0x1E: this.bgvofs[3] = (this.bgvofs[3] & 0xFF00) | val; break;
            case 0x1F: this.bgvofs[3] = (this.bgvofs[3] & 0x00FF) | (val << 8); break;

            case 0x20: this.bgpa[0] = (this.bgpa[0] & 0xFF00) | val; break;
            case 0x21: this.bgpa[0] = (this.bgpa[0] & 0x00FF) | (val << 8); break;
            case 0x22: this.bgpb[0] = (this.bgpb[0] & 0xFF00) | val; break;
            case 0x23: this.bgpb[0] = (this.bgpb[0] & 0x00FF) | (val << 8); break;
            case 0x24: this.bgpc[0] = (this.bgpc[0] & 0xFF00) | val; break;
            case 0x25: this.bgpc[0] = (this.bgpc[0] & 0x00FF) | (val << 8); break;
            case 0x26: this.bgpd[0] = (this.bgpd[0] & 0xFF00) | val; break;
            case 0x27: this.bgpd[0] = (this.bgpd[0] & 0x00FF) | (val << 8); break;
            case 0x30: this.bgpa[1] = (this.bgpa[1] & 0xFF00) | val; break;
            case 0x31: this.bgpa[1] = (this.bgpa[1] & 0x00FF) | (val << 8); break;
            case 0x32: this.bgpb[1] = (this.bgpb[1] & 0xFF00) | val; break;
            case 0x33: this.bgpb[1] = (this.bgpb[1] & 0x00FF) | (val << 8); break;
            case 0x34: this.bgpc[1] = (this.bgpc[1] & 0xFF00) | val; break;
            case 0x35: this.bgpc[1] = (this.bgpc[1] & 0x00FF) | (val << 8); break;
            case 0x36: this.bgpd[1] = (this.bgpd[1] & 0xFF00) | val; break;
            case 0x37: this.bgpd[1] = (this.bgpd[1] & 0x00FF) | (val << 8); break;


            case 0x28: this.bgx[0] = (this.bgx[0] & 0xFFFFFF00) | val; break;
            case 0x29: this.bgx[0] = (this.bgx[0] & 0xFFFF00FF) | (val << 8); break;
            case 0x2A: this.bgx[0] = (this.bgx[0] & 0xFF00FFFF) | (val << 16); break;
            case 0x2B: this.bgx[0] = (this.bgx[0] & 0x00FFFFFF) | (val << 24); this.internal_bgx[0] = this.bgx[0]; break;
            case 0x2C: this.bgy[0] = (this.bgy[0] & 0xFFFFFF00) | val; break;
            case 0x2D: this.bgy[0] = (this.bgy[0] & 0xFFFF00FF) | (val << 8); break;
            case 0x2E: this.bgy[0] = (this.bgy[0] & 0xFF00FFFF) | (val << 16); break;
            case 0x2F: this.bgy[0] = (this.bgy[0] & 0x00FFFFFF) | (val << 24); this.internal_bgy[0] = this.bgy[0]; break;

            case 0x38: this.bgx[1] = (this.bgx[1] & 0xFFFFFF00) | val; break;
            case 0x39: this.bgx[1] = (this.bgx[1] & 0xFFFF00FF) | (val << 8); break;
            case 0x3A: this.bgx[1] = (this.bgx[1] & 0xFF00FFFF) | (val << 16); break;
            case 0x3B: this.bgx[1] = (this.bgx[1] & 0x00FFFFFF) | (val << 24); this.internal_bgx[1] = this.bgx[1]; break;
            case 0x3C: this.bgy[1] = (this.bgy[1] & 0xFFFFFF00) | val; break;
            case 0x3D: this.bgy[1] = (this.bgy[1] & 0xFFFF00FF) | (val << 8); break;
            case 0x3E: this.bgy[1] = (this.bgy[1] & 0xFF00FFFF) | (val << 16); break;
            case 0x3F: this.bgy[1] = (this.bgy[1] & 0x00FFFFFF) | (val << 24); this.internal_bgy[1] = this.bgy[1]; break;

            case 0x40: this.winh[0] = (this.winh[0] & 0xFF00) | val; break;
            case 0x41: this.winh[0] = (this.winh[0] & 0x00FF) | (val << 8); break;
            case 0x42: this.winh[1] = (this.winh[1] & 0xFF00) | val; break;
            case 0x43: this.winh[1] = (this.winh[1] & 0x00FF) | (val << 8); break;
            case 0x44: this.winv[0] = (this.winv[0] & 0xFF00) | val; break;
            case 0x45: this.winv[0] = (this.winv[0] & 0x00FF) | (val << 8); break;
            case 0x46: this.winv[1] = (this.winv[1] & 0xFF00) | val; break;
            case 0x47: this.winv[1] = (this.winv[1] & 0x00FF) | (val << 8); break;

            case 0x48: this.winin = val; break;
            case 0x49: this.winout = val; break;

            case 0x50: this.bldcnt = (this.bldcnt & 0xFF00) | val; break;
            case 0x51: this.bldcnt = (this.bldcnt & 0x00FF) | (val << 8); break;
            case 0x52: this.bldalpha = (this.bldalpha & 0xFF00) | val; break;
            case 0x53: this.bldalpha = (this.bldalpha & 0x00FF) | (val << 8); break;
            case 0x54: this.bldy = val & 0x1F; break;
        }
    }
    
    readVram8(addr: number): number {
        if (!this.isVramAccessible()) {
            // Reading from VRAM during HDraw returns open bus, which is complex.
            // Returning 0xFF is a common and often sufficient simplification.
            return 0xFF;
        }
        return this.vram[addr & 0x17FFF];
    }
    readVram16(addr: number): number {
        if (!this.isVramAccessible()) {
            return 0xFFFF;
        }
        return this.vram[addr & 0x17FFF] | (this.vram[(addr + 1) & 0x17FFF] << 8);
    }
    writeVram8(addr: number, val: number) { 
        if (!this.isVramAccessible()) return;

        // The original logic was slightly overcomplicated.
        // A single mask handles the VRAM mirror correctly.
        // e.g., 0x06018000 & 0x17FFF -> 0x00000.
        this.vram[addr & 0x17FFF] = val;
    }
    writeVram16(addr: number, val: number) {
        this.writeVram8(addr, val & 0xFF);
        this.writeVram8(addr+1, val >> 8);
    }
    
    readOam16(addr: number): number {
        // OAM is inaccessible during HDraw (modes 0-2)
        if ((this.dispstat & 2) === 0 && this.vcount < 160) return 0xFFFF;
        return this.oam[addr & 0x3FF] | (this.oam[(addr + 1) & 0x3FF] << 8);
    }
    writeOam16(addr: number, val: number) {
        if ((this.dispstat & 2) === 0 && this.vcount < 160) return;
        this.oam[addr & 0x3FF] = val & 0xFF;
        this.oam[(addr + 1) & 0x3FF] = (val >> 8) & 0xFF;
    }

    readPalette16(addr: number): number { return this.paletteRam[addr & 0x3FF] | (this.paletteRam[(addr + 1) & 0x3FF] << 8); }
    writePalette16(addr: number, val: number) { 
        this.paletteRam[addr & 0x3FF] = val & 0xFF;
        this.paletteRam[(addr + 1) & 0x3FF] = (val >> 8) & 0xFF;
    }

    readPalette(addr: number): number { return this.paletteRam[addr & 0x3FF]; }
    writePalette(addr: number, val: number) { this.paletteRam[addr & 0x3FF] = val; }

    readOam(addr: number): number {
        if ((this.dispstat & 2) === 0 && this.vcount < 160) return 0xFF;
        return this.oam[addr & 0x3FF];
    }
    writeOam(addr: number, val: number) {
        if ((this.dispstat & 2) === 0 && this.vcount < 160) return;
        this.oam[addr & 0x3FF] = val;
    }
    readVram(addr: number): number { return this.readVram8(addr); }
    writeVram(addr: number, val: number) { this.writeVram8(addr, val); }
}
