import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import type { ControllerView, IrFrame, Side, Snapshot, TaskEvent, Telemetry } from '@/lib/ipc'

type DevicesState = {
  snapshot: Snapshot
  loaded: boolean
  set: (s: Snapshot) => void
}

export const useDevices = create<DevicesState>((set) => ({
  snapshot: { controllers: [], unsupported: [], demo: false },
  loaded: false,
  set: (snapshot) => set({ snapshot, loaded: true }),
}))

export const controllerOf = (s: Snapshot, side: Side): ControllerView | undefined =>
  s.controllers.find((c) => c.side === side)

/** Télémétrie vivante : hors de React pour ne pas re-rendre à chaque rapport. */
type Listener = () => void
const latest: Partial<Record<Side, Telemetry>> = {}
const listeners = new Set<Listener>()
const rawListeners = new Set<(t: Telemetry) => void>()

export function pushTelemetry(t: Telemetry) {
  latest[t.side] = t
  rawListeners.forEach((f) => f(t))
  listeners.forEach((f) => f())
}

export function clearTelemetry(side: Side) {
  delete latest[side]
  listeners.forEach((f) => f())
}

/** Abonnement impératif (SVG, canvas) : appelé à chaque rapport, sans passer par React. */
export function onTelemetry(f: (t: Telemetry) => void): () => void {
  rawListeners.add(f)
  return () => rawListeners.delete(f)
}

export function latestTelemetry(side: Side): Telemetry | undefined {
  return latest[side]
}

/** Dernière télémétrie d'un côté, avec re-rendu à chaque rapport. */
export function useTelemetry(side: Side): Telemetry | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => latest[side],
  )
}

type TasksState = { tasks: TaskEvent[] }
export const useTasks = create<TasksState>(() => ({ tasks: [] }))

export function pushTask(t: TaskEvent) {
  useTasks.setState((s) => {
    const others = s.tasks.filter((x) => x.id !== t.id)
    return { tasks: [...others, t] }
  })
  if (t.state === 'done' || t.state === 'cancelled') setTimeout(() => dismissTask(t.id), 4000)
}

export function dismissTask(id: string) {
  useTasks.setState((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) }))
}

type IrState = { frame: IrFrame | null }
export const useIr = create<IrState>(() => ({ frame: null }))
