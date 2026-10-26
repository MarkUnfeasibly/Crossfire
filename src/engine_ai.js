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
            if (distToLoot <= 1 && elev === "Ground") return { name: 'GRAB_LOOT', reason: 'Adjacent to Vault!' };
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

    // 🎯 NEW: Move & Shoot Sequencing
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
            
            // If blocked, or target is farther than 15 inches, move closer first!
            if (startLOS.blocked || dist > 15) {
                shootFirst = false;
                let maxDist = 12;
                if (String(unit.data[21]).toUpperCase() === 'TRUE') maxDist = 18;
                if (String(unit.data[16] || "").toLowerCase().includes("leg")) maxDist = 6;
                
                // Advance! Stop adjacent to the target (true flag)
                let endPos = await commitMovement(unit, tPos, maxDist, true); 
                distanceMoved = calculateDistance(currentPos, endPos);
                
                // Update local memory so combat calculates from the NEW position
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
            await commitMovement(unit, targetPos, 12);
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
        await commitMovement(unit, "A1", 12); 
    }
}

async function commitMovement(unit, destCell, budget, stopAdjacent = false) {
    let startCell = unit.data[11];
    let startCoords = cellToCoords(startCell);
    let destCoords = cellToCoords(destCell);
    
    let steps = Math.max(Math.abs(startCoords.x - destCoords.x), Math.abs(startCoords.y - destCoords.y));
    let finalCell = startCell;
    let cost = 0;

    for (let i = 1; i <= steps; i++) {
        let t = i / steps;
        let cx = Math.round(startCoords.x + t * (destCoords.x - startCoords.x));
        let cy = Math.round(startCoords.y + t * (destCoords.y - startCoords.y));
        
        if (cy < 1 || cx < 1 || cy > state.maps.ground.length || cx > state.maps.ground[0].length) break;
        
        let checkCell = coordsToCell(cx, cy);
        let tile = state.maps.ground[cy-1][cx-1];
        
        // 🎯 NEW: Stop one tile short if we are attacking someone
        if (stopAdjacent && checkCell === destCell) break;
        
        if (tile && state.terrainCache[tile] && state.terrainCache[tile].blocksMove) break;
        
        let isDiag = (Math.abs(cx - cellToCoords(finalCell).x) === 1 && Math.abs(cy - cellToCoords(finalCell).y) === 1);
        cost += isDiag ? 1.5 : 1;
        
        if (cost > budget) break;
        finalCell = checkCell;
    }

    if (finalCell !== startCell) {
        let updatedRoster = [...state.roster];
        updatedRoster[unit.index][11] = finalCell;
        
        // Ensure local memory is updated for subsequent actions
        unit.data[11] = finalCell;
        
        await set(refs.roster, updatedRoster);
        logAction(unit.data[0], 'MOVED', `Advanced to ${finalCell}`);
        
        window.EngineDiagnostics.moveEnd = finalCell;
        window.EngineDiagnostics.moveDist = Math.floor(cost);
    }
    
    return finalCell;
}