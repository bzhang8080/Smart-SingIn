import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, push, child, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Helper to manage localStorage configuration
export const ConfigManager = {
  getConfig: () => {
    const configStr = localStorage.getItem('firebase_config');
    return configStr ? JSON.parse(configStr) : null;
  },
  saveConfig: (config) => {
    localStorage.setItem('firebase_config', JSON.stringify(config));
  },
  hasConfig: () => {
    return !!localStorage.getItem('firebase_config');
  }
};

let app = null;
let db = null;

export const initFirebase = () => {
  const config = ConfigManager.getConfig();
  if (!config) return false;

  try {
    if (!app) {
      app = initializeApp(config);
      db = getDatabase(app);
    }
    return true;
  } catch (error) {
    console.error("Firebase init error:", error);
    return false;
  }
};

// Auto init if config exists
initFirebase();

export { db, ref, set, get, update, onValue, push, child, serverTimestamp };
