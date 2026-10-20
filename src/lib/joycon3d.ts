import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import leftSvg from '@/assets/joycon-left.svg?raw'
import rightSvg from '@/assets/joycon-right.svg?raw'
import type { Side } from '@/lib/ipc'

/** Dimensions réelles d'un Joy-Con : 102 x 35,9 mm. Le dessin SVG fait 158 x 452 unités. */
const MM = 35.9 / 158
const mm = (v: number) => v / MM

const BODY_DEPTH = mm(8.6)
const STICK_TILT = (18 * Math.PI) / 180

/** Profondeur et décalage en z (en mm) des pièces extrudées. */
const PARTS: Record<string, { depth: number; z: number }> = {
  body: { depth: 8.6, z: 0 },
  rail: { depth: 9.4, z: -0.4 },
  sl: { depth: 3.2, z: 2.7 },
  sr: { depth: 3.2, z: 2.7 },
  zl: { depth: 3, z: -0.2 },
  zr: { depth: 3, z: -0.2 },
  l: { depth: 3, z: 5.2 },
  r: { depth: 3, z: 5.2 },
  minus: { depth: 1, z: 8.6 },
  plus: { depth: 1, z: 8.6 },
  capture: { depth: 1, z: 8.6 },
  home: { depth: 1.6, z: 8.6 },
  'dpad-up': { depth: 1.4, z: 8.6 },
  'dpad-down': { depth: 1.4, z: 8.6 },
  'dpad-left': { depth: 1.4, z: 8.6 },
  'dpad-right': { depth: 1.4, z: 8.6 },
  a: { depth: 1.4, z: 8.6 },
  b: { depth: 1.4, z: 8.6 },
  x: { depth: 1.4, z: 8.6 },
  y: { depth: 1.4, z: 8.6 },
  'stick-ring': { depth: 1, z: 8.6 },
}

const FIXED_COLOR: Record<string, string> = { rail: '#3a3d42', zl: '#2b2d31', zr: '#2b2d31', l: '#3a3d42', r: '#3a3d42', home: '#787b86' }

/** Miroir sur y (le SVG a l'axe y vers le bas), en gardant des faces tournées vers l'extérieur. */
function mirrorY(geo: THREE.BufferGeometry) {
  for (const name of ['position', 'normal'] as const) {
    const a = geo.getAttribute(name)
    if (!a) continue
    for (let i = 0; i < a.count; i++) a.setY(i, -a.getY(i))
    a.needsUpdate = true
  }
  if (geo.index) {
    const idx = geo.index
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getY(i)
      idx.setY(i, idx.getZ(i))
      idx.setZ(i, b)
    }
    idx.needsUpdate = true
  } else {
    for (const name of Object.keys(geo.attributes)) {
      const a = geo.getAttribute(name) as THREE.BufferAttribute
      const n = a.itemSize
      for (let t = 0; t < a.count; t += 3) {
        for (let k = 0; k < n; k++) {
          const v1 = a.array[(t + 1) * n + k]
          a.array[(t + 1) * n + k] = a.array[(t + 2) * n + k]
          a.array[(t + 2) * n + k] = v1
        }
      }
      a.needsUpdate = true
    }
  }
  geo.computeBoundingBox()
}

function shapesOf(path: THREE.ShapePath): THREE.Shape[] {
  path.userData = { ...(path.userData ?? {}), style: { ...(path.userData?.style ?? {}), fill: '#000000' } }
  return SVGLoader.createShapes(path)
}

function extrude(shapes: THREE.Shape[], depth: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: true,
    bevelThickness: mm(0.25),
    bevelSize: mm(0.25),
    bevelSegments: 2,
    curveSegments: 14,
  })
  mirrorY(g)
  return g
}

function flat(shapes: THREE.Shape[]): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shapes, 10)
  mirrorY(g)
  return g
}

