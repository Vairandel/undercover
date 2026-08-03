import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * One command to play remotely.
 *
 * Opens a Cloudflare quick tunnel, reads the address it prints, then starts the
 * game server already knowing its public URL. The manual dance — launch, copy
 * the hostname, restart the server with it — is the friction that made remote
 * evenings annoying, and a quick tunnel hands out a new hostname every time.
 *
 * Both processes are tied together: quitting one takes the other down, so there
 * is never a server running behind a dead tunnel.
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 3000)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? randomBytes(9).toString('base64url')

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const STARTUP_TIMEOUT_MS = 60_000

const grey = (s) => `[90m${s}[0m`
const bold = (s) => `[1m${s}[0m`

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

console.log(`\n  Ouverture du tunnel Cloudflare…\n`)

tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
  cwd: root,
  shell: process.platform === 'win32',
})

tunnel.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(
      `\n  cloudflared est introuvable.\n\n` +
        `  Installe-le puis rouvre ton terminal :\n` +
        `    winget install --id Cloudflare.cloudflared\n`,
    )
  } else {
    console.error('\n  Impossible de lancer cloudflared :', err.message, '\n')
  }
  shutdown(1)
})

tunnel.on('exit', (code) => {
  if (shuttingDown) return
  console.error(`\n  Le tunnel s'est arrêté (code ${code}). Fin de la partie.\n`)
  shutdown(code ?? 1)
})

let publicUrl = null
const startupTimer = setTimeout(() => {
  if (publicUrl) return
  console.error(
    `\n  Cloudflare n'a pas donné d'adresse en ${STARTUP_TIMEOUT_MS / 1000} s.` +
      `\n  Vérifie ta connexion, puis réessaie.\n`,
  )
  shutdown(1)
}, STARTUP_TIMEOUT_MS)

/** cloudflared writes its banner to stderr, so both streams are watched. */
function watchTunnel(chunk) {
  const text = chunk.toString()
  // Its own logs are noisy and not useful here; only surface real problems.
  for (const line of text.split('\n')) {
    if (/ERR|WRN/.test(line)) console.log(grey(`  cloudflared │ ${line.trim()}`))
  }

  if (publicUrl) return
  const match = text.match(URL_RE)
  if (!match) return

  publicUrl = match[0]
  clearTimeout(startupTimer)
  startServer()
}

tunnel.stdout.on('data', watchTunnel)
tunnel.stderr.on('data', watchTunnel)

function startServer() {
  console.log(`  Adresse publique : ${bold(publicUrl)}`)
  console.log(`  Démarrage du serveur…\n`)

  server = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), PUBLIC_URL: publicUrl, ADMIN_TOKEN },
    stdio: 'inherit',
  })

  server.on('exit', (code) => {
    if (shuttingDown) return
    console.error(`\n  Le serveur s'est arrêté (code ${code}).\n`)
    shutdown(code ?? 1)
  })

  server.on('error', (err) => {
    console.error('\n  Impossible de lancer le serveur :', err.message, '\n')
    shutdown(1)
  })
}
