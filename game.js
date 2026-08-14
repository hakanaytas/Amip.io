/* =========================================================================
   GAME — ana oyun döngüsü ve durum makinesi
   ========================================================================= */
import {
  WORLD_SIZE, BASE_RADIUS, FOOD_MASS, BONUS_FOOD_MASS, MAX_SPEED,
  BOOST_MULT, BOOST_COST_PER_SEC, EAT_RATIO, MP_WRITE_INTERVAL, SPEED_LERP_RATE,
  clamp, lerp, dist2, rand, fmtTime, radiusForMass, speedForRadius,
  THEMES, SettingsManager, ProfileManager, SoundManager,
} from "./core.js";
import { World, Blob } from "./world.js";
import { BotManager } from "./bots.js";
import { InputManager } from "./input.js";
import { drawWorld, drawBlob, drawSnakeBody, drawMinimap, ParticleSystem } from "./render.js";
import { NetSession, LeaderboardManager } from "./net.js";
import { $, show, hide, toast, bindStaticUI, refreshProfileUI, refreshHudLeaderboard, escapeHtml } from "./ui.js";

export class Game{
  constructor(){
    this.canvas = $("gameCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.minimapCanvas = $("minimap");
    this.minimapCtx = this.minimapCanvas.getContext("2d");

    this.dpr = 1;
    this.viewW = 0; this.viewH = 0;
    this.state = "menu"; // menu | playing | paused | gameover
    this.playerName = ProfileManager.data.name;
    this.world = new World(SettingsManager.data.quality);
    this.botManager = new BotManager(this.world);
    this.player = null;
    this.camera = { x: WORLD_SIZE/2, y: WORLD_SIZE/2, zoom: 1 };
    this.particles = new ParticleSystem();

    this.lastTime = performance.now();
    this.elapsed = 0;
    this.fps = 60; this._fpsFrames = 0; this._fpsTimer = 0;
    this.maxSizeReached = 0;
    this._eatCooldown = new Map(); // targetId -> son yeme zamanı (ard arda aynı oyuncuyu yeme spamını önler)

    this.input = new InputManager(this.canvas, this);
    this.net = new NetSession();
    this.net.onDeath = (name)=> this.gameOver(name);
    this.net.onChat = (msgs)=> this._renderChat(msgs);

    // KRİTİK: "Oyuna Başla" ve temel menü butonları en önce, en dışta,
    // hiçbir başka kuruluma bağlı olmadan bağlanır. Böylece aşağıdaki
    // (Firebase, ses, avatar vb.) kurulumlardan biri hata verse bile
    // oyun ilk tıklamada mutlaka başlar.
    this._bindCoreButtons();

    this._bindResize();
    try{ this._bindUIHooks(); }
    catch(err){ console.error("[Game] bindStaticUI kurulumunda hata (yoksayılıp devam ediliyor):", err); }
    this._resize();

    window.addEventListener("pagehide", ()=>{ this.net.leaveBestEffort(); });
    window.addEventListener("beforeunload", ()=>{ this.net.leaveBestEffort(); });

    try{
      this.net.start();
      if(this.net.connected) toast("Firestore'a bağlandı — hazır");
    }catch(err){
      console.warn("[Game] Firebase bağlantısı kurulamadı, çevrimdışı devam ediliyor:", err);
    }

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    refreshHudLeaderboard(this._liveNames()).catch(()=>{});
  }

  /* En kritik, hep çalışması gereken butonlar. bindStaticUI'dan bağımsızdır. */
  _bindCoreButtons(){
    const btnPlay = $("btnPlay");
    if(btnPlay) btnPlay.onclick = ()=>{ SoundManager.click(); this.net.setRoomCode(""); this.startGame(); };
    else console.error('[Game] "#btnPlay" bulunamadı — Oyuna Başla butonu çalışmayacak!');

    const nameInput = $("playerNameInput");
    if(nameInput) nameInput.addEventListener("keydown",(e)=>{ if(e.key==="Enter") this.startGame(); });
  }

  /* ---------------- UI kancaları ---------------- */
  _bindUIHooks(){
    bindStaticUI({
      uploadAvatar: (file)=> this.net.uploadAvatar(file),
      onQualityChange: (q)=>{ this.world.quality = q; this.world.reseedFood(); this.world._generateStatic(); },
      onModeChange: (m)=>{ toast(m === "snake" ? "Yılan Modu — bir dahaki oyunda aktif olacak" : "Klasik Mod — bir dahaki oyunda aktif olacak"); },
      onMinimapToggle: (on)=>{ if(on) this._resizeMinimap(); },
      onCreateRoom: async ()=>{
        SoundManager.click();
        const code = await this.net.createRoom(ProfileManager.data.name);
        if(!code){ toast("Oda oluşturulamadı — çevrimdışı"); return; }
        $("roomCodeText").textContent = code;
        show("screenPlayFriend"); // kalsın
        document.getElementById("roomCreatedBox").classList.remove("hidden");
        document.getElementById("btnStartRoomGame").classList.remove("hidden");
        this._watchRoom(code);
        toast(`Oda oluşturuldu: ${code}`);
      },
      onJoinRoom: (code)=>{
        const c = String(code||"").trim().toUpperCase();
        if(c.length < 3){ toast("Geçerli bir oda kodu gir"); return; }
        this.net.setRoomCode(c);
        $("roomCodeText").textContent = c;
        document.getElementById("roomCreatedBox").classList.remove("hidden");
        document.getElementById("btnStartRoomGame").classList.remove("hidden");
        this._watchRoom(c);
        toast(`"${c}" odasına katılıyorsun`);
      },
      onStartRoomGame: ()=>{ hide("screenPlayFriend"); this.startGame(); },
      onSendChat: (text)=>{
        const t = (text||"").trim();
        if(!t) return;
        this.net.sendChat(ProfileManager.data.name, t);
        $("chatInput").value = "";
      },
      onPlayAgain: ()=> this.startGame(true),
      onMainMenu: ()=> this.goMainMenu(),
      onPause: ()=> this.pause(),
      onResume: ()=> this.resume(),
      onRestart: ()=> this.startGame(true),
      onQuit: ()=> this._quit(),
      onAddBots: ()=> this._onAddBots(),
      onClearBots: ()=> this._onClearBots(),
      getLiveNames: ()=> this._liveNames(),
    });
  }

  /* Şu an Firestore'a bağlı, gerçekten oturum açmış (bot olmayan) oyuncuların
     isim listesi — liderlik panellerinde "Şu An Çevrimiçi" bölümü için. */
  _liveNames(){
    const names = [];
    for(const rp of this.net.remotePlayers.values()){ if(rp && rp.name) names.push(rp.name); }
    return [...new Set(names)];
  }

  /* ---------------- Bot sistemi (tamamen yerel, Firebase'siz) ---------------- */
  _onAddBots(){
    const input = $("botCountInput");
    let want = input ? parseInt(input.value,10) : NaN;
    if(isNaN(want) || want <= 0) want = 3;
    want = clamp(want, 1, 24);

    if(this.state === "playing" && this.player){
      const added = this.botManager.add(want, this.player, this.net.remotePlayers);
      toast(added > 0 ? `${added} bot eklendi` : "Bot limiti doldu (maks. 24)");
    }else{
      SettingsManager.data.botCount = clamp((SettingsManager.data.botCount||0) + want, 0, 24);
      SettingsManager.save();
      if(input) input.value = SettingsManager.data.botCount;
      toast(`Oyun başında ${SettingsManager.data.botCount} bot olacak`);
    }
  }
  _onClearBots(){
    this.botManager.clear();
    toast("Botlar temizlendi");
  }

  _watchRoom(code){
    if(this._roomUnsub) this._roomUnsub();
    if(window.FirebaseBridge && typeof window.FirebaseBridge.subscribeRoomPlayers === "function"){
      this._roomUnsub = window.FirebaseBridge.subscribeRoomPlayers(code, (list)=>{
        const el = $("roomPlayersList");
        el.classList.remove("hidden");
        el.innerHTML = list.length
          ? list.map(p=>`<li><span>${escapeHtml(p.name||"Oyuncu")}</span><span>${Math.round(p.mass||0)}</span></li>`).join("")
          : `<li style="color:var(--text-lo)">Henüz kimse odada değil</li>`;
      });
    }
  }

  _renderChat(msgs){
    const el = $("chatMessages");
    el.innerHTML = msgs.map(m=>`<div><b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}</div>`).join("");
    el.scrollTop = el.scrollHeight;
  }

  _quit(){
    SoundManager.click();
    this.goMainMenu();
    window.close();
    setTimeout(()=>{ toast("Tarayıcı sekmesini kapatmana izin vermiyor — ana menüye döndün"); }, 150);
  }

  /* ---------------- Responsive canvas / DPI ---------------- */
  _bindResize(){
    let t=null;
    const onResize = ()=>{ clearTimeout(t); t = setTimeout(()=>this._resize(), 100); };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    if(window.visualViewport) window.visualViewport.addEventListener("resize", onResize);
  }
  _resize(){
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.viewW = w; this.viewH = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);

    this._resizeMinimap();
  }

