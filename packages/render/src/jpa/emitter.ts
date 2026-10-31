// JPA particle simulation: an emitter and its particles, stepped once per 60 Hz frame (a fixed 1-frame step; nothing
// here reads a clock or uses three.js), plus each particle's draw matrix in view space.
//
// Ported from noclip.website's src/Common/JSYSTEM/JPA.ts (MIT License, Copyright (c) 2017 Jasper St. Pierre,
// https://github.com/magcius/noclip.website): JPABaseEmitter and JPABaseParticle (emission volumes, initial
// velocities, fields, key curves, child particles, scale / alpha / rotation / color / texture animation) and the
// per-shape matrices of its drawCommon / drawStripe. Adapted: plain arrays instead of gl-matrix, one random generator
// per emitter seeded by the caller (the same seed replays the same particles: presentation can be rebuilt after a
// netcode rollback), the drag field's random from the emitter too, no draw lists (draw.ts reads the particles).
import {
  JpaCalcIdx,
  JpaDir,
  JpaEmitFlag,
  JpaField,
  JpaFieldAdd,
  JpaFieldFlag,
  JpaKeyType,
  JpaPlane,
  JpaRot,
  JpaScaleAnm,
  JpaShape,
  JpaVolume,
  type JpaBaseShape,
  type JpaChildShape,
  type JpaColor,
  type JpaExtraShape,
  type JpaFieldBlock,
  type JpaKeyBlock,
  type JpaResource,
} from "@fso/formats";
import {
  computeModelMatrixR,
  computeModelMatrixSRT,
  hermite,
  isNearZeroV3,
  m4,
  m4copy,
  m4fromScaling,
  m4identity,
  m4mul,
  m4rotate,
  normToLength,
  normToLengthAndAdd,
  setMatrixAxis,
  transformW0,
  transformW1,
  v3,
  v3add,
  v3copy,
  v3cross,
  v3dot,
  v3len,
  v3mul,
  v3normalize,
  v3scale,
  v3scaleAndAdd,
  v3set,
  v3sqLen,
  v3sub,
  type M4,
  type V3,
} from "./math.ts";

const TAU = Math.PI * 2;

const Status = {
  STOP_CREATE_PARTICLE: 0x01,
  STOP_CALC_EMITTER: 0x02,
  STOP_DRAW_PARTICLE: 0x04,
  TERMINATED: 0x08,
  FIRST_EMISSION: 0x10,
  RATE_STEP_EMIT: 0x20,
  IMMORTAL: 0x40,
} as const;

const ParticleStatus = { DELETE: 0x02, STOP_FIELD_FADE_AFFECT: 0x04, INVISIBLE: 0x08, FOLLOW_EMITTER: 0x20, STOP_FIELD_AFFECT: 0x40 } as const;

/** The numerical-recipes LCG JSystem uses. */
export class JpaRandom {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    return (this.state = (Math.imul(this.state, 0x19660d) + 0x3c6ef35f) >>> 0);
  }
  /** 0–1. */
  float(): number {
    return this.next() / 0xffffffff;
  }
  /** −1–1. */
  zp(): number {
    return this.float() * 2 - 1;
  }
  /** −0.5–0.5. */
  zh(): number {
    return this.float() - 0.5;
  }
}

/** Scratch state shared by the emitter being stepped or drawn (JPAEmitterWorkData). */
class WorkData {
  volumePos = v3();
  velOmni = v3();
  velAxis = v3();
  volumeSize = 0;
  volumeMinRad = 0;
  volumeSweep = 0;
  volumeEmitIdx = 0;
  volumeEmitCount = 0;
  volumeEmitAngleMax = 1;
  volumeEmitAngleCount = 0;
  volumeEmitXCount = 0;
  divNumber = 0;
  emitterTranslation = v3();
  emitterDirMtx = m4();
  emitterGlobalRotation = m4();
  emitterGlobalSR = m4();
  emitterGlobalScale = v3();
  emitterGlobalDir = v3();
  emitterGlobalCenterPos = v3();
  globalRotation = m4();
  globalDynamicsScale = v3();
  prevParticlePos = v3();
}
const W = new WorkData();
const sMtx = m4(), sA = v3(), sB = v3(), sC = v3(), sD = v3();

/** A key curve's value at `tick`: held before the first key and after the last, Hermite in between. */
export function keyValue(key: JpaKeyBlock, tick: number): number {
  const k = key.keyValues, last = k.length - 4;
  if (key.isLoopEnable && k[last]! > 0) tick %= k[last]!;
  if (tick < k[0]!) return k[1]!;
  if (tick >= k[last]!) return k[last + 1]!;
  let i1 = 4;
  while (k[i1]! <= tick) i1 += 4;
  const t0 = k[i1 - 4]!, t1 = k[i1]!, length = t1 - t0;
  return hermite(k[i1 - 3]!, k[i1 + 1]!, k[i1 - 1]! * length, k[i1 + 2]! * length, (tick - t0) / length);
}

function mirroredRepeat(t: number, duration: number): number {
  const loop = (t / duration) | 0, phase = t - loop * duration;
  return loop % 2 === 1 ? duration - phase : phase;
}

/** A texture animation's slot at `tick` (`time` = 0–1 of the life), the particle's random phase applied. */
function calcTexIdx(b: JpaBaseShape, tick: number, time: number, phase: number): number {
  const anim = b.texIdxAnimData!, n = anim.length;
  let i: number;
  switch (b.texCalcIdxType) {
    case JpaCalcIdx.NORMAL:
      i = Math.min(n - 1, tick | 0);
      break;
    case JpaCalcIdx.REPEAT:
      i = ((tick | 0) + phase) % n;
      break;
    case JpaCalcIdx.REVERSE:
      i = mirroredRepeat((tick | 0) + phase, n - 1);
      break;
    case JpaCalcIdx.MERGE:
      i = (((time * n) | 0) + phase) % n;
      break;
    default:
      i = phase % n;
  }
  return anim[i]!;
}

function calcColor(prm: JpaColor, env: JpaColor, b: JpaBaseShape, tick: number, time: number, phase: number): void {
  const max = b.colorAnimMaxFrame;
  let i: number;
  switch (b.colorCalcIdxType) {
    case JpaCalcIdx.NORMAL:
      i = Math.min(max, tick | 0);
      break;
    case JpaCalcIdx.REPEAT:
      i = ((tick | 0) + phase) % (max + 1);
      break;
    case JpaCalcIdx.REVERSE:
      i = mirroredRepeat((tick | 0) + phase, max);
      break;
    case JpaCalcIdx.MERGE:
      i = (((time * (max + 1)) | 0) + phase) % (max + 1);
      break;
    default:
      i = phase % (max + 1);
  }
  const p = b.colorPrmAnimData?.[i], e = b.colorEnvAnimData?.[i];
  if (p) for (let c = 0; c < 4; c++) prm[c] = p[c]!;
  if (e) for (let c = 0; c < 4; c++) env[c] = e[c]!;
}

/** JPAGetDirMtx: a rotation taking +Z to `v`. */
function dirMtx(m: M4, v: V3): void {
  v3set(sA, v[1]!, -v[0]!, 0);
  const mag = v3len(sA);
  v3normalize(sA, sA);
  const x = sA[0]!, y = sA[1]!, z = v[2]!;
  m4identity(m);
  m[0] = x * x + z * (1 - x * x);
  m[4] = (1 - z) * (x * y);
  m[8] = -y * mag;
  m[1] = (1 - z) * (x * y);
  m[5] = y * y + z * (1 - y * y);
  m[9] = x * mag;
  m[2] = y * mag;
  m[6] = -x * mag;
  m[10] = z;
}

