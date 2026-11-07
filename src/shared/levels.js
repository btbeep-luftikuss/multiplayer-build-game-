// Levels mode: ten handcrafted challenges, then an endless remix. Each level sets its time limit, how
// high the tower must reach (for 2 players; a little higher with more), the pieces everyone gets,
// whether power-ups appear, and the mechanics ("mods") that make it hard. Data only: the TV's physics
// and the phones both read it.

// what each mechanic is called on screen
export const MOD_INFO = {
  wind: { icon: '🌬️', label: 'Wind' },
  soft: { icon: '🍮', label: 'Soft ground' },
  tilt: { icon: '🎢', label: 'Rocking base' },
  magnets: { icon: '🧲', label: 'Magnetic blocks' },
  lava: { icon: '🌋', label: 'Rising lava' },
  gravity: { icon: '🪐', label: 'Low gravity on the right' },
  moveLine: { icon: '🎯', label: 'Moving finish line' },
  unstable: { icon: '⚠️', label: 'Unstable claws' },
  fragile: { icon: '💎', label: 'Fragile glass' },
};

export const LEVELS = [
  {
    id: 1, name: 'Training Grounds', icon: '🎓', time: 300, height: 7, powerups: false,
    blurb: 'Flat ground, plenty of time, simple blocks. Learn the claw and stack them up!',
    mods: {},
    pool: [['wood-cube', 9], ['wood-short', 6], ['wood-plank', 4], ['wood-beam', 3], ['stone-slab', 2]],
  },
  {
    id: 2, name: 'Windy Heights', icon: '🌬️', time: 270, height: 8.5, powerups: true,
    blurb: 'Gusts push the tower, harder the higher it gets. Build wide and keep it balanced.',
    mods: { wind: { max: 2.0 } },
    pool: [['wood-cube', 8], ['stone-cube', 4], ['stone-slab', 3], ['wood-short', 4], ['metal-l', 3], ['wood-wedge', 3]],
  },
  {
    id: 3, name: 'Soft Ground', icon: '🍮', time: 270, height: 8.5, powerups: true,
    blurb: 'The base is springy jelly. Heavy pieces sink where you drop them, so spread the weight.',
    mods: { soft: true },
    pool: [['stone-slab', 3], ['wood-plank', 6], ['wood-cube', 6], ['foam-cube', 4], ['wood-short', 4], ['stone-brick', 4]],
  },
  {
    id: 4, name: 'Rotating Platform', icon: '🎢', time: 240, height: 9, powerups: true,
    blurb: 'The base slowly rocks from side to side. Keep the tower\'s weight over the middle.',
    mods: { tilt: { amp: 6, period: 18 } },
    pool: [['wood-cube', 8], ['stone-brick', 6], ['metal-l', 3], ['wood-short', 4], ['rubber-cube', 3], ['clay-arch', 2]],
  },
  {
    id: 5, name: 'Magnetic Blocks', icon: '🧲', time: 240, height: 10, powerups: true,
    blurb: 'Red (N) and blue (S) blocks pull together; two of the same colour push apart.',
    mods: { magnets: true },
    pool: [['magn-cube', 4], ['mags-cube', 4], ['magn-bar', 3], ['mags-bar', 3], ['wood-cube', 4], ['wood-plank', 3]],
  },
  {
    id: 6, name: 'Shrinking Time', icon: '🌋', time: 150, height: 10, powerups: true,
    blurb: 'Less time, and lava rising up the sides burns anything it touches. Don\'t drop anything!',
    mods: { lava: { rise: 0.8 } },
    pool: [['wood-cube', 6], ['stone-cube', 4], ['wood-short', 4], ['metal-girder', 2], ['wood-post', 3], ['crate', 2]],
  },
  {
    id: 7, name: 'Dual Gravity Zones', icon: '🪐', time: 210, height: 11, powerups: true,
    blurb: 'Normal gravity on the left, floaty low gravity on the right. Pieces behave differently on each side.',
    mods: { gravity: { right: 0.35 } },
    pool: [['stone-slab', 3], ['metal-girder', 3], ['wood-cube', 6], ['foam-cube', 4], ['wood-post', 3], ['foam-star', 2]],
  },
  {
    id: 8, name: 'Moving Target Line', icon: '🎯', time: 210, height: 10.5, powerups: true,
    blurb: 'The finish line drifts up and down. Only the end counts: be over it when the time runs out.',
    mods: { moveLine: { amp: 1.2, period: 22 } },
    pool: [['wood-cube', 8], ['wood-post', 4], ['wood-short', 4], ['gold-spire', 2], ['stone-brick', 4], ['crate', 2]],
  },
  {
    id: 9, name: 'Unstable Claws', icon: '⚠️', time: 210, height: 11, powerups: true,
    blurb: 'Claws slip and ropes stretch at random, and glass shatters if it hits too hard. Call out your moves!',
    mods: { unstable: { min: 6, max: 13, drop: 0.15 }, fragile: true },
    pool: [['wood-cube', 6], ['glass-cube', 4], ['glass-plank', 3], ['stone-slab', 2], ['wood-short', 4], ['metal-t', 3]],
  },
  {
    id: 10, name: 'Final Challenge', icon: '🏆', time: 140, height: 12, powerups: true,
    blurb: 'Wind, a rocking base, magnets and rising lava, all at once, with the least time of all. Good luck!',
    mods: { wind: { max: 1.4 }, tilt: { amp: 4, period: 22 }, magnets: true, lava: { rise: 0.85 } },
    pool: [['magn-cube', 3], ['mags-cube', 3], ['stone-slab', 2], ['wood-cube', 6], ['wood-short', 4], ['metal-l', 3], ['wood-post', 3]],
  },
];

export const REMIX = {
  id: 'remix', name: 'Endless Remix', icon: '🎲', time: 180, height: 10, powerups: true,
  blurb: 'A random mix of mechanics from the levels, a little harder every time you win.',
};

export function levelById(id) {
  if (id === 'remix') return REMIX;
  return LEVELS.find((l) => l.id === id) || null;
}

// the height to reach, for this many players
export function levelHeight(def, players) {
  return Math.round((def.height + 0.6 * (Math.max(2, players) - 2)) * 2) / 2;
}

// one remix round: two or three mechanics from the levels, a pool of everything
const REMIX_MODS = [
  () => ({ wind: { max: 1.6 } }),
  () => ({ soft: true }),
  () => ({ tilt: { amp: 5, period: 20 } }),
  () => ({ magnets: true }),
  () => ({ lava: { rise: 0.85 } }),
  () => ({ gravity: { right: 0.35 } }),
  () => ({ moveLine: { amp: 1, period: 22 } }),
  () => ({ unstable: { min: 7, max: 14, drop: 0.1 }, fragile: true }),
];
export function remixLevel(wins, random = Math.random) {
  const picks = new Set();
  const n = 2 + (random() < 0.4 ? 1 : 0);
  while (picks.size < n) picks.add(Math.floor(random() * REMIX_MODS.length));
  const mods = {};
  for (const i of picks) Object.assign(mods, REMIX_MODS[i]());
  return {
    ...REMIX, mods,
    height: Math.min(14, REMIX.height + wins * 0.5),
    time: Math.max(140, REMIX.time - wins * 5),
    pool: [['wood-cube', 6], ['stone-cube', 3], ['stone-slab', 2], ['wood-short', 5], ['wood-plank', 3], ['metal-l', 3], ['wood-post', 3],
      ...(mods.magnets ? [['magn-cube', 3], ['mags-cube', 3]] : [['crate', 2]])],
  };
}
