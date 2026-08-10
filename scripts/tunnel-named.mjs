import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

/**
 * Permanent tunnel, on your own domain.
 *
 * The quick tunnel (`npm run tunnel`) hands out a new hostname every launch, so
 * the address has to be re-shared every evening and nobody can bookmark it.
 * A named tunnel is bound to a hostname you own: it never changes, which turns
 * the QR code back into a convenience rather than the only way in.
 *
 * Setup is a one-off and this script does it: it checks you are logged in,
 * creates the tunnel if it does not exist, points the DNS record at it, then
 * runs it alongside the game. Every later launch skips straight to running.
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(root, 'server', 'data', 'tunnel.json')
const certPath = path.join(os.homedir(), '.cloudflared', 'cert.pem')

const PORT = Number(process.env.PORT ?? 3000)

const bold = (s) => `\x1b[1m${s}\x1b[0m`
const grey = (s) => `\x1b[90m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`

// ------------------------------------------------------------------ config

function loadConfig() {
  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { /* first run */ }

  const flag = (name) => {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
  }

  const hostname = flag('hostname') ?? process.env.TUNNEL_HOSTNAME ?? saved.hostname
  const config = {
    hostname,
    tunnel: flag('tunnel') ?? process.env.TUNNEL_NAME ?? saved.tunnel ?? 'undercover',
    /**
     * Kept rather than regenerated: with a permanent address, the word editor
     * is a page you come back to. A token that changed at every launch would
     * have to be re-copied every time, which is how people end up disabling it.
     */
    adminToken: process.env.ADMIN_TOKEN ?? saved.adminToken ?? randomBytes(9).toString('base64url'),
  }

  if (!config.hostname) {
    console.error(`
  ${red('Il manque le nom d\'hôte.')}

  Donne l'adresse complète que tes amis taperont, une seule fois :

    ${bold('npm run tunnel:named -- --hostname undercover.tondomaine.org')}

  Elle sera retenue pour les fois suivantes.
`)
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return config
}

// ----------------------------------------------------------------- helpers

/** Runs cloudflared and returns its output, without letting it kill us. */
function cf(args, { quiet = true } = {}) {
  const res = spawnSync('cloudflared', args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (res.error?.code === 'ENOENT') {
    console.error(`
  ${red('cloudflared est introuvable.')}

  Installe-le puis rouvre ton terminal :
    ${bold('winget install --id Cloudflare.cloudflared')}
`)
    process.exit(1)
  }
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  if (!quiet && out.trim()) console.log(grey(out.trim().split('\n').map((l) => `  │ ${l}`).join('\n')))
  return { code: res.status, out }
}

/**
 * Checked before anything else.
 *
 * Without this, a missing cloudflared surfaces as "authorisation not finished"
 * — the login step is simply the first thing that tries to run it — and you go
 * hunting for a Cloudflare problem that does not exist.
 */
function requireCloudflared() {
  const res = spawnSync('cloudflared', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (res.error?.code === 'ENOENT' || res.status !== 0) {
    console.error(`
  ${red('cloudflared est introuvable.')}

  Installe-le puis rouvre ton terminal :
    ${bold('winget install --id Cloudflare.cloudflared')}
`)
    process.exit(1)
  }
}

function requireLogin() {
  if (fs.existsSync(certPath)) return
  console.log(`
  ${bold('Première étape : autoriser cloudflared sur ton compte.')}

  Une page va s'ouvrir dans ton navigateur. Choisis le domaine
  que tu viens d'acheter, puis reviens ici.
`)
  const res = spawnSync('cloudflared', ['tunnel', 'login'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (res.status !== 0 || !fs.existsSync(certPath)) {
    console.error(`\n  ${red('Autorisation non terminée.')} Relance la commande quand c'est fait.\n`)
    process.exit(1)
  }
}

/** Creates the tunnel unless it already exists, and returns its id. */
function ensureTunnel(name) {
  const list = cf(['tunnel', 'list'])
  // The listing is columnar: the id sits first, the name second.
  for (const line of list.out.split('\n')) {
    const m = line.match(/^([0-9a-f-]{36})\s+(\S+)/i)
    if (m && m[2] === name) return m[1]
  }

  console.log(`  Création du tunnel ${bold(name)}…`)
  const created = cf(['tunnel', 'create', name], { quiet: false })
  if (created.code !== 0) {
    console.error(`\n  ${red('Impossible de créer le tunnel.')}\n`)
    process.exit(1)
  }
  const id = created.out.match(/([0-9a-f-]{36})/i)?.[1]
  return id ?? name
}

/**
 * Points the hostname at the tunnel.
 *
 * Safe to repeat: Cloudflare answers "record already exists" and we treat that
 * as success, so a relaunch never fails on a route that is already correct.
 */
function ensureRoute(name, hostname) {
  const res = cf(['tunnel', 'route', 'dns', name, hostname])
  const already = /already exists|already configured|record with that host/i.test(res.out)
  if (res.code !== 0 && !already) {
    console.error(`
  ${red(`Impossible de router ${hostname}.`)}

  Vérifie que le domaine est bien géré par Cloudflare (ses serveurs de noms
  doivent pointer vers Cloudflare) et que tu as choisi le bon compte à l'étape
  d'autorisation.
`)
    console.error(grey(res.out.trim()))
    process.exit(1)
  }
  return already ? 'déjà en place' : 'créé'
}

// -------------------------------------------------------------------- main

const config = loadConfig()
const publicUrl = `https://${config.hostname}`

console.log(`\n  🔗  Tunnel permanent · ${bold(config.hostname)}\n`)

requireCloudflared()
requireLogin()
ensureTunnel(config.tunnel)
const routeState = ensureRoute(config.tunnel, config.hostname)
console.log(`  DNS ${routeState}. Démarrage…\n`)

let server = null
let tunnel = null
let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const p of [server, tunnel]) {
    try { p?.kill() } catch { /* already gone */ }
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

tunnel = spawn(
  'cloudflared',
  ['tunnel', '--url', `http://localhost:${PORT}`, 'run', config.tunnel],
  { cwd: root, shell: process.platform === 'win32' },
)

/** cloudflared is noisy on stderr; only real problems are worth surfacing. */
const watch = (chunk) => {
  for (const line of chunk.toString().split('\n')) {
    if (/ERR|WRN/.test(line)) console.log(grey(`  cloudflared │ ${line.trim()}`))
  }
}
tunnel.stdout.on('data', watch)
tunnel.stderr.on('data', watch)

tunnel.on('exit', (code) => {
  if (shuttingDown) return
  console.error(`\n  Le tunnel s'est arrêté (code ${code}).\n`)
  shutdown(code ?? 1)
})

// Unlike the quick tunnel there is no address to wait for — we already know it,
// which is the entire point of a named tunnel.
server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), PUBLIC_URL: publicUrl, ADMIN_TOKEN: config.adminToken },
  stdio: 'inherit',
})

server.on('exit', (code) => {
  if (shuttingDown) return
  console.error(`\n  Le serveur s'est arrêté (code ${code}).\n`)
  shutdown(code ?? 1)
})

server.on('error', (err) => {
  console.error(`\n  Impossible de lancer le serveur : ${err.message}\n`)
  shutdown(1)
})
