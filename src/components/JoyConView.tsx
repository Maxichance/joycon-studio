import { useEffect, useRef, useState } from 'react'
import { JoyConArt } from './JoyConArt'
import type { Side } from '@/lib/ipc'
import { latestTelemetry, onTelemetry } from '@/stores/devices'
import { useT } from '@/stores/ui'
import type { Zone } from '@/stores/customizer'

type Props = {
  side: Side
  body: string
  buttons: string
  selected: Zone | null
  /** `enter` : vient d'arriver ; `in` : présente ; `out` : vient de se déconnecter. */
  phase?: 'enter' | 'in' | 'out'
  onSelect?: (zone: Zone) => void
}

const STICK_TRAVEL = 12

/** Repères numérotés autour de la manette : position verticale en % de sa hauteur. */
const CALLOUTS: { zone: Zone; n: number; top: number }[] = [
  { zone: 'buttons', n: 1, top: 36 },
  { zone: 'body', n: 2, top: 78 },
]

export function JoyConView({ side, body, buttons, selected, phase = 'in', onSelect }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Zone | null>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const cap = root.querySelector<SVGGElement>('[data-part="stick-cap"]')
    const apply = (pressed: string[], x: number, y: number) => {
      root.querySelectorAll<SVGGElement>('[data-btn]').forEach((el) => {
        el.classList.toggle('pressed', pressed.includes(el.dataset.btn!))
      })
      if (cap) cap.style.transform = `translate(${x * STICK_TRAVEL}px, ${-y * STICK_TRAVEL}px)`
    }
    const first = latestTelemetry(side)
    if (first) apply(first.pressed, first.stick.x, first.stick.y)
    return onTelemetry((tel) => {
      if (tel.side === side) apply(tel.pressed, tel.stick.x, tel.stick.y)
    })
  }, [side])

  const zoneOf = (target: EventTarget | null): Zone | null => {
    const z = (target as Element | null)?.closest?.('[data-zone]')?.getAttribute('data-zone')
    return z === 'body' || z === 'buttons' ? z : null
  }

  return (
    <div
      ref={ref}
      className="jc-wrap"
      data-side={side}
      data-phase={phase}
      data-selected={selected ?? ''}
      data-hover={hover ?? ''}
      style={{ '--jc-body': body, '--jc-buttons': buttons } as React.CSSProperties}
      onPointerMove={(e) => setHover(zoneOf(e.target))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const z = zoneOf(e.target)
        if (z && onSelect) onSelect(z)
      }}
    >
      <JoyConArt side={side} />
      <div className="cote w" aria-hidden="true">
        <span>35,9 mm</span>
      </div>
      <div className="cote h" aria-hidden="true">
        <span>102 mm</span>
      </div>
      {CALLOUTS.map((c) => (
        <button
          key={c.zone}
          className="callout"
          data-on={selected === c.zone ? '1' : '0'}
          data-lead={side === 'left' ? 'right' : 'left'}
          style={{ top: `${c.top}%`, [side === 'left' ? 'right' : 'left']: 'calc(100% + 56px)' }}
          onClick={() => onSelect?.(c.zone)}
        >
          <b>{c.n}</b>
          {t(c.zone === 'body' ? 'zone.body' : 'zone.buttons')}
        </button>
      ))}
      <div className="jc-tip" data-on={hover ? '1' : '0'}>
        {hover ? t(hover === 'body' ? 'zone.body' : 'zone.buttons') : ''}
      </div>
    </div>
  )
}
