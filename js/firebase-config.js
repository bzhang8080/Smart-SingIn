// Firebase SDK - 使用本地化文件（避免 gstatic.com 在中国大陆不可达）
import { initializeApp } from "./lib/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, push, child, serverTimestamp, remove } from "./lib/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut, onAuthStateChanged, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "./lib/firebase-auth.js";

// Hardcoded config for GitHub Pages deployment
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDfjqvSkLg25OFDBQIG8geM_s5oDbhTMtA",
  authDomain: "smartsignin-c0878.firebaseapp.com",
  databaseURL: "https://smartsignin-c0878-default-rtdb.firebaseio.com",
  projectId: "smartsignin-c0878"
};

// Helper to manage localStorage configuration (kept for backwards compatibility with UI)
export const ConfigManager = {
  getConfig: () => FIREBASE_CONFIG,
  saveConfig: (config) => {
    // No-op, we use hardcoded config now
  },
  hasConfig: () => true
};

let app = null;
let db = null;
let auth = null;

export const initFirebase = () => {
  try {
    if (!app) {
      app = initializeApp(FIREBASE_CONFIG);
      db = getDatabase(app);
      auth = getAuth(app);
    }
    return true;
  } catch (error) {
    console.error("Firebase init error:", error);
    return false;
  }
};

// Auto init
initFirebase();

export { db, auth, ref, set, get, update, onValue, push, child, serverTimestamp, remove };
export { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut, onAuthStateChanged, updatePassword, EmailAuthProvider, reauthenticateWithCredential };
