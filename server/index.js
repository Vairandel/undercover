import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { Server as IOServer } from 'socket.io'
import QRCode from 'qrcode'

import { getLanIp, getLanCandidates } from './net.js'
import { listThemes, totalPairs } from './words.js'
import { roleCatalogue } from './game/roles/index.js'
import { modifierCatalogue } from './game/modifiers/index.js'
import { createRoomManager } from './game/rooms.js'
import { DEFAULT_SETTINGS, MIN_PLAYERS, MAX_PLAYERS, specialBudget } from './game/engine.js'
import { AVATARS, COLORS } from './game/appearance.js'
import { POINT_FIELDS, DEFAULT_POINTS } from './game/scoring.js'
import { store } from './store.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.join(here, '..', 'client', 'dist')

const PORT = Number(process.env.PORT ?? 3000)
const HOST = '0.0.0.0' // listen on every interface, not just localhost

const lanIp = getLanIp()
const lanUrl = `http://${lanIp}:${PORT}`

/**
 * Where players should actually point their browser.
 *
 * On a home wifi that is this machine's LAN address. Behind a tunnel or a host,
 * the LAN address is meaningless to anyone outside — set `PUBLIC_URL` to the
 * address people will really type, or the QR code sends them to 192.168.x.x.
 *
 * Setting it is also the signal that the app is reachable from the open
 * internet, which tightens a few things below.
 */
const PUBLIC_URL = String(process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '')
const isExposed = PUBLIC_URL.length > 0
const publicUrl = isExposed ? PUBLIC_URL : lanUrl

/** Required to reach destructive endpoints once the app is exposed. */
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN ?? '').trim()

const app = Fastify({
  logger: false,
  // Behind Cloudflare/ngrok the socket peer is the tunnel, not the player.
  trustProxy: isExposed,
})

// ---------------------------------------------------------------- HTTP API

app.get('/api/info', async () => ({
  url: publicUrl,
  port: PORT,
  // The machine's network topology is nobody's business once this is reachable
  // from outside. Only useful on a LAN anyway, to pick another interface.
  ...(isExposed ? {} : { ip: lanIp, interfaces: getLanCandidates() }),
  themes: listThemes(),
  // Roles and modifiers are toggled through the same UI, so they ship together.
  roles: [...roleCatalogue(), ...modifierCatalogue()],
  defaults: DEFAULT_SETTINGS,
  appearance: { avatars: AVATARS, colors: COLORS },
  // Field descriptors drive the settings sliders and the rulebook alike.
  scoring: { fields: POINT_FIELDS, defaults: DEFAULT_POINTS },
  budgets: Object.fromEntries(
    Array.from({ length: MAX_PLAYERS - 2 }, (_, i) => [i + 3, specialBudget(i + 3)]),
  ),
  limits: { min: MIN_PLAYERS, max: MAX_PLAYERS },
  bank: { pairs: totalPairs(), gamesPlayed: store.state.gamesPlayed },
}))

/**
 * The address players should scan, worked out from the request itself.
 *
 * Deriving it from the browser's own `Host` means the QR code automatically
 * follows a tunnel whose hostname changes between sessions — no `PUBLIC_URL`,
 * no restart. It is also inherently safe: the code can only ever point at the
 * host the requester already reached us on, so there is nothing to redirect.
 *
 * The one exception is a host sitting on `localhost` while players come through
 * a tunnel — a loopback address is useless to them, so `PUBLIC_URL` wins there.
 */
function joinUrlFor(req) {
  const host = String(req.headers.host ?? '').trim()
  if (!host) return publicUrl

  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)
  if (loopback && isExposed) return publicUrl

  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
  const proto = forwarded || (req.protocol ?? 'http')
  return `${proto}://${host}`
}

/** The join address as the client sees it — lets the UI stay in sync too. */
app.get('/api/where', async (req) => ({ url: joinUrlFor(req) }))

/** QR code for the join URL, rendered server-side so the client ships no deps. */
app.get('/api/qr', async (req, reply) => {
  const svg = await QRCode.toString(joinUrlFor(req), {
    type: 'svg',
    margin: 1,
    color: { dark: '#0b1020', light: '#ffffff' },
  })
  // Never cached: the answer now depends on the host header, and a stale QR
  // silently sends players to an address that no longer exists.
  reply.header('Cache-Control', 'no-store').header('Vary', 'Host').type('image/svg+xml')
  return svg
})

/**
 * Wipes the "already played" history for the whole word bank.
 *
 * Harmless on a home network, destructive from the open internet — so once
 * `PUBLIC_URL` is set this needs `ADMIN_TOKEN`, passed as `?token=` or an
 * `x-admin-token` header.
 */
app.post('/api/bank/reset', async (req, reply) => {
  if (isExposed) {
    const given = req.headers['x-admin-token'] ?? req.query.token
    if (!ADMIN_TOKEN || given !== ADMIN_TOKEN) {
      return reply.code(403).send({ error: 'Jeton administrateur requis.' })
    }
  }
  store.resetAll()
  return { ok: true }
})

// ------------------------------------------------------------ static client

const hasBuild = fs.existsSync(path.join(clientDist, 'index.html'))

if (hasBuild) {
  await app.register(fastifyStatic, { root: clientDist })
  // Single-page app: any unknown path falls through to index.html so that
  // /host and deep links survive a refresh.
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'Not found' })
    return reply.sendFile('index.html')
  })
} else {
  app.setNotFoundHandler((req, reply) =>
    reply.type('text/html').send(`<!doctype html><meta charset="utf-8">
      <body style="font:16px system-ui;background:#0b1020;color:#e2e8f0;padding:40px">
      <h1>Client non compilé</h1>
      <p>Lance <code>npm run build</code> puis <code>npm start</code>,
      ou <code>npm run dev</code> pour le mode développement.</p>`),
  )
}

// -------------------------------------------------------------- realtime

await app.ready()

const io = new IOServer(app.server, {
  cors: { origin: true },
  // Phones that lock their screen drop the socket; a generous window means the
  // player reconnects into their seat instead of losing their word.
  pingTimeout: 30000,
})

const gameRooms = createRoomManager(io)

// ------------------------------------------------------------------ boot

await app.listen({ port: PORT, host: HOST })

const others = getLanCandidates().slice(1)
const warnings = []
if (!hasBuild) warnings.push('⚠️  Client non compilé — lance `npm run build`.')
if (isExposed && !ADMIN_TOKEN) {
  warnings.push('⚠️  PUBLIC_URL est défini sans ADMIN_TOKEN : /api/bank/reset est bloqué pour tout le monde.')
}

console.log(`
  🕵️  UNDERCOVER — serveur prêt

  Écran hôte            ${publicUrl}/host
  Joueurs               ${publicUrl}
${isExposed ? `  (exposé publiquement · réseau local : ${lanUrl})` : ''}
${!isExposed && others.length ? `  Autres adresses possibles : ${others.map((i) => `${i.address} (${i.name})`).join(', ')}` : ''}
  Banque : ${totalPairs()} paires · ${listThemes().length} thèmes · ${store.state.gamesPlayed} manches jouées
${gameRooms.restored ? `  ♻️  ${gameRooms.restored} salon(s) restauré(s) avec leurs scores` : ''}
${warnings.length ? '\n  ' + warnings.join('\n  ') : ''}
${isExposed ? '' : '  Si les téléphones ne se connectent pas : npm run firewall'}
`)