  /* Minimap tuvali #hud (ve içindeki #minimapWrap) başlangıçta "hidden"
     (display:none) olduğu için sayfa yüklenirken clientWidth/Height 0
     ölçülüyordu → tuval kalıcı olarak 0x0 kalıp kimse görünmüyordu.
     Bu yüzden minimap boyutu ayrıca "hud" her görünür olduğunda
     (oyun başladığında / devam ettiğinde) yeniden hesaplanır. */
  _resizeMinimap(){
    const w = this.minimapCanvas.clientWidth || 120;
    const h = this.minimapCanvas.clientHeight || 120;
    this.minimapCanvas.width = Math.round(w * this.dpr);
    this.minimapCanvas.height = Math.round(h * this.dpr);
    this.minimapCtx.setTransform(this.dpr,0,0,this.dpr,0,0);
  }

  /* ---------------- Klavye kancaları (InputManager çağırır) ---------------- */
  onEscape(){
    if(this.state === "playing") this.pause();
    else if(this.state === "paused") this.resume();
  }
  setScoreboardVisible(v){
    if(this.state !== "playing") return;
    $("scoreboardOverlay").classList.toggle("hidden", !v);
    if(v) this._updateScoreboard();
  }
  toggleMinimap(){
    SettingsManager.data.minimapOn = !SettingsManager.data.minimapOn;
    SettingsManager.save();
    $("minimapWrap").classList.toggle("hidden", !SettingsManager.data.minimapOn);
    if(SettingsManager.data.minimapOn) this._resizeMinimap();
  }

