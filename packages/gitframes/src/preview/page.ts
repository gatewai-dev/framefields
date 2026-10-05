/**
 * Single-file preview UI served by `startPreview`. No framework, no build step.
 * The page script avoids template literals so it can live inside this one.
 */
export const previewPage = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gitframes preview</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 512 512%22%3E%3Cg fill=%22none%22 stroke=%22%233B82F6%22 stroke-linecap=%22round%22%3E%3Cpath d=%22M184 56H86q-30 0-30 30v98M328 56h98q30 0 30 30v98M184 456H86q-30 0-30-30v-98M328 456h98q30 0 30-30v-98%22 stroke-width=%2234%22/%3E%3Cpath d=%22M176 182v148m0-148c0 74 60 74 100 74%22 stroke-width=%2228%22/%3E%3C/g%3E%3Cg fill=%22%233B82F6%22%3E%3Ccircle cx=%22176%22 cy=%22172%22 r=%2232%22/%3E%3Ccircle cx=%22176%22 cy=%22340%22 r=%2232%22/%3E%3Cpath d=%22M284 200l78 56-78 56z%22 stroke=%22%233B82F6%22 stroke-width=%2234%22 stroke-linejoin=%22round%22/%3E%3C/g%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0e0f11; --surface: #16171a; --surface-2: #1d1e22; --surface-3: #26282d;
    --line: #2a2c31; --line-2: #3a3c43;
    --ink: #ededf0; --ink-2: #a6a8b0; --ink-3: #74777f;
    --stage: #060607;
    --primary-bg: #ededf0; --primary-ink: #0e0f11;
    --brand: #3b82f6; --focus: #5eaefc; --ok: #4fbf7a; --bad: #f27d8d;
    --wave: #4b4e57;
    --radius: 10px;
    --font: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color-scheme: dark;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f5f5f6; --surface: #ffffff; --surface-2: #f0f0f2; --surface-3: #e6e6e9;
      --line: #e2e2e6; --line-2: #cfcfd5;
      --ink: #15161a; --ink-2: #53555d; --ink-3: #85878f;
      --stage: #0b0b0c;
      --primary-bg: #15161a; --primary-ink: #ffffff;
      --brand: #2563eb; --focus: #1c74cc; --ok: #23874a; --bad: #cf4057;
      --wave: #c2c3ca;
      color-scheme: light;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; overflow: hidden; background: var(--bg); color: var(--ink); }
  body {
    display: flex; flex-direction: column; height: 100dvh;
    font: 13.5px/1.45 var(--font); -webkit-font-smoothing: antialiased;
    font-feature-settings: "cv11", "ss03";
  }
  button, input { font: inherit; color: inherit; }
  button { cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .tnum { font-variant-numeric: tabular-nums; }
  .grow { flex: 1; }
  .spinner {
    width: 12px; height: 12px; border-radius: 50%; flex: none;
    border: 1.5px solid var(--line-2); border-top-color: var(--ink); animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }

  /* ── Top bar ── */
  .top { flex: none; display: flex; align-items: center; gap: 10px; padding: 0 20px; height: 50px; border-bottom: 1px solid var(--line); min-width: 0; }
  .logo { width: 22px; height: 22px; flex: none; color: var(--brand); }
  .sep { width: 1px; height: 18px; background: var(--line-2); flex: none; margin: 0 2px; }
  .top h1 { font-size: 14px; font-weight: 600; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .spec { color: var(--ink-3); font-size: 12px; white-space: nowrap; }
  @media (max-width: 640px) { .spec { display: none; } }
  .chip {
    display: inline-flex; align-items: center; gap: 8px; height: 26px; padding: 0 10px; white-space: nowrap;
    border: 1px solid var(--line); border-radius: 999px; color: var(--ink-2); font-size: 12px; background: var(--surface);
  }
  .chip[data-state="ready"] .dot { color: var(--ok); }
  .chip[data-state="none"] .dot, .chip[data-state="offline"] .dot { color: var(--ink-3); }
  .chip[data-state="error"] { color: var(--bad); }

  /* ── Player: one screen, no page scroll; the picture takes the space left ── */
  .player {
    flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px;
    width: 100%; max-width: 1600px; margin: 0 auto; padding: 16px 20px 20px;
  }
  @media (max-width: 640px) { .player { padding: 12px; } }
  .stage-wrap { flex: 1 1 0; min-height: 96px; container-type: size; display: grid; place-items: center; }
  .stage {
    position: relative; background: var(--stage); border-radius: var(--radius); overflow: hidden;
    box-shadow: 0 0 0 1px var(--line); user-select: none; -webkit-user-select: none;
    aspect-ratio: var(--ar, 16 / 9); width: min(100cqw, calc(100cqh * var(--ar-n, 1.7778)));
  }
  .stage canvas { display: block; width: 100%; height: 100%; }
  .stage-msg {
    position: absolute; inset: 0; display: none; place-items: center; padding: 24px; text-align: center;
    color: #fff; background: rgb(0 0 0 / .72); font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow: auto;
  }
  .stage-msg.on { display: grid; }
  /* Buffering: a centred spinning arc over the picture, like YouTube's. It
     fades in after a beat so brief waits don't flash it. */
  .buffering {
    position: absolute; left: 50%; top: 50%; width: clamp(36px, 9cqmin, 64px); aspect-ratio: 1;
    transform: translate(-50%, -50%); pointer-events: none; opacity: 0; visibility: hidden;
    transition: opacity .15s, visibility 0s .15s; filter: drop-shadow(0 0 3px rgb(0 0 0 / .45));
  }
  .buffering.on { opacity: 1; visibility: visible; transition: opacity .2s .25s, visibility 0s .25s; }
  .buffering svg { width: 100%; height: 100%; animation: yt-rotate 1.4s linear infinite; }
  .buffering circle {
    fill: none; stroke: #fff; stroke-width: 3.6; stroke-linecap: round;
    stroke-dasharray: 1 150; stroke-dashoffset: 0; animation: yt-dash 1.4s ease-in-out infinite;
  }
  @keyframes yt-rotate { to { transform: rotate(360deg); } }
  @keyframes yt-dash {
    0% { stroke-dasharray: 1 150; stroke-dashoffset: 0; }
    50% { stroke-dasharray: 90 150; stroke-dashoffset: -35; }
    100% { stroke-dasharray: 90 150; stroke-dashoffset: -124; }
  }
  @media (prefers-reduced-motion: reduce) { .buffering circle, .play-btn .spin circle { animation: none; stroke-dasharray: 70 150; } }

  /* ── Transport ── */
  .transport { flex: none; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; row-gap: 6px; }
  .icon-btn {
    width: 32px; height: 32px; display: inline-grid; place-items: center; border-radius: 8px;
    border: 0; background: transparent; color: var(--ink-2); flex: none;
  }
  .icon-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--ink); }
  .icon-btn:disabled { opacity: .35; cursor: default; }
  .icon-btn svg { width: 16px; height: 16px; }
  .play-btn {
    width: 36px; height: 36px; border-radius: 50%; border: 0; display: inline-grid; place-items: center; flex: none;
    background: var(--primary-bg); color: var(--primary-ink); margin: 0 2px;
  }
  .play-btn:hover:not(:disabled) { filter: brightness(.9); }
  .play-btn:disabled { opacity: .4; cursor: default; }
  .play-btn svg { width: 14px; height: 14px; }
  .play-btn .spin { display: none; width: 20px; height: 20px; animation: yt-rotate 1.4s linear infinite; }
  .play-btn .spin circle {
    fill: none; stroke: currentColor; stroke-width: 5; stroke-linecap: round;
    stroke-dasharray: 1 150; animation: yt-dash 1.4s ease-in-out infinite;
  }
  .play-btn.loading .spin { display: block; }
  .play-btn.loading svg:not(.spin) { display: none !important; }
  .timecode { display: flex; align-items: baseline; gap: 5px; margin-left: 8px; font-size: 13px; white-space: nowrap; }
  .timecode .dim { color: var(--ink-3); }
  .timecode .frame { color: var(--ink-3); font-size: 11.5px; margin-left: 6px; }
  input[type="range"].slider { -webkit-appearance: none; appearance: none; width: 72px; height: 4px; border-radius: 2px; background: var(--line-2); margin: 0 8px 0 0; }
  input[type="range"].slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--ink); border: 0; }
  input[type="range"].slider::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--ink); border: 0; }
  input[type="range"].slider:disabled { opacity: .35; }

  /* ── Timeline ── */
  .timeline {
    flex: none; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface);
    padding: 0 14px; user-select: none; -webkit-user-select: none; touch-action: none; cursor: pointer;
  }
  .tl-inner { position: relative; }
  .ruler { position: relative; height: 22px; border-bottom: 1px solid var(--line); }
  /* Rendered ahead of the playhead while playing, like a video's loaded range. */
  .buffered {
    position: absolute; top: 20px; height: 3px; border-radius: 2px; background: var(--ink-3);
    opacity: .55; pointer-events: none; z-index: 2; display: none;
  }
  .tick { position: absolute; bottom: 0; width: 1px; height: 4px; background: var(--line-2); }
  .tick.major { height: 8px; background: var(--ink-3); }
  .tick span { position: absolute; bottom: 9px; left: 4px; font-size: 10.5px; line-height: 1; color: var(--ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .wave-lane { position: relative; height: 48px; }
  @media (max-height: 600px) { .wave-lane { height: 30px; } }
  .wave-lane canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .wave-state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--ink-3); font-size: 12px; }
  .wave-state.shimmer {
    background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--ink) 6%, transparent) 50%, transparent 100%);
    background-size: 200% 100%; animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  .playhead { position: absolute; top: 0; bottom: 0; width: 0; pointer-events: none; z-index: 3; }
  .playhead::before { content: ""; position: absolute; top: 0; bottom: 0; left: -0.5px; width: 1px; background: var(--ink); }
  .playhead::after { content: ""; position: absolute; top: 0; left: -5px; width: 10px; height: 11px; background: var(--ink); clip-path: polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%); }
  .hover-line { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line-2); display: none; pointer-events: none; }
  .hover-time {
    position: absolute; top: -28px; transform: translateX(-50%); display: none; pointer-events: none;
    font-size: 11px; line-height: 1; background: var(--surface-3); color: var(--ink); padding: 5px 7px; border-radius: 5px;
    white-space: nowrap; z-index: 4; font-variant-numeric: tabular-nums;
  }
