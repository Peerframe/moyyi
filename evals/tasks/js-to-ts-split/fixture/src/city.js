// Code-city generator: geometry helpers, buildings and the street layout, all in one file.

export const ROAD_EVERY = 4;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

export function distance(p, q) {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

// Deterministic pseudo-random height in [2, 30] for a block.
export function buildingHeight(seed, row, col) {
  const n = Math.sin(seed * 12.9898 + row * 78.233 + col * 37.719) * 43758.5453;
  return Math.round(lerp(2, 30, n - Math.floor(n)));
}

export function makeBlock(row, col, seed) {
  const height = buildingHeight(seed, row, col);
  const kind = height > 22 ? "tower" : height > 10 ? "office" : "house";
  return { row, col, height, kind };
}

export function layoutCity(rows, cols, seed) {
  const blocks = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (row % ROAD_EVERY === ROAD_EVERY - 1 || col % ROAD_EVERY === ROAD_EVERY - 1) continue;
      blocks.push(makeBlock(row, col, seed));
    }
  }
  return blocks;
}

export function summarize(blocks) {
  const counts = { tower: 0, office: 0, house: 0 };
  let maxHeight = 0;
  for (const block of blocks) {
    counts[block.kind] += 1;
    maxHeight = Math.max(maxHeight, block.height);
  }
  return { total: blocks.length, counts, maxHeight };
}
