import crypto from 'node:crypto'

// Public, reverse-engineered constants for NetEase Cloud Music's web/eapi
// encryption. These are NOT secrets — they are the same fixed values the
// official music.163.com web client ships to every browser.
const IV = Buffer.from('0102030405060708')
const PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud')
const EAPI_KEY = Buffer.from('e82ckenh8dichen8')
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37
BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k
4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTW
z7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`

function aesEncrypt(buffer, mode, key, iv) {
  const cipher = crypto.createCipheriv(`aes-128-${mode}`, key, iv)
  return Buffer.concat([cipher.update(buffer), cipher.final()])
}

function aesDecrypt(buffer, mode, key, iv) {
  const decipher = crypto.createDecipheriv(`aes-128-${mode}`, key, iv)
  return Buffer.concat([decipher.update(buffer), decipher.final()])
}

function rsaEncrypt(buffer, key) {
  const padded = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
  return crypto.publicEncrypt(
    { key, padding: crypto.constants.RSA_NO_PADDING },
    padded,
  )
}

/**
 * Encrypt a payload for a `/weapi/*` endpoint.
 * Returns the `params` + `encSecKey` form fields the web client posts.
 */
export function weapi(object) {
  const text = JSON.stringify(object)
  const secretKey = crypto
    .randomBytes(16)
    .map((n) => BASE62.charCodeAt(n % 62))
  return {
    params: aesEncrypt(
      Buffer.from(
        aesEncrypt(Buffer.from(text), 'cbc', PRESET_KEY, IV).toString('base64'),
      ),
      'cbc',
      secretKey,
      IV,
    ).toString('base64'),
    encSecKey: rsaEncrypt(Buffer.from(secretKey).reverse(), PUBLIC_KEY).toString(
      'hex',
    ),
  }
}

/**
 * Encrypt a payload for an `/eapi/*` endpoint.
 * `url` is the api path used in the signature (e.g. `/api/feedback/weblog`).
 */
export function eapi(url, object) {
  const text = typeof object === 'object' ? JSON.stringify(object) : object
  const message = `nobody${url}use${text}md5forencrypt`
  const digest = crypto.createHash('md5').update(message).digest('hex')
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  return {
    params: aesEncrypt(Buffer.from(data), 'ecb', EAPI_KEY, '')
      .toString('hex')
      .toUpperCase(),
  }
}

/** Decrypt an eapi response body (hex string) back into JSON text. */
export function eapiResDecrypt(hexString) {
  return aesDecrypt(Buffer.from(hexString, 'hex'), 'ecb', EAPI_KEY, '').toString()
}
