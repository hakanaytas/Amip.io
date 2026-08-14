/* =========================================================================
   NET — window.FirebaseBridge etrafında ince bir sarmalayıcı.
   Mevcut Firestore altyapısı (leaderboard + live_players) korunur;
   oda/sohbet/avatar gibi yeni özellikler opsiyonel olarak eklenir.
   ========================================================================= */
import { uuid, MP_STALE_MS } from "./core.js";

export const LeaderboardManager = {
  key: "mikrop_arena_leaderboard_v1",
  async submit(name, score){
    if(window.FirebaseBridge && typeof window.FirebaseBridge.submitScore === "function"){
      try{ await window.FirebaseBridge.submitScore(name, score); return; }catch(e){}
    }
    let list = this._local();
    list.push({ name, score, ts: Date.now() });
    list.sort((a,b)=>b.score-a.score);
    list = list.slice(0,50);
    localStorage.setItem(this.key, JSON.stringify(list));
  },
  async top(n=10){
    if(window.FirebaseBridge && typeof window.FirebaseBridge.getTopScores === "function"){
      try{ return await window.FirebaseBridge.getTopScores(n); }catch(e){}
    }
    return this._local().slice(0,n);
  },
  // Çevrimdışı (Firebase'siz) yerel liste de aynı şekilde son 1 saatlik
  // pencereye göre filtrelenir, böylece davranış tutarlı olur.
  _local(){
    try{
      const cutoff = Date.now() - 60*60*1000;
      const list = JSON.parse(localStorage.getItem(this.key) || "[]");
      return list.filter(e => !e.ts || e.ts > cutoff).sort((a,b)=>b.score-a.score);
    }catch(e){ return []; }
  }
};

export class NetSession{
  constructor(){
    this.sessionId = this._getSessionId();
    this.remotePlayers = new Map();
    this.connected = false;
    this.roomCode = "";
    this._chatUnsub = null;
    this._playersUnsub = null;
    this.onDeath = null; // callback(eatenByName)
    this.onChat = null;  // callback(messages)
    this._deathHandled = false;
  }
  _getSessionId(){
    let id = sessionStorage.getItem("mikrop_session_id");
    if(!id){ id = uuid(); sessionStorage.setItem("mikrop_session_id", id); }
    return id;
  }
  start(){
    if(!window.FirebaseBridge || typeof window.FirebaseBridge.subscribePlayers !== "function"){
      this.connected = false;
      return false;
    }
    this.connected = true;
    try{
      this._playersUnsub = window.FirebaseBridge.subscribePlayers((list)=>this._onSnapshot(list));
    }catch(e){ this.connected = false; }
    return this.connected;
  }
  _onSnapshot(list){
    const now = Date.now();
    this.remotePlayers.clear();
    for(const p of list){
      if(p.id === this.sessionId){
        if(p.eatenBy && !this._deathHandled){
          this._deathHandled = true;
          if(this.onDeath) this.onDeath(p.eatenBy);
        }
        continue;
      }
      const t = (p.updatedAt && typeof p.updatedAt.toMillis === "function") ? p.updatedAt.toMillis() : now;
      if(now - t > MP_STALE_MS) continue;
      if(typeof p.x !== "number" || typeof p.y !== "number") continue;
      this.remotePlayers.set(p.id, p);
    }
  }
  resetDeathFlag(){ this._deathHandled = false; }
  join(data){
    if(!this.connected) return;
    window.FirebaseBridge.joinArena(this.sessionId, { ...data, roomCode: this.roomCode }).catch(()=>{});
  }
  update(data){
    if(!this.connected) return;
    window.FirebaseBridge.updatePosition(this.sessionId, { ...data, roomCode: this.roomCode }).catch(()=>{});
  }
  leave(){
    if(!this.connected) return;
    window.FirebaseBridge.leaveArena(this.sessionId).catch(()=>{});
  }
  leaveBestEffort(){
    if(this.connected && window.FirebaseBridge && typeof window.FirebaseBridge.leaveArena === "function"){
      try{ window.FirebaseBridge.leaveArena(this.sessionId); }catch(e){}
    }
  }
  reportEaten(targetId, byName){
    if(!this.connected) return Promise.resolve();
    return window.FirebaseBridge.reportEaten(targetId, byName).catch(()=>{});
  }

  /* ---- Oda / arkadaşla oynama ---- */
  async createRoom(hostName){
    if(!window.FirebaseBridge || typeof window.FirebaseBridge.createRoom !== "function") return null;
    try{
      const code = await window.FirebaseBridge.createRoom(hostName);
      this.roomCode = code;
      return code;
    }catch(e){ return null; }
  }
  setRoomCode(code){ this.roomCode = String(code||"").toUpperCase().slice(0,6); }
  leaveRoom(){ this.roomCode = ""; }

  /* ---- Sohbet ---- */
  connectChat(name){
    this.disconnectChat();
    if(!window.FirebaseBridge || typeof window.FirebaseBridge.subscribeChat !== "function") return;
    try{
      this._chatUnsub = window.FirebaseBridge.subscribeChat(this.roomCode, (msgs)=>{
        if(this.onChat) this.onChat(msgs);
      });
    }catch(e){}
  }
  disconnectChat(){
    if(this._chatUnsub){ try{ this._chatUnsub(); }catch(e){} this._chatUnsub = null; }
  }
  sendChat(name, text){
    if(!window.FirebaseBridge || typeof window.FirebaseBridge.sendChatMessage !== "function") return;
    window.FirebaseBridge.sendChatMessage(this.roomCode, name, text).catch(()=>{});
  }

  /* ---- Avatar yükleme ---- */
  async uploadAvatar(file){
    if(!window.FirebaseBridge || typeof window.FirebaseBridge.uploadAvatar !== "function") throw new Error("no-bridge");
    return await window.FirebaseBridge.uploadAvatar(this.sessionId, file);
  }
}
