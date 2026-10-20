import { useUi, useT, type Page } from '@/stores/ui'
import type { TKey } from '@/i18n'
import { Icon, type IconName } from './Icon'

const ITEMS: { page: Page; icon: IconName; label: TKey }[] = [
  { page: 'customize', icon: 'palette', label: 'nav.customize' },
  { page: 'model', icon: 'cube', label: 'nav.model' },
  { page: 'sticks', icon: 'stick', label: 'nav.sticks' },
  { page: 'ir', icon: 'camera', label: 'nav.ir' },
  { page: 'haptics', icon: 'wave', label: 'nav.haptics' },
  { page: 'backups', icon: 'archive', label: 'nav.backups' },
]

export function Sidebar() {
  const t = useT()
  const page = useUi((s) => s.page)
  const setPage = useUi((s) => s.setPage)

  const item = (p: Page, icon: IconName, label: TKey) => (
    <button key={p} className="nav-item" data-on={page === p ? '1' : '0'} onClick={() => setPage(p)}>
      <Icon name={icon} size={20} />
      <span>{t(label)}</span>
    </button>
  )

  return (
    <nav className="sidebar">
      <div className="nav-main">{ITEMS.map((i) => item(i.page, i.icon, i.label))}</div>
      {item('settings', 'gear', 'nav.settings')}
    </nav>
  )
}
