import type { Side } from '@/lib/ipc'
import type { Mat3 } from './orientation'

const key = (side: Side) => `frame.${side}`

export function loadFrame(side: Side): Mat3 | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(side)) ?? 'null')
    if (Array.isArray(v) && v.length === 3 && v.every((r) => Array.isArray(r) && r.length === 3 && r.every(Number.isFinite))) {
      return v as Mat3
    }
  } catch {
    /* valeur illisible : on repart sans calibration */
  }
  return null
}

export function saveFrame(side: Side, frame: Mat3) {
  localStorage.setItem(key(side), JSON.stringify(frame))
}
