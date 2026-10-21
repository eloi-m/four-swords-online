// Minimal RIFF/WAVE writer: 16-bit little-endian PCM, interleaved channels. Used by the CLI dumps and offline renders.

/** Encodes one or more equal-length channels. Float input is clamped to [-1, 1]. */
export function encodeWav(channels: readonly (Int16Array | Float32Array)[], sampleRate: number): Uint8Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * count * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i);
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, count, true);
  v.setUint32(24, Math.round(sampleRate), true);
  v.setUint32(28, Math.round(sampleRate) * count * 2, true);
  v.setUint16(32, count * 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      let s = ch[i] ?? 0;
      if (ch instanceof Float32Array) s = Math.round(Math.max(-1, Math.min(1, s)) * 32767);
      v.setInt16(o, s, true);
      o += 2;
    }
  }
  return out;
}
