/* =========================================================================
   FIREBASE ALTYAPISI — AKTİF
   ---------------------------------------------------------------------
   Bu dosya bir ES module olarak index.html'e <script type="module"> ile
   ekleniyor ve sayfa yüklendiğinde otomatik çalışır. Firebase JS SDK,
   npm/build aracı gerekmeden doğrudan Google'ın CDN'inden (gstatic)
   modül olarak çekiliyor — projeye hiçbir paket kurmanıza gerek yok.

   MEVCUT ALTYAPI KORUNDU: leaderboard / live_players koleksiyonları ve
   window.FirebaseBridge.submitScore / getTopScores / joinArena /
   updatePosition / leaveArena / reportEaten / subscribePlayers
   fonksiyonları birebir aynı şekilde çalışmaya devam ediyor.

   YENİ EKLENENLER (geriye dönük uyumlu, opsiyonel):
     - window.FirebaseBridge.uploadAvatar(sessionId, file)  → Storage'a yükler, URL döner
     - window.FirebaseBridge.createRoom / joinRoom / leaveRoom / subscribeRoom
     - window.FirebaseBridge.sendChatMessage / subscribeChat
   Bu yeni özellikler için Firebase Console'da "Storage" servisini
   etkinleştirmeniz ve aşağıdaki kuralları eklemeniz gerekir (bkz. dosya
   sonundaki NOT bölümü). Etkinleştirilmemişse avatar yükleme sessizce
   başarısız olur ve oyun yerel (localStorage) profil rengiyle devam eder.
========================================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAnalytics, isSupported as analyticsIsSupported } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js";
import {
  getFirestore, collection, addDoc, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

// Kendi Firebase proje yapılandırmanız:
const firebaseConfig = {
  apiKey: "AIzaSyD9LVrUfoKVpoQeZ2RLNkQJYk44o2dBLLA",
  authDomain: "amip-ea67b.firebaseapp.com",
  projectId: "amip-ea67b",
  storageBucket: "amip-ea67b.firebasestorage.app",
  messagingSenderId: "396524429723",
  appId: "1:396524429723:web:d46dd80d5fcca1c01a813e",
  measurementId: "G-HD4Q40ZNNY"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
let storage = null;
try{ storage = getStorage(app); }catch(e){ storage = null; }

// Analytics yalnızca destekleniyorsa başlat (ör. bazı tarayıcılarda / gizlilik modunda desteklenmeyebilir)
analyticsIsSupported().then((ok) => { if (ok) getAnalytics(app); }).catch(() => {});

// Basit istemci taraflı doğrulama — asıl güvenlik Firestore kurallarında (aşağıdaki NOT'a bakın)
function sanitizeName(name) {
  return String(name || "Sen").trim().slice(0, 16) || "Sen";
}
function sanitizeScore(score) {
  const n = Math.round(Number(score) || 0);
  return Math.max(0, Math.min(n, 500000));
}
function sanitizeRoomCode(code){
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
}

const livePlayersCol = collection(db, "live_players");

window.FirebaseBridge = {
  // --- Yüksek skor tablosu (kalıcı) ---
  async submitScore(name, score) {
    await addDoc(collection(db, "leaderboard"), {
      name: sanitizeName(name),
      score: sanitizeScore(score),
      ts: serverTimestamp(),
    });
  },
  async getTopScores(n = 10) {
    const q = query(collection(db, "leaderboard"), orderBy("score", "desc"), limit(n));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
  },

  // --- Canlı arena: gerçek, o an bağlı oyuncular (bot YOK) ---
  async joinArena(id, data) {
    await setDoc(doc(db, "live_players", id), {
      name: sanitizeName(data.name),
      x: Number(data.x) || 0,
      y: Number(data.y) || 0,
      mass: sanitizeScore(data.mass),
      color: String(data.color || "#43ecc4"),
      avatarUrl: String(data.avatarUrl || ""),
      roomCode: sanitizeRoomCode(data.roomCode || ""),
      updatedAt: serverTimestamp(),
    });
  },
  async updatePosition(id, data) {
    await setDoc(doc(db, "live_players", id), {
      name: sanitizeName(data.name),
      x: Number(data.x) || 0,
      y: Number(data.y) || 0,
      mass: sanitizeScore(data.mass),
      color: String(data.color || "#43ecc4"),
      avatarUrl: String(data.avatarUrl || ""),
      roomCode: sanitizeRoomCode(data.roomCode || ""),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  },
  async leaveArena(id) {
    try { await deleteDoc(doc(db, "live_players", id)); } catch (e) { /* zaten silinmiş olabilir */ }
  },
  async reportEaten(targetId, byName) {
    try {
      await updateDoc(doc(db, "live_players", targetId), {
        eatenBy: sanitizeName(byName),
        eatenAt: serverTimestamp(),
      });
    } catch (e) { /* rakip zaten ayrılmış olabilir, sorun değil */ }
  },
  // callback(list) her değişiklikte tüm canlı oyuncularla çağrılır (kendi dokümanınız dahil)
  subscribePlayers(callback) {
    return onSnapshot(livePlayersCol, (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => { console.warn("[FirebaseBridge] canlı oyuncu aboneliği hatası:", err); });
  },

  // --- Avatar yükleme (Firebase Storage) ---
  async uploadAvatar(sessionId, file) {
    if (!storage) throw new Error("Storage kullanılamıyor");
    const path = `avatars/${sessionId}_${Date.now()}.jpg`;
    const r = ref(storage, path);
    await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
    return await getDownloadURL(r);
  },

  // --- Özel oda (arkadaşınla oyna) ---
  async createRoom(hostName) {
    const code = sanitizeRoomCode(Math.random().toString(36).slice(2, 8));
    await setDoc(doc(db, "rooms", code), {
      hostName: sanitizeName(hostName),
      createdAt: serverTimestamp(),
    });
    return code;
  },
  async joinRoomCheck(code) {
    const c = sanitizeRoomCode(code);
    const snap = await getDocs(query(collection(db, "rooms")));
    return snap.docs.some((d) => d.id === c);
  },
  subscribeRoomPlayers(code, callback) {
    // Aynı oda kodundaki canlı oyuncuları live_players üzerinden filtreleyerek izler
    return onSnapshot(livePlayersCol, (snap) => {
      const c = sanitizeRoomCode(code);
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.roomCode === c));
    }, () => {});
  },

  // --- Gerçek zamanlı oda sohbeti ---
  async sendChatMessage(roomCode, name, text) {
    const c = sanitizeRoomCode(roomCode) || "GLOBAL";
    await addDoc(collection(db, "rooms", c, "chat"), {
      name: sanitizeName(name),
      text: String(text || "").trim().slice(0, 200),
      ts: serverTimestamp(),
    });
  },
  subscribeChat(roomCode, callback) {
    const c = sanitizeRoomCode(roomCode) || "GLOBAL";
    const q = query(collection(db, "rooms", c, "chat"), orderBy("ts", "asc"), limit(50));
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map((d) => d.data()));
    }, () => {});
  },
};

