import type { Side } from '@/lib/ipc'
import { PRESETS } from '@/lib/presets'
import { ColorField } from '@/components/ColorField'
import { Card, EmptyState, PageHead, Segmented } from '@/components/Common'
import { JoyConView } from '@/components/JoyConView'
import { TelemetryDock } from '@/components/TelemetryDock'
import { Icon } from '@/components/Icon'
import { dirtySides, useCustomizer, type View, type Zone } from '@/stores/customizer'
import { useDevices } from '@/stores/devices'
import { useT } from '@/stores/ui'

export function CustomizePage() {
  const t = useT()
  const controllers = useDevices((s) => s.snapshot.controllers)
  const { draft, leaving, fresh, selection, view, writing, select, setView, setColor, applyPreset, revert, write } = useCustomizer()

  const connected = controllers.map((c) => c.side)
  const present = (['left', 'right'] as Side[]).filter((s) => connected.includes(s) || leaving[s])
  if (present.length === 0) return <EmptyState />

  const shown: Side[] = view === 'pair' ? present : present.includes(view) ? [view] : present
  const listed = shown.filter((s) => connected.includes(s))
  const dirty = dirtySides(draft)
  const current = draft[selection.side]?.[selection.zone] ?? '#000000'

  const viewOptions: { value: View; label: string; disabled?: boolean }[] = [
    { value: 'pair', label: t('view.pair'), disabled: connected.length < 2 },
    { value: 'left', label: t('side.left'), disabled: !connected.includes('left') },
    { value: 'right', label: t('side.right'), disabled: !connected.includes('right') },
  ]

  return (
    <div className="customize">
      <div className="customize-main">
        <PageHead title={t('nav.customize')} sub={t('customize.sub')} actions={<Segmented value={view} options={viewOptions} onChange={setView} label={t('view.label')} />} />
        <div className="stage">
          <div className="stage-inner">
            {shown.map((side) => {
              const z = draft[side] ?? leaving[side]
              if (!z) return null
              const dx = shown.length === 2 ? (side === 'left' ? -1 : 1) : 0
              return (
                <div key={side} className="slot" style={{ '--dx': dx } as React.CSSProperties}>
                  <JoyConView
                    side={side}
                    body={z.body}
                    buttons={z.buttons}
                    selected={selection.side === side ? selection.zone : null}
                    phase={!connected.includes(side) ? 'out' : fresh[side] ? 'enter' : 'in'}
                    onSelect={(zone) => select(side, zone)}
                  />
                </div>
              )
            })}
          </div>
        </div>
        <TelemetryDock />
      </div>

      <aside className="inspector">
        <Card title={t('customize.zones')} hint={t('customize.zonesHint')}>
          <div className="zone-list">
            {listed.map((side) =>
              (['body', 'buttons'] as Zone[]).map((zone) => {
                const value = draft[side]?.[zone] ?? '#000000'
                const on = selection.side === side && selection.zone === zone
                return (
                  <button key={`${side}-${zone}`} className="zone-row" data-on={on ? '1' : '0'} onClick={() => select(side, zone)}>
                    <i style={{ background: value }} />
                    <span>
                      {t(zone === 'body' ? 'zone.body' : 'zone.buttons')}
                      {listed.length > 1 && <small> {t(side === 'left' ? 'side.leftShort' : 'side.rightShort')}</small>}
                    </span>
                    <code>{value}</code>
                  </button>
                )
              }),
            )}
          </div>
          {draft[selection.side] && <ColorField value={current} onChange={setColor} />}
        </Card>

        <Card title={t('customize.presets')}>
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p.id} className="preset" onClick={() => applyPreset(p.id)}>
                <span className="preset-dots">
                  <i style={{ background: p.left.body }} />
                  <i style={{ background: p.right.body }} />
                </span>
                {t(`preset.${p.id}` as 'preset.neon')}
              </button>
            ))}
          </div>
        </Card>

        <div className="inspector-foot">
          <p className="hint">{dirty.length > 0 ? t('customize.dirty') : t('customize.clean')}</p>
          <div className="row">
            <button className="btn" disabled={dirty.length === 0 || writing} onClick={revert}>
              <Icon name="undo" size={15} />
              {t('customize.revert')}
            </button>
            <button className="btn primary grow" disabled={dirty.length === 0 || writing} onClick={write}>
              {writing ? t('customize.writing') : t('customize.write')}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
