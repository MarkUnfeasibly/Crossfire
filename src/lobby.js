import { ref, get, set } from 'firebase/database';
import { db, refs } from './firebase.js';
import { showToast } from './ui.js';

export function setupLobbyUI() {
  const btnNew = document.getElementById('btn-lobby-new');
  const btnLoad = document.getElementById('btn-lobby-load');
  const btnStart = document.getElementById('btn-wizard-start');
  
  if (btnLoad) {
    btnLoad.addEventListener('click', () => {
      document.getElementById('lobbyModal').style.display = 'none';
      document.body.className = 'mode-play';
      showToast("Game Loaded!");
    });
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      document.getElementById('lobbyModal').style.display = 'none';
      document.getElementById('wizardModal').style.display = 'flex';
      
      // 🎯 Fetch available maps when the wizard opens
      populateMapDropdown();
    });
  }

  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      const mapName = document.getElementById('wiz-map').value.trim();
      const scenario = document.getElementById('wiz-scenario').value;
      const enemyCount = parseInt(document.getElementById('wiz-enemies').value);
      
      if (mapName === "") return showToast("⚠️ Please select a map!");
      
      await generateNewGame(mapName, scenario, enemyCount);
      
      document.getElementById('wizardModal').style.display = 'none';
      document.body.className = 'mode-play';
      showToast(`🚀 ${scenario} Started!`);
    });
  }
}

// 🎯 Fetch saved maps from Firebase and populate the dropdown
async function populateMapDropdown() {
  const mapSelect = document.getElementById('wiz-map');
  if (!mapSelect) return;
  
  mapSelect.innerHTML = '<option value="">Loading maps...</option>';
  
  try {
    const snap = await get(ref(db, 'savedMaps'));
    mapSelect.innerHTML = ''; // Clear loading text
    
    if (snap.exists()) {
      const maps = Object.keys(snap.val()); // Get all map names (keys)
      
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

async function generateNewGame(mapName, scenario, enemyCount) {
  // 1. Pull the map from the database
  const mapRef = ref(db, `savedMaps/${mapName}`);
  const mapSnap = await get(mapRef);
  
  if (!mapSnap.exists()) {
    showToast(`⚠️ Map '${mapName}' not found!`);
    return;
  }
  
  let groundMap = mapSnap.val().ground;
  let roofMap = mapSnap.val().roof;

  // 2. Drop Objective Tokens into the map based on Scenario
  if (scenario === "Heist") {
    // Drop a vault/loot token dead center
    const centerR = Math.floor(groundMap.length / 2);
    const centerC = Math.floor(groundMap[0].length / 2);
    groundMap[centerR][centerC] = "$"; 
  }

  // Push Map to live game state
  await set(refs.groundMap, groundMap);
  await set(refs.roofMap, roofMap);

  // 3. Generate the Roster
  let newRoster = [];
  
  // A. Create Headers
  newRoster.push(["Name", "Shoulder", "Handgun", "H2H", "Guts", "Build", "Ability", "Max Build", "Weapon 1", "W1 Loaded", "W1 Reserve", "Position", "Weapon 2", "W2 Loaded", "W2 Reserve", "Control", "Status", "Traits", "LastPos", "InitDone", "Weapon_H2H", "Mounted", "Speed_Tier", "Elevation"]);
  
  // B. Give the player a Sheriff to control
  newRoster.push([
    "Player Sheriff", 14, 18, 14, 16, 12, 15, 12, 
    "Colt .45", 6, 12, "L20", 
    "", 0, 0, 
    "Player", "", "", "L20", false, "", false, 0, "Ground"
  ]);

  // C. Generate Random AI Thugs
  const wildWestNames = ["Mad Dog", "Rattlesnake", "One-Eyed", "Dusty", "Black-Hat"];
  const weapons = ["Colt .45", "Winchester Rifle", "Double Barrel Shotgun"];
  
  for (let i = 0; i < enemyCount; i++) {
    let moniker = wildWestNames[Math.floor(Math.random() * wildWestNames.length)];
    let wpn = weapons[Math.floor(Math.random() * weapons.length)];
    
    let spawnCol = String.fromCharCode(65 + (i * 2)); 
    let spawnCell = `${spawnCol}2`; 

    newRoster.push([
      `${moniker} Outlaw ${i+1}`, 12, 12, 12, 12, 10, 10, 10, 
      wpn, 6, 12, spawnCell, 
      "", 0, 0, 
      "AI", "", "Robber", spawnCell, false, "", false, 0, "Ground"
    ]);
  }

  await set(refs.roster, newRoster);
  await set(refs.log, {}); 
}