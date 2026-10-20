import { useEffect, useRef, useState } from 'react'
import { engine, type Side, type StickCal } from '@/lib/ipc'
import { errorText } from '@/lib/errors'
import { calIsSane } from '@/lib/calibration'
import { Card, EmptyState, PageHead, Segmented } from '@/components/Common'
import { StickScope } from '@/components/TelemetryDock'
import { controllerOf, onTelemetry, useDevices, useTelemetry } from '@/stores/devices'
import { confirmAction, toast, tr, useT } from '@/stores/ui'

type Phase = 'idle' | 'center' | 'range' | 'review'
const CENTER_MS = 1500
const RANGE_MS = 7000

const emptyAcc = () => ({ sx: 0, sy: 0, n: 0, minx: 4095, maxx: 0, miny: 4095, maxy: 0 })

export function SticksPage() {
  const t = useT()
  const snapshot = useDevices((s) => s.snapshot)
  const connected = snapshot.controllers.map((c) => c.side)
  const [picked, setSide] = useState<Side>('left')
  const side: Side = connected.includes(picked) ? picked : connected[0]
  const ctrl = side ? controllerOf(snapshot, side) : undefined
  const tel = useTelemetry(side ?? 'left')

  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<StickCal | null>(null)
  const [extent, setExtent] = useState(emptyAcc())
  const acc = useRef(emptyAcc())
  const center = useRef<[number, number]>([2048, 2048])

  useEffect(() => {
    if (!side || (phase !== 'center' && phase !== 'range')) return
    const started = performance.now()
    const duration = phase === 'center' ? CENTER_MS : RANGE_MS

    const off = onTelemetry((e) => {
      if (e.side !== side) return
      const a = acc.current
      const { raw_x: x, raw_y: y } = e.stick
      if (phase === 'center') {
        a.sx += x
        a.sy += y
        a.n++
      } else {
        a.minx = Math.min(a.minx, x)
        a.maxx = Math.max(a.maxx, x)
        a.miny = Math.min(a.miny, y)
        a.maxy = Math.max(a.maxy, y)
      }
    })

    const timer = setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / duration)
      setProgress(p)
      setExtent({ ...acc.current })
      if (p < 1) return
      clearInterval(timer)
      off()
      const a = acc.current
      if (phase === 'center') {
        if (a.n < 10) {
          toast('error', tr('sticks.noData'))
          setPhase('idle')
          return
        }
        const c: [number, number] = [Math.round(a.sx / a.n), Math.round(a.sy / a.n)]
        center.current = c
        acc.current = { ...emptyAcc(), minx: c[0], maxx: c[0], miny: c[1], maxy: c[1] }
        setProgress(0)
        setPhase('range')
      } else {
        const [cx, cy] = center.current
        setResult({ center: [cx, cy], above: [a.maxx - cx, a.maxy - cy], below: [cx - a.minx, cy - a.miny] })
        setPhase('review')
      }
    }, 50)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [phase, side])

  if (!ctrl) return <EmptyState />

  const start = () => {
    acc.current = emptyAcc()
    setProgress(0)
    setResult(null)
    setPhase('center')
  }

  const write = async () => {
    if (!result) return
    const ok = await confirmAction({
      title: t('sticks.confirmTitle'),
      body: t(snapshot.demo ? 'customize.confirmDemo' : 'sticks.confirmBody', { sides: t(side === 'left' ? 'side.left' : 'side.right') }),
      confirmLabel: t('sticks.write'),
    })
    if (!ok) return
    try {
      await engine.writeCalibration(side, result)
      toast('success', t(snapshot.demo ? 'toast.writtenDemo' : 'sticks.written'))
      setPhase('idle')
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const reset = async () => {
    const ok = await confirmAction({
      title: t('sticks.resetTitle'),
      body: t('sticks.resetBody'),
      confirmLabel: t('sticks.reset'),
      danger: true,
    })
    if (!ok) return
    try {
      await engine.resetCalibration(side)
      toast('success', t(snapshot.demo ? 'toast.writtenDemo' : 'sticks.resetDone'))
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const x = tel?.stick.x ?? 0
  const y = tel?.stick.y ?? 0
  const drift = Math.round(Math.min(1, Math.hypot(x, y)) * 100)
  const sideOptions = connected.map((s) => ({ value: s, label: t(s === 'left' ? 'side.left' : 'side.right') }))

  return (
    <div className="page-scroll">
      <PageHead
        title={t('nav.sticks')}
        sub={t('sticks.sub')}
        actions={connected.length > 1 ? <Segmented value={side} options={sideOptions} onChange={setSide} label={t('sticks.side')} /> : undefined}
      />

      <div className="sticks-grid">
        <Card title={t('sticks.live')}>
          <div className="live-stick">
            <StickScope x={x} y={y} size={200} />
            <dl className="readout big">
              <dt>X</dt>
              <dd>{tel?.stick.raw_x ?? 0}</dd>
              <dt>Y</dt>
              <dd>{tel?.stick.raw_y ?? 0}</dd>
              <dt>{t('sticks.offset')}</dt>
              <dd data-warn={drift > 8 && phase === 'idle' ? '1' : '0'}>{drift} %</dd>
            </dl>
          </div>
          <p className="hint">{t('sticks.offsetHint')}</p>
        </Card>

        <Card title={t('sticks.current')} hint={t(`sticks.source.${ctrl.cal_source}` as 'sticks.source.user')}>
          <CalTable cal={ctrl.cal} />
          <div className="row">
            <button className="btn" onClick={reset} disabled={ctrl.cal_source !== 'user'}>
              {t('sticks.reset')}
            </button>
          </div>
        </Card>

        <Card title={t('sticks.wizard')} hint={phase === 'idle' ? t('sticks.wizardHint') : undefined}>
          {phase === 'idle' && (
            <button className="btn primary" onClick={start}>
              {t('sticks.start')}
            </button>
          )}
          {(phase === 'center' || phase === 'range') && (
            <div className="wizard">
              <p className="step">
                <span className="step-badge">{phase === 'center' ? 1 : 2}</span>
                <span>{t(phase === 'center' ? 'sticks.stepCenter' : 'sticks.stepRange')}</span>
              </p>
              <div className="bar">
                <i style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              {phase === 'range' && (
                <p className="hint mono">
                  X {extent.minx} / {extent.maxx} · Y {extent.miny} / {extent.maxy}
                </p>
              )}
              <button className="btn" onClick={() => setPhase('idle')}>
                {t('common.cancel')}
              </button>
            </div>
          )}
          {phase === 'review' && result && (
            <div className="wizard">
              <CalTable cal={result} compare={ctrl.cal} />
              {!calIsSane(result) && <p className="note error">{t('sticks.invalid')}</p>}
              <div className="row">
                <button className="btn" onClick={() => setPhase('idle')}>
                  {t('common.cancel')}
                </button>
                <button className="btn" onClick={start}>
                  {t('sticks.redo')}
                </button>
                <button className="btn primary grow" disabled={!calIsSane(result)} onClick={write}>
                  {t('sticks.write')}
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function CalTable({ cal, compare }: { cal: StickCal; compare?: StickCal }) {
  const t = useT()
  const rows: { key: 'center' | 'above' | 'below'; label: string }[] = [
    { key: 'center', label: t('sticks.center') },
    { key: 'above', label: t('sticks.above') },
    { key: 'below', label: t('sticks.below') },
  ]
  return (
    <table className="cal-table">
      <thead>
        <tr>
          <th />
          <th>X</th>
          <th>Y</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, label }) => (
          <tr key={key}>
            <th>{label}</th>
            {[0, 1].map((i) => (
              <td key={i}>
                {cal[key][i]}
                {compare && compare[key][i] !== cal[key][i] && <small> ({compare[key][i]})</small>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
