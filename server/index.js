import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { Server as IOServer } from 'socket.io'
import QRCode from 'qrcode'

import { getLanIp, getLanCandidates } from './net.js'
import {
  listThemes,
  totalPairs,
  themeDetail,
  createTheme,
  deleteTheme,
  addPair,
  removePair,
  WordsError,
} from './words.js'
import { roleCatalogue } from './game/roles/index.js'
import { modifierCatalogue } from './game/modifiers/index.js'
import { createRoomManager } from './game/rooms.js'
import {
  DEFAULT_SETTINGS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  SCORE_FLOORS,
  specialBudget,
} from './game/engine.js'
import { AVATARS, AVATAR_GROUPS, COLORS } from './game/appearance.js'
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
  // `groups` drives the picker's layout; `avatars` stays the flat authority.
  appearance: { avatars: AVATARS, groups: AVATAR_GROUPS, colors: COLORS },
  // Field descriptors drive the settings sliders and the rulebook alike.
  scoring: { fields: POINT_FIELDS, defaults: DEFAULT_POINTS },
  // The labels and explanations live with the rule, not duplicated in the UI.
  scoreFloors: SCORE_FLOORS,
  budgets: Object.fromEntries(
    Array.from({ length: MAX_PLAYERS - 2 }, (_, i) => [i + 3, specialBudget(i + 3)]),
  ),
  limits: { min: MIN_PLAYERS, max: MAX_PLAYERS },
  bank: { pairs: totalPairs(), gamesPlayed: store.state.gamesPlayed },
  // Lets the editor and the workbench know whether to ask for a token.
  needsToken: isExposed,
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
/**
 * Anything that writes to disk needs the token once the app is reachable from
 * outside — otherwise a stranger with the URL could rewrite the word bank.
 */
function requireAdmin(req, reply) {
  if (!isExposed) return true
  const given = req.headers['x-admin-token'] ?? req.query.token
  if (ADMIN_TOKEN && given === ADMIN_TOKEN) return true
  reply.code(403).send({ error: 'Jeton administrateur requis.' })
  return false
}

app.post('/api/bank/reset', async (req, reply) => {
  if (!requireAdmin(req, reply)) return reply
  store.resetAll()
  return { ok: true }
})

// ------------------------------------------------------------ word editor

app.get('/api/words', async () => ({
  themes: listThemes(),
  total: totalPairs(),
  // Lets the editor page know whether it must ask for a token before writing.
  needsToken: isExposed,
}))

app.get('/api/words/:themeId', async (req, reply) => {
  const detail = themeDetail(req.params.themeId)
  if (!detail) return reply.code(404).send({ error: 'Thème introuvable.' })
  return detail
})

/** Wraps editor calls so a validation error reads as a message, not a crash. */
async function edit(req, reply, fn) {
  if (!requireAdmin(req, reply)) return reply
  try {
    return { ok: true, theme: fn() ?? null, themes: listThemes(), total: totalPairs() }
  } catch (err) {
    if (err instanceof WordsError) return reply.code(400).send({ error: err.message })
    throw err
  }
}

app.post('/api/words/theme', async (req, reply) =>
  edit(req, reply, () => createTheme(req.body ?? {})))

app.delete('/api/words/:themeId', async (req, reply) =>
  edit(req, reply, () => { deleteTheme(req.params.themeId); return null }))

app.post('/api/words/:themeId/pair', async (req, reply) =>
  edit(req, reply, () => addPair(req.params.themeId, req.body ?? {})))

// Fastify already percent-decodes route params, so the key arrives verbatim.
app.delete('/api/words/:themeId/pair/:key', async (req, reply) =>
  edit(req, reply, () => removePair(req.params.themeId, req.params.key)))

// -------------------------------------------------------------- simulation

/** Ceilings, so one request cannot pin the machine the game is running on. */
const SIM_MAX_GAMES = 20000
const SIM_TIMEOUT_MS = 120_000
let simRunning = false

