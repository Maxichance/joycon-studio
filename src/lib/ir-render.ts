import { IRONBOW } from './ironbow'

export type Palette = 'greyscale' | 'nightvision' | 'ironbow' | 'infrared'
export const PALETTES: Palette[] = ['greyscale', 'nightvision', 'ironbow', 'infrared']

export function decodeB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Couleur d'un niveau de gris pour une palette. */
function shade(p: Palette, v: number): [number, number, number] {
  switch (p) {
    case 'ironbow': {
      const c = IRONBOW[v]
      return [(c >> 16) & 255, (c >> 8) & 255, c & 255]
    }
    case 'nightvision':
      return [0, v, 0]
    case 'infrared':
      return [v, 0, 0]
    default:
      return [v, v, v]
  }
}

/**
 * Pivote l'image de 90° vers la droite (le capteur est monté couché) et la colorise.
 * `pixels` fait width x height ; la sortie fait height x width.
 */
export function renderIr(pixels: Uint8Array, width: number, height: number, p: Palette, stretch: boolean, out: ImageData) {
  let min = 255
  let max = 0
  if (stretch) {
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] < min) min = pixels[i]
      if (pixels[i] > max) max = pixels[i]
    }
  }
  const range = max - min
  const outW = height
  const outH = width
  const d = out.data
  for (let ry = 0; ry < outH; ry++) {
    for (let rx = 0; rx < outW; rx++) {
      let v = pixels[(outW - 1 - rx) * width + ry] ?? 0
      if (stretch && range > 20) v = Math.floor(((v - min) * 255) / range)
      const [r, g, b] = shade(p, v)
      const i = (ry * outW + rx) * 4
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
      d[i + 3] = 255
    }
  }
}
