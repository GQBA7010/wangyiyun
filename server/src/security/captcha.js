import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// Self-contained SVG image CAPTCHA (no external dependency / network).
//
// A short code is rendered into a noisy SVG and the answer is kept server-side
// in a TTL'd, one-time-use store keyed by an opaque id. The client echoes the
// id + the characters the user typed; we verify case-insensitively and discard
// the challenge so it can never be replayed.
// ---------------------------------------------------------------------------

// Avoid visually ambiguous glyphs (0/O, 1/I/l, etc.).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 4
const TTL_MS = 5 * 60 * 1000
const MAX_PENDING = 5000

/** id -> { answer: string (lowercase), exp: number } */
const store = new Map()

function rand(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function pick(arr) {
  return arr[rand(0, arr.length - 1)]
}

function sweep() {
  const now = Date.now()
  for (const [id, v] of store) {
    if (v.exp <= now) store.delete(id)
  }
  // Hard cap as a backstop against memory growth under abuse.
  if (store.size > MAX_PENDING) {
    const overflow = store.size - MAX_PENDING
    let i = 0
    for (const id of store.keys()) {
      store.delete(id)
      if (++i >= overflow) break
    }
  }
}

function randomCode() {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += pick(ALPHABET)
  return code
}

function renderSvg(code) {
  const width = 130
  const height = 48
  const colors = ['#4f46e5', '#0d9488', '#db2777', '#7c3aed', '#0369a1', '#b45309']
  const cellW = (width - 20) / code.length

  const noise = []
  // Faint connecting curves.
  for (let i = 0; i < 4; i++) {
    const x1 = rand(0, width)
    const y1 = rand(0, height)
    const x2 = rand(0, width)
    const y2 = rand(0, height)
    const cx = rand(0, width)
    const cy = rand(0, height)
    noise.push(
      `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" stroke="${pick(colors)}" stroke-width="1" fill="none" opacity="0.25"/>`,
    )
  }
  // Scattered dots.
  for (let i = 0; i < 22; i++) {
    noise.push(
      `<circle cx="${rand(0, width)}" cy="${rand(0, height)}" r="${rand(1, 2)}" fill="${pick(colors)}" opacity="0.3"/>`,
    )
  }

  const glyphs = code
    .split('')
    .map((ch, i) => {
      const x = 12 + i * cellW + rand(-2, 2)
      const y = rand(32, 38)
      const rot = rand(-26, 26)
      const size = rand(26, 32)
      return `<text x="${x}" y="${y}" font-size="${size}" font-family="'Courier New',monospace" font-weight="700" fill="${pick(colors)}" transform="rotate(${rot} ${x} ${y})">${ch}</text>`
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="图形验证码">` +
    `<rect width="${width}" height="${height}" rx="10" fill="#f1f5f9"/>` +
    noise.join('') +
    glyphs +
    `</svg>`
  )
}

/** Create a new challenge. Returns the opaque id and the SVG markup to render. */
export function createCaptcha() {
  sweep()
  const id = crypto.randomBytes(16).toString('hex')
  const code = randomCode()
  store.set(id, { answer: code.toLowerCase(), exp: Date.now() + TTL_MS })
  return { id, svg: renderSvg(code) }
}

/**
 * Verify a user's answer. Challenges are single-use: the entry is removed on
 * the first verification attempt regardless of outcome.
 */
export function verifyCaptcha(id, input) {
  if (typeof id !== 'string' || typeof input !== 'string') return false
  const entry = store.get(id)
  if (!entry) return false
  store.delete(id)
  if (entry.exp <= Date.now()) return false
  return entry.answer === input.trim().toLowerCase()
}
