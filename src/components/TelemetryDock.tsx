import type { Side } from '@/lib/ipc'
import { useDevices, useTelemetry } from '@/stores/devices'
import { useT } from '@/stores/ui'

const GLYPH: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→', minus: '−', plus: '+' }

export function StickScope({ x, y, size = 64 }: { x: number; y: number; size?: number }) {
  const r = size / 2
  return (
    <svg className="scope" width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`} aria-hidden="true">
      <circle r={r - 1} />
      <path d={`M${-r} 0H${r}M0 ${-r}V${r}`} />
      <circle className="dot" cx={x * (r - 7)} cy={-y * (r - 7)} r="4" />
    </svg>
  )
}

function SideCard({ side }: { side: Side }) {
  const t = useT()
  const tel = useTelemetry(side)
  const x = tel?.stick.x ?? 0
  const y = tel?.stick.y ?? 0
  const [ax, rawY, rawZ] = tel?.accel ?? [0, 0, side === 'right' ? -1 : 1]
  const flip = side === 'right' ? -1 : 1
  const [ay, az] = [rawY * flip, rawZ * flip]
  const tiltA = Math.round((Math.atan2(ay, az) * 180) / Math.PI)
  const tiltB = Math.round((Math.atan2(-ax, Math.hypot(ay, az)) * 180) / Math.PI)
  const label = (name: string) => GLYPH[name] ?? (['stick', 'home', 'capture'].includes(name) ? t(`btn.${name}` as 'btn.stick') : name.toUpperCase())

  return (
    <div className="dock-card" data-side={side}>
      <div className="dock-title">{t(side === 'left' ? 'side.left' : 'side.right')}</div>
      <StickScope x={x} y={y} />
      <dl className="readout">
        <dt>X</dt>
        <dd>{x.toFixed(2)}</dd>
        <dt>Y</dt>
        <dd>{y.toFixed(2)}</dd>
      </dl>
      <dl className="readout">
        <dt>{t('dock.tilt')}</dt>
        <dd>
          {tiltA}° / {tiltB}°
        </dd>
        <dt>{t('dock.gyro')}</dt>
        <dd>{Math.round(Math.hypot(...(tel?.gyro ?? [0, 0, 0])))} °/s</dd>
      </dl>
      <div className="keys">
        {(tel?.pressed ?? []).map((k) => (
          <kbd key={k}>{label(k)}</kbd>
        ))}
        {(tel?.pressed.length ?? 0) === 0 && <span className="hint">{t('dock.idle')}</span>}
      </div>
    </div>
  )
}

export function TelemetryDock() {
  const controllers = useDevices((s) => s.snapshot.controllers)
  return (
    <div className="dock">
      {controllers.map((c) => (
        <SideCard key={c.side} side={c.side} />
      ))}
    </div>
  )
}
