// A game state as bytes, for the snapshot a rejoining player loads (docs/netcode.md "Rejoining"). Generic over plain
// data, like the sim's hashState: objects (keys in their order), arrays, typed arrays, Maps, strings, booleans, null
// and undefined, and numbers exactly (integers as zigzag varints, -0, NaN and fractions as float64 bits), so a decoded
// state steps and hashes like the original. Shared references come back as copies (states are trees).

const Tag = {
  undefined: 0,
  null: 1,
  false: 2,
  true: 3,
  int: 4,
  float: 5,
  string: 6,
  array: 7,
  object: 8,
  typed: 9,
  map: 10,
  negZero: 11,
  bigint: 12,
} as const;

/** Typed array kinds, by tag. */
const TYPED = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array] as const;
type Typed = InstanceType<(typeof TYPED)[number]>;

class Out {
  buf = new Uint8Array(4096);
  view = new DataView(this.buf.buffer);
  length = 0;
  ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v;
  }
  /** Unsigned varint (up to 2^53). */
  uvar(v: number): void {
    while (v >= 0x80) {
      this.u8((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.u8(v);
  }
  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.length, v);
    this.length += 8;
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
}

const utf8 = new TextEncoder(), fromUtf8 = new TextDecoder();

function write(out: Out, v: unknown): void {
  switch (typeof v) {
    case "undefined":
      return out.u8(Tag.undefined);
    case "boolean":
      return out.u8(v ? Tag.true : Tag.false);
    case "number":
      if (Object.is(v, -0)) return out.u8(Tag.negZero);
      if (Number.isSafeInteger(v)) {
        out.u8(Tag.int);
        return out.uvar(v < 0 ? -v * 2 - 1 : v * 2);
      }
      out.u8(Tag.float);
      return out.f64(v);
    case "string": {
      const b = utf8.encode(v);
      out.u8(Tag.string);
      out.uvar(b.length);
      return out.bytes(b);
    }
    case "bigint": {
      const b = utf8.encode(v.toString());
      out.u8(Tag.bigint);
      out.uvar(b.length);
      return out.bytes(b);
    }
    case "object": {
      if (v === null) return out.u8(Tag.null);
      if (Array.isArray(v)) {
        out.u8(Tag.array);
        out.uvar(v.length);
        for (let i = 0; i < v.length; i++) write(out, v[i]);
        return;
      }
      if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
        const kind = TYPED.findIndex((T) => v instanceof T);
        if (kind < 0) throw new Error("cannot encode this typed array");
        const t = v as Typed;
        out.u8(Tag.typed);
        out.u8(kind);
        out.uvar(t.length);
        // Big-endian element by element (a DataView), whatever the machine's byte order.
        const size = t.BYTES_PER_ELEMENT;
        out.ensure(t.length * size);
        const w = out.view;
        for (let i = 0; i < t.length; i++, out.length += size) {
          const x = t[i]!;
          if (t instanceof Float64Array) w.setFloat64(out.length, x as number);
          else if (t instanceof Float32Array) w.setFloat32(out.length, x as number);
          else if (t instanceof BigInt64Array) w.setBigInt64(out.length, x as bigint);
          else if (t instanceof BigUint64Array) w.setBigUint64(out.length, x as bigint);
          else if (size === 4) w.setUint32(out.length, (x as number) >>> 0);
          else if (size === 2) w.setUint16(out.length, (x as number) & 0xffff);
          else w.setUint8(out.length, (x as number) & 0xff);
        }
        return;
      }
      if (v instanceof Map) {
        out.u8(Tag.map);
        out.uvar(v.size);
        for (const [key, item] of v) {
          write(out, key);
          write(out, item);
        }
        return;
      }
      const proto = Object.getPrototypeOf(v) as unknown;
      if (proto !== Object.prototype && proto !== null) throw new Error(`cannot encode a ${(v as object).constructor?.name ?? "class instance"} (game state must be plain data)`);
      const keys = Object.keys(v);
      out.u8(Tag.object);
      out.uvar(keys.length);
      for (const key of keys) {
        write(out, key);
        write(out, (v as Record<string, unknown>)[key]);
      }
      return;
    }
    default:
      throw new Error(`cannot encode a ${typeof v} (game state must be plain data)`);
  }
}

class In {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  pos = 0;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number): void {
    if (this.pos + n > this.bytes.length) throw new Error("truncated state");
  }
  u8(): number {
    this.need(1);
    return this.bytes[this.pos++]!;
  }
  uvar(): number {
    let v = 0, scale = 1;
    for (;;) {
      const b = this.u8();
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 0x80;
      if (scale > 2 ** 56) throw new Error("bad varint");
    }
  }
  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos);
    this.pos += 8;
    return v;
  }
  text(): string {
    const n = this.uvar();
    this.need(n);
    const s = fromUtf8.decode(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
}

function read(r: In, depth: number): unknown {
  if (depth > 64) throw new Error("state nested too deep");
  const tag = r.u8();
  switch (tag) {
    case Tag.undefined:
      return undefined;
    case Tag.null:
      return null;
    case Tag.false:
      return false;
    case Tag.true:
      return true;
    case Tag.negZero:
      return -0;
    case Tag.int: {
      const z = r.uvar();
      return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
    }
    case Tag.float:
      return r.f64();
    case Tag.string:
      return r.text();
    case Tag.bigint:
      return BigInt(r.text());
    case Tag.array: {
      const n = r.uvar();
      r.need(n); // (at least a byte per item)
      const a = new Array<unknown>(n);
      for (let i = 0; i < n; i++) a[i] = read(r, depth + 1);
      return a;
    }
    case Tag.object: {
      const n = r.uvar();
      r.need(n);
      const o: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        const key = read(r, depth + 1);
        if (typeof key !== "string") throw new Error("bad object key");
        o[key] = read(r, depth + 1);
      }
      return o;
    }
    case Tag.map: {
      const n = r.uvar();
      r.need(n);
      const m = new Map<unknown, unknown>();
      for (let i = 0; i < n; i++) {
        const key = read(r, depth + 1);
        m.set(key, read(r, depth + 1));
      }
      return m;
    }
    case Tag.typed: {
      const T = TYPED[r.u8()];
      if (!T) throw new Error("bad typed array kind");
      const n = r.uvar(), size = T.BYTES_PER_ELEMENT;
      r.need(n * size);
      const t = new T(n) as Typed, v = r.view;
      for (let i = 0; i < n; i++, r.pos += size) {
        if (t instanceof Float64Array) t[i] = v.getFloat64(r.pos);
        else if (t instanceof Float32Array) t[i] = v.getFloat32(r.pos);
        else if (t instanceof BigInt64Array) t[i] = v.getBigInt64(r.pos);
        else if (t instanceof BigUint64Array) t[i] = v.getBigUint64(r.pos);
        else if (size === 4) (t as Int32Array)[i] = v.getUint32(r.pos);
        else if (size === 2) (t as Int16Array)[i] = v.getUint16(r.pos);
        else (t as Uint8Array)[i] = v.getUint8(r.pos);
      }
      return t;
    }
    default:
      throw new Error(`bad state tag ${tag}`);
  }
}

/** Plain data (a game state) as bytes; throws on functions, symbols and class instances. */
export function encodeState(value: unknown): Uint8Array {
  const out = new Out();
  write(out, value);
  return out.buf.slice(0, out.length);
}

/** The value encodeState encoded; throws on anything malformed. */
export function decodeState(bytes: Uint8Array): unknown {
  const r = new In(bytes);
  const value = read(r, 0);
  if (r.pos !== bytes.length) throw new Error("trailing bytes after the state");
  return value;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