export class JpaParticle {
  status = 0;
  time = 0;
  age = 0;
  position = v3();
  localPosition = v3();
  globalPosition = v3();
  velocity = v3();
  baseVel = v3();
  fieldAccel = v3();
  fieldVel = v3();
  axis = v3();
  accel = v3();
  particleScale = [1, 1];
  scaleOut = 1;
  alphaWaveRandom = 1;
  lifeTime = 0;
  rotateAngle = 0;
  rotateSpeed = 0;
  colorPrm: JpaColor = [1, 1, 1, 1];
  colorEnv: JpaColor = [1, 1, 1, 1];
  prmColorAlphaAnm = 1;
  anmRandom = 0;
  texAnmIdx = 0;
  moment = 1;
  drag = 1;
  dragFieldEffect = 1;
  airResist = 1;

  initBase(e: JpaEmitter): void {
    const d = e.res.dynamics, b = e.res.baseShape, x = e.res.extraShape, r = e.random;
    this.age = -1;
    this.status = 0;
    this.time = 0;
    this.lifeTime = e.lifeTime * (1 - r.float() * d.lifeTimeRandom);
    transformW0(this.localPosition, W.emitterGlobalSR, W.volumePos);
    if (d.flags & JpaEmitFlag.FOLLOW_EMITTER) this.status |= ParticleStatus.FOLLOW_EMITTER;
    v3copy(this.globalPosition, W.emitterGlobalCenterPos);
    for (let i = 0; i < 3; i++) this.position[i] = this.globalPosition[i]! + this.localPosition[i]! * W.globalDynamicsScale[i]!;
    v3set(this.baseVel, 0, 0, 0);
    if (e.awayFromCenterSpeed !== 0) normToLengthAndAdd(this.baseVel, W.velOmni, e.awayFromCenterSpeed);
    if (e.awayFromYAxisSpeed !== 0) normToLengthAndAdd(this.baseVel, W.velAxis, e.awayFromYAxisSpeed);
    if (e.directionalSpeed !== 0) {
      const randZ = r.next() >>> 16, randY = r.zp();
      computeModelMatrixR(sMtx, 0, e.spread * randY * Math.PI, (randZ / 0xffff) * Math.PI);
      m4mul(sMtx, W.emitterDirMtx, sMtx);
      this.baseVel[0]! += e.directionalSpeed * sMtx[8]!;
      this.baseVel[1]! += e.directionalSpeed * sMtx[9]!;
      this.baseVel[2]! += e.directionalSpeed * sMtx[10]!;
    }
    if (e.randomDirectionSpeed !== 0) {
      const rz = r.zh(), ry = r.zh(), rx = r.zh();
      this.baseVel[0]! += e.randomDirectionSpeed * rx;
      this.baseVel[1]! += e.randomDirectionSpeed * ry;
      this.baseVel[2]! += e.randomDirectionSpeed * rz;
    }
    v3scale(this.baseVel, this.baseVel, 1 + r.zp() * d.initialVelRatio);
    if (d.flags & JpaEmitFlag.INHERIT_SCALE) v3mul(this.baseVel, this.baseVel, e.localScale);
    transformW0(this.baseVel, W.emitterGlobalRotation, this.baseVel);
    // JPA 2 has no constant acceleration nor air resistance randomness, but their random draws remain.
    r.zp();
    v3set(this.accel, 0, 0, 0);
    v3set(this.fieldAccel, 0, 0, 0);
    this.drag = 1;
    r.zh();
    this.airResist = Math.min(d.airResist, 1);
    this.moment = e.moment * (1 - d.momentRandom * r.float());
    v3set(this.axis, W.emitterGlobalRotation[4]!, W.emitterGlobalRotation[5]!, W.emitterGlobalRotation[6]!);
    for (let c = 0; c < 4; c++) {
      this.colorPrm[c] = e.colorPrm[c]!;
      this.colorEnv[c] = e.colorEnv[c]!;
    }
    this.anmRandom = (r.float() * b.anmRandom) & 0xff;
    this.scaleOut = x?.isEnableScale ? e.scaleOut * (1 + x.scaleOutRandom * r.zp()) : e.scaleOut;
    this.particleScale[0] = this.particleScale[1] = this.scaleOut;
    this.prmColorAlphaAnm = 1;
    this.alphaWaveRandom = x?.isEnableAlpha ? 1 + r.zp() * x.alphaWaveRandom : 1;
    if (x?.isEnableRotate) {
      this.rotateAngle = x.rotateAngle + (r.float() - 0.5) * x.rotateAngleRandom;
      this.rotateSpeed = x.rotateSpeed * (1 + x.rotateSpeedRandom * r.zp());
      if (r.zp() >= x.rotateDirection) this.rotateSpeed *= -1;
    } else this.rotateAngle = this.rotateSpeed = 0;
    this.texAnmIdx = 0;
    for (let i = e.res.fields.length - 1; i >= 0; i--) {
      const f = e.res.fields[i]!;
      // JPA 2 has no drag randomness.
      if (f.type === JpaField.DRAG) this.dragFieldEffect = f.magnitude;
    }
  }

  initChild(e: JpaEmitter, parent: JpaParticle): void {
    const d = e.res.dynamics, c = e.res.childShape!, r = e.random;
    this.age = -1;
    this.time = 0;
    this.status = ParticleStatus.STOP_FIELD_FADE_AFFECT;
    this.lifeTime = c.life;
    v3copy(this.localPosition, parent.localPosition);
    if (c.posRandom !== 0) {
      v3set(sA, r.float() - 0.5, r.float() - 0.5, r.float() - 0.5);
      normToLengthAndAdd(this.localPosition, sA, r.float() * c.posRandom);
    }
    if (d.flags & JpaEmitFlag.FOLLOW_EMITTER_CHILD) this.status |= ParticleStatus.FOLLOW_EMITTER;
    v3copy(this.globalPosition, parent.globalPosition);
    const vel = c.baseVel * (1 + c.baseVelRandom * r.float());
    v3set(sA, r.float() - 0.5, r.float() - 0.5, r.float() - 0.5);
    normToLength(sA, vel);
    v3scaleAndAdd(this.baseVel, sA, parent.baseVel, c.velInfRate);
    v3scale(this.fieldAccel, parent.fieldVel, c.velInfRate);
    this.moment = parent.moment;
    if (c.isEnableField) this.drag = parent.drag;
    else {
      this.status |= ParticleStatus.STOP_FIELD_AFFECT;
      this.drag = 1;
    }
    v3copy(this.fieldVel, this.fieldAccel);
    v3add(this.velocity, this.baseVel, this.fieldVel);
    v3scale(this.velocity, this.velocity, this.moment * this.drag);
    v3copy(this.axis, parent.axis);
    if (c.isInheritedScale) {
      // On children these two fields hold the inherited X / Y scales.
      this.particleScale[0] = this.scaleOut = parent.particleScale[0]! * c.inheritScale;
      this.particleScale[1] = this.alphaWaveRandom = parent.particleScale[1]! * c.inheritScale;
    } else {
      this.particleScale[0] = this.particleScale[1] = 1;
      this.scaleOut = this.alphaWaveRandom = 1;
    }
    for (let k = 0; k < 3; k++) {
      this.colorPrm[k] = c.isInheritedRGB ? parent.colorPrm[k]! * c.inheritRGB : c.colorPrm[k]!;
      this.colorEnv[k] = c.isInheritedRGB ? parent.colorEnv[k]! * c.inheritRGB : c.colorEnv[k]!;
    }
    this.colorEnv[3] = c.colorEnv[3];
    this.prmColorAlphaAnm = 1;
    this.colorPrm[3] = c.isInheritedAlpha ? parent.colorPrm[3]! * parent.prmColorAlphaAnm * c.inheritAlpha : c.colorPrm[3];
    this.rotateAngle = parent.rotateAngle;
    this.rotateSpeed = c.isEnableRotate ? c.rotateSpeed : 0;
    this.texAnmIdx = 0;
  }

