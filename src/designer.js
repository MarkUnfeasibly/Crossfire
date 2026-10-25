import { state } from './state.js';
import { db, refs } from './firebase.js';
import { set } from 'firebase/database';
import { showToast } from './ui.js';
import { checkLOSAndCover, calculateDistance } from './engine_math.js'; 

let activeTab = 'brain';

export function setupDesignerUI() {
  const btnDesigner = document.getElementById('btn-game-designer');
  const modal = document.getElementById('designerModal');
  
  if (btnDesigner) {
    btnDesigner.addEventListener('click', () => {
      modal.style.display = 'flex';
      refreshDesignerContent();
    });
  }

  // Tab Switching Logic
  document.getElementById('tab-brain')?.addEventListener('click', (e) => switchTab('brain', e.target));
  document.getElementById('tab-los')?.addEventListener('click', (e) => switchTab('los', e.target));
  document.getElementById('tab-roster')?.addEventListener('click', (e) => switchTab('roster', e.target));
}

function switchTab(tabName, btnElement) {
  activeTab = tabName;
  
  // Reset all buttons to default white outline
  ['tab-brain', 'tab-los', 'tab-roster'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.className = 'btn';
      btn.style.color = 'white';
      btn.style.borderColor = 'white';
    }
  });

  // Highlight active tab in gold
  btnElement.className = 'btn btn-gold';
  btnElement.style.color = 'var(--ink-main)';
  btnElement.style.borderColor = 'var(--ink-main)';

  refreshDesignerContent();
}


// Replace refreshDesignerContent() with this:
function refreshDesignerContent() {
  const content = document.getElementById('designer-content');
  if (!content) return;

  if (activeTab === 'brain') {
    content.innerHTML = `
      <h3 style="font-family:'Rye'; border-bottom:2px solid var(--sepia-dark); margin-bottom:10px;">🧠 LIVE AI TELEMETRY</h3>
      <div id="telemetry-log" style="background:var(--ink-main); color:#00FF00; padding:15px; border-radius:4px; font-family:monospace; min-height:200px; max-height:400px; overflow-y:auto;">
        > ENGINE_IDLE<br>
        > WAITING_FOR_INITIATIVE_TRIGGER...
      </div>
    `;
  } 
  else if (activeTab === 'los') {
    renderLOSValidator(content);
  } 
  else if (activeTab === 'roster') {
    renderRosterEditor(content);
  }
}

