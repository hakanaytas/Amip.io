import { SettingsManager, ProfileManager } from "./core.js";
import { Game } from "./game.js";

window.addEventListener("DOMContentLoaded", ()=>{
  SettingsManager.load();
  ProfileManager.load();
  window.__game = new Game();
});
