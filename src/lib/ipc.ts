import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type Side = 'left' | 'right'
export type Battery = { level: 'empty' | 'critical' | 'low' | 'medium' | 'full'; charging: boolean }

export type StickCal = { center: [number, number]; above: [number, number]; below: [number, number] }
export type CalSource = 'user' | 'factory' | 'default'

export type ControllerView = {
  side: Side
  name: string
  firmware: string
  mac: string
  serial: string
  body: string
  buttons: string
  cal: StickCal
  cal_source: CalSource
  battery: Battery | null
  demo: boolean
}

export type Snapshot = { controllers: ControllerView[]; unsupported: string[]; demo: boolean }

export type Telemetry = {
  side: Side
  pressed: string[]
  stick: { x: number; y: number; raw_x: number; raw_y: number }
  battery: Battery
  accel: [number, number, number]
  gyro: [number, number, number]
}

export type IrFrame = { side: Side; frame_number: number; width: number; height: number; pixels_b64: string }

export type TaskEvent = {
  id: string
  kind: 'spi_dump'
  done: number
  total: number
  state: 'running' | 'done' | 'error' | 'cancelled'
  message: string | null
}

export type JoyEvent =
  | ({ kind: 'telemetry' } & Telemetry)
  | ({ kind: 'ir' } & IrFrame)
  | ({ kind: 'task' } & TaskEvent)

export type BackupRegion = { addr: number; hex: string }
export type Backup = {
  id: string
  created_ms: number
  side: Side
  reason: 'colors' | 'calibration' | 'restore' | 'reset'
  device: { name: string; mac: string; firmware: string; serial: string }
  regions: BackupRegion[]
}

export type WriteReport = { backup_id: string | null; simulated: boolean }

export type HomeMode = 'breathe' | 'heartbeat' | 'solid' | 'off'

export type IrSettings = {
  resolution: '240p' | '120p' | '60p' | '30p'
  led_far: boolean
  led_near: boolean
  led_far_intensity: number
  led_near_intensity: number
  flashlight: boolean
  strobe: boolean
  ex_light_filter: boolean
  selfie: boolean
  exposure_us: number
  auto_exposure: boolean
  gain: number
  denoise: boolean
  denoise_edge: number
  denoise_color: number
}

export const DEFAULT_IR: IrSettings = {
  resolution: '30p',
  led_far: true,
  led_near: true,
  led_far_intensity: 15,
  led_near_intensity: 16,
  flashlight: false,
  strobe: false,
  ex_light_filter: true,
  selfie: false,
  exposure_us: 100,
  auto_exposure: true,
  gain: 1,
  denoise: true,
  denoise_edge: 0x23,
  denoise_color: 0x44,
}

/** Erreur du moteur : un code stable, traduit côté interface. */
export class EngineError extends Error {
  code: string
  detail: string
  constructor(code: string, detail = '') {
    super(code)
    this.code = code
    this.detail = detail
  }
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args)
  } catch (e) {
    const o = e as { code?: string; detail?: string }
    throw new EngineError(o?.code ?? 'unknown', o?.detail ?? String(e))
  }
}

export const engine = {
  snapshot: () => call<Snapshot>('get_snapshot'),
  rescan: () => call<void>('rescan'),
  setDemo: (on: boolean) => call<void>('set_demo', { on }),
  readColors: (side: Side) => call<[string, string]>('read_colors', { side }),
  writeColors: (side: Side, body: string, buttons: string) => call<WriteReport>('write_colors', { side, body, buttons }),
  writeCalibration: (side: Side, cal: StickCal) => call<WriteReport>('write_calibration', { side, cal }),
  resetCalibration: (side: Side) => call<WriteReport>('reset_calibration', { side }),
  listBackups: () => call<Backup[]>('list_backups'),
  deleteBackup: (id: string) => call<void>('delete_backup', { id }),
  restoreBackup: (id: string) => call<WriteReport>('restore_backup', { id }),
  startSpiDump: (side: Side, path: string) => call<string>('start_spi_dump', { side, path }),
  cancelTask: (id: string) => call<void>('cancel_task', { id }),
  rumble: (side: Side | null, low: number, high: number, amp: number, ms: number) =>
    call<void>('rumble', { side, low, high, amp, ms }),
  homeLight: (mode: HomeMode, intensity: number) => call<void>('home_light', { mode, intensity }),
  playerLeds: (mask: number) => call<void>('player_leds', { mask }),
  irStart: (settings: IrSettings) => call<void>('ir_start', { settings }),
  irApply: (settings: IrSettings) => call<void>('ir_apply', { settings }),
  irStop: () => call<void>('ir_stop'),
  irWriteRegister: (addr: number, val: number) => call<void>('ir_write_register', { addr, val }),
  saveBytes: (path: string, bytes: Uint8Array) =>
    invoke<void>('save_bytes', bytes, { headers: { 'x-path': toHex(new TextEncoder().encode(path)) } }),
}

export function onJoyEvent(cb: (e: JoyEvent) => void): Promise<UnlistenFn> {
  return listen<JoyEvent>('joycon:event', (ev) => cb(ev.payload))
}

export function onDevices(cb: (s: Snapshot) => void): Promise<UnlistenFn> {
  return listen<Snapshot>('joycon:devices', (ev) => cb(ev.payload))
}
