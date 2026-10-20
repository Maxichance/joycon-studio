import { create } from 'zustand'
import { initialLang, translate, type Lang, type TKey } from '@/i18n'

export type Page = 'customize' | 'model' | 'sticks' | 'ir' | 'haptics' | 'backups' | 'settings'
export type Theme = 'system' | 'dark' | 'light'
export type ToastKind = 'info' | 'success' | 'error'
export type Toast = { id: number; kind: ToastKind; text: string }

export type ConfirmRequest = {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

type UiState = {
  page: Page
  lang: Lang
  theme: Theme
  toasts: Toast[]
  confirmRequest: ConfirmRequest | null
  setPage: (p: Page) => void
  setLang: (l: Lang) => void
  setTheme: (t: Theme) => void
}

const savedTheme = localStorage.getItem('theme')

export const useUi = create<UiState>((set) => ({
  page: 'customize',
  lang: initialLang(),
  theme: savedTheme === 'dark' || savedTheme === 'system' ? savedTheme : 'light',
  toasts: [],
  confirmRequest: null,
  setPage: (page) => set({ page }),
  setLang: (lang) => {
    localStorage.setItem('lang', lang)
    document.documentElement.lang = lang
    set({ lang })
  },
  setTheme: (theme) => {
    localStorage.setItem('theme', theme)
    set({ theme })
  },
}))

/** Traduction hors composant (stores, gestionnaires d'événements). */
export function tr(key: TKey, vars?: Record<string, string | number>): string {
  return translate(useUi.getState().lang, key, vars)
}

/** Traduction réactive : le composant se met à jour au changement de langue. */
export function useT() {
  const lang = useUi((s) => s.lang)
  return (key: TKey, vars?: Record<string, string | number>) => translate(lang, key, vars)
}

let toastId = 0
export function toast(kind: ToastKind, text: string) {
  const id = ++toastId
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, text }] }))
  if (kind !== 'error') setTimeout(() => dismissToast(id), 4000)
}

export function dismissToast(id: number) {
  useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export function confirmAction(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useUi.setState({
      confirmRequest: {
        ...req,
        resolve: (ok) => {
          useUi.setState({ confirmRequest: null })
          resolve(ok)
        },
      },
    })
  })
}
