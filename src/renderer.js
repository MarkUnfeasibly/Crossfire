import * as PIXI from 'pixi.js';
import { state } from './state.js';
import { set } from 'firebase/database';
import { refs } from './firebase.js';
import { coordsToCell, cellToCoords, calculateDistance } from './engine_math.js'; 
import { showToast, logAction } from './ui.js'; 
import { executeCombat } from './engine_combat.js';
import { MOVEMENT_DB } from './data_tables.js'; 

export let app;
export let cellSize = 40;
export let selectedUnitIndex = null; 

let showRoofOverlay = false;
let renderLayer = 'ground';

export function initRenderer() {
  const wrapper = document.getElementById('canvasWrapper');
  app = new PIXI.Application({
    width: 48 * cellSize,
    height: 48 * cellSize,
    backgroundColor: 0xEAE0C8,
    resolution: window.devicePixelRatio || 1,
    antialias: false
  });
  
  PIXI.BaseTexture.defaultOptions.scaleMode = PIXI.SCALE_MODES.NEAREST;
  
  wrapper.innerHTML = ''; 
  wrapper.appendChild(app.view);
  
  app.stage.eventMode = 'static';
  app.stage.on('pointerdown', () => {
      selectedUnitIndex = null;
      renderTokens();
  });
}

export function setZoomLevel(newSize) {
  cellSize = newSize;
  renderMap();
}

export function toggleRoofOverlay(isVisible) {
  showRoofOverlay = isVisible;
  renderMap();
}

export function setRenderLayer(layer) {
  renderLayer = layer;
  renderMap();
}

