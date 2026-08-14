/* =========================================================================
   BOTS — tamamen yerel, Firebase'siz yapay zekâ oyuncular.
   İnternet gerektirmez, hiçbir veriyi sunucuya göndermez. Yem toplar,
   büyür, kendinden küçüklerden kaçılması gerekeni avlar, kendinden
   büyüklerden kaçar. Rastgele gezinmek yerine her zaman bir hedefe
   doğru hareket eder.
   ========================================================================= */
import {
  WORLD_SIZE, speedForRadius, rand, randInt, clamp, dist2,
  EAT_RATIO, FOOD_MASS, BONUS_FOOD_MASS, SKIN_COLORS,
} from "./core.js";
import { Blob } from "./world.js";

const BOT_NAME_A = [
  "Kızıl","Gölge","Hızlı","Vahşi","Sinsi","Küçük","Dev","Sessiz","Çılgın",
  "Turbo","Gizli","Aç","Yalnız","Efsane","Rüzgar","Mavi","Yeşil","Altın",
];
const BOT_NAME_B = [
  "Amip","Mikrop","Balon","Kaplan","Fırtına","Yıldız","Canavar","Avcı",
  "Gezgin","Bulut","Şimşek","Kurt","Ejder","Alev","Hayalet","Kartal","Şahin",
];
function randomBotName(){
  const a = BOT_NAME_A[randInt(0, BOT_NAME_A.length-1)];
  const b = BOT_NAME_B[randInt(0, BOT_NAME_B.length-1)];
  return `${a}${b}${randInt(1,99)}`;
}

const VIEW_RADIUS = 480;
const VIEW_RADIUS2 = VIEW_RADIUS*VIEW_RADIUS;
const BOT_CAP = 24;

export class Bot extends Blob{
  constructor(x,y,mass,color,name){
    super(x,y,mass,color,name,"");
    this.isBot = true;
    this.state = "wander";       // wander | seekFood | chase | flee
    this.targetX = x; this.targetY = y;
    this.wanderTimer = 0;
    this.thinkTimer = rand(0,0.2); // botlar aynı karede senkron "düşünmesin" diye
  }
}

export class BotManager{
  constructor(world){
    this.world = world;
    this.bots = [];
  }

  clear(){ this.bots = []; }

  /* n bot eklemeye çalışır (kapasite dahilinde), gerçekten eklenen sayıyı döndürür */
  add(n=1, player=null, remotePlayers=null){
    n = Math.max(0, Math.floor(n) || 0);
    n = Math.min(n, BOT_CAP - this.bots.length);
    let added = 0;
    for(let i=0;i<n;i++){
      const avoid = new Map();
      if(remotePlayers){ try{ for(const [id,rp] of remotePlayers) avoid.set(id, rp); }catch(e){} }
      if(player) avoid.set("__player", player);
      this.bots.forEach((b,idx)=> avoid.set("__bot"+idx, b));
      const spawn = this.world.findSafeSpawn(avoid);
      const mass = rand(35, 90);
      const color = SKIN_COLORS[randInt(0, SKIN_COLORS.length-1)];
      this.bots.push(new Bot(spawn.x, spawn.y, mass, color, randomBotName()));
      added++;
    }
    return added;
  }

  removeBot(bot){
    const idx = this.bots.indexOf(bot);
    if(idx>=0) this.bots.splice(idx,1);
  }

  _pickThreatOrPrey(bot, player){
    let bestThreatD2 = Infinity, threat = null;
    let bestPreyD2 = Infinity, prey = null;

    const consider = (ex,ey,emass)=>{
      const d2 = dist2(bot.x,bot.y,ex,ey);
      if(d2 > VIEW_RADIUS2) return;
      if(emass > bot.mass*EAT_RATIO){
        if(d2 < bestThreatD2){ bestThreatD2 = d2; threat = {x:ex,y:ey}; }
      }else if(bot.mass > emass*EAT_RATIO){
        if(d2 < bestPreyD2){ bestPreyD2 = d2; prey = {x:ex,y:ey}; }
      }
    };

    if(player && !player.invulnerable && !bot.invulnerable){
      consider(player.x, player.y, player.mass);
    }
    for(const ob of this.bots){
      if(ob === bot || ob.invulnerable || bot.invulnerable) continue;
      consider(ob.x, ob.y, ob.mass);
    }
    return { threat, prey };
  }

