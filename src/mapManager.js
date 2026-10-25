import { ref, get, set } from 'firebase/database';
import { db, refs } from './firebase.js';
import { state } from './state.js';
import { showToast } from './ui.js';

/**
 * Saves the current active map state into the persistent 'savedMaps' database node.
 */
export async function saveMapSet(mapName) {
  if (!mapName || mapName.trim() === "") return;
  
  try {
    // Create a reference to a specific named map inside the savedMaps directory
    const savedMapRef = ref(db, `savedMaps/${mapName}`);
    
    await set(savedMapRef, {
      ground: state.maps.ground,
      roof: state.maps.roof
    });
    
    showToast(`✅ Map '${mapName}' saved successfully!`);
  } catch (error) {
    console.error("Error saving map:", error);
    showToast("❌ Error saving map.");
  }
}

/**
 * Loads a map from 'savedMaps' and pushes it to the active game state.
 */
export async function loadMapSet(mapName) {
  if (!mapName || mapName.trim() === "") return;
  
  try {
    const savedMapRef = ref(db, `savedMaps/${mapName}`);
    const snapshot = await get(savedMapRef);
    
    if (snapshot.exists()) {
      const data = snapshot.val();
      
      // Push the loaded data into the active real-time game state
      // This will trigger the onValue listeners in main.js and redraw the canvas!
      await set(refs.groundMap, data.ground || []);
      await set(refs.roofMap, data.roof || []);
      
      showToast(`📂 Map '${mapName}' loaded into active game!`);
    } else {
      showToast(`⚠️ Map '${mapName}' not found in database.`);
    }
  } catch (error) {
    console.error("Error loading map:", error);
    showToast("❌ Error loading map.");
  }
}