/* =========================================================================
   INPUT — Karakter ASLA durmaz: doğduğu andan itibaren sürekli hareket eder.
   Oyuncu sadece YÖN belirler, karakteri "itmek" zorunda değildir.
   Mobilde: parmağın ekran merkezine göre açısı hedef yönü belirler; parmak
   kalksa bile karakter son yönde hareket etmeye devam eder (sürükleme YOK).
   Masaüstünde: fare işaretçisinin açısı (ve isteğe bağlı WASD/ok tuşları)
   aynı şekilde hedef yönü belirler. Shift ile hızlanma, ESC/TAB/M aynı.
   ========================================================================= */

export class InputManager{
  constructor(canvas, game){
    this.canvas = canvas;
    this.game = game;
    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    this.keys = {};
    this.boosting = false;

    // Karakterin şu anki ve hedeflenen bakış/hareket açısı (radyan).
    // Karakter HER ZAMAN bu yönde ilerler — hız her zaman tam hızdır.
    this.heading = -Math.PI/2;       // başlangıç: yukarı doğru
    this.targetHeading = this.heading;
    this.hasDirection = false;

    this.pointerX = 0; this.pointerY = 0;

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

    // ---- Fare (masaüstü): işaretçinin ekran merkezine göre açısı = hedef yön ----
    this.canvas.addEventListener("mousemove", (e)=>{
      this.pointerX = e.clientX; this.pointerY = e.clientY;
      this._updateHeadingFromPointer();
    });
    this.canvas.addEventListener("mousedown", ()=>{ this.boosting = true; });
    window.addEventListener("mouseup", ()=>{ this.boosting = false; });
    window.addEventListener("blur", ()=>{ this.boosting = false; this.keys = {}; });

    // ---- Dokunma (mobil): sürükleme YOK — parmak nerede olursa olsun ekran
    //      merkezine göre açısı hedef yönü belirler. Parmak kalkınca hiçbir
    //      şey sıfırlanmaz; karakter son yönde hareketine devam eder. ----
    const onTouch = (e)=>{
      const t = e.changedTouches[0];
      if(!t) return;
      this.pointerX = t.clientX; this.pointerY = t.clientY;
      this._updateHeadingFromPointer();
    };
    this.canvas.addEventListener("touchstart", (e)=>{ e.preventDefault(); onTouch(e); }, {passive:false});
    this.canvas.addEventListener("touchmove", (e)=>{ e.preventDefault(); onTouch(e); }, {passive:false});
    // touchend / touchcancel'de bilinçli olarak HİÇBİR ŞEY yapılmıyor —
    // karakter durmamalı, son yönünü korumalı.
    this.canvas.addEventListener("touchend", (e)=>{ e.preventDefault(); }, {passive:false});
    this.canvas.addEventListener("touchcancel", (e)=>{ e.preventDefault(); }, {passive:false});
  }

  _updateHeadingFromPointer(){
    const cx = this.canvas.clientWidth/2, cy = this.canvas.clientHeight/2;
    const dx = this.pointerX - cx, dy = this.pointerY - cy;
    if(Math.hypot(dx,dy) < 4) return; // tam merkezdeyse yönü değiştirme (titremeyi önler)
    this.targetHeading = Math.atan2(dy, dx);
    this.hasDirection = true;
  }

  /* Her round başında çağrılabilir: karakterin doğuşta bakacağı yönü ayarlar. */
  resetHeading(angle){
    this.heading = (typeof angle === "number") ? angle : Math.random()*Math.PI*2;
    this.targetHeading = this.heading;
    this.hasDirection = false;
  }

  /* dt: saniye. HER ZAMAN uzunluğu 1 olan bir yön vektörü döner — karakter
     asla durmaz, yalnızca yönü akıcı şekilde (açısal olarak) değişir. */
  getMoveVector(dt){
    // Masaüstünde WASD/ok tuşları da hedef yönü belirleyebilir.
    let kx=0, ky=0;
    if(this.keys["KeyW"]||this.keys["ArrowUp"]) ky -= 1;
    if(this.keys["KeyS"]||this.keys["ArrowDown"]) ky += 1;
    if(this.keys["KeyA"]||this.keys["ArrowLeft"]) kx -= 1;
    if(this.keys["KeyD"]||this.keys["ArrowRight"]) kx += 1;
    if(kx !== 0 || ky !== 0){
      this.targetHeading = Math.atan2(ky, kx);
      this.hasDirection = true;
    }

    // Yönü hedefe doğru akıcı şekilde (en kısa açısal yoldan) döndür.
    let diff = this.targetHeading - this.heading;
    while(diff > Math.PI) diff -= Math.PI*2;
    while(diff < -Math.PI) diff += Math.PI*2;
    const turnSpeed = 9.5; // rad/sn — dönüş çevikliği
    const maxStep = turnSpeed*dt;
    if(Math.abs(diff) <= maxStep) this.heading = this.targetHeading;
    else this.heading += Math.sign(diff)*maxStep;

    return { x: Math.cos(this.heading), y: Math.sin(this.heading) };
  }

  get isBoosting(){ return this.boosting; }
}
