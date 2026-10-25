# CROSSFIRE! Virtual Tabletop Engine

A modular, real-time Virtual Tabletop (VTT) built for tabletop skirmish games (1880s Wild West, 1920s Gangsters). Originally ported from a legacy Google Sheets macro engine ("Quickdraw!"), this modern web app features real-time multiplayer syncing, an integrated map editor, and a fully autonomous NPC AI system.

## 🛠️ Tech Stack
*   **Frontend Tooling:** Vite
*   **Rendering Engine:** PixiJS (WebGL)
*   **Database / Multiplayer:** Firebase Realtime Database
*   **Styling:** Native CSS (Grid/Flexbox)

## 📁 Project Architecture & File Directory

The engine is modularized to cleanly separate the rendering layer, the database layer, and the core game logic (math, combat, and AI).

### Core Application
*   **`index.html`**
    The main HTML skeleton. Contains all the UI layouts, sidebars, Modals (Lobby, Map Loader, Setup Wizard, Game Designer), and raw CSS styling.
*   **`src/main.js`**
    The central nervous system. Bootstraps the application, mounts all UI/Editor event listeners, and establishes the Firebase database listeners that trigger screen redraws.
*   **`src/state.js`**
    The global state manager. Holds the active map arrays (Ground & Roof), the live character Roster, and dynamically caches the terrain rules (movement penalties, cover values).
*   **`src/firebase.js`**
    Firebase configuration and specific database reference nodes (`activeGame/groundMap`, `activeGame/roster`, etc.).
*   **`src/ui.js`**
    Handles standard DOM manipulations, such as triggering Toast notifications, updating the "Dispatch" Game Log, and managing UI button highlights.

### VTT & Rendering
*   **`src/renderer.js`**
    The PixiJS WebGL renderer. Responsible for drawing the grid, rendering terrain colors/symbols, drawing character tokens with HP bars, and handling the "Click-to-Move" player logic.
*   **`src/editor.js`**
    Contains the logic for the Map Creation mode. Handles mouse dragging, brush tools (Paint, Erase, Fill, Rectangle, Line), and updating the map grid arrays.
*   **`src/lobby.js`**
    Manages the Setup Wizard. Handles scenario generation, loading saved maps from the database, and dynamically spawning enemies and players onto the Roster.
*   **`src/designer.js`**
    The "Under the Hood" diagnostics suite. Provides a floating UI window to inspect Live Roster data, monitor AI Telemetry, and test the Line-of-Sight Matrix.

### Game Mechanics (The Rules Engine)
*   **`src/engine_math.js`**
    The geometry and physics core. Contains the coordinate converters (`A1` to `X/Y`), diagonal tabletop distance calculations, and the Bresenham raycaster for checking Line of Sight and Cover (`checkLOSAndCover`).
*   **`src/engine_combat.js`**
    The resolution core. Handles weapon stat lookups, calculates Target Numbers (TN) based on range and cover, resolves D20 locational damage, and applies wounds directly to Firebase.
*   **`src/engine_ai.js`**
    The autonomous NPC Brain. A state machine that evaluates the board layout, selects targets based on threat/distance, paths toward objectives (e.g., Vaults/Loot), and executes attacks.

## 🚀 Running Locally

1. Clone the repository.
2. Run `npm install` to install dependencies (Vite, PixiJS, Firebase).
3. Ensure your Firebase configuration in `src/firebase.js` is correct (including the `databaseURL` for your specific region).
4. Run `npm run dev` to launch the local Vite development server.
```eof
