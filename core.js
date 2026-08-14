/* =========================================================================
   CORE — sabitler, matematik yardımcıları, ayarlar, ses
   ========================================================================= */

export const WORLD_SIZE = 7000;
export const BASE_RADIUS = 20;
export const MASS_TO_RADIUS_K = 6.2;
export const FOOD_RADIUS = 6;
export const FOOD_MASS = 5;
export const BONUS_FOOD_MASS = 40;
export const MAX_SPEED = 260;
export const MIN_SPEED = 58;
export const BOOST_MULT = 1.55;
export const BOOST_COST_PER_SEC = 14;
export const EAT_RATIO = 1.15;
export const MP_WRITE_INTERVAL = 0.15;
export const MP_STALE_MS = 8000;
export const SHIELD_DURATION = 10; // saniye — respawn koruması
export const FOOD_TARGET_BASE = { low: 260, mid: 480, high: 760 };
export const OBSTACLE_COUNT = { low: 26, mid: 42, high: 60 };
export const PLANT_COUNT = { low: 40, mid: 70, high: 110 };

/* ---- Yılan Modu (Snake Mode) ---- */
export const SNAKE_MIN_SEGMENTS = 8;
export const SNAKE_MAX_SEGMENTS = 90;
export const SNAKE_SEG_SPACING_MIN = 7;
export const SNAKE_SEG_SPACING_MAX = 20;

export const THEMES = {
  abyss:  { bg:"#070a12", grid:"rgba(67,236,196,0.06)", accent:"#43ecc4" },
  neon:   { bg:"#05060f", grid:"rgba(255,79,129,0.08)", accent:"#ff4f81" },
  sunset: { bg:"#150b16", grid:"rgba(255,200,87,0.08)", accent:"#ffc857" },
};

export const SKIN_COLORS = [
  "#43ecc4", "#ff4f81", "#ffc857", "#7c8cff", "#ff8a4c",
  "#4cd9ff", "#c874ff", "#8bff6b", "#ff6b6b", "#ffffff",
];

export const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
export const lerp = (a,b,t)=>a+(b-a)*t;
export const dist2 = (ax,ay,bx,by)=>{const dx=ax-bx,dy=ay-by; return dx*dx+dy*dy;};
export const dist = (ax,ay,bx,by)=>Math.hypot(ax-bx,ay-by);
export const rand = (a,b)=>a+Math.random()*(b-a);
export const randInt = (a,b)=>Math.floor(rand(a,b+1));
export const fmtTime = (s)=>{
  const m = Math.floor(s/60).toString().padStart(2,"0");
  const sec = Math.floor(s%60).toString().padStart(2,"0");
  return `${m}:${sec}`;
};
export const radiusForMass = (mass)=> BASE_RADIUS + Math.sqrt(Math.max(0,mass)) * MASS_TO_RADIUS_K * 0.28;
export const speedForRadius = (r)=> clamp(MAX_SPEED - (r-BASE_RADIUS)*0.85, MIN_SPEED, MAX_SPEED);

export function uuid(){
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("id_" + Math.random().toString(36).slice(2) + Date.now());
}

/* ---------------------------------------------------------------------
   AYAR YÖNETİCİSİ
--------------------------------------------------------------------- */
export const SettingsManager = {
  key: "mikrop_arena_settings_v2",
  data: {
    sfx: 70, music: 40, quality: "mid",
    showFps: false, theme: "abyss",
    soundOn: true, musicOn: true, vibrateOn: true,
    minimapOn: true,
    botCount: 6,
    mode: "classic", // "classic" | "snake" — oyun modu
  },
  load(){
    try{
      const raw = localStorage.getItem(this.key);
      if(raw) Object.assign(this.data, JSON.parse(raw));
    }catch(e){}
    return this.data;
  },
  save(){
    try{ localStorage.setItem(this.key, JSON.stringify(this.data)); }catch(e){}
  }
};

/* ---------------------------------------------------------------------
   PROFİL — isim, renk, avatar (kalıcı, cihazda saklanır)
--------------------------------------------------------------------- */
export const ProfileManager = {
  key: "mikrop_arena_profile_v1",
  data: {
    name: "Sen",
    color: SKIN_COLORS[0],
    avatarUrl: "",
    gamesPlayed: 0,
    bestScore: 0,
    totalEaten: 0,
  },
  load(){
    try{
      const raw = localStorage.getItem(this.key);
      if(raw) Object.assign(this.data, JSON.parse(raw));
    }catch(e){}
    return this.data;
  },
  save(){
    try{ localStorage.setItem(this.key, JSON.stringify(this.data)); }catch(e){}
  }
};

/* ---------------------------------------------------------------------
   SES YÖNETİCİSİ (WebAudio, prosedürel — harici dosya yok)
--------------------------------------------------------------------- */
export const SoundManager = {
  ctx: null,
  musicNodes: null,
  ensureCtx(){
    if(!this.ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(AC) this.ctx = new AC();
    }
    if(this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  blip(freq=440, dur=0.08, type="sine", vol=1){
    if(!SettingsManager.data.soundOn) return;
    const ctx = this.ensureCtx(); if(!ctx) return;
    const g = ctx.createGain();
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const v = (SettingsManager.data.sfx/100) * 0.25 * vol;
    g.gain.setValueAtTime(v, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  },
  eat(){ this.blip(rand(500,700), 0.09, "triangle", 0.9); },
  eatBonus(){ this.blip(880, 0.15, "sine", 1); this.blip(1100,0.12,"sine",0.7); },
  eatBig(){ this.blip(220, 0.25, "sawtooth", 1); this.blip(330,0.2,"sawtooth",0.6); },
  death(){ this.blip(160,0.5,"sawtooth",1); },
  click(){ this.blip(380,0.05,"square",0.5); },
  hazard(){ this.blip(140,0.18,"square",0.7); },
  portal(){ this.blip(660,0.2,"sine",0.8); this.blip(990,0.15,"sine",0.5); },
  startMusic(){
    if(!SettingsManager.data.musicOn) return;
    const ctx = this.ensureCtx(); if(!ctx || this.musicNodes) return;
    const master = ctx.createGain();
    master.gain.value = (SettingsManager.data.music/100) * 0.06;
    master.connect(ctx.destination);
    const notes = [110, 130.81, 146.83, 164.81];
    const oscs = notes.map((f,i)=>{
      const o = ctx.createOscillator();
      o.type = "sine"; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.5/(i+1);
      o.connect(g); g.connect(master);
      o.start();
      return o;
    });
    this.musicNodes = { master, oscs };
  },
  stopMusic(){
    if(this.musicNodes){
      this.musicNodes.oscs.forEach(o=>{ try{o.stop();}catch(e){} });
      this.musicNodes = null;
    }
  },
  updateVolumes(){
    if(this.musicNodes) this.musicNodes.master.gain.value = (SettingsManager.data.music/100)*0.06;
  },
  vibrate(pattern){
    if(SettingsManager.data.vibrateOn && navigator.vibrate) navigator.vibrate(pattern);
  }
};
