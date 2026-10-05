/**
 * Single-file preview UI served by `startPreview`. No framework, no build step.
 * The page script avoids template literals so it can live inside this one.
 */
export const previewPage = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>framefields preview</title>
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
  /* ── Notes: pinned to a spot (or an area) and a moment ── */
  .stage.can-note { cursor: crosshair; }
  .overlay { position: absolute; inset: 0; pointer-events: none; }
  .pin {
    position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; padding: 0; border-radius: 50%;
    display: grid; place-items: center; pointer-events: auto; cursor: pointer;
    background: var(--brand); color: #fff; font-size: 11px; font-weight: 600; line-height: 1;
    border: 2px solid #fff; box-shadow: 0 1px 5px rgb(0 0 0 / .55); transition: transform .12s;
  }
  .pin:hover, .pin.active { transform: scale(1.18); }
  .pin.done { background: #6b6e76; }
  .pin.draft { animation: pin-pulse 1.5s ease-out infinite; }
  .pin svg { width: 11px; height: 11px; }
  @keyframes pin-pulse {
    from { box-shadow: 0 0 0 0 rgb(59 130 246 / .6), 0 1px 5px rgb(0 0 0 / .55); }
    to { box-shadow: 0 0 0 14px rgb(59 130 246 / 0), 0 1px 5px rgb(0 0 0 / .55); }
  }
  .area {
    position: absolute; border: 1.5px solid var(--brand); border-radius: 3px;
    background: rgb(59 130 246 / .12); box-shadow: 0 0 0 1px rgb(0 0 0 / .35);
  }
  .area.done { border-color: #9a9da5; background: rgb(255 255 255 / .05); }
  .marquee { position: absolute; display: none; border: 1.5px dashed #fff; background: rgb(59 130 246 / .16); border-radius: 3px; pointer-events: none; }
  .stage-hint, .toast {
    position: absolute; left: 50%; transform: translateX(-50%); pointer-events: none; white-space: nowrap;
    padding: 6px 11px; border-radius: 999px; font-size: 12px; color: #fff; background: rgb(0 0 0 / .62);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); opacity: 0; transition: opacity .15s;
  }
  .stage-hint { top: 12px; }
  .stage.can-note.hint:hover .stage-hint { opacity: 1; }
  .toast { bottom: 14px; }
  .toast.on { opacity: 1; }

  .pop {
    position: fixed; z-index: 20; width: 280px; display: none; padding: 10px 10px 8px;
    background: var(--surface); border: 1px solid var(--line-2); border-radius: 12px;
    box-shadow: 0 12px 32px rgb(0 0 0 / .35);
  }
  .pop.on { display: block; }
  .pop-head { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--ink-3); margin-bottom: 6px; }
  .badge {
    min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; display: inline-grid; place-items: center; flex: none;
    background: var(--brand); color: #fff; font-size: 10.5px; font-weight: 600;
  }
  .badge.done { background: var(--ink-3); }
  .pop textarea {
    display: block; width: 100%; min-height: 54px; max-height: 180px; resize: none; padding: 2px 2px 0;
    border: 0; outline: none; background: transparent; color: var(--ink); font: inherit; line-height: 1.45;
  }
  .pop textarea::placeholder { color: var(--ink-3); }
  .pop-text { white-space: pre-wrap; overflow-wrap: anywhere; padding: 0 2px; max-height: 200px; overflow: auto; }
  .pop-foot { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11.5px; color: var(--ink-3); }
  .pop-foot .err { color: var(--bad); }
  .btn {
    height: 26px; padding: 0 10px; border-radius: 7px; border: 0; font-size: 12px; font-weight: 500;
    display: inline-flex; align-items: center; gap: 6px; background: transparent; color: var(--ink-2); white-space: nowrap;
  }
  .btn:hover:not(:disabled) { background: var(--surface-2); color: var(--ink); }
  .btn.primary { background: var(--primary-bg); color: var(--primary-ink); }
  .btn.primary:hover:not(:disabled) { background: var(--primary-bg); filter: brightness(.9); }
  .btn.danger:hover:not(:disabled) { color: var(--bad); }
  .btn:disabled { opacity: .4; cursor: default; }
  .btn svg { width: 13px; height: 13px; }
  .x-btn { width: 22px; height: 22px; padding: 0; justify-content: center; margin-right: -4px; }

  .transport { position: relative; }
  .notes-btn { height: 32px; padding: 0 9px 0 8px; margin-right: 6px; font-size: 12.5px; }
  .notes-btn svg { width: 15px; height: 15px; }
  .notes-btn .badge { background: var(--surface-3); color: var(--ink-2); }
  .notes-btn .badge.open { background: var(--brand); color: #fff; }
  .notes-panel {
    position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 15; width: min(360px, calc(100vw - 24px));
    max-height: min(440px, 62vh); display: none; flex-direction: column; overflow: hidden;
    background: var(--surface); border: 1px solid var(--line-2); border-radius: 12px; box-shadow: 0 12px 32px rgb(0 0 0 / .35);
  }
  .notes-panel.on { display: flex; }
  .np-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--line); }
  .np-head h2 { margin: 0; font-size: 13px; font-weight: 600; }
  .np-list { overflow: auto; padding: 4px; }
  .np-empty { padding: 22px 18px; text-align: center; color: var(--ink-3); font-size: 12.5px; }
  .np-foot { flex: none; padding: 8px 14px; border-top: 1px solid var(--line); color: var(--ink-3); font-size: 11.5px; overflow-wrap: anywhere; }
  .note-row {
    display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: start; padding: 8px 8px 8px 10px;
    border-radius: 8px; cursor: pointer;
  }
  .note-row:hover { background: var(--surface-2); }
  .note-row .badge { margin-top: 1px; }
  .note-row .when { font-size: 11.5px; color: var(--ink-3); }
  .note-row .text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .note-row.done .text { color: var(--ink-3); text-decoration: line-through; }
  .check {
    width: 20px; height: 20px; border-radius: 50%; padding: 0; display: grid; place-items: center; margin-top: 1px;
    border: 1.5px solid var(--line-2); background: transparent; color: transparent;
  }
  .check:hover { border-color: var(--ok); color: var(--ok); }
  .check.on { background: var(--ok); border-color: var(--ok); color: #fff; }
  .check svg { width: 11px; height: 11px; }

  .note-marks { position: absolute; left: 0; right: 0; top: 22px; bottom: 0; pointer-events: none; z-index: 2; }
  .note-mark {
    position: absolute; top: 5px; width: 14px; height: 14px; margin-left: -7px; padding: 0; border: 0; border-radius: 50%;
    display: grid; place-items: center; pointer-events: auto; cursor: pointer;
    background: var(--brand); color: #fff; font-size: 8.5px; font-weight: 700; box-shadow: 0 0 0 2px var(--surface);
  }
  .note-mark::after { content: ""; position: absolute; top: 14px; left: 6.5px; width: 1px; height: 30px; background: var(--brand); opacity: .45; }
  .note-mark.done { background: var(--ink-3); }
  .note-mark.stacked::after { display: none; }
  .note-mark.done::after { background: var(--ink-3); }
  .note-mark:hover { transform: scale(1.2); }
</style>
</head>
<body>
<header class="top">
  <svg class="logo" viewBox="0 0 512 512" aria-label="framefields" role="img"><g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M184 56H86q-30 0-30 30v98M328 56h98q30 0 30 30v98M184 456H86q-30 0-30-30v-98M328 456h98q30 0 30-30v-98" stroke-width="34" stroke-linejoin="round"/><path d="M176 182v148m0-148c0 74 60 74 100 74" stroke-width="28"/></g><g fill="currentColor"><circle cx="176" cy="172" r="32"/><circle cx="176" cy="340" r="32"/><path d="M284 200l78 56-78 56z" stroke="currentColor" stroke-width="34" stroke-linejoin="round"/></g></svg>
  <span class="sep" aria-hidden="true"></span>
  <h1 id="title">framefields preview</h1>
  <span class="grow"></span>
  <span class="spec tnum" id="spec"></span>
  <span class="chip" id="chip" data-state="mixing" role="status" aria-live="polite"><span class="spinner"></span><span>Mixing audio</span></span>
</header>

<main class="player" aria-label="Player">
  <div class="stage-wrap">
    <div class="stage" id="stage">
      <canvas id="canvas" aria-label="Rendered frame"></canvas>
      <div class="stage-msg" id="stageMsg" role="alert"></div>
      <div class="overlay" id="pins"></div>
      <div class="marquee" id="marquee"></div>
      <div class="stage-hint" id="stageHint">Click to pin a note · drag to mark an area</div>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>
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
    <button class="btn notes-btn" id="notesBtn" title="Notes" aria-haspopup="dialog" aria-expanded="false" hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M3 2.75h10a1.25 1.25 0 0 1 1.25 1.25v6.5A1.25 1.25 0 0 1 13 11.75H7.5L4.5 14v-2.25H3A1.25 1.25 0 0 1 1.75 10.5V4A1.25 1.25 0 0 1 3 2.75z"/></svg>
      Notes <span class="badge" id="notesCount">0</span>
    </button>
    <div class="notes-panel" id="notesPanel" role="dialog" aria-label="Notes">
      <div class="np-head">
        <h2>Notes</h2><span class="grow"></span>
        <button class="btn" id="notesCopy" title="Copy the open notes, to paste into a chat">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.25" y="5.25" width="8" height="8" rx="1.5"/><path d="M10.75 3.5V3.25a1.5 1.5 0 0 0-1.5-1.5h-5.5a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5H4"/></svg>
          <span id="notesCopyLabel">Copy</span>
        </button>
        <button class="btn x-btn" id="notesClose" title="Close" aria-label="Close"><svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
      </div>
      <div class="np-list" id="notesList"></div>
      <div class="np-foot" id="notesFoot"></div>
    </div>
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
      <div class="note-marks" id="noteMarks"></div>
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

<div class="pop" id="pop" role="dialog" aria-label="Note"></div>

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

  // ── Reporting: errors and the engine's warnings go to the preview's
  // terminal too, so whoever runs it sees them without opening this tab.
  // Once each; frame numbers aside, playback repeats the same one per frame ──
  var reportedKeys = new Set();
  function errText(x) {
    if (x && x.message) return x.stack && x.stack.indexOf(x.message) >= 0 ? x.stack.split("\\n").slice(0, 4).join("\\n") : x.message;
    return typeof x === "string" ? x : String(x);
  }
  function report(level, parts) {
    var text = parts.map(errText).join(" ").trim(), key = level + text.replace(/\\d+/g, "#");
    if (!text || reportedKeys.has(key) || reportedKeys.size > 100) return;
    reportedKeys.add(key);
    fetch("/@framefields/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: level, message: text.slice(0, 4000) }),
      keepalive: true
    }).catch(function () {});
  }
  ["error", "warn"].forEach(function (name) {
    var original = console[name].bind(console);
    console[name] = function () {
      original.apply(null, arguments);
      var args = Array.prototype.slice.call(arguments);
      // Errors from anywhere; warnings only from the engine (fonts, renderers).
      if (name === "error" || (typeof args[0] === "string" && args[0].indexOf("[framefields]") === 0)) {
        report(name === "error" ? "error" : "warning", args);
      }
    };
  });

  // ── Frames: drawn in this tab by the composition's own code ──
  function setTime(f) {
    frame = f;
    $("tcNow").textContent = fmt(f);
    $("tcFrame").textContent = "frame " + f;
    $("playhead").style.left = pct(f) + "%";
    if (!playing && notesOn) renderPins();
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
    // The playhead moved: frames rendered ahead of the old spot are stale.
    if (player) player.buffer.clear();
    $("buffered").style.display = "none";
    var done = show(clampFrame(f));
    keepPosition();
    scheduleWarm();
    return done;
  }

  // ── Position in the address: #t=12.5 opens there, and a reload (the next
  // preview taking over) comes back to the same moment ──
  function startFrame() {
    var m = /[#&]t=([\\d.]+)/.exec(location.hash), n = /[#&]frame=(\\d+)/.exec(location.hash);
    if (m) return clampFrame(Number(m[1]) * meta.fps);
    if (n) return clampFrame(Number(n[1]));
    return 0;
  }
  function keepPosition() {
    var at = frame > 0 ? "#t=" + Number((frame / meta.fps).toFixed(3)) : location.pathname;
    try { history.replaceState(null, "", at); } catch (e) {}
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
    report("error", [err]);
    pageState = "error";
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
    if (openId != null) closePop();
    if (draft && !draft.text.trim()) cancelDraft();
    if (notesOn) renderPins();
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
  function pause() { stop(); keepPosition(); show(frame).then(scheduleWarm); }
  function togglePlay() { playing ? pause() : play(); }

  // Like a video player: frames are rendered ahead into a buffer, in order,
  // and every one is shown at the film's frame rate. Playback starts once
  // three seconds (or the rest of the film) are ready; when rendering falls
  // behind, the clock and the sound hold until the buffer is full again.
  // Pausing keeps the buffer (and it keeps filling), so playing on starts at
  // once; moving the playhead clears it.
  var BUFFER_SEC = 3;
  async function playRealtime(alive) {
    player.buffer.start(frame);
    while (alive() && frame < last()) {
      if (!(await fillBuffer(alive))) return;
      if (!(await runClock(alive))) return;
    }
  }
  // While paused, the loaded range keeps growing on the timeline.
  setInterval(function () {
    if (!player || playing) return;
    if (player.buffer.ahead(frame) > 0) showBufferedRange();
    else $("buffered").style.display = "none";
  }, 250);
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

  // ── Notes: pause, click the picture (or drag an area) and say what should
  // change. Each is saved with its moment, its spot and a picture of the
  // frame with the spot marked, for whoever edits the film ──
  var notes = [], notesOn = false, draft = null, openId = null, saving = false, press = null;
  var pop = $("pop"), pins = $("pins"), NL = String.fromCharCode(10);
  var ICON_CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  var ICON_X = '<svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  function pct1(v) { return Math.round(v * 100) + "%"; }
  function whereText(n) {
    return n.w != null ? "area " + pct1(n.x) + "," + pct1(n.y) + " to " + pct1(n.x + n.w) + "," + pct1(n.y + n.h) : "spot " + pct1(n.x) + "," + pct1(n.y);
  }
  function noteById(id) { return notes.find(function (n) { return n.id === id; }); }
  function openCount() { return notes.filter(function (n) { return !n.done; }).length; }

  function renderNotes() {
    renderPins();
    renderMarks();
    renderList();
    var open = openCount(), count = $("notesCount");
    count.textContent = String(open || notes.length);
    count.classList.toggle("open", open > 0);
    $("notesBtn").title = open + " open of " + notes.length;
  }
  function renderPins() {
    if (!meta) return;
    stage.classList.toggle("can-note", notesOn && !!player && !playing);
    stage.classList.toggle("hint", notes.length === 0 && !draft);
    pins.replaceChildren();
    if (playing) return;
    var here = notes.filter(function (n) { return n.frame === frame; });
    if (draft && draft.frame === frame) here.push(draft);
    here.forEach(function (n) {
      if (n.w != null) {
        var a = el("div", "area" + (n.done ? " done" : ""));
        a.style.left = n.x * 100 + "%"; a.style.top = n.y * 100 + "%";
        a.style.width = n.w * 100 + "%"; a.style.height = n.h * 100 + "%";
        pins.append(a);
      }
      var pin = el("button", "pin" + (n.done ? " done" : "") + (n === draft ? " draft" : "") + (n.id === openId ? " active" : ""));
      pin.style.left = n.x * 100 + "%"; pin.style.top = n.y * 100 + "%";
      if (n === draft) { pin.setAttribute("aria-label", "New note"); }
      else {
        if (n.done) pin.innerHTML = ICON_CHECK; else pin.textContent = String(n.id);
        pin.title = n.text;
        pin.setAttribute("aria-label", "Note " + n.id);
        pin.addEventListener("click", function (e) { e.stopPropagation(); openCard(n.id); });
      }
      pins.append(pin);
    });
  }
  function renderMarks() {
    var marks = $("noteMarks");
    marks.replaceChildren();
    if (!meta) return;
    // Notes close together stack, up to three high.
    var width = tlInner.clientWidth || 800, lanes = [];
    notes.slice().sort(function (a, b) { return a.frame - b.frame || a.id - b.id; }).forEach(function (n) {
      var x = (pct(n.frame) / 100) * width, lane = lanes.findIndex(function (end) { return x - end >= 16; });
      if (lane < 0) lane = lanes.length < 3 ? lanes.length : 2;
      lanes[lane] = x;
      var m = el("button", "note-mark" + (n.done ? " done" : "") + (lane ? " stacked" : ""), String(n.id));
      m.style.left = pct(n.frame) + "%";
      m.style.top = 4 + lane * 15 + "px";
      m.title = n.id + " · " + fmt(n.frame) + " · " + n.text;
      m.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      m.addEventListener("click", function (e) { e.stopPropagation(); goToNote(n.id); });
      marks.append(m);
    });
  }
  function renderList() {
    var list = $("notesList");
    list.replaceChildren();
    $("notesCopy").disabled = openCount() === 0;
    if (!notes.length) {
      list.append(el("div", "np-empty", "Pause and click the picture to pin a note to that spot and moment. Drag to mark an area."));
    }
    notes.slice().sort(function (a, b) { return a.frame - b.frame || a.id - b.id; }).forEach(function (n) {
      var row = el("div", "note-row" + (n.done ? " done" : ""));
      var body = el("div");
      body.append(el("div", "when tnum", fmt(n.frame) + " · frame " + n.frame), el("div", "text", n.text));
      var check = el("button", "check" + (n.done ? " on" : ""));
      check.innerHTML = ICON_CHECK;
      check.title = n.done ? "Reopen" : "Mark done";
      check.setAttribute("aria-label", check.title);
      check.addEventListener("click", function (e) { e.stopPropagation(); setDone(n.id, !n.done); });
      row.append(el("span", "badge" + (n.done ? " done" : ""), String(n.id)), body, check);
      row.addEventListener("click", function () { goToNote(n.id); });
      list.append(row);
    });
    var dir = meta && meta.notesDir ? meta.notesDir.split("/").slice(-2).join("/") : "";
    $("notesFoot").textContent = "Saved in " + dir + " with a picture of each spot. Ask your agent to go through them.";
  }

  function notesRequest(body) {
    return fetch("/@framefields/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  function upsert(note) {
    var i = notes.findIndex(function (n) { return n.id === note.id; });
    if (i >= 0) notes[i] = note; else notes.push(note);
    renderNotes();
  }
  function setDone(id, done) {
    notesRequest({ op: "update", id: id, done: done }).then(function (n) {
      upsert(n);
      if (openId === id) openCard(id);
    }, function () { toast("Couldn't save. Is the preview running?"); });
  }
  function removeNote(id) {
    notesRequest({ op: "remove", id: id }).then(function () {
      notes = notes.filter(function (n) { return n.id !== id; });
      closePop();
      renderNotes();
    }, function () { toast("Couldn't delete. Is the preview running?"); });
  }
  function goToNote(id) {
    var n = noteById(id);
    if (!n) return;
    $("notesPanel").classList.remove("on");
    $("notesBtn").setAttribute("aria-expanded", "false");
    seek(n.frame).then(function () { openCard(id); });
  }

  var toastTimer = null;
  function toast(text) {
    var t = $("toast");
    t.textContent = text;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2200);
  }

  // ── Placing a note on the picture ──
  function fracAt(e) {
    var r = stage.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), r: r };
  }
  stage.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || !player || e.target.closest(".pin")) return;
    if (playing) { pause(); return; }
    if (!notesOn) return;
    if (draft && pop.querySelector("textarea") && pop.querySelector("textarea").value.trim()) {
      pop.querySelector("textarea").focus();
      return;
    }
    cancelDraft();
    var p = fracAt(e);
    press = { x: p.x, y: p.y, cx: e.clientX, cy: e.clientY, area: null };
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener("pointermove", function (e) {
    if (!press) return;
    var p = fracAt(e);
    if (!press.area && Math.hypot(e.clientX - press.cx, e.clientY - press.cy) < 6) return;
    press.area = { x: Math.min(press.x, p.x), y: Math.min(press.y, p.y), w: Math.abs(p.x - press.x), h: Math.abs(p.y - press.y) };
    var m = $("marquee");
    m.style.display = "block";
    m.style.left = press.area.x * 100 + "%"; m.style.top = press.area.y * 100 + "%";
    m.style.width = press.area.w * 100 + "%"; m.style.height = press.area.h * 100 + "%";
  });
  function endPress() {
    if (!press) return;
    var a = press.area;
    $("marquee").style.display = "none";
    draft = a && a.w > 0.01 && a.h > 0.01
      ? { frame: frame, x: a.x, y: a.y, w: a.w, h: a.h, text: "" }
      : { frame: frame, x: press.x, y: press.y, text: "" };
    press = null;
    openComposer();
  }
  stage.addEventListener("pointerup", endPress);
  stage.addEventListener("pointercancel", function () { press = null; $("marquee").style.display = "none"; });

  // ── The popover: writing a note, or reading one ──
  var popAnchor = null;
  function placePop() {
    if (!popAnchor || !pop.classList.contains("on")) return;
    var r = stage.getBoundingClientRect(), n = popAnchor;
    var ax = r.left + (n.x + (n.w || 0)) * r.width, ay = r.top + (n.y + (n.h || 0)) * r.height;
    var w = pop.offsetWidth, h = pop.offsetHeight, gap = 16;
    var left = ax + gap + w <= innerWidth - 8 ? ax + gap : ax - gap - w - (n.w || 0) * r.width;
    var top = ay + gap + h <= innerHeight - 8 ? ay + gap / 2 : ay - h - gap / 2 - (n.h || 0) * r.height;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, left)) + "px";
    pop.style.top = Math.max(8, Math.min(innerHeight - h - 8, top)) + "px";
  }
  function showPop(anchor) {
    popAnchor = anchor;
    pop.classList.add("on");
    placePop();
  }
  function closePop() {
    pop.classList.remove("on");
    pop.replaceChildren();
    popAnchor = null;
    openId = null;
    renderPins();
  }
  function cancelDraft() {
    if (!draft) return;
    draft = null;
    closePop();
  }
  function openComposer() {
    openId = null;
    var head = el("div", "pop-head");
    head.append(el("span", "badge", "+"), el("span", "tnum", fmt(draft.frame) + " · " + (draft.w != null ? "area" : "spot")));
    var ta = document.createElement("textarea");
    ta.placeholder = "What should change here?";
    ta.rows = 2;
    ta.setAttribute("aria-label", "Note");
    var foot = el("div", "pop-foot"), status = el("span", "grow", "Enter to add");
    var cancel = el("button", "btn", "Cancel"), add = el("button", "btn primary", "Add note");
    add.disabled = true;
    foot.append(status, cancel, add);
    pop.replaceChildren(head, ta, foot);
    ta.addEventListener("input", function () {
      draft.text = ta.value;
      add.disabled = !ta.value.trim() || saving;
      ta.style.height = "auto";
      ta.style.height = Math.min(180, ta.scrollHeight) + "px";
      placePop();
    });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveDraft(ta, add, status); }
      if (e.key === "Escape") { e.preventDefault(); cancelDraft(); }
    });
    cancel.addEventListener("click", cancelDraft);
    add.addEventListener("click", function () { saveDraft(ta, add, status); });
    renderPins();
    showPop(draft);
    ta.focus();
  }
  async function saveDraft(ta, add, status) {
    var d = draft, text = ta.value.trim();
    if (!d || !text || saving) return;
    saving = true;
    ta.readOnly = true;
    add.disabled = true;
    status.className = "grow";
    status.textContent = "Saving…";
    try {
      var image = null;
      try { image = await capture(d); } catch (err) { report("warning", ["[framefields] no picture for the note:", err]); }
      var note = await notesRequest({ op: "add", note: { frame: d.frame, time: d.frame / meta.fps, x: d.x, y: d.y, w: d.w, h: d.h, text: text, image: image } });
      if (draft === d) draft = null;
      closePop();
      upsert(note);
      toast("Note " + note.id + " saved");
    } catch (err) {
      status.className = "grow err";
      status.textContent = "Couldn't save. Is the preview running?";
      ta.readOnly = false;
      add.disabled = false;
    } finally {
      saving = false;
    }
  }
  // The frame with the spot marked, small enough to read at a glance.
  async function capture(d) {
    var bmp = await player.snapshot(d.frame);
    var scale = Math.min(1, 1600 / bmp.width), w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var g = c.getContext("2d");
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    var lw = Math.max(3, w / 400);
    function mark(draw) {
      // Dark, white, then blue: it reads on any picture.
      g.lineWidth = lw + 5; g.strokeStyle = "rgba(0,0,0,0.5)"; draw();
      g.lineWidth = lw + 2.5; g.strokeStyle = "#fff"; draw();
      g.lineWidth = lw; g.strokeStyle = "#3b82f6"; draw();
    }
    if (d.w != null) {
      mark(function () { g.strokeRect(d.x * w, d.y * h, d.w * w, d.h * h); });
    } else {
      var rad = Math.max(16, w / 40);
      mark(function () { g.beginPath(); g.arc(d.x * w, d.y * h, rad, 0, Math.PI * 2); g.stroke(); });
      g.fillStyle = "#3b82f6";
      g.beginPath(); g.arc(d.x * w, d.y * h, lw, 0, Math.PI * 2); g.fill();
    }
    return c.toDataURL("image/jpeg", 0.88);
  }
  function openCard(id) {
    var n = noteById(id);
    if (!n) return;
    if (draft) cancelDraft();
    openId = id;
    var head = el("div", "pop-head");
    var close = el("button", "btn x-btn");
    close.innerHTML = ICON_X;
    close.title = "Close";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", closePop);
    head.append(el("span", "badge" + (n.done ? " done" : ""), String(n.id)), el("span", "tnum grow", fmt(n.frame) + " · frame " + n.frame), close);
    var foot = el("div", "pop-foot");
    var done = el("button", "btn");
    done.innerHTML = ICON_CHECK;
    done.append(document.createTextNode(n.done ? "Reopen" : "Mark done"));
    done.addEventListener("click", function () { setDone(n.id, !n.done); });
    var del = el("button", "btn danger", "Delete");
    del.addEventListener("click", function () { removeNote(n.id); });
    foot.append(done, el("span", "grow"), del);
    pop.replaceChildren(head, el("div", "pop-text", n.text), foot);
    renderPins();
    showPop(n);
  }

  document.addEventListener("pointerdown", function (e) {
    if (pop.classList.contains("on") && !pop.contains(e.target) && !stage.contains(e.target) && !e.target.closest(".note-mark, .note-row")) {
      if (openId != null) closePop();
      else if (draft && !draft.text.trim()) cancelDraft();
    }
    var panel = $("notesPanel");
    if (panel.classList.contains("on") && !panel.contains(e.target) && !$("notesBtn").contains(e.target)) {
      panel.classList.remove("on");
      $("notesBtn").setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (openId != null) closePop();
    $("notesPanel").classList.remove("on");
    $("notesBtn").setAttribute("aria-expanded", "false");
  });
  window.addEventListener("resize", placePop);
  new ResizeObserver(placePop).observe(stage);

  $("notesBtn").addEventListener("click", function () {
    var on = $("notesPanel").classList.toggle("on");
    $("notesBtn").setAttribute("aria-expanded", String(on));
  });
  $("notesClose").addEventListener("click", function () {
    $("notesPanel").classList.remove("on");
    $("notesBtn").setAttribute("aria-expanded", "false");
  });
  // The open notes as text, for a chat that can't read the notes folder.
  $("notesCopy").addEventListener("click", function () {
    var lines = ["Notes on the preview of " + JSON.stringify(meta.title) + ":"];
    notes.filter(function (n) { return !n.done; }).sort(function (a, b) { return a.frame - b.frame; }).forEach(function (n) {
      lines.push("- Note " + n.id + " at " + fmt(n.frame) + " (frame " + n.frame + "), " + whereText(n) + ": " + n.text + (n.image ? " [picture: " + n.image + "]" : ""));
    });
    var text = lines.join(NL), label = $("notesCopyLabel");
    var done = function () { label.textContent = "Copied"; setTimeout(function () { label.textContent = "Copy"; }, 1600); };
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(done, function () {
      var t = document.createElement("textarea");
      t.value = text;
      document.body.append(t);
      t.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      t.remove();
    });
  });

  function loadNotes() {
    if (!notesOn) return;
    fetch("/@framefields/notes").then(function (r) { return r.json(); }).then(function (list) {
      notes = Array.isArray(list) ? list : [];
      renderNotes();
    }, function () {});
  }

  // ── Wiring ──
  $("play").addEventListener("click", togglePlay);
  $("prev").addEventListener("click", function () { seek(frame - 1); });
  $("next").addEventListener("click", function () { seek(frame + 1); });
  $("mute").addEventListener("click", function () { audio.muted = !audio.muted; applyVolume(); });
  $("volume").addEventListener("input", function (e) { audio.volume = Number(e.target.value); audio.muted = audio.volume === 0; applyVolume(); });

  // A hidden tab's timers are throttled, so playback would stutter: pause.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && playing) pause();
  });

  // ── For scripts and agents driving the page: seek, play, and read the
  // state instead of clicking at coordinates ──
  var pageState = "loading";
  window.framefieldsPreview = {
    /** Shows the frame at a time in seconds; resolves once it is drawn. */
    seek: function (sec) { return ready().then(function () { return seek(Number(sec) * meta.fps); }); },
    /** Shows a frame by number; resolves once it is drawn. */
    seekFrame: function (f) { return ready().then(function () { return seek(f); }); },
    play: function () { return ready().then(play); },
    /** Notes pinned on the page, as saved in notes.json. */
    notes: function () { return notes.slice(); },
    pause: function () { if (playing) pause(); },
    /** Where the preview is: loading, ready or error, and what it shows. */
    state: function () {
      return {
        state: pageState,
        error: pageState === "error" ? $("stageMsg").textContent : null,
        frame: frame,
        time: meta ? Number((frame / meta.fps).toFixed(3)) : 0,
        playing: playing,
        buffering: stalled,
        audio: audio.state,
        connected: !offline,
        meta: meta && { title: meta.title, width: meta.width, height: meta.height, fps: meta.fps, frameCount: meta.frameCount, duration: Number((last() / meta.fps).toFixed(3)) }
      };
    }
  };
  var readyWaiters = [];
  function ready() {
    if (player) return Promise.resolve();
    if (pageState === "error") return Promise.reject(new Error($("stageMsg").textContent));
    return new Promise(function (resolve, reject) { readyWaiters.push([resolve, reject]); });
  }
  function settleReady(err) {
    readyWaiters.splice(0).forEach(function (w) { err ? w[1](err) : w[0](); });
  }

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
    renderMarks();
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
    if (playing) { stop(); keepPosition(); }
    offline = true;
    renderChip();
  });
  events.addEventListener("notes", function (e) {
    notes = JSON.parse(e.data);
    if (openId != null && !noteById(openId)) closePop();
    renderNotes();
  });
  events.addEventListener("audio", function (e) {
    if (meta) loadAudio(JSON.parse(e.data));
  });

  fetch("/meta").then(function (r) { return r.json(); }).then(function (m) {
    session = m.session;
    applyMeta(m);
    notesOn = !!m.notesDir;
    $("notesBtn").hidden = !notesOn;
    loadNotes();
    loadAudio(m.audio);
    setTime(startFrame());
    $("buffering").classList.add("on");
    whenPlayer();
  });

  // The composition's bundle (loaded below) announces its player.
  function whenPlayer() {
    if (!window.framefieldsPlayer) return;
    window.framefieldsPlayer.then(function (p) {
      player = p;
      $("play").disabled = false;
      show(frame).then(function () {
        pageState = "ready";
        renderPins();
        document.documentElement.dataset.preview = "ready";
        settleReady();
        scheduleWarm();
      });
    }, function (err) {
      showError(err);
      document.documentElement.dataset.preview = "error";
      settleReady(err instanceof Error ? err : new Error(String(err)));
    });
  }
  window.addEventListener("framefields:player", function () { if (meta) whenPlayer(); });
  window.addEventListener("error", function (e) {
    if (!player) showError(e.error || e.message);
    else report("error", [e.error || e.message]);
  });
  window.addEventListener("unhandledrejection", function (e) { report("error", [e.reason]); });
})();
</script>
<script type="module" src="/@framefields/player.js"></script>
</body>
</html>
`;