export function renderMap() {
  if (!app) return;
  
  const oldMapContainer = app.stage.getChildByName('mapContainer');
  if (oldMapContainer) {
      app.stage.removeChild(oldMapContainer);
  }
  
  const mapContainer = new PIXI.Container();
  mapContainer.name = 'mapContainer';
  
  const rows = state.maps.ground?.length || 48;
  const cols = state.maps.ground?.[0]?.length || 48;
  
  app.renderer.resize(cols * cellSize, rows * cellSize);

  const activeMap = renderLayer === 'ground' ? state.maps.ground : state.maps.roof;
  const otherMap = renderLayer === 'ground' ? state.maps.roof : state.maps.ground;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellSize;
      const y = r * cellSize;
      
      let baseCell = new PIXI.Graphics();
      baseCell.beginFill(0xDDCBAA);
      baseCell.lineStyle(1, 0xA38A66, 0.5); 
      baseCell.drawRect(x, y, cellSize, cellSize);
      baseCell.endFill();
      mapContainer.addChild(baseCell);

      if (showRoofOverlay && otherMap && otherMap[r]?.[c]) {
        let oSym = otherMap[r][c];
        if (state.terrainCache[oSym]) {
          let t = state.terrainCache[oSym];
          let ghost = new PIXI.Graphics();
          ghost.beginFill(t.color.replace('#', '0x'), 0.25); 
          ghost.drawRect(x, y, cellSize, cellSize);
          ghost.endFill();
          mapContainer.addChild(ghost);
        }
      }

      let aSym = activeMap && activeMap[r]?.[c];
      if (aSym && state.terrainCache[aSym]) {
        let t = state.terrainCache[aSym];
        let terrain = new PIXI.Graphics();
        terrain.beginFill(t.color.replace('#', '0x'));
        terrain.lineStyle(1, t.border.replace('#', '0x'), 1, 1); 
        terrain.drawRect(x, y, cellSize, cellSize);
        terrain.endFill();
        mapContainer.addChild(terrain);

        if (cellSize >= 24) {
          let text = new PIXI.Text(aSym, {
            fontFamily: 'Special Elite, monospace',
            fontSize: Math.max(10, cellSize * 0.45),
            fill: t.textColor ? t.textColor.replace('#', '0x') : 0xFFFFFF,
            fontWeight: 'bold'
          });
          text.anchor.set(0.5);
          text.x = x + cellSize / 2;
          text.y = y + cellSize / 2;
          mapContainer.addChild(text);
        }
      }
    }
  }

  if (cellSize >= 10) {
    for (let c = 0; c < cols; c++) {
      if (c === 0 || (c + 1) % 6 === 0) {
        let colStr = "";
        let n = c + 1;
        while (n > 0) {
          let m = (n - 1) % 26;
          colStr = String.fromCharCode(65 + m) + colStr;
          n = Math.floor((n - m) / 26);
        }
        let text = new PIXI.Text(colStr, {
          fontFamily: 'Special Elite, monospace',
          fontSize: Math.max(12, cellSize * 0.35), 
          fill: 0x8B261A, 
          fontWeight: 'bold'
        });
        text.alpha = 0.25; 
        text.anchor.set(0.5, 0);
        text.x = c * cellSize + (cellSize / 2);
        text.y = 2; 
        mapContainer.addChild(text);
      }
    }
    for (let r = 0; r < rows; r++) {
      if (r === 0 || (r + 1) % 6 === 0) {
        let text = new PIXI.Text(String(r + 1), {
          fontFamily: 'Special Elite, monospace',
          fontSize: Math.max(12, cellSize * 0.35), 
          fill: 0x8B261A,
          fontWeight: 'bold'
        });
        text.alpha = 0.25; 
        text.anchor.set(0, 0.5);
        text.x = 2; 
        text.y = r * cellSize + (cellSize / 2);
        mapContainer.addChild(text);
      }
    }
  }
  
  mapContainer.eventMode = 'static';
  mapContainer.on('pointerdown', async (e) => {
      e.stopPropagation(); 
      
      // 🎯 FIX: Use classList.contains() instead of strict equality!
      if (!document.body.classList.contains('mode-play') || selectedUnitIndex === null) return;
      
      const pos = mapContainer.toLocal(e.global);
      const col = Math.floor(pos.x / cellSize);
      const row = Math.floor(pos.y / cellSize);
      const targetCell = coordsToCell(col + 1, row + 1);

      const unit = state.roster[selectedUnitIndex];
      const startCell = unit[11];
      
      if (startCell === targetCell) return; 

      const dist = calculateDistance(startCell, targetCell);
      
      let maxDist = MOVEMENT_DB["run"].inches; 
      const isMounted = unit[21] === true || String(unit[21]).toUpperCase() === 'TRUE';
      const statusStr = String(unit[16] || "").toLowerCase();
      
      if (isMounted) maxDist = MOVEMENT_DB["cantering horse"].inches;
      if (statusStr.includes("leg") || statusStr.includes("chest")) maxDist = MOVEMENT_DB["walk"].inches;
      if (statusStr.includes("belly")) maxDist = MOVEMENT_DB["crawl"].inches;

      const sCoords = cellToCoords(startCell);
      const tCoords = cellToCoords(targetCell);
      const steps = Math.max(Math.abs(sCoords.x - tCoords.x), Math.abs(sCoords.y - tCoords.y));
      
      let isBlocked = false;
      let terrainTax = 0;

      for (let i = 1; i <= steps; i++) {
          let t = i / steps;
          let cx = Math.round(sCoords.x + t * (tCoords.x - sCoords.x));
          let cy = Math.round(sCoords.y + t * (tCoords.y - sCoords.y));
          
          if (cy < 1 || cx < 1 || cy > state.maps.ground.length || cx > state.maps.ground[0].length) {
              isBlocked = true; 
              break;
          }

          let tile = state.maps.ground[cy-1][cx-1];
          if (tile && state.terrainCache[tile]) {
              let tData = state.terrainCache[tile];
              
              if (tData.blocksMove === true || String(tData.blocksMove).toUpperCase() === 'TRUE') {
                  isBlocked = true;
                  break;
              }
              
              if (tData.moveTax) {
                  terrainTax += Number(tData.moveTax);
              }
          }
      }

      if (isBlocked) {
          showToast(`🚫 Move failed! Path blocked by solid terrain.`);
          return;
      }

      if ((dist + terrainTax) > maxDist) {
          showToast(`⚠️ Too far! Max move is ${maxDist}" (Cost: ${dist}" dist + ${terrainTax}" terrain tax)`);
          return;
      }

      let updatedRoster = [...state.roster];
      updatedRoster[selectedUnitIndex][11] = targetCell;
      await set(refs.roster, updatedRoster);
      
      logAction(unit[0], 'MOVED', `Relocated to ${targetCell} (Cost: ${dist + terrainTax}")`);
      
      selectedUnitIndex = null; 
      renderTokens();
  });
  
  app.stage.addChildAt(mapContainer, 0);
  renderTokens();
}

