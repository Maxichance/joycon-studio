import left from '@/assets/joycon-left.svg?raw'
import right from '@/assets/joycon-right.svg?raw'
import type { Side } from '@/lib/ipc'

/** Dessin d'un Joy-Con, colorié par les variables CSS --jc-body et --jc-buttons du parent. */
export function JoyConArt({ side }: { side: Side }) {
  return <div className="jc-art" dangerouslySetInnerHTML={{ __html: side === 'left' ? left : right }} />
}
