import { create } from 'zustand'
import { engine, type Side } from '@/lib/ipc'
import { errorText } from '@/lib/errors'
import { isHex, PRESETS, type Zones } from '@/lib/presets'
import { confirmAction, toast, tr } from '@/stores/ui'
import { controllerOf, useDevices } from '@/stores/devices'

export type Zone = 'body' | 'buttons'
export type View = 'pair' | Side

/** Durée de l'animation de sortie d'une manette, en ms. */
export const LEAVE_MS = 520
export const ENTER_MS = 1100

type State = {
  draft: Partial<Record<Side, Zones>>
  /** Manettes qui viennent de partir : gardées à l'écran le temps de l'animation de sortie. */
  leaving: Partial<Record<Side, Zones>>
  /** Manettes qui viennent d'arriver : l'animation d'entrée ne joue que pour elles. */
  fresh: Partial<Record<Side, boolean>>
  selection: { side: Side; zone: Zone }
  view: View
  writing: boolean
  select: (side: Side, zone: Zone) => void
  setView: (v: View) => void
  setColor: (hex: string) => void
  applyPreset: (id: string) => void
  revert: () => void
  write: () => Promise<void>
}

export const useCustomizer = create<State>((set, get) => ({
  draft: {},
  leaving: {},
  fresh: {},
  selection: { side: 'left', zone: 'body' },
  view: 'pair',
  writing: false,

  select: (side, zone) => set({ selection: { side, zone } }),

  setView: (view) => {
    const sel = get().selection
    set({ view, selection: view !== 'pair' && sel.side !== view ? { side: view, zone: sel.zone } : sel })
  },

  setColor: (hex) => {
    if (!isHex(hex)) return
    const { selection, draft } = get()
    const cur = draft[selection.side]
    if (!cur) return
    set({ draft: { ...draft, [selection.side]: { ...cur, [selection.zone]: hex.toUpperCase() } } })
  },

  applyPreset: (id) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    const { draft, view } = get()
    const next = { ...draft }
    for (const side of ['left', 'right'] as const) {
      if (next[side] && (view === 'pair' || view === side)) next[side] = { ...p[side] }
    }
    set({ draft: next })
  },

  revert: () => set({ draft: draftFromSnapshot() }),

  write: async () => {
    const { draft } = get()
    const snap = useDevices.getState().snapshot
    const dirty = dirtySides(draft)
    if (dirty.length === 0) return
    const names = dirty.map((s) => tr(s === 'left' ? 'side.left' : 'side.right')).join(', ')
    const ok = await confirmAction({
      title: tr('customize.confirmTitle'),
      body: tr(snap.demo ? 'customize.confirmDemo' : 'customize.confirmBody', { sides: names }),
      confirmLabel: tr('customize.write'),
    })
    if (!ok) return
    set({ writing: true })
    try {
      for (const side of dirty) {
        const z = draft[side]!
        await engine.writeColors(side, z.body, z.buttons)
      }
      toast('success', tr(snap.demo ? 'toast.writtenDemo' : 'toast.written'))
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      set({ writing: false })
    }
  },
}))

function draftFromSnapshot(): Partial<Record<Side, Zones>> {
  const snap = useDevices.getState().snapshot
  const out: Partial<Record<Side, Zones>> = {}
  for (const c of snap.controllers) out[c.side] = { body: c.body.toUpperCase(), buttons: c.buttons.toUpperCase() }
  return out
}

export function dirtySides(draft: Partial<Record<Side, Zones>>): Side[] {
  const snap = useDevices.getState().snapshot
  return (['left', 'right'] as const).filter((side) => {
    const c = controllerOf(snap, side)
    const d = draft[side]
    return c && d && (d.body !== c.body.toUpperCase() || d.buttons !== c.buttons.toUpperCase())
  })
}

/** Aligne le brouillon sur la puce pour les côtés sans modification en cours. */
useDevices.subscribe((state, prev) => {
  const { draft } = useCustomizer.getState()
  const fresh = draftFromSnapshot()
  const next: Partial<Record<Side, Zones>> = {}
  for (const side of ['left', 'right'] as const) {
    if (!fresh[side]) continue
    const before = controllerOf(prev.snapshot, side)
    const d = draft[side]
    const edited = d && before && (d.body !== before.body.toUpperCase() || d.buttons !== before.buttons.toUpperCase())
    next[side] = edited ? d : fresh[side]
  }

  const leaving = { ...useCustomizer.getState().leaving }
  for (const side of ['left', 'right'] as const) {
    const was = controllerOf(prev.snapshot, side)
    const now = controllerOf(state.snapshot, side)
    if (now) delete leaving[side]
    if (now && !was) {
      useCustomizer.setState((s) => ({ fresh: { ...s.fresh, [side]: true } }))
      setTimeout(() => useCustomizer.setState((s) => ({ fresh: { ...s.fresh, [side]: false } })), ENTER_MS)
    }
    if (was && !now) {
      leaving[side] = draft[side] ?? { body: was.body.toUpperCase(), buttons: was.buttons.toUpperCase() }
      setTimeout(() => {
        useCustomizer.setState((s) => {
          const rest = { ...s.leaving }
          delete rest[side]
          return { leaving: rest }
        })
      }, LEAVE_MS)
    }
  }
  const sel = useCustomizer.getState().selection
  const other = (['left', 'right'] as const).find((s) => next[s])
  const selection = !next[sel.side] && other ? { side: other, zone: sel.zone } : sel
  useCustomizer.setState({ draft: next, leaving, selection })
})
