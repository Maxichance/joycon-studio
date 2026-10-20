import { describe, expect, it } from 'vitest'
import { fr } from '@/i18n/fr'
import { isHex, PRESETS, readableOn } from './presets'

describe('presets', () => {
  it('ont des couleurs valides et un nom traduit', () => {
    for (const p of PRESETS) {
      for (const side of [p.left, p.right]) {
        expect(isHex(side.body)).toBe(true)
        expect(isHex(side.buttons)).toBe(true)
      }
      expect(`preset.${p.id}` in fr).toBe(true)
    }
  })

  it('choisit un texte lisible', () => {
    expect(readableOn('#FFFFFF')).toBe('#101216')
    expect(readableOn('#000000')).toBe('#ffffff')
  })
})