// Add this brand new function to build the LOS UI:
function renderLOSValidator(container) {
  if (!state.roster || state.roster.length <= 1) {
    container.innerHTML = `<h3 style="font-family:'Rye';">👁️ LOS MATRIX VALIDATOR</h3><p>No units found. Spawn units to test LOS.</p>`;
    return;
  }

  // Build a dropdown of all alive units on the board
  let unitOptions = '<option value="">-- Select Unit --</option>';
  for (let i = 1; i < state.roster.length; i++) {
    if (state.roster[i] && Number(state.roster[i][5]) > 0 && state.roster[i][11]) {
      unitOptions += `<option value="${i}">${state.roster[i][0]} (${state.roster[i][11]})</option>`;
    }
  }

  container.innerHTML = `
    <h3 style="font-family:'Rye'; border-bottom:2px solid var(--sepia-dark); margin-bottom:10px;">👁️ LOS MATRIX VALIDATOR</h3>
    
    <div style="display:flex; gap:20px; align-items:flex-end; margin-bottom: 20px;">
      <label style="flex:1;"><b>Shooter:</b><br><select id="los-shooter" style="width:100%; padding:5px;">${unitOptions}</select></label>
      <label style="flex:1;"><b>Target:</b><br><select id="los-target" style="width:100%; padding:5px;">${unitOptions}</select></label>
      <button class="btn btn-rust" id="btn-run-los">Run Matrix</button>
    </div>
    
    <div id="los-result-panel" style="background:var(--paper-panel); padding:15px; border:2px solid var(--ink-main); display:none;">
      <!-- Results inject here -->
    </div>
  `;

  // Attach listener to calculate and display the results
  document.getElementById('btn-run-los').addEventListener('click', () => {
    const sIdx = document.getElementById('los-shooter').value;
    const tIdx = document.getElementById('los-target').value;
    const panel = document.getElementById('los-result-panel');
    
    if (!sIdx || !tIdx || sIdx === tIdx) {
      panel.style.display = 'block';
      panel.innerHTML = `<p style="color:var(--stamp-red); font-weight:bold;">⚠️ Select two different units!</p>`;
      return;
    }

    const shooter = state.roster[sIdx];
    const target = state.roster[tIdx];

    const sPos = shooter[11];
    const sElev = shooter[23] || "Ground";
    const tPos = target[11];
    const tElev = target[23] || "Ground";
    const tMounted = (target[21] === true || String(target[21]).toUpperCase() === 'TRUE');

    const dist = calculateDistance(sPos, tPos);
    const los = checkLOSAndCover(sPos, sElev, tPos, tElev, tMounted);

    panel.style.display = 'block';
    if (los.blocked) {
      panel.innerHTML = `
        <h4 style="margin-top:0; color:var(--stamp-red);">🚫 SHOT BLOCKED</h4>
        <p><b>Distance:</b> ${dist}"</p>
        <p>Solid terrain blocks line of sight between ${sPos} and ${tPos}.</p>
      `;
    } else {
      panel.innerHTML = `
        <h4 style="margin-top:0; color:#4a5d23;">🟢 CLEAR LINE OF SIGHT</h4>
        <p><b>Distance:</b> ${dist}"</p>
        <p><b>Cover Penalty:</b> ${los.mod === 0 ? "None" : los.mod}</p>
        <p style="font-size:10px; color:var(--ink-faded);">* Does not include Target Number (TN) math. Combat Engine required for final roll.</p>
      `;
    }
  });
}

function renderRosterEditor(container) {
  if (!state.roster || !Array.isArray(state.roster) || state.roster.length <= 1) {
    container.innerHTML = `<h3 style="font-family:'Rye';">📋 LIVE ROSTER</h3><p>No active units found. Run the Setup Wizard first.</p>`;
    return;
  }

  let html = `<h3 style="font-family:'Rye'; border-bottom:2px solid var(--sepia-dark); margin-bottom:10px;">📋 LIVE ROSTER</h3>`;
  html += `<table style="width:100%; border-collapse:collapse; text-align:left; font-size:11px;">`;
  
  // Draw Headers
  html += `<tr style="background:var(--paper-panel); border-bottom:2px solid var(--ink-main);">`;
  const headers = ["Name", "HP", "Control", "Pos", "Elev", "Wpn 1", "Status"];
  headers.forEach(h => html += `<th style="padding:6px;">${h}</th>`);
  html += `</tr>`;

  // Draw Units
  for (let i = 1; i < state.roster.length; i++) {
    const r = state.roster[i];
    if (!r) continue;
    
    // Convert array values safely
    const name = r[0] || "Unknown";
    const hp = r[5] ?? 0;
    const control = r[15] || "AI";
    const pos = r[11] || "—";
    const elev = r[23] || "Ground";
    const wpn1 = r[8] || "Unarmed";
    const status = r[16] || "";

    const rowColor = hp <= 0 ? "color:var(--stamp-red); text-decoration:line-through;" : "color:var(--ink-main);";

    html += `<tr style="border-bottom:1px solid var(--sepia-border); ${rowColor}">
      <td style="padding:4px;"><b>${name}</b></td>
      <td style="padding:4px;">${hp}</td>
      <td style="padding:4px;">${control}</td>
      <td style="padding:4px;">${pos}</td>
      <td style="padding:4px;">${elev}</td>
      <td style="padding:4px;">${wpn1}</td>
      <td style="padding:4px; font-style:italic;">${status}</td>
    </tr>`;
  }
  
  html += `</table>`;
  container.innerHTML = html;
}