console.log("[FirebaseBridge] Hazır — leaderboard + canlı arena + oda/sohbet + avatar Firestore/Storage'a bağlı.");

/* ---------------------------------------------------------------------
   ÖNEMLİ — Firestore Güvenlik Kuralları
   ---------------------------------------------------------------------
   Bu bridge herkesin doğrudan yazabildiği açık koleksiyonlar kullanıyor.
   Firebase Console'da Firestore > Rules kısmına şunu yapıştırın; aksi
   halde varsayılan kurallar tüm yazma/okumayı reddeder ve skorlar hiç
   kaydedilmez:

   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /leaderboard/{entry} {
         allow read: if true;
         allow create: if request.resource.data.name is string
                       && request.resource.data.name.size() <= 16
                       && request.resource.data.score is number
                       && request.resource.data.score >= 0
                       && request.resource.data.score <= 500000;
         allow update, delete: if false;
       }
       match /live_players/{playerId} {
         allow read: if true;
         allow create: if request.resource.data.name is string
                       && request.resource.data.name.size() <= 16
                       && request.resource.data.mass is number
                       && request.resource.data.mass >= 0
                       && request.resource.data.mass <= 500000;
         allow update: if request.resource.data.mass is number
                       && request.resource.data.mass >= 0
                       && request.resource.data.mass <= 500000;
         allow delete: if true;
       }
       match /rooms/{roomCode} {
         allow read, create: if true;
         allow update, delete: if false;
         match /chat/{msgId} {
           allow read: if true;
           allow create: if request.resource.data.name is string
                         && request.resource.data.text is string
                         && request.resource.data.text.size() <= 200;
           allow update, delete: if false;
         }
       }
     }
   }

   Bu kurallar: herkesin okumasına izin verir, yazmayı isim/skor
   sınırlarına uyan kayıtlarla sınırlar. "leaderboard" kayıtları hiç
   değiştirilemez/silinemez; "live_players" ise oyuncular ayrıldığında
   silinebilsin diye (delete: true) açık bırakıldı. NOT: Auth kurulu
   olmadığı için teknik olarak herkes herkesin canlı-oyuncu dokümanını
   güncelleyebilir/silebilir (arenanın "eatenBy" mekaniği zaten buna
   dayanıyor) — bu basit/sunucusuz mimarinin kabul edilen açığıdır.
   Kötüye kullanımı azaltmak için Firebase App Check eklemeniz önerilir.

   ---------------------------------------------------------------------
   YENİ — Firebase Storage Kuralları (avatar yükleme için gerekli)
   ---------------------------------------------------------------------
   Firebase Console'da soldaki menüden "Storage" servisini bir kez
   etkinleştirmeniz gerekir (henüz etkin değilse). Sonra Storage > Rules:

   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /avatars/{fileName} {
         allow read: if true;
         allow write: if request.resource.size < 3 * 1024 * 1024
                      && request.resource.contentType.matches('image/.*');
       }
     }
   }

   Storage etkinleştirilmemişse uploadAvatar() hata fırlatır; oyun bunu
   yakalar ve avatarsız/yerel profil rengiyle sorunsuz devam eder.
--------------------------------------------------------------------- */
