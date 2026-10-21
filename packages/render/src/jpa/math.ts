// Small vector and matrix helpers for the JPA simulation: vec3 = Float64Array(3), mat4 = Float64Array(16) column-major
// (gl-matrix's layout, which the JPA port below follows). Plain functions, no allocation in the hot paths.
export type V3 = Float64Array;
export type M4 = Float64Array;

export const v3 = (x = 0, y = 0, z = 0): V3 => Float64Array.of(x, y, z);
export const m4 = (): M4 => m4identity(new Float64Array(16));

export function v3set(out: V3, x: number, y: number, z: number): V3 {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function v3copy(out: V3, a: ArrayLike<number>): V3 {
  out[0] = a[0]!;
  out[1] = a[1]!;
  out[2] = a[2]!;
  return out;
}

export const v3len = (a: V3): number => Math.hypot(a[0]!, a[1]!, a[2]!);
export const v3sqLen = (a: V3): number => a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!;
export const v3dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

export function v3scale(out: V3, a: V3, s: number): V3 {
  out[0] = a[0]! * s;
  out[1] = a[1]! * s;
  out[2] = a[2]! * s;
  return out;
}

/** out = a + b × s */
export function v3scaleAndAdd(out: V3, a: V3, b: ArrayLike<number>, s: number): V3 {
  out[0] = a[0]! + b[0]! * s;
  out[1] = a[1]! + b[1]! * s;
  out[2] = a[2]! + b[2]! * s;
  return out;
}

export function v3add(out: V3, a: V3, b: V3): V3 {
  out[0] = a[0]! + b[0]!;
  out[1] = a[1]! + b[1]!;
  out[2] = a[2]! + b[2]!;
  return out;
}

export function v3sub(out: V3, a: ArrayLike<number>, b: ArrayLike<number>): V3 {
  out[0] = a[0]! - b[0]!;
  out[1] = a[1]! - b[1]!;
  out[2] = a[2]! - b[2]!;
  return out;
}

export function v3mul(out: V3, a: V3, b: ArrayLike<number>): V3 {
  out[0] = a[0]! * b[0]!;
  out[1] = a[1]! * b[1]!;
  out[2] = a[2]! * b[2]!;
  return out;
}

export function v3cross(out: V3, a: ArrayLike<number>, b: ArrayLike<number>): V3 {
  const ax = a[0]!, ay = a[1]!, az = a[2]!, bx = b[0]!, by = b[1]!, bz = b[2]!;
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

export function v3normalize(out: V3, a: V3): V3 {
  const l = v3len(a);
  return l > 0 ? v3scale(out, a, 1 / l) : v3set(out, 0, 0, 0);
}

/** Scales `v` to length `len` (unchanged if zero). */
export function normToLength(v: V3, len: number): void {
  const l = v3len(v);
  if (l > 0) v3scale(v, v, len / l);
}

/** out += a scaled to length `len`. */
export function normToLengthAndAdd(out: V3, a: V3, len: number): void {
  const l = v3len(a);
  if (l > 0) v3scaleAndAdd(out, out, a, len / l);
}

export const isNearZeroV3 = (a: V3, e: number): boolean => Math.abs(a[0]!) < e && Math.abs(a[1]!) < e && Math.abs(a[2]!) < e;

export function m4identity(out: M4): M4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function m4copy(out: M4, a: ArrayLike<number>): M4 {
  for (let i = 0; i < 16; i++) out[i] = a[i]!;
  return out;
}

/** out = a × b */
export function m4mul(out: M4, a: M4, b: M4): M4 {
  const r = scratchMul;
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4]!, b1 = b[c * 4 + 1]!, b2 = b[c * 4 + 2]!, b3 = b[c * 4 + 3]!;
    for (let i = 0; i < 4; i++) r[c * 4 + i] = a[i]! * b0 + a[4 + i]! * b1 + a[8 + i]! * b2 + a[12 + i]! * b3;
  }
  return m4copy(out, r);
}
const scratchMul = new Float64Array(16);

