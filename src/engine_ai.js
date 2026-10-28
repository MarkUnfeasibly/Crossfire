import { state } from './state.js';
import { refs } from './firebase.js';
import { set } from 'firebase/database';
import { calculateDistance, checkLOSAndCover, cellToCoords, coordsToCell } from './engine_math.js';
import { executeCombat, getWeaponStats } from './engine_combat.js';
import { logAction, showToast } from './ui.js';

export function determineState(unit, players, tokens, hasTrait) {
    let pos = unit.data[11];
    let status = String(unit.data[16] || "").toLowerCase();
    let elev = unit.data[23] || "Ground";
    
    let activeWpn = unit.data[8] || "Unarmed";
    let loaded = Number(unit.data[9]) || 0;
    let reserve = Number(unit.data[10]) || 0;
    let isJammed = status.includes("jammed");

    if ((isJammed || loaded <= 0) && reserve <= 0) {
        let closest = null, minDist = 999;
        players.forEach(p => {
            let d = calculateDistance(pos, p.data[11]);
            if (d < minDist) { minDist = d; closest = p; }
        });
        if (closest) return { name: 'CHARGE', target: closest, reason: 'Out of Ammo/Jammed! Banzai!' };
    }

    if (loaded <= 0 && reserve > 0 && !isJammed) return { name: 'RELOADING', reason: 'Ammo empty' };
    if (status.includes("belly")) return { name: 'CRIPPLED', reason: 'Critical stomach wound' };

    let adjacentPlayers = [];
    let validTargets = [];
    let dashTargets = [];

    players.forEach(p => {
        let pPos = p.data[11];
        let pElev = p.data[23] || "Ground";
        let dist = calculateDistance(pos, pPos);
        
        if (dist <= 1.5 && elev === pElev) adjacentPlayers.push(p);

        let losResult = checkLOSAndCover(pos, elev, pPos, pElev, false);
        if (!losResult.blocked) {
            let threatScore = dist - (losResult.mod * 3);
            let wpnStats = getWeaponStats(activeWpn);
            
            if (dist > 20 && wpnStats.isSidearm) dashTargets.push({ targetInfo: p, threat: threatScore });
            else validTargets.push({ targetInfo: p, threat: threatScore });
        }
    });

    if (hasTrait("Robber")) {
        if (status.includes("has loot")) {
            if (adjacentPlayers.length > 0) return { name: 'MELEE_LOCKED', target: adjacentPlayers[0], reason: 'In Zone of Control' };
            return { name: 'ESCAPE', reason: 'Fleeing to edge!' };
        } else if (tokens && tokens.loot) {
            let distToLoot = calculateDistance(pos, tokens.loot);
            if (distToLoot <= 1.5 && elev === "Ground") return { name: 'GRAB_LOOT', reason: 'Adjacent to Vault!' };
            if (adjacentPlayers.length > 0) return { name: 'MELEE_LOCKED', target: adjacentPlayers[0] };
            if (validTargets.length > 0) {
                validTargets.sort((a, b) => a.threat - b.threat);
                return { name: 'COMBAT', target: validTargets[0].targetInfo, reason: 'Covering fire while advancing' };
            }
            return { name: 'HEIST_MOVE', reason: 'Advancing on Vault' };
        }
    }

    if (adjacentPlayers.length > 0) return { name: 'MELEE_LOCKED', target: adjacentPlayers[0], reason: 'In Zone of Control' };

    if (validTargets.length > 0) {
        validTargets.sort((a, b) => a.threat - b.threat);
        return { name: 'COMBAT', target: validTargets[0].targetInfo, reason: `Engaging closest threat` };
    }

    if (dashTargets.length > 0) {
        dashTargets.sort((a, b) => a.threat - b.threat);
        return { name: 'DASH', target: dashTargets[0].targetInfo, reason: `Target out of range, closing gap` };
    }

    return { name: 'HUNT', target: null, reason: 'Holding position, no visual on threats.' };
}

