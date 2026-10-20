import { describe, expect, it } from 'vitest'
import { calIsSane } from './calibration'

describe('calIsSane', () => {
  it('accepte une calibration réaliste', () => {
    expect(calIsSane({ center: [2100, 1980], above: [1180, 1210], below: [1100, 1150] })).toBe(true)
  })

  it('refuse des positions absolues prises pour des distances', () => {
    expect(calIsSane({ center: [2048, 2048], above: [3500, 3500], below: [600, 600] })).toBe(false)
  })

  it('refuse un centre hors plage et une course nulle', () => {
    expect(calIsSane({ center: [100, 2048], above: [1200, 1200], below: [1200, 1200] })).toBe(false)
    expect(calIsSane({ center: [2048, 2048], above: [0, 1200], below: [1200, 1200] })).toBe(false)
  })
})
