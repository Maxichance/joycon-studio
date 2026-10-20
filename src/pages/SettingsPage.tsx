import { useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { engine } from '@/lib/ipc'
import { LANGS } from '@/i18n'
import { Card, PageHead, Segmented, Toggle } from '@/components/Common'
import { useDevices } from '@/stores/devices'
import { useT, useUi, type Theme } from '@/stores/ui'

export function SettingsPage() {
  const t = useT()
  const { lang, theme, setLang, setTheme } = useUi()
  const { controllers, demo } = useDevices((s) => s.snapshot)
  const [version, setVersion] = useState('')
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {})
  }, [])

  const themes: { value: Theme; label: string }[] = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'dark', label: t('settings.themeDark') },
    { value: 'light', label: t('settings.themeLight') },
  ]

  return (
    <div className="page-scroll">
      <PageHead title={t('nav.settings')} />
      <div className="cards-grid">
        <Card title={t('settings.appearance')}>
          <label className="field">
            <span>{t('settings.language')}</span>
            <Segmented value={lang} options={LANGS.map((l) => ({ value: l, label: l.toUpperCase() }))} onChange={setLang} />
          </label>
          <label className="field">
            <span>{t('settings.theme')}</span>
            <Segmented value={theme} options={themes} onChange={setTheme} />
          </label>
        </Card>

        <Card title={t('settings.demo')} hint={t('settings.demoHint')}>
          <Toggle checked={demo} onChange={(on) => engine.setDemo(on)} label={t('settings.demoToggle')} />
        </Card>

        <Card title={t('settings.controllers')}>
          {controllers.length === 0 && <p className="hint">{t('device.none')}</p>}
          {controllers.map((c) => (
            <dl key={c.side} className="info-list">
              <dt>{t(c.side === 'left' ? 'side.left' : 'side.right')}</dt>
              <dd>{c.name}</dd>
              <dt>{t('settings.firmware')}</dt>
              <dd>{c.firmware || '-'}</dd>
              <dt>{t('settings.mac')}</dt>
              <dd>{c.mac || '-'}</dd>
              <dt>{t('settings.serial')}</dt>
              <dd>{c.serial || '-'}</dd>
            </dl>
          ))}
        </Card>

        <Card title={t('settings.about')}>
          <p className="hint">Joycon Studio {version}</p>
          <p className="hint">{t('settings.disclaimer')}</p>
        </Card>
      </div>
    </div>
  )
}