export async function processAITurn(unit) {
    window.EngineDiagnostics = {
        unitName: unit.data[0],
        traitProfile: unit.data[17] || "None",
        stateEngine: "CALCULATING...",
        moveStart: unit.data[11],
        moveEnd: unit.data[11],
        moveDist: 0,
        combatTarget: "N/A",
        combatMath: "N/A",
        combatResult: "N/A",
        combatDamage: "N/A"
    };
    
    const statusStr = String(unit.data[16] || "").toLowerCase();
    if (Number(unit.data[5]) <= 0 || statusStr.includes("dead") || statusStr.includes("kia")) {
        window.EngineDiagnostics.stateEngine = "DEAD (Terminating Turn)";
        return;
    }

    const traits = String(unit.data[17] || "");
    const hasTrait = (t) => traits.toLowerCase().includes(t.toLowerCase());

    const players = state.roster.slice(1).map((r, i) => ({ data: r, index: i + 1 }))
        .filter(p => String(p.data[15]).trim().toLowerCase() === "player" && Number(p.data[5]) > 0);

    let tokens = { loot: null, vip: null, extract: null };
    const ground = state.maps.ground;
    for(let r=0; r<ground.length; r++) {
        for(let c=0; c<ground[r].length; c++){
            if(ground[r][c] === '$') tokens.loot = coordsToCell(c+1, r+1);
            if(ground[r][c] === '?') tokens.vip = coordsToCell(c+1, r+1);
            if(ground[r][c] === '*') tokens.extract = coordsToCell(c+1, r+1);
        }
    }

    let aiState = determineState(unit, players, tokens, hasTrait);
    window.EngineDiagnostics.stateEngine = `${aiState.name} (${aiState.reason})`;

    if (aiState.name === 'COMBAT' || aiState.name === 'MELEE_LOCKED') {
        let shootFirst = true;
        let distanceMoved = 0;
        let currentPos = unit.data[11];
        
        if (aiState.name === 'COMBAT') {
            let tPos = aiState.target.data[11];
            let dist = calculateDistance(currentPos, tPos);
            let elev = unit.data[23] || "Ground";
            let tElev = aiState.target.data[23] || "Ground";
            let startLOS = checkLOSAndCover(currentPos, elev, tPos, tElev, false);
            
            if (startLOS.blocked || dist > 15) {
                shootFirst = false;
                let maxDist = 12;
                if (String(unit.data[21]).toUpperCase() === 'TRUE') maxDist = 18;
                if (String(unit.data[16] || "").toLowerCase().includes("leg")) maxDist = 6;
                
                let endPos = await commitMovement(unit, tPos, maxDist, true); 
                distanceMoved = calculateDistance(currentPos, endPos);
                unit.data[11] = endPos; 
            }
        }

        if (shootFirst) {
            await executeCombat(unit, aiState.target, hasTrait, 0);
        } else {
            await executeCombat(unit, aiState.target, hasTrait, distanceMoved);
        }
    } 
    else if (aiState.name === 'RELOADING') {
        let reserve = Number(unit.data[10]);
        let reloadAmt = Math.min(6, reserve);
        let updatedRoster = [...state.roster];
        updatedRoster[unit.index][9] = reloadAmt;
        updatedRoster[unit.index][10] = reserve - reloadAmt;
        await set(refs.roster, updatedRoster);
        logAction(unit.data[0], `RELOADED`, `Loaded ${reloadAmt} rounds.`);
    }
    else if (aiState.name === 'HEIST_MOVE' || aiState.name === 'DASH') {
        let targetPos = aiState.target ? aiState.target.data[11] : tokens.loot;
        if (targetPos) {
            let maxDist = 12;
            if (String(unit.data[16] || "").toLowerCase().includes("leg")) maxDist = 6;
            
            // 🎯 NEW: Find an adjacent tile to the loot so we don't try to stand ON the vault
            let bestTarget = targetPos;
            if (aiState.name === 'HEIST_MOVE') {
                let lootCoords = cellToCoords(targetPos);
                let closestDist = 999;
                let dirs = [{dx:0,dy:-1}, {dx:0,dy:1}, {dx:-1,dy:0}, {dx:1,dy:0}];
                
                for (let d of dirs) {
                    let nx = lootCoords.x + d.dx, ny = lootCoords.y + d.dy;
                    if (nx < 1 || nx > state.maps.ground[0].length || ny < 1 || ny > state.maps.ground.length) continue;
                    let checkCell = coordsToCell(nx, ny);
                    
                    let tile = state.maps.ground[ny-1][nx-1];
                    let tData = state.terrainCache[tile];
                    if (!tData || (tData.blocksMove === false || String(tData.blocksMove).toUpperCase() === 'FALSE')) {
                        let distToMe = calculateDistance(unit.data[11], checkCell);
                        if (distToMe < closestDist) { closestDist = distToMe; bestTarget = checkCell; }
                    }
                }
            }
            
            await commitMovement(unit, bestTarget, maxDist, false);
        }
    }
    else if (aiState.name === 'GRAB_LOOT') {
        let updatedRoster = [...state.roster];
        updatedRoster[unit.index][16] = statusStr ? statusStr + ", Has Loot" : "Has Loot";
        await set(refs.roster, updatedRoster);
        
        let c = cellToCoords(tokens.loot);
        let updatedMap = [...state.maps.ground];
        updatedMap[c.y-1][c.x-1] = ""; 
        await set(refs.groundMap, updatedMap);
        
        showToast(`💰 ${unit.data[0]} grabbed the Loot!`);
        logAction(unit.data[0], `OBJECTIVE`, `Grabbed the vault loot!`);
    }
    else if (aiState.name === 'ESCAPE') {
        await commitMovement(unit, "A1", 12, false); 
    }
}

