/* TODO */
/* 
Nem volt időm ezt rendesen átnyálazni, viszont 1-2 dolgot észrevettem:
- Az elején a cím is el kéne tűnjön pár másodperc után
- A jelenetek végére is kellene fade

Ami még szerintem jól jöhet:
- Fullscreen button
- Valami konszolidált play/pause button

Meg a landing még semmilyen formában nincsen kitalálva - erről te beszéltél Áronnal am?

*/

/* ============================================================
  Optimalizált, olvasható player
  - javítások: oncanplay overlay, AV sync, timeupdate alapú logika,
                replay időalapú figyelés, menu scroll, iOS autoplay handling,
                copy fallback
  - állapot a 'state' objektumban
============================================================ */

(() => {
  /* -------------------- Konfiguráció / paraméterek -------------------- */
  const HIDE_START = 30;    // intro: menü ne jelenjen meg az elején (mp)
  const HIDE_END = 30;     // outro: menü ne jelenjen meg a végén (mp)
  const SYNC_DRIFT_THRESHOLD = 0.25; // mp, ha ennél nagyobb a drift, resync
  const PROGRESS_UPDATE_MS = 250; // biztonsági fallback, de főként timeupdate-vel dolgozunk

  /* -------------------- Állapot -------------------- */
  const state = {
    recording: false,
    replayMode: false,
    overlayActive: false,
    recordedScenes: [],      // {scene, src, time}
    playedScenes: new Set(),
    pendingReplayIndex: 0,   // replay: index a következő segmentehez
    replaySegments: [],      // replay payload
    lastProgressUpdate: 0
  };

  /* -------------------- DOM elemek -------------------- */
  const baseVideo = document.getElementById('baseVideo');
  const overlayVideo = document.getElementById('overlayVideo');
  const bgAudio = document.getElementById('bgAudio');
  const playButton = document.getElementById('playButton');
  const hamb = document.getElementById('hamb');
  const menu = document.getElementById('menu');
  const sceneItems = Array.from(document.querySelectorAll('.sceneItem'));
  const cornerLabel = document.getElementById('cornerLabel');
  const progressBar = document.getElementById('progressBar');
  const linkBox = document.getElementById('linkBox');
  const generatedLink = document.getElementById('generatedLink');
  const copyBtn = document.getElementById('copyBtn');

  /* -------------------- Segédfüggvények -------------------- */
  const safePlay = async (media, isMuted) => {
    // próbáljunk meg játszani, iOS-hez explicit user click szükséges
    try {
      media.muted = isMuted;
      await media.play();
    } catch (e) {
      // nem sikerült autoplay (iOS / autoplay policy) — kezeljük a UX-ben
      // Egyszerűen elnyeljük a hibát; lejátszás kézzel indítható ismét
    }
  };

  const showEl = (el, visible=true) => { el.style.display = visible ? 'block' : 'none'; };
  const toggleClass = (el, cls, on) => { if (on) el.classList.add(cls); else el.classList.remove(cls); };

  const encodePayload = (payload) => {
    const s = JSON.stringify(payload);
    return btoa(unescape(encodeURIComponent(s)));
  };
  const decodePayload = (b64) => {
    try { return JSON.parse(decodeURIComponent(escape(atob(b64)))); } catch (e) { return null; }
  };

  const updateProgressBar = () => {
    if (!isFinite(baseVideo.duration) || baseVideo.duration <= 0) return;
    const perc = (baseVideo.currentTime / baseVideo.duration) * 100;
    progressBar.style.width = perc + '%';
  };

  const showCornerLabel = (text) => {
    if (text) {
      cornerLabel.textContent = text;
      cornerLabel.classList.add('show');
    } else {
      cornerLabel.classList.remove('show');
    }
  };

  /* -------------------- Lejátszás indítása (felhasználói kattintás) ------------- */
  const startRecordingPlayback = async () => {
    // User-interaction: erre hivatkozva próbáljuk elindítani a két médiaelemet
    playButton.style.display = 'none';
    // próbáljuk egyszerre elindítani (safePlay elnyeli a hibákat)
    await Promise.all([safePlay(baseVideo, true), safePlay(bgAudio, false)]);
    state.recording = true;
    state.recordedScenes = [];
    state.playedScenes = new Set();
    showCornerLabel('Góbé - Nádas');
    hamb.style.display = 'none';
    // progress frissítése timeupdate eseményen keresztül
  };

  /* -------------------- Ellenőrző logika (timeupdate alapú) ------------------ */
  // AV szinkronizálás: ha a két lejátszó elcsúszik, igazítsuk a bgAudio-t a baseVideo-hoz
  const handleTimeUpdate = () => {
    // progress
    updateProgressBar();

    // menü megjelenítés logika
    const cur = baseVideo.currentTime || 0;
    const dur = baseVideo.duration || Infinity;
    if (cur < HIDE_START || (isFinite(dur) && (dur - cur) <= HIDE_END)) {
      hamb.style.display = 'none';
    } else if (!state.overlayActive && state.recording) {
      hamb.style.display = 'block';
    }

    // AV sync
    const drift = Math.abs((baseVideo.currentTime || 0) - (bgAudio.currentTime || 0));
    if (drift > SYNC_DRIFT_THRESHOLD) {
      // korrigáljuk az audio-t a videóhoz (audio időpontot állítjuk)
      try { bgAudio.currentTime = baseVideo.currentTime; } catch (e) { /* biztonsági catch */ }
    }

    // lejátszás vége
    if (isFinite(dur) && cur >= dur - 0.05) {
      endRecordingPlayback();
    }

    // replay: ha replay mode aktív, figyeljük a replaySegments-t és indítsuk a következőt, ha elérte az időt
    if (state.replayMode && Array.isArray(state.replaySegments)) {
      const idx = state.pendingReplayIndex;
      if (idx < state.replaySegments.length) {
        const seg = state.replaySegments[idx];
        if ((bgAudio.currentTime || 0) >= (seg.time || 0)) {
          // indítsuk a jelenetet
          playOverlayScene(seg.src);
          state.pendingReplayIndex++;
        }
      }
    }
  };

  /* -------------------- Overlay lejátszása — ONCANPLAY kezelés ---------------- */
  const playOverlayScene = (src, {once=false} = {}) => {
    state.overlayActive = true;
    // Tisztítás: ha volt korábbi src, töröljük az oncanplay/onended
    overlayVideo.oncanplay = null;
    overlayVideo.onended = null;

    overlayVideo.src = src;
    // Ne mutassuk addig, amíg canplay-el nem jelez a video (ez megszünteti a "villanás" effektust)
    overlayVideo.oncanplay = () => {
      overlayVideo.classList.add('show');
      // ha van szükség rá, a safePlay elnyeli az esetleges autoplay hibát
      safePlay(overlayVideo, true);
    };

    overlayVideo.onended = () => {
      overlayVideo.classList.remove('show');
      // remove src és load, hogy memóriát felszabadítsunk
      overlayVideo.removeAttribute('src');
      overlayVideo.load();
      state.overlayActive = false;
    };
  };

  /* -------------------- Vég (rögzítés befejeződése) ---------------------- */
  const endRecordingPlayback = () => {
    state.recording = false;
    baseVideo.pause();
    bgAudio.pause();
    hamb.style.display = 'none';
    showCornerLabel('');
    // prepare link
    const payload = { segments: state.recordedScenes, version: 1 };
    const url = location.origin + location.pathname + '?story=' + encodePayload(payload);
    generatedLink.value = url;
    linkBox.style.display = 'flex';
  };

  /* -------------------- Scene click kezelése (recording közben) ----------- */
  const handleSceneClick = (item) => {
    const scene = item.dataset.scene;
    const src = item.dataset.src;
    if (!scene || !src) return;
    if (state.playedScenes.has(scene) || state.replayMode) return;

    // jelöljük meg, hogy játszott
    state.playedScenes.add(scene);
    item.classList.add('played');

    // ha rögzítés alatt vagyunk, mentsük a jelenetet a bgAudio pillanatához (precíz idő alap)
    if (state.recording) {
      const t = Math.max(0, Math.floor(bgAudio.currentTime || 0));
      state.recordedScenes.push({ scene, src, time: t });
    }

    // UI: zárjuk a menüt, rejtsük a hamburgert
    menu.classList.remove('show');
    hamb.setAttribute('aria-expanded', 'false');
    hamb.style.display = 'none';

    // mutassuk a címkét röviden és játsszuk le az overlayt
    showCornerLabel(item.textContent || scene);
    playOverlayScene(src);
    // ha szükséges, egy timeout után eltüntetjük a címkét (vagy overlay onended is eltávolítja)
    setTimeout(() => showCornerLabel(''), 2600);
  };

  /* -------------------- Replay logika (timeupdate alapú) ------------------ */
  const scheduleReplay = (segments) => {
    state.replayMode = true;
    state.replaySegments = Array.isArray(segments) ? segments.slice() : [];
    state.pendingReplayIndex = 0;
    // UI: mutassuk a play button; amikor a felhasználó elindítja a lejátszást, a timeupdate handler fog indítani jeleneteket
    playButton.style.display = 'block';
    playButton.onclick = async () => {
      // elindítjuk az alap videót és az audio-t — a timeupdate figyelni fogja az időpontokat
      playButton.style.display = 'none';
      await Promise.all([safePlay(baseVideo, true), safePlay(bgAudio, false)]);
      // ne engedjük több kattintással duplikálni
      playButton.onclick = null;
    };
  };

  /* -------------------- Másolás vágólapra (Clipboard API + fallback) -------- */
  const copyToClipboard = (text) => {
    if (!text) return Promise.reject('Nincs szöveg');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    } else {
      // fallback: textarea + execCommand
      return new Promise((resolve, reject) => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try {
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          ok ? resolve() : reject('execCommand failed');
        } catch (e) {
          document.body.removeChild(ta);
          reject(e);
        }
      });
    }
  };

  /* -------------------- Események regisztrálása ------------------ */

  // play gomb: indítás (user-interaction)
  playButton.addEventListener('click', async (e) => {
    // Ha replay mode van beállítva, a scheduleReplay felülírja az onclick, külön kezeljük
    if (state.replayMode) return;
    await startRecordingPlayback();
  });

  // hamburger toggle (menu)
  hamb.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.toggle('show');
    hamb.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    menu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  });

  // zárja a menüt, ha kívülre kattintanak; biztosítjuk, hogy a menü saját kattintásai ne bubble-oljanak
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => {
    if (menu.classList.contains('show')) {
      menu.classList.remove('show');
      hamb.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    }
  });

  // scene item click
  sceneItems.forEach(item => {
    item.addEventListener('click', () => handleSceneClick(item));
  });

  // progress / sync update - használjuk a baseVideo timeupdate-t (precíz)
  baseVideo.addEventListener('timeupdate', handleTimeUpdate);
  // safety fallback: ha a timeupdate nagyon ritkán jönne, frissítsünk periodikusan is
  setInterval(() => {
    const now = Date.now();
    if (now - state.lastProgressUpdate > PROGRESS_UPDATE_MS) {
      updateProgressBar();
      state.lastProgressUpdate = now;
    }
  }, PROGRESS_UPDATE_MS);

  // overlayVideo canplay & ended kezelése fent van a playOverlayScene-ben (oncanplay/onended beállítva)

  // copy gomb
  copyBtn.addEventListener('click', () => {
    copyToClipboard(generatedLink.value)
      .then(() => {
        copyBtn.textContent = 'Másolva!';
        setTimeout(() => copyBtn.textContent = 'Másol', 1700);
      })
      .catch(() => {
        copyBtn.textContent = 'Hiba';
        setTimeout(() => copyBtn.textContent = 'Másol', 1700);
      });
  });

  /* -------------------- URL-ből történet betöltése (replay) ------------------ */
  (function checkStoryParam() {
    const p = new URLSearchParams(location.search);
    const story = p.get('story');
    if (!story) return;
    const payload = decodePayload(story);
    if (!payload || !Array.isArray(payload.segments)) return;
    // Valid payload: beállítjuk a replay módot és előkészítjük a schedule-t
    scheduleReplay(payload.segments);
  })();

  /* -------------------- Biztonsági UI viselkedések ------------------ */
  // Ha a böngésző megakadályozta az autoplay-t (különösen iOS), a play gomb marad és a felhasználó egy kattintással elindítja a lejátszást
  // Ha a felhasználó megpróbál közvetlenül url-lel betölteni story-t, a play gomb is elérhető a replay indításához
})();