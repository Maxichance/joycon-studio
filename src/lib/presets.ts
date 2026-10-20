export type Zones = { body: string; buttons: string }
export type Preset = { id: string; left: Zones; right: Zones }

export const PRESETS: Preset[] = [
  { id: 'neon', left: { body: '#0AB9E6', buttons: '#001E1E' }, right: { body: '#FF3C28', buttons: '#1E0A0A' } },
  { id: 'greenpink', left: { body: '#1EDC00', buttons: '#002800' }, right: { body: '#FF3278', buttons: '#28000F' } },
  { id: 'grey', left: { body: '#828282', buttons: '#0F0F0F' }, right: { body: '#828282', buttons: '#0F0F0F' } },
  { id: 'white', left: { body: '#E8E8E8', buttons: '#222225' }, right: { body: '#E8E8E8', buttons: '#222225' } },
  { id: 'snes', left: { body: '#C0C0C8', buttons: '#666670' }, right: { body: '#C0C0C8', buttons: '#666670' } },
  { id: 'gamecube', left: { body: '#4B3CA7', buttons: '#222225' }, right: { body: '#4B3CA7', buttons: '#222225' } },
  { id: 'meadow', left: { body: '#82FF96', buttons: '#FFFFFF' }, right: { body: '#82E6FF', buttons: '#FFFFFF' } },
]

export const SWATCHES = [
  '#0AB9E6', '#FF3C28', '#1EDC00', '#FF3278', '#E6FF00', '#7014C8', '#FF8200', '#E8E8E8', '#828282', '#222225',
]

export const isHex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v)

/** Couleur de texte lisible sur un fond donné. */
export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 150 ? '#101216' : '#ffffff'
}
