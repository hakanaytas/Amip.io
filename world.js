/* =========================================================================
   WORLD — harita üretimi (kayalar, bitkiler, zehir/hız bölgeleri, portallar)
   ve hücre (Blob) varlığı
   ========================================================================= */
import {
  WORLD_SIZE, BASE_RADIUS, FOOD_RADIUS, FOOD_MASS, BONUS_FOOD_MASS,
  radiusForMass, rand, randInt, SHIELD_DURATION, FOOD_TARGET_BASE,
  OBSTACLE_COUNT, PLANT_COUNT, dist,
} from "./core.js";

/* ---------------- Hücre (yerel oyuncu ya da referans) ---------------- */
export class Blob{
  constructor(x,y,mass,color,name,avatarUrl=""){
    this.x=x; this.y=y; this.mass=mass; this.color=color; this.name=name;
    this.avatarUrl = avatarUrl;
    this.r = radiusForMass(mass);
    this.eatenCount=0;
    this.shieldTime = SHIELD_DURATION; // doğduğunda koruma altında
    this.scalePunch = 1; // yeme anındaki "büyüme zıplaması" animasyonu
    this.glow = 0; // parlama efekti gücü (0..1)
    this.deathT = 0; // ölüm animasyonu ilerleme süresi
    this.avatarImg = null;
    this._loadAvatar();
  }
  _loadAvatar(){
    if(!this.avatarUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = ()=>{ this.avatarImg = img; };
    img.src = this.avatarUrl;
  }
  setAvatar(url){
    this.avatarUrl = url;
    this.avatarImg = null;
    this._loadAvatar();
  }
  updateRadius(){ this.r = radiusForMass(this.mass); }
  get invulnerable(){ return this.shieldTime > 0; }
  grow(amount){
    this.mass += amount;
    this.updateRadius();
    this.scalePunch = 1.18; // pop efekti; render sırasında sönümlenir
    this.glow = 1;
  }
  tick(dt){
    if(this.shieldTime > 0) this.shieldTime = Math.max(0, this.shieldTime - dt);
    if(this.scalePunch > 1) this.scalePunch = Math.max(1, this.scalePunch - dt*1.6);
    if(this.glow > 0) this.glow = Math.max(0, this.glow - dt*1.4);
  }
}

/* ---------------- Harita üretimi ---------------- */
export class World{
  constructor(quality){
    this.quality = quality;
    this.food = [];
    this.bonusFood = [];
    this.rocks = [];
    this.plants = [];
    this.poisonZones = [];
    this.speedZones = [];
    this.portals = []; // çift halinde {a:{x,y}, b:{x,y}}
    this._generateStatic();
    this.reseedFood();
  }

  _generateStatic(){
    const rockN = OBSTACLE_COUNT[this.quality] || OBSTACLE_COUNT.mid;
    const plantN = PLANT_COUNT[this.quality] || PLANT_COUNT.mid;
    const margin = 260;

    this.rocks = [];
    for(let i=0;i<rockN;i++){
      this.rocks.push({
        x: rand(margin, WORLD_SIZE-margin), y: rand(margin, WORLD_SIZE-margin),
        r: rand(45, 110), rot: rand(0, Math.PI*2),
      });
    }
    this.plants = [];
    for(let i=0;i<plantN;i++){
      this.plants.push({
        x: rand(margin, WORLD_SIZE-margin), y: rand(margin, WORLD_SIZE-margin),
        r: rand(10, 22), sway: rand(0, Math.PI*2), hue: Math.floor(rand(95,160)),
      });
    }
    this.poisonZones = [];
    for(let i=0;i<4;i++){
      this.poisonZones.push({ x: rand(margin,WORLD_SIZE-margin), y: rand(margin,WORLD_SIZE-margin), r: rand(160,260) });
    }
    this.speedZones = [];
    for(let i=0;i<4;i++){
      this.speedZones.push({ x: rand(margin,WORLD_SIZE-margin), y: rand(margin,WORLD_SIZE-margin), r: rand(140,220) });
    }
    this.portals = [];
    for(let i=0;i<2;i++){
      this.portals.push({
        a: { x: rand(margin,WORLD_SIZE-margin), y: rand(margin,WORLD_SIZE-margin) },
        b: { x: rand(margin,WORLD_SIZE-margin), y: rand(margin,WORLD_SIZE-margin) },
      });
    }
  }

  reseedFood(){
    const target = FOOD_TARGET_BASE[this.quality] || FOOD_TARGET_BASE.mid;
    this.food = [];
    for(let i=0;i<target;i++) this.food.push(this._newFood());
    this.bonusFood = [];
    for(let i=0;i<6;i++) this.bonusFood.push(this._newBonusFood());
  }
  _newFood(){
    return { x: rand(20,WORLD_SIZE-20), y: rand(20,WORLD_SIZE-20), hue: Math.floor(rand(140,260)), r: FOOD_RADIUS+rand(-1.5,1.5) };
  }
  _newBonusFood(){
    return { x: rand(20,WORLD_SIZE-20), y: rand(20,WORLD_SIZE-20), r: 15, spin: rand(0,Math.PI*2) };
  }

  /* Bir noktanın güvenli olup olmadığını kontrol eder: kayalardan uzak ve
     yakında hiçbir düşman (uzak oyuncu) yok */
  isSafeSpawn(x, y, remotePlayers){
    for(const rock of this.rocks){ if(dist(x,y,rock.x,rock.y) < rock.r + 60) return false; }
    for(const rp of remotePlayers.values()){
      if(dist(x,y,rp.x,rp.y) < 320) return false;
    }
    return true;
  }
  findSafeSpawn(remotePlayers){
    const margin = 200;
    for(let tries=0; tries<40; tries++){
      const x = rand(margin, WORLD_SIZE-margin);
      const y = rand(margin, WORLD_SIZE-margin);
      if(this.isSafeSpawn(x,y,remotePlayers)) return {x,y};
    }
    // güvenli bölge bulunamazsa harita merkezine yakın rastgele bir nokta döndür
    return { x: rand(WORLD_SIZE*0.3,WORLD_SIZE*0.7), y: rand(WORLD_SIZE*0.3,WORLD_SIZE*0.7) };
  }

  /* Belirli bir konumun hangi hız çarpanına sahip olduğunu döndürür */
  speedMultiplierAt(x,y){
    for(const z of this.speedZones){ if(dist(x,y,z.x,z.y) < z.r) return 1.6; }
    return 1;
  }
  poisonAt(x,y){
    for(const z of this.poisonZones){ if(dist(x,y,z.x,z.y) < z.r) return true; }
    return false;
  }
  /* Aktif portala girildiyse diğer ucun konumunu döndürür */
  portalAt(x,y,r){
    for(const p of this.portals){
      if(dist(x,y,p.a.x,p.a.y) < r*0.6+18) return { x:p.b.x, y:p.b.y };
      if(dist(x,y,p.b.x,p.b.y) < r*0.6+18) return { x:p.a.x, y:p.a.y };
    }
    return null;
  }
  /* Kaya çarpışması: basit itme (blocker) */
  resolveRockCollision(entity){
    for(const rock of this.rocks){
      const d = dist(entity.x,entity.y,rock.x,rock.y);
      const minD = rock.r + entity.r*0.55;
      if(d < minD && d > 0.001){
        const push = (minD - d);
        const nx = (entity.x-rock.x)/d, ny = (entity.y-rock.y)/d;
        entity.x += nx*push; entity.y += ny*push;
      }
    }
  }
}
