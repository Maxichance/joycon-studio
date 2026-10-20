import { useCallback, useEffect, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { engine, type Backup, type Side } from '@/lib/ipc'
import { errorText } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { Card, PageHead, Segmented } from '@/components/Common'
import { Icon } from '@/components/Icon'
import { useDevices } from '@/stores/devices'
import { confirmAction, toast, useT, useUi } from '@/stores/ui'

export function BackupsPage() {
  const t = useT()
  const lang = useUi((s) => s.lang)
  const snapshot = useDevices((s) => s.snapshot)
  const connected = snapshot.controllers.map((c) => c.side)
  const [items, setItems] = useState<Backup[] | null>(null)
  const [dumpSide, setDumpSide] = useState<Side>('left')

  const refresh = useCallback(() => {
    engine.listBackups().then(setItems).catch(() => setItems([]))
  }, [])
  useEffect(refresh, [refresh, snapshot])

  const restore = async (b: Backup) => {
    const ok = await confirmAction({
      title: t('backups.restoreTitle'),
      body: t('backups.restoreBody', { date: formatDate(b.created_ms, lang) }),
      confirmLabel: t('backups.restore'),
    })
    if (!ok) return
    try {
      await engine.restoreBackup(b.id)
      toast('success', t('backups.restored'))
      refresh()
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const remove = async (b: Backup) => {
    const ok = await confirmAction({
      title: t('backups.deleteTitle'),
      body: t('backups.deleteBody', { date: formatDate(b.created_ms, lang) }),
      confirmLabel: t('backups.delete'),
      danger: true,
    })
    if (!ok) return
    try {
      await engine.deleteBackup(b.id)
      refresh()
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const dump = async () => {
    const side = connected.includes(dumpSide) ? dumpSide : connected[0]
    if (!side) return
    const path = await save({ defaultPath: `joycon-${side}-spi.bin`, filters: [{ name: 'BIN', extensions: ['bin'] }] })
    if (!path) return
    try {
      await engine.startSpiDump(side, path)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const sideLabel = (s: Side) => t(s === 'left' ? 'side.left' : 'side.right')
  const sideOptions = connected.map((s) => ({ value: s, label: sideLabel(s) }))

  return (
    <div className="page-scroll">
      <PageHead title={t('nav.backups')} sub={t('backups.sub')} />
      <div className="backups-grid">
        <Card title={t('backups.list')}>
          {items === null && <p className="hint">{t('common.loading')}</p>}
          {items?.length === 0 && <p className="hint">{t('backups.none')}</p>}
          <ul className="backup-list">
            {items?.map((b) => (
              <li key={b.id}>
                <div>
                  <strong>{formatDate(b.created_ms, lang)}</strong>
                  <span className="hint">
                    {sideLabel(b.side)} · {t(`backups.reason.${b.reason}` as 'backups.reason.colors')} · {b.device.serial || b.device.mac}
                  </span>
                </div>
                <div className="row">
                  <button className="btn" onClick={() => restore(b)} disabled={!connected.includes(b.side)}>
                    <Icon name="undo" size={15} />
                    {t('backups.restore')}
                  </button>
                  <button className="icon-btn" onClick={() => remove(b)} aria-label={t('backups.delete')} title={t('backups.delete')}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t('backups.dump')} hint={t('backups.dumpHint')}>
          {connected.length > 1 && <Segmented value={dumpSide} options={sideOptions} onChange={setDumpSide} />}
          <button className="btn" disabled={connected.length === 0 || snapshot.demo} onClick={dump}>
            <Icon name="download" size={15} />
            {t('backups.dumpStart')}
          </button>
        </Card>
      </div>
    </div>
  )
}