// 🎯 NEW: A* Pathfinder Algorithm (Ported from Google Sheets)
function aStarPathfinder(start, dest, budget) {
    if (start === dest) return { cell: start, cost: 0, tax: 0 };
    
    let sC = cellToCoords(start), dC = cellToCoords(dest);
    let openList = [{x: sC.x, y: sC.y, g: 0, tax: 0, h: Math.abs(sC.x - dC.x) + Math.abs(sC.y - dC.y), path: [start]}];
    let closed = new Set();
    
    let bestFallback = { cell: start, distToTarget: calculateDistance(start, dest), g: 0, tax: 0, path: [start] };
    let maxC = state.maps.ground[0].length, maxR = state.maps.ground.length;
    
    while(openList.length > 0) {
        openList.sort((a,b) => (a.g + a.h) - (b.g + b.h));
        let curr = openList.shift();
        let cKey = curr.x + "," + curr.y;
        
        if (closed.has(cKey)) continue;
        closed.add(cKey);
        
        let currCell = coordsToCell(curr.x, curr.y);
        let currDistToTarget = calculateDistance(currCell, dest);
        
        if (currDistToTarget < bestFallback.distToTarget && curr.g <= budget) {
           bestFallback = { cell: currCell, distToTarget: currDistToTarget, g: curr.g, tax: curr.tax, path: curr.path };
        }
        
        if (curr.x === dC.x && curr.y === dC.y) {
           let traverseCost = 0; let taxAccum = 0; let finalCell = start;
           
           for (let i = 1; i < curr.path.length; i++) {
              let stepCell = curr.path[i];
              let p1 = cellToCoords(curr.path[i-1]), p2 = cellToCoords(stepCell);
              
              let tile = state.maps.ground[p2.y-1][p2.x-1];
              let moveTax = 0;
              if (tile && state.terrainCache[tile] && state.terrainCache[tile].moveTax) {
                  moveTax = Number(state.terrainCache[tile].moveTax);
              }
              
              let isDiag = (Math.abs(p1.x - p2.x) === 1 && Math.abs(p1.y - p2.y) === 1);
              let sCost = (isDiag ? 1.5 : 1) + moveTax;
              
              if (traverseCost + sCost > budget) break;
              traverseCost += sCost; taxAccum += moveTax; finalCell = stepCell;
           }
           
           return { cell: finalCell, cost: Math.floor(traverseCost), tax: taxAccum };
        }
      
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            let nx = curr.x + dx, ny = curr.y + dy;
            if (nx < 1 || nx > maxC || ny < 1 || ny > maxR) continue;
            
            let nCell = coordsToCell(nx, ny);
            
            // Check if cell is blocked
            let tile = state.maps.ground[ny-1][nx-1];
            let tData = state.terrainCache[tile];
            let isBlocked = false;
            let moveTax = 0;
            
            if (tData) {
                if (tData.blocksMove === true || String(tData.blocksMove).toUpperCase() === 'TRUE') isBlocked = true;
                if (tData.moveTax) moveTax = Number(tData.moveTax);
            }
            
            // Anti-Clipping: Don't allow diagonal movement if either corner is blocked
            if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
                let c1Tile = state.maps.ground[curr.y-1][nx-1];
                let c2Tile = state.maps.ground[ny-1][curr.x-1];
                let c1Blocks = state.terrainCache[c1Tile]?.blocksMove;
                let c2Blocks = state.terrainCache[c2Tile]?.blocksMove;
                
                if (c1Blocks || c2Blocks) isBlocked = true;
            }
            
            if (isBlocked) continue;
            
            let isDiagonal = (Math.abs(dx) === 1 && Math.abs(dy) === 1);
            let stepCost = (isDiagonal ? 1.5 : 1) + moveTax;
            
            let physG = curr.g + stepCost;
            if (physG > budget && (nx !== dC.x || ny !== dC.y)) continue; 
            
            let h = Math.abs(nx - dC.x) + Math.abs(ny - dC.y); 
            let newPath = curr.path.slice(); newPath.push(nCell);
            
            openList.push({x: nx, y: ny, g: physG, tax: curr.tax + moveTax, h: h, path: newPath});
          }
        }
    }
    
    return { cell: bestFallback.cell, cost: Math.floor(bestFallback.g), tax: bestFallback.tax };
}

// 🎯 UPGRADED: Commit movement now routes through the Pathfinder!
async function commitMovement(unit, destCell, budget, stopAdjacent = false) {
    let startCell = unit.data[11];
    
    // Safety fallback - if stopping adjacent and already next to it, don't move
    if (stopAdjacent && calculateDistance(startCell, destCell) <= 1.5) {
        return startCell;
    }

    // Call the A* Pathfinder to map around walls
    let pathResult = aStarPathfinder(startCell, destCell, budget);
    let finalCell = pathResult.cell;

    if (finalCell !== startCell) {
        let updatedRoster = [...state.roster];
        updatedRoster[unit.index][11] = finalCell;
        
        unit.data[11] = finalCell;
        
        await set(refs.roster, updatedRoster);
        logAction(unit.data[0], 'MOVED', `Navigated to ${finalCell} (Cost: ${pathResult.cost}")`);
        
        window.EngineDiagnostics.moveEnd = finalCell;
        window.EngineDiagnostics.moveDist = pathResult.cost;
    }
    
    return finalCell;
}