import type { Lang } from '@/i18n'

export function formatDate(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`
  return `${(n / 1024 / 1024).toFixed(1)} Mo`
}
