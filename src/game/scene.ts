import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import type { MapData, Box } from './map'
import { groundHeight } from './map'
import type { PlayerState, NaniteCache } from '../net/types'
import { CFG, CORE_DETAILS } from './config'
import { sound } from './audio'

/**
 * Fresnel kinetic-shield dome (cosmetic). View-dependent rim glow with a
 * slow energy pulse, subtle vertex wobble, and a hit-flash channel.
 * Driven per-frame via uniforms uTime / uFlash / uOpacity.
 */
function makeShieldDomeMaterial(hex: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(hex) },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uOpacity: { value: 1 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      uniform float uTime;
      void main() {
        vPos = position;
        vec3 p = position + normal * (sin(uTime * 3.0 + position.y * 4.0 + position.x * 3.0) * 0.02);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uFlash;
      uniform float uOpacity;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float bands = 0.5 + 0.5 * sin(vPos.y * 14.0 - uTime * 4.0);
        float pulse = 0.75 + 0.25 * sin(uTime * 2.2);
        vec3 col = uColor * (0.25 + fres * 1.6 * pulse + bands * 0.12 + uFlash * 1.5);
        float alpha = (0.06 + fres * 0.55 + bands * 0.05 + uFlash * 0.4) * uOpacity;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })
}

function createNameplateTexture(name: string, isBot = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    // Semi-transparent dark pill background
    ctx.fillStyle = isBot ? 'rgba(15, 23, 42, 0.75)' : 'rgba(8, 14, 26, 0.90)'
    ctx.beginPath()
    if (ctx.roundRect) {
      ctx.roundRect(8, 8, 240, 48, 10)
    } else {
      ctx.rect(8, 8, 240, 48)
    }
    ctx.fill()

    // Cyber border
    ctx.lineWidth = 3
    ctx.strokeStyle = isBot ? 'rgba(100, 116, 139, 0.8)' : '#00f0ff'
    ctx.beginPath()
    if (ctx.roundRect) {
      ctx.roundRect(8, 8, 240, 48, 10)
    } else {
      ctx.rect(8, 8, 240, 48)
    }
    ctx.stroke()

    // Callsign text
    ctx.font = 'bold 22px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = isBot ? '#94a3b8' : '#38bdf8'
    ctx.fillText(name.slice(0, 14).toUpperCase(), 128, 32)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  return texture
}

/** Procedural grayscale hexagonal nanite mesh + granular soil micro-texture for ground plane */
function createTerrainDetailTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#e2e8f0'
  ctx.fillRect(0, 0, 512, 512)

  // Granular micro-stippling
  const imgData = ctx.getImageData(0, 0, 512, 512)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 38
    const val = Math.max(160, Math.min(255, 220 + n))
    d[i] = val
    d[i + 1] = val
    d[i + 2] = val
  }
  ctx.putImageData(imgData, 0, 0)

  // Hexagonal nanite lattice overlay
  const hexR = 24
  const hexW = Math.sqrt(3) * hexR
  const hexH = 2 * hexR * 0.75

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)'
  ctx.lineWidth = 1.6

  function drawHex(cx: number, cy: number) {
    ctx.beginPath()
    for (let a = 0; a < 6; a++) {
      const angle = (Math.PI / 180) * (60 * a - 30)
      const hx = cx + hexR * Math.cos(angle)
      const hy = cy + hexR * Math.sin(angle)
      if (a === 0) ctx.moveTo(hx, hy)
      else ctx.lineTo(hx, hy)
    }
    ctx.closePath()
    ctx.stroke()

    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)'
    ctx.beginPath()
    ctx.arc(cx, cy, 2, 0, Math.PI * 2)
    ctx.fill()
  }

  for (let y = -hexR; y < 512 + hexR; y += hexH) {
    const row = Math.round(y / hexH)
    const offsetX = row % 2 === 0 ? 0 : hexW / 2
    for (let x = -hexW + offsetX; x < 512 + hexW; x += hexW) {
      drawHex(x, y)
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(75, 75)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Procedural modular sci-fi composite plating texture */
function createSciFiPanelTexture(opts: {
  baseColor: string
  highlightColor: string
  seamColor: string
  rivetColor?: string
  accentColor?: string
  label?: string
  hazardBottom?: boolean
  ventPlates?: boolean
}): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = opts.seamColor
  ctx.fillRect(0, 0, 512, 512)

  const rows = 2
  const cols = 2
  const pad = 6
  const pw = (512 - pad * (cols + 1)) / cols
  const ph = (512 - pad * (rows + 1)) / rows

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = pad + c * (pw + pad)
      const py = pad + r * (ph + pad)

      const grad = ctx.createLinearGradient(px, py, px + pw, py + ph)
      grad.addColorStop(0, opts.highlightColor)
      grad.addColorStop(0.25, opts.baseColor)
      grad.addColorStop(0.85, opts.baseColor)
      grad.addColorStop(1, opts.seamColor)
      ctx.fillStyle = grad
      ctx.fillRect(px, py, pw, ph)

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
      ctx.lineWidth = 2
      ctx.strokeRect(px + 4, py + 4, pw - 8, ph - 8)

      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'
      for (let n = 0; n < 30; n++) {
        const nx = px + 6 + Math.random() * (pw - 12)
        const ny = py + 6 + Math.random() * (ph - 12)
        ctx.fillRect(nx, ny, 3 + Math.random() * 4, 1.5)
      }

      const rivetCol = opts.rivetColor || 'rgba(20, 25, 35, 0.7)'
      for (const [rx, ry] of [
        [px + 10, py + 10],
        [px + pw - 10, py + 10],
        [px + 10, py + ph - 10],
        [px + pw - 10, py + ph - 10]
      ]) {
        ctx.fillStyle = rivetCol
        ctx.beginPath()
        ctx.arc(rx, ry, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
        ctx.beginPath()
        ctx.arc(rx - 0.8, ry - 0.8, 1, 0, Math.PI * 2)
        ctx.fill()
      }

      if (opts.ventPlates && (r + c) % 2 === 1) {
        ctx.fillStyle = 'rgba(10, 15, 22, 0.35)'
        for (let v = 0; v < 4; v++) {
          ctx.fillRect(px + 28, py + 45 + v * 12, pw - 56, 4)
        }
      }
    }
  }

  if (opts.hazardBottom) {
    const barY = 512 - 28
    ctx.fillStyle = '#eab308'
    ctx.fillRect(0, barY, 512, 28)
    ctx.fillStyle = '#18181b'
    for (let x = -40; x < 540; x += 32) {
      ctx.beginPath()
      ctx.moveTo(x, 512)
      ctx.lineTo(x + 14, 512)
      ctx.lineTo(x + 30, barY)
      ctx.lineTo(x + 16, barY)
      ctx.closePath()
      ctx.fill()
    }
  }

  if (opts.label) {
    ctx.font = 'bold 16px monospace'
    ctx.fillStyle = opts.accentColor || 'rgba(0, 240, 255, 0.75)'
    ctx.fillText(opts.label, 20, 36)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Heavy industrial blast door with hydraulic struts & status LEDs */
function createBlastDoorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#1b2129'
  ctx.fillRect(0, 0, 512, 512)

  ctx.fillStyle = '#2b3340'
  ctx.fillRect(20, 20, 230, 472)
  ctx.fillRect(262, 20, 230, 472)

  for (const px of [60, 120, 180, 302, 362, 422]) {
    ctx.fillStyle = '#14181f'
    ctx.fillRect(px, 30, 18, 452)
    ctx.fillStyle = '#475569'
    ctx.fillRect(px + 4, 30, 10, 452)
  }

  ctx.fillStyle = '#0f172a'
  ctx.fillRect(250, 20, 12, 472)
  for (let y = 30; y < 480; y += 30) {
    ctx.fillStyle = '#94a3b8'
    ctx.fillRect(248, y, 16, 6)
  }

  ctx.fillStyle = '#f59e0b'
  ctx.fillRect(20, 220, 472, 34)
  ctx.fillStyle = '#111827'
  for (let x = -20; x < 520; x += 30) {
    ctx.beginPath()
    ctx.moveTo(x, 254)
    ctx.lineTo(x + 14, 254)
    ctx.lineTo(x + 28, 220)
    ctx.lineTo(x + 14, 220)
    ctx.closePath()
    ctx.fill()
  }

  ctx.fillStyle = '#22c55e'
  ctx.beginPath()
  ctx.arc(135, 120, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.arc(377, 120, 7, 0, Math.PI * 2)
  ctx.fill()

  ctx.font = 'bold 15px monospace'
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.fillText('MERIDIAN ACCESS // SEC-AIRLOCK 01', 256, 190)

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Cyberpunk curtain wall grid with illuminated office terminals & dark ruined floors */
function createCyberWindowTexture(): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  const emCanvas = document.createElement('canvas')
  emCanvas.width = 512
  emCanvas.height = 512
  const emCtx = emCanvas.getContext('2d')!

  ctx.fillStyle = '#081826'
  ctx.fillRect(0, 0, 512, 512)

  emCtx.fillStyle = '#000000'
  emCtx.fillRect(0, 0, 512, 512)

  const rows = 4
  const cols = 4
  const border = 8
  const w = (512 - border * (cols + 1)) / cols
  const h = (512 - border * (rows + 1)) / rows

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = border + c * (w + border)
      const y = border + r * (h + border)
      const state = (r * 4 + c * 7) % 5

      let winColor = '#0f2942'
      let emColor = '#000000'
      let hasUi = false

      if (state === 0 || state === 3) {
        winColor = '#0b3d63'
        emColor = 'rgba(0, 240, 255, 0.85)'
        hasUi = true
      } else if (state === 1) {
        winColor = '#42280d'
        emColor = 'rgba(245, 158, 11, 0.75)'
        hasUi = true
      } else if (state === 2) {
        winColor = '#1e3a5f'
        emColor = 'rgba(56, 189, 248, 0.55)'
        hasUi = false
      } else {
        winColor = '#08121c'
        emColor = '#000000'
        hasUi = false
      }

      ctx.fillStyle = winColor
      ctx.fillRect(x, y, w, h)

      if (emColor !== '#000000') {
        emCtx.fillStyle = emColor
        emCtx.fillRect(x + 4, y + 4, w - 8, h - 8)
      }

      if (hasUi) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
        emCtx.fillStyle = 'rgba(255, 255, 255, 0.8)'
        for (let l = 0; l < 4; l++) {
          const ly = y + 20 + l * 16
          const lw = 20 + ((c + l) * 23) % 65
          ctx.fillRect(x + 12, ly, lw, 3)
          emCtx.fillRect(x + 12, ly, lw, 3)
        }
      }

      const grad = ctx.createLinearGradient(x, y, x + w, y + h)
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.18)')
      grad.addColorStop(0.3, 'rgba(255, 255, 255, 0.0)')
      grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.08)')
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)')
      ctx.fillStyle = grad
      ctx.fillRect(x, y, w, h)

      ctx.strokeStyle = '#1e293b'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, w, h)
    }
  }

  ctx.fillStyle = '#1e2633'
  for (let c = 0; c <= cols; c++) {
    ctx.fillRect(c * (w + border), 0, border, 512)
  }
  for (let r = 0; r <= rows; r++) {
    ctx.fillRect(0, r * (h + border), 512, border)
  }

  const map = new THREE.CanvasTexture(canvas)
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  map.repeat.set(2, 2)
  map.colorSpace = THREE.SRGBColorSpace

  const emissiveMap = new THREE.CanvasTexture(emCanvas)
  emissiveMap.wrapS = THREE.RepeatWrapping
  emissiveMap.wrapT = THREE.RepeatWrapping
  emissiveMap.repeat.set(2, 2)

  return { map, emissiveMap }
}