  private fieldFade(f: JpaFieldBlock, time: number): number {
    if ((f.statusFlags & JpaFieldFlag.FADE_USE_EN_TIME && time < f.enTime) || (f.statusFlags & JpaFieldFlag.FADE_USE_DIS_TIME && time >= f.disTime)) return 0;
    if (f.statusFlags & JpaFieldFlag.FADE_USE_FADE_IN && time < f.fadeIn) return (time - f.enTime) * f.fadeInRate;
    if (f.statusFlags & JpaFieldFlag.FADE_USE_FADE_OUT && time >= f.fadeOut) return (f.disTime - time) * f.fadeOutRate;
    return 1;
  }

  private fieldAffect(v: V3, f: JpaFieldBlock): void {
    if (!(this.status & ParticleStatus.STOP_FIELD_FADE_AFFECT) && f.statusFlags & JpaFieldFlag.FADE_MASK) v3scale(v, v, this.fieldFade(f, this.time));
    if (f.addType === JpaFieldAdd.FIELD_ACCEL) v3add(this.fieldAccel, this.fieldAccel, v);
    else if (f.addType === JpaFieldAdd.BASE_VELOCITY) v3add(this.baseVel, this.baseVel, v);
    else v3add(this.fieldVel, this.fieldVel, v);
  }

  private calcField(e: JpaEmitter): void {
    const fields = e.res.fields;
    for (let i = fields.length - 1; i >= 0; i--) {
      const f = fields[i]!;
      switch (f.type) {
        case JpaField.GRAVITY:
        case JpaField.AIR:
          v3scale(sA, v3copy(sA, f.direction), f.magnitude);
          if (!(f.statusFlags & JpaFieldFlag.LOCAL_SPACE)) transformW0(sA, W.globalRotation, sA);
          this.fieldAffect(sA, f);
          if (f.type === JpaField.AIR && f.statusFlags & JpaFieldFlag.AIR_DRAG && v3sqLen(this.baseVel) > f.refDistance ** 2) normToLength(this.baseVel, f.refDistance);
          break;
        case JpaField.MAGNET:
        case JpaField.NEWTON: {
          if (f.statusFlags & JpaFieldFlag.LOCAL_SPACE) v3sub(sA, f.position, this.globalPosition);
          else {
            v3sub(sA, f.position, W.emitterTranslation);
            transformW0(sA, W.globalRotation, sA);
            v3sub(sA, sA, this.localPosition);
          }
          if (f.type === JpaField.MAGNET) normToLength(sA, f.magnitude);
          else {
            const power = 10 * f.magnitude, sq = v3sqLen(sA);
            normToLength(sA, sq <= f.refDistance ? power : (f.refDistance / sq) * power);
          }
          this.fieldAffect(sA, f);
          break;
        }
        case JpaField.VORTEX: {
          transformW0(sA, W.globalRotation, f.direction);
          v3normalize(sA, sA);
          const sqVortex = f.position[2] ** 2;
          v3scale(sB, sA, v3dot(sA, this.localPosition));
          v3sub(sB, this.localPosition, sB);
          const sq = v3sqLen(sB);
          if (sq === 0) break;
          const power = sq >= sqVortex ? f.outerSpeed : f.innerSpeed + (f.outerSpeed - f.innerSpeed) * (sq / sqVortex);
          v3normalize(sB, sB);
          v3cross(sB, sB, sA);
          v3scale(sB, sB, power);
          this.fieldAffect(sB, f);
          break;
        }
        case JpaField.RANDOM: {
          // A new kick on the particle's first frame and then every `cycle` frames.
          const tick = this.age | 0;
          if (tick === 0 || (f.cycle > 0 && tick % f.cycle === 0)) {
            const r = e.random;
            v3set(sA, r.zh(), r.zh(), r.zh());
            v3scale(sA, sA, f.magnitude);
            this.fieldAffect(sA, f);
          }
          break;
        }
        case JpaField.DRAG:
          if (!(this.status & ParticleStatus.STOP_FIELD_FADE_AFFECT)) this.drag *= 1 - this.fieldFade(f, this.time) * (1 - this.dragFieldEffect);
          else this.drag *= this.dragFieldEffect;
          break;
        case JpaField.CONVECTION: {
          v3cross(sC, f.position, f.direction);
          v3cross(sA, f.direction, sC);
          transformW0(sA, W.emitterGlobalRotation, sA);
          transformW0(sB, W.emitterGlobalRotation, f.direction);
          transformW0(sC, W.emitterGlobalRotation, sC);
          v3normalize(sA, sA);
          v3normalize(sB, sB);
          v3normalize(sC, sC);
          v3scale(sA, sA, v3dot(sA, this.localPosition));
          v3scale(sC, sC, v3dot(sC, this.localPosition));
          v3add(sA, sA, sC);
          const dist = v3len(sA);
          if (dist === 0) v3set(sA, 0, 0, 0);
          else v3scale(sA, sA, f.refDistance / dist);
          v3sub(sD, this.localPosition, sA);
          v3cross(sC, sB, sA);
          v3cross(sA, sC, sD);
          normToLength(sA, f.magnitude);
          this.fieldAffect(sA, f);
          break;
        }
        case JpaField.SPIN:
          transformW0(sA, W.emitterGlobalRotation, f.direction);
          v3normalize(sA, sA);
          m4rotate(sMtx, m4identity(sMtx), f.innerSpeed, sA);
          transformW0(sA, sMtx, this.localPosition);
          v3sub(sA, sA, this.localPosition);
          this.fieldAffect(sA, f);
          break;
      }
    }
  }

  private scaleAnm(type: number, maxFrame: number): number {
    if (type === JpaScaleAnm.REPEAT) return (this.age / maxFrame) % 1;
    if (type === JpaScaleAnm.REVERSE) return 1 - this.time;
    return this.time;
  }

  private static scaleFade(t: number, x: JpaExtraShape, base: number, increase: number, decrease: number): number {
    if (t < x.scaleInTiming) return t * increase + base;
    if (t > x.scaleOutTiming) return (t - x.scaleOutTiming) * decrease + 1;
    return 1;
  }

