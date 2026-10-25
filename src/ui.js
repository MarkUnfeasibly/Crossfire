import { db, refs } from './firebase.js';
import { push, set, get, ref } from 'firebase/database'; // Added get and ref!
import { saveMapSet, loadMapSet } from './mapManager.js';
import { state, TERRAIN } from './state.js';
import { setTerrain, setTool, setLayer } from './editor.js';
import { renderMap, setZoomLevel, toggleRoofOverlay } from './renderer.js'; 

// ============================================================
// MAP EDITOR UI (Palette & Tools)
// ============================================================

export function buildPaletteUI() {
  const palette = document.getElementById('terrain-palette');
  if (!palette) return;
  palette.innerHTML = '';
  
  TERRAIN.forEach(t => {
    const d = document.createElement('div');
    d.id = 'terrain-' + t.sym;
    d.className = 'terrain-tile' + (t.sym === 'W0' ? ' active' : '');
    d.style.background = t.color;
    d.style.borderColor = t.sym === 'W0' ? '#c8972a' : t.border;
    d.innerHTML = `<span class="sym" style="color:${t.textColor}">${t.sym}</span><span class="lbl">${t.name}</span>`;
    d.addEventListener('click', () => setTerrain(t.sym));
    palette.appendChild(d);
  });
}

export function setupEditorUI() {
  buildPaletteUI();
  
  // Paint Tools
  document.getElementById('tool-paint')?.addEventListener('click', () => setTool('paint'));
  document.getElementById('tool-erase')?.addEventListener('click', () => setTool('erase'));
  document.getElementById('tool-fill')?.addEventListener('click', () => setTool('fill'));
  document.getElementById('tool-rect')?.addEventListener('click', () => setTool('rect'));
  document.getElementById('tool-line')?.addEventListener('click', () => setTool('line'));
  
  // Layer Toggles
  document.getElementById('layer-ground')?.addEventListener('click', () => {
    setLayer('ground');
  });
  
  document.getElementById('layer-roof')?.addEventListener('click', () => {
    setLayer('roof');
  });

  // Zoom Slider
  document.getElementById('zoomSlider')?.addEventListener('input', (e) => {
    setZoomLevel(parseInt(e.target.value));
  });

  // Roof Overlay Checkbox
  document.getElementById('showRoofOverlay')?.addEventListener('change', (e) => {
    toggleRoofOverlay(e.target.checked);
  });

  // Map Resizing
  const resizeMap = () => {
    const newW = parseInt(document.getElementById('mapW').value) || 48;
    const newH = parseInt(document.getElementById('mapH').value) || 48;
    
    const newGround = Array.from({length: newH}, (_, r) =>
      Array.from({length: newW}, (_, c) => (state.maps.ground[r] && state.maps.ground[r][c]) ? state.maps.ground[r][c] : ''));
    const newRoof = Array.from({length: newH}, (_, r) =>
      Array.from({length: newW}, (_, c) => (state.maps.roof[r] && state.maps.roof[r][c]) ? state.maps.roof[r][c] : ''));
    
    set(refs.groundMap, newGround);
    set(refs.roofMap, newRoof);
    showToast(`Map resized to ${newW}x${newH}`);
  };

  document.getElementById('mapW')?.addEventListener('change', resizeMap);
  document.getElementById('mapH')?.addEventListener('change', resizeMap);
}

// ============================================================
// SYSTEM UTILITIES (Toasts & Logs)
// ============================================================

export function showToast(msg) {
  const t = document.getElementById('toast');
  if(t) {
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  } else {
    console.log("TOAST:", msg);
  }
}

export function logAction(unit, action, details) {
  push(refs.log, {
    timestamp: Date.now(),
    unit: unit,
    action: action,
    details: details
  });
}

export function writeTelemetry(code, msg) {
  console.log(`[AI BRAIN ${code}] ${msg}`);
}

export function updateGameLogDOM(logEntries) {
  const logDiv = document.getElementById('game-log');
  if(!logDiv) return;
  
  logDiv.innerHTML = '';
  Object.values(logEntries).slice(-15).forEach(entry => {
    logDiv.innerHTML += `
      <div style="margin-bottom:8px; border-bottom:1px dashed #A38A66; padding-bottom: 4px;">
        <strong>${entry.unit}</strong>: ${entry.action}<br>
        <span style="color:#5C4A3D; font-size: 11px;">${entry.details}</span>
      </div>`;
  });
  logDiv.scrollTop = logDiv.scrollHeight;
}

// ============================================================
// MAIN MENU BINDINGS (Load / Save Prompts)
// ============================================================

async function populateEditorMapDropdown() {
  const mapSelect = document.getElementById('load-map-select');
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

export function setupMapButtons() {
  const btnSave = document.getElementById('btn-save-map');
  const btnLoad = document.getElementById('btn-load-map');
  const btnConfirmLoad = document.getElementById('btn-confirm-load');

  if (btnSave) {
    btnSave.addEventListener('click', () => {
      const mapName = prompt("💾 Save Map As:\n(e.g., 'The Bank Job', 'High Noon Street')");
      if (mapName && mapName.trim() !== "") saveMapSet(mapName.trim());
    });
  }

  // 🎯 Make the editor "Load" button open the dropdown modal
  if (btnLoad) {
    btnLoad.addEventListener('click', () => {
      document.getElementById('loadMapModal').style.display = 'flex';
      populateEditorMapDropdown();
    });
  }

  // 🎯 Hook up the "Load Map" confirmation inside the modal
  if (btnConfirmLoad) {
    btnConfirmLoad.addEventListener('click', () => {
      const mapName = document.getElementById('load-map-select').value;
      if (mapName && mapName.trim() !== "") {
        loadMapSet(mapName.trim());
        document.getElementById('loadMapModal').style.display = 'none';
      } else {
        showToast("⚠️ Please select a map!");
      }
    });
  }
}