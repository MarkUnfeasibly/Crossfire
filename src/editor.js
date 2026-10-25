import { set } from 'firebase/database';
import { refs } from './firebase.js';
import { state } from './state.js';
import { renderMap, cellSize, setRenderLayer } from './renderer.js';

export let currentLayer = 'ground';
export let currentTool = 'paint';
export let currentTerrain = 'W0';

let isDrawing = false;
let rectStart = null;
let lineStart = null;

export function setTool(t) { 
  currentTool = t; 
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-' + t);
  if (btn) btn.classList.add('active');
}

export function setLayer(l) { 
  currentLayer = l; 
  document.getElementById('layer-ground').classList.toggle('active', l === 'ground');
  document.getElementById('layer-roof').classList.toggle('active', l === 'roof');
  
  // 🎯 Tell PixiJS to swap the canvas view!
  setRenderLayer(l); 
}

export function setTerrain(sym) { 
  currentTerrain = sym; 
  if (currentTool === 'erase') setTool('paint');
  document.querySelectorAll('.terrain-tile').forEach(t => t.classList.remove('active'));
  const tile = document.getElementById('terrain-' + sym);
  if (tile) tile.classList.add('active');
}

// 🎯 THE FIX: Bulletproof coordinate math resistant to Zoom and CSS Centering
function getCellFromEvent(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  
  // Get exact mouse position inside the canvas edges
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  // Safely get the number of columns and rows
  const cols = state.maps.ground?.[0]?.length || 48;
  const rows = state.maps.ground?.length || 48;
  
  // Calculate percentage (x / width) and multiply by grid size
  const c = Math.floor((x / rect.width) * cols);
  const r = Math.floor((y / rect.height) * rows);
  
  return { r, c };
}

function pushMapUpdate() {
  const activeMap = currentLayer === 'ground' ? state.maps.ground : state.maps.roof;
  const targetRef = currentLayer === 'ground' ? refs.groundMap : refs.roofMap;
  set(targetRef, activeMap);
}

function paintCell(r, c, sym) {
  let activeMap = currentLayer === 'ground' ? state.maps.ground : state.maps.roof;
  if (!activeMap || r < 0 || r >= activeMap.length || c < 0 || c >= activeMap[0].length) return;
  activeMap[r][c] = sym;
  renderMap(); // Instantly update the screen while dragging!
}

function floodFill(r, c, newSym) {
  let activeMap = currentLayer === 'ground' ? state.maps.ground : state.maps.roof;
  if (!activeMap || r < 0 || r >= activeMap.length || c < 0 || c >= activeMap[0].length) return;
  
  const target = activeMap[r][c];
  if (target === newSym) return;
  const stack = [{r,c}];
  while (stack.length) {
    const {r:cr, c:cc} = stack.pop();
    if (cr<0 || cr>=activeMap.length || cc<0 || cc>=activeMap[0].length) continue;
    if (activeMap[cr][cc] !== target) continue;
    activeMap[cr][cc] = newSym;
    stack.push({r:cr-1,c:cc}, {r:cr+1,c:cc}, {r:cr,c:cc-1}, {r:cr,c:cc+1});
  }
}

function drawRect(r1, c1, r2, c2, sym) {
  const minR = Math.min(r1,r2), maxR = Math.max(r1,r2);
  const minC = Math.min(c1,c2), maxC = Math.max(c1,c2);
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) paintCell(r, c, sym);
  }
}

function drawLine(r1, c1, r2, c2, sym) {
  let dr = Math.abs(r2 - r1), dc = Math.abs(c2 - c1);
  let sr = r1 < r2 ? 1 : -1, sc = c1 < c2 ? 1 : -1;
  let err = dc - dr, r = r1, c = c1;
  while (true) {
    paintCell(r, c, sym);
    if (r === r2 && c === c2) break;
    let e2 = 2 * err;
    if (e2 > -dr) { err -= dr; c += sc; }
    if (e2 < dc) { err += dc; r += sr; }
  }
}

export function attachEditorListeners(canvasElement) {
  canvasElement.addEventListener('mousedown', (e) => {
    if (!document.body.classList.contains('mode-edit')) return;
    isDrawing = true;
    const { r, c } = getCellFromEvent(e, canvasElement);
    const sym = currentTool === 'erase' ? '' : currentTerrain;
    
    if (currentTool === 'fill') {
      floodFill(r, c, sym);
      pushMapUpdate();
    } else if (currentTool === 'rect') {
      rectStart = {r, c};
    } else if (currentTool === 'line') {
      lineStart = {r, c};
    } else {
      paintCell(r, c, sym);
      pushMapUpdate();
    }
  });

  canvasElement.addEventListener('mousemove', (e) => {
    if (!isDrawing || !document.body.classList.contains('mode-edit')) return;
    const { r, c } = getCellFromEvent(e, canvasElement);
    const sym = currentTool === 'erase' ? '' : currentTerrain;
    
    if (currentTool === 'paint' || currentTool === 'erase') {
      paintCell(r, c, sym);
    }
  });

  canvasElement.addEventListener('mouseup', (e) => {
    if (!isDrawing || !document.body.classList.contains('mode-edit')) {
      isDrawing = false;
      return;
    }
    isDrawing = false;
    const { r, c } = getCellFromEvent(e, canvasElement);
    const sym = currentTool === 'erase' ? '' : currentTerrain;
    
    if (currentTool === 'rect' && rectStart) {
      drawRect(rectStart.r, rectStart.c, r, c, sym);
      rectStart = null;
    } else if (currentTool === 'line' && lineStart) {
      drawLine(lineStart.r, lineStart.c, r, c, sym);
      lineStart = null;
    }
    pushMapUpdate();
  });

  canvasElement.addEventListener('mouseleave', () => {
    if (isDrawing) {
      isDrawing = false;
      pushMapUpdate();
    }
  });
}