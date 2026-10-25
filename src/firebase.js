import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, update, push } from 'firebase/database';

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA5eoJNP9P1ZnoVrK2VR5P6XhXiLcPlYG0",
  authDomain: "crossfire-e25e5.firebaseapp.com",
  projectId: "crossfire-e25e5",
  storageBucket: "crossfire-e25e5.firebasestorage.app",
  messagingSenderId: "798510774034",
  appId: "1:798510774034:web:9ee8b88eb272413af5a5cb",
  measurementId: "G-R233J64LSW",
  databaseURL: "https://crossfire-e25e5-default-rtdb.europe-west1.firebasedatabase.app",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

// Global references to the virtual tabletop state
export const refs = {
  roster: ref(db, 'gameState/roster'),
  groundMap: ref(db, 'gameState/maps/ground'),
  roofMap: ref(db, 'gameState/maps/roof'),
  tokens: ref(db, 'gameState/tokens'),
  log: ref(db, 'gameLog'),
  heat: ref(db, 'gameState/heatLevel')
};

// Helper to push a unit update to the cloud
export function saveUnit(unitIndex, dataArray) {
  update(ref(db, `gameState/roster/${unitIndex}`), { data: dataArray });
}