/* =========================================================================
   RENDER — çizim motoru. Büyüme "hissi" burada yaşıyor: parlama, zıplama,
   parçacıklar, yumuşak kamera zoom, isimlerin taşmadan sığdırılması.
   ========================================================================= */
import { WORLD_SIZE, THEMES, radiusForMass, clamp } from "./core.js";

export class ParticleSystem{
  constructor(){ this.list = []; }
  burst(x,y,color,count=10,power=1){
    for(let i=0;i<count;i++){
      const a = Math.random()*Math.PI*2;
      const spd = (40+Math.random()*90)*power;
      this.list.push({
        x, y, vx:Math.cos(a)*spd, vy:Math.sin(a)*spd,
        life: 0.35+Math.random()*0.25, t:0, r: 2+Math.random()*3, color,
      });
    }
  }
  update(dt){
    for(let i=this.list.length-1;i>=0;i--){
      const p = this.list[i];
      p.t += dt;
      if(p.t >= p.life){ this.list.splice(i,1); continue; }
      p.x += p.vx*dt; p.y += p.vy*dt;
      p.vx *= (1 - dt*2.2); p.vy *= (1 - dt*2.2);
    }
  }
  draw(ctx, zoom){
    for(const p of this.list){
      const a = 1 - p.t/p.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function fitFontSize(ctx, text, maxWidth, startPx){
  let size = startPx;
  ctx.font = `700 ${size}px Rajdhani, sans-serif`;
  while(size > 8 && ctx.measureText(text).width > maxWidth){
    size -= 1;
    ctx.font = `700 ${size}px Rajdhani, sans-serif`;
  }
  return size;
}

/* Yılan Modu: kafanın arkasında sıralanan, kuyruğa doğru incelen gövde
   parçalarını çizer. drawBlob'dan ÖNCE çağrılmalı (kafa en üstte kalsın). */
export function drawSnakeBody(ctx, b, zoom){
  const trail = b.trail;
  if(!trail || trail.length < 2) return;
  const n = trail.length;
  ctx.save();
  ctx.globalAlpha = b.invulnerable ? 0.45 : 0.92;
  ctx.fillStyle = b.color;
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1.2/zoom;
  for(let i=n-1;i>=0;i--){
    const p = trail[i];
    const t = i/n; // 0 kafaya yakın, 1 kuyruk ucu
    const rad = Math.max(b.r*0.22, b.r*0.62*(1 - t*0.6));
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawBlob(ctx, b, zoom, quality, now, isSelf){
  const punch = b.scalePunch || 1;
  const r = b.r * punch;
  const invuln = b.invulnerable;

  ctx.save();
  if(invuln) ctx.globalAlpha = 0.55; // koruma altında: yarı saydam

  // Glow / parlama efekti (yeme anında yükselir, sönümlenir)
  if(quality !== "low"){
    const glowStrength = 14 + (b.glow||0)*26;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = glowStrength;
  }

  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI*2);
  ctx.fillStyle = b.color;
  ctx.fill();

  // Avatar fotoğrafı (varsa) dairenin içine tam oturacak şekilde klips
  if(b.avatarImg){
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, r*0.92, 0, Math.PI*2);
    ctx.clip();
    const img = b.avatarImg;
    const s = Math.max((r*1.84)/img.width, (r*1.84)/img.height);
    const dw = img.width*s, dh = img.height*s;
    ctx.drawImage(img, b.x-dw/2, b.y-dh/2, dw, dh);
    ctx.restore();
  }

  ctx.shadowBlur = 0;
  ctx.lineWidth = (invuln ? 3.5 : 3)/zoom;
  ctx.strokeStyle = invuln ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)";
  ctx.stroke();

  // Koruma halkası (dönen kesikli çizgi) — yeni doğan oyuncu belirgin olsun
  if(invuln){
    ctx.save();
    ctx.setLineDash([6,6]);
    ctx.lineDashOffset = -now/60;
    ctx.strokeStyle = "rgba(120,220,255,0.9)";
    ctx.lineWidth = 2.5/zoom;
    ctx.beginPath();
    ctx.arc(b.x,b.y, r+6, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.globalAlpha = 1;

  // İsim: ortada, okunaklı, gölgeli, hücreye göre ölçekli, asla taşmıyor
  const label = b.name || "Oyuncu";
  const maxW = r*1.6;
  const startSize = clamp(r*0.42, 10, 34);
  const size = fitFontSize(ctx, label, maxW, startSize);
  ctx.font = `700 ${size}px Rajdhani, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, size*0.18);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(label, b.x, b.y);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, b.x, b.y);

  ctx.restore();
}

export function drawWorld(ctx, world, camera, viewW, viewH, quality, theme, now){
  ctx.save();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0,0,viewW,viewH);

  const zoom = camera.zoom;
  ctx.translate(viewW/2, viewH/2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camera.x, -camera.y);

  // görünür alan (kırpma/kültürleme için) — performans: ekran dışını çizme
  const pad = 200/zoom;
  const vx0 = camera.x - viewW/2/zoom - pad, vx1 = camera.x + viewW/2/zoom + pad;
  const vy0 = camera.y - viewH/2/zoom - pad, vy1 = camera.y + viewH/2/zoom + pad;
  const inView = (x,y,r=0)=> x+r>vx0 && x-r<vx1 && y+r>vy0 && y-r<vy1;

  if(quality !== "low"){
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1/zoom;
    const step = 140;
    ctx.beginPath();
    const gx0 = Math.max(0, Math.floor(vx0/step)*step), gx1 = Math.min(WORLD_SIZE, vx1);
    const gy0 = Math.max(0, Math.floor(vy0/step)*step), gy1 = Math.min(WORLD_SIZE, vy1);
    for(let x=gx0; x<=gx1; x+=step){ ctx.moveTo(x,Math.max(0,vy0)); ctx.lineTo(x,Math.min(WORLD_SIZE,vy1)); }
    for(let y=gy0; y<=gy1; y+=step){ ctx.moveTo(Math.max(0,vx0),y); ctx.lineTo(Math.min(WORLD_SIZE,vx1),y); }
    ctx.stroke();
  }

  // Tehlike / hız bölgeleri
  for(const z of world.poisonZones){
    if(!inView(z.x,z.y,z.r)) continue;
    const grad = ctx.createRadialGradient(z.x,z.y,z.r*0.2,z.x,z.y,z.r);
    grad.addColorStop(0,"rgba(140,255,90,0.16)");
    grad.addColorStop(1,"rgba(140,255,90,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(z.x,z.y,z.r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = "rgba(140,255,90,0.35)"; ctx.lineWidth = 2/zoom;
    ctx.setLineDash([10,8]); ctx.stroke(); ctx.setLineDash([]);
  }
  for(const z of world.speedZones){
    if(!inView(z.x,z.y,z.r)) continue;
    const grad = ctx.createRadialGradient(z.x,z.y,z.r*0.2,z.x,z.y,z.r);
    grad.addColorStop(0,"rgba(90,190,255,0.16)");
    grad.addColorStop(1,"rgba(90,190,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(z.x,z.y,z.r,0,Math.PI*2); ctx.fill();
  }
  // Portallar
  for(const p of world.portals){
    for(const end of [p.a,p.b]){
      if(!inView(end.x,end.y,40)) continue;
      const pulse = 26 + Math.sin(now/300)*4;
      ctx.strokeStyle = "rgba(200,120,255,0.8)";
      ctx.lineWidth = 4/zoom;
      ctx.beginPath(); ctx.arc(end.x,end.y,pulse,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle = "rgba(200,120,255,0.15)";
      ctx.beginPath(); ctx.arc(end.x,end.y,pulse,0,Math.PI*2); ctx.fill();
    }
  }

  // Bitkiler (dekor)
  for(const pl of world.plants){
    if(!inView(pl.x,pl.y,pl.r)) continue;
    const sway = Math.sin(now/900 + pl.sway)*3;
    ctx.fillStyle = `hsla(${pl.hue},70%,45%,0.55)`;
    ctx.beginPath();
    ctx.ellipse(pl.x+sway, pl.y, pl.r*0.5, pl.r, 0, 0, Math.PI*2);
    ctx.fill();
  }

  // Kayalar (engeller)
  for(const rock of world.rocks){
    if(!inView(rock.x,rock.y,rock.r)) continue;
    ctx.save();
    ctx.translate(rock.x,rock.y); ctx.rotate(rock.rot);
    ctx.fillStyle = "#3a4258";
    ctx.strokeStyle = "#1c2236";
    ctx.lineWidth = 3/zoom;
    ctx.beginPath();
    const spikes = 7;
    for(let i=0;i<spikes;i++){
      const a = (i/spikes)*Math.PI*2;
      const rr = rock.r*(0.8+((i%2)?0.2:0));
      const x = Math.cos(a)*rr, y = Math.sin(a)*rr;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Yiyecekler
  const highQ = quality === "high";
  for(const f of world.food){
    if(!inView(f.x,f.y,f.r)) continue;
    ctx.beginPath();
    ctx.fillStyle = `hsl(${f.hue} 85% 65%)`;
    if(highQ){ ctx.shadowColor = `hsl(${f.hue} 85% 60%)`; ctx.shadowBlur = 8; } else ctx.shadowBlur = 0;
    ctx.arc(f.x, f.y, f.r, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  // Bonus yemekler (parlak, dönen)
  for(const f of world.bonusFood){
    if(!inView(f.x,f.y,f.r+6)) continue;
    ctx.save();
    ctx.translate(f.x,f.y); ctx.rotate(now/500 + f.spin);
    ctx.fillStyle = "#ffc857";
    ctx.shadowColor = "#ffc857"; ctx.shadowBlur = quality==="low" ? 0 : 16;
    ctx.beginPath();
    for(let i=0;i<5;i++){
      const a = (i/5)*Math.PI*2;
      const rr = i%2===0 ? f.r : f.r*0.45;
      const x = Math.cos(a)*rr, y = Math.sin(a)*rr;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.shadowBlur = 0;

  // Harita sınırı — belirgin
  ctx.strokeStyle = "rgba(255,90,90,0.65)";
  ctx.lineWidth = 6/zoom;
  ctx.strokeRect(0,0,WORLD_SIZE,WORLD_SIZE);
  ctx.strokeStyle = "rgba(255,90,90,0.18)";
  ctx.lineWidth = 22/zoom;
  ctx.strokeRect(0,0,WORLD_SIZE,WORLD_SIZE);

  ctx.restore();
  return { vx0,vx1,vy0,vy1 };
}

export function drawMinimap(minimapCtx, canvas, player, remotePlayers, friendIds){
  const c = minimapCtx;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  c.clearRect(0,0,w,h);
  c.fillStyle = "rgba(10,14,23,0.45)";
  c.beginPath(); c.arc(w/2,h/2,w/2,0,Math.PI*2); c.fill();
  const scale = w / WORLD_SIZE;
  for(const [id, rp] of remotePlayers){
    c.beginPath();
    c.fillStyle = friendIds && friendIds.has(id) ? "#ffc857" : "rgba(255,255,255,0.6)";
    c.arc(rp.x*scale, rp.y*scale, friendIds && friendIds.has(id) ? 3.5 : 2.4, 0, Math.PI*2);
    c.fill();
  }
  if(player){
    c.beginPath();
    c.fillStyle = "#43ecc4";
    c.arc(player.x*scale, player.y*scale, 4.5, 0, Math.PI*2);
    c.fill();
    c.strokeStyle = "#fff"; c.lineWidth = 1; c.stroke();
  }
}