  _updateScoreboard(){
    const all = [{ name: this.playerName, mass: this.player.mass, me:true }];
    for(const rp of this.net.remotePlayers.values()) all.push({ name: rp.name||"Oyuncu", mass: rp.mass||0, me:false });
    for(const bot of this.botManager.bots) all.push({ name: bot.name, mass: bot.mass, me:false });
    all.sort((a,b)=>b.mass-a.mass);
    const list = $("scoreboardList");
    if(!list) return;
    list.innerHTML = all.slice(0,10).map(p=>`<li class="${p.me?"me":""}"><span>${escapeHtml(p.name)}</span><span>${Math.round(p.mass)}</span></li>`).join("");
  }

  /* ---------------- Oyun akışı ---------------- */
  startGame(restart=false){
    try{
      const nameInput = ($("playerNameInput")?.value || "").trim();
      if(nameInput){ this.playerName = nameInput.slice(0,16); ProfileManager.data.name = this.playerName; ProfileManager.save(); }
      else if(!restart) this.playerName = ProfileManager.data.name || "Sen";
      if(!this.playerName) this.playerName = "Sen"; // isim girilmese bile oyun her zaman başlar

      ["screenMainMenu","screenPause","screenGameOver","screenSettings","screenHowTo","screenLeaderboard","screenPlayFriend","screenProfile","screenAvatarPick","screenSkins"].forEach(id=>hide(id));
      show("hud");
      // #hud gösterilene kadar minimap tuvali 0x0 ölçülüyordu; şimdi görünür
      // olduğuna göre gerçek boyutuyla yeniden kuruluyor.
      this._resizeMinimap();
      $("fpsCounter")?.classList.toggle("hidden", !SettingsManager.data.showFps);
      $("minimapWrap")?.classList.toggle("hidden", !SettingsManager.data.minimapOn);
      $("chatPanel")?.classList.toggle("hidden", !this.net.roomCode);

      this.state = "playing";
      this.elapsed = 0;
      this.maxSizeReached = 0;
      this.net.resetDeathFlag();
      this._eatCooldown.clear();
      this._snakeMode = SettingsManager.data.mode === "snake";
      $("snakeModeBadge")?.classList.toggle("hidden", !this._snakeMode);
      this._curSpeed = null;

      this.world.reseedFood();
      const spawn = this.world.findSafeSpawn(this.net.remotePlayers);
      this.player = new Blob(spawn.x, spawn.y, 60, ProfileManager.data.color, this.playerName, ProfileManager.data.avatarUrl);
      this.camera.x = this.player.x; this.camera.y = this.player.y; this.camera.zoom = 1.15;
      this.input.resetHeading(); // doğuşta rastgele bir yönde hareket etmeye başlar

      // Botlar: her yeni oyunda sıfırdan, tamamen yerel — internet gerekmez
      this.botManager.clear();
      const botCount = SettingsManager.data.botCount || 0;
      if(botCount > 0) this.botManager.add(botCount, this.player, this.net.remotePlayers);

      try{
        this.net.join({
          x:this.player.x, y:this.player.y, mass:this.player.mass,
          name:this.playerName, color:this.player.color, avatarUrl:this.player.avatarUrl,
        });
        if(this.net.roomCode) this.net.connectChat();
        if(this.net.connected) toast(botCount>0 ? `Bağlandın — ${botCount} bot + gerçek oyuncular` : "Canlı arenaya bağlandın");
        else toast(botCount>0 ? `Çevrimdışı mod — ${botCount} bot ile oynuyorsun` : "Çevrimdışı mod — tek başına oynuyorsun");
      }catch(err){
        console.warn("[Game] Ağ bağlantısı kurulamadı, çevrimdışı devam ediliyor:", err);
        toast("Çevrimdışı mod: internet yok, botlarla/tek başına oynanıyor");
      }

      ProfileManager.data.gamesPlayed++;
      ProfileManager.save();

      SoundManager.startMusic();
      this.lastTime = performance.now();
    }catch(err){
      console.error("[Game] startGame sırasında hata:", err);
      // Bir hata olsa bile oyuncuyu menüde kilitli bırakma — en azından tekrar dene
      toast("Bir sorun oluştu, tekrar deniyor…");
      this.state = "menu";
      show("screenMainMenu");
    }
  }

