import os from 'node:os'

const PRIVATE_RANGES = [
  /^192\.168\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
]

/**
 * Best guess at the address other devices on the wifi should type in.
 *
 * Windows machines routinely expose half a dozen interfaces (Hyper-V, WSL,
 * VirtualBox, VPN adapters) that all look like valid private IPs but are not
 * reachable from a phone. We score candidates instead of taking the first hit:
 * a 192.168.x.x on an adapter with no virtualisation keyword in its name is
 * almost always the real one.
 */
export function getLanIp() {
  return getLanCandidates()[0]?.address ?? '127.0.0.1'
}

export function getLanCandidates() {
  const ifaces = os.networkInterfaces()
  const candidates = []

  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      if (!PRIVATE_RANGES.some((re) => re.test(addr.address))) continue
      candidates.push({ name, address: addr.address, score: scoreInterface(name, addr.address) })
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

function scoreInterface(name, address) {
  const n = name.toLowerCase()
  let score = 0

  // Home routers hand out 192.168.x.x far more often than the other ranges.
  if (address.startsWith('192.168.')) score += 30
  else if (address.startsWith('10.')) score += 10

  // Virtual adapters are reachable from this machine but never from a phone.
  if (/vethernet|hyper-v|wsl|virtualbox|vmware|docker|loopback|tailscale|zerotier|tap|tun/.test(n)) {
    score -= 100
  }

  if (/wi-?fi|wlan|wireless/.test(n)) score += 20
  if (/ethernet|eth\d|en\d/.test(n)) score += 15

  return score
}
