import { state } from './state.js';
import { refs } from './firebase.js';
import { set } from 'firebase/database';
import { calculateDistance, checkLOSAndCover, getRangeCategory } from './engine_math.js';
import { logAction, showToast } from './ui.js';
import { WEAPON_DB, DAMAGE_DB } from './data_tables.js'; // 🎯 New Data Tables

window.EngineDiagnostics = window.EngineDiagnostics || {};

export function getWeaponStats(wpnName) {
  const wpn = String(wpnName || "").trim().toLowerCase();
  
  if (WEAPON_DB[wpn]) {
      return WEAPON_DB[wpn];
  } else {
      console.warn(`Weapon '${wpn}' not found in DB. Defaulting to Unarmed.`);
      return WEAPON_DB["unarmed"];
  }
}

export function resolveDamage(isRuthless, hasTrait) {
  let roll = Math.floor(Math.random() * 20) + 1;
  let loc = "TORSO", dmg = 1, audit = "Standard hit";

  // 🎯 Marksman Trait Damage Override
  if (hasTrait && hasTrait("Marksman")) {
      let mRoll = Math.floor(Math.random() * 6) + 1;
      if (mRoll <= 2) { loc = "HEAD"; dmg = (Math.floor(Math.random() * 6) + 1) + 3; }
      else if (mRoll <= 4) { loc = "CHEST"; dmg = (Math.floor(Math.random() * 6) + 1) + 1; }
      else { loc = "BELLY"; dmg = (Math.floor(Math.random() * 6) + 1); }
      return { loc, dmg, audit: "Marksman Bonus" };
  }

  // 🎯 Dynamic D20 Table Lookup
  for (let i = 0; i < DAMAGE_DB.length; i++) {
      if (roll >= DAMAGE_DB[i].min && roll <= DAMAGE_DB[i].max) {
          loc = DAMAGE_DB[i].loc;
          if (DAMAGE_DB[i].lethal && isRuthless) {
              dmg = 999; 
              audit = `Ruthless (${loc})`;
          } else {
              dmg = Math.floor(Math.random() * DAMAGE_DB[i].die) + 1;
              audit = `D${DAMAGE_DB[i].die} (${loc})`;
          }
          break;
      }
  }

  return { loc, dmg, audit };
}

