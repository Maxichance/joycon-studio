import { describe, expect, it } from 'vitest'
import { decodeB64, renderIr } from './ir-render'

const image = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) as ImageData

describe('decodeB64', () => {
  it('décode du base64 en octets', () => {
    expect(Array.from(decodeB64('AAEC/w=='))).toEqual([0, 1, 2, 255])
  })
})

describe('renderIr', () => {
  it('pivote l\'image de 90° vers la droite', () => {
    // 2 colonnes x 3 lignes : le pixel (x=0,y=0) = 10 finit en haut à droite de la sortie 3 x 2.
    const src = new Uint8Array([10, 20, 30, 40, 50, 60])
    const out = image(3, 2)
    renderIr(src, 2, 3, 'greyscale', false, out)
    const px = (x: number, y: number) => out.data[(y * 3 + x) * 4]
    expect(px(2, 0)).toBe(10)
    expect(px(0, 0)).toBe(50)
    expect(px(2, 1)).toBe(20)
    expect(px(0, 1)).toBe(60)
  })

  it('applique la palette nocturne sur le canal vert', () => {
    const out = image(1, 1)
    renderIr(new Uint8Array([200]), 1, 1, 'nightvision', false, out)
    expect(Array.from(out.data)).toEqual([0, 200, 0, 255])
  })

  it('étire le contraste quand il y a assez de dynamique', () => {
    const out = image(2, 2)
    renderIr(new Uint8Array([100, 100, 150, 150]), 2, 2, 'greyscale', true, out)
    const values = Array.from({ length: 4 }, (_, i) => out.data[i * 4])
    expect(Math.min(...values)).toBe(0)
    expect(Math.max(...values)).toBe(255)
  })
})
