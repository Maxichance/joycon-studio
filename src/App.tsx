import { lazy, Suspense, useEffect } from 'react'
import { ConfirmHost, TaskCenter, Toasts } from '@/components/Overlays'
import { Sidebar } from '@/components/Sidebar'
import { TitleBar } from '@/components/TitleBar'
import { BackupsPage } from '@/pages/BackupsPage'
import { CustomizePage } from '@/pages/CustomizePage'
import { HapticsPage } from '@/pages/HapticsPage'
import { IrPage } from '@/pages/IrPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SticksPage } from '@/pages/SticksPage'
import { useUi } from '@/stores/ui'

// three.js n'est chargé que lorsque la page 3D est ouverte.
const ModelPage = lazy(() => import('@/pages/ModelPage').then((m) => ({ default: m.ModelPage })))

const PAGES = {
  customize: CustomizePage,
  model: ModelPage,
  sticks: SticksPage,
  ir: IrPage,
  haptics: HapticsPage,
  backups: BackupsPage,
  settings: SettingsPage,
}

export function App() {
  const page = useUi((s) => s.page)
  const theme = useUi((s) => s.theme)
  const lang = useUi((s) => s.lang)
  const Page = PAGES[page]

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.lang = lang
  }, [theme, lang])

  return (
    <div className="app">
      <TitleBar />
      <div className="shell">
        <Sidebar />
        <main className="page">
          <Suspense fallback={null}>
            <Page />
          </Suspense>
        </main>
      </div>
      <TaskCenter />
      <Toasts />
      <ConfirmHost />
    </div>
  )
}