  /** One frame of a base particle; false once it's dead. */
  calcBase(e: JpaEmitter): boolean {
    if (this.age === -1) this.age++;
    else this.age += 1;
    if (this.age < 0 || this.age >= this.lifeTime) return false;
    const res = e.res;
    this.time = this.age / this.lifeTime;
    if (this.status & ParticleStatus.FOLLOW_EMITTER) v3copy(this.globalPosition, W.emitterGlobalCenterPos);
    v3set(this.fieldVel, 0, 0, 0);
    v3add(this.baseVel, this.baseVel, this.accel);
    if (!(this.status & ParticleStatus.STOP_FIELD_AFFECT)) this.calcField(e);
    v3add(this.fieldVel, this.fieldVel, this.fieldAccel);
    v3scale(this.baseVel, this.baseVel, this.airResist);
    v3add(this.velocity, this.baseVel, this.fieldVel);
    v3scale(this.velocity, this.velocity, this.moment * this.drag);
    if (this.status & ParticleStatus.DELETE) return false;
    const b = res.baseShape, x = res.extraShape, c = res.childShape;
    if (b.texIdxAnimData && !b.isGlobalTexAnm) this.texAnmIdx = calcTexIdx(b, this.age, this.time, this.anmRandom & b.texIdxLoopOfsMask);
    if (!b.isGlobalColorAnm) calcColor(this.colorPrm, this.colorEnv, b, this.age, this.time, this.anmRandom & b.colorLoopOfsMask);
    else
      for (let k = 0; k < 4; k++) {
        this.colorPrm[k] = e.colorPrm[k]!;
        this.colorEnv[k] = e.colorEnv[k]!;
      }
    if (x) {
      if (x.isEnableScale) {
        const tx = this.scaleAnm(x.scaleAnmTypeX, x.scaleAnmMaxFrameX);
        this.particleScale[0] = this.scaleOut * JpaParticle.scaleFade(tx, x, x.scaleInValueX, x.scaleIncreaseRateX, x.scaleDecreaseRateX);
        if (x.isDiffXY) {
          const ty = this.scaleAnm(x.scaleAnmTypeY, x.scaleAnmMaxFrameY);
          this.particleScale[1] = this.scaleOut * JpaParticle.scaleFade(ty, x, x.scaleInValueY, x.scaleIncreaseRateY, x.scaleDecreaseRateY);
        } else this.particleScale[1] = this.particleScale[0]!;
      }
      if (x.isEnableAlpha || x.isEnableSinWave) {
        let alpha: number;
        if (this.time < x.alphaInTiming) alpha = x.alphaInValue + this.time * x.alphaIncreaseRate;
        else if (this.time > x.alphaOutTiming) alpha = x.alphaBaseValue + (this.time - x.alphaOutTiming) * x.alphaDecreaseRate;
        else alpha = x.alphaBaseValue;
        if (x.isEnableSinWave) {
          const amplitude = this.alphaWaveRandom * x.alphaWaveAmplitude;
          const wave = Math.sin(((this.alphaWaveRandom * this.age * TAU) / 4) * (1 - x.alphaWaveFrequency));
          alpha *= 1 + amplitude * (0.5 * (wave - 1));
        }
        this.prmColorAlphaAnm = alpha;
      }
    }
    this.rotateAngle += this.rotateSpeed;
    if (c && e.supportedChild && this.canCreateChild(c)) for (let i = 0; i < c.rate; i++) e.createChild(this);
    v3add(this.localPosition, this.localPosition, this.velocity);
    v3mul(this.position, this.localPosition, W.globalDynamicsScale);
    v3add(this.position, this.position, this.globalPosition);
    return true;
  }

  private canCreateChild(c: JpaChildShape): boolean {
    const timing = this.age - (this.lifeTime - 1) * c.timing;
    return timing >= 0 && (timing | 0) % (c.step + 1) === 0;
  }

  /** One frame of a child particle; false once it's dead. */
  calcChild(e: JpaEmitter): boolean {
    if (this.age === -1) this.age++;
    else this.age += 1;
    if (this.age < 0 || this.age >= this.lifeTime) return false;
    const res = e.res, c = res.childShape!;
    this.time = this.age / this.lifeTime;
    if (this.age !== 0) {
      if (this.status & ParticleStatus.FOLLOW_EMITTER) v3copy(this.globalPosition, W.emitterGlobalCenterPos);
      this.baseVel[1]! -= c.gravity;
      v3set(this.fieldVel, 0, 0, 0);
      if (!(this.status & ParticleStatus.STOP_FIELD_AFFECT)) this.calcField(e);
      v3add(this.fieldVel, this.fieldVel, this.fieldAccel);
      v3scale(this.baseVel, this.baseVel, res.dynamics.airResist);
      v3add(this.velocity, this.baseVel, this.fieldVel);
      v3scale(this.velocity, this.velocity, this.moment * this.drag);
    }
    if (this.status & ParticleStatus.DELETE) return false;
    const inv = 1 - this.time;
    if (c.isEnableScaleOut) {
      this.particleScale[0] = this.scaleOut * inv;
      this.particleScale[1] = this.alphaWaveRandom * inv;
    }
    if (c.isEnableAlphaOut) this.prmColorAlphaAnm = inv;
    this.rotateAngle += this.rotateSpeed;
    v3add(this.localPosition, this.localPosition, this.velocity);
    v3mul(this.position, this.localPosition, W.globalDynamicsScale);
    v3add(this.position, this.position, this.globalPosition);
    return true;
  }

  get visible(): boolean {
    return !(this.status & ParticleStatus.INVISIBLE);
  }
}

/** Particles alive across every emitter, capped like FSA's emitter manager (7168 particles). */
export const MAX_PARTICLES = 7168;
let liveParticles = 0;
const particlePool: JpaParticle[] = [];
function newParticle(): JpaParticle | null {
  if (liveParticles >= MAX_PARTICLES) return null;
  liveParticles++;
  return particlePool.pop() ?? new JpaParticle();
}
function freeParticle(p: JpaParticle): void {
  liveParticles--;
  particlePool.push(p);
}

/** Shapes the port can draw (points aren't drawn, as in noclip). */
export const shapeDrawn = (shape: number): boolean => shape !== JpaShape.POINT;
export const isStripe = (shape: number): boolean => shape === JpaShape.STRIPE || shape === JpaShape.STRIPE_CROSS;
export const isCross = (shape: number): boolean => shape === JpaShape.STRIPE_CROSS || shape === JpaShape.DIRECTION_CROSS || shape === JpaShape.ROTATION_CROSS;

/**
 * One emitter of a resource. Place it with `translation`, `rotation`, `dynamicsScale` and `particleScale` (the
 * game's global SRT), then call `step()` once per 60 Hz frame. `seed` drives every random draw: two emitters of the
 * same resource with the same seed, placement and steps hold the same particles.
 */
export class JpaEmitter {
  readonly res: JpaResource;
  readonly random: JpaRandom;
  status: number;
  /** Frames stepped since the emitter started emitting. */
  age = 0;
  readonly localScale = v3();
  readonly localTranslation = v3();
  readonly localDirection = v3();
  readonly localRotation = v3();
  maxFrame: number;
  lifeTime: number;
  rate: number;
  volumeSize: number;
  volumeMinRad: number;
  volumeSweep: number;
  moment = 1;
  awayFromCenterSpeed: number;
  awayFromYAxisSpeed: number;
  directionalSpeed: number;
  randomDirectionSpeed: number;
  spread: number;
  scaleOut = 1;
  readonly colorPrm: JpaColor;
  readonly colorEnv: JpaColor;
  readonly globalColorPrm: JpaColor = [1, 1, 1, 1];
  readonly globalColorEnv: JpaColor = [1, 1, 1, 1];
  readonly rotation = m4();
  readonly dynamicsScale = v3(1, 1, 1);
  readonly translation = v3();
  /** The scene depth every particle is drawn at, in place of the renderer's mapping of its view z (or null). */
  sceneZ: number | null = null;
  readonly particleScale = [1, 1];
  readonly base: JpaParticle[] = [];
  readonly children: JpaParticle[] = [];
  /** The global texture animation's slot. */
  texAnmIdx = 0;
  readonly supportedChild: boolean;
  private emitCount = 0;
  /** This frame's emission count (FSA's resident emitters create that many at each queued position). */
  private createNumber = 0;
  /** Positions queued for this frame (resident mode), or null. */
  private queue: readonly (readonly number[])[] | null = null;
  private waitTime = 0;
  private rateStepTimer = 0;

