import type { Ppu } from '../Ppu';
import { Layer } from './scanline';

const SPRITE_SIZES = [
    [8,8], [16,16], [32,32], [64,64], // Square
    [16,8], [32,8], [32,16], [64,32], // Horizontal
    [8,16], [8,32], [16,32], [32,64]  // Vertical
];

export function renderSprites(ppu: Ppu) {
    const y = ppu.vcount;
    const is1DMapping = (ppu.dispcnt >> 6) & 1;
    
    for (let i = 127; i >= 0; i--) { // Render from lowest prio to highest
        const attr0 = ppu.readOam16(i * 8 + 0);
        const objMode = (attr0 >> 8) & 3;
        if (objMode === 2) continue; // Disabled

        let spriteY = attr0 & 0xFF;
        if (spriteY >= 160) spriteY -= 256;
        
        const attr1 = ppu.readOam16(i * 8 + 2);
        const shape = (attr0 >> 14) & 3;
        const size = (attr1 >> 14) & 3;
        const [w, h] = SPRITE_SIZES[shape * 4 + size];

        let height = h;
        if ((attr0 >> 9) & 1) height *= 2; // Affine double size

        if (y < spriteY || y >= spriteY + height) continue;
        
        const attr2 = ppu.readOam16(i * 8 + 4);
        const isAffine = (attr0 >> 8) & 1;
        
        let spriteX = attr1 & 0x1FF;
        if (spriteX >= 240) spriteX -= 512;
        
        let width = w;
        if(isAffine && (attr0 >> 9) & 1) width *= 2;

        for (let x_off = 0; x_off < width; x_off++) {
            const screenX = spriteX + x_off;
            if(screenX < 0 || screenX >= 240) continue; // SCREEN.WIDTH
            
            const prio = (attr2 >> 10) & 3;
            if (ppu.layerPrio[Layer.OBJ][screenX] < 64 && prio >= ppu.layerPrio[Layer.OBJ][screenX]) {
                 continue;
            }

            const is8bpp = (attr0 >> 13) & 1;
            let tileX, tileY;

            if(isAffine) {
                const affineId = (attr1 >> 9) & 0x1F;
                const pa = ppu.readOam16(32 * affineId + 6);
                const pb = ppu.readOam16(32 * affineId + 14);
                const pc = ppu.readOam16(32 * affineId + 22);
                const pd = ppu.readOam16(32 * affineId + 30);
                const w_2 = width/2, h_2 = height/2;
                const dx = x_off - w_2, dy = (y - spriteY) - h_2;
                tileX = ((pa * dx + pb * dy) >> 8) + w/2;
                tileY = ((pc * dx + pd * dy) >> 8) + h/2;
            } else {
                const flipH = (attr1 >> 12) & 1;
                const flipV = (attr1 >> 13) & 1;
                tileX = flipH ? w - 1 - x_off : x_off;
                tileY = flipV ? h - 1 - (y - spriteY) : y - spriteY;
            }

            if (tileX < 0 || tileX >= w || tileY < 0 || tileY >= h) continue;

            let tileNum = attr2 & 0x3FF;
            
            if (is1DMapping) {
                const tilesPerRow = w / 8;
                const tileInc = (is8bpp ? 2 : 1);
                tileNum += (Math.floor(tileY / 8) * tilesPerRow + Math.floor(tileX / 8)) * tileInc;
            } else { // 2D mapping
                tileNum += (Math.floor(tileY / 8) * 32) + Math.floor(tileX / 8);
            }
            
            const vramAddr = 0x10000 + (tileNum & 0x3FF) * 32;
            let colorIndex;

            if (is8bpp) {
                const addr = vramAddr + (tileY % 8) * 8 + (tileX % 8);
                colorIndex = ppu.readVram8(addr);
            } else {
                const addr = vramAddr + (tileY % 8) * 4 + Math.floor((tileX % 8) / 2);
                const palData = ppu.readVram8(addr);
                colorIndex = (tileX % 2 === 0) ? (palData & 0xF) : (palData >> 4);
            }

            if (colorIndex > 0) {
                const palNum = (attr2 >> 12) & 0xF;
                const color = is8bpp ? ppu.readPalette16(512 + colorIndex * 2) : ppu.readPalette16(512 + (palNum * 16 + colorIndex) * 2);
                ppu.layerBuffer[Layer.OBJ][0][screenX] = color;
                ppu.layerPrio[Layer.OBJ][screenX] = prio;
                
                if (objMode === 3) { // OBJ Window mode
                    ppu.layerBuffer[Layer.OBJ][1][screenX] = 1; // Mark as OBJ window pixel
                }
            }
        }
    }
}