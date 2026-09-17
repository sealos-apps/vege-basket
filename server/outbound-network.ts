import { lookup } from 'node:dns/promises'
import https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { isPublicNetworkAddress } from './ai-provider.ts'

export type ResolvedNetworkAddress = {
  address: string
  family: 4 | 6
}

export type NetworkLookup = (hostname: string) => Promise<readonly { address: string; family?: number }[]>

export class OutboundNetworkTargetError extends Error {
  readonly code = 'OUTBOUND_NETWORK_TARGET_REJECTED'

  constructor(message: string) {
    super(message)
    this.name = 'OutboundNetworkTargetError'
  }
}

const defaultLookup: NetworkLookup = async (hostname) => lookup(hostname, { all: true, verbatim: true })

export async function resolvePublicNetworkHost(
  hostname: string,
  resolver: NetworkLookup = defaultLookup,
): Promise<ResolvedNetworkAddress[]> {
  const normalized = hostname.trim().replace(/^\[|\]$/gu, '')
  if (!normalized) throw new OutboundNetworkTargetError('网络目标不能为空。')
  const literalFamily = isIP(normalized)
  const records = literalFamily
    ? [{ address: normalized, family: literalFamily }]
    : await resolver(normalized)
  const addresses = records.map((record) => ({
    address: record.address.replace(/^\[|\]$/gu, ''),
    family: (record.family ?? isIP(record.address)) as 4 | 6,
  }))
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => (family !== 4 && family !== 6) || !isPublicNetworkAddress(address))
  ) {
    throw new OutboundNetworkTargetError('网络目标必须解析到公网 IP 地址。')
  }
  return Array.from(
    new Map(addresses.map((entry) => [`${entry.family}:${entry.address}`, entry])).values(),
  )
}

export function createPinnedLookup(addresses: readonly ResolvedNetworkAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const family = options.family === 4 || options.family === 6 ? options.family : null
    const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses
    if (candidates.length === 0) {
      const error = Object.assign(new Error('没有可用的已验证公网地址。'), { code: 'ENOTFOUND' })
      callback(error, '', 0)
      return
    }
    if (options.all) {
      callback(null, candidates.map(({ address, family: candidateFamily }) => ({
        address,
        family: candidateFamily,
      })))
      return
    }
    callback(null, candidates[0].address, candidates[0].family)
  }
}

export function createPinnedHttpsAgent(addresses: readonly ResolvedNetworkAddress[]) {
  return new https.Agent({ keepAlive: false, lookup: createPinnedLookup(addresses) })
}
