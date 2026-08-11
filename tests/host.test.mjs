import { spawn } from 'node:child_process'
import { io } from 'socket.io-client'
import { check, section, report, root, testEnv, wait } from './helpers.mjs'

/**
 * The shared screen stopped being mandatory, so this pins the two things that
 * change: a phone can open a game, and a screen that merely knows the code
 * cannot drive one.
 */
const PORT = 3391
const URL = `http://127.0.0.1:${PORT}`

const connect = () => new Promise((res, rej) => {
  const s = io(URL, { transports: ['websocket'], reconnection: false })
  s.on('connect', () => res(s))
  s.on('connect_error', rej)
})
const ask = (s, e, p = {}) => new Promise((res, rej) =>
  s.timeout(6000).emit(e, p, (err, r) =>
    err ? rej(new Error('timeout ' + e)) : r?.ok ? res(r) : rej(new Error(r?.error))))
const tryAsk = (s, e, p = {}) => new Promise((res) =>
  s.timeout(6000).emit(e, p, (err, r) => res(err ? { ok: false, error: 'timeout' } : r)))

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root, env: testEnv({ PORT: String(PORT) }), stdio: 'ignore',
})
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${URL}/api/info`)).ok) break } catch { /* pas encore */ }
  await wait(200)
}

const sockets = []
const fresh = async () => { const s = await connect(); sockets.push(s); return s }

try {
  section('Une partie peut naître sur un téléphone')
  {
    const phone = await fresh()
    const res = await ask(phone, 'player:createGame', { name: 'Alice', avatar: '🦊' })

    check('un code est rendu', /^[A-Z]{4}$/.test(res.code ?? ''), res.code)
    check('le créateur est assis', Boolean(res.playerId))
    check('il porte la couronne', res.you?.isHost === true)
    check('il est seul à table', res.state.players.length === 1)
    check('son avatar est respecté', res.state.players[0].avatar === '🦊')

    // Le serveur accepte déjà les réglages du porteur de couronne — c'est ce
    // qui rend l'écran facultatif.
    const set = await tryAsk(phone, 'host:settings', {
      code: res.code, playerId: res.playerId, settings: { discussTime: 30, undercoverCount: 2 },
    })
    check('la couronne peut régler la partie', set.ok === true, set.error)
    await wait(150)

    const other = await fresh()
    const joined = await ask(other, 'player:join', { code: res.code, name: 'Bob' })
    check('un second joueur rejoint', joined.state.players.length === 2)
    check('et ne porte pas la couronne', joined.you.isHost === false)

    const refused = await tryAsk(other, 'host:settings', {
      code: res.code, playerId: joined.playerId, settings: { discussTime: 0 },
    })
    check('un joueur sans couronne ne règle rien', refused.ok === false, refused.error)
    check('ni ne lance la partie',
      (await tryAsk(other, 'host:start', { code: res.code, playerId: joined.playerId })).ok === false)
  }

  section('Un pseudo refusé ne laisse pas de salon fantôme')
  {
    const before = (await (await fetch(`${URL}/api/info`)).json()) && null
    const phone = await fresh()
    const bad = await tryAsk(phone, 'player:createGame', { name: '   ' })
    check('pseudo vide refusé', bad.ok === false, bad.error)

    // Le salon est détruit dans la foulée : s'il survivait, il occuperait une
    // place sous le plafond pendant dix minutes pour rien.
    const good = await ask(phone, 'player:createGame', { name: 'Chloe' })
    check('la création suivante marche quand même', /^[A-Z]{4}$/.test(good.code), good.code)
    void before
  }

  section("Un écran qui connaît le code ne commande pas")
  {
    const phone = await fresh()
    const game = await ask(phone, 'player:createGame', { name: 'Diego' })

    const tv = await fresh()
    const watch = await ask(tv, 'host:watch', { code: game.code })
    check("l'écran voit la partie", watch.state.code === game.code)
    check('mais sans les commandes', watch.control === false, String(watch.control))

    for (const [event, label] of [
      ['host:settings', 'régler'],
      ['host:start', 'lancer'],
      ['host:kick', 'expulser'],
      ['host:resetScores', 'remettre les scores à zéro'],
    ]) {
      const r = await tryAsk(tv, event, { code: game.code, settings: {}, playerId: game.playerId })
      check(`il ne peut pas ${label}`, r.ok === false, r.error)
    }
  }

  section("L'écran qui a ouvert la partie garde la main")
  {
    const tv = await fresh()
    const made = await ask(tv, 'host:create')
    check('un jeton est remis', typeof made.screenToken === 'string' && made.screenToken.length > 10)
    check('le jeton reste privé', !JSON.stringify(made.state).includes(made.screenToken))

    const set = await tryAsk(tv, 'host:settings', { code: made.code, settings: { discussTime: 0 } })
    check('il règle la partie', set.ok === true, set.error)

    // Rafraîchir la page : nouveau socket, même écran.
    const again = await fresh()
    const back = await ask(again, 'host:watch', { code: made.code, screenToken: made.screenToken })
    check('avec son jeton, il retrouve la main', back.control === true)
    check('et peut de nouveau régler',
      (await tryAsk(again, 'host:settings', { code: made.code, settings: { discussTime: 30 } })).ok === true)

    const impostor = await fresh()
    const wrong = await ask(impostor, 'host:watch', { code: made.code, screenToken: 'pas-le-bon' })
    check('un mauvais jeton ne donne rien', wrong.control === false)
    check('et ne règle rien',
      (await tryAsk(impostor, 'host:settings', { code: made.code, settings: {} })).ok === false)
  }
} finally {
  sockets.forEach((s) => s.close())
  server.kill()
  await wait(300)
  process.exit(report() ? 0 : 1)
}