/** Dark heavy transit road asphalt with embedded nanite conduits & hazard curbs */
function createRoadAsphaltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#222730'
  ctx.fillRect(0, 0, 512, 512)

  const imgData = ctx.getImageData(0, 0, 512, 512)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 28
    d[i] = Math.max(0, Math.min(255, d[i] + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
  }
  ctx.putImageData(imgData, 0, 0)

  ctx.strokeStyle = '#14181f'
  ctx.lineWidth = 3
  for (let y = 0; y <= 512; y += 128) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(512, y)
    ctx.stroke()
  }

  for (const cx of [80, 432]) {
    ctx.fillStyle = '#14181f'
    ctx.fillRect(cx - 10, 0, 20, 512)
    ctx.fillStyle = 'rgba(0, 240, 255, 0.45)'
    ctx.fillRect(cx - 3, 0, 6, 512)
    ctx.fillStyle = '#334155'
    for (let gy = 0; gy < 512; gy += 16) {
      ctx.fillRect(cx - 9, gy, 18, 3)
    }
  }

  const curbW = 32
  for (const [bx, dir] of [
    [0, 1],
    [512 - curbW, -1]
  ] as const) {
    ctx.fillStyle = '#1e242d'
    ctx.fillRect(bx, 0, curbW, 512)
    ctx.fillStyle = '#eab308'
    for (let y = -curbW; y < 512 + curbW; y += 32) {
      ctx.beginPath()
      ctx.moveTo(bx, y)
      ctx.lineTo(bx + curbW, y + curbW * dir)
      ctx.lineTo(bx + curbW, y + curbW * dir + 14)
      ctx.lineTo(bx, y + 14)
      ctx.closePath()
      ctx.fill()
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1, 8)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Bio-planter garden texture with hydroponic cells & lush vegetation */
function createGardenTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#22381e'
  ctx.fillRect(0, 0, 256, 256)

  ctx.strokeStyle = '#142412'
  ctx.lineWidth = 4
  for (let x = 0; x <= 256; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 256)
    ctx.stroke()
  }
  for (let y = 0; y <= 256; y += 64) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(256, y)
    ctx.stroke()
  }

  const greens = ['#2e7d32', '#388e3c', '#4caf50', '#81c784', '#1b5e20', '#15803d']
  for (let i = 0; i < 350; i++) {
    const gx = Math.random() * 256
    const gy = Math.random() * 256
    const gr = 2 + Math.random() * 4
    ctx.fillStyle = greens[Math.floor(Math.random() * greens.length)]
    ctx.beginPath()
    ctx.arc(gx, gy, gr, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = 'rgba(0, 240, 255, 0.45)'
  for (let x = 32; x < 256; x += 64) {
    for (let y = 32; y < 256; y += 64) {
      ctx.beginPath()
      ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Hazard chevron warning texture for bollards & safety barriers */
function createHazardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#eab308'
  ctx.fillRect(0, 0, 128, 128)

  ctx.fillStyle = '#18181b'
  for (let x = -128; x < 256; x += 32) {
    ctx.beginPath()
    ctx.moveTo(x, 128)
    ctx.lineTo(x + 16, 128)
    ctx.lineTo(x + 48, 0)
    ctx.lineTo(x + 32, 0)
    ctx.closePath()
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1, 4)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Flowing water caustics & ripple texture */
function createWaterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!

  const grad = ctx.createLinearGradient(0, 0, 256, 256)
  grad.addColorStop(0, '#0369a1')
  grad.addColorStop(0.5, '#0284c7')
  grad.addColorStop(1, '#075985')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 256, 256)

  ctx.strokeStyle = 'rgba(186, 230, 253, 0.45)'
  ctx.lineWidth = 2.5
  for (let i = 0; i < 18; i++) {
    const cx = (i * 47) % 256
    const cy = (i * 61) % 256
    const r = 16 + ((i * 11) % 40)
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * 0.6, i * 0.4, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)'
  ctx.lineWidth = 1.5
  for (let i = 0; i < 12; i++) {
    const sx = Math.random() * 256
    const sy = Math.random() * 256
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.bezierCurveTo(sx + 30, sy - 20, sx + 50, sy + 30, sx + 80, sy + 10)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Cyberpunk holographic broadcast billboard for Central Meridian Hub faces */
function createHoloSignTexture(opts: {
  title: string
  subtitle: string
  desc: string
  badge: string
  accentColor: string
  secondaryColor?: string
}): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = 'rgba(8, 14, 26, 0.90)'
  ctx.fillRect(0, 0, 512, 256)

  ctx.strokeStyle = opts.accentColor
  ctx.lineWidth = 3
  const bPad = 12
  ctx.beginPath()
  ctx.moveTo(bPad, bPad + 30)
  ctx.lineTo(bPad, bPad)
  ctx.lineTo(bPad + 30, bPad)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(512 - bPad - 30, bPad)
  ctx.lineTo(512 - bPad, bPad)
  ctx.lineTo(512 - bPad, bPad + 30)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(bPad, 256 - bPad - 30)
  ctx.lineTo(bPad, 256 - bPad)
  ctx.lineTo(bPad + 30, 256 - bPad)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(512 - bPad - 30, 256 - bPad)
  ctx.lineTo(512 - bPad, 256 - bPad)
  ctx.lineTo(512 - bPad, 256 - bPad - 30)
  ctx.stroke()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
  for (let y = 0; y < 256; y += 4) {
    ctx.fillRect(0, y, 512, 1.5)
  }

  ctx.fillStyle = opts.accentColor
  ctx.fillRect(bPad + 16, bPad + 14, 8, 20)
  ctx.font = 'bold 13px monospace'
  ctx.fillStyle = opts.accentColor
  ctx.fillText(opts.badge.toUpperCase(), bPad + 32, bPad + 28)

  ctx.font = '900 28px monospace'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(opts.title.toUpperCase(), bPad + 16, bPad + 68)

  ctx.font = 'bold 16px monospace'
  ctx.fillStyle = opts.secondaryColor || opts.accentColor
  ctx.fillText(opts.subtitle.toUpperCase(), bPad + 16, bPad + 98)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(bPad + 16, bPad + 115)
  ctx.lineTo(512 - bPad - 16, bPad + 115)
  ctx.stroke()

  ctx.fillStyle = opts.accentColor
  for (let x = bPad + 16; x < 512 - bPad - 16; x += 8) {
    const waveH = 4 + Math.sin(x * 0.12) * 8 + Math.cos(x * 0.05) * 6
    ctx.fillRect(x, bPad + 135 - waveH / 2, 4, waveH)
  }

  ctx.font = '14px monospace'
  ctx.fillStyle = '#cbd5e1'
  ctx.fillText(opts.desc.toUpperCase(), bPad + 16, 256 - bPad - 35)

  ctx.fillStyle = opts.accentColor
  ctx.beginPath()
  ctx.arc(512 - bPad - 36, bPad + 28, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = 'bold 11px monospace'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('LIVE RELAY', 512 - bPad - 116, bPad + 32)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Procedural banded gas-giant texture for Boreas */
function createBoreasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#1e0538'
  ctx.fillRect(0, 0, 512, 256)

  const bands = [
    { y: 0, h: 28, c1: '#2e0854', c2: '#3b0764' },
    { y: 28, h: 32, c1: '#4a044e', c2: '#581c87' },
    { y: 60, h: 24, c1: '#06b6d4', c2: '#0891b2' },
    { y: 84, h: 36, c1: '#311042', c2: '#240638' },
    { y: 120, h: 42, c1: '#701a75', c2: '#86198f' },
    { y: 162, h: 30, c1: '#164e63', c2: '#0e7490' },
    { y: 192, h: 36, c1: '#4c0519', c2: '#581c87' },
    { y: 228, h: 28, c1: '#1e0b36', c2: '#2e0854' }
  ]

  for (const b of bands) {
    const grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h)
    grad.addColorStop(0, b.c1)
    grad.addColorStop(1, b.c2)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(0, b.y)
    for (let x = 0; x <= 512; x += 16) {
      const wave = Math.sin(x * 0.04 + b.y * 0.1) * 3 + Math.cos(x * 0.08) * 1.5
      ctx.lineTo(x, b.y + wave)
    }
    ctx.lineTo(512, b.y + b.h)
    for (let x = 512; x >= 0; x -= 16) {
      const wave = Math.sin(x * 0.04 + (b.y + b.h) * 0.1) * 3
      ctx.lineTo(x, b.y + b.h + wave)
    }
    ctx.closePath()
    ctx.fill()
  }

  // Great Boreas Storm Vortex (latitude ~ -25%)
  const sx = 340
  const sy = 175
  const sw = 48
  const sh = 24
  ctx.save()
  ctx.translate(sx, sy)
  ctx.rotate(-0.1)
  const stormGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, sw)
  stormGrad.addColorStop(0, '#f43f5e')
  stormGrad.addColorStop(0.35, '#c026d3')
  stormGrad.addColorStop(0.7, '#7e22ce')
  stormGrad.addColorStop(1, 'transparent')
  ctx.fillStyle = stormGrad
  ctx.beginPath()
  ctx.ellipse(0, 0, sw, sh, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(0, 0, sw * 0.55, sh * 0.55, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  const limb = ctx.createLinearGradient(0, 0, 512, 0)
  limb.addColorStop(0, 'rgba(10, 2, 20, 0.65)')
  limb.addColorStop(0.15, 'rgba(0, 0, 0, 0.0)')
  limb.addColorStop(0.85, 'rgba(0, 0, 0, 0.0)')
  limb.addColorStop(1, 'rgba(10, 2, 20, 0.65)')
  ctx.fillStyle = limb
  ctx.fillRect(0, 0, 512, 256)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Procedural concentric radial rings for Boreas planetary system */
function createBoreasRingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  ctx.clearRect(0, 0, 512, 512)

  const cx = 256
  const cy = 256
  const rIn = 256 * (82 / 145) // ~145 px
  const rOut = 254

  const radGrad = ctx.createRadialGradient(cx, cy, rIn - 4, cx, cy, rOut)
  radGrad.addColorStop(0.0, 'rgba(0, 0, 0, 0.0)')
  radGrad.addColorStop(0.05, 'rgba(168, 85, 247, 0.4)')
  radGrad.addColorStop(0.25, 'rgba(192, 132, 252, 0.85)')
  radGrad.addColorStop(0.48, 'rgba(232, 121, 249, 0.95)')
  radGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.0)')
  radGrad.addColorStop(0.56, 'rgba(0, 0, 0, 0.0)')
  radGrad.addColorStop(0.58, 'rgba(168, 85, 247, 0.8)')
  radGrad.addColorStop(0.85, 'rgba(147, 51, 234, 0.65)')
  radGrad.addColorStop(0.97, 'rgba(126, 34, 206, 0.35)')
  radGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)')

  ctx.fillStyle = radGrad
  ctx.beginPath()
  ctx.arc(cx, cy, rOut, 0, Math.PI * 2)
  ctx.arc(cx, cy, rIn, 0, Math.PI * 2, true)
  ctx.closePath()
  ctx.fill()

  for (let r = rIn + 12; r < rOut - 6; r += 5) {
    const norm = (r - rIn) / (rOut - rIn)
    if (norm >= 0.48 && norm <= 0.58) continue
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class SceneRenderer {
  public scene: THREE.Scene
  public camera: THREE.PerspectiveCamera
  public renderer: THREE.WebGLRenderer
  private playerMeshes = new Map<number, THREE.Group>()
  private clouds: THREE.Mesh[] = []

  // First-Person Robot Arm Viewmodel & Effects
  private robotArm!: THREE.Group
  private armConduitMat!: THREE.MeshBasicMaterial
  private armCoreMat!: THREE.MeshBasicMaterial
  private muzzleFlash!: THREE.Group
  private muzzleFlashTime = 0
  private armRecoil = 0
  private armRecoilRot = 0
  private bobTimer = 0
  // Nanite hand <-> blaster morph (cosmetic): blaster on shot, hand after 5s idle
  private blasterMorph = 0 // 0 = open hand, 1 = blaster gun
  private blasterTarget = 0
  private lastMorphTarget = 0
  private timeSinceShot = 99
  private fingerGroups: THREE.Group[] = []
  private fingerHandRotX: number[] = []
  private fingerBlasterRotX: number[] = []
  private fingerBaseX: number[] = []
  private blasterBarrel!: THREE.Group
  private blasterCore!: THREE.Mesh
  private thumbMesh!: THREE.Mesh
  private readonly morphDim = new THREE.Color(0x1e4a52)
  private firstPersonShield!: THREE.Group
  // Kinetic shield FX state (cosmetic): fade in/out, pulse clock, hit flash
  private fpShieldDomeMat!: THREE.ShaderMaterial
  private fpShieldRingMat!: THREE.MeshBasicMaterial
  private fpShieldFade = 0
  private fpShieldTarget = 0
  private fpShieldFlash = 0
  private shieldTime = 0
  private projectiles: { mesh: THREE.Group; vel: THREE.Vector3; dist: number; maxDist: number }[] = []
  private sparks: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = []
  private naniteCacheMeshes = new Map<number, {
    group: THREE.Group
    coreMesh: THREE.Mesh
    ringMesh: THREE.Mesh
    baseY: number
    phase: number
  }>()

  // Environmental graphics & animated elements
  private waterTexture?: THREE.CanvasTexture
  private holoMaterials: THREE.MeshBasicMaterial[] = []
  private courtyardShrine?: THREE.Group
  private towerBeacon?: THREE.PointLight
  private boreasPlanet?: THREE.Mesh
  private streetlampLights: THREE.PointLight[] = []
  private plazaLight?: THREE.PointLight

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene()
    // Atmospheric daytime depth haze (bright sky blue)
    this.scene.fog = new THREE.FogExp2(0x7ab0d0, 0.00055)

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1800)
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.25
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.setupSky()
    this.setupLighting()
    this.setupCosmos()
    this.setupClouds()

    // Add camera to scene graph so camera children (robot arm, FP shield) render in camera space
    this.scene.add(this.camera)
    this.setupRobotArm()
    this.setupFirstPersonShield()

    window.addEventListener('resize', this.onResize)
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private setupRobotArm() {
    this.robotArm = new THREE.Group()
    this.robotArm.name = 'robotArm'
    this.robotArm.position.set(0.28, -0.22, -0.42)
    this.robotArm.rotation.set(0.05, -0.06, -0.04)

    const armMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1e242e,
      roughness: 0.35,
      metalness: 0.85
    })
    const armJointMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.25,
      metalness: 0.95
    })
    this.armConduitMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff })
    this.armCoreMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff })

    // Forearm main sleeve
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.34), armMetalMat)
    sleeve.position.set(0, 0, 0.12)
    this.robotArm.add(sleeve)

    // Top armor plate
    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.28), armJointMat)
    topPlate.position.set(0, 0.055, 0.11)
    this.robotArm.add(topPlate)

    // Glowing energy conduits along forearm
    const conduitGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.32, 8)
    const leftConduit = new THREE.Mesh(conduitGeo, this.armConduitMat)
    leftConduit.rotation.x = Math.PI / 2
    leftConduit.position.set(-0.045, 0.045, 0.12)
    this.robotArm.add(leftConduit)

    const rightConduit = new THREE.Mesh(conduitGeo, this.armConduitMat)
    rightConduit.rotation.x = Math.PI / 2
    rightConduit.position.set(0.045, 0.045, 0.12)
    this.robotArm.add(rightConduit)

    // Articulated wrist gimbal
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 16), armJointMat)
    wrist.rotation.z = Math.PI / 2
    wrist.position.set(0, 0, -0.04)
    this.robotArm.add(wrist)

    // Palm base
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.1), armMetalMat)
    palm.position.set(0, 0, -0.1)
    this.robotArm.add(palm)

    // Central Heavy Pulse Cannon Assembly
    // Morphed by nanites: retracted into palm in hand mode (m=0), extends out in blaster mode (m=1)
    const blasterGrp = new THREE.Group()
    blasterGrp.position.set(0, 0.005, -0.11)

    // Main heavy rifled barrel
    const barrelGeo = new THREE.CylinderGeometry(0.032, 0.038, 0.15, 16)
    const barrel = new THREE.Mesh(barrelGeo, armJointMat)
    barrel.rotation.x = Math.PI / 2
    blasterGrp.add(barrel)

    // Ported muzzle brake / crown
    const muzzleBrakeGeo = new THREE.CylinderGeometry(0.042, 0.040, 0.035, 16)
    const muzzleBrake = new THREE.Mesh(muzzleBrakeGeo, armMetalMat)
    muzzleBrake.rotation.x = Math.PI / 2
    muzzleBrake.position.z = -0.075
    blasterGrp.add(muzzleBrake)

    // Accelerator glow ring
    const glowRingGeo = new THREE.TorusGeometry(0.036, 0.007, 8, 16)
    const glowRing = new THREE.Mesh(glowRingGeo, this.armCoreMat)
    glowRing.position.z = -0.02
    blasterGrp.add(glowRing)

    this.robotArm.add(blasterGrp)
    this.blasterBarrel = blasterGrp

    // Central plasma reactor sphere
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 12), this.armCoreMat)
    core.position.set(0, 0.005, -0.08)
    this.robotArm.add(core)
    this.blasterCore = core

    // Articulated robotic fingers (hand mode: extended forward / blaster mode: curled magnetic clamp)
    const fingerMat = armJointMat
    const tipMat = this.armConduitMat

    const addFinger = (x: number, y: number, z: number, len: number, handRotX: number, blasterRotX: number) => {
      const fGroup = new THREE.Group()
      fGroup.position.set(x, y, z)
      fGroup.rotation.x = handRotX

      const phalanx = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, len), fingerMat)
      phalanx.position.z = -len / 2
      fGroup.add(phalanx)

      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.015), tipMat)
      tip.position.z = -len - 0.007
      fGroup.add(tip)

      this.robotArm.add(fGroup)
      this.fingerGroups.push(fGroup)
      this.fingerHandRotX.push(handRotX)
      this.fingerBlasterRotX.push(blasterRotX)
      this.fingerBaseX.push(x)
    }

    addFinger(0.034, 0.010, -0.15, 0.070, -0.08, 1.25)  // Index
    addFinger(0.012, 0.012, -0.15, 0.080, -0.05, 1.30)  // Middle
    addFinger(-0.012, 0.012, -0.15, 0.075, -0.05, 1.30) // Ring
    addFinger(-0.034, 0.010, -0.15, 0.060, -0.10, 1.25) // Pinky

    // Thumb on inner edge
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.02, 0.05), fingerMat)
    thumb.position.set(-0.050, -0.005, -0.11)
    thumb.rotation.set(0.1, 0.45, -0.15)
    this.robotArm.add(thumb)
    this.thumbMesh = thumb

    // Muzzle Flash Effect (at tip of extended blaster barrel z = -0.285)
    this.muzzleFlash = new THREE.Group()
    this.muzzleFlash.position.set(0, 0.005, -0.285)
    const flashCore = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), this.armCoreMat)
    const flashCross1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, 0.01), this.armCoreMat)
    const flashCross2 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.22, 0.01), this.armCoreMat)
    this.muzzleFlash.add(flashCore, flashCross1, flashCross2)
    this.muzzleFlash.visible = false
    this.robotArm.add(this.muzzleFlash)

    // Start in open-hand form; first shot morphs to blaster
    this.applyBlasterMorph(0)

    this.camera.add(this.robotArm)
  }

  private setupFirstPersonShield() {
    this.firstPersonShield = new THREE.Group()
    this.firstPersonShield.position.set(0, 0, -0.42)

    // Glowing cyan boundary ring (pulsed in render())
    const fpRingGeo = new THREE.TorusGeometry(0.5, 0.01, 8, 36, Math.PI * 1.6)
    this.fpShieldRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending
    })
    const fpRing = new THREE.Mesh(fpRingGeo, this.fpShieldRingMat)
    fpRing.rotation.z = Math.PI * 0.7
    this.firstPersonShield.add(fpRing)

    // Fresnel kinetic dome (replaces the flat wireframe lattice)
    this.fpShieldDomeMat = makeShieldDomeMaterial(0x38bdf8)
    const fpDome = new THREE.Mesh(new THREE.SphereGeometry(0.48, 32, 24), this.fpShieldDomeMat)
    this.firstPersonShield.add(fpDome)

    this.firstPersonShield.visible = false
    this.camera.add(this.firstPersonShield)
  }

  private setupSky() {
    // Procedural sky (Preetham atmospheric model)
    const sky = new Sky()
    sky.scale.setScalar(10000)
    this.scene.add(sky)

    const skyU = sky.material.uniforms as any
    skyU['turbidity'].value = 2.5
    skyU['rayleigh'].value = 1.5
    skyU['mieCoefficient'].value = 0.005
    skyU['mieDirectionalG'].value = 0.8

    // Sun direction aligned with primary sun directional light (high clear daylight angle)
    const sunPos = new THREE.Vector3(120, 220, 80).normalize()
    skyU['sunPosition'].value.copy(sunPos)
  }

  private setupLighting() {
    // Sky / ground hemisphere light (soft daylight sky blue above, warm bounce ground below)
    const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x889966, 1.1)
    this.scene.add(hemi)

    // Direct warm sun with crisp soft shadows
    const sun = new THREE.DirectionalLight(0xfffaed, 2.4)
    sun.position.set(120, 220, 80)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 1200
    sun.shadow.camera.left = -600
    sun.shadow.camera.right = 600
    sun.shadow.camera.top = 600
    sun.shadow.camera.bottom = -600
    sun.shadow.bias = -0.00005
    sun.shadow.normalBias = 0.03
    this.scene.add(sun)

    // Directional fill light from opposing angle (ensures building shadows remain clearly visible)
    const fill = new THREE.DirectionalLight(0xa0c0e8, 0.8)
    fill.position.set(-100, 80, -80)
    this.scene.add(fill)

    // Ambient global illumination (ensures building interiors and covered areas are bright)
    const ambient = new THREE.AmbientLight(0xffffff, 0.8)
    this.scene.add(ambient)
  }

  private setupCosmos() {
    // Boreas gas giant in orbital sky with atmospheric flow bands & Great Boreas Storm
    const planetGeo = new THREE.SphereGeometry(65, 36, 36)
    const boreasTex = createBoreasTexture()
    const planetMat = new THREE.MeshStandardMaterial({
      map: boreasTex,
      roughness: 0.85,
      metalness: 0.08,
      fog: false
    })
    const planet = new THREE.Mesh(planetGeo, planetMat)
    planet.position.set(-220, 140, -420)
    planet.rotation.z = 0.22 // Axial tilt
    this.scene.add(planet)
    this.boreasPlanet = planet

    // Atmospheric halo behind Boreas
    const haloGeo = new THREE.SphereGeometry(69, 32, 32)
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x9333ea,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      fog: false
    })
    const halo = new THREE.Mesh(haloGeo, haloMat)
    halo.position.copy(planet.position)
    this.scene.add(halo)

    // Concentric planetary rings with Cassini division gap
    const ringGeo = new THREE.RingGeometry(82, 145, 64)
    const ringTex = createBoreasRingTexture()
    const ringMat = new THREE.MeshBasicMaterial({
      map: ringTex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      fog: false
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.copy(planet.position)
    ring.rotation.x = Math.PI * 0.42
    ring.rotation.y = Math.PI * 0.12
    ring.rotation.z = 0.18
    this.scene.add(ring)
  }

  private setupClouds() {
    const palette = [0xffffff, 0xf4f4ff, 0xe8eff8]
    for (let i = 0; i < 24; i++) {
      const cw = 110 + Math.random() * 200
      const ch = 25 + Math.random() * 55
      const mat = new THREE.MeshLambertMaterial({
        color: palette[Math.floor(Math.random() * palette.length)],
        transparent: true,
        opacity: 0.25 + Math.random() * 0.25,
        depthWrite: false,
        fog: false
      })
      const cloud = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), mat)
      cloud.position.set(
        (Math.random() - 0.5) * 850,
        90 + Math.random() * 70,
        (Math.random() - 0.5) * 850
      )
      cloud.rotation.x = -Math.PI / 2
      cloud.rotation.z = Math.random() * Math.PI
      ;(cloud.userData as any).driftX = (0.5 + Math.random() * 1.5) * (Math.random() < 0.5 ? 1 : -1)
      ;(cloud.userData as any).driftZ = (0.3 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1)
      this.scene.add(cloud)
      this.clouds.push(cloud)
    }
  }

  buildMapGeometry(map: MapData) {
    const SIZE = map.floor.w

    // 1. Biome Ground Plane (Vertex-colored + rolling terrain displacement;
    //    rotation baked in so vertices are already world-aligned XZ)
    const gGeo = new THREE.PlaneGeometry(SIZE + 80, SIZE + 80, 150, 150)
    gGeo.rotateX(-Math.PI / 2)
    const gColors: number[] = []
    const pos = gGeo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i)
      const wz = pos.getZ(i)
      const gh = groundHeight(wx, wz, map.seed)
      pos.setY(i, gh)
      const n = (Math.sin(wx * 0.06 + wz * 0.11) * 0.5 +
                 Math.sin(wx * 0.17 - wz * 0.09) * 0.25 +
                 Math.sin(wx * 0.04 + wz * 0.04) * 0.14) * 0.042
      const t = Math.max(0, Math.min(1, (wx + 100) / 200))
      // Terra (+x): vibrant grass green
      const tr = 0.28 + n, tg = 0.52 + n * 0.6, tb = 0.20 + n * 0.5
      // Barren (-x): warm sandstone
      const br = 0.70 + n, bg = 0.60 + n * 0.4, bb = 0.38 + n * 0.3
      // Rocky tint on hilltops, darker soil in hollows
      const rock = Math.max(0, Math.min(1, (gh - 1.2) / 2))
      const shade = 1 + Math.max(-0.12, Math.min(0.06, gh * -0.04))
      const r = (tr * t + br * (1 - t)) * (1 - rock * 0.25) * shade + rock * 0.18
      const g = (tg * t + bg * (1 - t)) * (1 - rock * 0.28) * shade + rock * 0.16
      const b = (tb * t + bb * (1 - t)) * (1 - rock * 0.25) * shade + rock * 0.15
      gColors.push(r, g, b)
    }
    gGeo.setAttribute('color', new THREE.Float32BufferAttribute(gColors, 3))
    gGeo.computeVertexNormals()

    // High-resolution nanite lattice detail multiplied over biome vertex colors
    const groundDetailTex = createTerrainDetailTexture()
    const groundMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: groundDetailTex,
      roughness: 0.90,
      metalness: 0.04
    })
    const ground = new THREE.Mesh(gGeo, groundMat)
    ground.receiveShadow = true
    this.scene.add(ground)

    // 2. Animated water ponds with engineered containment rims & corner beacons
    this.waterTexture = createWaterTexture()
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1490d8,
      map: this.waterTexture,
      roughness: 0.08,
      metalness: 0.72,
      transparent: true,
      opacity: 0.82
    })
    const waterPonds = [
      [80, -75, 38, 26],
      [10, -88, 22, 16],
      [90, 45, 28, 20],
      [70, 80, 24, 18],
      [-20, 30, 14, 10],
      [40, -40, 18, 14]
    ]
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x1e242c,
      roughness: 0.42,
      metalness: 0.85
    })
    const rimGlowMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.65
    })
    for (const [wx, wz, ww, wd] of waterPonds) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(ww, wd), waterMat)
      w.rotation.x = -Math.PI / 2
      w.position.set(wx, 0.08, wz)
      this.scene.add(w)

      // Containment basin curbs
      const curbThick = 0.6
      const curbH = 0.35
      const curbNSGeo = new THREE.BoxGeometry(ww + curbThick * 2, curbH, curbThick)
      const curbN = new THREE.Mesh(curbNSGeo, rimMat)
      curbN.position.set(wx, 0.15, wz - wd / 2 - curbThick / 2)
      const curbS = new THREE.Mesh(curbNSGeo, rimMat)
      curbS.position.set(wx, 0.15, wz + wd / 2 + curbThick / 2)

      const curbEWGeo = new THREE.BoxGeometry(curbThick, curbH, wd)
      const curbE = new THREE.Mesh(curbEWGeo, rimMat)
      curbE.position.set(wx + ww / 2 + curbThick / 2, 0.15, wz)
      const curbW = new THREE.Mesh(curbEWGeo, rimMat)
      curbW.position.set(wx - ww / 2 - curbThick / 2, 0.15, wz)
      this.scene.add(curbN, curbS, curbE, curbW)

      // Corner beacon pylons
      const beaconGeo = new THREE.BoxGeometry(0.5, 0.6, 0.5)
      for (const [bx, bz] of [
        [wx - ww / 2 - curbThick / 2, wz - wd / 2 - curbThick / 2],
        [wx + ww / 2 + curbThick / 2, wz - wd / 2 - curbThick / 2],
        [wx - ww / 2 - curbThick / 2, wz + wd / 2 + curbThick / 2],
        [wx + ww / 2 + curbThick / 2, wz + wd / 2 + curbThick / 2]
      ]) {
        const beacon = new THREE.Mesh(beaconGeo, rimGlowMat)
        beacon.position.set(bx, 0.3, bz)
        this.scene.add(beacon)
      }
    }

    // 3. Procedural architectural PBR materials for map boxes
    const texConcrete = createSciFiPanelTexture({
      baseColor: '#cbd5e1',
      highlightColor: '#e8eff5',
      seamColor: '#64748b',
      rivetColor: '#334155',
      accentColor: '#00f0ff',
      label: 'MRD-HUB'
    })
    const texDarkAlloy = createSciFiPanelTexture({
      baseColor: '#303742',
      highlightColor: '#475262',
      seamColor: '#171c23',
      rivetColor: '#0f141a',
      accentColor: '#38bdf8',
      ventPlates: true
    })
    const texBarren = createSciFiPanelTexture({
      baseColor: '#967451',
      highlightColor: '#b8946e',
      seamColor: '#4d3722',
      rivetColor: '#2b1c0e',
      accentColor: '#f59e0b',
      label: 'MINING-SEC'
    })
    const texTerra = createSciFiPanelTexture({
      baseColor: '#4f7838',
      highlightColor: '#69994c',
      seamColor: '#283d1c',
      rivetColor: '#1a2613',
      accentColor: '#4ade80',
      label: 'ECO-ZONE'
    })
    const texBlastDoor = createBlastDoorTexture()
    const texWindows = createCyberWindowTexture()
    const texRoad = createRoadAsphaltTexture()
    const texGarden = createGardenTexture()
    const texHazard = createHazardTexture()

    const materials: Record<string, THREE.Material> = {
      wall: new THREE.MeshStandardMaterial({ map: texDarkAlloy, roughness: 0.65, metalness: 0.35 }),
      house_body: new THREE.MeshStandardMaterial({ map: texConcrete, roughness: 0.72, metalness: 0.08 }),
      house_window: new THREE.MeshStandardMaterial({
        map: texWindows.map,
        emissiveMap: texWindows.emissiveMap,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.78,
        roughness: 0.12,
        metalness: 0.45
      }),
      house_door: new THREE.MeshStandardMaterial({ map: texBlastDoor, roughness: 0.45, metalness: 0.55 }),
      house_chimney: new THREE.MeshStandardMaterial({ map: texDarkAlloy, roughness: 0.7, metalness: 0.3 }),
      platform: new THREE.MeshStandardMaterial({ map: texDarkAlloy, roughness: 0.68, metalness: 0.35 }),
      garden: new THREE.MeshStandardMaterial({ map: texGarden, roughness: 0.75, metalness: 0.05 }),
      fountain_base: new THREE.MeshStandardMaterial({ map: texDarkAlloy, roughness: 0.55, metalness: 0.4 }),
      fountain_rim: new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        roughness: 0.3,
        emissive: 0x0099bb,
        emissiveIntensity: 0.65
      }),
      fountain_pillar: new THREE.MeshStandardMaterial({ map: texDarkAlloy, roughness: 0.5, metalness: 0.4 }),
      bench: new THREE.MeshStandardMaterial({ map: texDarkAlloy, roughness: 0.55, metalness: 0.45 }),
      lamp_post: new THREE.MeshStandardMaterial({ color: 0x1e242c, roughness: 0.35, metalness: 0.85 }),
      lamp_head: new THREE.MeshStandardMaterial({ color: 0xfff088, emissive: 0xffdd44, emissiveIntensity: 2.0 }),
      bollard: new THREE.MeshStandardMaterial({ map: texHazard, roughness: 0.5, metalness: 0.25 }),
      path: new THREE.MeshStandardMaterial({ map: texRoad, roughness: 0.88, metalness: 0.1 }),
      road_marking: new THREE.MeshStandardMaterial({
        color: 0xffea00,
        emissive: 0x665500,
        emissiveIntensity: 0.55,
        roughness: 0.4
      }),

      // Biome-specific cover & buildings
      cover_terra: new THREE.MeshStandardMaterial({ map: texTerra, roughness: 0.75, metalness: 0.12 }),
      cover_barren: new THREE.MeshStandardMaterial({ map: texBarren, roughness: 0.78, metalness: 0.12 }),
      cover_neutral: new THREE.MeshStandardMaterial({ map: texDarkAlloy, roughness: 0.65, metalness: 0.35 }),

      building_terra: new THREE.MeshStandardMaterial({ map: texConcrete, roughness: 0.72, metalness: 0.08 }),
      building_bar: new THREE.MeshStandardMaterial({ map: texBarren, roughness: 0.78, metalness: 0.12 }),
      building_neutral: new THREE.MeshStandardMaterial({ map: texDarkAlloy, roughness: 0.65, metalness: 0.35 }),

      rand_building: new THREE.MeshStandardMaterial({ map: texConcrete, roughness: 0.72, metalness: 0.08 }),

      pillar_terra: new THREE.MeshStandardMaterial({ map: texTerra, roughness: 0.75, metalness: 0.12 }),
      pillar_barren: new THREE.MeshStandardMaterial({ map: texBarren, roughness: 0.78, metalness: 0.12 }),
      pillar_neutral: new THREE.MeshStandardMaterial({ map: texDarkAlloy, roughness: 0.65, metalness: 0.35 }),

      default: new THREE.MeshStandardMaterial({ map: texDarkAlloy, roughness: 0.65, metalness: 0.35 })
    }

    const groups = new Map<string, Box[]>()
    for (const b of map.boxes) {
      let key = b.type
      if (b.type === 'cover' || b.type === 'building' || b.type === 'pillar') {
        const biomeSuffix = b.biome === 'terra' ? '_terra' : b.biome === 'barren' ? '_barren' : '_neutral'
        key = `${b.type}${biomeSuffix}`
      }
      const finalKey = materials[key] ? key : 'default'
      let arr = groups.get(finalKey)
      if (!arr) {
        arr = []
        groups.set(finalKey, arr)
      }
      arr.push(b)
    }

    const unitBox = new THREE.BoxGeometry(1, 1, 1)
    const dummy = new THREE.Object3D()

    for (const [type, list] of groups) {
      const mat = materials[type]
      const count = list.length
      const inst = new THREE.InstancedMesh(unitBox, mat, count)
      inst.castShadow = true
      inst.receiveShadow = true

      for (let i = 0; i < count; i++) {
        const b = list[i]
        dummy.position.set(b.x, b.y, b.z)
        dummy.scale.set(b.w, b.h, b.d)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        inst.setMatrixAt(i, dummy.matrix)
      }
      inst.instanceMatrix.needsUpdate = true
      this.scene.add(inst)
    }

    // 4. Central Meridian Hub Holographic Billboards (Lore: Season 3049 Broadcast & Makers)
    const holo1Tex = createHoloSignTexture({
      title: 'MERIDIAN CENTRAL HUB',
      subtitle: 'BROADCAST TRIAL // SEASON 3049',
      desc: 'ORBITAL RELAY ACTIVE • 11 MAKERS COMPETING',
      badge: 'OFFICIAL HOST • MERIDIAN CORP',
      accentColor: '#00f0ff',
      secondaryColor: '#38bdf8'
    })
    const holo2Tex = createHoloSignTexture({
      title: 'VELA RELAY COMPACT',
      subtitle: 'WARP LOGISTICS // CORE: TELEPOTU',
      desc: 'BREAKAWAY FREIGHT ENGINEERS • QUANTUM SWAP',
      badge: 'MAKER SHOWCASE // LICENSED CORES',
      accentColor: '#fbbf24',
      secondaryColor: '#f59e0b'
    })
    const holo3Tex = createHoloSignTexture({
      title: 'KURO RACER SYNDICATE',
      subtitle: 'CORE: DENJA // OVERDRIVE BURST',
      desc: '2X VELOCITY • THE CIRCUIT WAITS FOR NO ONE',
      badge: 'SPEED RECORD HOLDER',
      accentColor: '#e879f9',
      secondaryColor: '#c084fc'
    })
    const holo4Tex = createHoloSignTexture({
      title: 'BASTION SIEGE FOUNDRY',
      subtitle: 'CORE: TANK // BULWARK DOCTRINE',
      desc: 'HALF DAMAGE ABSORPTION • UNSTOPPABLE',
      badge: 'MILITARY DEFENSE TECH',
      accentColor: '#38bdf8',
      secondaryColor: '#60a5fa'
    })

    const createBillboard = (tex: THREE.CanvasTexture, w: number, h: number, x: number, y: number, z: number, ry: number) => {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
      mat.userData.baseOpacity = 0.9
      this.holoMaterials.push(mat)

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
      mesh.position.set(x, y, z)
      mesh.rotation.y = ry
      this.scene.add(mesh)

      const frameGeo = new THREE.BoxGeometry(w + 0.4, h + 0.3, 0.08)
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e2633, roughness: 0.4, metalness: 0.8 })
      const frame = new THREE.Mesh(frameGeo, frameMat)
      frame.position.set(x, y, z)
      frame.rotation.y = ry
      frame.translateZ(-0.08)
      this.scene.add(frame)
    }

    // Front (South, facing entrance plaza)
    createBillboard(holo1Tex, 14, 4.4, 0, 12, 7.9, 0)
    // Back (North)
    createBillboard(holo2Tex, 14, 4.4, 0, 12, -7.9, Math.PI)
    // East
    createBillboard(holo3Tex, 10, 4.4, 10.35, 12, 0, Math.PI / 2)
    // West
    createBillboard(holo4Tex, 10, 4.4, -10.35, 12, 0, -Math.PI / 2)

    // 5. Roof Communications Spire & Aviation Beacon on Central Meridian Hub
    const spireGroup = new THREE.Group()
    spireGroup.position.set(0, 19.65, 0)

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.4, 1.2, 8), materials.platform)
    pedestal.position.set(0, 0.6, 0)
    spireGroup.add(pedestal)

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.35, 14, 8),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.3, metalness: 0.9 })
    )
    mast.position.set(0, 8.2, 0)
    spireGroup.add(mast)

    for (const y of [4.0, 7.0, 10.0, 13.0]) {
      const arm1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), materials.platform)
      arm1.position.set(0, y, 0)
      const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.4), materials.platform)
      arm2.position.set(0, y, 0)
      spireGroup.add(arm1, arm2)
    }

    const dish = new THREE.Mesh(
      new THREE.ConeGeometry(2.2, 0.9, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide })
    )
    dish.position.set(0, 8.5, 0.6)
    dish.rotation.x = -Math.PI * 0.35
    dish.rotation.y = Math.PI * 0.1
    spireGroup.add(dish)

    const beaconGeo = new THREE.SphereGeometry(0.35, 8, 8)
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2244 })
    const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat)
    beaconMesh.position.set(0, 15.3, 0)
    spireGroup.add(beaconMesh)

    this.towerBeacon = new THREE.PointLight(0xff2244, 3.5, 55, 1.6)
    this.towerBeacon.position.set(0, 35.0, 0)
    this.scene.add(this.towerBeacon)
    this.scene.add(spireGroup)

    // 6. Courtyard First-Chassis Memorial Shrine (Lore: sacred marked soil of first remote link)
    this.courtyardShrine = new THREE.Group()
    this.courtyardShrine.position.set(0, 3.8, 17)

    const shrinePyramidGeo = new THREE.ConeGeometry(0.8, 1.2, 4)
    const shrinePyramidMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x0099bb,
      emissiveIntensity: 0.85,
      roughness: 0.12,
      metalness: 0.9
    })
    const shrinePyramid = new THREE.Mesh(shrinePyramidGeo, shrinePyramidMat)
    shrinePyramid.rotation.x = Math.PI
    this.courtyardShrine.add(shrinePyramid)

    const shrineHeart = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffaa00 })
    )
    this.courtyardShrine.add(shrineHeart)

    const ring1 = new THREE.Mesh(
      new THREE.TorusGeometry(1.35, 0.022, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75 })
    )
    ring1.rotation.x = Math.PI * 0.28
    ring1.rotation.y = Math.PI * 0.15
    this.courtyardShrine.add(ring1)

    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.02, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.65 })
    )
    ring2.rotation.x = -Math.PI * 0.32
    ring2.rotation.z = Math.PI * 0.25
    this.courtyardShrine.add(ring2)

    const shrineLight = new THREE.PointLight(0x00f0ff, 2.8, 18, 1.6)
    this.courtyardShrine.add(shrineLight)
    this.scene.add(this.courtyardShrine)

    // 7. Streetlamp Point Lights & Plaza Entrance Lighting
    const lampCoords: [number, number, number][] = [
      [-4, 30, 1],
      [4, 30, -1],
      [-4, 57, 1],
      [4, 57, -1],
      [-4, -30, 1],
      [4, -30, -1],
      [-4, -57, 1],
      [4, -57, -1]
    ]
    for (const [lx, lz, arm] of lampCoords) {
      const lampLight = new THREE.PointLight(0xffdf80, 2.2, 24, 1.8)
      lampLight.position.set(lx + arm * 2.5, 9.2, lz)
      this.scene.add(lampLight)
      this.streetlampLights.push(lampLight)
    }

    this.plazaLight = new THREE.PointLight(0x00f0ff, 3.2, 28, 1.6)
    this.plazaLight.position.set(0, 5.2, 11.5)
    this.scene.add(this.plazaLight)
  }

  updatePlayers(players: PlayerState[], localPlayerId: number) {
    const activeIds = new Set<number>()

    for (const p of players) {
      if (p.id === localPlayerId) continue
      activeIds.add(p.id)

      let group = this.playerMeshes.get(p.id)
      if (!group) {
        group = this.createPlayerMesh(p)
        group.userData.renderedName = p.name
        this.scene.add(group)
        this.playerMeshes.set(p.id, group)
      }

      group.visible = p.alive && !p.invisible
      if (group.visible) {
        group.position.set(p.x, p.y, p.z)
        group.rotation.y = p.yaw

        // Rotate tactical beacon diamond
        const beacon = group.getObjectByName('beacon') as THREE.Mesh
        if (beacon) {
          beacon.rotation.y += 0.04
          beacon.rotation.x += 0.02
        }

        // Dynamically refresh nameplate if callsign changed
        if (group.userData.renderedName !== p.name) {
          group.userData.renderedName = p.name
          const np = group.getObjectByName('nameplate') as THREE.Sprite
          if (np && np.material) {
            np.material.map?.dispose()
            np.material.map = createNameplateTexture(p.name, p.isBot)
            np.material.needsUpdate = true
          }
        }

        const shieldMesh = group.getObjectByName('shield') as THREE.Mesh
        if (shieldMesh) {
          shieldMesh.visible = p.shieldActive && Date.now() < p.shieldEnd
        }

        const superMesh = group.getObjectByName('super') as THREE.Mesh
        if (superMesh) {
          superMesh.visible = p.superActive && Date.now() < p.superEnd
        }

        // Humanoid Animation & Gait Cycle
        const h = group.userData.humanoid
        if (h) {
          const prev = group.userData.prevPos as THREE.Vector3
          const distMoved = Math.hypot(p.x - prev.x, p.z - prev.z)
          prev.set(p.x, p.y, p.z)

          const isMoving = distMoved > 0.015
          const walkSpeed = Math.min(distMoved * 70, 12)
          group.userData.animTime += isMoving ? walkSpeed * 0.025 : 0.035
          const t = group.userData.animTime

          // Floating Atma Core animation: slowly rotate & hover inside chest chamber (Lore: floating heart)
          if (h.atmaPyramid) {
            h.atmaPyramid.rotation.y += 0.035
            h.atmaPyramid.position.y = 0.08 + Math.sin(t * 2.5) * 0.008
          }

          if (p.crouching) {
            // Tactical crouch: drop pelvis, articulate knees and lean torso forward
            h.pelvis.position.y = 0.60
            h.spine.rotation.x = 0.22
            h.leftLeg.rotation.x = -0.65
            h.leftLowerLeg.rotation.x = 1.05
            h.rightLeg.rotation.x = -0.65
            h.rightLowerLeg.rotation.x = 1.05
            h.leftArm.rotation.x = 0.35
            h.rightArm.rotation.x = -Math.PI / 2 + 0.30
          } else if (isMoving) {
            // Humanoid walking/running gait cycle
            h.pelvis.position.y = 0.88 + Math.abs(Math.sin(t * 2)) * 0.03
            h.spine.rotation.x = 0.08
            h.spine.rotation.y = Math.sin(t) * 0.06

            const legAngle = Math.sin(t) * 0.65
            h.leftLeg.rotation.x = legAngle
            h.leftLowerLeg.rotation.x = legAngle < 0 ? -legAngle * 0.85 : 0.1

            h.rightLeg.rotation.x = -legAngle
            h.rightLowerLeg.rotation.x = -legAngle < 0 ? legAngle * 0.85 : 0.1

            // Counter-balancing arm swing
            h.leftArm.rotation.x = -legAngle * 0.5 + 0.2
            h.rightArm.rotation.x = -Math.PI / 2 + 0.15 + Math.sin(t) * 0.06
          } else {
            // Idle combat stance: natural breathing & balance
            h.pelvis.position.y = 0.88 + Math.sin(t * 1.5) * 0.008
            h.spine.rotation.x = 0
            h.spine.rotation.y = 0
            h.leftLeg.rotation.x = 0.04
            h.leftLowerLeg.rotation.x = 0.02
            h.rightLeg.rotation.x = -0.04
            h.rightLowerLeg.rotation.x = 0.02
            h.leftArm.rotation.x = 0.18 + Math.sin(t * 1.5) * 0.025
            h.rightArm.rotation.x = -Math.PI / 2 + 0.15 + Math.sin(t * 1.5) * 0.015
          }

          // Super mode: flare conduits and core golden amber (from lore)
          if (group.userData.energyMat) {
            const isSuper = p.superActive && Date.now() < p.superEnd
            const activeColor = isSuper ? 0xffaa00 : group.userData.coreColor
            group.userData.energyMat.color.set(activeColor)
            group.userData.energyMat.emissive.set(activeColor)
            group.userData.energyMat.emissiveIntensity = isSuper ? 2.5 : 1.2
          }
        }
      }
    }

    for (const [id, grp] of this.playerMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(grp)
        this.playerMeshes.delete(id)
      }
    }
  }

  private createPlayerMesh(p: PlayerState): THREE.Group {
    const group = new THREE.Group()
    const core = CORE_DETAILS[p.character] || CORE_DETAILS.telepotu

    // ── High-Fidelity Materials for RX-11 Chassis ─────────────────────────────
    // 1. Primary Nanite Armor: Dark carbon-nanite alloy with subtle gloss
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x222a36,
      roughness: 0.35,
      metalness: 0.85
    })
    // 2. Secondary Armor & Trim: Polished gunmetal steel plates
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x3a4659,
      roughness: 0.28,
      metalness: 0.90
    })
    // 3. Mechanical Joint Framework & Under-Chassis: Dark titanium
    const jointMat = new THREE.MeshStandardMaterial({
      color: 0x141820,
      roughness: 0.55,
      metalness: 0.70
    })
    // 4. Core Energy Emissive Material (tied to Maker core identity)
    const energyMat = new THREE.MeshStandardMaterial({
      color: core.color,
      emissive: core.color,
      emissiveIntensity: 1.2,
      roughness: 0.2,
      metalness: 0.5
    })
    // 5. Visor Material: High-intensity glowing optic slit
    const visorMat = new THREE.MeshBasicMaterial({
      color: core.color
    })
    // 6. Integrated Weapon Metal
    const weaponMat = new THREE.MeshStandardMaterial({
      color: 0x181e26,
      roughness: 0.3,
      metalness: 0.9
    })

    // Store articulated references for dynamic animation
    const humanoid: any = {}
    group.userData.humanoid = humanoid
    group.userData.prevPos = new THREE.Vector3(p.x, p.y, p.z)
    group.userData.animTime = Math.random() * 10
    group.userData.energyMat = energyMat
    group.userData.coreColor = core.color

    // Root chassis container
    const chassis = new THREE.Group()
    chassis.name = 'chassis'
    group.add(chassis)
    humanoid.chassis = chassis

    // ── PELVIS & HIPS (Center at y = 0.88m) ───────────────────────────────────
    const pelvis = new THREE.Group()
    pelvis.position.y = 0.88
    chassis.add(pelvis)
    humanoid.pelvis = pelvis

    const pelvisBase = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.22), armorMat)
    pelvisBase.castShadow = true
    pelvis.add(pelvisBase)

    const hipBelt = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.24), trimMat)
    hipBelt.position.y = 0.05
    pelvis.add(hipBelt)

    // Lateral hip actuators
    const hipSocketGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.32, 12)
    const hipSockets = new THREE.Mesh(hipSocketGeo, jointMat)
    hipSockets.rotation.z = Math.PI / 2
    pelvis.add(hipSockets)

    // ── TORSO & THORAX ───────────────────────────────────────────────────────
    const spine = new THREE.Group()
    spine.position.y = 0.08
    pelvis.add(spine)
    humanoid.spine = spine

    // Articulated abdominal spine column
    const abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.16, 8), jointMat)
    abdomen.position.y = 0.08
    spine.add(abdomen)

    // Upper chest group
    const chestGroup = new THREE.Group()
    chestGroup.position.y = 0.24
    spine.add(chestGroup)
    humanoid.chest = chestGroup

    // Athletic V-taper armored thorax
    const chestMain = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.32, 0.28), armorMat)
    chestMain.position.y = 0.08
    chestMain.castShadow = true
    chestGroup.add(chestMain)

    // Left and right pectoral armor plates
    const leftPec = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.22, 0.05), trimMat)
    leftPec.position.set(-0.11, 0.09, 0.14)
    chestGroup.add(leftPec)

    const rightPec = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.22, 0.05), trimMat)
    rightPec.position.set(0.11, 0.09, 0.14)
    chestGroup.add(rightPec)

    // Dorsal spine stabilizer / backpack intake
    const dorsalPack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.30, 0.10), trimMat)
    dorsalPack.position.set(0, 0.08, -0.16)
    chestGroup.add(dorsalPack)

    // ── THE ATMA CORE NANITE CHAMBER (From Lore: Floating Pyramid Heart) ─────
    // Recessed circular aperture in chest center
    const chamberRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 24), jointMat)
    chamberRing.position.set(0, 0.08, 0.145)
    chestGroup.add(chamberRing)

    const chamberBack = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 16),
      new THREE.MeshBasicMaterial({ color: 0x080b10 })
    )
    chamberBack.position.set(0, 0.08, 0.138)
    chestGroup.add(chamberBack)

    // Perfect 4-sided pyramid suspended center-mass in nanite fluid
    const pyramidGeo = new THREE.ConeGeometry(0.065, 0.13, 4)
    const atmaPyramid = new THREE.Mesh(pyramidGeo, energyMat)
    atmaPyramid.position.set(0, 0.08, 0.142)
    atmaPyramid.rotation.x = Math.PI / 6
    chestGroup.add(atmaPyramid)
    humanoid.atmaPyramid = atmaPyramid

    // Glowing energy conduits wired from core to shoulders
    const conduitGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6)
    const leftConduit = new THREE.Mesh(conduitGeo, energyMat)
    leftConduit.rotation.z = Math.PI / 4
    leftConduit.position.set(-0.10, 0.14, 0.135)
    chestGroup.add(leftConduit)

    const rightConduit = new THREE.Mesh(conduitGeo, energyMat)
    rightConduit.rotation.z = -Math.PI / 4
    rightConduit.position.set(0.10, 0.14, 0.135)
    chestGroup.add(rightConduit)

    // ── HEAD & HELMET ────────────────────────────────────────────────────────
    const headGroup = new THREE.Group()
    headGroup.position.y = 0.28
    chestGroup.add(headGroup)
    humanoid.head = headGroup

    // Neck joint collar
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 0.08, 12), jointMat)
    neck.position.y = 0.02
    headGroup.add(neck)

    // Sculpted combat helmet
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), armorMat)
    helmet.position.y = 0.16
    helmet.castShadow = true
    headGroup.add(helmet)

    // Angular chin guard
    const chin = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.10, 4), trimMat)
    chin.rotation.y = Math.PI / 4
    chin.rotation.x = Math.PI
    chin.position.set(0, 0.08, 0.10)
    headGroup.add(chin)

    // Helmet brow plate
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.06), trimMat)
    brow.position.set(0, 0.21, 0.11)
    headGroup.add(brow)

    // Vivid glowing horizontal visor slit
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.04), visorMat)
    visor.position.set(0, 0.16, 0.12)
    headGroup.add(visor)

    // Lateral telemetry pods
    const earLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), jointMat)
    earLeft.rotation.z = Math.PI / 2
    earLeft.position.set(-0.13, 0.16, 0.02)
    headGroup.add(earLeft)

    const earRight = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), jointMat)
    earRight.rotation.z = Math.PI / 2
    earRight.position.set(0.13, 0.16, 0.02)
    headGroup.add(earRight)

    // ── LEFT ARM (Tactical Support Arm) ──────────────────────────────────────
    const leftArm = new THREE.Group()
    leftArm.position.set(-0.28, 0.16, 0)
    chestGroup.add(leftArm)
    humanoid.leftArm = leftArm

    const leftPauldron = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.18), trimMat)
    leftPauldron.position.set(-0.02, 0.02, 0)
    leftArm.add(leftPauldron)

    const leftShoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), jointMat)
    leftArm.add(leftShoulderBall)

    const leftBicep = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.20, 0.09), armorMat)
    leftBicep.position.set(0, -0.12, 0)
    leftArm.add(leftBicep)

    // Left forearm
    const leftForearm = new THREE.Group()
    leftForearm.position.set(0, -0.22, 0)
    leftArm.add(leftForearm)
    humanoid.leftForearm = leftForearm

    const leftElbow = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), jointMat)
    leftForearm.add(leftElbow)

    const leftForearmArmor = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.20, 0.085), armorMat)
    leftForearmArmor.position.set(0, -0.10, 0)
    leftForearm.add(leftForearmArmor)

    // Glowing nanite conduit along left forearm
    const leftForearmGlow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.01), energyMat)
    leftForearmGlow.position.set(-0.045, -0.10, 0)
    leftForearm.add(leftForearmGlow)

    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.05), jointMat)
    leftHand.position.set(0, -0.22, 0)
    leftForearm.add(leftHand)

    leftArm.rotation.x = 0.2
    leftArm.rotation.z = 0.12
    leftForearm.rotation.x = -0.4

    // ── RIGHT ARM (Integrated Nanite Pulse Blaster) ───────────────────────────
    const rightArm = new THREE.Group()
    rightArm.position.set(0.28, 0.16, 0)
    chestGroup.add(rightArm)
    humanoid.rightArm = rightArm

    const rightPauldron = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.18), trimMat)
    rightPauldron.position.set(0.02, 0.02, 0)
    rightArm.add(rightPauldron)

    const rightShoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), jointMat)
    rightArm.add(rightShoulderBall)

    const rightBicep = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.20, 0.09), armorMat)
    rightBicep.position.set(0, -0.12, 0)
    rightArm.add(rightBicep)

    // Right forearm & weapon assembly
    const rightForearm = new THREE.Group()
    rightForearm.position.set(0, -0.22, 0)
    rightArm.add(rightForearm)
    humanoid.rightForearm = rightForearm

    const rightElbow = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), jointMat)
    rightForearm.add(rightElbow)

    const weaponBody = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.36), weaponMat)
    weaponBody.position.set(0, -0.04, 0.12)
    rightForearm.add(weaponBody)

    const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.28, 12), jointMat)
    gunBarrel.rotation.x = Math.PI / 2
    gunBarrel.position.set(0, -0.02, 0.38)
    rightForearm.add(gunBarrel)

    const coil = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.18), energyMat)
    coil.position.set(0, 0.03, 0.14)
    rightForearm.add(coil)

    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 12), trimMat)
    muzzle.rotation.x = Math.PI / 2
    muzzle.position.set(0, -0.02, 0.52)
    rightForearm.add(muzzle)

    rightArm.rotation.x = -Math.PI / 2 + 0.15
    rightArm.rotation.y = -0.1
    rightForearm.rotation.x = -0.15

    // ── LEFT LEG ─────────────────────────────────────────────────────────────
    const leftLeg = new THREE.Group()
    leftLeg.position.set(-0.13, -0.04, 0)
    pelvis.add(leftLeg)
    humanoid.leftLeg = leftLeg

    const leftHipBall = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), jointMat)
    leftLeg.add(leftHipBall)

    const leftThigh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 0.14), armorMat)
    leftThigh.position.set(0, -0.18, 0)
    leftThigh.castShadow = true
    leftLeg.add(leftThigh)

    const leftLowerLeg = new THREE.Group()
    leftLowerLeg.position.set(0, -0.38, 0)
    leftLeg.add(leftLowerLeg)
    humanoid.leftLowerLeg = leftLowerLeg

    const leftKnee = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.06), trimMat)
    leftKnee.position.set(0, 0.01, 0.08)
    leftLowerLeg.add(leftKnee)

    const leftShin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 0.13), armorMat)
    leftShin.position.set(0, -0.18, 0)
    leftShin.castShadow = true
    leftLowerLeg.add(leftShin)

    const leftThruster = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.04), trimMat)
    leftThruster.position.set(0, -0.16, -0.08)
    leftLowerLeg.add(leftThruster)

    const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22), trimMat)
    leftFoot.position.set(0, -0.38, 0.04)
    leftFoot.castShadow = true
    leftLowerLeg.add(leftFoot)

    // ── RIGHT LEG ────────────────────────────────────────────────────────────
    const rightLeg = new THREE.Group()
    rightLeg.position.set(0.13, -0.04, 0)
    pelvis.add(rightLeg)
    humanoid.rightLeg = rightLeg

    const rightHipBall = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), jointMat)
    rightLeg.add(rightHipBall)

    const rightThigh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 0.14), armorMat)
    rightThigh.position.set(0, -0.18, 0)
    rightThigh.castShadow = true
    rightLeg.add(rightThigh)

    const rightLowerLeg = new THREE.Group()
    rightLowerLeg.position.set(0, -0.38, 0)
    rightLeg.add(rightLowerLeg)
    humanoid.rightLowerLeg = rightLowerLeg

    const rightKnee = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.06), trimMat)
    rightKnee.position.set(0, 0.01, 0.08)
    rightLowerLeg.add(rightKnee)

    const rightShin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 0.13), armorMat)
    rightShin.position.set(0, -0.18, 0)
    rightShin.castShadow = true
    rightLowerLeg.add(rightShin)

    const rightThruster = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.04), trimMat)
    rightThruster.position.set(0, -0.16, -0.08)
    rightLowerLeg.add(rightThruster)

    const rightFoot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22), trimMat)
    rightFoot.position.set(0, -0.38, 0.04)
    rightFoot.castShadow = true
    rightLowerLeg.add(rightFoot)

    // ── TACTICAL HUD OVERLAYS (Nameplate, Beacon, Shield, Super) ─────────────
    const nameplateMat = new THREE.SpriteMaterial({
      map: createNameplateTexture(p.name, p.isBot),
      transparent: true,
      depthTest: false
    })
    const nameplate = new THREE.Sprite(nameplateMat)
    nameplate.name = 'nameplate'
    nameplate.scale.set(2.4, 0.6, 1)
    nameplate.position.set(0, 2.45, 0)
    group.add(nameplate)

    const beaconMat = new THREE.MeshBasicMaterial({
      color: p.isBot ? 0x64748b : 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      depthTest: false
    })
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), beaconMat)
    beacon.name = 'beacon'
    beacon.position.set(0, 2.95, 0)
    group.add(beacon)

    // Kinetic Shield Dome
    const shieldGroup = new THREE.Group()
    shieldGroup.name = 'shield'
    shieldGroup.position.y = 1.1
    shieldGroup.visible = false

    const innerShieldMat = makeShieldDomeMaterial(0x00f0ff)
    const innerShield = new THREE.Mesh(new THREE.SphereGeometry(1.35, 32, 24), innerShieldMat)
    shieldGroup.add(innerShield)

    const outerShieldMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.75
    })
    const outerShield = new THREE.Mesh(new THREE.IcosahedronGeometry(1.42, 2), outerShieldMat)
    shieldGroup.add(outerShield)

    const ringShieldMat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.85
    })
    const ringShield = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.03, 8, 32), ringShieldMat)
    ringShield.rotation.x = Math.PI / 2
    shieldGroup.add(ringShield)
    group.add(shieldGroup)

    const superMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.5,
      wireframe: true
    })
    const superMesh = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 8, 24), superMat)
    superMesh.name = 'super'
    superMesh.position.y = 1.0
    superMesh.rotation.x = Math.PI / 2
    superMesh.visible = false
    group.add(superMesh)

    return group
  }

  triggerShoot(superActive: boolean = false) {
    this.armRecoil = 0.08
    this.armRecoilRot = 0.12
    // Nanite morph: hand -> blaster gun on every real shot
    this.timeSinceShot = 0
    this.blasterTarget = 1
    if (this.muzzleFlash) {
      this.muzzleFlash.visible = true
      this.muzzleFlashTime = 0.06
    }
    const color = superActive ? 0xffaa00 : 0x00f0ff
    this.armConduitMat.color.setHex(color)
    this.armCoreMat.color.setHex(color)
  }

  /** Lerp factor 0 (open nanite hand) -> 1 (heavy pulse blaster). Cosmetic only. */
  private applyBlasterMorph(t: number) {
    const m = THREE.MathUtils.clamp(t, 0, 1)

    // 1. Blaster Barrel & Reactor: extends out of palm and scales up
    const barrelZ = THREE.MathUtils.lerp(-0.11, -0.21, m)
    this.blasterBarrel.position.z = barrelZ
    this.blasterBarrel.scale.set(m, m, THREE.MathUtils.lerp(0.01, 1.0, m))
    this.blasterBarrel.visible = m > 0.01

    this.blasterCore.position.z = barrelZ + 0.04
    this.blasterCore.scale.setScalar(m)
    this.blasterCore.visible = m > 0.01

    // 2. Fingers: open natural hand (m=0) -> tight magnetic cowling clamp around barrel (m=1)
    for (let i = 0; i < this.fingerGroups.length; i++) {
      const g = this.fingerGroups[i]
      g.rotation.x = THREE.MathUtils.lerp(this.fingerHandRotX[i], this.fingerBlasterRotX[i], m)
      g.position.x = THREE.MathUtils.lerp(this.fingerBaseX[i], this.fingerBaseX[i] * 0.55, m)
      g.position.z = THREE.MathUtils.lerp(-0.15, -0.13, m)
    }

    // 3. Thumb: rests open in hand mode -> folds flat into chassis grip in blaster mode
    this.thumbMesh.rotation.y = THREE.MathUtils.lerp(0.45, 1.15, m)
    this.thumbMesh.rotation.z = THREE.MathUtils.lerp(-0.15, 0.40, m)
    this.thumbMesh.position.x = THREE.MathUtils.lerp(-0.050, -0.038, m)
  }

  setFirstPersonShield(active: boolean) {
    // Fade is animated in render(); here we only set the target
    this.fpShieldTarget = active ? 1 : 0
  }

  /** Hit flash on the first-person dome (called when our shield blocks damage). Cosmetic. */
  flashFirstPersonShield() {
    this.fpShieldFlash = 1
  }

  /** Hit flash on a third-person shield dome (called when their shield blocks damage). Cosmetic. */
  flashThirdPersonShield(id: number) {
    const grp = this.playerMeshes.get(id)
    if (!grp) return
    grp.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined
      if (m && (m as any).uniforms && (m as any).uniforms.uFlash) {
        ;(m as any).uniforms.uFlash.value = 1
      }
    })
  }

  spawnProjectile(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    superActive: boolean = false,
    maxDist: number = 180
  ) {
    const group = new THREE.Group()
    group.position.set(ox, oy, oz)

    const color = superActive ? 0xffaa00 : 0x00f0ff

    // Inner bright beam core
    const coreGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8)
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const coreMesh = new THREE.Mesh(coreGeo, coreMat)
    coreMesh.rotation.x = Math.PI / 2
    group.add(coreMesh)

    // Outer glowing energy sheath
    const auraGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.85, 8)
    const auraMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    })
    const auraMesh = new THREE.Mesh(auraGeo, auraMat)
    auraMesh.rotation.x = Math.PI / 2
    group.add(auraMesh)

    const dir = new THREE.Vector3(dx, dy, dz).normalize()
    const target = new THREE.Vector3().addVectors(group.position, dir)
    group.lookAt(target)

    this.scene.add(group)

    const speed = 160
    this.projectiles.push({
      mesh: group,
      vel: dir.clone().multiplyScalar(speed),
      dist: 0,
      maxDist
    })
  }

  spawnImpactSparks(pos: THREE.Vector3, color: number = 0x00f0ff) {
    const count = 6
    const sparkGeo = new THREE.SphereGeometry(0.035, 4, 4)
    const sparkMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    })
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat)
      mesh.position.copy(pos)
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6
      )
      this.scene.add(mesh)
      this.sparks.push({ mesh, vel, life: 0.12 })
    }
  }

  addNaniteCache(cache: NaniteCache) {
    if (this.naniteCacheMeshes.has(cache.id)) return

    const group = new THREE.Group()
    group.position.set(cache.x, cache.y, cache.z)

    // 1. Nanite Octahedron Crystal Core (Golden-Amber glow from lore)
    const coreGeo = new THREE.OctahedronGeometry(0.38, 0)
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xff7700,
      emissive: 0xffaa00,
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.85
    })
    const coreMesh = new THREE.Mesh(coreGeo, coreMat)
    group.add(coreMesh)

    // 2. Outer rotating nanite containment ring
    const ringGeo = new THREE.TorusGeometry(0.58, 0.032, 8, 24)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd044,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    })
    const ringMesh = new THREE.Mesh(ringGeo, ringMat)
    ringMesh.rotation.x = Math.PI / 3
    group.add(ringMesh)

    // 3. Ground 5u salvage boundary projection (visualizes the 5u pickup zone)
    const fieldGeo = new THREE.RingGeometry(4.88, 5.0, 32)
    const fieldMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    })
    const fieldMesh = new THREE.Mesh(fieldGeo, fieldMat)
    fieldMesh.rotation.x = -Math.PI / 2
    fieldMesh.position.y = -0.75
    group.add(fieldMesh)

    // 4. Subtle vertical beacon beam
    const beamGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8)
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending
    })
    const beamMesh = new THREE.Mesh(beamGeo, beamMat)
    beamMesh.position.y = 1.25
    group.add(beamMesh)

    this.scene.add(group)
    this.naniteCacheMeshes.set(cache.id, {
      group,
      coreMesh,
      ringMesh,
      baseY: cache.y,
      phase: Math.random() * Math.PI * 2
    })
  }

  removeNaniteCache(id: number, withSparks = true) {
    const c = this.naniteCacheMeshes.get(id)
    if (!c) return

    if (withSparks) {
      this.spawnImpactSparks(c.group.position, 0xffaa00)
    }

    this.scene.remove(c.group)
    c.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose()
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
        else obj.material?.dispose()
      }
    })
    this.naniteCacheMeshes.delete(id)
  }

  clearNaniteCaches() {
    for (const [id] of this.naniteCacheMeshes) {
      this.removeNaniteCache(id, false)
    }
  }

  render(dt: number, isMoving = false, superActive = false, shieldActive = false) {
    for (const c of this.clouds) {
      c.position.x += (c.userData as any).driftX * dt * 4
      c.position.z += (c.userData as any).driftZ * dt * 4
      if (c.position.x > 450) c.position.x = -450
      if (c.position.x < -450) c.position.x = 450
      if (c.position.z > 450) c.position.z = -450
      if (c.position.z < -450) c.position.z = 450
    }

    // Robot Hand recoil recovery & walking bobbing
    this.armRecoil = THREE.MathUtils.lerp(this.armRecoil, 0, dt * 18)
    this.armRecoilRot = THREE.MathUtils.lerp(this.armRecoilRot, 0, dt * 18)
    if (isMoving) {
      this.bobTimer += dt * 9
    }
    const bobX = Math.cos(this.bobTimer) * 0.005
    const bobY = Math.sin(this.bobTimer * 2) * 0.004
    this.robotArm.position.set(0.28 + bobX, -0.22 + bobY, -0.42 + this.armRecoil)
    this.robotArm.rotation.set(0.05 - this.armRecoilRot, -0.06, -0.04 + bobX * 2)

    // Muzzle flash duration
    if (this.muzzleFlashTime > 0) {
      this.muzzleFlashTime -= dt
      if (this.muzzleFlashTime <= 0 && this.muzzleFlash) {
        this.muzzleFlash.visible = false
      }
    }

    // Update conduits color (dimmed while in open-hand form)
    const themeColor = superActive ? 0xffaa00 : 0x00f0ff
    this.armConduitMat.color.setHex(themeColor).lerp(this.morphDim, (1 - this.blasterMorph) * 0.6)
    this.armCoreMat.color.setHex(themeColor).lerp(this.morphDim, (1 - this.blasterMorph) * 0.6)

    // Nanite revert: blaster -> open hand after 5s without a shot
    this.timeSinceShot += dt
    if (this.timeSinceShot > 5.0) {
      this.blasterTarget = 0
    }

    if (this.blasterTarget !== this.lastMorphTarget) {
      this.lastMorphTarget = this.blasterTarget
      sound.playNaniteMorph(this.blasterTarget === 1)
    }

    if (this.blasterMorph !== this.blasterTarget) {
      const rate = this.blasterTarget > this.blasterMorph ? 14.0 : 2.2
      this.blasterMorph = THREE.MathUtils.clamp(
        this.blasterMorph + Math.sign(this.blasterTarget - this.blasterMorph) * rate * dt,
        0, 1
      )
      this.applyBlasterMorph(this.blasterMorph)
    }

    // First person shield: smooth fade, energy pulse, hit-flash decay
    this.setFirstPersonShield(shieldActive)
    this.shieldTime += dt
    this.fpShieldFlash = Math.max(0, this.fpShieldFlash - dt * 3)
    this.fpShieldFade += (this.fpShieldTarget - this.fpShieldFade) * Math.min(1, dt * 6)
    if (Math.abs(this.fpShieldTarget - this.fpShieldFade) < 0.01) {
      this.fpShieldFade = this.fpShieldTarget
    }
    const fpVisible = this.fpShieldFade > 0.02
    this.firstPersonShield.visible = fpVisible
    if (fpVisible) {
      this.fpShieldDomeMat.uniforms.uTime.value = this.shieldTime
      this.fpShieldDomeMat.uniforms.uFlash.value = this.fpShieldFlash
      this.fpShieldDomeMat.uniforms.uOpacity.value = this.fpShieldFade
      this.fpShieldRingMat.opacity =
        0.45 * this.fpShieldFade * (0.8 + 0.2 * Math.sin(this.shieldTime * 2.2))
      const s = 0.92 + 0.08 * this.fpShieldFade
      this.firstPersonShield.scale.setScalar(s)
      this.firstPersonShield.rotation.z += dt * 0.8
    }

    // Update active projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      const step = p.vel.clone().multiplyScalar(dt)
      p.mesh.position.add(step)
      p.dist += step.length()
      if (p.dist >= p.maxDist) {
        this.spawnImpactSparks(p.mesh.position, superActive ? 0xffaa00 : 0x00f0ff)
        this.scene.remove(p.mesh)
        this.projectiles.splice(i, 1)
      }
    }

    // Update sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]
      s.mesh.position.addScaledVector(s.vel, dt)
      s.life -= dt
      if (s.life <= 0) {
        this.scene.remove(s.mesh)
        this.sparks.splice(i, 1)
      }
    }

    // Animate 3rd person shields: spin, energy pulse, hit-flash decay
    for (const grp of this.playerMeshes.values()) {
      const sh = grp.getObjectByName('shield')
      if (sh && sh.visible) {
        sh.rotation.y += dt * 1.5
        sh.traverse(o => {
          const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined
          if (m && (m as any).uniforms && (m as any).uniforms.uTime) {
            ;(m as any).uniforms.uTime.value = this.shieldTime
            ;(m as any).uniforms.uFlash.value = Math.max(0, (m as any).uniforms.uFlash.value - dt * 3)
          }
        })
      }
    }

    // Environmental graphics animations
    if (this.waterTexture) {
      this.waterTexture.offset.x = (this.waterTexture.offset.x + dt * 0.02) % 1
      this.waterTexture.offset.y = (this.waterTexture.offset.y + dt * 0.015) % 1
    }

    if (this.holoMaterials.length > 0) {
      const holoPulse = 0.84 + 0.16 * Math.sin(this.shieldTime * 2.8)
      for (const m of this.holoMaterials) {
        m.opacity = (m.userData.baseOpacity ?? 0.9) * holoPulse
      }
    }

    if (this.courtyardShrine) {
      this.courtyardShrine.rotation.y += dt * 0.75
      this.courtyardShrine.position.y = 3.8 + Math.sin(this.shieldTime * 2.0) * 0.09
    }

    if (this.towerBeacon) {
      this.towerBeacon.intensity = Math.sin(this.shieldTime * 6) > 0.35 ? 3.5 : 0.2
    }

    if (this.boreasPlanet) {
      this.boreasPlanet.rotation.y += dt * 0.008
    }

    // Animate Nanite Caches (spin & floating bob)
    for (const [, c] of this.naniteCacheMeshes) {
      c.coreMesh.rotation.y += dt * 2.2
      c.coreMesh.rotation.x += dt * 1.1
      c.ringMesh.rotation.z -= dt * 2.8
      c.ringMesh.rotation.y += dt * 1.4
      c.group.position.y = c.baseY + Math.sin(this.shieldTime * 3.2 + c.phase) * 0.14
    }

    this.renderer.render(this.scene, this.camera)
  }

  destroy() {
    window.removeEventListener('resize', this.onResize)
    this.clearNaniteCaches()
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh)
    }
    this.projectiles = []
    for (const s of this.sparks) {
      this.scene.remove(s.mesh)
    }
    this.sparks = []
    for (const l of this.streetlampLights) {
      this.scene.remove(l)
    }
    this.streetlampLights = []
    if (this.plazaLight) this.scene.remove(this.plazaLight)
    if (this.towerBeacon) this.scene.remove(this.towerBeacon)
    this.renderer.dispose()
  }
}
