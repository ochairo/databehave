import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'
import type { HttpBind } from './http.js'

/** A transport validation failure which must not reach application dispatch. */
export class InvalidHttpRequest extends Error {
  constructor(readonly status: 400 | 421, message: string) { super(message) }
}

/** Normalize an explicit DNS name or IP literal, never a URL, port or wildcard. */
export const normalizeHostname = (value: string): string => {
  const hostname = value.toLowerCase()
  if (hostname.startsWith('[') && hostname.endsWith(']') && isIP(hostname.slice(1, -1)) === 6) return new URL(`http://${hostname}`).hostname
  if (isIP(hostname) === 6) return new URL(`http://[${hostname}]`).hostname
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.?$/.test(hostname)
    || hostname.replace(/\.$/, '').split('.').some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
    throw new Error(`Invalid allowed hostname: ${value}`)
  }
  return hostname.replace(/\.$/, '')
}

const loopback = (hostname: string): boolean => hostname === 'localhost' || hostname === '[::1]'
  || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(hostname) || hostname.startsWith('127.') && isIP(hostname) === 4

/** Validate the raw HTTP authority and target before constructing a Fetch URL. */
export const requestUrl = (incoming: IncomingMessage, bind: HttpBind, allowedHosts: readonly string[]): URL => {
  const target = incoming.url ?? '/'
  if (!target.startsWith('/') || target.startsWith('//') || /[\\\x00-\x20\x7f#]/.test(target)) {
    throw new InvalidHttpRequest(400, 'Invalid request target')
  }
  const hosts: string[] = []
  for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
    if (incoming.rawHeaders[i]?.toLowerCase() === 'host') hosts.push(incoming.rawHeaders[i + 1] ?? '')
  }
  if (hosts.length !== 1) throw new InvalidHttpRequest(400, 'Exactly one Host header is required')
  const authority = hosts[0] ?? ''
  const match = /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?$/.exec(authority)
  if (!match?.[1]) throw new InvalidHttpRequest(400, 'Invalid Host header')
  let hostname: string
  try { hostname = normalizeHostname(match[1]) } catch { throw new InvalidHttpRequest(400, 'Invalid Host header') }
  if (match[1].startsWith('[') && isIP(match[1].slice(1, -1)) !== 6) throw new InvalidHttpRequest(400, 'Invalid IPv6 Host header')
  const port = match[2] === undefined ? 80 : Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new InvalidHttpRequest(400, 'Invalid Host port')
  const local = normalizeHostname(incoming.socket.localAddress ?? bind.host)
  const configured = normalizeHostname(bind.host)
  const approved = hostname === local || hostname === configured || allowedHosts.includes(hostname)
    || loopback(local) && loopback(hostname)
  if (port !== incoming.socket.localPort || !approved) throw new InvalidHttpRequest(421, 'Unapproved Host authority')
  let url: URL
  try { url = new URL(target, `http://${authority}`) } catch { throw new InvalidHttpRequest(400, 'Invalid request URL') }
  // WHATWG normalization must not reinterpret the validated authority (for example legacy IPv4 syntax).
  if (normalizeHostname(url.hostname) !== hostname || Number(url.port || 80) !== port) throw new InvalidHttpRequest(400, 'Invalid request authority')
  return url
}
