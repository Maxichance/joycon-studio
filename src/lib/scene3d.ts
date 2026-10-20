import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Side, Telemetry } from '@/lib/ipc'
import { buildJoyCon, type JoyModel } from './joycon3d'
import { applyFrame, Attitude, DEFAULT_FRAME, DEFAULT_FRAME_RIGHT, type Mat3 } from './orientation'

export type Mode = 'live' | 'free'

/** `k` : échelle d'apparition (ressort de 0 à 1) ; `leaving` : la manette est partie, elle rétrécit avant d'être retirée. */
type Entry = { model: JoyModel; holder: THREE.Group; att: Attitude; frame: Mat3; last: number; k: number; v: number; leaving: boolean }

const UP = new THREE.Vector3(0, 1, 0)

export class Scene3D {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 2000)
  private controls: OrbitControls
  private entries = new Map<Side, Entry>()
  private mode: Mode = 'live'
  private raf = 0
  private observer: ResizeObserver

  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2e38, 1.9))
    const key = new THREE.DirectionalLight(0xffffff, 1.9)
    key.position.set(90, 180, 130)
    const fill = new THREE.DirectionalLight(0xbfd8ff, 0.7)
    fill.position.set(-140, 40, 90)
    this.scene.add(key, fill)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.enablePan = false
    this.controls.minDistance = 120
    this.controls.maxDistance = 520
    this.applyMode()

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas.parentElement ?? canvas)
    this.resize()
    this.loop()
  }

  private applyMode() {
    if (this.mode === 'live') this.camera.position.set(0, 120, 190)
    else this.camera.position.set(0, 0, 300)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return
    this.mode = mode
    this.applyMode()
  }

  setSides(sides: Side[]) {
    for (const [side, e] of this.entries) e.leaving = !sides.includes(side)
    for (const side of sides) {
      if (!this.entries.has(side)) {
        const model = buildJoyCon(side)
        const holder = new THREE.Group()
        holder.add(model.group)
        holder.scale.setScalar(0.0001)
        this.scene.add(holder)
        this.entries.set(side, {
          model,
          holder,
          att: new Attitude(),
          frame: side === 'right' ? DEFAULT_FRAME_RIGHT : DEFAULT_FRAME,
          last: 0,
          k: 0,
          v: 0,
          leaving: false,
        })
      }
    }
    sides.forEach((side) => {
      const e = this.entries.get(side)!
      e.holder.position.x = sides.length === 2 ? (side === 'left' ? -42 : 42) : 0
    })
  }

  setColors(side: Side, body: string, buttons: string) {
    this.entries.get(side)?.model.setColors(body, buttons)
  }

  setFrame(side: Side, frame: Mat3) {
    const e = this.entries.get(side)
    if (e) e.frame = frame
  }

  feed(t: Telemetry) {
    const e = this.entries.get(t.side)
    if (!e) return
    const now = performance.now()
    if (e.last) e.att.update(t.accel, t.gyro, (now - e.last) / 1000)
    e.last = now
    e.model.setInput(t.pressed, t.stick)
  }

  recenter() {
    this.entries.forEach((e) => e.att.resetYaw())
  }

  private resize() {
    const box = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect()
    const w = Math.max(1, Math.floor(box.width))
    const h = Math.max(1, Math.floor(box.height))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    for (const [side, e] of this.entries) {
      e.v = (e.v + ((e.leaving ? 0 : 1) - e.k) * 0.14) * 0.8
      e.k += e.v
      e.holder.scale.setScalar(Math.max(e.k, 0.0001))
      e.holder.rotation.y = (1 - e.k) * Math.PI * 1.6 * (side === 'left' ? 1 : -1)
      if (e.leaving && e.k < 0.02) {
        this.scene.remove(e.holder)
        e.model.dispose()
        this.entries.delete(side)
        continue
      }
      e.model.tick()
      const target = new THREE.Quaternion()
      if (this.mode === 'live') {
        const up = new THREE.Vector3(...applyFrame(e.frame, e.att.up)).normalize()
        target.setFromAxisAngle(UP, e.att.yaw).multiply(new THREE.Quaternion().setFromUnitVectors(up, UP))
      }
      e.model.group.quaternion.slerp(target, 0.35)
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.observer.disconnect()
    this.controls.dispose()
    this.entries.forEach((e) => e.model.dispose())
    this.entries.clear()
    this.renderer.dispose()
  }
}