</style>
</head>
<body>
<header class="top">
  <svg class="logo" viewBox="0 0 512 512" aria-label="gitframes" role="img"><g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M184 56H86q-30 0-30 30v98M328 56h98q30 0 30 30v98M184 456H86q-30 0-30-30v-98M328 456h98q30 0 30-30v-98" stroke-width="34" stroke-linejoin="round"/><path d="M176 182v148m0-148c0 74 60 74 100 74" stroke-width="28"/></g><g fill="currentColor"><circle cx="176" cy="172" r="32"/><circle cx="176" cy="340" r="32"/><path d="M284 200l78 56-78 56z" stroke="currentColor" stroke-width="34" stroke-linejoin="round"/></g></svg>
  <span class="sep" aria-hidden="true"></span>
  <h1 id="title">gitframes preview</h1>
  <span class="grow"></span>
  <span class="spec tnum" id="spec"></span>
  <span class="chip" id="chip" data-state="mixing" role="status" aria-live="polite"><span class="spinner"></span><span>Mixing audio</span></span>
</header>

<main class="player" aria-label="Player">
  <div class="stage-wrap">
    <div class="stage" id="stage">
      <canvas id="canvas" aria-label="Rendered frame"></canvas>
      <div class="stage-msg" id="stageMsg" role="alert"></div>
      <div class="buffering" id="buffering" role="status" aria-label="Loading"><svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="20"/></svg></div>
    </div>
  </div>

  <div class="transport">
    <button class="icon-btn" id="prev" title="Previous frame" aria-label="Previous frame">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h1.6v10H3zM13 3.6v8.8a.6.6 0 0 1-.92.5L5.8 8.5a.6.6 0 0 1 0-1l6.28-4.4a.6.6 0 0 1 .92.5z"/></svg>
    </button>
    <button class="play-btn" id="play" title="Play" aria-label="Play" disabled>
      <svg id="playIcon" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.9v10.2a.7.7 0 0 0 1.06.6l8.1-5.1a.7.7 0 0 0 0-1.2l-8.1-5.1a.7.7 0 0 0-1.06.6z"/></svg>
      <svg class="spin" viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="18"/></svg>
      <svg id="pauseIcon" viewBox="0 0 16 16" fill="currentColor" style="display:none"><rect x="3.5" y="2.5" width="3.2" height="11" rx=".8"/><rect x="9.3" y="2.5" width="3.2" height="11" rx=".8"/></svg>
    </button>
    <button class="icon-btn" id="next" title="Next frame" aria-label="Next frame">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M11.4 3H13v10h-1.6zM3 3.6v8.8a.6.6 0 0 0 .92.5l6.28-4.4a.6.6 0 0 0 0-1L3.92 3.1A.6.6 0 0 0 3 3.6z"/></svg>
    </button>
    <div class="timecode tnum">
      <span id="tcNow">0:00.00</span><span class="dim">/</span><span class="dim" id="tcDur">0:00.00</span>
      <span class="frame" id="tcFrame">frame 0</span>
    </div>
    <span class="grow"></span>
    <button class="icon-btn" id="mute" title="Mute" aria-label="Mute" disabled>
      <svg id="volIcon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" stroke="none"/><path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.9a5.8 5.8 0 0 1 0 8.2"/></svg>
      <svg id="muteIcon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" style="display:none"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" stroke="none"/><path d="M10.5 6l3.5 4M14 6l-3.5 4"/></svg>
    </button>
    <input class="slider" type="range" id="volume" min="0" max="1" step="0.01" value="0.9" aria-label="Volume" disabled>
  </div>

  <div class="timeline" id="timeline" aria-label="Timeline">
    <div class="tl-inner" id="tlInner">
      <div class="ruler" id="ruler"></div>
      <div class="buffered" id="buffered"></div>
      <div class="wave-lane">
        <canvas id="wave"></canvas>
        <div class="wave-state shimmer" id="waveState"><span class="spinner"></span>Mixing audio</div>
      </div>
      <div class="hover-line" id="hoverLine"></div>
      <div class="hover-time" id="hoverTime"></div>
      <div class="playhead" id="playhead"></div>
    </div>
  </div>
