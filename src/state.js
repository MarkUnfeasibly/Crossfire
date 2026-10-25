export const state = {
  roster: [],
  maps: {
    ground: [],
    roof: [],
    occupied: new Map()
  },
  tokens: { loot: null, vip: null, extract: null },
  terrainCache: {},
  heatLevel: 0
};

export const TERRAIN = [
  { sym:'W0', name:'Wall', color:'#3d2a1d', border:'#1a1009', blocksMove:true, blocksLOS:true },
  { sym:'W1', name:'Lrg Window', color:'#6b7c87', border:'#3d4c53', blocksMove:true, blocksLOS:false },
  { sym:'W2', name:'Sml Window', color:'#4c5e69', border:'#2b373f', blocksMove:true, blocksLOS:false },
  { sym:'W3', name:'Roof Int', color:'#8a755d', border:'#4a3d2e', blocksMove:false, blocksLOS:false },
  { sym:'W4', name:'Roof Edge', color:'#5e4a36', border:'#33261a', blocksMove:false, blocksLOS:false },
  { sym:'D', name:'Door', color:'#6b3f22', border:'#3d1f0e', blocksMove:false, blocksLOS:true },
  { sym:'F', name:'Fence', color:'#948669', border:'#544b38', blocksMove:false, blocksLOS:false, moveTax: 2, abilityRoll: true },
  { sym:'G', name:'Grass/Scrub', color:'#b5aa8c', border:'#857a5e', blocksMove:false, blocksLOS:false, cover: true },
  { sym:'R', name:'Rubble', color:'#73695e', border:'#403932', blocksMove:false, blocksLOS:false },
  { sym:'L', name:'Ladder', color:'#8f6842', border:'#4a301a', blocksMove:false, blocksLOS:false },
  { sym:'V0', name:'Engine Bay', color:'#2c3e50', border:'#0f172a', blocksMove:true, blocksLOS:true },
  { sym:'V1', name:'Vehicle Cab', color:'#334155', border:'#1e293b', blocksMove:false, blocksLOS:false, cover: true },
  { sym:'V2', name:'Flatbed', color:'#475569', border:'#334155', blocksMove:true, blocksLOS:true, cover: true }
];

export function buildTerrainCache() {
  state.terrainCache = Object.fromEntries(TERRAIN.map(t => [t.sym, t]));
}

// Map Updater (Replaces getMaps from V8.3)
export function updateOccupiedMap() {
  state.maps.occupied.clear();
  for(let i = 1; i < state.roster.length; i++) {
    let unit = state.roster[i];
    if (unit && unit.data && Number(unit.data[5]) > 0 && unit.data[11]) { 
      let p = unit.data[11];
      let e = unit.data[23] || "Ground"; 
      let faction = unit.data[15]; 
      state.maps.occupied.set(p + "_" + e, faction);
    }
  }
}