export function m4fromScaling(out: M4, s: ArrayLike<number>): M4 {
  m4identity(out);
  out[0] = s[0]!;
  out[5] = s[1]!;
  out[10] = s[2]!;
  return out;
}

/** out = a × (rotation by `rad` about `axis`, normalized). */
export function m4rotate(out: M4, a: M4, rad: number, axis: V3): M4 {
  let x = axis[0]!, y = axis[1]!, z = axis[2]!;
  const l = Math.hypot(x, y, z);
  if (l < 1e-6) return m4copy(out, a);
  x /= l;
  y /= l;
  z /= l;
  const s = Math.sin(rad), c = Math.cos(rad), t = 1 - c;
  const r = scratchRot;
  m4identity(r);
  r[0] = x * x * t + c;
  r[1] = y * x * t + z * s;
  r[2] = z * x * t - y * s;
  r[4] = x * y * t - z * s;
  r[5] = y * y * t + c;
  r[6] = z * y * t + x * s;
  r[8] = x * z * t + y * s;
  r[9] = y * z * t - x * s;
  r[10] = z * z * t + c;
  return m4mul(out, a, r);
}
const scratchRot = new Float64Array(16);

/** Rotation applying X, then Y, then Z (JSystem's order). */
export function computeModelMatrixR(out: M4, rx: number, ry: number, rz: number): M4 {
  return computeModelMatrixSRT(out, 1, 1, 1, rx, ry, rz, 0, 0, 0);
}

export function computeModelMatrixSRT(out: M4, sx: number, sy: number, sz: number, rx: number, ry: number, rz: number, tx: number, ty: number, tz: number): M4 {
  const sinX = Math.sin(rx), cosX = Math.cos(rx), sinY = Math.sin(ry), cosY = Math.cos(ry), sinZ = Math.sin(rz), cosZ = Math.cos(rz);
  out[0] = sx * (cosY * cosZ);
  out[1] = sx * (sinZ * cosY);
  out[2] = sx * -sinY;
  out[3] = 0;
  out[4] = sy * (sinX * cosZ * sinY - cosX * sinZ);
  out[5] = sy * (sinX * sinZ * sinY + cosX * cosZ);
  out[6] = sy * (sinX * cosY);
  out[7] = 0;
  out[8] = sz * (cosX * cosZ * sinY + sinX * sinZ);
  out[9] = sz * (cosX * sinZ * sinY - sinX * cosZ);
  out[10] = sz * (cosY * cosX);
  out[11] = 0;
  out[12] = tx;
  out[13] = ty;
  out[14] = tz;
  out[15] = 1;
  return out;
}

/** out = m × (v, 0): a direction. */
export function transformW0(out: V3, m: M4, v: ArrayLike<number>): V3 {
  const x = v[0]!, y = v[1]!, z = v[2]!;
  out[0] = m[0]! * x + m[4]! * y + m[8]! * z;
  out[1] = m[1]! * x + m[5]! * y + m[9]! * z;
  out[2] = m[2]! * x + m[6]! * y + m[10]! * z;
  return out;
}

/** out = m × (v, 1): a point. */
export function transformW1(out: V3, m: M4, v: ArrayLike<number>): V3 {
  const x = v[0]!, y = v[1]!, z = v[2]!;
  out[0] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  out[1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  out[2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  return out;
}

/** Sets columns 0–2 of `m` (its axes), leaving the translation. */
export function setMatrixAxis(m: M4, x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>): void {
  for (let i = 0; i < 3; i++) {
    m[i] = x[i]!;
    m[4 + i] = y[i]!;
    m[8 + i] = z[i]!;
  }
}

/** Cubic Hermite between (p0, s0) and (p1, s1) at t in 0–1. */
export function hermite(p0: number, p1: number, s0: number, s1: number, t: number): number {
  const a = 2 * p0 - 2 * p1 + s0 + s1, b = -3 * p0 + 3 * p1 - 2 * s0 - s1;
  return ((a * t + b) * t + s0) * t + p0;
}
