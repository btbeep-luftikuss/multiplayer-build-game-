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
  lava: { icon: '🌋', label: 'Rising lava (burns wood)' },
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
    pool: [['wood-cube', 9], ['wood-short', 6], ['wood-plank', 4], ['wood-beam', 3], ['crate', 2]],
  },
  {
    id: 2, name: 'Windy Heights', icon: '🌬️', time: 270, height: 8.5, powerups: true,
    blurb: 'Gusts push the tower, harder the higher it gets. Build wide and keep it balanced.',
    mods: { wind: { max: 2.0 } },
    pool: [['stone-pyramid', 3], ['stone-slab', 3], ['stone-cube', 6], ['stone-plus', 2], ['metal-l', 3], ['stone-tall', 2]],
  },
  {
    id: 3, name: 'Soft Ground', icon: '🍮', time: 270, height: 8.5, powerups: true,
    blurb: 'The base is springy jelly. Heavy pieces sink where you drop them, so spread the weight.',
    mods: { soft: true },
    pool: [['foam-raft', 3], ['wood-raft', 3], ['foam-cube', 6], ['wood-hex', 4], ['foam-roof', 3], ['crate', 3], ['wood-stairs', 2]],
  },
  {
    id: 4, name: 'Rotating Platform', icon: '🎢', time: 240, height: 9, powerups: true,
    blurb: 'The base slowly rocks from side to side. Keep the tower\'s weight over the middle.',
    mods: { tilt: { amp: 6, period: 18 } },
    pool: [['rubber-cube', 6], ['wood-cup', 3], ['metal-cup', 2], ['clay-stairs', 3], ['stone-arch', 2], ['metal-t', 3], ['rubber-ball', 2]],
  },
  {
    id: 5, name: 'Magnetic Blocks', icon: '🧲', time: 240, height: 10, powerups: true,
    blurb: 'Red (N) and blue (S) blocks pull together; two of the same colour push apart.',
    mods: { magnets: true },
    pool: [['magn-cube', 4], ['mags-cube', 4], ['magn-bar', 3], ['mags-bar', 3], ['magn-post', 2], ['mags-post', 2], ['magn-plate', 2], ['mags-plate', 2]],
  },
  {
    id: 6, name: 'Lava Rising', icon: '🌋', time: 270, height: 10, powerups: true,
    blurb: 'Lava rises halfway up the tower and burns wood (stone and metal don\'t burn): build the bottom half fireproof. Your shelves are rafts on the lava.',
    mods: { lava: { rise: 0.85, upTo: 0.5 } },
    pool: [['stone-slab', 3], ['stone-cube', 7], ['stone-post', 4], ['stone-pyramid', 1], ['metal-girder', 2], ['metal-plus', 2], ['metal-l', 3], ['wood-cube', 6], ['wood-short', 4], ['crate', 2]],
  },
  {
    id: 7, name: 'Dual Gravity Zones', icon: '🪐', time: 210, height: 11, powerups: true,
    blurb: 'Normal gravity on the left, floaty low gravity on the right. Pieces behave differently on each side.',
    mods: { gravity: { right: 0.35 } },
    pool: [['metal-girder', 3], ['metal-plus', 2], ['stone-hex', 4], ['stone-pyramid', 2], ['foam-star', 3], ['foam-cube', 4], ['wood-tall', 2], ['gold-spire', 1]],
  },
  {
    id: 8, name: 'Moving Target Line', icon: '🎯', time: 210, height: 10.5, powerups: true,
    blurb: 'The finish line drifts up and down. Build above the top of its swing (the shaded band) to win early, or just be over the line when the time runs out.',
    mods: { moveLine: { amp: 1.2, period: 22 } },
    pool: [['wood-tall', 3], ['stone-tall', 2], ['wood-post', 4], ['stone-post', 3], ['wood-cube', 6], ['crate', 2], ['gold-spire', 2]],
  },
  {
    id: 9, name: 'Unstable Claws', icon: '⚠️', time: 210, height: 11, powerups: true,
    blurb: 'Claws slip and ropes stretch at random, and glass shatters if it hits too hard. Call out your moves!',
    mods: { unstable: { min: 6, max: 13, drop: 0.15 }, fragile: true },
    pool: [['glass-hex', 4], ['glass-cube', 4], ['glass-plank', 3], ['rubber-cube', 4], ['wood-stairs', 2], ['metal-t', 2], ['stone-slab', 2]],
  },
  {
    id: 10, name: 'Final Challenge', icon: '🏆', time: 140, height: 12, powerups: true,
    blurb: 'Wind, a rocking base, magnets and rising lava, all at once, with the least time of all. Good luck!',
    mods: { wind: { max: 1.4 }, tilt: { amp: 4, period: 22 }, magnets: true, lava: { rise: 0.85 } },
    pool: [['magn-cube', 3], ['mags-cube', 3], ['stone-pyramid', 2], ['stone-slab', 2], ['metal-plus', 2], ['metal-cup', 2], ['stone-tall', 2], ['wood-cube', 6]],
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
    // a random handful of every kind of piece the levels use
    pool: (() => {
      const all = ['wood-cube', 'stone-cube', 'stone-slab', 'wood-short', 'wood-plank', 'metal-l', 'wood-post', 'stone-pyramid', 'wood-cup', 'metal-cup',
        'wood-stairs', 'stone-plus', 'metal-plus', 'wood-tall', 'stone-tall', 'wood-raft', 'wood-hex', 'stone-hex', 'crate', 'metal-girder', 'stone-arch', 'metal-t'];
      const pick = [];
      while (pick.length < 7) { const id = all[Math.floor(random() * all.length)]; if (!pick.includes(id)) pick.push(id); }
      const pool = pick.map((id, i) => [id, i < 2 ? 6 : 3]);
      if (mods.magnets) pool.push(['magn-cube', 3], ['mags-cube', 3]);
      if (mods.lava) pool.unshift(['stone-cube', 6], ['stone-post', 3]);
      const merged = new Map();
      for (const [id, n] of pool) merged.set(id, (merged.get(id) || 0) + n);
      return [...merged];
    })(),
  };
}
