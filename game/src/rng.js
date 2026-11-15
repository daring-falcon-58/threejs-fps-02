// One seeded RNG for everything the simulation randomises: bot decisions, spread,
// tracers, particles. Normal play seeds from the clock; ?shot=...&seed=N replays the
// same game, so screenshots are reproducible.
export const mulberry32 = (initial) => {
  let a = initial | 0;
  return () => {
    a = a | 0;
    a = a + 0x6d2b79f5 | 0;
    const t0 = Math.imul(a ^ (a >>> 15), 1 | a);
    const t1 = Math.imul(t0 ^ (t0 >>> 7), 61 | t0);
    const t = (t0 + t1) ^ t0;
    const u = (t ^ (t >>> 14)) >>> 0;
    return u / 4294967296;
  };
};

export const pick = (random, array) => {
  const i = Math.floor(random() * array.length);
  return array[i];
};

export const range = (random, min, max) => random() * (max - min) + min;
