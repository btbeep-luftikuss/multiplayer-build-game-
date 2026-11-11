// Levels mode: twenty handcrafted challenges, and an endless remix (open once Level 10 is beaten). Each level sets its time limit, how
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
  ice: { icon: '❄️', label: 'Slippery ice' },
  hill: { icon: '⛰️', label: 'Sloping ground' },
  conveyor: { icon: '🏭', label: 'Conveyor belt' },
  quake: { icon: '🫨', label: 'Earthquakes' },
  twin: { icon: '🏙️', label: 'Two towers' },
  meteors: { icon: '☄️', label: 'Meteor shower' },
  bridge: { icon: '🌉', label: 'Build over the chasm' },
  dark: { icon: '🌙', label: 'Lights out' },
  mixup: { icon: '🔀', label: 'Mixed-up controls' },
};

// the Endless Remix opens once this level is beaten
export const REMIX_AFTER = 10;

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
  {
    id: 11, name: 'Frozen Lake', icon: '❄️', time: 240, height: 9.5, powerups: true,
    blurb: 'Everything is slippery on the ice! Pink rubber stays grippy, and cups and stairs hold what sits in them.',
    mods: { ice: { grip: 0.3 } },
    pool: [['ice-cube', 5], ['ice-post', 2], ['rubber-mat', 3], ['rubber-cube', 4], ['wood-cup', 3], ['metal-cup', 2], ['clay-stairs', 2], ['crate', 2]],
  },
  {
    id: 12, name: 'Hillside', icon: '⛰️', time: 240, height: 10, powerups: true,
    blurb: 'The ground slopes uphill to the right. Levellers (their bottoms are sloped to match) give the tower a flat start.',
    mods: { hill: { slope: 0.18 } },
    pool: [['wood-shim', 3], ['stone-shim', 2], ['stone-big', 2], ['stone-cube', 5], ['wood-short', 3], ['clay-brick', 5], ['metal-l', 2], ['wood-stairs', 2]],
  },
  {
    id: 13, name: 'Conveyor Belt', icon: '🏭', time: 240, height: 10, powerups: true,
    blurb: 'The build pad is a conveyor belt that runs one way, slows, and runs back. Chase the tower, and keep it off the ends!',
    mods: { conveyor: { speed: 0.8, period: 18 } },
    pool: [['crate', 3], ['metal-crate', 2], ['wood-barrel', 4], ['wood-pallet', 3], ['metal-girder', 2], ['metal-l', 2], ['wood-cube', 5]],
  },
  {
    id: 14, name: 'Earthquake', icon: '🫨', time: 240, height: 10.5, powerups: true,
    blurb: 'Every so often the ground shakes (you\'ll get a warning). Wide, heavy, well-stacked towers ride it out.',
    mods: { quake: { every: 22, len: 4, amp: 0.12, hz: 1.6, ay: 0.02 } },
    pool: [['stone-big', 3], ['clay-big', 3], ['stone-pyramid', 2], ['clay-brick', 6], ['clay-arch', 2], ['wood-raft', 2], ['stone-cube', 4]],
  },
  {
    id: 15, name: 'Twin Towers', icon: '🏙️', time: 270, height: 8, powerups: true,
    blurb: 'Two rooftops, two towers: BOTH have to reach the line. Split the team, and don\'t let one side fall behind.',
    mods: { twin: { gap: 3 } },
    pool: [['wood-tall', 2], ['stone-tall', 2], ['glass-cube', 4], ['metal-beam', 3], ['clay-brick', 6], ['crate', 2], ['metal-t', 2], ['wood-cube', 5]],
  },
  {
    id: 16, name: 'Meteor Shower', icon: '☄️', time: 210, height: 11, powerups: true,
    blurb: 'Fireballs fall where the red target shows: they burn wood and knock things. Hold your claw over the target to block one!',
    mods: { meteors: { min: 8, max: 12 } },
    pool: [['metal-roof', 3], ['stone-cube', 6], ['stone-hex', 3], ['metal-cup', 2], ['wood-cube', 6], ['wood-short', 4], ['crate', 2], ['stone-slab', 2]],
  },
  {
    id: 17, name: 'Bridge the Gap', icon: '🌉', time: 240, height: 8.5, powerups: true,
    blurb: 'Two cliffs and a bottomless chasm. Only what\'s built OVER the gap counts: bridge it, then build up from the middle.',
    mods: { bridge: { gap: 3 } },
    pool: [['metal-bridge', 2], ['wood-bridge', 2], ['metal-girder', 2], ['stone-arch', 2], ['wood-cube', 6], ['stone-cube', 4], ['wood-post', 3], ['wood-plank', 3]],
  },
  {
    id: 18, name: 'Lights Out', icon: '🌙', time: 210, height: 11, powerups: true,
    blurb: 'Night falls: your claw carries a lamp, glow blocks light up the tower, and lightning flashes now and then. Shout what you can see!',
    mods: { dark: true },
    pool: [['glow-cube', 4], ['glow-bar', 3], ['glow-hex', 3], ['wood-cube', 5], ['stone-cube', 4], ['stone-slab', 2], ['candy-post', 3], ['crate', 2]],
  },
  {
    id: 19, name: 'Mixed-Up Claws', icon: '🔀', time: 200, height: 11.5, powerups: true,
    blurb: 'Every few seconds someone\'s controls flip (left is right, and sometimes up is down) for a while. Your phone tells you when!',
    mods: { mixup: { min: 9, max: 15, len: 9 } },
    pool: [['candy-cube', 5], ['candy-beam', 3], ['candy-post', 3], ['candy-roof', 2], ['rubber-cube', 3], ['wood-hex', 3], ['wood-cup', 2], ['foam-star', 2]],
  },
  {
    id: 20, name: 'Grand Finale', icon: '👑', time: 210, height: 12, powerups: true,
    blurb: 'Night, earthquakes, a meteor shower and mixed-up controls, all at once. The ultimate test of teamwork!',
    mods: { dark: true, quake: { every: 26, len: 3.5, amp: 0.1, hz: 1.6, ay: 0.02 }, meteors: { min: 10, max: 15 }, mixup: { min: 14, max: 22, len: 8 } },
    pool: [['stone-big', 3], ['metal-roof', 2], ['glow-cube', 3], ['glow-bar', 2], ['stone-cube', 5], ['clay-brick', 5], ['metal-crate', 2], ['stone-tall', 2]],
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

// one remix round: two or three mechanics from the levels, a pool of everything. Some mechanics change
// the build pad itself (`pad`), so a mix has at most one of those.
const REMIX_MODS = [
  { make: () => ({ wind: { max: 1.6 } }) },
  { pad: true, make: () => ({ soft: true }) },
  { pad: true, make: () => ({ tilt: { amp: 5, period: 20 } }) },
  { make: () => ({ magnets: true }) },
  { make: () => ({ lava: { rise: 0.85 } }) },
  { make: () => ({ gravity: { right: 0.35 } }) },
  { make: () => ({ moveLine: { amp: 1, period: 22 } }) },
  { make: () => ({ unstable: { min: 7, max: 14, drop: 0.1 }, fragile: true }) },
  { make: () => ({ ice: { grip: 0.4 } }) },
  { make: () => ({ conveyor: { speed: 0.6, period: 18 } }) },
  { pad: true, make: () => ({ quake: { every: 24, len: 3.5, amp: 0.1, hz: 1.6, ay: 0.02 } }) },
  { make: () => ({ meteors: { min: 10, max: 15 } }) },
  { make: () => ({ dark: true }) },
  { make: () => ({ mixup: { min: 12, max: 20, len: 8 } }) },
];
export function remixLevel(wins, random = Math.random) {
  const picks = new Set();
  const n = 2 + (random() < 0.4 ? 1 : 0);
  let guard = 0;
  while (picks.size < n && guard++ < 200) {
    const i = Math.floor(random() * REMIX_MODS.length);
    if (REMIX_MODS[i].pad && [...picks].some((j) => REMIX_MODS[j].pad)) continue;
    picks.add(i);
  }
  const mods = {};
  for (const i of picks) Object.assign(mods, REMIX_MODS[i].make());
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
      if (mods.ice) pool.push(['rubber-cube', 3], ['wood-cup', 2]);
      if (mods.meteors) pool.push(['metal-roof', 2]);
      if (mods.dark) pool.push(['glow-cube', 3]);
      const merged = new Map();
      for (const [id, n] of pool) merged.set(id, (merged.get(id) || 0) + n);
      return [...merged];
    })(),
  };
}
