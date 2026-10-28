import { ref, get, set } from 'firebase/database';
import { db, refs } from './firebase.js';
import { showToast } from './ui.js';
import { state } from './state.js';
import { coordsToCell } from './engine_math.js';
import { SCENARIOS_DB } from './data_tables.js'; // 🎯 Import the database

export function setupLobbyUI() {
  const btnNew = document.getElementById('btn-lobby-new');
  const btnLoad = document.getElementById('btn-lobby-load');
  const btnStart = document.getElementById('btn-wizard-start');
  
  const eraSelect = document.getElementById('wiz-era');
  const scenarioSelect = document.getElementById('wiz-scenario');
  const objContainer = document.getElementById('wiz-obj-container');
  
  // 🎯 UI LOGIC: Cascading Menus
  if (eraSelect) {
      eraSelect.addEventListener('change', (e) => {
          const era = e.target.value;
          scenarioSelect.innerHTML = '<option value="">-- Select Scenario --</option>';
          
          if (era && SCENARIOS_DB[era]) {
              scenarioSelect.disabled = false;
              SCENARIOS_DB[era].forEach(scen => {
                  const opt = document.createElement('option');
                  opt.value = scen.name;
                  opt.textContent = scen.name;
                  scenarioSelect.appendChild(opt);
              });
          } else {
              scenarioSelect.disabled = true;
          }
          
          // Reset objective display
          objContainer.style.display = 'none';
      });
  }

  if (scenarioSelect) {
      scenarioSelect.addEventListener('change', (e) => {
          const era = eraSelect.value;
          const scenName = e.target.value;
          const scenarioObj = SCENARIOS_DB[era]?.find(s => s.name === scenName);
          
          if (scenarioObj && scenarioObj.objective) {
              objContainer.style.display = 'block'; // Show Objective count input
          } else {
              objContainer.style.display = 'none';
          }
      });
  }

  if (btnLoad) {
    btnLoad.addEventListener('click', () => {
      document.getElementById('lobbyModal').style.display = 'none';
      document.body.classList.remove('mode-menu');
      document.body.classList.add('mode-play');
      showToast("Game Loaded!");
    });
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      document.getElementById('lobbyModal').style.display = 'none';
      document.getElementById('wizardModal').style.display = 'flex';
      populateMapDropdown();
    });
  }

  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      const era = document.getElementById('wiz-era').value;
      const scenarioName = document.getElementById('wiz-scenario').value;
      const mapName = document.getElementById('wiz-map').value.trim();
      const enemyCount = parseInt(document.getElementById('wiz-enemies').value);
      const objCount = parseInt(document.getElementById('wiz-obj-count').value) || 1;
      
      if (!era || !scenarioName) return showToast("⚠️ Please select an Era and Scenario.");
      if (mapName === "") return showToast("⚠️ Please select a map.");
      
      // Look up scenario data
      const scenarioData = SCENARIOS_DB[era].find(s => s.name === scenarioName);
      
      // Dynamic Theme Switching
      if (era === '1920s Gangsters') document.body.classList.add('theme-1920s');
      else document.body.classList.remove('theme-1920s'); 
      
      try {
          await generateNewGame(mapName, scenarioData, enemyCount, objCount);
          document.getElementById('wizardModal').style.display = 'none';
          document.body.classList.remove('mode-menu');
          document.body.classList.add('mode-play');
      } catch (error) {
          console.error("Game Generation Error:", error);
          showToast("⚠️ Error starting game. Check console.");
      }
    });
  }
}

async function populateMapDropdown() {
  const mapSelect = document.getElementById('wiz-map');
  if (!mapSelect) return;
  mapSelect.innerHTML = '<option value="">Loading maps...</option>';
  try {
    const snap = await get(ref(db, 'savedMaps'));
    mapSelect.innerHTML = ''; 
    if (snap.exists()) {
      const maps = Object.keys(snap.val()); 
      if (maps.length === 0) {
        mapSelect.innerHTML = '<option value="">No maps found in database</option>';
      } else {
        maps.forEach(mapName => {
          const opt = document.createElement('option');
          opt.value = mapName;
          opt.textContent = mapName;
          mapSelect.appendChild(opt);
        });
      }
    } else {
      mapSelect.innerHTML = '<option value="">No maps found in database</option>';
    }
  } catch (error) {
    console.error("Error fetching map list:", error);
    mapSelect.innerHTML = '<option value="">Error loading maps</option>';
  }
}

