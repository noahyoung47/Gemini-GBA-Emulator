
import type { Ppu } from '../Ppu';

function renderTiledBg(ppu: Ppu, bg: number) {
    const ctrl = ppu.bgcnt[bg];
    const prio = ctrl & 3;
    const charBase = ((ctrl >> 2) & 3) * 0x4000;
    const is8bpp = (ctrl >> 7) & 1;
    const mapBase = ((ctrl >> 8) & 0x1F) * 0x800;
    const screenSize = (ctrl >> 14) & 3;

    const mapW = [32, 64, 32, 64][screenSize];
    const mapH = [32, 32, 64, 64][screenSize];

    const hofs = ppu.bghofs[bg] & 0x1FF;
    const vofs = ppu.bgvofs[bg] & 0x1FF;

    const y = ppu.vcount;

    for (let x = 0; x < 240; x++) { // SCREEN.WIDTH
        const bgx = (x + hofs) & 0x1FF;
        const bgy = (y + vofs) & 0x1FF;

        const mapTileX = Math.floor(bgx / 8);
        const mapTileY = Math.floor(bgy / 8);

        let screenBlock = 0;
        if (mapTileX >= 32) screenBlock += 1;
        if (mapTileY >= 32 && mapW > 32) screenBlock += 2;
        
        const screenBlockBase = mapBase + screenBlock * 0x800;
        const tileXInBlock = mapTileX % 32;
        const tileYInBlock = mapTileY % 32;
        
        const mapEntryAddr = screenBlockBase + (tileYInBlock * 32 + tileXInBlock) * 2;
        const mapEntry = ppu.readVram16(mapEntryAddr);

        const tileNum = mapEntry & 0x3FF;
        const flipH = (mapEntry >> 10) & 1;
        const flipV = (mapEntry >> 11) & 1;
        const palNum = (mapEntry >> 12) & 0xF;

        let tileX = bgx % 8;
        let tileY = bgy % 8;

        if (flipH) tileX = 7 - tileX;
        if (flipV) tileY = 7 - tileY;

        let colorIndex = 0;
        if (is8bpp) {
            const tileAddr = charBase + tileNum * 64 + tileY * 8 + tileX;
            colorIndex = ppu.readVram8(tileAddr);
        } else {
            const tileAddr = charBase + tileNum * 32 + tileY * 4 + Math.floor(tileX / 2);
            const palData = ppu.readVram8(tileAddr);
            colorIndex = (tileX % 2 === 0) ? (palData & 0xF) : (palData >> 4);
        }

        if (colorIndex > 0) {
            const color = is8bpp ? ppu.readPalette16(colorIndex * 2) : ppu.readPalette16((palNum * 16 + colorIndex) * 2);
            ppu.layerBuffer[bg][0][x] = color;
            ppu.layerPrio[bg][x] = prio;
        }
    }
}

function renderAffineBg(ppu: Ppu, bg: number) {
    const ctrl = ppu.bgcnt[bg];
    const prio = ctrl & 3;
    const charBase = ((ctrl >> 2) & 3) * 0x4000;
    const mapBase = ((ctrl >> 8) & 0x1F) * 0x800;
    const wrap = (ctrl >> 13) & 1;
    const size = (ctrl >> 14) & 3;

    const mapSize = 128 << size;
    const mapMask = mapSize - 1;

    const pa = ppu.bgpa[bg - 2];
    const pc = ppu.bgpc[bg - 2];

    let refX = ppu.internal_bgx[bg - 2];
    let refY = ppu.internal_bgy[bg - 2];

    for (let x = 0; x < 240; x++) { // SCREEN.WIDTH
        let bgx = (refX >> 8);
        let bgy = (refY >> 8);

        if (wrap) {
            bgx &= mapMask;
            bgy &= mapMask;
        }

        if (wrap || (bgx >= 0 && bgx < mapSize && bgy >= 0 && bgy < mapSize)) {
            const mapX = Math.floor(bgx / 8);
            const mapY = Math.floor(bgy / 8);
            const mapOffset = mapY * (mapSize / 8) + mapX;
            
            const tileNum = ppu.readVram8(mapBase + mapOffset);
            
            if (tileNum > 0) {
                const tileX = bgx & 7;
                const tileY = bgy & 7;
                
                const tileAddr = charBase + tileNum * 64 + tileY * 8 + tileX;
                const colorIndex = ppu.readVram8(tileAddr);

                if (colorIndex > 0) {
                    const color = ppu.readPalette16(colorIndex * 2);
                    ppu.layerBuffer[bg][0][x] = color;
                    ppu.layerPrio[bg][x] = prio;
                }
            }
        }
        refX += pa;
        refY += pc;
    }
}

function renderMode3(ppu: Ppu) {
    const prio = ppu.bgcnt[2] & 3;
    const y = ppu.vcount;
    for (let x = 0; x < 240; x++) { // SCREEN.WIDTH
        const addr = (y * 240 + x) * 2;
        const color = ppu.readVram16(addr);
        ppu.layerBuffer[2][0][x] = color;
        ppu.layerPrio[2][x] = prio;
    }
}

function renderMode4(ppu: Ppu) {
    const prio = ppu.bgcnt[2] & 3;
    const frame_start = (ppu.dispcnt & 0x10) ? 0xA000 : 0;
    const y = ppu.vcount;
    for (let x = 0; x < 240; x++) { // SCREEN.WIDTH
        const addr = frame_start + y * 240 + x;
        const colorIndex = ppu.readVram8(addr);
        if (colorIndex > 0) {
            const color = ppu.readPalette16(colorIndex * 2);
            ppu.layerBuffer[2][0][x] = color;
            ppu.layerPrio[2][x] = prio;
        }
    }
}

function renderMode5(ppu: Ppu) {
    if(ppu.vcount >= 128 || ppu.vcount < 0) return;
    const prio = ppu.bgcnt[2] & 3;
    const frame_start = (ppu.dispcnt & 0x10) ? 0xA000 : 0;
    const y = ppu.vcount;

    for (let x = 0; x < 160; x++) {
         const addr = frame_start + (y * 160 + x) * 2;
         const color = ppu.readVram16(addr);
         ppu.layerBuffer[2][0][x] = color;
         ppu.layerPrio[2][x] = prio;
    }
}


export function renderBgs(ppu: Ppu) {
    const mode = ppu.dispcnt & 0x7;
    for (let i = 3; i >= 0; i--) { // Render from highest prio to lowest
        ppu.visibleLayers[i] = !!(ppu.dispcnt & (0x100 << i));
        if (!ppu.visibleLayers[i]) continue;
        
        switch(mode) {
            case 0: renderTiledBg(ppu, i); break;
            case 1: if(i < 2) renderTiledBg(ppu, i); else if (i === 2) renderAffineBg(ppu, i); break;
            case 2: if(i >= 2) renderAffineBg(ppu, i); break;
            case 3: if(i === 2) renderMode3(ppu); break;
            case 4: if(i === 2) renderMode4(ppu); break;
            case 5: if(i === 2) renderMode5(ppu); break;
        }
    }
}
