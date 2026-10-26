// ==========================================
// QUICKDRAW VTT - MASTER DATA TABLES
// ==========================================

export const WEAPON_DB = {
    "colt .45": { pb: -2, short: 2, medium: 0, long: -6, extreme: null, cap: 6, h2h: "Club", isShoulder: false, isSidearm: true },
    "smith & wesson no. 3": { pb: -2, short: 2, medium: 1, long: -5, extreme: null, cap: 6, h2h: "Club", isShoulder: false, isSidearm: true },
    "double derringer": { pb: 4, short: 2, medium: null, long: null, extreme: null, cap: 2, h2h: null, isShoulder: false, isSidearm: true },
    "winchester": { pb: -4, short: -2, medium: 2, long: 0, extreme: -6, cap: 12, h2h: "Club", isShoulder: true, isSidearm: false },
    "buffalo rifle": { pb: -4, short: -2, medium: 2, long: 4, extreme: 0, cap: 1, h2h: "Club", isShoulder: true, isSidearm: false },
    "shotgun": { pb: -4, short: 8, medium: 4, long: 0, extreme: null, cap: 2, h2h: "Club", isShoulder: true, isSidearm: false },
    "sawn-off shotgun": { pb: 0, short: 8, medium: 2, long: null, extreme: null, cap: 2, h2h: "Club", isShoulder: false, isSidearm: true },
    "thompson smg": { pb: 0, short: 6, medium: 0, long: -4, extreme: null, cap: 50, h2h: "Club", isShoulder: true, isSidearm: false },
    "club": { pb: 2, short: null, medium: null, long: null, extreme: null, cap: null, h2h: "Club", isShoulder: false, isSidearm: false },
    "knife": { pb: 3, short: 0, medium: null, long: null, extreme: null, cap: null, h2h: "Knife", isShoulder: false, isSidearm: true },
    "unarmed": { pb: 0, short: null, medium: null, long: null, extreme: null, cap: null, h2h: "Unarmed", isShoulder: false, isSidearm: false }
};

// Rolls 1-20 determine the body part hit.
export const DAMAGE_DB = [
    { min: 1, max: 1, loc: "HEAD", die: 20, lethal: true },
    { min: 2, max: 5, loc: "CHEST", die: 12, lethal: false },
    { min: 6, max: 7, loc: "BELLY", die: 12, lethal: false },
    { min: 8, max: 9, loc: "LEFT LEG", die: 8, lethal: false },
    { min: 10, max: 11, loc: "RIGHT LEG", die: 8, lethal: false },
    { min: 12, max: 15, loc: "LEFT ARM", die: 6, lethal: false },
    { min: 16, max: 19, loc: "RIGHT ARM", die: 6, lethal: false },
    { min: 20, max: 20, loc: "GRAZE", die: 1, lethal: false }
];

// Max inches a unit can move per turn
export const MOVEMENT_DB = {
    "crawl": { inches: 2, mounted: false },
    "walk": { inches: 6, mounted: false },
    "run": { inches: 12, mounted: false },
    "walking horse": { inches: 8, mounted: true },
    "trotting horse": { inches: 12, mounted: true },
    "cantering horse": { inches: 18, mounted: true }
};