  constructor(res: JpaResource, seed: number) {
    this.res = res;
    const d = res.dynamics, b = res.baseShape;
    // Spin the generator once, as the manager does for each new emitter.
    this.random = new JpaRandom(seed);
    this.random.next();
    v3copy(this.localScale, d.emitterScale);
    v3copy(this.localTranslation, d.emitterTranslation);
    v3copy(this.localDirection, d.emitterDirection);
    v3copy(this.localRotation, d.emitterRotation);
    this.maxFrame = d.maxFrame;
    this.lifeTime = d.lifeTime;
    this.rate = d.rate;
    this.volumeSize = d.volumeSize;
    this.volumeMinRad = d.volumeMinRad;
    this.volumeSweep = d.volumeSweep;
    this.awayFromCenterSpeed = d.initialVelOmni;
    this.awayFromYAxisSpeed = d.initialVelAxis;
    this.directionalSpeed = d.initialVelDir;
    this.randomDirectionSpeed = d.initialVelRandom;
    this.spread = d.spread;
    this.colorPrm = [...b.colorPrm];
    this.colorEnv = [...b.colorEnv];
    this.status = Status.FIRST_EMISSION | Status.RATE_STEP_EMIT;
    if (!shapeDrawn(b.shapeType)) this.status |= Status.TERMINATED;
    this.supportedChild = !res.childShape || shapeDrawn(res.childShape.shapeType);
  }

  /** Stops emitting; live particles play out. */
  stopCreateParticle(): void {
    this.status |= Status.STOP_CREATE_PARTICLE;
  }

  playCreateParticle(): void {
    this.status &= ~Status.STOP_CREATE_PARTICLE;
  }

  /** Ends the emitter: no new particles, and `step` reports it done once its particles are gone. */
  becomeInvalid(): void {
    this.stopCreateParticle();
    this.maxFrame = -1;
  }

  get particleCount(): number {
    return this.base.length + this.children.length;
  }

  /** Has stopped emitting for good. */
  get terminated(): boolean {
    return (this.status & Status.TERMINATED) !== 0;
  }

  dispose(): void {
    for (const p of this.base) freeParticle(p);
    for (const p of this.children) freeParticle(p);
    this.base.length = this.children.length = 0;
  }

  createChild(parent: JpaParticle): void {
    const p = newParticle();
    if (!p) return;
    this.children.push(p);
    p.initChild(this, parent);
  }

  private calcKey(): void {
    for (const key of this.res.keys) {
      const v = keyValue(key, this.age);
      switch (key.keyType) {
        case JpaKeyType.RATE:
          this.rate = v;
          break;
        case JpaKeyType.VOLUME_SIZE:
          this.volumeSize = v;
          break;
        case JpaKeyType.VOLUME_SWEEP:
          this.volumeSweep = v;
          break;
        case JpaKeyType.VOLUME_MIN_RAD:
          this.volumeMinRad = v;
          break;
        case JpaKeyType.LIFE_TIME:
          this.lifeTime = v;
          break;
        case JpaKeyType.MOMENT:
          this.moment = v;
          break;
        case JpaKeyType.INITIAL_VEL_OMNI:
          this.awayFromCenterSpeed = v;
          break;
        case JpaKeyType.INITIAL_VEL_AXIS:
          this.awayFromYAxisSpeed = v;
          break;
        case JpaKeyType.INITIAL_VEL_DIR:
          this.directionalSpeed = v;
          break;
        case JpaKeyType.SPREAD:
          this.spread = v;
          break;
        case JpaKeyType.SCALE:
          this.scaleOut = v;
          break;
      }
    }
  }

  private calcVolume(): void {
    const d = this.res.dynamics, r = this.random;
    const fixedInterval = (d.flags & JpaEmitFlag.FIXED_INTERVAL) !== 0, fixedDensity = (d.flags & JpaEmitFlag.FIXED_DENSITY) !== 0;
    switch (d.volumeType) {
      case JpaVolume.CUBE:
        v3set(W.volumePos, (r.float() - 0.5) * this.volumeSize, (r.float() - 0.5) * this.volumeSize, (r.float() - 0.5) * this.volumeSize);
        v3mul(W.velOmni, W.volumePos, W.emitterGlobalScale);
        v3set(W.velAxis, W.volumePos[0]!, 0, W.volumePos[2]!);
        return;
      case JpaVolume.SPHERE: {
        let angle: number, x: number;
        if (fixedInterval) {
          angle = Math.PI;
          if (W.volumeEmitAngleMax > 1) angle += W.volumeSweep * (W.volumeEmitAngleCount / (W.volumeEmitAngleMax - 1)) * TAU;
          x = Math.PI / 2 + (W.volumeEmitXCount / (W.divNumber - 1)) * Math.PI;
          W.volumeEmitAngleCount++;
          if (W.volumeEmitAngleCount === W.volumeEmitAngleMax) {
            W.volumeEmitAngleCount = 0;
            W.volumeEmitXCount++;
            if (W.volumeEmitXCount * 2 < W.divNumber) W.volumeEmitAngleMax = W.volumeEmitAngleMax !== 1 ? W.volumeEmitAngleMax + 4 : W.volumeEmitAngleMax + 3;
            else W.volumeEmitAngleMax = W.volumeEmitAngleMax !== 4 ? W.volumeEmitAngleMax - 4 : 1;
          }
        } else {
          angle = W.volumeSweep * r.zh() * TAU;
          x = r.float() * Math.PI;
        }
        let distance = r.float();
        if (fixedDensity) distance = 1 - distance ** 3;
        const size = W.volumeSize * (W.volumeMinRad + (1 - W.volumeMinRad) * distance);
        v3set(W.volumePos, size * Math.cos(x) * Math.sin(angle), size * Math.sin(x), size * Math.cos(x) * Math.cos(angle));
        v3mul(W.velOmni, W.volumePos, W.emitterGlobalScale);
        v3set(W.velAxis, W.volumePos[0]!, 0, W.volumePos[2]!);
        return;
      }
      case JpaVolume.CYLINDER: {
        let distance = r.float();
        if (fixedDensity) distance = 1 - distance * distance;
        const sizeXZ = W.volumeSize * (W.volumeMinRad + (1 - W.volumeMinRad) * distance);
        const angle = W.volumeSweep * r.zh() * TAU;
        const height = W.volumeSize * r.zp();
        v3set(W.volumePos, sizeXZ * Math.sin(angle), height, sizeXZ * Math.cos(angle));
        v3mul(W.velOmni, W.volumePos, W.emitterGlobalScale);
        v3set(W.velAxis, W.volumePos[0]!, 0, W.volumePos[2]!);
        return;
      }
      case JpaVolume.TORUS: {
        const size = W.volumeSize * W.volumeMinRad;
        const a1 = W.volumeSweep * r.zh() * TAU, a2 = r.zh() * TAU;
        v3set(W.velAxis, size * Math.cos(a1) * Math.cos(a2), size * Math.sin(a2), size * Math.cos(a1) * Math.sin(a2));
        v3set(W.volumePos, W.velAxis[0]! + W.volumeSize * Math.sin(a1), W.velAxis[1]!, W.velAxis[2]! + W.volumeSize * Math.cos(a1));
        v3mul(W.velOmni, W.volumePos, W.emitterGlobalScale);
        return;
      }
      case JpaVolume.POINT:
        v3set(W.volumePos, 0, 0, 0);
        v3set(W.velOmni, r.float() - 0.5, r.float() - 0.5, r.float() - 0.5);
        v3set(W.velAxis, W.velOmni[0]!, 0, W.velOmni[2]!);
        return;
      case JpaVolume.CIRCLE: {
        const angle = fixedInterval ? W.volumeSweep * (W.volumeEmitIdx++ / W.volumeEmitCount - 0.5) * TAU : W.volumeSweep * r.zh() * TAU;
        let distance = r.float();
        if (fixedDensity) distance = 1 - distance * distance;
        const sizeXZ = W.volumeSize * (W.volumeMinRad + (1 - W.volumeMinRad) * distance);
        v3set(W.volumePos, sizeXZ * Math.sin(angle), 0, sizeXZ * Math.cos(angle));
        v3set(W.velAxis, W.volumePos[0]!, 0, W.volumePos[2]!);
        v3mul(W.velOmni, W.velAxis, W.emitterGlobalScale);
        return;
      }
      default: {
        // Line
        const t = fixedInterval ? W.volumeEmitIdx++ / (W.volumeEmitCount - 1) - 0.5 : r.zh();
        v3set(W.volumePos, 0, 0, d.volumeSize * t);
        v3set(W.velAxis, 0, 0, W.volumePos[2]!);
        v3mul(W.velOmni, W.velAxis, W.emitterGlobalScale);
      }
    }
  }

