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
  section('Parties publiques : on concentre, on ne refuse jamais')
  {
    const before = await (await fetch(`${URL}/api/public`)).json()

    // Personne n'attend : le premier ouvre au lieu de se voir refuser.
    const first = await fresh()
    const opened = await ask(first, 'player:joinPublic', { name: 'Pub1' })
    check("le premier ouvre une partie", opened.opened === true, String(opened.opened))
    check('et il y est assis', opened.state.players.length === 1)
    check('avec la couronne', opened.you.isHost === true)

    const now = await (await fetch(`${URL}/api/public`)).json()
    check('le compteur le voit', now.players === before.players + 1, `${before.players} → ${now.players}`)

    // Le suivant rejoint la même plutôt que d'en ouvrir une seconde : c'est
    // tout l'intérêt de concentrer.
    const second = await fresh()
    const joined = await ask(second, 'player:joinPublic', { name: 'Pub2' })
    check('le second rejoint la même', joined.code === opened.code, `${joined.code} vs ${opened.code}`)
    check("il n'en ouvre pas une seconde", joined.opened === false)
    check('ils sont deux à table', joined.state.players.length === 2)

    // Une partie privée reste introuvable, même vide et en attente.
    const owner = await fresh()
    const priv = await ask(owner, 'player:createGame', { name: 'Prive' })
    const third = await fresh()
    const elsewhere = await ask(third, 'player:joinPublic', { name: 'Pub3' })
    check('une partie privée ne se fait pas trouver',
      elsewhere.code !== priv.code, `${elsewhere.code} vs ${priv.code}`)

    // Mais son hôte peut l'ouvrir.
    await ask(owner, 'host:settings', {
      code: priv.code, playerId: priv.playerId, settings: { visibility: 'public' },
    })
    await wait(120)
    const after = await (await fetch(`${URL}/api/public`)).json()
    check("passer en public la rend visible", after.players > now.players, `${now.players} → ${after.players}`)

    // Et une valeur farfelue ne doit surtout pas ouvrir la porte.
    const guard2 = await fresh()
    const room = await ask(guard2, 'player:createGame', { name: 'Garde' })
    await ask(guard2, 'host:settings', {
      code: room.code, playerId: room.playerId, settings: { visibility: 'nawak' },
    })
    await wait(120)
    const still = await (await fetch(`${URL}/api/public`)).json()
    check('une visibilité inconnue reste privée', still.players === after.players,
      `${after.players} → ${still.players}`)
  }
} finally {
  sockets.forEach((s) => s.close())
  server.kill()
  await wait(300)
  process.exit(report() ? 0 : 1)
}