function fillOf(node: Element): string {
  const m = /fill:\s*(#[0-9a-fA-F]{3,8})/.exec(node.getAttribute('style') ?? '')
  return m ? m[1] : '#ffffff'
}

type PartInfo = { zone: string; btn: string | null; solids: THREE.Shape[][]; decor: { shapes: THREE.Shape[]; color: string }[] }

export type JoyModel = {
  group: THREE.Group
  setColors: (body: string, buttons: string) => void
  setInput: (pressed: string[], stick: { x: number; y: number }) => void
  tick: () => void
  dispose: () => void
}

export function buildJoyCon(side: Side): JoyModel {
  const svg = side === 'left' ? leftSvg : rightSvg
  const data = new SVGLoader().parse(svg)
  const vb = /viewBox="([^"]+)"/.exec(svg)![1].split(/\s+/).map(Number)
  const [cx0, cy0] = [vb[0] + vb[2] / 2, vb[1] + vb[3] / 2]

  const parts = new Map<string, PartInfo>()
  for (const p of data.paths) {
    const node = p.userData?.node as Element
    const g = node?.closest?.('[data-part]')
    if (!g) continue
    const name = g.getAttribute('data-part')!
    const info = parts.get(name) ?? { zone: g.getAttribute('data-zone')!, btn: g.getAttribute('data-btn'), solids: [], decor: [] }
    const shapes = shapesOf(p)
    if (shapes.length) {
      const cls = node.getAttribute('class')
      if (cls === 'fill' || cls === 'fixed') info.solids.push(shapes)
      else info.decor.push({ shapes, color: fillOf(node) })
    }
    parts.set(name, info)
  }

  const mats = {
    body: new THREE.MeshStandardMaterial({ color: '#808080', roughness: 0.5, metalness: 0.02 }),
    buttons: new THREE.MeshStandardMaterial({ color: '#202020', roughness: 0.42, metalness: 0.05 }),
  }
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [mats.body, mats.buttons]
  const fixedMats = new Map<string, THREE.MeshStandardMaterial>()
  const fixedMat = (name: string) => {
    let m = fixedMats.get(name)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: FIXED_COLOR[name] ?? '#3a3d42', roughness: 0.55, metalness: 0.1 })
      fixedMats.set(name, m)
      owned.push(m)
    }
    return m
  }
  const decorMats = new Map<string, THREE.MeshStandardMaterial>()
  const decorMat = (color: string) => {
    let m = decorMats.get(color)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 })
      decorMats.set(color, m)
      owned.push(m)
    }
    return m
  }

  const root = new THREE.Group()
  const inner = new THREE.Group()
  inner.position.set(-cx0, cy0, -BODY_DEPTH / 2)
  root.add(inner)
  root.scale.setScalar(MM)

  const pressable: { group: THREE.Group; restZ: number; kind: string; btn: string; k: number }[] = []
  let stickPivot: THREE.Group | null = null

  for (const [name, info] of parts) {
    if (name === 'stick-cap') continue
    const spec = PARTS[name]
    if (!spec) continue
    const g = new THREE.Group()
    g.position.z = mm(spec.z)
    const mat = info.zone === 'body' ? mats.body : info.zone === 'buttons' ? mats.buttons : fixedMat(name)
    for (const shapes of info.solids) {
      const geo = extrude(shapes, mm(spec.depth))
      owned.push(geo)
      g.add(new THREE.Mesh(geo, mat))
    }
    for (const d of info.decor) {
      const geo = flat(d.shapes)
      owned.push(geo)
      const m = new THREE.Mesh(geo, decorMat(d.color))
      m.position.z = mm(spec.depth) + mm(0.3)
      g.add(m)
    }
    inner.add(g)
    if (info.btn && name !== 'stick-ring') pressable.push({ group: g, restZ: g.position.z, kind: name, btn: info.btn, k: 0 })
  }

  // Le stick : base fixe, tige et capuchon qui basculent autour du pivot.
  const ring = parts.get('stick-ring')
  const cap = parts.get('stick-cap')
  if (ring && cap && ring.solids[0]) {
    const rg = extrude(ring.solids[0], mm(1))
    const box = rg.boundingBox!
    const [sx, sy] = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2]
    rg.dispose()
    const capGeoBase = cap.solids[0] ? flat(cap.solids[0]) : null
    const capBox = capGeoBase?.boundingBox
    const capR = capBox ? (capBox.max.x - capBox.min.x) / 2 : mm(5)
    capGeoBase?.dispose()

    stickPivot = new THREE.Group()
    stickPivot.position.set(sx, sy, mm(9.6))
    const shaft = new THREE.CylinderGeometry(mm(2.4), mm(2.8), mm(3.2), 20)
    shaft.rotateX(Math.PI / 2)
    shaft.translate(0, 0, mm(1.6))
    const top = new THREE.CylinderGeometry(capR, capR * 0.96, mm(2), 36)
    top.rotateX(Math.PI / 2)
    top.translate(0, 0, mm(3.2) + mm(1))
    owned.push(shaft, top)
    stickPivot.add(new THREE.Mesh(shaft, mats.buttons), new THREE.Mesh(top, mats.buttons))
    for (const d of cap.decor) {
      const geo = flat(d.shapes)
      geo.translate(-sx, -sy, 0)
      owned.push(geo)
      const m = new THREE.Mesh(geo, decorMat('#6b7280'))
      m.position.z = mm(3.2) + mm(2) + mm(0.15)
      stickPivot.add(m)
    }
    inner.add(stickPivot)
  }

  const railDir = side === 'left' ? 1 : -1
  const state = { pressed: new Set<string>(), sx: 0, sy: 0, tx: 0, ty: 0 }

  return {
    group: root,
    setColors(body, buttons) {
      mats.body.color.set(body)
      mats.buttons.color.set(buttons)
    },
    setInput(pressed, stick) {
      state.pressed = new Set(pressed)
      state.tx = stick.x
      state.ty = stick.y
    },
    tick() {
      for (const p of pressable) {
        const target = state.pressed.has(p.btn) ? 1 : 0
        p.k += (target - p.k) * 0.4
        if (p.kind === 'sl' || p.kind === 'sr') {
          p.group.position.x = -railDir * mm(0.9) * p.k
          p.group.position.z = p.restZ
        } else {
          p.group.position.z = p.restZ - mm(p.kind === 'l' || p.kind === 'zl' || p.kind === 'r' || p.kind === 'zr' ? 1.2 : 0.8) * p.k
        }
      }
      if (stickPivot) {
        state.sx += (state.tx - state.sx) * 0.5
        state.sy += (state.ty - state.sy) * 0.5
        stickPivot.rotation.x = -state.sy * STICK_TILT
        stickPivot.rotation.y = state.sx * STICK_TILT
      }
    },
    dispose() {
      owned.forEach((o) => o.dispose())
    },
  }
}
