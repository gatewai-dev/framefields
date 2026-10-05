/** Scene windows in composition frames (30 fps). Each scene owns [from, to). */
export const TITLE = { from: 0, to: 90 } as const;
export const REVENUE = { from: 90, to: 270 } as const;
export const LIVE = { from: 270, to: 450 } as const;
export const MIX = { from: 450, to: 630 } as const;
export const MARKET = { from: 630, to: 810 } as const;
export const OUTRO = { from: 810, to: 900 } as const;

export const SCENES = [TITLE, REVENUE, LIVE, MIX, MARKET, OUTRO];
export const DURATION = OUTRO.to;
