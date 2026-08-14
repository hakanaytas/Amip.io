/* =========================================================================
   UI — tüm menü/panel bağlamaları. Oyun mantığından ayrı tutulur.
   ========================================================================= */
import { SettingsManager, ProfileManager, SoundManager, SKIN_COLORS } from "./core.js";
import { LeaderboardManager } from "./net.js";

export const $ = (id)=>document.getElementById(id);
export const show = (id)=>{ const el=$(id); if(el) el.classList.remove("hidden"); else console.warn(`[UI] "#${id}" bulunamadı (show)`); };
export const hide = (id)=>{ const el=$(id); if(el) el.classList.add("hidden"); else console.warn(`[UI] "#${id}" bulunamadı (hide)`); };
export const escapeHtml = (s)=>String(s).replace(/[<>&"]/g, c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));

export function toast(msg){
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove("show"), 2200);
}

function renderAvatarInto(el, url, fallbackLetter){
  if(!el) return;
  if(url){
    el.style.backgroundImage = `url(${url})`;
    el.textContent = "";
  }else{
    el.style.backgroundImage = "none";
    el.textContent = (fallbackLetter||"S").slice(0,1).toUpperCase();
  }
}

export function refreshProfileUI(){
  const p = ProfileManager.data;
  const setText = (id, val)=>{ const el=$(id); if(el) el.textContent = val; };
  const setVal = (id, val)=>{ const el=$(id); if(el) el.value = val; };

  renderAvatarInto($("miniAvatar"), p.avatarUrl, p.name);
  setText("miniName", p.name);
  setText("miniStat", `En iyi: ${p.bestScore}`);
  setVal("playerNameInput", p.name === "Sen" ? "" : p.name);

  renderAvatarInto($("profileAvatarBig"), p.avatarUrl, p.name);
  setVal("profileNameInput", p.name);
  setText("statGames", p.gamesPlayed);
  setText("statBest", p.bestScore);
  setText("statEaten", p.totalEaten);
  const statColor = $("statColor");
  if(statColor){ statColor.style.color = p.color; statColor.textContent = "●"; }

  renderAvatarInto($("avatarPreviewBig"), p.avatarUrl, p.name);
}

export function buildSkinGrid(onPick){
  const grid = $("skinGrid");
  grid.innerHTML = "";
  SKIN_COLORS.forEach(color=>{
    const sw = document.createElement("div");
    sw.className = "skin-swatch" + (ProfileManager.data.color === color ? " active" : "");
    sw.style.background = color;
    sw.onclick = ()=>{
      ProfileManager.data.color = color;
      ProfileManager.save();
      grid.querySelectorAll(".skin-swatch").forEach(n=>n.classList.remove("active"));
      sw.classList.add("active");
      SoundManager.click();
      refreshProfileUI();
    };
    grid.appendChild(sw);
  });
}

export async function openLeaderboard(liveNames=[]){
  const list = await LeaderboardManager.top(10);
  const el = $("leaderboardFullList");
  el.innerHTML = list.length
    ? list.map(e=>`<li>${escapeHtml(e.name)} — <b style="color:var(--teal)">${e.score}</b></li>`).join("")
    : `<li style="color:var(--text-lo)">Bu saatte henüz skor yok. İlk sen ol!</li>`;
  const liveEl = $("leaderboardLiveList");
  if(liveEl){
    liveEl.innerHTML = liveNames.length
      ? liveNames.map(n=>`<li>${escapeHtml(n)}</li>`).join("")
      : `<li style="color:var(--text-lo)">Şu an başka bağlı oyuncu yok</li>`;
  }
  show("screenLeaderboard");
}
export async function refreshHudLeaderboard(liveNames=[]){
  const list = await LeaderboardManager.top(5);
  const el = $("hudLeaderboardList");
  if(el) el.innerHTML = list.length ? list.map(e=>`<li>${escapeHtml(e.name)} — ${e.score}</li>`).join("") : "<li>—</li>";
  const liveEl = $("hudLiveList");
  if(liveEl){
    liveEl.innerHTML = liveNames.length
      ? liveNames.slice(0,8).map(n=>`<li>${escapeHtml(n)}</li>`).join("")
      : `<li style="color:var(--text-lo)">—</li>`;
  }
}

/* Bir elementi güvenle bulup event bağlar; element yoksa sessizce uyarı
   verir ama ASLA hata fırlatıp diğer bağlamaları engellemez. Bu, tek bir
   eksik/yeniden adlandırılmış id'nin tüm menüyü kilitlemesini önler. */
function on(id, event, handler){
  const el = $(id);
  if(!el){ console.warn(`[UI] "#${id}" bulunamadı — bağlanamadı (${event})`); return null; }
  el.addEventListener(event, (...args)=>{
    try{ handler(...args); }
    catch(err){ console.error(`[UI] "#${id}" (${event}) işleyicisinde hata:`, err); }
  });
  return el;
}
function safe(fn){
  try{ fn(); }catch(err){ console.error("[UI] bindStaticUI hata:", err); }
}

/* Tüm sabit (statik) bağlamalar. Oyuna özgü olanlar (Oyna, Odada başlat vb.)
   game.js içinden ayrıca bağlanır — bu fonksiyon bir referans nesnesi alır.
   Her bağlama kendi güvenli bloğunda çalışır: biri başarısız olsa bile
   diğerleri etkilenmez, bu yüzden "Oyuna Başla" gibi kritik butonlar
   asla işlevsiz kalmaz. */
export function bindStaticUI(hooks){
  safe(()=> buildSkinGrid());
  safe(()=> refreshProfileUI());

  safe(()=>{
    document.querySelectorAll("[data-close]").forEach(btn=>{
      btn.onclick = ()=>{ SoundManager.click(); hide(btn.dataset.close); };
    });
  });

  on("btnHowTo","click", ()=>{ SoundManager.click(); show("screenHowTo"); });
  on("btnHowToClose","click", ()=>{ SoundManager.click(); hide("screenHowTo"); });
  on("btnLeaderboard","click", ()=>{ SoundManager.click(); openLeaderboard(hooks.getLiveNames ? hooks.getLiveNames() : []); });
  on("btnLeaderboardClose","click", ()=>{ SoundManager.click(); hide("screenLeaderboard"); });

  on("btnProfile","click", ()=>{ SoundManager.click(); refreshProfileUI(); show("screenProfile"); });
  on("btnProfileSave","click", ()=>{
    const el = $("profileNameInput");
    const name = (el ? el.value : "").trim().slice(0,16);
    ProfileManager.data.name = name || "Sen";
    ProfileManager.save();
    refreshProfileUI();
    toast("Profil kaydedildi");
    SoundManager.click();
    hide("screenProfile");
  });

  on("btnAvatar","click", ()=>{ SoundManager.click(); refreshProfileUI(); show("screenAvatarPick"); });
  on("btnPickPhoto","click", ()=> $("avatarFileInput")?.click());
  on("avatarFileInput","change", async (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const statusEl = $("avatarStatus");
    if(statusEl) statusEl.textContent = "Yükleniyor…";
    try{
      const url = await hooks.uploadAvatar(file);
      ProfileManager.data.avatarUrl = url;
      ProfileManager.save();
      refreshProfileUI();
      if(statusEl) statusEl.textContent = "Avatar güncellendi ✔";
      toast("Avatar güncellendi");
    }catch(err){
      if(statusEl) statusEl.textContent = "Yüklenemedi — Firebase Storage etkin olmayabilir; yerel görünümle devam ediliyor.";
    }
  });
  on("btnRemoveAvatar","click", ()=>{
    ProfileManager.data.avatarUrl = "";
    ProfileManager.save();
    refreshProfileUI();
    SoundManager.click();
  });

  on("btnSkins","click", ()=>{ SoundManager.click(); buildSkinGrid(); show("screenSkins"); });

  on("btnSettings","click", ()=>{ SoundManager.click(); show("screenSettings"); });
  on("btnSettingsFromPause","click", ()=>{ SoundManager.click(); show("screenSettings"); });
  on("btnSettingsClose","click", ()=>{ SoundManager.click(); hide("screenSettings"); SettingsManager.save(); });

  safe(()=>{
    const rangeSfx = $("rangeSfx");
    if(rangeSfx){
      rangeSfx.value = SettingsManager.data.sfx;
      rangeSfx.oninput = (e)=>{ SettingsManager.data.sfx = +e.target.value; SettingsManager.save(); };
    }
  });
  safe(()=>{
    const rangeMusic = $("rangeMusic");
    if(rangeMusic){
      rangeMusic.value = SettingsManager.data.music;
      rangeMusic.oninput = (e)=>{ SettingsManager.data.music = +e.target.value; SettingsManager.save(); SoundManager.updateVolumes(); };
    }
  });

  const bindToggle = (id, key, onChange)=>{
    safe(()=>{
      const el = $(id);
      if(!el) return;
      el.classList.toggle("on", !!SettingsManager.data[key]);
      el.onclick = ()=>{
        SettingsManager.data[key] = !SettingsManager.data[key];
        SettingsManager.save();
        el.classList.toggle("on", SettingsManager.data[key]);
        if(onChange) onChange(SettingsManager.data[key]);
      };
    });
  };
  bindToggle("toggleSound","soundOn");
  bindToggle("toggleMusic","musicOn", (on)=>{ if(on) SoundManager.startMusic(); else SoundManager.stopMusic(); });
  bindToggle("toggleVibrate","vibrateOn");
  bindToggle("toggleMinimap","minimapOn", (on)=>{
    $("minimapWrap") && $("minimapWrap").classList.toggle("hidden", !on);
    hooks.onMinimapToggle && hooks.onMinimapToggle(on);
  });

  safe(()=>{
    document.querySelectorAll("#segQuality button").forEach(btn=>{
      if(btn.dataset.v === SettingsManager.data.quality) btn.classList.add("active");
      btn.onclick = ()=>{
        document.querySelectorAll("#segQuality button").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");
        SettingsManager.data.quality = btn.dataset.v; SettingsManager.save();
        hooks.onQualityChange && hooks.onQualityChange(btn.dataset.v);
      };
    });
  });
  safe(()=>{
    document.querySelectorAll("#segMode button").forEach(btn=>{
      if(btn.dataset.v === SettingsManager.data.mode) btn.classList.add("active");
      btn.onclick = ()=>{
        document.querySelectorAll("#segMode button").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");
        SettingsManager.data.mode = btn.dataset.v; SettingsManager.save();
        SoundManager.click();
        hooks.onModeChange && hooks.onModeChange(btn.dataset.v);
      };
    });
  });
  safe(()=>{
    document.querySelectorAll("#segTheme button").forEach(btn=>{
      if(btn.dataset.v === SettingsManager.data.theme) btn.classList.add("active");
      btn.onclick = ()=>{
        document.querySelectorAll("#segTheme button").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");
        SettingsManager.data.theme = btn.dataset.v; SettingsManager.save();
      };
    });
  });
  safe(()=>{
    const fpsToggle = $("toggleFps");
    if(fpsToggle){
      fpsToggle.classList.toggle("on", SettingsManager.data.showFps);
      fpsToggle.onclick = ()=>{
        SettingsManager.data.showFps = !SettingsManager.data.showFps; SettingsManager.save();
        fpsToggle.classList.toggle("on", SettingsManager.data.showFps);
        $("fpsCounter")?.classList.toggle("hidden", !SettingsManager.data.showFps);
      };
    }
  });
  safe(()=>{
    const fsToggle = $("toggleFullscreen");
    if(fsToggle){
      fsToggle.onclick = ()=>{
        if(!document.fullscreenElement){
          document.documentElement.requestFullscreen?.().catch(()=>{});
          fsToggle.classList.add("on");
        }else{
          document.exitFullscreen?.();
          fsToggle.classList.remove("on");
        }
      };
    }
  });

  // Botlar (Ayarlar ekranı — tamamen yerel/çevrimdışı)
  safe(()=>{
    const botInput = $("botCountInput");
    if(botInput) botInput.value = SettingsManager.data.botCount;
    on("botCountInput","input",(e)=>{
      let v = parseInt(e.target.value,10); if(isNaN(v)) v = 0;
      v = Math.max(0, Math.min(24, v));
      SettingsManager.data.botCount = v; SettingsManager.save();
    });
  });
  on("btnAddBots","click", ()=>{ SoundManager.click(); hooks.onAddBots && hooks.onAddBots(); });
  on("btnClearBots","click", ()=>{ SoundManager.click(); hooks.onClearBots && hooks.onClearBots(); });

  on("btnPlayFriend","click", ()=>{ SoundManager.click(); show("screenPlayFriend"); });
  on("btnCreateRoom","click", ()=> hooks.onCreateRoom());
  on("btnCopyRoomCode","click", ()=>{
    const code = $("roomCodeText")?.textContent || "";
    navigator.clipboard?.writeText(code).catch(()=>{});
    toast("Oda kodu kopyalandı");
  });
  on("btnJoinRoom","click", ()=> hooks.onJoinRoom($("roomCodeInput")?.value));
  on("btnStartRoomGame","click", ()=> hooks.onStartRoomGame());

  on("chatSendBtn","click", ()=> hooks.onSendChat($("chatInput")?.value));
  on("chatInput","keydown", (e)=>{
    if(e.key === "Enter"){ hooks.onSendChat($("chatInput")?.value); }
  });

  on("btnPlayAgain","click", ()=>{ SoundManager.click(); hooks.onPlayAgain(); });
  on("btnGoMainMenu","click", ()=>{ SoundManager.click(); hooks.onMainMenu(); });
  on("btnMenuOpen","click", ()=> hooks.onPause());
  on("btnResume","click", ()=> hooks.onResume());
  on("btnRestartFromPause","click", ()=>{ SoundManager.click(); hooks.onRestart(); });
  on("btnMainMenuFromPause","click", ()=>{ SoundManager.click(); hooks.onMainMenu(); });
  on("btnQuitFromPause","click", ()=>{ SoundManager.click(); hooks.onQuit(); });
}
