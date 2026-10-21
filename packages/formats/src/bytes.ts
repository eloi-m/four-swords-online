export function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function ascii(bytes: Uint8Array, offset: number, maxLength = Infinity): string {
  let s = "";
  for (let i = offset; i < offset + maxLength && i < bytes.length && bytes[i] !== 0; i++) {
    s += String.fromCharCode(bytes[i]!);
  }
  return s;
}

export function magic(bytes: Uint8Array, length = 4): string {
  return ascii(bytes, 0, length);
}
