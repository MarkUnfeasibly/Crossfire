import { state } from './state.js';

// ==========================================
// GRID GEOMETRY & UTILITIES
// ==========================================

export function cellToCoords(cellString) {
  if (!cellString) return null;
  const str = cellString.toString().toUpperCase();
  const matchAlpha = str.match(/[A-Z]+/);
  const matchNum = str.match(/\d+/);
  if (!matchAlpha || !matchNum) return null;
  const m = matchAlpha[0];
  const r = parseInt(matchNum[0]);
  let x = 0;
  for (let i = 0; i < m.length; i++) x = x * 26 + m.charCodeAt(i) - 64;
  return { x: x, y: r }; // Returns 1-indexed coordinates (A1 = x:1, y:1)
}

export function coordsToCell(x, y) {
  let c = "";
  let tempX = x;
  while(tempX > 0) {
    let m = (tempX - 1) % 26;
    c = String.fromCharCode(65 + m) + c;
    tempX = Math.floor((tempX - m) / 26);
  }
  return c + y;
}

export function calculateDistance(c1, c2) {
  if (!c1 || !c2) return 999;
  let p1 = cellToCoords(c1);
  let p2 = cellToCoords(c2);
  let dx = Math.abs(p1.x - p2.x);
  let dy = Math.abs(p1.y - p2.y);
  // Accurate tabletop diagonal measurement (1 for straight, 1.5 for diagonal rounded down)
  return Math.abs(dx - dy) + Math.floor(Math.min(dx, dy) * 1.5);
}

export function getRangeCategory(dist) {
  if (dist <= 1) return "pb";
  if (dist <= 10) return "short";
  if (dist <= 20) return "medium";
  if (dist <= 50) return "long";
  return "extreme";
}

// ==========================================
// LINE OF SIGHT (LOS) & COVER RAYCASTER
// ==========================================

export function checkLOSAndCover(pos1, elev1, pos2, elev2, targetIsMounted = false) {
  const p1 = cellToCoords(pos1);
  const p2 = cellToCoords(pos2);
  let mod = 0;
  let blocked = false;
  
  const steps = Math.max(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y));
  let diffElev = (elev1 !== elev2);
  if (steps === 0) return { mod: 0, blocked: false };
  
  let lastCoverPos = {}; 
  let w4Hits = 0; // Prevent infinite roof edge stacking
  let prevX = p1.x, prevY = p1.y;

  const processCell = (cx, cy) => {
    if (blocked) return;
    if (cy < 1 || cx < 1 || !state.maps.ground || cy > state.maps.ground.length || cx > state.maps.ground[0].length) return;
    
    let currCell = coordsToCell(cx, cy);
    let vG = (state.maps.ground[cy-1] && state.maps.ground[cy-1][cx-1] !== undefined && state.maps.ground[cy-1][cx-1] !== null) ? state.maps.ground[cy-1][cx-1].toString().trim().toUpperCase() : "";
    let vR = (state.maps.roof && state.maps.roof[cy-1] && state.maps.roof[cy-1][cx-1] !== undefined && state.maps.roof[cy-1][cx-1] !== null) ? state.maps.roof[cy-1][cx-1].toString().trim().toUpperCase() : "";
    
    // Ceiling check (Cannot shoot through solid roofs if elevations differ)
    if (diffElev && vR === 'W3') { blocked = true; return; }
  
    let aVal = (elev1 === "Roof" && !diffElev) ? vR : vG; 
    let tData = state.terrainCache[aVal];
    
    if (tData) { 
      // Boolean check: Does this terrain hard block LOS?
      if (tData.blocksLOS === true || String(tData.blocksLOS).trim().toUpperCase() === 'TRUE') { 
        blocked = true; 
        return; 
      } 
      
      let losMod = Number(tData.losMod) || 0;
      if (losMod !== 0) {
          // 3D Physics Check: Altitude Clearance
          if (diffElev) {
              if (elev1 === "Roof") {
                  // Shooter is high. Ignore ground cover near the shooter, only count cover physically close to the target.
                  let distToTarget = calculateDistance(currCell, pos2);
                  if (distToTarget > 2) return; 
              } else if (elev2 === "Roof") {
                  // Shooter is low. Ground cover doesn't protect a roof target.
                  return; 
              }
          }
          
          if (targetIsMounted && aVal === 'F') return; // Fences don't obscure mounted riders
          
          let distSinceLast = 999;
          if (lastCoverPos[aVal]) distSinceLast = calculateDistance(currCell, lastCoverPos[aVal]);
          let threshold = (aVal === 'G') ? 6 : 2; // Forest clusters vs. solid objects
  
          if (distSinceLast >= threshold) {
            if (aVal === 'W4') {
                if (w4Hits >= 2) return; 
                w4Hits++;
            }
            mod += losMod;
            lastCoverPos[aVal] = currCell; 
          }
      }
    }
  };

  // 1. Draw the primary line of sight using Bresenham's line algorithm
  for (let i = 1; i <= steps; i++) {
    let t = i / steps;
    let cx = Math.round(p1.x + t * (p2.x - p1.x));
    let cy = Math.round(p1.y + t * (p2.y - p1.y));
    
    // Anti-clipping: Check adjacent tiles when moving diagonally
    if (cx !== prevX && cy !== prevY) {
        processCell(prevX, cy);
        processCell(cx, prevY);
    }
    
    processCell(cx, cy);
    
    prevX = cx;
    prevY = cy;
    if (blocked) break;
  }

  // 2. Evaluate Roof Edges (W4) for the defender
  if (!blocked && diffElev && elev2 === "Roof") {
     let tgtR = (state.maps.roof && state.maps.roof[p2.y-1] && state.maps.roof[p2.y-1][p2.x-1] !== undefined) ? state.maps.roof[p2.y-1][p2.x-1].toString().trim().toUpperCase() : "";
     if (tgtR === 'W4') {
       let w4Data = state.terrainCache['W4'];
       mod += (w4Data ? (Number(w4Data.losMod) || 0) : 0); 
     }
  }
  return { mod: mod, blocked: blocked };
}