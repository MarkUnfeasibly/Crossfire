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
      // 🎯 FIX: Safely swap modes without destroying themes
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
      const mapName = document.getElementById('wiz-map').value.trim();
      const scenario = document.getElementById('wiz-scenario').value;
      const enemyCount = parseInt(document.getElementById('wiz-enemies').value);
      
      // Dynamic Theme Switching
      if (scenario === '1920s Heist' || scenario === 'Prohibition Shootout') { 
          document.body.classList.add('theme-1920s');
      } else {
          document.body.classList.remove('theme-1920s'); 
      }
      
      if (mapName === "") return showToast("⚠️ Please select a map!");
      
      try {
          await generateNewGame(mapName, scenario, enemyCount);
          
          document.getElementById('wizardModal').style.display = 'none';
          
          // 🎯 FIX: Safely swap modes without destroying themes
          document.body.classList.remove('mode-menu');
          document.body.classList.add('mode-play');
          showToast(`🚀 ${scenario} Started!`);
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

async function generateNewGame(mapName, scenario, enemyCount) {
  const mapRef = ref(db, `savedMaps/${mapName}`);
  const mapSnap = await get(mapRef);
  
  if (!mapSnap.exists()) {
    showToast(`⚠️ Map '${mapName}' not found!`);
    return;
  }
  
  let mapData = mapSnap.val();
  
  // 🎯 FIX: Provide safe fallback arrays so Firebase doesn't crash on 'undefined'
  let groundMap = mapData.ground || Array.from({length: 48}, () => Array(48).fill(''));
  let roofMap = mapData.roof || Array.from({length: 48}, () => Array(48).fill(''));

  if (scenario === "Heist") {
    const centerR = Math.floor(groundMap.length / 2);
    const centerC = Math.floor(groundMap[0].length / 2);
    groundMap[centerR][centerC] = "$"; 
  }

  await set(refs.groundMap, groundMap);
  await set(refs.roofMap, roofMap);

  let newRoster = [];
  
  newRoster.push(["Name", "Shoulder", "Handgun", "H2H", "Guts", "Build", "Ability", "Max Build", "Weapon 1", "W1 Loaded", "W1 Reserve", "Position", "Weapon 2", "W2 Loaded", "W2 Reserve", "Control", "Status", "Traits", "LastPos", "InitDone", "Weapon_H2H", "Mounted", "Speed_Tier", "Elevation"]);
  
  newRoster.push([
    "Player Sheriff", 14, 18, 14, 16, 12, 15, 12, 
    "Colt .45", 6, 12, "L20", 
    "", 0, 0, 
    "Player", "", "", "L20", false, "", false, 0, "Ground"
  ]);

  const wildWestNames = ["Mad Dog", "Rattlesnake", "One-Eyed", "Dusty", "Black-Hat"];
  const weapons = ["Colt .45", "Winchester", "Shotgun"]; // Updated to match exact DB keys
  
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