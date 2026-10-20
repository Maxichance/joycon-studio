import { getCurrentWindow } from '@tauri-apps/api/window'
import { engine, type Battery, type ControllerView } from '@/lib/ipc'
import { useDevices } from '@/stores/devices'
import { useT } from '@/stores/ui'
import { Icon } from './Icon'

function BatteryIcon({ battery }: { battery: Battery }) {
  const t = useT()
  const filled = { empty: 0, critical: 1, low: 2, medium: 3, full: 4 }[battery.level]
  return (
    <span className="battery" title={t(`battery.${battery.level}`)} data-level={battery.level}>
      {[0, 1, 2, 3].map((i) => (
        <i key={i} data-on={i < filled ? '1' : '0'} />
      ))}
      {battery.charging && <b aria-label={t('battery.charging')}>+</b>}
    </span>
  )
}

function Chip({ c }: { c: ControllerView }) {
  const t = useT()
  const label = t(c.side === 'left' ? 'side.left' : 'side.right')
  const details = [c.name, c.firmware && `FW ${c.firmware}`, c.mac, c.serial].filter(Boolean).join('\n')
  return (
    <div className="chip" title={details}>
      <span className="chip-dot" style={{ background: c.body }} />
      <span>{label}</span>
      {c.battery && <BatteryIcon battery={c.battery} />}
    </div>
  )
}

export function TitleBar() {
  const t = useT()
  const { controllers, unsupported, demo } = useDevices((s) => s.snapshot)
  const win = getCurrentWindow()

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <img src="/favicon.svg" alt="" width={20} height={20} />
        <span data-tauri-drag-region>Joycon Studio</span>
      </div>

      <div className="chips" data-tauri-drag-region>
        {controllers.map((c) => (
          <Chip key={c.side} c={c} />
        ))}
        {controllers.length === 0 && <span className="chips-empty">{t('device.none')}</span>}
        {unsupported.length > 0 && controllers.length === 0 && (
          <span className="chips-empty" title={unsupported.join(', ')}>
            {t('device.unsupported')}
          </span>
        )}
        {demo && <span className="demo-badge">{t('device.demo')}</span>}
        <button className="icon-btn" onClick={() => engine.rescan()} title={t('device.rescan')} aria-label={t('device.rescan')}>
          <Icon name="refresh" size={15} />
        </button>
      </div>

      <div className="window-controls">
        <button onClick={() => win.minimize()} aria-label={t('window.minimize')}>
          <Icon name="min" size={14} />
        </button>
        <button onClick={() => win.toggleMaximize()} aria-label={t('window.maximize')}>
          <Icon name="max" size={13} />
        </button>
        <button className="close" onClick={() => win.close()} aria-label={t('window.close')}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </header>
  )
}
