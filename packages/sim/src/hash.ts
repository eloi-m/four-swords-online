// Stable 32-bit hash of the simulation state, exchanged by the netcode to detect desyncs. It walks the serializable
// state generically (object keys sorted, type-tagged values; murmur3 mixing), so it covers every field GameState
// grows without having to be kept in step with it.
import type { GameState } from "./game.ts";

const f64 = new DataView(new ArrayBuffer(8));

class Hasher {
  h = 0x9747b28c;
  word(v: number): void {
    let k = Math.imul(v | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    this.h ^= k;
    this.h = (this.h << 13) | (this.h >>> 19);
    this.h = (Math.imul(this.h, 5) + 0xe6546b64) | 0;
  }
  string(s: string): void {
    this.word(s.length);
    for (let i = 0; i < s.length; i += 2) this.word(s.charCodeAt(i) | (i + 1 < s.length ? s.charCodeAt(i + 1) << 16 : 0));
  }
  number(v: number): void {
    if (Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) {
      this.word(4);
      this.word(v);
    } else {
      this.word(5);
      f64.setFloat64(0, Number.isNaN(v) ? NaN : v);
      this.word(f64.getInt32(0));
      this.word(f64.getInt32(4));
    }
  }
  value(v: unknown): void {
    switch (typeof v) {
      case "undefined":
        return this.word(0);
      case "boolean":
        return this.word(v ? 3 : 2);
      case "number":
        return this.number(v);
      case "string":
        this.word(6);
        return this.string(v);
      case "bigint":
        this.word(11);
        return this.string(v.toString());
      case "object":
        if (v === null) return this.word(1);
        if (Array.isArray(v)) {
          this.word(7);
          this.word(v.length);
          for (const item of v) this.value(item);
          return;
        }
        if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
          const items = v as unknown as ArrayLike<number | bigint>;
          this.word(8);
          this.word(items.length);
          for (let i = 0; i < items.length; i++) this.value(items[i]);
          return;
        }
        if (v instanceof Map) {
          this.word(10);
          this.word(v.size);
          for (const [key, item] of v) {
            this.value(key);
            this.value(item);
          }
          return;
        }
        {
          // Plain object: keys sorted; undefined-valued keys skipped (as JSON does).
          const record = v as Record<string, unknown>;
          const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
          this.word(9);
          this.word(keys.length);
          for (const key of keys) {
            this.string(key);
            this.value(record[key]);
          }
        }
        return;
      default:
        throw new Error(`cannot hash a ${typeof v} (game state must be serializable)`);
    }
  }
  digest(): number {
    let h = this.h;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
}

/** Hash of any serializable value (plain objects, arrays, typed arrays, Maps, numbers, strings, booleans). */
export function hashState(value: unknown): number {
  const hasher = new Hasher();
  hasher.value(value);
  return hasher.digest();
}

/** Hash of the whole game state: equal on every machine for equal states. */
export function hashGame(state: GameState): number {
  return hashState(state);
}
