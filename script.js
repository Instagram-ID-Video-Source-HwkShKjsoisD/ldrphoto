(() => {
  "use strict";

  // ====== Konstanta ======
  const SHOTS = 4;
  const HALF = 480;                    // tiap orang = kotak 480x480
  const CELL_W = HALF * 2, CELL_H = HALF;
  const PAD = 60, GAP = 30, FOOTER = 140;
  const ID_PREFIX = "ldrbooth-";
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const CODE_LEN = 5;

  // ====== Elemen ======
  const $ = (id) => document.getElementById(id);
  const localVideo = $("localVideo"), remoteVideo = $("remoteVideo");
  const stage = $("stage"), localWait = $("localWait"), remoteWait = $("remoteWait");
  const countdownEl = $("countdown"), shotInfo = $("shotInfo"), flash = $("flash");
  const btnHost = $("btnHost"), btnJoin = $("btnJoin"), roomInput = $("roomInput");
  const shareBox = $("shareBox"), roomCodeEl = $("roomCode"), btnCopy = $("btnCopy");
  const statusEl = $("status");
  const btnMic = $("btnMic"), btnStart = $("btnStart");
  const btnDownload = $("btnDownload"), btnRetake = $("btnRetake");
  const thumbs = $("thumbs"), result = $("result"), resultHint = $("resultHint");
  const timerSec = $("timerSec"), gapSec = $("gapSec"), layoutSel = $("layout");
  const caption = $("caption"), mirrorChk = $("mirror"), showDate = $("showDate");
  const solidColor = $("solidColor"), customFile = $("customFile");

  // ====== State ======
  let peer = null, conn = null, call = null;
  let localStream = null;
  let role = null;                 // "host" (kiri) | "guest" (kanan)
  let remoteHasStream = false;
  let photos = [];
  let busy = false;
  let customImg = null;
  let shotDate = new Date();
  let roomCode = "";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const currentFrame = () => document.querySelector('input[name="frame"]:checked').value;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function isConnected() {
    return !!(conn && conn.open && remoteHasStream);
  }

  function updateReady() {
    btnStart.disabled = !(isConnected() && !busy);
    if (isConnected() && !busy) setStatus("Terhubung! Siap foto berdua 🎉", "ok");
  }

  // ====== Kamera lokal ======
  async function getLocalStream() {
    if (localStream) return localStream;
    const videoOpts = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" };
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: videoOpts,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      // coba tanpa mikrofon
      localStream = await navigator.mediaDevices.getUserMedia({ video: videoOpts, audio: false });
    }
    localVideo.srcObject = localStream;
    try { await localVideo.play(); } catch (_) {}
    localWait.classList.add("hidden");
    applyMirror();
    const hasAudio = localStream.getAudioTracks().length > 0;
    btnMic.disabled = !hasAudio;
    btnMic.textContent = hasAudio ? "🎤 Mic Aktif" : "🎤 Tanpa mic";
    return localStream;
  }

  function applyMirror() {
    localVideo.classList.toggle("mirror", mirrorChk.checked);
  }

  function setRole(r) {
    role = r;
    stage.classList.toggle("is-guest", r === "guest");
  }

  function lockLobby() {
    btnHost.disabled = true; btnJoin.disabled = true; roomInput.disabled = true;
  }
  function unlockLobby() {
    btnHost.disabled = false; btnJoin.disabled = false; roomInput.disabled = false;
  }

  function cameraError(e) {
    unlockLobby();
    const name = (e && e.name) || "Error";
    setStatus(
      "Kamera tidak bisa diakses (" + name + "). Izinkan akses kamera di browser dan pastikan situs dibuka lewat HTTPS.",
      "err"
    );
  }

  // ====== Koneksi peer ======
  function randomCode() {
    let s = "";
    for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  async function hostRoom() {
    lockLobby();
    setStatus("Meminta akses kamera…");
    try { await getLocalStream(); } catch (e) { return cameraError(e); }
    setRole("host");
    createHostPeer(0);
  }

  function createHostPeer(attempt) {
    roomCode = randomCode();
    peer = new Peer(ID_PREFIX + roomCode);

    peer.on("open", () => {
      roomCodeEl.textContent = roomCode;
      shareBox.classList.remove("hidden");
      setStatus("Ruang dibuat. Kirim kode/link ke pasanganmu, lalu tunggu dia bergabung…");
    });
    peer.on("call", (c) => {
      c.answer(localStream);
      handleCall(c);
    });
    peer.on("connection", (c) => {
      if (conn && conn.open) { c.close(); return; }
      setupConn(c);
    });
    peer.on("disconnected", () => {
      if (peer && !peer.destroyed) peer.reconnect();
    });
    peer.on("error", (err) => {
      if (err.type === "unavailable-id" && attempt < 5) {
        peer.destroy();
        createHostPeer(attempt + 1);
      } else {
        showPeerError(err);
      }
    });
  }

  async function joinRoom() {
    const code = roomInput.value.trim().toUpperCase();
    if (code.length !== CODE_LEN) {
      setStatus("Kode ruang harus " + CODE_LEN + " karakter.", "err");
      return;
    }
    lockLobby();
    setStatus("Meminta akses kamera…");
    try { await getLocalStream(); } catch (e) { return cameraError(e); }
    setRole("guest");
    roomCode = code;
    setStatus("Menghubungkan ke ruang " + code + "…");

    peer = new Peer();
    peer.on("open", () => {
      const target = ID_PREFIX + code;
      setupConn(peer.connect(target, { reliable: true }));
      handleCall(peer.call(target, localStream));
    });
    peer.on("disconnected", () => {
      if (peer && !peer.destroyed) peer.reconnect();
    });
    peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        setStatus("Ruang " + code + " tidak ditemukan. Cek kodenya atau pastikan pasanganmu sudah membuat ruang.", "err");
        unlockLobby();
        if (peer) peer.destroy();
      } else {
        showPeerError(err);
      }
    });
  }

  function showPeerError(err) {
    setStatus("Masalah koneksi (" + err.type + "). Muat ulang halaman lalu coba lagi.", "err");
  }

  function setupConn(c) {
    conn = c;
    c.on("open", updateReady);
    c.on("data", onData);
    c.on("close", onPeerLeft);
    c.on("error", onPeerLeft);
  }

  function handleCall(c) {
    call = c;
    c.on("stream", (rs) => {
      remoteVideo.srcObject = rs;
      remoteVideo.play().catch(() => {});
      remoteHasStream = true;
      remoteWait.classList.add("hidden");
      updateReady();
    });
    c.on("close", onPeerLeft);
    c.on("error", onPeerLeft);
  }

  function onPeerLeft() {
    if (!conn && !call && !remoteHasStream) return;
    conn = null; call = null; remoteHasStream = false;
    remoteVideo.srcObject = null;
    remoteWait.classList.remove("hidden");
    remoteWait.textContent = "Pasangan terputus";
    btnStart.disabled = true;
    if (role === "host") {
      setStatus("Pasangan terputus. Ruang masih terbuka, kode " + roomCode + " bisa dipakai lagi.", "err");
    } else {
      setStatus("Koneksi terputus. Muat ulang halaman lalu gabung lagi.", "err");
    }
  }

  function onData(msg) {
    if (msg && msg.type === "start") {
      runSession(clamp(+msg.timer || 3, 1, 10), clamp(+msg.gap || 3, 1, 10));
    }
  }

  // ====== Ambil foto ======
  function drawSquare(ctx, v, dx, size, flip) {
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) { ctx.fillStyle = "#444"; ctx.fillRect(dx, 0, size, size); return; }
    const s = Math.min(vw, vh);
    const sx = (vw - s) / 2, sy = (vh - s) / 2;
    ctx.save();
    if (flip) { ctx.translate(dx + size, 0); ctx.scale(-1, 1); ctx.drawImage(v, sx, sy, s, s, 0, 0, size, size); }
    else ctx.drawImage(v, sx, sy, s, s, dx, 0, size, size);
    ctx.restore();
  }

  // host selalu di kiri, tamu di kanan, di kedua perangkat
  function composeShot() {
    const c = document.createElement("canvas");
    c.width = CELL_W; c.height = CELL_H;
    const ctx = c.getContext("2d");
    const localX = role === "host" ? 0 : HALF;
    const remoteX = role === "host" ? HALF : 0;
    drawSquare(ctx, localVideo, localX, HALF, mirrorChk.checked);
    drawSquare(ctx, remoteVideo, remoteX, HALF, false);
    ctx.fillStyle = "#fff";
    ctx.fillRect(HALF - 3, 0, 6, CELL_H);
    return c;
  }

  function startSession() {
    if (!isConnected() || busy) return;
    const t = clamp(parseInt(timerSec.value, 10) || 3, 1, 10);
    const g = clamp(parseInt(gapSec.value, 10) || 3, 1, 10);
    conn.send({ type: "start", timer: t, gap: g });
    runSession(t, g);
  }

  async function runSession(first, between) {
    if (busy) return;
    busy = true;
    updateReady();
    photos = [];
    thumbs.innerHTML = "";
    btnDownload.disabled = true; btnRetake.disabled = true;
    result.classList.add("hidden");
    resultHint.classList.remove("hidden");
    resultHint.textContent = "Sedang mengambil foto...";
    setStatus("Bersiap… lihat kamera!");

    let aborted = false;
    for (let i = 0; i < SHOTS; i++) {
      shotInfo.textContent = `Foto ${i + 1} / ${SHOTS}`;
      const secs = i === 0 ? first : between;
      for (let s = secs; s >= 1; s--) {
        countdownEl.textContent = s;
        await sleep(1000);
      }
      countdownEl.textContent = "";
      if (!isConnected()) { aborted = true; break; }
      flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go");
      const shot = composeShot();
      photos.push(shot);
      const img = document.createElement("img");
      img.src = shot.toDataURL("image/jpeg", 0.6);
      thumbs.appendChild(img);
      await sleep(400);
    }

    shotInfo.textContent = "";
    shotDate = new Date();
    busy = false;
    if (aborted) {
      resultHint.textContent = "Sesi dihentikan karena koneksi terputus.";
      return;
    }
    btnRetake.disabled = false;
    updateReady();
    render();
  }

  // ====== Render hasil ke canvas ======
  function render() {
    if (photos.length < SHOTS) return;
    const isGrid = layoutSel.value === "grid";

    const W = isGrid ? CELL_W * 2 + GAP + PAD * 2 : CELL_W + PAD * 2;
    const H = isGrid
      ? PAD + CELL_H * 2 + GAP + FOOTER
      : PAD + CELL_H * SHOTS + GAP * (SHOTS - 1) + FOOTER;

    result.width = W; result.height = H;
    const ctx = result.getContext("2d");

    const frame = currentFrame();
    const textColor = drawBackground(ctx, W, H, frame);

    const pos = [];
    for (let i = 0; i < SHOTS; i++) {
      if (isGrid) pos.push({ x: PAD + (i % 2) * (CELL_W + GAP), y: PAD + Math.floor(i / 2) * (CELL_H + GAP) });
      else pos.push({ x: PAD, y: PAD + i * (CELL_H + GAP) });
    }

    pos.forEach((p, i) => {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
      ctx.fillStyle = "#fff";
      ctx.fillRect(p.x - 8, p.y - 8, CELL_W + 16, CELL_H + 16);
      ctx.restore();
      ctx.drawImage(photos[i], p.x, p.y, CELL_W, CELL_H);
    });

    const textY = H - FOOTER / 2 - 10;
    ctx.fillStyle = textColor;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const cap = caption.value.trim();
    if (cap) {
      ctx.font = "700 54px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(cap, W / 2, textY - (showDate.checked ? 22 : 0));
    }
    if (showDate.checked) {
      ctx.font = "400 32px 'Segoe UI', Arial, sans-serif";
      const d = shotDate.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
      ctx.fillText(d, W / 2, textY + (cap ? 32 : 0));
    }

    if (frame === "custom" && customImg) ctx.drawImage(customImg, 0, 0, W, H);

    result.classList.remove("hidden");
    resultHint.classList.add("hidden");
    btnDownload.disabled = false;
  }

  function drawBackground(ctx, W, H, frame) {
    if (frame === "solid") {
      const c = solidColor.value;
      ctx.fillStyle = c; ctx.fillRect(0, 0, W, H);
      return luminance(c) > 0.55 ? "#2b2233" : "#ffffff";
    }

    if (frame === "retro") {
      ctx.fillStyle = "#f2dfb8"; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      const colors = ["#d9822b", "#c0392b", "#2a7f8f", "#f2dfb8"];
      const stripe = 36;
      let k = 0;
      for (let d = -H; d < W + H; d += stripe) {
        ctx.fillStyle = colors[k++ % colors.length];
        ctx.beginPath();
        ctx.moveTo(d, 0); ctx.lineTo(d + stripe, 0);
        ctx.lineTo(d + stripe + H, H); ctx.lineTo(d + H, H);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = "#f2dfb8";
      roundRect(ctx, PAD - 10, H - FOOTER - 6, W - (PAD - 10) * 2, FOOTER - 30, 24);
      ctx.fill();
      return "#5a3a1a";
    }

    if (frame === "colorful") {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#ff6ec4"); g.addColorStop(0.35, "#ffd86e");
      g.addColorStop(0.65, "#5de0e6"); g.addColorStop(1, "#9b6bff");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const rnd = mulberry32(42);
      const palette = ["#ffffff", "#ff3d81", "#ffe14d", "#3dd6d0", "#7c5cff"];
      const n = Math.round((W * H) / 9000);
      for (let i = 0; i < n; i++) {
        const x = rnd() * W, y = rnd() * H, s = 8 + rnd() * 18;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(rnd() * Math.PI * 2);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = palette[Math.floor(rnd() * palette.length)];
        if (rnd() < 0.5) ctx.fillRect(-s / 2, -s / 4, s, s / 2);
        else { ctx.beginPath(); ctx.arc(0, 0, s / 2.5, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      ctx.fillStyle = "rgba(255,255,255,.75)";
      roundRect(ctx, PAD - 10, H - FOOTER - 6, W - (PAD - 10) * 2, FOOTER - 30, 24);
      ctx.fill();
      return "#3b2a5a";
    }

    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
    return "#2b2233";
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ====== Download / ulang ======
  function download() {
    result.toBlob((blob) => {
      const a = document.createElement("a");
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      a.download = `photobooth-ldr-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  }

  function retake() {
    photos = [];
    thumbs.innerHTML = "";
    result.classList.add("hidden");
    resultHint.classList.remove("hidden");
    resultHint.textContent = "Belum ada foto. Ambil foto dulu ya!";
    btnDownload.disabled = true; btnRetake.disabled = true;
  }

  async function copyLink() {
    const url = location.origin + location.pathname + "?room=" + roomCode;
    try {
      await navigator.clipboard.writeText(url);
      btnCopy.textContent = "✅ Link tersalin";
    } catch (_) {
      window.prompt("Salin link ini dan kirim ke pasanganmu:", url);
    }
    setTimeout(() => (btnCopy.textContent = "🔗 Salin Link Undangan"), 2500);
  }

  // ====== Event ======
  btnHost.addEventListener("click", hostRoom);
  btnJoin.addEventListener("click", joinRoom);
  roomInput.addEventListener("input", () => { roomInput.value = roomInput.value.toUpperCase(); });
  roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
  btnCopy.addEventListener("click", copyLink);
  btnStart.addEventListener("click", startSession);
  btnDownload.addEventListener("click", download);
  btnRetake.addEventListener("click", retake);
  mirrorChk.addEventListener("change", applyMirror);

  btnMic.addEventListener("click", () => {
    const t = localStream && localStream.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    btnMic.textContent = t.enabled ? "🎤 Mic Aktif" : "🔇 Mic Mati";
  });

  [layoutSel, caption, showDate, solidColor].forEach((el) => el.addEventListener("input", render));

  document.querySelectorAll('input[name="frame"]').forEach((r) =>
    r.addEventListener("change", () => {
      const f = currentFrame();
      $("opt-solid").classList.toggle("hidden", f !== "solid");
      $("opt-custom").classList.toggle("hidden", f !== "custom");
      render();
    })
  );

  customFile.addEventListener("change", () => {
    const file = customFile.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => { customImg = img; render(); };
    img.src = URL.createObjectURL(file);
  });

  window.addEventListener("beforeunload", () => {
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (peer) peer.destroy();
  });

  // Link undangan: ?room=KODE
  const roomParam = new URLSearchParams(location.search).get("room");
  if (roomParam) {
    roomInput.value = roomParam.toUpperCase().slice(0, CODE_LEN);
    setStatus("Kamu diundang ke ruang " + roomInput.value + ". Klik “Gabung” untuk masuk.");
  }
})();
