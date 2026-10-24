// Returns the integers from start to end, inclusive. range(1, 3) -> [1, 2, 3]
export function range(start, end) {
  const out = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}
