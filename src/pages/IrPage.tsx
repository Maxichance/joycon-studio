import { useCallback, useEffect, useRef, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { DEFAULT_IR, engine, type IrSettings } from '@/lib/ipc'
import { errorText } from '@/lib/errors'
import { decodeB64, PALETTES, renderIr, type Palette } from '@/lib/ir-render'
import { Card, EmptyState, PageHead, Segmented, Slider, Toggle } from '@/components/Common'
import { Icon } from '@/components/Icon'
import { controllerOf, useDevices, useIr } from '@/stores/devices'
import { toast, useT } from '@/stores/ui'

const RES_DIMS: Record<IrSettings['resolution'], string> = { '30p': '30 x 40', '60p': '60 x 80', '120p': '120 x 160', '240p': '240 x 320' }

function loadSettings(): IrSettings {
  try {
    return { ...DEFAULT_IR, ...JSON.parse(localStorage.getItem('ir') ?? '{}') }
  } catch {
    return DEFAULT_IR
  }
}

export function IrPage() {
  const t = useT()
  const snapshot = useDevices((s) => s.snapshot)
  const right = controllerOf(snapshot, 'right')
  const available = Boolean(right) && !snapshot.demo

  const [settings, setSettings] = useState<IrSettings>(loadSettings)
  const [palette, setPalette] = useState<Palette>('ironbow')
  const [stretch, setStretch] = useState(false)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fps, setFps] = useState(0)
  const frame = useIr((s) => s.frame)
  const canvas = useRef<HTMLCanvasElement>(null)
  const off = useRef(document.createElement('canvas'))
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fpsRef = useRef({ t: 0, n: 0 })

  useEffect(() => {
    localStorage.setItem('ir', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    return () => {
      useIr.setState({ frame: null })
      engine.irStop().catch(() => {})
    }
  }, [])

  const draw = useCallback(() => {
    const f = useIr.getState().frame
    const cv = canvas.current
    if (!f || !cv) return
    const w = f.height
    const h = f.width
    const o = off.current
    if (o.width !== w || o.height !== h) {
      o.width = w
      o.height = h
    }
    const ctx = o.getContext('2d')!
    const img = ctx.createImageData(w, h)
    renderIr(decodeB64(f.pixels_b64), f.width, f.height, palette, stretch, img)
    ctx.putImageData(img, 0, 0)
    const cx = cv.getContext('2d')!
    cx.imageSmoothingEnabled = false
    cx.drawImage(o, 0, 0, cv.width, cv.height)
  }, [palette, stretch])

  useEffect(() => {
    draw()
    if (!frame) return
    const now = performance.now()
    const m = fpsRef.current
    m.n++
    if (now - m.t >= 1000) {
      setFps(Math.round((m.n * 1000) / (now - m.t)))
      m.t = now
      m.n = 0
    }
  }, [frame, draw])

  const toggle = async () => {
    setBusy(true)
    try {
      if (running) {
        await engine.irStop()
        setRunning(false)
      } else {
        await engine.irStart(settings)
        fpsRef.current = { t: performance.now(), n: 0 }
        setRunning(true)
      }
    } catch (e) {
      toast('error', errorText(e))
      setRunning(false)
    } finally {
      setBusy(false)
    }
  }

  const update = (patch: Partial<IrSettings>, immediate = false) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    if (!running) return
    clearTimeout(pending.current)
    const send = () => {
      if (patch.resolution) setBusy(true)
      engine
        .irApply(next)
        .catch((e) => toast('error', errorText(e)))
        .finally(() => setBusy(false))
    }
    if (immediate || patch.resolution) send()
    else pending.current = setTimeout(send, 120)
  }

  const snapshotPng = async () => {
    const cv = canvas.current
    if (!cv || !frame) return
    const path = await save({ defaultPath: `joycon-ir-${Date.now()}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] })
    if (!path) return
    const blob: Blob | null = await new Promise((r) => cv.toBlob(r, 'image/png'))
    if (!blob) return
    try {
      await engine.saveBytes(path, new Uint8Array(await blob.arrayBuffer()))
      toast('success', t('ir.saved'))
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  if (!available) return <EmptyState needs="right" />

  const resOptions = (Object.keys(RES_DIMS) as IrSettings['resolution'][]).map((r) => ({ value: r, label: r }))
  const palOptions = PALETTES.map((p) => ({ value: p, label: t(`ir.palette.${p}` as 'ir.palette.ironbow') }))

  return (
    <div className="page-scroll">
      <PageHead
        title={t('nav.ir')}
        sub={t('ir.sub')}
        actions={
          <div className="row">
            <button className="btn" disabled={!frame} onClick={snapshotPng}>
              <Icon name="download" size={15} />
              {t('ir.capture')}
            </button>
            <button className="btn primary" disabled={busy} onClick={toggle}>
              <Icon name={running ? 'stop' : 'play'} size={15} />
              {running ? t('ir.stop') : t('ir.start')}
            </button>
          </div>
        }
      />

      <div className="ir-grid">
        <div className="ir-view">
          <canvas ref={canvas} width={240} height={320} />
          <div className="ir-status">
            <span data-live={running ? '1' : '0'} />
            {running ? t('ir.live', { fps, res: RES_DIMS[settings.resolution] }) : t('ir.idle')}
          </div>
        </div>

        <div className="ir-controls">
          <Card title={t('ir.image')}>
            <label className="field">
              <span>{t('ir.resolution')}</span>
              <Segmented value={settings.resolution} options={resOptions} onChange={(resolution) => update({ resolution })} />
            </label>
            <label className="field">
              <span>{t('ir.palette')}</span>
              <Segmented value={palette} options={palOptions} onChange={setPalette} />
            </label>
            <Toggle checked={stretch} onChange={setStretch} label={t('ir.stretch')} />
            <Toggle checked={settings.selfie} onChange={(selfie) => update({ selfie }, true)} label={t('ir.selfie')} />
          </Card>

          <Card title={t('ir.light')}>
            <Toggle checked={settings.led_far} onChange={(led_far) => update({ led_far }, true)} label={t('ir.ledFar')} />
            <Slider label={t('ir.intensity')} value={settings.led_far_intensity} min={0} max={15} disabled={!settings.led_far} onChange={(led_far_intensity) => update({ led_far_intensity })} />
            <Toggle checked={settings.led_near} onChange={(led_near) => update({ led_near }, true)} label={t('ir.ledNear')} />
            <Slider label={t('ir.intensity')} value={settings.led_near_intensity} min={0} max={16} disabled={!settings.led_near} onChange={(led_near_intensity) => update({ led_near_intensity })} />
            <Toggle checked={settings.flashlight} onChange={(flashlight) => update({ flashlight }, true)} label={t('ir.flashlight')} />
            <Toggle checked={settings.strobe} onChange={(strobe) => update({ strobe }, true)} label={t('ir.strobe')} />
            <Toggle checked={settings.ex_light_filter} onChange={(ex_light_filter) => update({ ex_light_filter }, true)} label={t('ir.exFilter')} />
          </Card>

          <Card title={t('ir.exposure')}>
            <Toggle checked={settings.auto_exposure} onChange={(auto_exposure) => update({ auto_exposure }, true)} label={t('ir.auto')} />
            <Slider label={t('ir.exposureTime')} value={settings.exposure_us} min={10} max={600} step={10} unit=" µs" disabled={settings.auto_exposure} onChange={(exposure_us) => update({ exposure_us })} />
            <Slider label={t('ir.gain')} value={settings.gain} min={1} max={16} unit="x" onChange={(gain) => update({ gain })} />
          </Card>

          <details className="card advanced">
            <summary>{t('ir.advanced')}</summary>
            <Toggle checked={settings.denoise} onChange={(denoise) => update({ denoise }, true)} label={t('ir.denoise')} />
            <Slider label={t('ir.denoiseEdge')} value={settings.denoise_edge} min={0} max={255} disabled={!settings.denoise} onChange={(denoise_edge) => update({ denoise_edge })} />
            <Slider label={t('ir.denoiseColor')} value={settings.denoise_color} min={0} max={255} disabled={!settings.denoise} onChange={(denoise_color) => update({ denoise_color })} />
            <RegisterWriter enabled={running} />
          </details>
        </div>
      </div>
    </div>
  )
}

function RegisterWriter({ enabled }: { enabled: boolean }) {
  const t = useT()
  const [addr, setAddr] = useState('0000')
  const [val, setVal] = useState('00')
  const a = parseInt(addr, 16)
  const v = parseInt(val, 16)
  const valid = /^[0-9a-f]{1,4}$/i.test(addr) && /^[0-9a-f]{1,2}$/i.test(val) && a <= 0xffff && v <= 0xff

  const write = async () => {
    try {
      await engine.irWriteRegister(a, v)
      toast('success', t('ir.regWritten'))
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <div className="register">
      <span className="hint">{t('ir.register')}</span>
      <div className="row">
        <input className="hex-input" value={addr} maxLength={4} onChange={(e) => setAddr(e.target.value)} aria-label={t('ir.regAddr')} />
        <input className="hex-input short" value={val} maxLength={2} onChange={(e) => setVal(e.target.value)} aria-label={t('ir.regValue')} />
        <button className="btn" disabled={!enabled || !valid} onClick={write}>
          {t('ir.regWrite')}
        </button>
      </div>
    </div>
  )
}
