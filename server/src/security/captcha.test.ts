import { describe, expect, it } from 'vitest'
import { createCaptcha, verifyCaptcha } from './captcha.js'

/** Extract the rendered code from the SVG markup (glyphs are emitted in order). */
function codeFromSvg(svg: string): string {
  const matches = [...svg.matchAll(/>([A-Z0-9])<\/text>/g)]
  return matches.map((m) => m[1]).join('')
}

describe('captcha', () => {
  it('creates a challenge with an id and renderable SVG', () => {
    const { id, svg } = createCaptcha()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(codeFromSvg(svg)).toHaveLength(4)
  })

  it('accepts the correct answer case-insensitively', () => {
    const { id, svg } = createCaptcha()
    const code = codeFromSvg(svg)
    expect(verifyCaptcha(id, code.toLowerCase())).toBe(true)
  })

  it('is single-use — a second verification always fails', () => {
    const { id, svg } = createCaptcha()
    const code = codeFromSvg(svg)
    expect(verifyCaptcha(id, code)).toBe(true)
    expect(verifyCaptcha(id, code)).toBe(false)
  })

  it('rejects wrong answers, unknown ids and non-string input', () => {
    const { id, svg } = createCaptcha()
    const code = codeFromSvg(svg)
    const wrong = code === 'AAAA' ? 'BBBB' : 'AAAA'
    expect(verifyCaptcha(id, wrong)).toBe(false)
    expect(verifyCaptcha('does-not-exist', code)).toBe(false)
    expect(verifyCaptcha(undefined, code)).toBe(false)
    expect(verifyCaptcha(id, 123)).toBe(false)
  })
})
