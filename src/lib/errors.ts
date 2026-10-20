import { EngineError } from '@/lib/ipc'
import { tr } from '@/stores/ui'
import type { TKey } from '@/i18n'

const KNOWN = new Set([
  'no_controller', 'backup_failed', 'read_failed', 'write_refused', 'write_failed', 'verify_failed',
  'timeout', 'unsafe_calibration', 'invalid_backup', 'backup_other_device', 'home_needs_right',
  'ir_needs_right', 'ir_inactive', 'ir_mcu_standby', 'ir_mcu_mode', 'invalid_path', 'demo', 'io',
])

export function errorText(e: unknown): string {
  const code = e instanceof EngineError ? e.code : 'unknown'
  const base = tr(KNOWN.has(code) ? (`err.${code}` as TKey) : 'err.unknown')
  return e instanceof EngineError && e.detail && code === 'io' ? `${base} ${e.detail}` : base
}
