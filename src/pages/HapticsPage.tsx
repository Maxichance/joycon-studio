import { useRef, useState } from 'react'
import { engine, type HomeMode, type Side } from '@/lib/ipc'
import { errorText } from '@/lib/errors'
import { Card, EmptyState, PageHead, Segmented, Slider, Toggle } from '@/components/Common'
import { controllerOf, useDevices } from '@/stores/devices'
import { toast, useT } from '@/stores/ui'

type Target = 'both' | Side

export function HapticsPage() {
  const t = useT()
  const snapshot = useDevices((s) => s.snapshot)
  const connected = snapshot.controllers.map((c) => c.side)
  const hasRight = Boolean(controllerOf(snapshot, 'right'))

  const [target, setTarget] = useState<Target>('both')
  const [low, setLow] = useState(160)
  const [high, setHigh] = useState(320)
  const [amp, setAmp] = useState(60)
  const [ms, setMs] = useState(300)

  const [mode, setMode] = useState<HomeMode>('breathe')
  const [intensity, setIntensity] = useState(15)
  const [leds, setLeds] = useState(0b0001)
  const ledTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  if (connected.length === 0) return <EmptyState />

  const run = (p: Promise<unknown>) => p.catch((e) => toast('error', errorText(e)))

  const testRumble = () => run(engine.rumble(target === 'both' ? null : target, low, high, amp / 100, ms))

  const applyHome = (m: HomeMode, i: number) => {
    setMode(m)
    setIntensity(i)
    clearTimeout(ledTimer.current)
    ledTimer.current = setTimeout(() => run(engine.homeLight(m, i)), 80)
  }

  const toggleLed = (bit: number, on: boolean) => {
    const next = on ? leds | (1 << bit) : leds & ~(1 << bit)
    setLeds(next)
    run(engine.playerLeds(next))
  }

  const targetOptions: { value: Target; label: string; disabled?: boolean }[] = [
    { value: 'both', label: t('view.pair'), disabled: connected.length < 2 },
    { value: 'left', label: t('side.left'), disabled: !connected.includes('left') },
    { value: 'right', label: t('side.right'), disabled: !connected.includes('right') },
  ]
  const modeOptions: { value: HomeMode; label: string }[] = (['breathe', 'heartbeat', 'solid', 'off'] as const).map((m) => ({
    value: m,
    label: t(`home.${m}` as 'home.breathe'),
  }))

  return (
    <div className="page-scroll">
      <PageHead title={t('nav.haptics')} sub={t('haptics.sub')} />
      <div className="cards-grid">
        <Card title={t('haptics.rumble')} hint={t('haptics.rumbleHint')}>
          <label className="field">
            <span>{t('haptics.target')}</span>
            <Segmented value={target} options={targetOptions} onChange={setTarget} />
          </label>
          <Slider label={t('haptics.low')} value={low} min={40} max={320} step={5} unit=" Hz" onChange={setLow} />
          <Slider label={t('haptics.high')} value={high} min={160} max={800} step={10} unit=" Hz" onChange={setHigh} />
          <Slider label={t('haptics.amp')} value={amp} min={10} max={100} step={5} unit=" %" onChange={setAmp} />
          <Slider label={t('haptics.duration')} value={ms} min={100} max={2000} step={50} unit=" ms" onChange={setMs} />
          <button className="btn primary" onClick={testRumble}>
            {t('haptics.test')}
          </button>
        </Card>

        <Card title={t('haptics.home')} hint={hasRight ? t('haptics.homeHint') : t('haptics.homeNeedsRight')}>
          <Segmented value={mode} options={modeOptions} onChange={(m) => applyHome(m, intensity)} />
          <Slider label={t('ir.intensity')} value={intensity} min={1} max={15} disabled={!hasRight || mode === 'off'} onChange={(i) => applyHome(mode, i)} />
        </Card>

        <Card title={t('haptics.players')} hint={t('haptics.playersHint')}>
          <div className="row wrap">
            {[0, 1, 2, 3].map((bit) => (
              <Toggle key={bit} checked={Boolean(leds & (1 << bit))} onChange={(on) => toggleLed(bit, on)} label={String(bit + 1)} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
