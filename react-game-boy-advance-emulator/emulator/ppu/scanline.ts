
import type { Ppu } from '../Ppu';

export enum Layer { BG0, BG1, BG2, BG3, OBJ, BD }
const TARGET_A_MASK = [1, 2, 4, 8, 16, 32];
const TARGET_B_MASK = [1, 2, 4, 8, 16, 32];

function isPixelInWindow(ppu: Ppu, x: number, windowId: number): boolean {
    const h = ppu.winh[windowId];
    const x1 = h >> 8, x2 = h & 0xFF;
    if (x1 > x2) return (x >= x1 || x < x2);
    return x >= x1 && x < x2;
}

function getPixelWindow(ppu: Ppu, x: number): number | null {
    if ((ppu.dispcnt & 0x4000) && isPixelInWindow(ppu, x, 0)) return 0;
    if ((ppu.dispcnt & 0x8000) && isPixelInWindow(ppu, x, 1)) return 1;
    return null;
}

function blendAlpha(c1: number, c2: number, w1: number, w2: number): number {
    if (w1 > 16) w1 = 16;
    if (w2 > 16) w2 = 16;
    let r1 = (c1 & 0x1F), g1 = (c1 >> 5) & 0x1F, b1 = (c1 >> 10) & 0x1F;
    let r2 = (c2 & 0x1F), g2 = (c2 >> 5) & 0x1F, b2 = (c2 >> 10) & 0x1F;
    let r = Math.min(31, Math.floor((r1 * w1 + r2 * w2) / 16));
    let g = Math.min(31, Math.floor((g1 * w1 + g2 * w2) / 16));
    let b = Math.min(31, Math.floor((b1 * w1 + b2 * w2) / 16));
    return r | (g << 5) | (b << 10);
}

function blendBrightness(dir: number, c: number, w: number): number {
    if (w > 16) w = 16;
    let r = (c & 0x1F), g = (c >> 5) & 0x1F, b = (c >> 10) & 0x1F;
    if (dir > 0) {
        r = r + Math.floor(((31 - r) * w) / 16);
        g = g + Math.floor(((31 - g) * w) / 16);
        b = b + Math.floor(((31 - b) * w) / 16);
    } else {
        r = r - Math.floor((r * w) / 16);
        g = g - Math.floor((g * w) / 16);
        b = b - Math.floor((b * w) / 16);
    }
    return r | (g << 5) | (b << 10);
}

export function composeScanline(ppu: Ppu, backdrop: number) {
    const eva = (ppu.bldalpha & 0x1F);
    const evb = (ppu.bldalpha >> 8) & 0x1F;
    const evy = ppu.bldy & 0x1F;

    for(let x = 0; x < 240; x++) { // SCREEN.WIDTH
        const winId = getPixelWindow(ppu, x);
        const objIsWindow = ppu.layerBuffer[Layer.OBJ][1][x] === 1;

        let winIn, winOut;
        if (winId === null) {
            winIn = ppu.winout;
            winOut = ppu.winout;
        } else {
            winIn = ppu.winin;
            winOut = ppu.winout;
        }
        if(objIsWindow && (ppu.dispcnt & 0x2000)) {
            winIn = ppu.winout; winOut = ppu.winout;
        }

        let topPrio = 64, topPrio2 = 64;
        let topLayer: Layer = Layer.BD, topLayer2: Layer = Layer.BD;
        
        for (let i = 0; i < 6; i++) {
            if (ppu.layerPrio[i][x] < topPrio && (winIn & (1 << i))) {
                topLayer2 = topLayer;
                topPrio2 = topPrio;
                topLayer = i as Layer;
                topPrio = ppu.layerPrio[i][x];
            } else if (ppu.layerPrio[i][x] < topPrio2 && (winIn & (1 << i))) {
                topLayer2 = i as Layer;
                topPrio2 = ppu.layerPrio[i][x];
            }
        }

        const topColor = ppu.layerBuffer[topLayer][0][x];
        const bottomColor = ppu.layerBuffer[topLayer2][0][x];
        
        const blendMode = (ppu.bldcnt >> 6) & 3;

        if (blendMode > 0 && (TARGET_A_MASK[topLayer] & ppu.bldcnt)) {
            if (blendMode === 1 && (TARGET_B_MASK[topLayer2] & (ppu.bldcnt >> 8))) {
                 ppu.lineBuffer[x] = blendAlpha(topColor, bottomColor, eva, evb);
            } else if (blendMode === 2) { // Brighten
                ppu.lineBuffer[x] = blendBrightness(1, topColor, evy);
            } else if (blendMode === 3) { // Darken
                ppu.lineBuffer[x] = blendBrightness(-1, topColor, evy);
            } else {
                ppu.lineBuffer[x] = topColor;
            }
        } else {
            ppu.lineBuffer[x] = topColor;
        }
    }
}
