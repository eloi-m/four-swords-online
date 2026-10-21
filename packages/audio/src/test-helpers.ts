// Big-endian byte builder for synthetic test files.
export class Bytes {
  private readonly data: number[] = [];

  get length(): number {
    return this.data.length;
  }

  u8(...values: number[]): this {
    for (const v of values) this.data.push(v & 0xff);
    return this;
  }

  u16(...values: number[]): this {
    for (const v of values) this.u8(v >> 8, v);
    return this;
  }

  u24(...values: number[]): this {
    for (const v of values) this.u8(v >> 16, v >> 8, v);
    return this;
  }

  u32(...values: number[]): this {
    for (const v of values) this.u8(v >>> 24, v >>> 16, v >>> 8, v);
    return this;
  }

  f32(...values: number[]): this {
    const b = new DataView(new ArrayBuffer(4));
    for (const v of values) {
      b.setFloat32(0, v);
      this.u8(b.getUint8(0), b.getUint8(1), b.getUint8(2), b.getUint8(3));
    }
    return this;
  }

  text(s: string, length = s.length): this {
    for (let i = 0; i < length; i++) this.u8(i < s.length ? s.charCodeAt(i) : 0);
    return this;
  }

  pad(to: number): this {
    while (this.data.length < to) this.data.push(0);
    return this;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.data);
  }
}
