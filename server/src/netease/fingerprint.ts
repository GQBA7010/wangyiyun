/**
 * Device fingerprint & IP simulation for each hosted NetEase account.
 *
 * Goals:
 *  - Each hosted account gets a **stable** (UA, IP) pair so that all requests
 *    from the same account look like a single real device.
 *  - The IP is derived from the account's registered province/city so that
 *    GeoIP lookups see a local address (no "异地登录" flags).
 *  - UA is picked from a realistic pool (desktop + mobile) and stays fixed
 *    for a given uid.
 */

// ---------------------------------------------------------------------------
// UA pool – common recent browser strings (desktop + mobile)
// ---------------------------------------------------------------------------

const UA_POOL: string[] = [
  // Desktop Chrome (Windows)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  // Desktop Edge
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  // macOS Chrome
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // macOS Safari
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  // Linux Chrome
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  // Android Chrome
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  // iOS Safari
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
]

// ---------------------------------------------------------------------------
// Province → IP prefix pool (first two octets from major Chinese ISPs)
// NetEase province code: first 2 digits = GB/T 2260 admin-area code.
// ---------------------------------------------------------------------------

interface IpPrefix {
  a: number
  b: number
}

/** Map of 2-digit province code → array of (a, b) first-two-octet pairs. */
const PROVINCE_IP: Record<number, IpPrefix[]> = {
  // Beijing
  11: [
    { a: 1, b: 202 },
    { a: 36, b: 110 },
    { a: 106, b: 39 },
    { a: 114, b: 249 },
    { a: 123, b: 118 },
    { a: 220, b: 181 },
  ],
  // Tianjin
  12: [
    { a: 42, b: 81 },
    { a: 60, b: 24 },
    { a: 111, b: 160 },
    { a: 125, b: 36 },
  ],
  // Hebei
  13: [
    { a: 27, b: 184 },
    { a: 60, b: 5 },
    { a: 106, b: 114 },
    { a: 110, b: 249 },
  ],
  // Shanxi
  14: [
    { a: 1, b: 68 },
    { a: 60, b: 220 },
    { a: 110, b: 97 },
    { a: 117, b: 36 },
  ],
  // Inner Mongolia
  15: [
    { a: 1, b: 24 },
    { a: 36, b: 99 },
    { a: 110, b: 17 },
    { a: 116, b: 117 },
  ],
  // Liaoning
  21: [
    { a: 36, b: 131 },
    { a: 42, b: 96 },
    { a: 112, b: 225 },
    { a: 175, b: 166 },
  ],
  // Jilin
  22: [
    { a: 1, b: 160 },
    { a: 36, b: 48 },
    { a: 111, b: 26 },
    { a: 122, b: 138 },
  ],
  // Heilongjiang
  23: [
    { a: 1, b: 56 },
    { a: 36, b: 96 },
    { a: 110, b: 77 },
    { a: 113, b: 0 },
  ],
  // Shanghai
  31: [
    { a: 1, b: 80 },
    { a: 101, b: 80 },
    { a: 106, b: 2 },
    { a: 114, b: 80 },
    { a: 180, b: 166 },
    { a: 222, b: 68 },
  ],
  // Jiangsu
  32: [
    { a: 36, b: 149 },
    { a: 49, b: 66 },
    { a: 58, b: 212 },
    { a: 112, b: 80 },
    { a: 114, b: 222 },
    { a: 180, b: 97 },
  ],
  // Zhejiang
  33: [
    { a: 36, b: 22 },
    { a: 60, b: 191 },
    { a: 101, b: 68 },
    { a: 112, b: 12 },
    { a: 115, b: 220 },
    { a: 122, b: 224 },
  ],
  // Anhui
  34: [
    { a: 36, b: 32 },
    { a: 60, b: 166 },
    { a: 112, b: 32 },
    { a: 114, b: 104 },
  ],
  // Fujian
  35: [
    { a: 27, b: 148 },
    { a: 36, b: 248 },
    { a: 59, b: 56 },
    { a: 110, b: 80 },
    { a: 112, b: 48 },
    { a: 120, b: 35 },
  ],
  // Jiangxi
  36: [
    { a: 36, b: 244 },
    { a: 59, b: 52 },
    { a: 106, b: 225 },
    { a: 171, b: 96 },
  ],
  // Shandong
  37: [
    { a: 27, b: 192 },
    { a: 39, b: 64 },
    { a: 60, b: 208 },
    { a: 112, b: 224 },
    { a: 119, b: 164 },
    { a: 222, b: 133 },
  ],
  // Henan
  41: [
    { a: 1, b: 192 },
    { a: 42, b: 228 },
    { a: 115, b: 48 },
    { a: 171, b: 8 },
    { a: 222, b: 136 },
  ],
  // Hubei
  42: [
    { a: 27, b: 17 },
    { a: 59, b: 172 },
    { a: 111, b: 170 },
    { a: 115, b: 153 },
    { a: 171, b: 43 },
  ],
  // Hunan
  43: [
    { a: 36, b: 158 },
    { a: 42, b: 48 },
    { a: 110, b: 52 },
    { a: 113, b: 218 },
    { a: 175, b: 0 },
  ],
  // Guangdong
  44: [
    { a: 14, b: 17 },
    { a: 113, b: 96 },
    { a: 116, b: 25 },
    { a: 119, b: 130 },
    { a: 121, b: 33 },
    { a: 183, b: 6 },
    { a: 163, b: 177 },
  ],
  // Guangxi
  45: [
    { a: 36, b: 4 },
    { a: 110, b: 6 },
    { a: 113, b: 12 },
    { a: 171, b: 36 },
  ],
  // Hainan
  46: [
    { a: 27, b: 8 },
    { a: 59, b: 48 },
    { a: 110, b: 64 },
    { a: 124, b: 225 },
  ],
  // Chongqing
  50: [
    { a: 42, b: 56 },
    { a: 61, b: 128 },
    { a: 106, b: 88 },
    { a: 113, b: 204 },
    { a: 183, b: 64 },
  ],
  // Sichuan
  51: [
    { a: 36, b: 137 },
    { a: 110, b: 184 },
    { a: 118, b: 112 },
    { a: 171, b: 212 },
    { a: 182, b: 140 },
  ],
  // Guizhou
  52: [
    { a: 58, b: 16 },
    { a: 106, b: 120 },
    { a: 111, b: 121 },
    { a: 117, b: 135 },
  ],
  // Yunnan
  53: [
    { a: 36, b: 40 },
    { a: 106, b: 56 },
    { a: 116, b: 52 },
    { a: 222, b: 172 },
  ],
  // Tibet
  54: [
    { a: 36, b: 37 },
    { a: 113, b: 62 },
    { a: 124, b: 31 },
  ],
  // Shaanxi
  61: [
    { a: 36, b: 40 },
    { a: 113, b: 128 },
    { a: 117, b: 32 },
    { a: 123, b: 138 },
  ],
  // Gansu
  62: [
    { a: 36, b: 56 },
    { a: 60, b: 164 },
    { a: 118, b: 176 },
    { a: 171, b: 40 },
  ],
  // Qinghai
  63: [
    { a: 36, b: 43 },
    { a: 110, b: 72 },
    { a: 223, b: 220 },
  ],
  // Ningxia
  64: [
    { a: 27, b: 12 },
    { a: 42, b: 104 },
    { a: 124, b: 224 },
  ],
  // Xinjiang
  65: [
    { a: 36, b: 36 },
    { a: 110, b: 152 },
    { a: 124, b: 88 },
    { a: 222, b: 80 },
  ],
}