</main>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var stage = $("stage"), timeline = $("timeline"), tlInner = $("tlInner");

  var meta = null, session = null, frame = 0, shown = -1, playing = false, playToken = 0;
  var player = null;

  // ── Helpers ──
  function fmt(f) {
    var s = f / meta.fps, m = Math.floor(s / 60);
    return m + ":" + (s - m * 60).toFixed(2).padStart(5, "0");
  }
  function last() { return meta.frameCount - 1; }
  function clampFrame(f) { return Math.max(0, Math.min(last(), Math.round(f))); }
  function pct(f) { return meta.frameCount > 1 ? (f / last()) * 100 : 0; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ── Frames: drawn in this tab by the composition's own code ──
  function setTime(f) {
    frame = f;
    $("tcNow").textContent = fmt(f);
    $("tcFrame").textContent = "frame " + f;
    $("playhead").style.left = pct(f) + "%";
  }
  function show(f) {
    setTime(f);
    if (!player) return Promise.resolve();
    $("buffering").classList.add("on");
    // Calls made while a frame draws collapse to the latest.
    return player.render(f).then(function (drawn) {
      shown = drawn;
      if (!stalled) $("buffering").classList.remove("on");
    });
  }
  function seek(f) {
    stop();
    var done = show(clampFrame(f));
    scheduleWarm();
    return done;
  }

  // ── Analysing ahead: while paused, frames after the playhead are drawn
  // off-screen so vision results are cached before they play ──
  var warmTimer = null, warmToken = 0, warmed = new Set();
  function scheduleWarm() {
    clearTimeout(warmTimer);
    warmToken++;
    if (!player || !player.hasVision || playing) return;
    warmTimer = setTimeout(warmAhead, 1000);
  }
  async function warmAhead() {
    var token = ++warmToken;
    var end = Math.min(last(), frame + Math.round(meta.fps * 20));
    for (var f = frame + 1; f <= end && token === warmToken && !playing; f++) {
      if (warmed.has(f)) continue;
      if (!(await player.warm(f))) { scheduleWarm(); return; }
      warmed.add(f);
      await sleep(0);
    }
  }
  function showError(err) {
    $("buffering").classList.remove("on");
    $("stageMsg").textContent = String((err && err.message) || err);
    $("stageMsg").classList.add("on");
  }

  // ── Audio ──
  var audio = { state: "mixing", error: "", buffer: null, peaks: null, ctx: null, gain: null, src: null, muted: false, volume: 0.9 };
  var AUDIO_LABEL = { mixing: "Mixing audio", loading: "Loading audio", ready: "Audio ready", none: "No audio", error: "Audio failed" };
  var offline = false;

  function renderChip() {
    var chip = $("chip"), state, label, busy;
    if (offline) { state = "offline"; label = "Preview stopped"; busy = false; }
    else { state = audio.state; label = AUDIO_LABEL[audio.state]; busy = state === "mixing" || state === "loading"; }
    chip.dataset.state = state;
    chip.title = offline ? "The preview command isn't running. This tab reconnects when it starts again." : audio.error || "";
    chip.replaceChildren(el("span", busy ? "spinner" : "dot"), el("span", null, label));
  }
  function setAudioStatus(state, error) {
    audio.state = state;
    audio.error = error || "";
    var busy = state === "mixing" || state === "loading", ws = $("waveState");
    ws.classList.toggle("shimmer", busy);
    ws.style.display = state === "ready" ? "none" : "flex";
    ws.replaceChildren();
    if (busy) ws.append(el("span", "spinner"));
    ws.append(document.createTextNode(state === "none" ? "No audio in this composition" : state === "error" ? "Audio could not be mixed" : AUDIO_LABEL[state]));
    var usable = state === "ready" && !!audio.buffer;
    $("mute").disabled = !usable;
    $("volume").disabled = !usable;
    renderChip();
    drawWave();
  }
  function loadAudio(status) {
    stopClock();
    audio.buffer = null;
    audio.peaks = null;
    if (!status || status.state !== "ready") { setAudioStatus(status ? status.state : "none", status && status.error); return; }
    audio.peaks = status.peaks;
    setAudioStatus("loading");
    if (!audio.ctx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audio.ctx = new Ctx();
      audio.gain = audio.ctx.createGain();
      audio.gain.connect(audio.ctx.destination);
      applyVolume();
    }
    fetch("/audio")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
      .then(function (data) { return audio.ctx.decodeAudioData(data); })
      .then(function (buf) { audio.buffer = buf; setAudioStatus("ready"); })
      .catch(function (err) { setAudioStatus("error", String((err && err.message) || err)); });
  }
  function applyVolume() {
    if (audio.gain) audio.gain.gain.value = audio.muted ? 0 : audio.volume;
    $("volIcon").style.display = audio.muted ? "none" : "";
    $("muteIcon").style.display = audio.muted ? "" : "none";
    $("mute").title = audio.muted ? "Unmute" : "Mute";
    $("mute").setAttribute("aria-label", audio.muted ? "Unmute" : "Mute");
  }
  // The clock for real-time playback: the soundtrack when there is one,
  // otherwise the wall clock. Audio as master keeps picture and sound in sync.
  function startClock(f0) {
    if (audio.buffer && audio.ctx) {
      audio.ctx.resume();
      var src = audio.ctx.createBufferSource();
      src.buffer = audio.buffer;
      src.connect(audio.gain);
      var startAt = audio.ctx.currentTime + 0.06, offset = f0 / meta.fps;
      if (offset < audio.buffer.duration) src.start(startAt, offset);
      audio.src = src;
      return function () { return Math.max(0, audio.ctx.currentTime - startAt); };
    }
    var t0 = performance.now();
    return function () { return (performance.now() - t0) / 1000; };
  }
  function stopClock() {
    if (!audio.src) return;
    try { audio.src.stop(); } catch (e) {}
    audio.src.disconnect();
    audio.src = null;
  }

  // ── Playback ──
  var stalled = false;
  // Waiting on frames mid-playback: the play button and the picture both spin.
  function setStalled(on) {
    stalled = on;
    $("play").classList.toggle("loading", on);
    $("buffering").classList.toggle("on", on);
  }
  function setPlayingUi(on) {
    $("playIcon").style.display = on ? "none" : "";
    $("pauseIcon").style.display = on ? "" : "none";
    $("play").title = on ? "Pause" : "Play";
    $("play").setAttribute("aria-label", on ? "Pause" : "Play");
  }
  function play() {
    if (playing || !player) return;
    playing = true;
    clearTimeout(warmTimer);
    warmToken++;
    var token = ++playToken;
    var alive = function () { return playing && token === playToken; };
    setPlayingUi(true);
    if (frame >= last()) frame = 0;
    playRealtime(alive).finally(function () { if (token === playToken && playing) pause(); });
  }
  function stop() {
    playing = false;
    stopClock();
    setStalled(false);
    setPlayingUi(false);
  }
  // Pausing settles on exactly the frame the timecode shows.
  function pause() { stop(); show(frame).then(scheduleWarm); }
  function togglePlay() { playing ? pause() : play(); }

  // Like a video player: frames are rendered ahead into a buffer, in order,
  // and every one is shown at the film's frame rate. Playback starts once
  // three seconds (or the rest of the film) are ready; when rendering falls
  // behind, the clock and the sound hold until the buffer is full again.
  var BUFFER_SEC = 3;
  async function playRealtime(alive) {
    player.buffer.start(frame);
    try {
      while (alive() && frame < last()) {
        if (!(await fillBuffer(alive))) return;
        if (!(await runClock(alive))) return;
      }
    } finally {
      player.buffer.stop();
      $("buffered").style.display = "none";
    }
  }
  function showBufferedRange() {
    var bar = $("buffered"), end = Math.max(frame, Math.min(last(), player.buffer.end - 1));
    bar.style.display = "block";
    bar.style.left = pct(frame) + "%";
    bar.style.width = Math.max(0, pct(end) - pct(frame)) + "%";
  }
  async function fillBuffer(alive) {
    var need = Math.max(1, Math.min(Math.round(meta.fps * BUFFER_SEC), last() - frame + 1, player.buffer.capacity - 2));
    if (player.buffer.ahead(frame) >= need) return true;
    setStalled(true);
    while (alive() && player.buffer.ahead(frame) < need) {
      showBufferedRange();
      await sleep(30);
    }
    if (!alive()) return false;
    setStalled(false);
    return true;
  }
  // Resolves true when the buffer ran dry, false at the end or when stopped.
  async function runClock(alive) {
    var f0 = frame, clock = startClock(f0), onScreen = -1;
    while (alive()) {
      var due = Math.min(last(), f0 + Math.floor(clock() * meta.fps));
      if (due !== onScreen) {
        if (!player.buffer.show(due)) {
          stopClock();
          setTime(onScreen >= 0 ? onScreen : f0);
          return true;
        }
        onScreen = shown = due;
      }
      setTime(due);
      showBufferedRange();
      if (due >= last()) return false;
      // A timer, not rAF: embedded or occluded views throttle rAF to ~1 Hz.
      await sleep(4);
    }
    return false;
  }

  // ── Timeline ──
  function frameAtX(clientX) {
    var r = tlInner.getBoundingClientRect();
    return clampFrame(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * last());
  }
  function renderRuler() {
    var ruler = $("ruler"), width = tlInner.clientWidth || 800, dur = last() / meta.fps;
    ruler.replaceChildren();
    if (dur <= 0) return;
    var steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    var major = steps.find(function (s) { return (s / dur) * width >= 80; }) || 1200, minor = major / 5;
    for (var i = 0; i * minor <= dur + 1e-6; i++) {
      var t = i * minor, isMajor = i % 5 === 0, x = (t / dur) * width;
      var tick = el("div", "tick" + (isMajor ? " major" : ""));
      tick.style.left = (t / dur) * 100 + "%";
      if (isMajor && x < width - 34) {
        var m = Math.floor(t / 60), s = Math.round((t - m * 60) * 10) / 10;
        tick.append(el("span", null, m + ":" + (s < 10 ? "0" : "") + s));
      }
      ruler.append(tick);
    }
  }
  function drawWave() {
    var canvas = $("wave"), dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var peaks = audio.peaks;
    if (!peaks || !peaks.length || !meta) return;
    var videoSec = Math.max(1e-6, last() / meta.fps);
    var audioSec = audio.buffer ? audio.buffer.duration : videoSec;
    var spanPx = Math.min(1, audioSec / videoSec) * w, mid = h / 2;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--wave").trim();
    for (var x = 0; x < spanPx; x += 3) {
      var v = Math.max(peaks[Math.floor((x / spanPx) * peaks.length)] || 0, 0.015);
      var bh = Math.max(1, Math.sqrt(v) * (h - 8));
      ctx.fillRect(x, mid - bh / 2, 2, bh);
    }
  }

  var dragging = false;
  timeline.addEventListener("pointerdown", function (e) {
    if (!meta || e.button !== 0) return;
    timeline.setPointerCapture(e.pointerId);
    dragging = true;
    seek(frameAtX(e.clientX));
  });
  timeline.addEventListener("pointermove", function (e) {
    if (!meta) return;
    var f = frameAtX(e.clientX), r = tlInner.getBoundingClientRect();
    var x = Math.min(r.width, Math.max(0, e.clientX - r.left));
    $("hoverLine").style.display = "block";
    $("hoverLine").style.left = x + "px";
    $("hoverTime").style.display = "block";
    $("hoverTime").style.left = x + "px";
    $("hoverTime").textContent = fmt(f);
    if (dragging && f !== frame) seek(f);
  });
  timeline.addEventListener("pointerleave", function () {
    $("hoverLine").style.display = "none";
    $("hoverTime").style.display = "none";
  });
  timeline.addEventListener("pointerup", function () { dragging = false; });
  timeline.addEventListener("pointercancel", function () { dragging = false; });

  // ── Wiring ──
  $("play").addEventListener("click", togglePlay);
  $("prev").addEventListener("click", function () { seek(frame - 1); });
  $("next").addEventListener("click", function () { seek(frame + 1); });
  $("mute").addEventListener("click", function () { audio.muted = !audio.muted; applyVolume(); });
  $("volume").addEventListener("input", function (e) { audio.volume = Number(e.target.value); audio.muted = audio.volume === 0; applyVolume(); });

  function applyMeta(m) {
    meta = m;
    document.title = m.title + " · preview";
    $("title").textContent = m.title;
    $("spec").textContent = m.width + "×" + m.height + " · " + m.fps + " fps · " + fmt(last());
    $("tcDur").textContent = fmt(last());
    stage.style.setProperty("--ar", m.width + " / " + m.height);
    stage.style.setProperty("--ar-n", String(m.width / m.height));
    renderRuler();
  }

  new ResizeObserver(function () {
    if (!meta) return;
    renderRuler();
    drawWave();
  }).observe(tlInner);

  // When the preview command ends the event stream drops and the browser keeps
  // retrying. The next preview of this project (same port) says hello with a
  // new session, and this tab reloads into it.
  var events = new EventSource("/events");
  events.addEventListener("hello", function (e) {
    var s = JSON.parse(e.data).session;
    if (session && s !== session) { location.reload(); return; }
    offline = false;
    renderChip();
  });
  events.addEventListener("error", function () {
    if (!meta) return;
    if (playing) stop();
    offline = true;
    renderChip();
  });
  events.addEventListener("audio", function (e) {
    if (meta) loadAudio(JSON.parse(e.data));
  });

  fetch("/meta").then(function (r) { return r.json(); }).then(function (m) {
    session = m.session;
    applyMeta(m);
    loadAudio(m.audio);
    setTime(0);
    $("buffering").classList.add("on");
    whenPlayer();
  });

  // The composition's bundle (loaded below) announces its player.
  function whenPlayer() {
    if (!window.gitframesPlayer) return;
    window.gitframesPlayer.then(function (p) {
      player = p;
      $("play").disabled = false;
      show(frame).then(scheduleWarm);
    }, showError);
  }
  window.addEventListener("gitframes:player", function () { if (meta) whenPlayer(); });
  window.addEventListener("error", function (e) { if (!player) showError(e.error || e.message); });
})();
</script>
<script type="module" src="/@gitframes/player.js"></script>
</body>
</html>
`;