async function generateNewGame(mapName, scenarioData, enemyCount, objCount) {
  const mapRef = ref(db, `savedMaps/${mapName}`);
  const mapSnap = await get(mapRef);
  if (!mapSnap.exists()) return showToast(`⚠️ Map '${mapName}' not found!`);
  
  let mapData = mapSnap.val();
  let groundMap = mapData.ground || Array.from({length: 48}, () => Array(48).fill(''));
  let roofMap = mapData.roof || Array.from({length: 48}, () => Array(48).fill(''));

  await set(refs.groundMap, groundMap);
  await set(refs.roofMap, roofMap);

  if (scenarioData.objective) {
      // 🎯 INTERACTIVE PLACEMENT: Tell the engine how many tokens to place!
      state.setupMode = 'loot';
      state.pendingSetup = { 
          scenarioData: scenarioData, 
          enemyCount: enemyCount,
          objectivesRemaining: objCount,
          objectiveSymbol: scenarioData.objective
      };
      showToast(`🎯 Setup: Click the map to place Objective 1 of ${objCount}`);
  } else {
      // No objectives needed (like a straight shootout)
      await finalizeRoster(scenarioData, enemyCount);
      showToast(`🚀 ${scenarioData.name} Started!`);
  }
}

function getValidSpawns(mapGrid, cx, cy, radius) {
    let valid = [];
    const maxR = mapGrid.length;
    const maxC = mapGrid[0].length;
    
    for (let r = Math.max(0, cy - radius); r <= Math.min(maxR - 1, cy + radius); r++) {
        for (let c = Math.max(0, cx - radius); c <= Math.min(maxC - 1, cx + radius); c++) {
            let tile = mapGrid[r][c];
            let tData = state.terrainCache[tile];
            if (!tile || (tData && (tData.blocksMove === false || String(tData.blocksMove).toUpperCase() === 'FALSE'))) {
                valid.push(coordsToCell(c + 1, r + 1));
            }
        }
    }
    return valid;
}

export async function finalizeRoster(scenarioData, enemyCount) {
  let newRoster = [];
  newRoster.push(["Name", "Shoulder", "Handgun", "H2H", "Guts", "Build", "Ability", "Max Build", "Weapon 1", "W1 Loaded", "W1 Reserve", "Position", "Weapon 2", "W2 Loaded", "W2 Reserve", "Control", "Status", "Traits", "LastPos", "InitDone", "Weapon_H2H", "Mounted", "Speed_Tier", "Elevation"]);
  
  const mapH = state.maps.ground.length;
  const mapW = state.maps.ground[0].length;
  
  let centerSpawns = getValidSpawns(state.maps.ground, Math.floor(mapH / 2), Math.floor(mapW / 2), 4);
  let playerSpawn = centerSpawns.length > 0 ? centerSpawns[Math.floor(Math.random() * centerSpawns.length)] : "L20";
  centerSpawns = centerSpawns.filter(s => s !== playerSpawn);

  newRoster.push([
    "Player Sheriff", 14, 18, 14, 16, 12, 15, 12, 
    "Colt .45", 6, 12, playerSpawn, 
    "", 0, 0, 
    "Player", "", "", playerSpawn, false, "", false, 0, "Ground"
  ]);

  const corners = [ {y: 4, x: 4}, {y: 4, x: mapW-5}, {y: mapH-5, x: 4}, {y: mapH-5, x: mapW-5} ];
  const spawnCorner = corners[Math.floor(Math.random() * corners.length)];
  let aiSpawns = getValidSpawns(state.maps.ground, spawnCorner.x, spawnCorner.y, 6);

  const wildWestNames = ["Mad Dog", "Rattlesnake", "One-Eyed", "Dusty", "Black-Hat"];
  const weapons = ["Colt .45", "Winchester", "Shotgun"];
  
  // 🎯 DYNAMIC TRAITS: Fetch default traits from the database
  const aiTrait = scenarioData.defaultTraits || "Brawler";

  for (let i = 0; i < enemyCount; i++) {
    let moniker = wildWestNames[Math.floor(Math.random() * wildWestNames.length)];
    let wpn = weapons[Math.floor(Math.random() * weapons.length)];
    
    let spawnCell = aiSpawns.length > 0 ? aiSpawns[Math.floor(Math.random() * aiSpawns.length)] : "A1";
    aiSpawns = aiSpawns.filter(s => s !== spawnCell);

    newRoster.push([
      `${moniker} Outlaw ${i+1}`, 12, 12, 12, 12, 10, 10, 10, 
      wpn, 6, 12, spawnCell, 
      "", 0, 0, 
      "AI", "", aiTrait, spawnCell, false, "", false, 0, "Ground"
    ]);
  }

  await set(refs.roster, newRoster);
  await set(refs.log, {}); 
}