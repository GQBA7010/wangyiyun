import { describe, expect, it } from 'vitest'
import { storeCode, verifyCode } from './mail.js'

describe('email verification codes', () => {
  it('verifies a correct code and consumes it', () => {
    const id = storeCode('a@qq.com', '123456')
    expect(verifyCode(id, '123456', 'a@qq.com')).toBe(true)
    // consumed — cannot be reused
    expect(verifyCode(id, '123456', 'a@qq.com')).toBe(false)
  })

  it('rejects wrong code', () => {
    const id = storeCode('a@qq.com', '123456')
    expect(verifyCode(id, '654321', 'a@qq.com')).toBe(false)
    // wrong attempt does not consume the code
    expect(verifyCode(id, '123456', 'a@qq.com')).toBe(true)
  })

  it('rejects mismatched email', () => {
    const id = storeCode('a@qq.com', '123456')
    expect(verifyCode(id, '123456', 'b@qq.com')).toBe(false)
  })

  it('rejects unknown codeId', () => {
    expect(verifyCode('vc_nope', '123456', 'a@qq.com')).toBe(false)
  })

  it('rejects expired code', () => {
    const id = storeCode('a@qq.com', '123456', -1)
    expect(verifyCode(id, '123456', 'a@qq.com')).toBe(false)
  })
})