  private createParticle(): void {
    const p = newParticle();
    if (!p) return;
    this.base.push(p);
    this.calcVolume();
    p.initBase(this);
  }

  /**
   * Emission (FSA's JPA 2, main.dol 0x800EB008): the frame's count is the whole part of the accumulated rate (the
   * fraction carries over, also while emission is stopped); the first emission makes at least one particle.
   */
  private create(): void {
    const d = this.res.dynamics;
    this.createNumber = 0;
    if (this.status & Status.RATE_STEP_EMIT) {
      let count: number;
      if (d.flags & JpaEmitFlag.FIXED_INTERVAL) {
        count = d.volumeType === JpaVolume.SPHERE ? d.divNumber * d.divNumber * 4 + 2 : d.divNumber;
        W.volumeEmitIdx = 0;
      } else {
        const add = this.rate * (1 + d.rateRandom * this.random.zp());
        this.emitCount += add;
        count = Math.trunc(this.emitCount);
        this.emitCount -= count;
        if (this.status & Status.FIRST_EMISSION && add > 0 && add < 1) count = 1;
      }
      W.volumeEmitCount = this.createNumber = count;
      if (!(this.status & Status.STOP_CREATE_PARTICLE)) for (let i = 0; i < count; i++) this.createParticle();
    }
    this.rateStepTimer += 1;
    if (this.rateStepTimer >= d.rateStep + 1) {
      this.rateStepTimer -= d.rateStep + 1;
      this.status |= Status.RATE_STEP_EMIT;
    } else this.status &= ~Status.RATE_STEP_EMIT;
    this.status &= ~Status.FIRST_EMISSION;
  }

  /** The emitter's world matrices for this frame (calcWorkData_c). */
  private workData(): void {
    W.volumeSize = this.volumeSize;
    W.volumeMinRad = this.volumeMinRad;
    W.volumeSweep = this.volumeSweep;
    W.volumeEmitXCount = 0;
    W.volumeEmitAngleCount = 0;
    W.volumeEmitAngleMax = 1;
    W.divNumber = this.res.dynamics.divNumber * 2 + 1;
    m4copy(W.globalRotation, this.rotation);
    computeModelMatrixR(sMtx, this.localRotation[0]!, this.localRotation[1]!, this.localRotation[2]!);
    m4mul(W.emitterGlobalRotation, W.globalRotation, sMtx);
    m4fromScaling(sMtx, this.localScale);
    m4mul(W.emitterGlobalSR, W.emitterGlobalRotation, sMtx);
    v3mul(W.emitterGlobalScale, this.dynamicsScale, this.localScale);
    dirMtx(W.emitterDirMtx, this.localDirection);
    v3copy(W.globalDynamicsScale, this.dynamicsScale);
    v3copy(W.emitterTranslation, this.localTranslation);
    m4fromScaling(sMtx, this.dynamicsScale);
    m4mul(sMtx, W.globalRotation, sMtx);
    sMtx[12] = this.translation[0]!;
    sMtx[13] = this.translation[1]!;
    sMtx[14] = this.translation[2]!;
    transformW1(W.emitterGlobalCenterPos, sMtx, this.localTranslation);
  }

  /**
   * Steps one 60 Hz frame. Returns false once the emitter is done (stopped emitting for good and every particle
   * died); the caller then disposes of it.
   */
  step(): boolean {
    const d = this.res.dynamics;
    if (this.waitTime < d.startFrame) {
      if (!(this.status & Status.STOP_CALC_EMITTER)) this.waitTime += 1;
      return true;
    }
    if (this.maxFrame < 0) {
      this.status |= Status.TERMINATED;
      if (this.particleCount === 0) return false;
    } else if (this.maxFrame !== 0 && this.age >= this.maxFrame) {
      this.status |= Status.TERMINATED;
      if (!(this.status & Status.IMMORTAL) && this.particleCount === 0) return false;
    }
    if (this.status & Status.STOP_CALC_EMITTER) return true;
    this.calcKey();
    this.workData();
    const b = this.res.baseShape;
    if (b.texIdxAnimData && b.isGlobalTexAnm) this.texAnmIdx = calcTexIdx(b, this.age, 0, 0);
    if (b.isGlobalColorAnm) calcColor(this.colorPrm, this.colorEnv, b, this.age, 0, 0);
    if (!(this.status & Status.TERMINATED)) this.create();
    if (this.queue) this.createQueued(this.queue);
    for (let i = 0; i < this.base.length; i++) {
      if (this.base[i]!.calcBase(this)) continue;
      freeParticle(this.base[i]!);
      this.base.splice(i--, 1);
    }
    for (let i = 0; i < this.children.length; i++) {
      if (this.children[i]!.calcChild(this)) continue;
      freeParticle(this.children[i]!);
      this.children.splice(i--, 1);
    }
    this.age += 1;
    return true;
  }

  /**
   * Resident mode (FSA's queued effects, main.dol 0x8013C958): steps one frame without emitting by itself, creating
   * the frame's emission count of particles at each of `positions` instead (world x, y, z).
   */
  stepQueued(positions: readonly (readonly number[])[]): boolean {
    this.status |= Status.STOP_CREATE_PARTICLE;
    this.queue = positions;
    const alive = this.step();
    this.queue = null;
    return alive;
  }

  private createQueued(positions: readonly (readonly number[])[]): void {
    for (const at of positions) {
      for (let i = 0; i < this.createNumber; i++) {
        const before = this.base.length;
        this.createParticle();
        const p = this.base[before];
        if (!p) return;
        // The particle is moved to the queued spot.
        v3copy(p.globalPosition, at);
        for (let k = 0; k < 3; k++) p.position[k] = p.globalPosition[k]! + p.localPosition[k]! * W.globalDynamicsScale[k]!;
      }
      v3copy(this.translation, at);
    }
  }

  /** The emitter's direction in world space (for directional shapes). */
  globalDirection(out: V3): V3 {
    computeModelMatrixR(sMtx, this.localRotation[0]!, this.localRotation[1]!, this.localRotation[2]!);
    m4mul(sMtx, this.rotation, sMtx);
    return transformW0(out, sMtx, this.localDirection);
  }

  /** The emitter's center in world space. */
  globalPosition(out: V3): V3 {
    m4fromScaling(sMtx, this.dynamicsScale);
    m4mul(sMtx, this.rotation, sMtx);
    sMtx[12] = this.translation[0]!;
    sMtx[13] = this.translation[1]!;
    sMtx[14] = this.translation[2]!;
    return transformW1(out, sMtx, this.localTranslation);
  }
}

// #region Drawing: per-particle matrices in view space (JPABaseParticle::drawCommon and JPABaseEmitter::drawStripe)

/** The camera a frame is drawn with: `view` maps world to view space (column-major 4×4). */
export interface JpaCamera {
  view: M4;
}

/** What drawing a particle produces: its quad's view-space matrix, texture matrix and colors. */
export interface JpaParticleDraw {
  /** View-space 3×4 (column-major 4×4) matrix of the ±25 quad. */
  posMtx: M4;
  /** Texture coordinates = (s, t, 1) · rows. */
  texS: [number, number, number];
  texT: [number, number, number];
  prm: JpaColor;
  env: JpaColor;
  /** The texture slot. */
  texIdx: number;
}

