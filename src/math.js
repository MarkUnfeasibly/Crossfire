import { state } from './state.js';

export function cellToCoords(c) {
  let str = c.toString().toUpperCase();
  let m = str.match(/[A-Z]+/)[0];
  let r = parseInt(str.match(/\d+/)[0]);
  let x = 0;
  for(let i=0; i<m.length; i++) x = x * 26 + m.charCodeAt(i) - 64;
  return {x:x, y:r};
}

export function coordsToCell(x, y) {
  let c="";
  while(x>0) { let m=(x-1)%26; c=String.fromCharCode(65+m)+c; x=Math.floor((x-m)/26); }
  return c+y;
}

export function calculateDistance(c1, c2) {
  let p1=cellToCoords(c1), p2=cellToCoords(c2);
  let dx=Math.abs(p1.x-p2.x), dy=Math.abs(p1.y-p2.y);
  return Math.abs(dx-dy)+Math.floor(Math.min(dx,dy)*1.5);
}

export function getRangeCategory(d) {
  if(d<=1) return "pb";
  if(d<=10) return "short";
  if(d<=20) return "medium";
  if(d<=50) return "long";
  return "extreme";
}

export function checkLOSAndCover(pos1, elev1, pos2, elev2, targetIsMounted = false) {
  const p1 = cellToCoords(pos1), p2 = cellToCoords(pos2);
  let mod = 0, blocked = false;
  const steps = Math.max(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y));
  let diffElev = (elev1 !== elev2);
  if (steps === 0) return {mod:0, blocked:false};
  
  let lastCoverPos = {}, w4Hits = 0;
  let prevX = p1.x, prevY = p1.y;

  const processCell = (cx, cy) => {
      if (blocked) return;
      if (cy < 1 || cx < 1 || !state.maps.ground || cy > state.maps.ground.length || cx > state.maps.ground[0].length) return;
      
      let currCell = coordsToCell(cx, cy);
      let vG = state.maps.ground[cy-1]?.[cx-1]?.toString().trim().toUpperCase() || "";
      let vR = state.maps.roof[cy-1]?.[cx-1]?.toString().trim().toUpperCase() || "";
      
      if (diffElev && vR === 'W3') { blocked = true; return; }
    
      let aVal = (elev1 === "Roof" && !diffElev) ? vR : vG; 
      let tData = state.terrainCache[aVal];
      
      if (tData) { 
        if (tData.blocksLOS) { blocked = true; return; } 
        if (tData.losMod !== 0 && tData.losMod !== undefined) {
            if (diffElev) {
                if (elev1 === "Roof" && calculateDistance(currCell, pos2) > 2) return;
                else if (elev2 === "Roof") return; 
            }
            if (targetIsMounted && aVal === 'F') return; 
            
            let distSinceLast = lastCoverPos[aVal] ? calculateDistance(currCell, lastCoverPos[aVal]) : 999;
            let threshold = (aVal === 'G') ? 6 : 2; 
    
            if (distSinceLast >= threshold) {
              if (aVal === 'W4') { if (w4Hits >= 2) return; w4Hits++; }
              mod += tData.losMod;
              lastCoverPos[aVal] = currCell; 
            }
        }
      }
  };

  for (let i = 1; i <= steps; i++) {
    let t = i / steps;
    let cx = Math.round(p1.x + t * (p2.x - p1.x)), cy = Math.round(p1.y + t * (p2.y - p1.y));
    if (cx !== prevX && cy !== prevY) { processCell(prevX, cy); processCell(cx, prevY); }
    processCell(cx, cy);
    prevX = cx; prevY = cy;
    if (blocked) break;
  }
  return {mod, blocked};
}

export function isPathBlocked(pos1, pos2, unitData) {
  // Adaptation of V8.3 isPathBlocked using state.maps and state.terrainCache
  const p1 = cellToCoords(pos1), p2 = cellToCoords(pos2);
  const steps = Math.max(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y));
  let fenceCost = 0, riskCount = 0; 
  let elev = unitData[23] || "Ground"; 
  let activeMap = (elev === "Roof" && state.maps.roof) ? state.maps.roof : state.maps.ground;
  let isMounted = unitData[21] === true || unitData[21] === 'TRUE'; 
  let myFaction = unitData[15]; 
  
  for (let i = 1; i <= steps; i++) {
    let t = i / steps;
    let cx = Math.round(p1.x + t * (p2.x - p1.x)), cy = Math.round(p1.y + t * (p2.y - p1.y));
    let currCell = coordsToCell(cx, cy);
    
    if (currCell !== pos1 && state.maps.occupied.has(currCell + "_" + elev)) {
        if (state.maps.occupied.get(currCell + "_" + elev) !== myFaction) return { blocked: true, reason: "Enemy" };
    }
  
    let val = activeMap[cy-1]?.[cx-1]?.toString().trim().toUpperCase() || "";
    let tData = state.terrainCache[val];
    if (tData) {
      if (isMounted && val === 'D') return { blocked: true, reason: "Doors" };
      if (tData.blocksMove) return { blocked: true, reason: tData.name };
      if (tData.abilityRoll) riskCount++;
      if (tData.moveTax) fenceCost += tData.moveTax;
    }
  }
  return { blocked: false, cost: fenceCost, risk: riskCount }; 
}

export function getVehicleFootprint(startCell) {
    let footprint = new Set();
    let startCoords = cellToCoords(startCell);
    let q = [startCoords];
    footprint.add(startCell);
    
    const validTiles = ['V0', 'V1', 'V2', 'V3'];
    
    while (q.length > 0) {
        let curr = q.shift();
        let dirs = [{dx:0,dy:-1}, {dx:0,dy:1}, {dx:-1,dy:0}, {dx:1,dy:0}];
        for (let d of dirs) {
            let nx = curr.x + d.dx, ny = curr.y + d.dy;
            if (nx < 1 || nx > state.maps.ground[0].length || ny < 1 || ny > state.maps.ground.length) continue;
            
            let nVal = state.maps.ground[ny-1][nx-1]?.toString().trim().toUpperCase() || "";
            if (validTiles.includes(nVal)) {
                let nCell = coordsToCell(nx, ny);
                if (!footprint.has(nCell)) {
                    footprint.add(nCell);
                    q.push({x: nx, y: ny});
                }
            }
        }
    }
    return Array.from(footprint);
}