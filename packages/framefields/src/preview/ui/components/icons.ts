import { html, svg } from "lit";

// Fragments go inside an <svg>; whole icons are html templates.

export const logo = svg`<g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M184 56H86q-30 0-30 30v98M328 56h98q30 0 30 30v98M184 456H86q-30 0-30-30v-98M328 456h98q30 0 30-30v-98" stroke-width="34" stroke-linejoin="round"/><path d="M176 182v148m0-148c0 74 60 74 100 74" stroke-width="28"/></g><g fill="currentColor"><circle cx="176" cy="172" r="32"/><circle cx="176" cy="340" r="32"/><path d="M284 200l78 56-78 56z" stroke="currentColor" stroke-width="34" stroke-linejoin="round"/></g>`;

export const check = html`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>`;

export const close = html`<svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;

export const prev = html`<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h1.6v10H3zM13 3.6v8.8a.6.6 0 0 1-.92.5L5.8 8.5a.6.6 0 0 1 0-1l6.28-4.4a.6.6 0 0 1 .92.5z"/></svg>`;

export const next = html`<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11.4 3H13v10h-1.6zM3 3.6v8.8a.6.6 0 0 0 .92.5l6.28-4.4a.6.6 0 0 0 0-1L3.92 3.1A.6.6 0 0 0 3 3.6z"/></svg>`;

export const play = html`<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.9v10.2a.7.7 0 0 0 1.06.6l8.1-5.1a.7.7 0 0 0 0-1.2l-8.1-5.1a.7.7 0 0 0-1.06.6z"/></svg>`;

export const pause = html`<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="2.5" width="3.2" height="11" rx=".8"/><rect x="9.3" y="2.5" width="3.2" height="11" rx=".8"/></svg>`;

export const spin = html`<svg class="spin" viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="18"/></svg>`;

export const notes = html`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M3 2.75h10a1.25 1.25 0 0 1 1.25 1.25v6.5A1.25 1.25 0 0 1 13 11.75H7.5L4.5 14v-2.25H3A1.25 1.25 0 0 1 1.75 10.5V4A1.25 1.25 0 0 1 3 2.75z"/></svg>`;

export const copy = html`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.25" y="5.25" width="8" height="8" rx="1.5"/><path d="M10.75 3.5V3.25a1.5 1.5 0 0 0-1.5-1.5h-5.5a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5H4"/></svg>`;

export const volume = html`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" stroke="none"/><path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.9a5.8 5.8 0 0 1 0 8.2"/></svg>`;

export const muted = html`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" stroke="none"/><path d="M10.5 6l3.5 4M14 6l-3.5 4"/></svg>`;

export const buffering = html`<svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="20"/></svg>`;