const planeXZ = Float64Array.of(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const ybb = m4();
const sE = v3(), sF = v3();

function applyDir(out: V3, p: JpaParticle, dirType: number, emitterDir: V3, prev: V3): V3 {
  switch (dirType) {
    case JpaDir.VEL:
      return v3copy(out, p.velocity);
    case JpaDir.POS:
      return v3copy(out, p.localPosition);
    case JpaDir.POS_INV:
      return v3scale(out, p.localPosition, -1);
    case JpaDir.EMITTER_DIR:
      return v3copy(out, emitterDir);
    default:
      return v3sub(out, prev, p.position);
  }
}

function applyPlane(m: M4, plane: number, sx: number, sy: number): void {
  for (let i = 0; i < 3; i++) m[i]! *= sx;
  if (plane === JpaPlane.XZ) {
    for (let i = 8; i < 11; i++) m[i]! *= sy;
    m4mul(m, m, planeXZ);
  } else {
    for (let i = 4; i < 7; i++) m[i]! *= sy;
    if (plane === JpaPlane.X) for (let i = 8; i < 11; i++) m[i]! *= sx;
  }
}

function applyRot(m: M4, angle: number, rotType: number): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  m4identity(m);
  switch (rotType) {
    case JpaRot.X:
      m[5] = c;
      m[9] = -s;
      m[6] = s;
      m[10] = c;
      break;
    case JpaRot.Y:
      m[0] = c;
      m[8] = -s;
      m[2] = s;
      m[10] = c;
      break;
    case JpaRot.Z:
      m[0] = c;
      m[4] = -s;
      m[1] = s;
      m[5] = c;
      break;
    case JpaRot.XYZ: {
      const r = (1 / 3) * (1 - c), a = r + c, b = r - 0.57735 * s, d = r + 0.57735 * s;
      m[0] = a;
      m[4] = b;
      m[8] = d;
      m[1] = b;
      m[5] = a;
      m[9] = d;
      m[2] = d;
      m[6] = b;
      m[10] = a;
      break;
    }
    default: {
      // Y with a 12° jiggle
      const js = 0.207912, jc = 0.978148;
      m[0] = c;
      m[4] = js;
      m[8] = -s;
      m[1] = 0;
      m[5] = jc;
      m[9] = -js;
      m[2] = s;
      m[6] = c * js;
      m[10] = c * jc;
    }
  }
}

/** Moves the quad for pivots 0 / 2 (its coordinates then run 0…50 or −50…0 instead of ±25). */
function applyPivot(m: M4, pivotX: number, pivotY: number): void {
  const tx = pivotX === 0 ? -25 : pivotX === 2 ? 25 : 0, ty = pivotY === 0 ? -25 : pivotY === 2 ? 25 : 0;
  if (!tx && !ty) return;
  m[12]! += m[0]! * tx + m[4]! * ty;
  m[13]! += m[1]! * tx + m[5]! * ty;
  m[14]! += m[2]! * tx + m[6]! * ty;
}

/** calcTexCrdMtxAnm: the scrolling texture matrix at `tick`. */
function texScroll(out: JpaParticleDraw, b: JpaBaseShape, tick: number): void {
  const offS = 0.5 * b.tilingS, offT = 0.5 * b.tilingT;
  const ts = b.texInitTransX + tick * b.texIncTransX + offS, tt = b.texInitTransY + tick * b.texIncTransY + offT;
  const ss = b.texInitScaleX + tick * b.texIncScaleX, st = b.texInitScaleY + tick * b.texIncScaleY;
  const rot = ((b.texInitRot + tick * b.texIncRot) * TAU) / 0xffff;
  const sin = Math.sin(rot), cos = Math.cos(rot);
  out.texS[0] = b.tilingS * ss * cos;
  out.texS[1] = b.tilingS * ss * -sin;
  out.texS[2] = offS + ss * (sin * tt - cos * ts);
  out.texT[0] = b.tilingT * st * sin;
  out.texT[1] = b.tilingT * st * cos;
  out.texT[2] = offT + -st * (sin * ts + cos * tt);
}

function texIdentity(out: JpaParticleDraw, tilingS = 1, tilingT = 1): void {
  out.texS[0] = tilingS;
  out.texS[1] = out.texS[2] = 0;
  out.texT[1] = tilingT;
  out.texT[0] = out.texT[2] = 0;
}

/** Per-frame draw state of an emitter: its view-space helpers (calcWorkData_d and calcYBBMtx). */
export class JpaDrawContext {
  readonly camera: JpaCamera;
  readonly emitterDir = v3();
  readonly prev = v3();
  readonly out: JpaParticleDraw = { posMtx: m4(), texS: [1, 0, 0], texT: [0, 1, 0], prm: [1, 1, 1, 1], env: [1, 1, 1, 1], texIdx: 0 };
  globalScale: [number, number] = [1, 1];
  pivotX = 1;
  pivotY = 1;
  child = false;

  constructor(camera: JpaCamera) {
    this.camera = camera;
    const v = camera.view;
    v3set(sA, 0, v[5]!, v[6]!);
    v3normalize(sA, sA);
    m4identity(ybb);
    ybb[12] = v[12]!;
    ybb[5] = sA[1]!;
    ybb[9] = -sA[2]!;
    ybb[13] = v[13]!;
    ybb[6] = sA[2]!;
    ybb[10] = sA[1]!;
    ybb[14] = v[14]!;
  }

  /** Prepares drawing `e`'s base (child = false) or child particles. */
  begin(e: JpaEmitter, child: boolean): void {
    const b = e.res.baseShape, c = e.res.childShape;
    this.child = child;
    e.globalDirection(this.emitterDir);
    const size = child && c && !c.isInheritedScale ? c.globalScale2D : b.baseSize;
    this.globalScale = [e.particleScale[0]! * size[0], e.particleScale[1]! * size[1]];
    const shape = child ? c!.shapeType : b.shapeType;
    if (shape === JpaShape.LINE) {
      this.globalScale[0] *= 1.02;
      this.globalScale[1] *= 0.4;
    }
    const x = e.res.extraShape;
    this.pivotX = !child && x?.isEnableScale ? x.pivotX : 1;
    this.pivotY = !child && x?.isEnableScale ? x.pivotY : 1;
    if (b.dirType === JpaDir.PREV_PARTICLE || c?.dirType === JpaDir.PREV_PARTICLE) e.globalPosition(this.prev);
  }

