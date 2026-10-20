import { useState } from 'react'
import { isHex, SWATCHES } from '@/lib/presets'
import { useT } from '@/stores/ui'

type Props = { value: string; onChange: (hex: string) => void }

export function ColorField({ value, onChange }: Props) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? value
  const invalid = draft !== null && !isHex(draft.startsWith('#') ? draft : `#${draft}`)

  const commit = (raw: string) => {
    const v = raw.startsWith('#') ? raw : `#${raw}`
    if (isHex(v)) onChange(v.toUpperCase())
  }

  return (
    <div className="color-field">
      <div className="color-row">
        <label className="color-well" style={{ background: value }} aria-label={t('color.pick')}>
          <input type="color" value={value.toLowerCase()} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </label>
        <input
          className="hex-input"
          data-invalid={invalid ? '1' : '0'}
          value={text}
          maxLength={7}
          spellCheck={false}
          aria-label={t('color.hex')}
          onChange={(e) => {
            setDraft(e.target.value)
            commit(e.target.value)
          }}
          onBlur={() => setDraft(null)}
        />
      </div>
      <div className="swatches">
        {SWATCHES.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} aria-label={c} onClick={() => onChange(c)} data-on={c === value ? '1' : '0'} />
        ))}
      </div>
    </div>
  )
}
