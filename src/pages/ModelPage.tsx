import { useEffect, useRef, useState } from 'react'
import type { Side } from '@/lib/ipc'
import { loadFrame, saveFrame } from '@/lib/frames'
import { frameFromPoses, DEFAULT_FRAME, DEFAULT_FRAME_RIGHT, type Vec3 } from '@/lib/orientation'
import { Scene3D, type Mode } from '@/lib/scene3d'
import { Card, EmptyState, PageHead, Segmented } from '@/components/Common'
import { useCustomizer } from '@/stores/customizer'
import { onTelemetry, useDevices } from '@/stores/devices'
import { toast, useT } from '@/stores/ui'

type Wizard = { side: Side; step: 'flat' | 'upright'; flat?: Vec3; busy: boolean }

/** Moyenne l'accélération d'un côté pendant `ms` millisecondes. */
function captureAccel(side: Side, ms: number): Promise<Vec3 | null> {
  return new Promise((resolve) => {
    const sum: Vec3 = [0, 0, 0]
    let n = 0
    const off = onTelemetry((t) => {
      if (t.side !== side) return
      sum[0] += t.accel[0]
      sum[1] += t.accel[1]
      sum[2] += t.accel[2]
      n++
    })
    setTimeout(() => {
      off()
      resolve(n >= 5 ? [sum[0] / n, sum[1] / n, sum[2] / n] : null)
    }, ms)
  })
}

export function ModelPage() {
  const t = useT()
  const snapshot = useDevices((s) => s.snapshot)
  const draft = useCustomizer((s) => s.draft)
  const leaving = useCustomizer((s) => s.leaving)
  const connected = snapshot.controllers.map((c) => c.side)
  const key = connected.join(',')
  const showStage = connected.length > 0 || Object.keys(leaving).length > 0

  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<Scene3D | null>(null)
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('view3d') === 'free' ? 'free' : 'live'))
  const [calibrated, setCalibrated] = useState<Record<Side, boolean>>(() => ({
    left: loadFrame('left') !== null,
    right: loadFrame('right') !== null,
  }))
  const [wizard, setWizard] = useState<Wizard | null>(null)

  useEffect(() => {
    if (!showStage || !canvas.current) return
    const s = new Scene3D(canvas.current)
    scene.current = s
    const off = onTelemetry((tel) => s.feed(tel))
    return () => {
      off()
      s.dispose()
      scene.current = null
    }
  }, [showStage])

  useEffect(() => {
    const s = scene.current
    if (!s) return
    s.setSides(connected)
    for (const c of snapshot.controllers) {
      const colors = draft[c.side] ?? { body: c.body, buttons: c.buttons }
      s.setColors(c.side, colors.body, colors.buttons)
      s.setFrame(c.side, loadFrame(c.side) ?? (c.side === 'right' ? DEFAULT_FRAME_RIGHT : DEFAULT_FRAME))
    }
    // `key` résume la liste des côtés connectés.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, snapshot, draft])

  useEffect(() => {
    scene.current?.setMode(mode)
    localStorage.setItem('view3d', mode)
  }, [mode])

  const capture = async () => {
    if (!wizard) return
    setWizard({ ...wizard, busy: true })
    const v = await captureAccel(wizard.side, 1200)
    if (!v) {
      toast('error', t('model.noData'))
      setWizard(null)
      return
    }
    if (wizard.step === 'flat') {
      setWizard({ ...wizard, step: 'upright', flat: v, busy: false })
      return
    }
    const frame = frameFromPoses(wizard.flat!, v)
    saveFrame(wizard.side, frame)
    scene.current?.setFrame(wizard.side, frame)
    setCalibrated((c) => ({ ...c, [wizard.side]: true }))
    toast('success', t('model.saved'))
    setWizard(null)
  }

  if (!showStage) return <EmptyState />

  const sideName = (s: Side) => t(s === 'left' ? 'side.left' : 'side.right')
  const modes: { value: Mode; label: string }[] = [
    { value: 'live', label: t('model.live') },
    { value: 'free', label: t('model.free') },
  ]

  return (
    <div className="model">
      <div className="model-stage">
        <canvas ref={canvas} />
      </div>
      <aside className="inspector">
        <PageHead title={t('nav.model')} sub={t('model.sub')} />
        <Card title={t('model.view')} hint={t(mode === 'live' ? 'model.liveHint' : 'model.freeHint')}>
          <Segmented value={mode} options={modes} onChange={setMode} />
          <button className="btn" disabled={mode !== 'live'} onClick={() => scene.current?.recenter()}>
            {t('model.recenter')}
          </button>
        </Card>

        <Card title={t('model.orientation')} hint={t('model.orientationHint')}>
          {connected.map((side) => (
            <div key={side} className="orient-row">
              <div>
                <strong>{sideName(side)}</strong>
                <span className="hint">{t(calibrated[side] ? 'model.calibrated' : 'model.notCalibrated')}</span>
              </div>
              <button className="btn" disabled={wizard !== null} onClick={() => setWizard({ side, step: 'flat', busy: false })}>
                {t('model.calibrate')}
              </button>
            </div>
          ))}
          {wizard && (
            <div className="wizard">
              <p className="step">
                <span className="step-badge">{wizard.step === 'flat' ? 1 : 2}</span>
                <span>{t(wizard.step === 'flat' ? 'model.stepFlat' : 'model.stepUpright', { side: sideName(wizard.side) })}</span>
              </p>
              <div className="row">
                <button className="btn" onClick={() => setWizard(null)}>
                  {t('common.cancel')}
                </button>
                <button className="btn primary" disabled={wizard.busy} onClick={capture}>
                  {wizard.busy ? t('model.capturing') : t('model.capture')}
                </button>
              </div>
            </div>
          )}
        </Card>
      </aside>
    </div>
  )
}
