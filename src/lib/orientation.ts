export type Vec3 = [number, number, number]
/** Matrice 3x3 stockée par lignes. */
export type Mat3 = [Vec3, Vec3, Vec3]

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const unit = (a: Vec3): Vec3 => {
  const n = len(a)
  return n > 1e-9 ? scale(a, 1 / n) : [0, 0, 1]
}

const DEG = Math.PI / 180

/**
 * Attitude d'un capteur inertiel dans son propre repère : direction du « haut »
 * (opposé à la gravité) et lacet. L'accéléromètre donne l'inclinaison, le gyroscope
 * la lisse entre deux mesures et fournit le lacet, que rien d'autre ne mesure.
 *
 * Le sens des axes du gyroscope n'est pas supposé : il est déduit en comparant ce que
 * chaque signe prédit à ce que l'accéléromètre constate.
 */
export class Attitude {
  up: Vec3 = [0, 0, 1]
  /** Rotation autour de la verticale, en radians. */
  yaw = 0
  sign: 1 | -1 = 1
  private bias: Vec3 = [0, 0, 0]
  private still = 0
  private errPlus = 0
  private errMinus = 0

  update(accel: Vec3, gyro: Vec3, dt: number) {
    if (dt <= 0 || dt > 0.25) return
    const norm = len(accel)
    const valid = Math.abs(norm - 1) < 0.25
    const measured = valid ? scale(accel, 1 / norm) : null

    const w = scale(sub(gyro, this.bias), DEG)
    const rate = len(w)

    if (measured && rate < 6 * DEG) {
      this.still += dt
      if (this.still > 0.4) this.bias = add(this.bias, scale(sub(gyro, this.bias), Math.min(1, dt * 2)))
    } else {
      this.still = 0
    }

    if (measured && rate > 0.5) {
      const predict = (s: number) => unit(sub(this.up, scale(cross(w, this.up), s * dt)))
      const e = (v: Vec3) => len(sub(v, measured))
      this.errPlus = this.errPlus * 0.97 + e(predict(1))
      this.errMinus = this.errMinus * 0.97 + e(predict(-1))
      this.sign = this.errPlus <= this.errMinus ? 1 : -1
    }

    this.up = unit(sub(this.up, scale(cross(w, this.up), this.sign * dt)))
    this.yaw += this.sign * dot(w, this.up) * dt

    if (measured) {
      const k = 1 - Math.exp(-dt / 0.4)
      this.up = unit(add(scale(this.up, 1 - k), scale(measured, k)))
    }
  }

  resetYaw() {
    this.yaw = 0
  }
}

/** Repère de la manette (x à droite, y vers le haut de la manette, z hors de la face)
 *  à partir de deux poses : à plat face vers le haut, puis debout, haut en l'air. */
export function frameFromPoses(flat: Vec3, upright: Vec3): Mat3 {
  const z = unit(flat)
  let y = sub(upright, scale(z, dot(upright, z)))
  if (len(y) < 0.2) return DEFAULT_FRAME
  y = unit(y)
  const x = cross(y, z)
  return [x, y, z]
}

export const DEFAULT_FRAME: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

/** Le capteur du Joy-Con droit est monté en miroir : sa face est du côté -z. */
export const DEFAULT_FRAME_RIGHT: Mat3 = [
  [-1, 0, 0],
  [0, 1, 0],
  [0, 0, -1],
]

export function applyFrame(m: Mat3, v: Vec3): Vec3 {
  return [dot(m[0], v), dot(m[1], v), dot(m[2], v)]
}
