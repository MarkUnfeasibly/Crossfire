import { state } from './state.js';
import { refs } from './firebase.js';
import { set } from 'firebase/database';
import { calculateDistance, checkLOSAndCover, getRangeCategory, coordsToCell, cellToCoords } from './engine_math.js';
import { logAction, showToast, writeTelemetry } from './ui.js';

// ==========================================
// 1. WEAPON & DAMAGE LOOKUPS
// ==========================================

export function getWeaponStats(wpnName) {
  const wpn = String(wpnName || "").trim().toLowerCase();
  
  // Standard fallback stats if not found in a future Weapons DB
  const defaultStats = { pb: 0, short: 0, medium: 0, long: 0, extreme: 0, cap: 6, isShoulder: false, isSidearm: true };
  
  // Hardcoded standard profiles based on Quickdraw rules
  if (wpn.includes("rifle") || wpn.includes("winchester")) {
      return { pb: 2, short: 4, medium: 2, long: 0, extreme: -2, cap: 15, isShoulder: true, isSidearm: false };
  } else if (wpn.includes("shotgun")) {
      return { pb: 6, short: 2, medium: -4, long: -8, extreme: -12, cap: 2, isShoulder: true, isSidearm: false };
  } else if (wpn.includes("thompson") || wpn.includes("smg")) {
      return { pb: 4, short: 2, medium: 0, long: -4, extreme: -8, cap: 30, isShoulder: true, isSidearm: false };
  } else {
      return { pb: 4, short: 2, medium: -2, long: -6, extreme: -10, cap: 6, isShoulder: false, isSidearm: true }; // Revolver default
  }
}

export function resolveDamage(isRuthless, hasTrait) {
  let roll = Math.floor(Math.random() * 20) + 1;
  let loc = "TORSO", dmg = 1, audit = "Standard hit";

  if (hasTrait && hasTrait("Marksman")) {
      let mRoll = Math.floor(Math.random() * 6) + 1;
      if (mRoll <= 2) { loc = "HEAD"; dmg = (Math.floor(Math.random() * 6) + 1) + 3; }
      else if (mRoll <= 4) { loc = "CHEST"; dmg = (Math.floor(Math.random() * 6) + 1) + 1; }
      else { loc = "BELLY"; dmg = (Math.floor(Math.random() * 6) + 1); }
      return { loc, dmg, audit: "Marksman Bonus" };
  }

  // Standard D20 Locational Lookup
  if (roll <= 2) { loc = "GRAZE"; dmg = 1; audit = "D1"; }
  else if (roll <= 6) { loc = "RIGHT ARM"; dmg = Math.floor(Math.random() * 4) + 1; audit = "D4"; }
  else if (roll <= 10) { loc = "LEFT ARM"; dmg = Math.floor(Math.random() * 4) + 1; audit = "D4"; }
  else if (roll <= 13) { loc = "RIGHT LEG"; dmg = Math.floor(Math.random() * 6) + 1; audit = "D6"; }
  else if (roll <= 16) { loc = "LEFT LEG"; dmg = Math.floor(Math.random() * 6) + 1; audit = "D6"; }
  else if (roll <= 18) { loc = "BELLY"; dmg = Math.floor(Math.random() * 8) + 1; audit = "D8"; }
  else if (roll === 19) { loc = "CHEST"; dmg = Math.floor(Math.random() * 10) + 1; audit = "D10"; }
  else { loc = "HEAD"; dmg = isRuthless ? "DEAD" : (Math.floor(Math.random() * 12) + 1); audit = isRuthless ? "Ruthless" : "D12"; }

  return { loc, dmg, audit };
}

// ==========================================
// 2. HEALTH & STATUS MANAGEMENT
// ==========================================

export async function applyWound(targetUnit, damageObj) {
  let updatedRoster = [...state.roster];
  let uIndex = targetUnit.index;
  let row = updatedRoster[uIndex];

  let currentHP = Number(row[5]);
  let dmgAmount = (typeof damageObj.dmg === 'number') ? damageObj.dmg : 999;
  let newHP = Math.max(0, currentHP - dmgAmount);
  
  row[5] = newHP; // Update HP

  if (newHP <= 0) {
      row[16] = "KIA"; // Status
      if (String(row[17]).includes("VIP")) {
          showToast(`💀 ASSASSINATION SUCCESSFUL! The VIP ${row[0]} has been killed!`);
      }
      logAction(row[0], `KILLED IN ACTION`, `Fatal blow: ${damageObj.loc}`);
  } else {
      let currentStatus = String(row[16] || "");
      if (currentStatus && !currentStatus.includes(damageObj.loc)) {
          row[16] = currentStatus + ", " + damageObj.loc;
      } else if (!currentStatus) {
          row[16] = damageObj.loc;
      }
  }

  // Push to Firebase instantly
  await set(refs.roster, updatedRoster);
}

