export interface RandomSource {
  next: () => number;
  normal: () => number;
  integer: (minimum: number, maximum: number) => number;
  pick: <T>(items: readonly T[]) => T;
}

export function hash32(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRandomSource(seed: string): RandomSource {
  const next = mulberry32(hash32(seed));
  let spareNormal: number | null = null;

  const normal = (): number => {
    if (spareNormal !== null) {
      const value = spareNormal;
      spareNormal = null;
      return value;
    }
    const u1 = Math.max(next(), Number.EPSILON);
    const u2 = Math.max(next(), Number.EPSILON);
    const magnitude = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    spareNormal = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };

  return {
    next,
    normal,
    integer(minimum, maximum) {
      return Math.floor(next() * (maximum - minimum + 1)) + minimum;
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
  };
}

export function streamSeed(
  seed: string,
  marketId: string,
  stream: string,
  ...parts: Array<string | number>
): string {
  return [seed, marketId, stream, ...parts].join("|");
}

export function weightedPick<T>(
  random: RandomSource,
  items: Array<{ value: T; weight: number }>,
): T {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  let threshold = random.next() * total;
  for (const item of items) {
    threshold -= Math.max(0, item.weight);
    if (threshold <= 0) return item.value;
  }
  return items[items.length - 1].value;
}
