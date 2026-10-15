/**
 * Persisted self-signed certificate for `dsh web --lan`.
 * The certificate names localhost, loopback, and the current LAN IPv4 addresses.
 * @module @deepseek-ai/dsh-web-app/lan-cert
 */

import { createSign, generateKeyPairSync, randomBytes, X509Certificate } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'

/**
 * Names the LAN certificate must cover on this machine.
 * @returns localhost, loopback, and non-internal IPv4 addresses.
 */
export function lanCertificateNames(): string[] {
  const ips = Object.values(networkInterfaces()).flat()
    .filter((iface): iface is NonNullable<typeof iface> => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
    .map(iface => iface.address)
  return ['localhost', '127.0.0.1', ...ips]
}

/**
 * Read a still-valid certificate for these names, or write a new one.
 * @param directory - directory that stores `cert.pem` and `key.pem`.
 * @param names - subject alternative names. Defaults to this machine.
 * @returns PEM certificate and PKCS#8 private key.
 */
export function ensureLanCertificate(directory: string, names: readonly string[] = lanCertificateNames()): { cert: string; key: string } {
  mkdirSync(directory, { recursive: true })
  const certPath = join(directory, 'cert.pem')
  const keyPath = join(directory, 'key.pem')
  try {
    const cert = readFileSync(certPath, 'utf8')
    const key = readFileSync(keyPath, 'utf8')
    if (certificateCovers(cert, names)) return { cert, key }
  } catch (error) {
    // A missing or unreadable file is replaced below.
    void error
  }
  const created = createLanCertificate(names)
  writeFileSync(certPath, created.cert)
  writeFileSync(keyPath, created.key, { mode: 0o600 })
  return created
}

/**
 * Build a new self-signed RSA certificate.
 * @param names - DNS names and IPv4 addresses.
 * @returns PEM certificate and PKCS#8 private key.
 */
export function createLanCertificate(names: readonly string[]): { cert: string; key: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const now = new Date(Date.now() - 5 * 60 * 1000)
  const until = new Date(now.getTime() + 825 * 24 * 60 * 60 * 1000)
  const tbs = sequence([
    explicit(0, integer(Buffer.from([2]))),
    integer(randomBytes(8)),
    algorithm(SHA256_RSA),
    distinguishedName('DuraSH LAN'),
    sequence([utcTime(now), utcTime(until)]),
    distinguishedName('DuraSH LAN'),
    Buffer.from(spki),
    explicit(3, sequence([extension(SAN, sequence(names.map(generalName)))])),
  ])
  const signer = createSign('SHA256')
  signer.update(tbs)
  const signature = signer.sign(privateKey)
  const cert = sequence([
    tbs,
    algorithm(SHA256_RSA),
    bitString(signature),
  ])
  return {
    cert: pem('CERTIFICATE', cert),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

const SHA256_RSA = oid([1, 2, 840, 113549, 1, 1, 11])
const CN = oid([2, 5, 4, 3])
const SAN = oid([2, 5, 29, 17])

function certificateCovers(pemText: string, names: readonly string[]): boolean {
  const parsed = new X509Certificate(pemText)
  if (Date.parse(parsed.validTo) <= Date.now() + 86_400_000) return false
  const san = parsed.subjectAltName ?? ''
  return names.every(name => san.split(', ').some(entry => entry === `DNS:${name}` || entry === `IP Address:${name}`))
}

function encodeLength(length: number): Buffer {
  if (length < 128) return Buffer.from([length])
  const bytes: number[] = []
  let rest = length
  while (rest > 0) {
    bytes.unshift(rest & 0xff)
    rest >>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value])
}

function sequence(items: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(items))
}

function integer(value: Buffer): Buffer {
  const body = (value[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value
  return tlv(0x02, body)
}

function oid(parts: readonly number[]): Buffer {
  const first = parts[0] ?? 0
  const second = parts[1] ?? 0
  const body = [first * 40 + second]
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f]
    let rest = part >> 7
    while (rest > 0) {
      chunk.unshift((rest & 0x7f) | 0x80)
      rest >>= 7
    }
    body.push(...chunk)
  }
  return tlv(0x06, Buffer.from(body))
}

function algorithm(id: Buffer): Buffer {
  return sequence([id, Buffer.from([0x05, 0x00])])
}

function distinguishedName(commonName: string): Buffer {
  const value = sequence([CN, tlv(0x0c, Buffer.from(commonName))])
  return sequence([tlv(0x31, value)])
}

function utcTime(date: Date): Buffer {
  const pad = (part: number): string => String(part).padStart(2, '0')
  const text = `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  return tlv(0x17, Buffer.from(text))
}

function generalName(name: string): Buffer {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(name)) return tlv(0x87, Buffer.from(name.split('.').map(part => Number(part))))
  return tlv(0x82, Buffer.from(name))
}

function extension(id: Buffer, value: Buffer): Buffer {
  return sequence([id, tlv(0x04, value)])
}

function explicit(tag: number, value: Buffer): Buffer {
  return tlv(0xa0 | tag, value)
}

function bitString(value: Buffer): Buffer {
  return tlv(0x03, Buffer.concat([Buffer.from([0]), value]))
}

function pem(label: string, der: Buffer): string {
  const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}