/**
 * Runs the balance simulator and hands back its aggregates.
 *
 * Deliberately a **child process**, not an in-process call. This server holds
 * the household's real word history in memory and on disk; a few thousand
 * simulated games running inside it would draw real pairs and stamp them
 * "already played". The child gets `UNDERCOVER_DATA_DIR` pointed somewhere
 * disposable, which is the only way to be sure.
 *
 * One at a time: it is CPU-bound, and two runs at once would just make both
 * slow while the game itself stutters.
 */
app.post('/api/simulate', async (req, reply) => {
  if (!requireAdmin(req, reply)) return reply
  if (simRunning) return reply.code(429).send({ error: 'Une simulation tourne déjà.' })

  const body = req.body ?? {}
  const games = Math.max(1, Math.min(SIM_MAX_GAMES, Math.round(Number(body.games) || 1000)))
  const players = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(Number(body.players) || 6)))

  const config = {
    games,
    players,
    // Games played by the same table before scores reset — an evening.
    sessionLength: Math.max(1, Math.min(20, Math.round(Number(body.sessionLength) || 1))),
    skill: clamp01(body.skill, 0.5),
    skillGrowth: clamp01(body.skillGrowth, 0.08),
    blankRate: clamp01(body.blankRate, 0.1),
    whiteGuessRate: clamp01(body.whiteGuessRate, 0.35),
    whiteBlurtRate: clamp01(body.whiteBlurtRate, 0.03),
    dyingAnswerRate: clamp01(body.dyingAnswerRate, 0.9),
    seed: Number.isFinite(Number(body.seed)) ? Number(body.seed) : null,
    settings: body.settings ?? {},
    sweep:
      body.sweep?.key && Array.isArray(body.sweep.values) && body.sweep.values.length > 0
        ? { key: String(body.sweep.key), values: body.sweep.values.slice(0, 8).map(Number) }
        : null,
  }

  simRunning = true
  try {
    return await runSimulator(config)
  } catch (err) {
    return reply.code(500).send({ error: err.message })
  } finally {
    simRunning = false
  }
})

function clamp01(raw, fallback) {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback
}

function runSimulator(config) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(here, '..', 'scripts', 'simulate.mjs'), '--json', '--config', '-'],
      {
        cwd: path.join(here, '..'),
        env: {
          ...process.env,
          UNDERCOVER_DATA_DIR: path.join(here, '..', 'simulations', '.scratch'),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`La simulation a dépassé ${SIM_TIMEOUT_MS / 1000}s — réduis le nombre de parties.`))
    }, SIM_TIMEOUT_MS)

    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { err += c })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || `Code ${code}`))
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error('Sortie du simulateur illisible.'))
      }
    })

    // The config travels on stdin rather than the command line: it nests, and
    // quoting JSON through a shell is a reliable way to lose a character.
    child.stdin.end(JSON.stringify(config))
  })
}

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
  warnings.push('⚠️  PUBLIC_URL est défini sans ADMIN_TOKEN : /words et /api/bank/reset sont bloqués pour tout le monde.')
}

// Printed only when the app is exposed, because that is the only case where the
// token is required — and where a generated one would otherwise be unknowable.
// It goes to the host's own terminal, which is exactly who needs it.
const adminLine =
  isExposed && ADMIN_TOKEN
    ? `\n  Éditer les mots       ${publicUrl}/words\n  Jeton administrateur  ${ADMIN_TOKEN}`
    : ''

console.log(`
  🕵️  UNDERCOVER — serveur prêt

  Écran hôte            ${publicUrl}/host
  Joueurs               ${publicUrl}${adminLine}
${isExposed ? `  (exposé publiquement · réseau local : ${lanUrl})` : ''}
${!isExposed && others.length ? `  Autres adresses possibles : ${others.map((i) => `${i.address} (${i.name})`).join(', ')}` : ''}
  Banque : ${totalPairs()} paires · ${listThemes().length} thèmes · ${store.state.gamesPlayed} manches jouées
${gameRooms.restored ? `  ♻️  ${gameRooms.restored} salon(s) restauré(s) avec leurs scores` : ''}
${warnings.length ? '\n  ' + warnings.join('\n  ') : ''}
${isExposed ? '' : '  Si les téléphones ne se connectent pas : npm run firewall'}
`)