  pause(){
    if(this.state !== "playing") return;
    this.state = "paused";
    show("screenPause");
  }
  resume(){
    if(this.state !== "paused") return;
    this.state = "playing";
    hide("screenPause");
    this.lastTime = performance.now();
  }
  goMainMenu(){
    this.state = "menu";
    SoundManager.stopMusic();
    this.net.leave();
    this.net.disconnectChat();
    this.botManager.clear(); // botlar sadece oturum içinde yaşar
    ["hud","screenPause","screenGameOver","screenSettings","screenHowTo","screenLeaderboard"].forEach(id=>hide(id));
    $("scoreboardOverlay")?.classList.add("hidden");
    $("snakeModeBadge")?.classList.add("hidden");
    show("screenMainMenu");
    refreshProfileUI();
    refreshHudLeaderboard(this._liveNames()).catch(()=>{});
  }

  async gameOver(eatenByName){
    if(this.state === "gameover") return;
    this.state = "gameover";
    SoundManager.death();
    SoundManager.stopMusic();
    hide("hud");
    this.net.leave();
    this.net.disconnectChat();
    this.botManager.clear(); // botlar oyun bitince silinir

    const finalScore = Math.round(this.player.mass);
    try{ await LeaderboardManager.submit(this.playerName, finalScore); }catch(err){ console.warn("[Game] skor gönderilemedi:", err); }

    ProfileManager.data.bestScore = Math.max(ProfileManager.data.bestScore, finalScore);
    ProfileManager.data.totalEaten += this.player.eatenCount;
    ProfileManager.save();

    const setText = (id,val)=>{ const el=$(id); if(el) el.textContent = val; };
    setText("goScore", finalScore);
    setText("goMaxSize", Math.round(this.maxSizeReached || this.player.mass));
    setText("goTime", fmtTime(this.elapsed));
    setText("goEaten", this.player.eatenCount);
    const heading = $("screenGameOver")?.querySelector(".panel-title");
    if(heading) heading.textContent = (typeof eatenByName === "string" && eatenByName) ? `💀 ${eatenByName} Seni Yedi!` : "💀 Oyun Bitti";
    show("screenGameOver");
    refreshHudLeaderboard(this._liveNames()).catch(()=>{});
  }