export async function applyWound(targetUnit, damageObj) {
  let updatedRoster = [...state.roster];
  let uIndex = targetUnit.index;
  let row = updatedRoster[uIndex];

  let currentHP = Number(row[5]);
  let dmgAmount = (typeof damageObj.dmg === 'number') ? damageObj.dmg : 999;
  let newHP = Math.max(0, currentHP - dmgAmount);
  
  row[5] = newHP; 

  if (newHP <= 0) {
      row[16] = "KIA"; 
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
  await set(refs.roster, updatedRoster);
}

export async function executeCombat(shooterUnit, targetUnit, hasTrait, distanceMoved = 0) {
    const sName = shooterUnit.data[0];
    const sPos = shooterUnit.data[11];
    const sElev = shooterUnit.data[23] || "Ground";
    
    const tName = targetUnit.data[0];
    const tPos = targetUnit.data[11];
    const tElev = targetUnit.data[23] || "Ground";
    const targetIsMounted = (targetUnit.data[21] === true || String(targetUnit.data[21]).toUpperCase() === 'TRUE');

    window.EngineDiagnostics.combatTarget = tName;

    let dist = calculateDistance(sPos, tPos);
    
    // 🎯 H2H MELEE COMBAT DETECTION
    if (dist <= 1.5) {
        const h2hSkill = Number(shooterUnit.data[3]);
        let roll = Math.floor(Math.random() * 20) + 1;
        let targetNum = h2hSkill; 
        
        window.EngineDiagnostics.combatMath = `[Melee] TN:${targetNum} (Roll:${roll} | H2H Sk:${h2hSkill})`;
        
        if (roll <= targetNum || roll === 1) {
            let dmgResult = resolveDamage(Number(shooterUnit.data[4]) <= 10, hasTrait);
            await applyWound(targetUnit, dmgResult);
            window.EngineDiagnostics.combatResult = `HIT! (Roll ${roll} <= TN ${targetNum})`;
            window.EngineDiagnostics.combatDamage = `Loc: ${dmgResult.loc} | Dmg: ${dmgResult.dmg}`;
            logAction(sName, `MELEE HIT ${tName}`, `Loc: ${dmgResult.loc} Dmg: ${dmgResult.dmg}`);
        } else {
            window.EngineDiagnostics.combatResult = `MISSED! (Roll ${roll} > TN ${targetNum})`;
            window.EngineDiagnostics.combatDamage = `None`;
            logAction(sName, `MELEE MISSED ${tName}`, `Roll ${roll} vs TN ${targetNum}`);
        }
        return;
    }

    // 🎯 RANGED COMBAT
    const activeWpn = shooterUnit.data[8] || "Colt .45";
    const loadedAmmo = Number(shooterUnit.data[9]) || 0;
    
    if (loadedAmmo <= 0) {
        window.EngineDiagnostics.combatMath = `Out of Ammo`;
        window.EngineDiagnostics.combatResult = `CLICK!`;
        logAction(sName, `CLICK!`, `Out of ammo attempting to shoot ${tName}`);
        return;
    }

    const stats = getWeaponStats(activeWpn);
    const skill = stats.isShoulder ? Number(shooterUnit.data[1]) : Number(shooterUnit.data[2]); 

    let tactical = checkLOSAndCover(sPos, sElev, tPos, tElev, targetIsMounted);
    
    if (tactical.blocked) {
        window.EngineDiagnostics.combatMath = `Path Blocked by Solid Cover`;
        window.EngineDiagnostics.combatResult = `BLOCKED`;
        logAction(sName, `BLOCKED SHOT`, `Target ${tName} obscured behind solid cover.`);
        return;
    }

    let sStatus = String(shooterUnit.data[16] || "").toLowerCase();
    let aimPen = 0;
    if (sStatus.includes("head") && !hasTrait("Drunk")) aimPen += 5;
    if (sStatus.includes("dazed")) aimPen += 3;
    if (sStatus.includes("right arm")) aimPen += hasTrait("Marksman") ? 2 : 5;

    let shooterMovementMod = (distanceMoved === 0) ? 2 : (distanceMoved > 6) ? -4 : 0; 
    
    // 🎯 RESTORED: TARGET EVASION & MOVEMENT MODIFIERS
    let tLastPos = targetUnit.data[18] || tPos;
    let targetMovedMod = (tLastPos !== tPos) ? -2 : 0; // -2 Evasion Penalty if they moved from starting square
    
    let tStatus = String(targetUnit.data[16] || "").toLowerCase();
    let targetMovementMod = targetIsMounted ? 2 : 0;
    targetMovementMod += targetMovedMod;
    if (tStatus.includes("prone")) targetMovementMod -= 3;

    let rngCat = getRangeCategory(dist);
    let rangeMod = stats[rngCat] || 0;

    let targetNum = (skill + rangeMod + tactical.mod + shooterMovementMod + targetMovementMod) - aimPen;
    
    let roll = Math.floor(Math.random() * 20) + 1;
    let mathAudit = `TN:${targetNum} (Roll:${roll} | Wpn:${activeWpn} Sk:${skill} Rng:${rangeMod} Cov:${tactical.mod} Mov:${shooterMovementMod} T.Evasion:${targetMovementMod} Wounds:-${aimPen})`;
    
    window.EngineDiagnostics.combatMath = mathAudit;

    if (roll === 20) {
        window.EngineDiagnostics.combatResult = `WEAPON JAMMED! (Rolled 20)`;
        let updatedRoster = [...state.roster];
        let curStatus = String(updatedRoster[shooterUnit.index][16] || "");
        updatedRoster[shooterUnit.index][16] = curStatus ? curStatus + ", Jammed Weapon" : "Jammed Weapon";
        await set(refs.roster, updatedRoster);
        logAction(sName, `WEAPON JAMMED!`, mathAudit);
    } else if (roll <= targetNum || roll === 1) { 
        let dmgResult = resolveDamage(Number(shooterUnit.data[4]) <= 10, hasTrait); 
        await applyWound(targetUnit, dmgResult);
        window.EngineDiagnostics.combatResult = `HIT! (Roll ${roll} <= TN ${targetNum})`;
        window.EngineDiagnostics.combatDamage = `Loc: ${dmgResult.loc} | Dmg: ${dmgResult.dmg}`;
        logAction(sName, `HIT ${tName}`, `${mathAudit} -> Loc: ${dmgResult.loc} Dmg: ${dmgResult.dmg}`);
    } else {
        window.EngineDiagnostics.combatResult = `MISSED! (Roll ${roll} > TN ${targetNum})`;
        window.EngineDiagnostics.combatDamage = `None`;
        logAction(sName, `MISSED ${tName}`, mathAudit);
    }

    let updatedRoster = [...state.roster];
    updatedRoster[shooterUnit.index][9] = loadedAmmo - 1; 
    await set(refs.roster, updatedRoster);
}