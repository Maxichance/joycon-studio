import type { StickCal } from '@/lib/ipc'

const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi

/** Même contrôle que le moteur : un bloc hors de ces bornes ne sera jamais écrit. */
export function calIsSane(cal: StickCal): boolean {
  return (
    cal.center.every((c) => within(c, 1200, 2900)) &&
    [...cal.above, ...cal.below].every((d) => within(d, 400, 2000))
  )
}