// ==========================================
// 3. COMBAT EXECUTION (VOLLEYS)
// ==========================================

export async function executeCombat(shooterUnit, targetUnit, hasTrait, moraleBonus = 0, pinnedPenalty = 0) {
    const sName = shooterUnit.data[0];
    const sPos = shooterUnit.data[11];
    const sElev = shooterUnit.data[23] || "Ground";
    
    const tPos = targetUnit.data[11];
    const tElev = targetUnit.data[23] || "Ground";
    const targetIsMounted = (targetUnit.data[21] === true || String(targetUnit.data[21]).toUpperCase() === 'TRUE');

    const activeWpn = shooterUnit.data[8] || "Colt .45";
    const loadedAmmo = Number(shooterUnit.data[9]) || 6;
    
    if (loadedAmmo <= 0) {
        logAction(sName, `CLICK!`, `Out of ammo attempting to shoot ${targetUnit.data[0]}`);
        return;
    }

    const stats = getWeaponStats(activeWpn);
    const skill = stats.isShoulder ? Number(shooterUnit.data[1]) : Number(shooterUnit.data[2]); // S-Sk vs H-Sk

    // Calculate Environment Modifiers
    let dist = calculateDistance(sPos, tPos);
    let tactical = checkLOSAndCover(sPos, sElev, tPos, tElev, targetIsMounted);
    
    if (tactical.blocked) {
        logAction(sName, `BLOCKED SHOT`, `Target ${targetUnit.data[0]} obscured behind solid cover.`);
        return;
    }

    // Status Penalties
    let sStatus = String(shooterUnit.data[16] || "").toLowerCase();
    let aimPen = 0;
    if (sStatus.includes("head") && !hasTrait("Drunk")) aimPen += 5;
    if (sStatus.includes("dazed")) aimPen += 3;
    if (sStatus.includes("right arm")) aimPen += hasTrait("Marksman") ? 2 : 5;

    // Movement Penalties (Simplified for now: assumes stationary shooter +2)
    let shooterMovementMod = +2; 
    let targetMovementMod = targetIsMounted ? +2 : 0;

    let rngCat = getRangeCategory(dist);
    let rangeMod = stats[rngCat] || 0;

    // The Master Target Number Formula
    let targetNum = (skill + rangeMod + tactical.mod + shooterMovementMod + targetMovementMod + moraleBonus) - aimPen - pinnedPenalty;
    
    // Roll the D20
    let roll = Math.floor(Math.random() * 20) + 1;
    let mathAudit = `TN:${targetNum} (Roll:${roll} | Sk:${skill} Rng:${rangeMod} Cov:${tactical.mod} Mov:+2 Wounds:-${aimPen})`;

    if (roll === 20) {
        // Weapon Jam
        let updatedRoster = [...state.roster];
        let curStatus = String(updatedRoster[shooterUnit.index][16] || "");
        updatedRoster[shooterUnit.index][16] = curStatus ? curStatus + ", Jammed Weapon" : "Jammed Weapon";
        await set(refs.roster, updatedRoster);
        logAction(sName, `WEAPON JAMMED!`, mathAudit);
        
    } else if (roll <= targetNum || roll === 1) { 
        // HIT!
        let dmgResult = resolveDamage(Number(shooterUnit.data[4]) <= 10, hasTrait); 
        await applyWound(targetUnit, dmgResult);
        logAction(sName, `HIT ${targetUnit.data[0]}`, `${mathAudit} -> Loc: ${dmgResult.loc} Dmg: ${dmgResult.dmg}`);
        
    } else {
        // MISS!
        logAction(sName, `MISSED ${targetUnit.data[0]}`, mathAudit);
    }

    // Deplete 1 Ammo
    let updatedRoster = [...state.roster];
    updatedRoster[shooterUnit.index][9] = loadedAmmo - 1; // W1 Loaded column
    await set(refs.roster, updatedRoster);
}