  _nearestFood(bot, world){
    let best = null, bestD2 = Infinity;
    for(const f of world.bonusFood){
      const d2 = dist2(bot.x,bot.y,f.x,f.y);
      if(d2 < VIEW_RADIUS2 && d2 < bestD2){ bestD2 = d2; best = f; }
    }
    if(best) return best;
    // Performans için tüm yemek listesini taramak yerine rastgele bir alt küme kontrol edilir
    const tries = Math.min(28, world.food.length);
    for(let i=0;i<tries;i++){
      const f = world.food[randInt(0, world.food.length-1)];
      if(!f) continue;
      const d2 = dist2(bot.x,bot.y,f.x,f.y);
      if(d2 < VIEW_RADIUS2 && d2 < bestD2){ bestD2 = d2; best = f; }
    }
    return best;
  }

  update(dt, world, player){
    const livingPlayer = (player && !player._dead) ? player : null;

    for(const bot of this.bots){
      bot.tick(dt);
      bot.thinkTimer -= dt;
      if(bot.thinkTimer <= 0){
        bot.thinkTimer = 0.22 + Math.random()*0.16;
        const { threat, prey } = this._pickThreatOrPrey(bot, livingPlayer);
        if(threat){
          bot.state = "flee";
          bot.targetX = bot.x + (bot.x - threat.x);
          bot.targetY = bot.y + (bot.y - threat.y);
        }else if(prey){
          bot.state = "chase";
          bot.targetX = prey.x; bot.targetY = prey.y;
        }else{
          const food = this._nearestFood(bot, world);
          if(food){
            bot.state = "seekFood";
            bot.targetX = food.x; bot.targetY = food.y;
          }else{
            bot.wanderTimer -= 0.22;
            if(bot.wanderTimer <= 0 || bot.state !== "wander"){
              bot.state = "wander";
              bot.wanderTimer = rand(2,5);
              const margin = 220;
              bot.targetX = rand(margin, WORLD_SIZE-margin);
              bot.targetY = rand(margin, WORLD_SIZE-margin);
            }
          }
        }
      }

      let dx = bot.targetX - bot.x, dy = bot.targetY - bot.y;
      const d = Math.hypot(dx,dy);
      if(d > 2){
        dx/=d; dy/=d;
        let spd = speedForRadius(bot.r) * world.speedMultiplierAt(bot.x,bot.y);
        if(bot.state === "flee") spd *= 1.08;
        bot.x = clamp(bot.x + dx*spd*dt, bot.r, WORLD_SIZE-bot.r);
        bot.y = clamp(bot.y + dy*spd*dt, bot.r, WORLD_SIZE-bot.r);
      }
      world.resolveRockCollision(bot);

      // Yiyecek toplama
      for(let i=world.food.length-1;i>=0;i--){
        const f = world.food[i];
        if(dist2(bot.x,bot.y,f.x,f.y) < (bot.r+f.r)*(bot.r+f.r)){
          world.food.splice(i,1);
          bot.grow(FOOD_MASS);
        }
      }
      for(let i=world.bonusFood.length-1;i>=0;i--){
        const f = world.bonusFood[i];
        if(dist2(bot.x,bot.y,f.x,f.y) < (bot.r+f.r+6)*(bot.r+f.r+6)){
          world.bonusFood.splice(i,1);
          bot.grow(BONUS_FOOD_MASS);
          world.bonusFood.push(world._newBonusFood());
        }
      }
    }

    // Bot-bot yeme (büyük olan küçüğü yer)
    for(let i=this.bots.length-1;i>=0;i--){
      const a = this.bots[i];
      if(!a || a.invulnerable) continue;
      for(let j=this.bots.length-1;j>=0;j--){
        if(i===j) continue;
        const b = this.bots[j];
        if(!b || b.invulnerable) continue;
        const rr = a.r*0.72 + b.r*0.72;
        if(dist2(a.x,a.y,b.x,b.y) < rr*rr && a.mass > b.mass*EAT_RATIO){
          a.grow(b.mass*0.78);
          this.bots.splice(j,1);
          if(j<i) i--;
          break;
        }
      }
    }
  }
}