  /* ---------------- Güncelleme ---------------- */
  _update(dt){
    if(this.state !== "playing") return;
    this.elapsed += dt;
    this.player.tick(dt);
    this.particles.update(dt);
    this.maxSizeReached = Math.max(this.maxSizeReached, this.player.mass);

    // Hareket
    const mv = this.input.getMoveVector(dt);
    let targetSpd = speedForRadius(this.player.r) * this.world.speedMultiplierAt(this.player.x, this.player.y);
    if(this.input.isBoosting && this.player.mass > 40){
      targetSpd *= BOOST_MULT;
      this.player.mass = Math.max(30, this.player.mass - BOOST_COST_PER_SEC*dt);
      this.player.updateRadius();
    }
    // Hız aniden sıçramak yerine akıcı şekilde hedefe yaklaşır — böylece
    // boost'a basınca "bir tık" hızlanma hissi olur, ani zıplama olmaz.
    this._curSpeed = (this._curSpeed==null) ? targetSpd : lerp(this._curSpeed, targetSpd, clamp(dt*SPEED_LERP_RATE,0,1));
    const spd = this._curSpeed;
    this.player.x = clamp(this.player.x + mv.x*spd*dt, this.player.r, WORLD_SIZE-this.player.r);
    this.player.y = clamp(this.player.y + mv.y*spd*dt, this.player.r, WORLD_SIZE-this.player.r);

    this.world.resolveRockCollision(this.player);
    this.player.updateTrail(this._snakeMode);

    // Zehir bölgesi
    if(this.world.poisonAt(this.player.x, this.player.y)){
      this._poisonTimer = (this._poisonTimer||0) + dt;
      if(this._poisonTimer > 0.4){
        this._poisonTimer = 0;
        this.player.mass = Math.max(20, this.player.mass - 3);
        this.player.updateRadius();
        SoundManager.hazard();
        SoundManager.vibrate(30);
      }
    }
    // Portal
    const tp = this.world.portalAt(this.player.x, this.player.y, this.player.r);
    if(tp && !this._portalCooldown){
      this.player.x = tp.x; this.player.y = tp.y;
      this._portalCooldown = 1.2;
      SoundManager.portal();
    }
    if(this._portalCooldown) this._portalCooldown = Math.max(0, this._portalCooldown - dt);

    // Yiyecek toplama
    for(let i=this.world.food.length-1;i>=0;i--){
      const f = this.world.food[i];
      if(dist2(this.player.x,this.player.y,f.x,f.y) < (this.player.r+f.r)*(this.player.r+f.r)){
        this.world.food.splice(i,1);
        this.player.grow(FOOD_MASS);
        this.particles.burst(f.x,f.y,this.player.color,6,0.6);
        SoundManager.eat();
        SoundManager.vibrate(8);
      }
    }
    for(let i=this.world.bonusFood.length-1;i>=0;i--){
      const f = this.world.bonusFood[i];
      if(dist2(this.player.x,this.player.y,f.x,f.y) < (this.player.r+f.r)*(this.player.r+f.r)){
        this.world.bonusFood.splice(i,1);
        this.player.grow(BONUS_FOOD_MASS);
        this.particles.burst(f.x,f.y,"#ffc857",18,1.3);
        SoundManager.eatBonus();
        SoundManager.vibrate([15,30,15]);
        this.world.bonusFood.push(this.world._newBonusFood());
      }
    }
    const target = (this.world.quality==="low"?260:this.world.quality==="high"?760:480);
    while(this.world.food.length < target) this.world.food.push(this.world._newFood());

    // Gerçek oyunculara karşı yeme mantığı (respawn kalkanı hem kendine hem hedefe uygulanır)
    if(!this.player.invulnerable){
      const now = performance.now();
      for(const [id, rp] of this.net.remotePlayers){
        const rpMass = rp.mass || 0;
        const rpR = radiusForMass(rpMass);
        // Uzak oyuncunun kalkanda olup olmadığını updatedAt'e yakınlığıyla kabaca anlayamayız;
        // bu yüzden liderlik mantığı simetriktir: her istemci sadece KENDİ kalkanını kontrol eder,
        // rakip kalkandaysa onun istemcisi zaten bize yemesine izin vermez.
        const rr = (this.player.r*0.72 + rpR*0.72);
        if(dist2(this.player.x,this.player.y,rp.x,rp.y) < rr*rr){
          const lastEat = this._eatCooldown.get(id) || 0;
          if(this.player.mass > rpMass*EAT_RATIO && now-lastEat > 900){
            this.player.grow(rpMass*0.78);
            this.player.eatenCount++;
            this._eatCooldown.set(id, now);
            this.particles.burst(rp.x,rp.y,rp.color||"#7c8cff",22,1.5);
            SoundManager.eatBig();
            SoundManager.vibrate([20,20,20]);
            this.net.reportEaten(id, this.playerName);
            this.net.remotePlayers.delete(id); // iyimser kaldırma
          }
        }
      }
    }

    // Yerel botlar: hareket/AI/yem toplama/kendi aralarında yeme (Firebase'siz)
    this.botManager.update(dt, this.world, this.player, this._snakeMode);

    // Oyuncu <-> bot yeme mantığı (iki yönlü — bot büyükse oyuncuyu yer)
    if(!this.player.invulnerable){
      for(let i=this.botManager.bots.length-1;i>=0;i--){
        const bot = this.botManager.bots[i];
        if(!bot || bot.invulnerable) continue;
        const rr = (this.player.r*0.72 + bot.r*0.72);
        if(dist2(this.player.x,this.player.y,bot.x,bot.y) < rr*rr){
          if(this.player.mass > bot.mass*EAT_RATIO){
            this.player.grow(bot.mass*0.78);
            this.player.eatenCount++;
            this.particles.burst(bot.x,bot.y,bot.color,22,1.5);
            SoundManager.eatBig();
            SoundManager.vibrate([20,20,20]);
            this.botManager.bots.splice(i,1);
          }else if(bot.mass > this.player.mass*EAT_RATIO){
            this.gameOver(bot.name);
            return;
          }
        }
      }
    }

    // Yılan Modu: kafa başka bir gövdeye (kendi kuyruğu dahil) değerse ölüm
    if(this._snakeMode) this._updateSnakeCollisions();

    // Firestore'a pozisyon/kütle senkronizasyonu (kısıtlı sıklıkta)
    this._mpWriteTimer = (this._mpWriteTimer||0) + dt;
    if(this.net.connected && this._mpWriteTimer >= MP_WRITE_INTERVAL){
      this._mpWriteTimer = 0;
      this.net.update({ x:this.player.x, y:this.player.y, mass:this.player.mass, name:this.playerName, color:this.player.color, avatarUrl:this.player.avatarUrl });
    }

    // Kamera — yumuşak zoom + takip
    const targetZoom = clamp(1.2 - (this.player.r-BASE_RADIUS)*0.0032, 0.42, 1.2);
    this.camera.zoom = lerp(this.camera.zoom, targetZoom, Math.min(1, dt*3));
    this.camera.x = lerp(this.camera.x, this.player.x, Math.min(1, dt*6));
    this.camera.y = lerp(this.camera.y, this.player.y, Math.min(1, dt*6));

    // HUD
    $("hudScore").textContent = Math.round(this.player.mass);
    $("hudSize").textContent = Math.round(this.player.r);
    $("hudTime").textContent = fmtTime(this.elapsed);
    $("shieldBadge").classList.toggle("hidden", !this.player.invulnerable);
    if($("scoreboardOverlay").classList.contains("hidden")===false) this._updateScoreboard();

    // "Şu an çevrimiçi" listesini oyun sırasında da tazele (skor tablosunu
    // her seferinde Firestore'dan çekmeye gerek yok, sadece isim listesi)
    this._liveListTimer = (this._liveListTimer||0) + dt;
    if(this._liveListTimer > 2.5){
      this._liveListTimer = 0;
      const liveEl = $("hudLiveList");
      if(liveEl){
        const names = this._liveNames();
        liveEl.innerHTML = names.length
          ? names.slice(0,8).map(n=>`<li>${escapeHtml(n)}</li>`).join("")
          : `<li style="color:var(--text-lo)">—</li>`;
      }
    }
  }

