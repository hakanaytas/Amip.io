/* =========================================================================
   INPUT — Joystick YOK. Mobilde: ekrana dokunup sürükleyerek yön belirleme,
   parmak kalkınca akıcı yavaşlayan "glide" hareketi.
   Masaüstünde: fare, WASD, ok tuşları, Shift hızlanma, ESC, TAB, M.
   ========================================================================= */
import { clamp } from "./core.js";

export class InputManager{
  constructor(canvas, game){
    this.canvas = canvas;
    this.game = game;
    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    this.keys = {};
    this.mouse = { x:0, y:0, active:false };
    this.boosting = false;

    // Dokunma sürükleme durumu
    this.touch = {
      active:false,          // parmak şu an ekranda mı
      id:null,
      startX:0, startY:0,
      curX:0, curY:0,
      dirX:0, dirY:0,        // normalize yön
      mag:0,                 // 0..1 sürüklemenin gücü (hıza etki eder)
      glideX:0, glideY:0,    // parmak kalktıktan sonraki "devam" yönü
      glideT:0,              // glide'ın kalan süresi
    };

    this._bind();
  }

  _bind(){
    // ---- Klavye (masaüstü) ----
    window.addEventListener("keydown", (e)=>{
      this.keys[e.code] = true;
      if(e.code === "Escape") this.game.onEscape();
      if(e.code === "ShiftLeft" || e.code === "ShiftRight") this.boosting = true;
      if(e.code === "Tab"){ e.preventDefault(); this.game.setScoreboardVisible(true); }
      if(e.code === "KeyM") this.game.toggleMinimap();
    });
    window.addEventListener("keyup", (e)=>{
      this.keys[e.code] = false;
      if(e.code === "ShiftLeft" || e.code === "ShiftRight") this.boosting = false;
      if(e.code === "Tab") this.game.setScoreboardVisible(false);
    });

    // ---- Fare (masaüstü) ----
    this.canvas.addEventListener("mousemove", (e)=>{
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.active = true;
    });
    this.canvas.addEventListener("mousedown", ()=>{ this.boosting = true; });
    window.addEventListener("mouseup", ()=>{ this.boosting = false; });
    window.addEventListener("blur", ()=>{ this.boosting = false; this.keys = {}; });

    // ---- Dokunma sürükleme (mobil) : joystick YOK, her yere dokunulabilir ----
    const onStart = (e)=>{
      const t = e.changedTouches[0];
      this.touch.active = true;
      this.touch.id = t.identifier;
      this.touch.startX = t.clientX; this.touch.startY = t.clientY;
      this.touch.curX = t.clientX; this.touch.curY = t.clientY;
      this.touch.glideT = 0;
      this._updateTouchVector();
    };
    const onMove = (e)=>{
      if(!this.touch.active) return;
      for(const t of e.changedTouches){
        if(t.identifier !== this.touch.id) continue;
        this.touch.curX = t.clientX; this.touch.curY = t.clientY;
        this._updateTouchVector();
      }
    };
    const onEnd = (e)=>{
      for(const t of e.changedTouches){
        if(t.identifier !== this.touch.id) continue;
        // Parmak kalktığında: son yönde kısa süre "glide" (akıcı devam + yavaşlama)
        this.touch.glideX = this.touch.dirX;
        this.touch.glideY = this.touch.dirY;
        this.touch.glideT = 0.55; // saniye
        this.touch.active = false;
        this.touch.id = null;
        this.touch.mag = 0;
      }
    };
    this.canvas.addEventListener("touchstart", (e)=>{ e.preventDefault(); onStart(e); }, {passive:false});
    this.canvas.addEventListener("touchmove", (e)=>{ e.preventDefault(); onMove(e); }, {passive:false});
    this.canvas.addEventListener("touchend", (e)=>{ e.preventDefault(); onEnd(e); }, {passive:false});
    this.canvas.addEventListener("touchcancel", (e)=>{ e.preventDefault(); onEnd(e); }, {passive:false});
  }

  _updateTouchVector(){
    const dx = this.touch.curX - this.touch.startX;
    const dy = this.touch.curY - this.touch.startY;
    const d = Math.hypot(dx,dy);
    const DEAD = 6;      // ölü bölge — küçük titremeleri yok say
    const FULL = 70;     // bu mesafede tam hız
    if(d < DEAD){ this.touch.dirX = 0; this.touch.dirY = 0; this.touch.mag = 0; return; }
    this.touch.dirX = dx/d; this.touch.dirY = dy/d;
    this.touch.mag = clamp((d-DEAD)/(FULL-DEAD), 0, 1);
    // Sürükleme "merkezi" parmakla birlikte kayar (sonsuz sürükleme alanı) —
    // böylece oyuncu ekranın herhangi bir yerinden yön değiştirebilir.
    this.touch.startX = lerp2(this.touch.startX, this.touch.curX, 0.06);
    this.touch.startY = lerp2(this.touch.startY, this.touch.curY, 0.06);
  }

  /* dt: saniye. Geri döndürülen {x,y} -1..1 aralığında yön vektörü (uzunluk<=1),
     ve mag: hız çarpanı (0..1) — sürükleme mesafesine bağlı doğal ivmelenme. */
  getMoveVector(dt){
    if(this.isTouch){
      if(this.touch.active && this.touch.mag > 0){
        return { x: this.touch.dirX*this.touch.mag, y: this.touch.dirY*this.touch.mag, gliding:false };
      }
      if(this.touch.glideT > 0){
        this.touch.glideT = Math.max(0, this.touch.glideT - dt);
        const ease = this.touch.glideT/0.55; // 1 -> 0 yavaşlama eğrisi
        return { x: this.touch.glideX*ease, y: this.touch.glideY*ease, gliding:true };
      }
      return { x:0, y:0, gliding:false };
    }
    // Masaüstü: fare + WASD/ok tuşları birleşik
    let dx=0, dy=0;
    if(this.mouse.active){
      dx = this.mouse.x - this.canvas.clientWidth/2;
      dy = this.mouse.y - this.canvas.clientHeight/2;
    }
    if(this.keys["KeyW"]||this.keys["ArrowUp"]) dy -= 240;
    if(this.keys["KeyS"]||this.keys["ArrowDown"]) dy += 240;
    if(this.keys["KeyA"]||this.keys["ArrowLeft"]) dx -= 240;
    if(this.keys["KeyD"]||this.keys["ArrowRight"]) dx += 240;
    const d = Math.hypot(dx,dy);
    if(d < 4) return { x:0, y:0, gliding:false };
    const mag = clamp(d/160, 0.35, 1); // fareye yakınsa daha yumuşak başlangıç
    return { x: dx/d*mag, y: dy/d*mag, gliding:false };
  }

  get isBoosting(){ return this.boosting; }
}

function lerp2(a,b,t){ return a+(b-a)*t; }
