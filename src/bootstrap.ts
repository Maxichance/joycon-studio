import { engine, onDevices, onJoyEvent } from '@/lib/ipc'
import { clearTelemetry, controllerOf, pushTask, pushTelemetry, useDevices, useIr } from '@/stores/devices'
import { toast, tr } from '@/stores/ui'

/** Branche les événements du moteur sur les stores. Appelé une fois au démarrage. */
export async function bootstrap() {
  await onJoyEvent((e) => {
    if (e.kind === 'telemetry') pushTelemetry(e)
    else if (e.kind === 'ir') useIr.setState({ frame: e })
    else pushTask(e)
  })

  await onDevices((next) => {
    const prev = useDevices.getState()
    if (prev.loaded) {
      for (const side of ['left', 'right'] as const) {
        const was = controllerOf(prev.snapshot, side)
        const now = controllerOf(next, side)
        if (!was && now && !next.demo) toast('success', tr(side === 'left' ? 'toast.connectedLeft' : 'toast.connectedRight'))
        if (was && !now && !prev.snapshot.demo) {
          toast('info', tr(side === 'left' ? 'toast.lostLeft' : 'toast.lostRight'))
          clearTelemetry(side)
        }
      }
    }
    useDevices.getState().set(next)
  })

  useDevices.getState().set(await engine.snapshot())
}
