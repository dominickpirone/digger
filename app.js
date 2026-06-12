// Digger Web — browser-only crate-digging player.
// Your music NEVER leaves your computer: files are read straight from the
// folder you connect (File System Access API) and played locally.
(() => {
  const $ = (id) => document.getElementById(id);
  const gate = $("gate"), gateForm = $("gate-form");
  const connectEl = $("connect"), btnConnect = $("btn-connect"),
        btnConnectFb = $("btn-connect-fallback"), connectNote = $("connect-note");
  const appEl = $("app");
  const audio = $("audio"), rowsEl = $("rows"), searchEl = $("search");
  const countEl = $("count"), filteredEl = $("filtered"), scanEl = $("scan-status");
  const listEl = $("list"), lcdTrack = $("lcd-track"), lcdTime = $("lcd-time");
  const snapReadout = $("snap-readout"), seekEl = $("seek"), volEl = $("volume"), eqEl = $("eq");
  const btnPlay = $("btn-play"), btnPrev = $("btn-prev"), btnNext = $("btn-next");
  const btnShuffle = $("btn-shuffle"), btnRepeat = $("btn-repeat"), btnRefresh = $("btn-refresh");
  const btnSnap = $("btn-snap"), snapStartSel = $("snap-start"), snapLenSel = $("snap-len");
  const btnKeep = $("btn-keep"), activeCrateEl = $("active-crate");
  const btnFolder = $("btn-folder"), btnSkin = $("btn-skin");
  const cratesAside = document.querySelector(".crates"), crateListEl = $("crate-list");
  const cratesExport = $("crates-export"), newCrateInput = $("new-crate"), btnNewCrate = $("btn-new-crate");
  const btnCrates = $("btn-crates"), cratesClose = $("crates-close"), cratesBackdrop = $("crates-backdrop");
  const modal = $("modal"), modalBody = $("modal-body"), modalCancel = $("modal-cancel"), modalConfirm = $("modal-confirm");
  const toastHost = $("toast-host"), tipEl = $("tip");

  // Email gate → Google Form → Google Sheet (→ Kartra via Zapier later).
  // If null, signups are remembered locally and the gate still opens
  // (never block a DJ from music).
  const CAPTURE = window.DIGGER_CAPTURE || null;

  const LS = {
    gate: "dw.gate", skin: "dw.skin", snap: "dw.snap", snapStart: "dw.snapStart",
    snapLen: "dw.snapLen", vol: "dw.vol", shuffle: "dw.shuffle", repeat: "dw.repeat",
    crates: "dw.crates", activeCrate: "dw.activeCrate",
  };
  const get = (k, d) => { const v = localStorage.getItem(k); return v === null ? d : v; };
  const set = (k, v) => localStorage.setItem(k, v);

  const AUDIO_RE = /\.(mp3|m4a|wav|flac|aiff?|aac|ogg)$/i;
  const fsaSupported = "showDirectoryPicker" in window;

  let rootDir = null;            // FileSystemDirectoryHandle (FSA path)
  let canWrite = false;          // readwrite permission → DEL enabled
  let library = [], view = [], currentIdx = -1;
  let shuffle = get(LS.shuffle, "0") === "1";
  let repeat = get(LS.repeat, "0") === "1";
  let seeking = false, pendingDelete = null, scanning = false;
  let playHistory = [], histPos = -1;
  let currentUrl = null;
  let snapOn = get(LS.snap, "0") === "1";
  let snapStartOpt = get(LS.snapStart, "30");
  let snapLen = parseInt(get(LS.snapLen, "30"), 10) || 30;
  let snapWinStart = 0, snapWinEnd = Infinity, snapAdvancing = false, snapUserOverride = false;
  let crates = JSON.parse(get(LS.crates, "{}"));
  let activeCrate = get(LS.activeCrate, "Digger Finds");
  if (!crates[activeCrate]) crates[activeCrate] = crates[activeCrate] || [];
  const RENDER_CAP = 3000;
  const SKINS = ["modern", "classic", "gold"];
  let skin = get(LS.skin, "gold");

  const fmt = (s) => {
    if (s === null || s === undefined || !isFinite(s) || s <= 0) return "--:--";
    s = Math.floor(s);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const titleOf = (t) => t.title;
  const currentTrack = () => (currentIdx >= 0 && currentIdx < view.length ? view[currentIdx] : null);
  const currentRow = () => rowsEl.querySelector(`.row[data-idx="${currentIdx}"]`);
  const rowElForId = (id) => { const i = view.findIndex((t) => t.id === id); return i >= 0 ? rowsEl.querySelector(`.row[data-idx="${i}"]`) : null; };

  // ---------- tiny IndexedDB (persists the folder handle between visits) ----------
  const idb = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open("digger", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => { idb.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    set(k, v) { return new Promise((res, rej) => { const t = idb.db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
    get(k) { return new Promise((res, rej) => { const t = idb.db.transaction("kv", "readonly"); const q = t.objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  };

  // ---------- toasts + tooltips ----------
  function toast(msg, kind = "ok") {
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.textContent = msg;
    toastHost.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 2600);
  }
  let tipTimer = null;
  function showTip(target) {
    const text = target.getAttribute("data-tip");
    if (!text) return;
    tipEl.textContent = text;
    tipEl.classList.remove("hidden");
    const r = target.getBoundingClientRect();
    let left = Math.max(8, Math.min(r.left + r.width / 2 - tipEl.offsetWidth / 2, window.innerWidth - tipEl.offsetWidth - 8));
    let top = r.top - tipEl.offsetHeight - 8;
    if (top < 8) top = r.bottom + 8;
    tipEl.style.left = Math.round(left) + "px";
    tipEl.style.top = Math.round(top) + "px";
  }
  function hideTip() { clearTimeout(tipTimer); tipEl.classList.add("hidden"); }
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-tip]"); if (!t) return;
    clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(t), 280);
  });
  document.addEventListener("mouseout", (e) => {
    const t = e.target.closest("[data-tip]"); if (!t) return;
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    hideTip();
  });
  window.addEventListener("scroll", hideTip, true);
  document.addEventListener("click", hideTip, true);

  // ---------- skins ----------
  function applySkin(s) {
    skin = SKINS.includes(s) ? s : "gold";
    SKINS.forEach((k) => document.body.classList.remove("skin-" + k));
    document.body.classList.add("skin-" + skin);
    btnSkin.textContent = "SKIN: " + skin.toUpperCase();
    set(LS.skin, skin);
  }
  btnSkin.addEventListener("click", () => applySkin(SKINS[(SKINS.indexOf(skin) + 1) % SKINS.length]));

  // ---------- email gate ----------
  function openGate() { gate.classList.remove("hidden"); }
  function pastGate() { return !!get(LS.gate, ""); }
  gateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const lead = {
      first: $("gate-first").value.trim(),
      last: $("gate-last").value.trim(),
      email: $("gate-email").value.trim(),
      phone: $("gate-phone").value.trim(),   // optional
    };
    if (!lead.first || !lead.last || !lead.email) return;
    set(LS.gate, JSON.stringify({ ...lead, at: Date.now() }));
    if (CAPTURE && CAPTURE.action && CAPTURE.fields) {
      try {
        const body = new FormData();
        for (const [key, field] of Object.entries(CAPTURE.fields)) {
          if (lead[key]) body.append(field, lead[key]);
        }
        fetch(CAPTURE.action, { method: "POST", body, mode: "no-cors" });
      } catch (err) { /* never block entry on a network hiccup */ }
    }
    gate.classList.add("hidden");
    showConnectOrApp();
  });

  // ---------- connect a music folder ----------
  function relPathOf(parts) { return parts.join("/"); }

  async function scanDirectory(dirHandle) {
    scanning = true;
    scanEl.classList.remove("hidden");
    const found = [];
    let n = 0;
    async function walk(dir, parts) {
      for await (const [name, h] of dir.entries()) {
        if (name.startsWith(".") || name.startsWith("_")) continue;   // skips _Digger Trash, _Serato_, …
        if (h.kind === "directory") { await walk(h, parts.concat(name)); continue; }
        if (!AUDIO_RE.test(name)) continue;
        found.push({
          id: relPathOf(parts.concat(name)),
          title: name.replace(AUDIO_RE, ""),
          artist: parts.length ? parts[parts.length - 1] : "♪",
          rel: relPathOf(parts.concat(name)),
          name, parent: dir, handle: h, duration: 0,
        });
        if (++n % 500 === 0) {
          scanEl.textContent = `scanning… ${n.toLocaleString()}`;
          library = found.slice().sort((a, b) => a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1);
          applyFilter();
          await new Promise((r) => setTimeout(r));   // keep the UI breathing
        }
      }
    }
    try { await walk(dirHandle, []); }
    catch (e) { console.warn("scan error", e); toast("Some folders could not be read.", "warn"); }
    found.sort((a, b) => a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1);
    library = found;
    scanning = false;
    scanEl.classList.add("hidden");
    applyFilter();
    updateCounts();
    toast(`⛏ ${library.length.toLocaleString()} tracks ready to dig`);
  }

  async function connectFolder() {
    try {
      let dir;
      try { dir = await showDirectoryPicker({ id: "digger-music", mode: "readwrite" }); canWrite = true; }
      catch (err) {
        if (err && err.name === "AbortError") return;
        dir = await showDirectoryPicker({ id: "digger-music" }); canWrite = false;
      }
      rootDir = dir;
      await idb.set("dir", dir);
      enterApp();
      await scanDirectory(dir);
    } catch (e) {
      if (e && e.name !== "AbortError") toast("Could not open that folder: " + e.message, "err");
    }
  }

  // Safari/Firefox fallback: one-shot folder picker (no persistence, no trash)
  function connectFallback() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.webkitdirectory = true; inp.multiple = true;
    inp.addEventListener("change", () => {
      const files = [...inp.files].filter((f) => AUDIO_RE.test(f.name));
      library = files.map((f) => {
        const parts = (f.webkitRelativePath || f.name).split("/");
        return {
          id: f.webkitRelativePath || f.name,
          title: f.name.replace(AUDIO_RE, ""),
          artist: parts.length > 1 ? parts[parts.length - 2] : "♪",
          rel: f.webkitRelativePath || f.name,
          name: f.name, file: f, duration: 0,
        };
      }).sort((a, b) => a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1);
      canWrite = false;
      enterApp();
      applyFilter(); updateCounts();
      toast(`⛏ ${library.length.toLocaleString()} tracks ready (re-choose the folder next visit)`);
    });
    inp.click();
  }

  btnConnect.addEventListener("click", () => (fsaSupported ? connectFolder() : connectFallback()));
  btnConnectFb.addEventListener("click", connectFallback);
  btnFolder.addEventListener("click", () => { appEl.classList.add("hidden"); connectEl.classList.remove("hidden"); });
  btnRefresh.addEventListener("click", () => { if (rootDir) scanDirectory(rootDir); });

  function enterApp() {
    connectEl.classList.add("hidden");
    gate.classList.add("hidden");
    appEl.classList.remove("hidden");
  }
  async function showConnectOrApp() {
    connectEl.classList.remove("hidden");
    if (!fsaSupported) {
      btnConnect.textContent = "📂 Choose your music folder";
      connectNote.textContent = "Tip: Chrome, Edge, or Brave remember your folder between visits — this browser will ask each time.";
      return;
    }
    try {
      const saved = await idb.get("dir");
      if (saved) {
        btnConnect.textContent = `📂 Reconnect “${saved.name}”`;
        connectNote.textContent = "Your browser will ask permission once, then start scanning.";
        btnConnect.onclick = async () => {
          try {
            const perm = await saved.requestPermission({ mode: "readwrite" });
            canWrite = perm === "granted";
            if (perm === "denied") { connectFolder(); return; }
            rootDir = saved;
            enterApp();
            await scanDirectory(saved);
          } catch (e) { connectFolder(); }
        };
        btnConnectFb.classList.remove("hidden");
        btnConnectFb.textContent = "📂 Pick a different folder";
        btnConnectFb.onclick = connectFolder;
      }
    } catch (e) { /* fresh visit */ }
  }

  // ---------- library render ----------
  function updateCounts() { countEl.textContent = library.length.toLocaleString(); }
  function renderRows() {
    const prevTop = listEl.scrollTop;
    const frag = document.createDocumentFragment();
    const capped = view.length > RENDER_CAP;
    const n = capped ? RENDER_CAP : view.length;
    for (let i = 0; i < n; i++) {
      const t = view[i];
      const row = document.createElement("div");
      const inCrate = crates[activeCrate] && crates[activeCrate].includes(t.rel);
      row.className = "row" + (i === currentIdx ? " playing" : "") + (inCrate ? " is-kept" : "");
      row.dataset.idx = i; row.dataset.id = t.id;
      row.draggable = true;
      row.innerHTML = `<div class="c-idx">${String(i + 1).padStart(4, "0")}</div>` +
        `<div class="c-title"></div><div class="c-artist"></div>` +
        `<div class="c-dur">${fmt(t.duration)}</div>` +
        `<div class="c-act"><button class="keep-btn" data-act="keep" draggable="false" title="Add to crate (K)">♥</button>` +
        `<button data-act="del" draggable="false" title="Move to Digger Trash (D)">DEL</button></div>`;
      row.querySelector(".c-title").textContent = t.title;
      row.querySelector(".c-artist").textContent = t.artist;
      frag.appendChild(row);
    }
    if (capped) {
      const note = document.createElement("div");
      note.className = "row notice";
      note.textContent = `Showing the first ${RENDER_CAP.toLocaleString()} of ${view.length.toLocaleString()} — search to narrow it down`;
      frag.appendChild(note);
    }
    rowsEl.replaceChildren(frag);
    filteredEl.textContent = view.length.toLocaleString();
    listEl.scrollTop = prevTop;
  }
  function applyFilter() {
    const q = searchEl.value.trim().toLowerCase();
    view = !q ? library.slice() : library.filter((t) =>
      t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.rel.toLowerCase().includes(q));
    const cur = currentTrack();
    currentIdx = cur ? view.findIndex((t) => t.id === cur.id) : -1;
    renderRows();
  }
  searchEl.addEventListener("input", applyFilter);

  // ---------- playback ----------
  async function loadTrack(idx, autoplay = true) {
    if (idx < 0 || idx >= view.length) return;
    currentIdx = idx;
    const t = view[idx];
    snapAdvancing = false; snapWinStart = 0; snapWinEnd = Infinity; snapUserOverride = false;
    try {
      const file = t.file || await t.handle.getFile();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = URL.createObjectURL(file);
      audio.src = currentUrl;
    } catch (e) { toast("Could not read that file.", "err"); return; }
    lcdTrack.textContent = `${t.title} — ${t.artist}`;
    document.title = `${t.title} · Digger`;
    updateMediaSession(t);
    renderRows();
    const row = currentRow();
    if (row) row.scrollIntoView({ block: "nearest" });
    if (autoplay) audio.play().catch(() => {});
  }
  const play = () => { if (currentIdx < 0) { if (view.length) gotoIdx(0); return; } audio.play().catch(() => {}); };
  const toggle = () => (audio.paused ? play() : audio.pause());

  function pushHistory(id) {
    if (histPos < playHistory.length - 1) playHistory = playHistory.slice(0, histPos + 1);
    if (playHistory[histPos] !== id) { playHistory.push(id); histPos = playHistory.length - 1; }
    if (playHistory.length > 1000) { const d = playHistory.length - 1000; playHistory.splice(0, d); histPos -= d; }
  }
  function gotoIdx(idx) { if (idx < 0 || idx >= view.length) return; pushHistory(view[idx].id); loadTrack(idx, true); }
  function pickNextIdx() {
    if (shuffle) {
      if (view.length <= 1) return 0;
      let n = Math.floor(Math.random() * view.length);
      if (n === currentIdx) n = (n + 1) % view.length;
      return n;
    }
    let n = currentIdx + 1; if (n >= view.length) n = 0; return n;
  }
  function next() {
    if (!view.length) return;
    if (histPos >= 0 && histPos < playHistory.length - 1) {
      const idx = view.findIndex((t) => t.id === playHistory[histPos + 1]);
      if (idx >= 0) { histPos++; loadTrack(idx, true); return; }
      playHistory = playHistory.slice(0, histPos + 1);
    }
    const n = pickNextIdx();
    pushHistory(view[n].id);
    loadTrack(n, true);
  }
  function prev() {
    if (!view.length) return;
    for (let p = histPos - 1; p >= 0; p--) {
      const idx = view.findIndex((t) => t.id === playHistory[p]);
      if (idx >= 0) { histPos = p; loadTrack(idx, true); return; }
    }
    let p = currentIdx - 1; if (p < 0) p = view.length - 1;
    loadTrack(p, true);
  }
  function setShuffle(on) { shuffle = on; btnShuffle.classList.toggle("on", on); set(LS.shuffle, on ? "1" : "0"); }
  function setRepeat(on) { repeat = on; btnRepeat.classList.toggle("on", on); set(LS.repeat, on ? "1" : "0"); }

  // ---------- snapshot / audition ----------
  function snapStartSec(dur) {
    if (snapStartOpt === "meat") {
      if (!dur || !isFinite(dur)) return 20;
      return Math.min(Math.max(dur * 0.33, 20), Math.max(dur - snapLen - 1, 0));
    }
    let s = parseInt(snapStartOpt, 10) || 0;
    if (dur && isFinite(dur) && s > dur - 2) s = Math.max(0, Math.min(s, dur * 0.1));
    return s;
  }
  function computeWindow() {
    const s = snapStartSec(audio.duration || 0);
    snapWinStart = s; snapWinEnd = s + snapLen; snapAdvancing = false; snapUserOverride = false;
  }
  function seekToWindowStart() {
    computeWindow();
    if (snapWinStart > 0 && snapWinStart < (audio.duration || Infinity)) { try { audio.currentTime = snapWinStart; } catch (e) {} }
  }
  function setSnap(on) {
    snapOn = on;
    btnSnap.classList.toggle("on", on);
    document.querySelectorAll(".rack-group").forEach((g) => { if (g.contains(snapStartSel)) g.classList.toggle("snap-on", on); });
    set(LS.snap, on ? "1" : "0");
    if (on) { if (!shuffle) setShuffle(true); if (audio.duration) seekToWindowStart(); }
    else { snapWinStart = 0; snapWinEnd = Infinity; snapReadout.textContent = ""; }
  }
  btnSnap.addEventListener("click", () => setSnap(!snapOn));
  snapStartSel.addEventListener("change", () => { snapStartOpt = snapStartSel.value; set(LS.snapStart, snapStartOpt); if (snapOn && audio.duration) seekToWindowStart(); });
  snapLenSel.addEventListener("change", () => { snapLen = parseInt(snapLenSel.value, 10) || 30; set(LS.snapLen, String(snapLen)); if (snapOn && audio.duration) seekToWindowStart(); });

  // ---------- media session (hardware media keys + lock screen) ----------
  function setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers = {
      play: () => play(), pause: () => audio.pause(),
      previoustrack: () => prev(), nexttrack: () => next(),
      seekbackward: (d) => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); if (snapOn) snapUserOverride = true; },
      seekforward: (d) => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); if (snapOn) snapUserOverride = true; },
    };
    for (const [a, f] of Object.entries(handlers)) { try { ms.setActionHandler(a, f); } catch (e) {} }
  }
  function updateMediaSession(t) {
    if (!("mediaSession" in navigator) || typeof window.MediaMetadata !== "function") return;
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: "Digger" }); } catch (e) {}
  }

  // ---------- audio events ----------
  audio.addEventListener("timeupdate", () => {
    const c = audio.currentTime || 0, d = audio.duration || 0;
    if (!seeking) {
      lcdTime.textContent = `${fmt(c)} / ${fmt(d)}`;
      seekEl.value = d > 0 ? Math.round((c / d) * 1000) : 0;
    }
    if (snapOn) {
      if (snapUserOverride) snapReadout.textContent = "◆ SNAP · manual";
      else {
        snapReadout.textContent = `◆ SNAP ${fmt(Math.max(0, c - snapWinStart))} / ${fmt(snapLen)}`;
        if (!snapAdvancing && d > 0 && c >= snapWinEnd) { snapAdvancing = true; next(); }
      }
    }
  });
  audio.addEventListener("loadedmetadata", () => {
    lcdTime.textContent = `${fmt(0)} / ${fmt(audio.duration || 0)}`;
    const t = currentTrack();
    if (t && audio.duration) t.duration = audio.duration;
    if (snapOn) seekToWindowStart();
  });
  audio.addEventListener("play", () => { btnPlay.textContent = "⏸"; eqEl.classList.add("live"); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; });
  audio.addEventListener("pause", () => { btnPlay.textContent = "▶"; eqEl.classList.remove("live"); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; });
  audio.addEventListener("ended", () => {
    if (snapOn) { next(); return; }
    if (repeat) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    next();
  });
  audio.addEventListener("error", () => { if (audio.src) setTimeout(next, 500); });

  btnPlay.addEventListener("click", toggle);
  btnPrev.addEventListener("click", prev);
  btnNext.addEventListener("click", next);
  btnShuffle.addEventListener("click", () => setShuffle(!shuffle));
  btnRepeat.addEventListener("click", () => setRepeat(!repeat));
  seekEl.addEventListener("input", () => { seeking = true; });
  seekEl.addEventListener("change", () => {
    if (audio.duration) audio.currentTime = (seekEl.value / 1000) * audio.duration;
    seeking = false;
    if (snapOn) snapUserOverride = true;
  });
  volEl.addEventListener("input", () => { audio.volume = Number(volEl.value) / 100; set(LS.vol, volEl.value); });

  // ---------- crates (saved in your browser, exportable to VirtualDJ) ----------
  function saveCrates() { set(LS.crates, JSON.stringify(crates)); }
  function renderCrates() {
    const frag = document.createDocumentFragment();
    Object.keys(crates).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1).forEach((name) => {
      const el = document.createElement("div");
      el.className = "crate-item" + (name === activeCrate ? " active" : "");
      el.dataset.name = name;
      el.innerHTML = `<span class="cname"></span><span class="ccount">${crates[name].length}</span>`;
      el.querySelector(".cname").textContent = name;
      frag.appendChild(el);
    });
    crateListEl.replaceChildren(frag);
  }
  function setActiveCrate(name) {
    activeCrate = name;
    if (!crates[name]) crates[name] = [];
    set(LS.activeCrate, name);
    activeCrateEl.textContent = name;
    renderCrates();
  }
  function keepTrack(t, rowEl) {
    if (!t) return;
    if (!crates[activeCrate]) crates[activeCrate] = [];
    if (crates[activeCrate].includes(t.rel)) { toast(`Already in ${activeCrate}`, "warn"); return; }
    crates[activeCrate].push(t.rel);
    saveCrates(); renderCrates();
    if (rowEl) { rowEl.classList.add("kept", "is-kept"); setTimeout(() => rowEl.classList.remove("kept"), 700); }
    btnKeep.classList.add("flash"); setTimeout(() => btnKeep.classList.remove("flash"), 450);
    toast(`♥ Added to ${activeCrate}`);
  }
  function exportCrate() {
    const items = crates[activeCrate] || [];
    if (!items.length) { toast("This crate is empty — heart some songs first.", "warn"); return; }
    const m3u = "#EXTM3U\n# Digger crate — save this file INSIDE your music folder, then open it in VirtualDJ\n" + items.join("\n") + "\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([m3u], { type: "audio/x-mpegurl" }));
    a.download = activeCrate + ".m3u";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`⤓ ${activeCrate}.m3u downloaded — move it into your music folder, then open in VirtualDJ`);
  }
  cratesExport.addEventListener("click", exportCrate);
  btnKeep.addEventListener("click", () => keepTrack(currentTrack(), currentRow()));
  crateListEl.addEventListener("click", (ev) => {
    const item = ev.target.closest(".crate-item"); if (!item) return;
    setActiveCrate(item.dataset.name);
    if (mobileMq.matches) setCratesDrawer(false);
  });
  function createCrate() {
    const name = newCrateInput.value.trim(); if (!name) return;
    if (!crates[name]) crates[name] = [];
    setActiveCrate(name);
    saveCrates();
    newCrateInput.value = "";
  }
  btnNewCrate.addEventListener("click", createCrate);
  newCrateInput.addEventListener("keydown", (e) => { if (e.key === "Enter") createCrate(); });

  // drag rows onto crates
  rowsEl.addEventListener("dragstart", (ev) => {
    const row = ev.target.closest(".row"); if (!row || !row.dataset.id) return;
    ev.dataTransfer.setData("text/plain", row.dataset.id);
    ev.dataTransfer.effectAllowed = "copy";
    row.classList.add("dragging");
    cratesAside.classList.add("drag-active");
  });
  rowsEl.addEventListener("dragend", (ev) => {
    const row = ev.target.closest(".row"); if (row) row.classList.remove("dragging");
    cratesAside.classList.remove("drag-active");
    crateListEl.querySelectorAll(".drop-hover").forEach((el) => el.classList.remove("drop-hover"));
  });
  crateListEl.addEventListener("dragover", (ev) => {
    const item = ev.target.closest(".crate-item"); if (!item) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = "copy";
    item.classList.add("drop-hover");
  });
  crateListEl.addEventListener("dragleave", (ev) => {
    const item = ev.target.closest(".crate-item");
    if (item && !item.contains(ev.relatedTarget)) item.classList.remove("drop-hover");
  });
  crateListEl.addEventListener("drop", (ev) => {
    const item = ev.target.closest(".crate-item"); if (!item) return;
    ev.preventDefault();
    item.classList.remove("drop-hover");
    const id = ev.dataTransfer.getData("text/plain");
    const t = library.find((x) => x.id === id);
    const prevActive = activeCrate;
    activeCrate = item.dataset.name;
    keepTrack(t, rowElForId(id));
    activeCrate = prevActive;
    renderCrates();
  });

  // ---------- mobile crates drawer ----------
  const mobileMq = window.matchMedia("(max-width: 700px), (orientation: portrait) and (max-width: 920px)");
  function setCratesDrawer(open) {
    cratesAside.classList.toggle("open", open);
    cratesBackdrop.classList.toggle("hidden", !open);
  }
  btnCrates.addEventListener("click", () => setCratesDrawer(!cratesAside.classList.contains("open")));
  cratesClose.addEventListener("click", () => setCratesDrawer(false));
  cratesBackdrop.addEventListener("click", () => setCratesDrawer(false));
  mobileMq.addEventListener("change", (e) => { if (!e.matches) setCratesDrawer(false); });

  // ---------- DEL → "_Digger Trash" folder (reversible, never permanent) ----------
  function askDelete(idx) {
    const t = view[idx]; if (!t) return;
    if (!canWrite || !rootDir) { toast("Trash needs Chrome/Edge with folder write access.", "warn"); return; }
    pendingDelete = t;
    modalBody.innerHTML = `Move <b class="dt"></b> into the <b>_Digger Trash</b> folder inside your music folder? You can always drag it back out.`;
    modalBody.querySelector(".dt").textContent = t.title;
    modal.classList.remove("hidden");
  }
  modalCancel.addEventListener("click", () => { modal.classList.add("hidden"); pendingDelete = null; });
  modalConfirm.addEventListener("click", async () => {
    const t = pendingDelete; if (!t) return;
    modalConfirm.disabled = true;
    try {
      const trash = await rootDir.getDirectoryHandle("_Digger Trash", { create: true });
      if (t.handle.move) {
        await t.handle.move(trash);
      } else {
        const file = await t.handle.getFile();
        const dest = await trash.getFileHandle(t.name, { create: true });
        const w = await dest.createWritable();
        await w.write(file); await w.close();
        await t.parent.removeEntry(t.name);
      }
      library = library.filter((x) => x.id !== t.id);
      const wasPlaying = currentTrack() && currentTrack().id === t.id;
      applyFilter(); updateCounts();
      if (wasPlaying) { audio.pause(); next(); }
      toast(`🗑 Moved “${t.title}” to _Digger Trash`);
    } catch (e) { toast("Could not move it: " + e.message, "err"); }
    finally { modalConfirm.disabled = false; modal.classList.add("hidden"); pendingDelete = null; }
  });

  // ---------- row actions ----------
  rowsEl.addEventListener("click", (ev) => {
    const keepBtn = ev.target.closest("button[data-act=keep]");
    const delBtn = ev.target.closest("button[data-act=del]");
    const row = ev.target.closest(".row");
    if (!row || row.classList.contains("notice") || !row.dataset.id) return;
    const idx = Number(row.dataset.idx);
    if (keepBtn) { ev.stopPropagation(); keepTrack(view[idx], row); return; }
    if (delBtn) { ev.stopPropagation(); askDelete(idx); return; }
    gotoIdx(idx);
  });

  // ---------- keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    switch (e.key) {
      case " ": e.preventDefault(); toggle(); break;
      case "ArrowRight": e.preventDefault(); next(); break;
      case "ArrowLeft": e.preventDefault(); prev(); break;
      case "k": case "K": keepTrack(currentTrack(), currentRow()); break;
      case "d": case "D": if (currentIdx >= 0) askDelete(currentIdx); break;
      case "s": case "S": setSnap(!snapOn); break;
      case "/": e.preventDefault(); searchEl.focus(); break;
      case "Escape": setCratesDrawer(false); break;
    }
  });

  // ---------- init ----------
  applySkin(skin);
  volEl.value = get(LS.vol, "80");
  audio.volume = Number(volEl.value) / 100;
  btnShuffle.classList.toggle("on", shuffle);
  btnRepeat.classList.toggle("on", repeat);
  snapStartSel.value = snapStartOpt;
  snapLenSel.value = String(snapLen);
  btnSnap.classList.toggle("on", snapOn);
  document.querySelectorAll(".rack-group").forEach((g) => { if (g.contains(snapStartSel)) g.classList.toggle("snap-on", snapOn); });
  activeCrateEl.textContent = activeCrate;
  renderCrates();
  setupMediaSession();
  idb.open().then(() => {
    if (!pastGate()) openGate();
    else showConnectOrApp();
  }).catch(() => { if (!pastGate()) openGate(); else showConnectOrApp(); });
})();
