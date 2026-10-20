import type { ReactNode } from 'react'
import { engine } from '@/lib/ipc'
import { JoyConArt } from './JoyConArt'
import { useDevices } from '@/stores/devices'
import { useT } from '@/stores/ui'
import type { TKey } from '@/i18n'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          data-on={o.value === value ? '1' : '0'}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="toggle" data-disabled={disabled ? '1' : '0'}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i />
      <span>{label}</span>
    </label>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  onCommit,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="slider" data-disabled={disabled ? '1' : '0'}>
      <div className="slider-head">
        <span>{label}</span>
        <output>
          {value}
          {unit}
        </output>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  )
}

export function Card({ title, hint, children, aside }: { title?: string; hint?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card">
      {(title || aside) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {hint && <p className="hint">{hint}</p>}
          </div>
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="hint">{sub}</p>}
      </div>
      {actions}
    </div>
  )
}

/** Affiché quand la page a besoin d'une manette qui n'est pas là. */
export function EmptyState({ needs = 'any' }: { needs?: 'any' | 'right' }) {
  const t = useT()
  const unsupported = useDevices((s) => s.snapshot.unsupported)
  const title: TKey = needs === 'right' ? 'empty.rightTitle' : 'empty.title'
  const steps: TKey[] = ['empty.step1', 'empty.step2', 'empty.step3']
  return (
    <div className="empty">
      <div className="cutouts" aria-hidden="true">
        <div className="static-jc l" style={{ '--jc-body': '#0ab9e6', '--jc-buttons': '#1e2226' } as React.CSSProperties}>
          <JoyConArt side="left" />
        </div>
        <div className="static-jc r" style={{ '--jc-body': '#ff3c28', '--jc-buttons': '#1e0a0a' } as React.CSSProperties}>
          <JoyConArt side="right" />
        </div>
      </div>
      <div className="empty-text">
        <h2>{t(title)}</h2>
        {needs === 'right' && <p>{t('empty.rightBody')}</p>}
        <ol className="manual">
          {steps.map((s, i) => (
            <li key={s}>
              <span className="step-badge">{i + 1}</span>
              <span>{t(s)}</span>
            </li>
          ))}
        </ol>
        {unsupported.length > 0 && <p className="note">{t('empty.unsupported', { names: unsupported.join(', ') })}</p>}
        <div className="row">
          <button className="btn primary" onClick={() => engine.rescan()}>
            {t('empty.detect')}
          </button>
          <button className="btn" onClick={() => engine.setDemo(true)}>
            {t('empty.demo')}
          </button>
        </div>
      </div>
    </div>
  )
}
