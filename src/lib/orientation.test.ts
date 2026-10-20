import { describe, expect, it } from 'vitest'
import { applyFrame, Attitude, frameFromPoses, type Vec3 } from './orientation'

/** Fait tourner un « haut » vrai à la vitesse angulaire donnée (rad/s) et renvoie ce que mesureraient les capteurs. */
function simulate(omega: Vec3, seconds: number, gyroSign: 1 | -1) {
  const att = new Attitude()
  let up: Vec3 = [0, 0, 1]
  const dt = 0.02
  for (let t = 0; t < seconds; t += dt) {
    const c: Vec3 = [
      omega[1] * up[2] - omega[2] * up[1],
      omega[2] * up[0] - omega[0] * up[2],
      omega[0] * up[1] - omega[1] * up[0],
    ]
    up = [up[0] - c[0] * dt, up[1] - c[1] * dt, up[2] - c[2] * dt]
    const n = Math.hypot(...up)
    up = [up[0] / n, up[1] / n, up[2] / n]
    const gyro: Vec3 = [omega[0], omega[1], omega[2]].map((v) => (gyroSign * v * 180) / Math.PI) as Vec3
    att.update(up, gyro, dt)
  }
  return { att, up }
}

describe('Attitude', () => {
  it('reste à la verticale quand rien ne bouge', () => {
    const att = new Attitude()
    for (let i = 0; i < 100; i++) att.update([0, 0, 1], [1.5, -1, 0.5], 0.02)
    expect(att.up[2]).toBeGreaterThan(0.999)
    expect(Math.abs(att.yaw)).toBeLessThan(0.05)
  })

  it('suit une inclinaison progressive', () => {
    const { att, up } = simulate([0.8, 0, 0], 1.5, 1)
    for (let i = 0; i < 3; i++) expect(att.up[i]).toBeCloseTo(up[i], 1)
  })

  it('déduit le sens du gyroscope quand il est inversé', () => {
    const { att, up } = simulate([0, 0.9, 0], 3, -1)
    expect(att.sign).toBe(-1)
    for (let i = 0; i < 3; i++) expect(att.up[i]).toBeCloseTo(up[i], 1)
  })
})

describe('frameFromPoses', () => {
  it('construit un repère direct à partir de deux poses', () => {
    const m = frameFromPoses([0, 0, 1], [1, 0, 0])
    expect(applyFrame(m, [0, 0, 1])).toEqual([0, 0, 1])
    const top = applyFrame(m, [1, 0, 0])
    expect(top[1]).toBeCloseTo(1)
  })

  it('revient au repère par défaut si les deux poses sont identiques', () => {
    const m = frameFromPoses([0, 0, 1], [0, 0, 1])
    expect(m[0]).toEqual([1, 0, 0])
  })
})