export function renderTokens() {
  if (!app || !state.roster || !Array.isArray(state.roster) || state.roster.length <= 1) return;
  
  let tokenContainer = app.stage.getChildByName('tokens');
  if (tokenContainer) {
    app.stage.removeChild(tokenContainer);
  }
  
  tokenContainer = new PIXI.Container();
  tokenContainer.name = 'tokens';
  
  // 🎯 FIX: Use classList.contains() for the visualizer as well!
  if (selectedUnitIndex !== null && document.body.classList.contains('mode-play')) {
      const unit = state.roster[selectedUnitIndex];
      const startCell = unit[11];
      const elev = unit[23] || "Ground";
      
      if (elev.toLowerCase() === renderLayer.toLowerCase()) {
          const sCoords = cellToCoords(startCell);
          
          let maxDist = MOVEMENT_DB["run"].inches; 
          const isMounted = unit[21] === true || String(unit[21]).toUpperCase() === 'TRUE';
          const statusStr = String(unit[16] || "").toLowerCase();
          
          if (isMounted) maxDist = MOVEMENT_DB["cantering horse"].inches;
          if (statusStr.includes("leg") || statusStr.includes("chest")) maxDist = MOVEMENT_DB["walk"].inches;
          if (statusStr.includes("belly")) maxDist = MOVEMENT_DB["crawl"].inches;

          let highlightGrid = new PIXI.Graphics();
          highlightGrid.eventMode = 'none'; 
          
          const highlightColor = (String(unit[15]).trim().toUpperCase() === "PLAYER") ? 0x2A4B7C : 0x8B261A;
          highlightGrid.beginFill(highlightColor, 0.15); 
          highlightGrid.lineStyle(1, highlightColor, 0.3);

          const maxC = state.maps.ground[0].length;
          const maxR = state.maps.ground.length;

          for (let x = Math.max(1, sCoords.x - maxDist); x <= Math.min(maxC, sCoords.x + maxDist); x++) {
              for (let y = Math.max(1, sCoords.y - maxDist); y <= Math.min(maxR, sCoords.y + maxDist); y++) {
                  const tCell = coordsToCell(x, y);
                  if (tCell === startCell) continue;

                  const dist = calculateDistance(startCell, tCell);
                  if (dist > maxDist) continue; 

                  const steps = Math.max(Math.abs(sCoords.x - x), Math.abs(sCoords.y - y));
                  let isBlocked = false;
                  let terrainTax = 0;
                  
                  for (let i = 1; i <= steps; i++) {
                      let t = i / steps;
                      let cx = Math.round(sCoords.x + t * (x - sCoords.x));
                      let cy = Math.round(sCoords.y + t * (y - sCoords.y));
                      let tile = state.maps.ground[cy-1][cx-1];
                      
                      let tData = state.terrainCache[tile];
                      if (tData) {
                          if (tData.blocksMove === true || String(tData.blocksMove).toUpperCase() === 'TRUE') {
                              isBlocked = true;
                              break;
                          }
                          if (tData.moveTax) {
                              terrainTax += Number(tData.moveTax);
                          }
                      }
                  }

                  if (!isBlocked && (dist + terrainTax) <= maxDist) {
                      highlightGrid.drawRect((x - 1) * cellSize, (y - 1) * cellSize, cellSize, cellSize);
                  }
              }
          }
          highlightGrid.endFill();
          tokenContainer.addChild(highlightGrid);
      }
  }

  for (let i = 1; i < state.roster.length; i++) {
    const row = state.roster[i];
    const hp = Number(row[5]);
    const pos = row[11];
    const control = String(row[15]).trim().toUpperCase();
    const elev = row[23] || "Ground";
    
    if (hp > 0 && pos && elev.toLowerCase() === renderLayer.toLowerCase()) {
      const coords = cellToCoords(pos);
      if (!coords) continue;
      
      const px = (coords.x - 1) * cellSize + (cellSize / 2);
      const py = (coords.y - 1) * cellSize + (cellSize / 2);
      const tokenRadius = (cellSize / 2); 
      
      if (selectedUnitIndex === i) {
          let highlight = new PIXI.Graphics();
          highlight.lineStyle(3, 0xFFD700, 1);
          highlight.drawPolygon([
              px, py - (tokenRadius + 3),
              px + (tokenRadius + 3), py,
              px, py + (tokenRadius + 3),
              px - (tokenRadius + 3), py
          ]);
          tokenContainer.addChild(highlight);
      }
      
      let fillColor = 0x8B261A;   
      let borderColor = 0x5C1911; 
      
      if (control === "PLAYER") {
          fillColor = 0x2A4B7C;   
          borderColor = 0x1A2D4A; 
      } else if (control !== "AI") {
          fillColor = 0xC8972A;   
          borderColor = 0x8B691D; 
      }

      let token = new PIXI.Graphics();
      token.beginFill(fillColor);
      token.lineStyle(2, borderColor, 1, 0); 
      
      token.drawPolygon([
          px, py - tokenRadius,     
          px + tokenRadius, py,     
          px, py + tokenRadius,     
          px - tokenRadius, py      
      ]);
      token.endFill();
      
      token.eventMode = 'static';
      token.cursor = 'pointer';
      
      token.on('pointerdown', async (e) => {
        e.stopPropagation(); 
        
        // 🎯 FIX: Use classList.contains() here as well!
        if (document.body.classList.contains('mode-play')) {
            if (selectedUnitIndex !== null && selectedUnitIndex !== i) {
                const attackerRow = state.roster[selectedUnitIndex];
                const attackerControl = String(attackerRow[15]).trim().toUpperCase();
                
                if (attackerControl === "PLAYER" && control === "AI") {
                    const shooterUnit = { data: attackerRow, index: selectedUnitIndex };
                    const targetUnit = { data: row, index: i };
                    const traits = String(attackerRow[17] || "").toLowerCase();
                    const hasTrait = (t) => traits.includes(t.toLowerCase());

                    await executeCombat(shooterUnit, targetUnit, hasTrait);
                    
                    selectedUnitIndex = null; 
                    renderTokens();
                    return; 
                }
            }
            selectedUnitIndex = i; 
        }
        
        document.getElementById('statName').textContent = row[0];
        document.getElementById('statHP').textContent = `${hp} / ${row[7]}`;
        renderTokens(); 
      });
      
      tokenContainer.addChild(token);
      
      if (cellSize >= 24) {
        const maxHp = Number(row[7]) || 1;
        const hpPercent = Math.max(0, hp / maxHp);
        
        let hpBarBg = new PIXI.Graphics();
        hpBarBg.beginFill(0x000000);
        hpBarBg.drawRect(px - 10, py - tokenRadius - 8, 20, 4);
        hpBarBg.endFill();
        
        let hpBarFill = new PIXI.Graphics();
        hpBarFill.beginFill(0x00FF00); 
        hpBarFill.drawRect(px - 10, py - tokenRadius - 8, 20 * hpPercent, 4);
        hpBarFill.endFill();
        
        tokenContainer.addChild(hpBarBg);
        tokenContainer.addChild(hpBarFill);
      }
    }
  }
  
  app.stage.addChild(tokenContainer);
}