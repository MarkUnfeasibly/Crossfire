import { onValue, set } from 'firebase/database';
import { refs } from './firebase.js';
import { state, buildTerrainCache, updateOccupiedMap } from './state.js';
import { updateGameLogDOM, showToast, setupMapButtons, setupEditorUI } from './ui.js';
import { initRenderer, renderMap, renderTokens } from './renderer.js';
import { attachEditorListeners } from './editor.js';
import { setupLobbyUI } from './lobby.js';
import { setupDesignerUI } from './designer.js';
import { processAITurn } from './engine_ai.js'; 

function boot() {
  console.log("🔫 Booting Quickdraw VTT Engine...");
  setupMapButtons();
  buildTerrainCache();
  setupEditorUI();
  setupLobbyUI();
  setupDesignerUI(); 

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('designer') || urlParams.has('Designer')) {
    const modal = document.getElementById('designerModal');
    if (modal) {
      modal.style.display = 'flex';
      document.getElementById('tab-brain')?.click(); 
    }
  }

  document.getElementById('btn-menu-play').addEventListener('click', () => {
    document.getElementById('lobbyModal').style.display = 'flex';
  });
  
  document.getElementById('btn-menu-edit').addEventListener('click', () => {
   document.body.className = 'mode-edit';
  });
  
  const btnMainMenu = document.getElementById('btn-main-menu');
  if (btnMainMenu) {
    btnMainMenu.addEventListener('click', () => {
      document.body.className = 'mode-menu';
    });
  }
  
  initRenderer();

  // 🎯 FIX: Independent Overlay & 2-Way Layer Toggle Logic
  const btnGround = document.getElementById('layer-ground');
  const btnRoof = document.getElementById('layer-roof');
  const btnOverlay = document.getElementById('layer-overlay');
  
  let isOverlayActive = false;

  btnGround?.addEventListener('click', () => {
      btnGround.classList.add('active');
      btnRoof.classList.remove('active');
      import('./renderer.js').then(m => m.setRenderLayer('ground'));
  });

  btnRoof?.addEventListener('click', () => {
      btnRoof.classList.add('active');
      btnGround.classList.remove('active');
      import('./renderer.js').then(m => m.setRenderLayer('roof'));
  });

  btnOverlay?.addEventListener('click', () => {
      isOverlayActive = !isOverlayActive;
      btnOverlay.classList.toggle('active', isOverlayActive);
      import('./renderer.js').then(m => m.toggleRoofOverlay(isOverlayActive));
  });

  const canvasElement = document.querySelector('canvas');
  if (canvasElement) {
      attachEditorListeners(canvasElement);
  }

  onValue(refs.groundMap, (snapshot) => {
    if (snapshot.exists()) {
      state.maps.ground = snapshot.val();
      renderMap(); 
    } else {
      state.maps.ground = Array.from({length: 48}, () => Array(48).fill(''));
      renderMap();
    }
  });

  onValue(refs.roofMap, (snapshot) => {
    if (snapshot.exists()) {
      state.maps.roof = snapshot.val();
      renderMap(); 
    } else {
      state.maps.roof = Array.from({length: 48}, () => Array(48).fill(''));
      renderMap();
    }
  });

  onValue(refs.roster, (snapshot) => {
    if (snapshot.exists()) {
      state.roster = snapshot.val();
      updateOccupiedMap();
      renderTokens();
      
      const designerContent = document.getElementById('designer-content');
      if (designerContent && document.getElementById('designerModal').style.display === 'flex') {
        const activeBtn = document.querySelector('.btn-gold[id^="tab-"]');
        if (activeBtn && activeBtn.id === 'tab-roster') activeBtn.click();
      }
    }
  });

  onValue(refs.log, (snapshot) => {
    if (snapshot.exists()) updateGameLogDOM(snapshot.val());
  });

  document.getElementById('btn-initiative').addEventListener('click', drawNextInitiative);
  document.getElementById('btn-new-round').addEventListener('click', resetRound);
}

async function resetRound() {
  if (!state.roster || state.roster.length <= 1) return;
  
  let updatedRoster = [...state.roster];
  
  for (let i = 1; i < updatedRoster.length; i++) {
      if (updatedRoster[i]) {
          updatedRoster[i][19] = false; 
          updatedRoster[i][18] = updatedRoster[i][11]; 
      }
  }
  
  try {
    await set(refs.roster, updatedRoster);
    showToast("♻️ New Round Started! All units are ready.");
  } catch (error) {
    console.error("Error resetting round:", error);
    showToast("❌ Error resetting round.");
  }
}

function drawNextInitiative() {
  const pool = state.roster.slice(1).map((row, i) => ({data: row, index: i + 1}))
                           .filter(u => u.data[5] > 0 && u.data[19] !== true);
  
  if (pool.length === 0) { 
      showToast("Round Over! Please click 'New Round'."); 
      return; 
  }
  
  const activeUnit = pool[Math.floor(Math.random() * pool.length)];
  const name = activeUnit.data[0];
  const type = String(activeUnit.data[15]).trim().toUpperCase(); 
  
  activeUnit.data[19] = true; 
  
  let updatedRoster = [...state.roster];
  updatedRoster[activeUnit.index][19] = true;
  set(refs.roster, updatedRoster);
  
  showToast(`🎴 INITIATIVE: ${name.toUpperCase()}`);

  if (type === "AI") {
      processAITurn(activeUnit); 
  }
}

window.onload = boot;