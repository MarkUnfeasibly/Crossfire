import { state } from './state.js';
import { cellToCoords, coordsToCell, getVehicleFootprint } from './math.js';
import { saveUnit } from './firebase.js';
import { writeTelemetry, showToast } from './ui.js';

export function commitMovement(unit, finalPos) {
  let currentPos = unit.data[11];
  let elev = unit.data[23] || "Ground"; 
  let actualPos = finalPos;
  let destCoords = cellToCoords(actualPos);
  
  let destTile = state.maps.ground[destCoords.y-1]?.[destCoords.x-1]?.toString().trim().toUpperCase() || "";
  
  let currentStatusStr = unit.data[16] ? String(unit.data[16]) : "";
  let inVehicle = currentStatusStr.toLowerCase().includes("in vehicle");
  
  // 🚗 VEHICLE BOARDING
  if ((destTile === "V1" || destTile === "V2") && !inVehicle) {
      let hasDriver = false;
      let driverIsDead = false;
      
      for (let i = 1; i < state.roster.length; i++) {
          if (i === unit.index) continue; 
          let otherStatus = String(state.roster[i].data[16]).toLowerCase();
          
          if (otherStatus.includes("driver")) {
              hasDriver = true;
              if (Number(state.roster[i].data[5]) <= 0) driverIsDead = true; 
              break;
          }
      }
      
      if (hasDriver && driverIsDead) {
          unit.data[16] = currentStatusStr ? currentStatusStr + `, In Vehicle, Dumping Body, Wait: 1` : `In Vehicle, Dumping Body, Wait: 1`;
          writeTelemetry("B13", `🚗 BOARDED! Driver is KIA. Starting body dump!`);
      } else {
          let role = hasDriver ? "Passenger" : "Driver";
          unit.data[16] = currentStatusStr ? currentStatusStr + `, In Vehicle, ${role}` : `In Vehicle, ${role}`;
          writeTelemetry("B13", `🚗 BOARDED VEHICLE as ${role}!`);
      }
  } else if (destTile !== "V1" && destTile !== "V2" && inVehicle) {
      let newStatus = currentStatusStr.replace(/,?\s*in vehicle/ig, "").replace(/,?\s*driver/ig, "").replace(/,?\s*passenger/ig, "").trim();
      if (newStatus.startsWith(",")) newStatus = newStatus.substring(1).trim();
      unit.data[16] = newStatus;
      writeTelemetry("B13", `🏃‍♂️ BAILED OUT! Unit hit the street!`);
  }
  
  // Save position and status to local memory, then push to Firebase
  unit.data[11] = actualPos;
  saveUnit(unit.index, unit.data);
  return actualPos;
}

export function shiftVehicle(driverUnit, dx, dy) {
    let startPos = driverUnit.data[11];
    let footprint = getVehicleFootprint(startPos);
    if (footprint.length === 0) return 0; 
    
    // In Firebase, we will actually need to write a function that updates the `maps/ground` array 
    // in the database. For now, we update local state and let the renderer redraw.
    // (This requires a Firebase update() payload for the map array).
    writeTelemetry("VEHICLE", `Shifting vehicle ${dx}, ${dy}`);
    return Math.max(Math.abs(dx), Math.abs(dy));
}

// NOTE: executeCombat(), executeMelee(), and executeExplosive() should be moved here 
// and adapted to use saveUnit(unit.index, unit.data) instead of ss.getSheetByName().setValue()