  /* ---------------- Yılan Modu çarpışmaları ----------------
     Klasik yılan kuralı: kafan BAŞKA bir yılanın gövdesine değerse
     ölürsün. NOT: kendi kuyruğuna çarpma öldürmez — kısa gövdeli veya
     hızlı dönüş yapan yılanlar (özellikle botlar) aksi halde sürekli
     "kendi kendine" ölüyormuş gibi görünüyordu; bu kafa karıştırıcıydı,
     bu yüzden bilinçli olarak kaldırıldı. Kafa-kafaya temas ise klasik
     kütle kuralına (büyük küçüğü yer) tabidir — bu zaten yukarıda ayrıca
     işleniyor. Uzak (gerçek) oyuncuların iz verisi elimizde olmadığından
     bu kontrol yalnızca yerel oyuncu ve botlar arasında çalışır. */
  _snakeBodyHit(hx, hy, hr, owner){
    const trail = owner.trail;
    if(!trail || trail.length < 6) return false;
    const bodyR = owner.r*0.42;
    const rr = hr*0.5 + bodyR*0.75;
    for(let i=0;i<trail.length;i++){
      const p = trail[i];
      if(dist2(hx,hy,p.x,p.y) < rr*rr) return true;
    }
    return false;
  }

  _updateSnakeCollisions(){
    // Oyuncunun kafası: bir botun gövdesine çarptıysa oyun biter
    // (kendi kuyruğu artık ölümcül değil — bkz. yukarıdaki not)
    if(!this.player.invulnerable){
      for(const bot of this.botManager.bots){
        if(this._snakeBodyHit(this.player.x,this.player.y,this.player.r, bot)){
          this.gameOver(bot.name);
          return;
        }
      }
    }

    // Botların kafası: oyuncuya veya başka bir bota çarparsa o bot elenir
    for(let i=this.botManager.bots.length-1;i>=0;i--){
      const bot = this.botManager.bots[i];
      if(!bot || bot.invulnerable) continue;
      let died = false;
      if(!this.player.invulnerable && this._snakeBodyHit(bot.x,bot.y,bot.r, this.player)) died = true;
      if(!died){
        for(const other of this.botManager.bots){
          if(other === bot || other.invulnerable) continue;
          if(this._snakeBodyHit(bot.x,bot.y,bot.r, other)){ died = true; break; }
        }
      }
      if(died){
        this.particles.burst(bot.x,bot.y,bot.color,16,1.1);
        SoundManager.eatBig();
        this.botManager.bots.splice(i,1);
      }
    }
  }

