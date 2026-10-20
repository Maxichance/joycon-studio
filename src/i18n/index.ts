import { fr } from './fr'
import { en } from './en'
import { es } from './es'

export type TKey = keyof typeof fr
export type Lang = 'fr' | 'en' | 'es'
export const LANGS: Lang[] = ['fr', 'en', 'es']

const dicts: Record<Lang, Record<TKey, string>> = { fr, en, es }

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  let s = dicts[lang][key]
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, String(vars[k]))
  return s
}

export function initialLang(): Lang {
  const saved = localStorage.getItem('lang')
  if (saved === 'fr' || saved === 'en' || saved === 'es') return saved
  const nav = navigator.language.slice(0, 2)
  return nav === 'en' || nav === 'es' ? nav : 'fr'
}
