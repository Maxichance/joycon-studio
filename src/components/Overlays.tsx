import { useEffect } from 'react'
import { engine } from '@/lib/ipc'
import { formatBytes } from '@/lib/format'
import { dismissTask, useTasks } from '@/stores/devices'
import { dismissToast, useT, useUi } from '@/stores/ui'
import { Icon } from './Icon'

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className="toast" data-kind={x.kind} onClick={() => dismissToast(x.id)}>
          {x.text}
        </div>
      ))}
    </div>
  )
}

export function TaskCenter() {
  const t = useT()
  const tasks = useTasks((s) => s.tasks)
  if (tasks.length === 0) return null
  return (
    <div className="tasks">
      {tasks.map((k) => {
        const pct = k.total > 0 ? Math.round((k.done / k.total) * 100) : 0
        const running = k.state === 'running'
        return (
          <div key={k.id} className="task" data-state={k.state}>
            <div className="task-head">
              <strong>{t('task.dump')}</strong>
              {running ? (
                <button className="icon-btn" onClick={() => engine.cancelTask(k.id)} aria-label={t('task.cancel')} title={t('task.cancel')}>
                  <Icon name="stop" size={14} />
                </button>
              ) : (
                <button className="icon-btn" onClick={() => dismissTask(k.id)} aria-label={t('common.close')}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
            <div className="bar">
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="task-foot">
              {k.state === 'running' && `${formatBytes(k.done)} / ${formatBytes(k.total)}`}
              {k.state === 'done' && t('task.done')}
              {k.state === 'cancelled' && t('task.cancelled')}
              {k.state === 'error' && t('task.error')}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ConfirmHost() {
  const t = useT()
  const req = useUi((s) => s.confirmRequest)

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') req.resolve(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])

  if (!req) return null
  return (
    <div className="scrim" onClick={() => req.resolve(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-title">{req.title}</h2>
        <p>{req.body}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={() => req.resolve(false)}>
            {t('common.cancel')}
          </button>
          <button className={req.danger ? 'btn danger' : 'btn primary'} autoFocus onClick={() => req.resolve(true)}>
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