// Fallback: generic multi-province IPs if the province is unknown
const FALLBACK_IP: IpPrefix[] = [
  { a: 116, b: 25 },
  { a: 113, b: 96 },
  { a: 119, b: 130 },
  { a: 183, b: 6 },
  { a: 112, b: 80 },
  { a: 180, b: 97 },
  { a: 36, b: 110 },
  { a: 1, b: 80 },
]

// ---------------------------------------------------------------------------
// Deterministic RNG seeded by uid (simple LCG — good enough for this use)
// ---------------------------------------------------------------------------

function seededRand(seed: number): () => number {
  let s = seed | 0 || 1
  return () => {
    s = Math.imul(s, 1664525) + 1013904223
    return (s >>> 0) / 0x100000000
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DeviceFingerprint {
  ua: string
  ip: string
  os: 'pc' | 'android'
  appver: string
  osver: string
  channel: string
  deviceId: string
}

/**
 * Return a stable (UA, IP) pair for a hosted NetEase account.
 *
 * @param uid        – the hosted NetEase account uid
 * @param province   – NetEase province code (e.g. 440000 for Guangdong). When
 *                     unknown / 0, falls back to a generic China IP pool.
 */
export function getFingerprint(uid: number, province?: number): DeviceFingerprint {
  const rand = seededRand(uid)

  // Pick a stable UA from the pool
  const uaIdx = Math.floor(rand() * UA_POOL.length)
  const ua = UA_POOL[uaIdx] as string

  // Resolve province → 2-digit code → IP prefix pool
  const provinceKey = province ? Math.floor(province / 10000) : 0
  const prefixes = (provinceKey && PROVINCE_IP[provinceKey]) || FALLBACK_IP
  const prefixIdx = Math.floor(rand() * prefixes.length)
  const prefix = prefixes[prefixIdx] as IpPrefix

  // Fill in the last two octets deterministically
  const c = 1 + Math.floor(rand() * 254) // 1-254
  const d = 1 + Math.floor(rand() * 254)
  const ip = `${prefix.a}.${prefix.b}.${c}.${d}`

  // Stable device ID (hex string)
  const hexChars = '0123456789abcdef'
  let deviceId = ''
  for (let i = 0; i < 32; i++) {
    deviceId += hexChars[Math.floor(rand() * 16)]
  }

  // 70% pc, 30% android (deterministic per account)
  const isAndroid = rand() < 0.3
  const os = isAndroid ? 'android' as const : 'pc' as const
  const appver = isAndroid ? '8.20.20.231215173437' : '3.1.17.204416'
  const osver = isAndroid ? '14' : 'Microsoft-Windows-10-Professional-build-19045-64bit'
  const channel = isAndroid ? 'xiaomi' : 'netease'

  return { ua, ip, os, appver, osver, channel, deviceId }
}