  /** The draw of particle `p` of emitter `e`, or null when it isn't drawn this frame. */
  particle(e: JpaEmitter, p: JpaParticle): JpaParticleDraw | null {
    const res = e.res, b = res.baseShape, x = res.extraShape;
    const shapeInfo = this.child ? res.childShape! : b;
    if (!p.visible) return this.skip(p, shapeInfo.dirType === JpaDir.PREV_PARTICLE);
    const out = this.out, dst = out.posMtx, view = this.camera.view;
    const isRot = x !== null && x.isEnableRotate;
    const sx = this.globalScale[0] * p.particleScale[0]!, sy = this.globalScale[1] * p.particleScale[1]!;
    const prev = shapeInfo.dirType === JpaDir.PREV_PARTICLE;
    switch (shapeInfo.shapeType) {
      case JpaShape.LINE: {
        v3normalize(sC, p.velocity);
        v3scaleAndAdd(sB, p.position, sC, -sy * 0.5);
        transformW1(sB, view, sB);
        transformW0(sA, view, sC);
        v3scale(sA, sA, -0.5);
        m4identity(dst);
        dst[0] = -sA[1]! * sx;
        dst[1] = sA[0]! * sx;
        dst[4] = sA[0]! * sy;
        dst[5] = sA[1]! * sy;
        dst[12] = sB[0]!;
        dst[13] = sB[1]!;
        dst[14] = sB[2]!;
        break;
      }
      case JpaShape.BILLBOARD:
        transformW1(sA, view, p.position);
        computeModelMatrixSRT(dst, sx, sy, 1, 0, 0, isRot ? p.rotateAngle : 0, sA[0]!, sA[1]!, sA[2]!);
        applyPivot(dst, this.pivotX, this.pivotY);
        break;
      case JpaShape.DIRECTION:
      case JpaShape.DIRECTION_CROSS: {
        applyDir(sA, p, shapeInfo.dirType, this.emitterDir, this.prev);
        if (isNearZeroV3(sA, 0.001)) return this.skip(p, prev);
        v3normalize(sA, sA);
        v3cross(sB, p.axis, sA);
        if (isNearZeroV3(sB, 0.001)) return this.skip(p, prev);
        v3normalize(sB, sB);
        v3cross(p.axis, sA, sB);
        v3normalize(p.axis, p.axis);
        m4identity(dst);
        setMatrixAxis(dst, p.axis, sA, sB);
        dst[12] = p.position[0]!;
        dst[13] = p.position[1]!;
        dst[14] = p.position[2]!;
        if (isRot) {
          applyRot(sMtx, p.rotateAngle, shapeInfo.rotType);
          applyPlane(sMtx, shapeInfo.planeType, sx, sy);
          m4mul(dst, dst, sMtx);
        } else applyPlane(dst, shapeInfo.planeType, sx, sy);
        applyPivot(dst, this.pivotX, this.pivotY);
        m4mul(dst, view, dst);
        break;
      }
      case JpaShape.ROTATION:
      case JpaShape.ROTATION_CROSS:
        applyRot(dst, p.rotateAngle, shapeInfo.rotType);
        applyPlane(dst, shapeInfo.planeType, sx, sy);
        dst[12] = p.position[0]!;
        dst[13] = p.position[1]!;
        dst[14] = p.position[2]!;
        applyPivot(dst, this.pivotX, this.pivotY);
        m4mul(dst, view, dst);
        break;
      case JpaShape.DIR_BILLBOARD:
        applyDir(sA, p, shapeInfo.dirType, this.emitterDir, this.prev);
        v3set(sB, view[2]!, view[6]!, view[10]!);
        v3cross(sA, sA, sB);
        v3normalize(sA, sA);
        transformW0(sA, view, sA);
        transformW1(sB, view, p.position);
        m4identity(dst);
        dst[0] = sA[0]! * sx;
        dst[1] = sA[1]! * sx;
        dst[4] = -sA[1]! * sy;
        dst[5] = sA[0]! * sy;
        dst[12] = sB[0]!;
        dst[13] = sB[1]!;
        dst[14] = sB[2]!;
        applyPivot(dst, this.pivotX, this.pivotY);
        break;
      case JpaShape.Y_BILLBOARD:
        transformW1(sB, view, p.position);
        m4identity(dst);
        if (isRot) {
          const s = Math.sin(p.rotateAngle), c = Math.cos(p.rotateAngle);
          dst[0] = c * sx;
          dst[1] = s * ybb[5]! * sx;
          dst[2] = s * sx * ybb[9]!;
          dst[4] = -s * sy;
          dst[5] = c * ybb[5]! * sy;
          dst[6] = c * sy * ybb[9]!;
          dst[9] = -ybb[9]!;
          dst[10] = ybb[5]!;
        } else {
          dst[0] = sx;
          dst[5] = ybb[5]! * sy;
          dst[6] = ybb[6]! * sy;
          dst[9] = ybb[9]!;
          dst[10] = ybb[10]!;
        }
        dst[12] = sB[0]!;
        dst[13] = sB[1]!;
        dst[14] = sB[2]!;
        applyPivot(dst, this.pivotX, this.pivotY);
        break;
      default:
        return this.skip(p, prev);
    }
    if (prev) v3copy(this.prev, p.position);
    // Texture matrix: children use the plain coordinates; scrolling textures move with the particle's age.
    if (this.child) texIdentity(out);
    else if (b.isEnableTexScrollAnm) texScroll(out, b, p.age);
    else if (shapeInfo.shapeType === JpaShape.LINE) texIdentity(out);
    else texIdentity(out, b.tilingS, b.tilingT);
    for (let k = 0; k < 4; k++) {
      out.prm[k] = p.colorPrm[k]! * e.globalColorPrm[k]!;
      out.env[k] = p.colorEnv[k]! * e.globalColorEnv[k]!;
    }
    out.prm[3] *= p.prmColorAlphaAnm;
    out.texIdx = this.child ? res.childShape!.texIdx : b.texIdxAnimData ? (b.isGlobalTexAnm ? e.texAnmIdx : p.texAnmIdx) : b.texIdx;
    return out;
  }

  private skip(p: JpaParticle, prev: boolean): null {
    if (prev) v3copy(this.prev, p.position);
    return null;
  }

  /**
   * A stripe through `particles` (in their draw order): two view-space points per particle (four for a cross), with
   * t running 0…1 along it, as `visit(point, s, t, strip)` calls (strip 1 = the cross's second strip).
   */
  stripe(e: JpaEmitter, particles: readonly JpaParticle[], visit: (x: number, y: number, z: number, s: number, t: number, strip: number) => void): void {
    const n = particles.length;
    if (n < 2) return;
    const res = e.res, shapeInfo = this.child ? res.childShape! : res.baseShape;
    const scale = 25 * this.globalScale[0];
    if (scale <= 0) return;
    const reverse = !res.baseShape.isDrawForwardAhead;
    const px = this.pivotX - 1, py = this.pivotY - 1;
    const px0 = scale * (1 + px), px1 = scale * (1 - px), py0 = scale * (1 + py), py1 = scale * (1 - py);
    const cross = shapeInfo.shapeType === JpaShape.STRIPE_CROSS;
    const view = this.camera.view;
    m4identity(sMtx);
    for (let i = 0; i < n; i++) {
      const p = particles[reverse ? n - 1 - i : i]!;
      applyDir(sA, p, shapeInfo.dirType, this.emitterDir, this.prev);
      if (isNearZeroV3(sA, 0.001)) v3set(sA, 0, 1, 0);
      else v3normalize(sA, sA);
      v3cross(sB, p.axis, sA);
      if (isNearZeroV3(sB, 0.001)) v3set(sB, 1, 0, 0);
      else v3normalize(sB, sB);
      v3cross(p.axis, sA, sB);
      v3normalize(p.axis, p.axis);
      setMatrixAxis(sMtx, sB, [0, 0, 0], p.axis);
      const s0 = px0 * -p.particleScale[0]!, s1 = px1 * p.particleScale[0]!;
      const sin = Math.sin(p.rotateAngle), cos = Math.cos(p.rotateAngle);
      const t = i / (n - 1);
      const point = (ox: number, oz: number, s: number, strip: number) => {
        v3set(sE, ox, 0, oz);
        transformW0(sE, sMtx, sE);
        v3add(sE, sE, p.position);
        transformW1(sF, view, sE);
        visit(sF[0]!, sF[1]!, sF[2]!, s, t, strip);
      };
      point(s0 * cos, s0 * sin, 0, 0);
      point(s1 * cos, s1 * sin, 1, 0);
      if (cross) {
        const q0 = py0 * -p.particleScale[1]!, q1 = py1 * p.particleScale[1]!;
        point(q0 * -sin, q0 * cos, 0, 1);
        point(q1 * -sin, q1 * cos, 1, 1);
      }
      if (shapeInfo.dirType === JpaDir.PREV_PARTICLE) v3copy(this.prev, p.position);
    }
  }
}
// #endregion