  /* ---------------- Çizim ---------------- */
  _draw(){
    const ctx = this.ctx;
    const theme = THEMES[SettingsManager.data.theme] || THEMES.abyss;
    if(this.state === "menu"){
      ctx.fillStyle = theme.bg; ctx.fillRect(0,0,this.viewW,this.viewH);
      return;
    }
    const now = performance.now();
    drawWorld(ctx, this.world, this.camera, this.viewW, this.viewH, this.world.quality, theme, now);

    ctx.save();
    const zoom = this.camera.zoom;
    ctx.translate(this.viewW/2, this.viewH/2);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    this.particles.draw(ctx, zoom);

    const drawList = [{
      x:this.player.x, y:this.player.y, r:this.player.r, color:this.player.color,
      name:this.player.name, mass:this.player.mass, avatarImg:this.player.avatarImg,
      invulnerable:this.player.invulnerable, scalePunch:this.player.scalePunch, glow:this.player.glow,
      trail:this.player.trail,
    }];
    for(const rp of this.net.remotePlayers.values()){
      drawList.push({
        x: rp.x, y: rp.y, r: radiusForMass(rp.mass||0),
        color: rp.color || "#7c8cff", name: rp.name || "Oyuncu", mass: rp.mass||0,
        avatarImg: rp._avatarImg, avatarUrl: rp.avatarUrl,
        invulnerable:false, scalePunch:1, glow:0, trail:null, // uzak oyuncular için iz verisi yok
      });
      if(rp.avatarUrl && !rp._avatarImg && !rp._avatarLoading){
        rp._avatarLoading = true;
        const img = new Image(); img.crossOrigin="anonymous";
        img.onload = ()=>{ rp._avatarImg = img; };
        img.src = rp.avatarUrl;
      }
    }
    for(const bot of this.botManager.bots){
      drawList.push({
        x: bot.x, y: bot.y, r: bot.r, color: bot.color, name: bot.name, mass: bot.mass,
        avatarImg: null, invulnerable: bot.invulnerable, scalePunch: bot.scalePunch, glow: bot.glow,
        trail: bot.trail,
      });
    }
    drawList.sort((a,b)=>a.mass-b.mass);
    // Yılan Modu: önce tüm gövdeler, sonra tüm kafalar (kafalar her zaman üstte görünsün)
    if(this._snakeMode){
      for(const b of drawList){ if(b.trail && b.trail.length>1) drawSnakeBody(ctx, b, zoom); }
    }
    for(const b of drawList) drawBlob(ctx, b, zoom, this.world.quality, now, b===drawList[drawList.length-1]);

    ctx.restore();

    if(SettingsManager.data.showFps){ const fc=$("fpsCounter"); if(fc) fc.textContent = `FPS: ${this.fps}`; }
    if(SettingsManager.data.minimapOn){
      const minimapEntities = new Map(this.net.remotePlayers);
      this.botManager.bots.forEach((b,i)=> minimapEntities.set("__bot"+i, b));
      drawMinimap(this.minimapCtx, this.minimapCanvas, this.player, minimapEntities, null);
    }
  }

  /* ---------------- Döngü ----------------
     ÖNEMLİ: try/catch olmadan, _update veya _draw içinde atılan herhangi
     bir hata requestAnimationFrame zincirini tamamen durdurur ve ekran
     kalıcı olarak siyah/donuk kalır. Bu yüzden döngü her zaman devam
     etmeyi garanti eder. */
  _loop(now){
    try{
      const dt = Math.min(0.05, (now - this.lastTime)/1000);
      this.lastTime = now;

      this._fpsFrames++;
      this._fpsTimer += dt;
      if(this._fpsTimer >= 0.5){
        this.fps = Math.round(this._fpsFrames/this._fpsTimer);
        this._fpsFrames = 0; this._fpsTimer = 0;
      }

      this._update(dt);
      this._draw();
    }catch(err){
      console.error("[Game] Oyun döngüsünde hata (devam ediliyor):", err);
    }
    requestAnimationFrame(this._loop);
  }
}
