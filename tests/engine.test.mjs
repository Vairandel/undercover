import { check, section, report, FAST, NO_ROLES, driveToEnd } from './helpers.mjs'
import { Game, BLANK_VOTE, REACTIONS } from '../server/game/engine.js'
import { store } from '../server/store.js'

/** A started game with `n` bots, already past the reveal. */
function started(settings = {}, n = 5) {
  const g = new Game('T')
  const ids = Array.from({ length: n }, (_, i) => g.addPlayer(`J${i + 1}`).id)
  g.updateSettings({ ...FAST, ...settings })
  g.start()
  ids.forEach((id) => g.markReady(id))
  return { g, ids }
}
const describeAll = (g) => {
  let i = 0
  while (g.phase === 'describe') g.submitClue(g.currentSpeakerId, `m${i++}`)
}
const teamOf = (g, id) => (g.players.get(id).roleId === 'civilian' ? 'civilian' : 'impostor')

section('Isolation des données')
{
  // The whole reason this file exists in the repo: a test run must be invisible
  // to the household's word history.
  check('les tests écrivent hors des vraies données',
    process.env.UNDERCOVER_DATA_DIR?.includes('tests'), process.env.UNDERCOVER_DATA_DIR)
  const before = store.state.gamesPlayed
  started()
  check('le compteur du bac à sable bouge', store.state.gamesPlayed > before,
    `${before} → ${store.state.gamesPlayed}`)
}

section('Réactions')
{
  const { g, ids } = started({ discussTime: 30 })
  const speaker = g.currentSpeakerId
  g.submitClue(speaker, 'banane')

  const others = ids.filter((id) => id !== speaker)
  check('palette de six', REACTIONS.length === 6, REACTIONS.join(''))
  check("l'étoile est là", REACTIONS.includes('⭐'))

  g.react(others[0], speaker, '🤨')
  g.react(others[1], speaker, '🤨')
  check('deux marques', g.reactionsPlain()[speaker].length === 2)

  g.react(others[0], speaker, '🤨')
  check('re-taper retire', g.reactionsPlain()[speaker].length === 1)

  g.react(others[1], speaker, '💀')
  const marks = g.reactionsPlain()[speaker]
  check('changer remplace sans doubler', marks.length === 1 && marks[0].emoji === '💀')

  let refused = null
  try { g.react(speaker, speaker, '⭐') } catch (e) { refused = e.message }
  check('pas sur son propre indice', refused !== null, refused)

  refused = null
  const mute = ids.find((id) => !g.clues.has(id) && id !== others[0])
  try { g.react(others[0], mute, '👍') } catch (e) { refused = e.message }
  check("pas sur qui n'a pas parlé", refused !== null, refused)

  refused = null
  try { g.react(others[0], speaker, '🍕') } catch (e) { refused = e.message }
  check('emoji hors palette refusé', refused !== null, refused)

  // A new round starts clean.
  describeAll(g)
  const before = Object.keys(g.reactionsPlain()).length
  check('présentes au vote', before > 0, g.phase)
}

section('Chat pendant le vote')
{
  const { g, ids } = started({ discussTime: 30 })
  describeAll(g)
  g.postChat(ids[0], 'il est louche')
  g.skipDiscussion()
  check('phase vote', g.phase === 'vote', g.phase)
  check('le chat reste ouvert', g.publicState().chatOpen === true)
  g.postChat(ids[1], 'dernier mot')
  check('le fil continue', g.chat.length === 2, g.chat.map((m) => m.text).join(' | '))
}

section('Historique des indices')
{
  const { g } = started({ discussTime: 0 })
  describeAll(g)
  const log = g.clueLog()
  check('une manche journalisée', log.length === 1, `${log.length}`)
  check('un indice par joueur', Object.keys(log[0].clues).length === 5)
  // The log is public; the secret words must never ride along in it.
  const words = [g.words.civilianWord, g.words.undercoverWord].map((w) => w.toLowerCase())
  const dump = JSON.stringify(log).toLowerCase()
  check('aucun mot secret dans le journal', !words.some((w) => dump.includes(w)), dump.slice(0, 90))
}

section('Vote blanc')
{
  const { g, ids } = started({ blankVote: true })
  describeAll(g)
  let refused = null
  try {
    const off = new Game('U')
    const oids = Array.from({ length: 4 }, (_, i) => off.addPlayer(`K${i}`).id)
    off.updateSettings({ ...FAST })
    off.start(); oids.forEach((id) => off.markReady(id))
    while (off.phase === 'describe') off.submitClue(off.currentSpeakerId, `z${Math.random()}`)
    off.submitVote(oids[0], BLANK_VOTE)
  } catch (e) { refused = e.message }
  check('refusé quand désactivé', refused !== null, refused)

  g.submitVote(ids[0], BLANK_VOTE)
  check('accepté quand activé', g.votes.get(ids[0]) === BLANK_VOTE)
  check('compté comme voté', g.publicState().players.find((p) => p.id === ids[0]).hasVoted === true)

  const rest = ids.slice(1)
  for (const id of rest) {
    if (g.phase !== 'vote') break
    g.submitVote(id, rest.find((x) => x !== id))
  }
  check('le blanc ne nomme personne', !(BLANK_VOTE in (g.lastResult?.tally ?? {})),
    JSON.stringify(g.lastResult?.tally))
}

section('Récompense et punition')
{
  const { g, ids } = started({ detectiveMode: true, blankVote: true }, 5)
  describeAll(g)
  const imp = ids.find((id) => teamOf(g, id) === 'impostor')
  const civils = ids.filter((id) => teamOf(g, id) === 'civilian')

  g.submitVote(civils[0], imp)
  g.submitVote(civils[1], civils[2])
  g.submitVote(civils[2], BLANK_VOTE)
  g.submitVote(civils[3], imp)
  g.submitVote(imp, civils[0])

  const d = (id) => g.players.get(id).data.detective
  check('bon vote compté', d(civils[0])?.right === 1, JSON.stringify(d(civils[0])))
  check('mauvais vote compté', d(civils[1])?.wrong === 1, JSON.stringify(d(civils[1])))
  check('le blanc ne compte pas', !d(civils[2]), JSON.stringify(d(civils[2]) ?? null))
  check("l'imposteur n'est jamais scoré", !d(imp), JSON.stringify(d(imp) ?? null))
}

section('Plancher à zéro et points négatifs')
{
  // A civilian who votes wrong twice and wins nothing must not go below zero
  // unless the table asked for it.
  const run = (allowNegative) => {
    const g = new Game('N')
    const ids = Array.from({ length: 4 }, (_, i) => g.addPlayer(`P${i}`).id)
    g.updateSettings({
      ...FAST, detectiveMode: true, allowNegative,
      points: { civilian: 0, undercover: 0, mrwhite: 0, survivor: 0, detective: 3 },
    })
    g.start(); ids.forEach((id) => g.markReady(id))
    driveToEnd(g, (alive) => alive.find((p) => p.roleId === 'civilian'))
    return g
  }

  const floored = run(false)
  check('sans négatifs, aucun score sous zéro',
    [...floored.players.values()].every((p) => p.score >= 0),
    [...floored.players.values()].map((p) => p.score).join(', '))

  const free = run(true)
  const anyNegative = [...free.players.values()].some((p) => p.score < 0)
  check('avec négatifs, un score peut passer sous zéro', anyNegative,
    [...free.players.values()].map((p) => p.score).join(', '))
}

section('Mister White lâche le mot en description')
{
  let done = false
  for (let a = 0; a < 20 && !done; a++) {
    const { g, ids } = started({ roles: { ...NO_ROLES, mrwhite: true } }, 5)
    const white = ids.find((id) => g.players.get(id).roleId === 'mrwhite')
    if (!white) continue
    let n = 0
    while (g.phase === 'describe' && g.currentSpeakerId !== white && n++ < 10) {
      g.submitClue(g.currentSpeakerId, `q${n}`)
    }
    if (g.currentSpeakerId !== white) continue

    g.submitClue(white, `  Le ${g.words.civilianWord.toUpperCase()} !`)
    check('la partie est finie sur-le-champ', g.phase === 'gameOver', g.phase)
    check('Mister White gagne', g.outcome?.team === 'mrwhite', JSON.stringify(g.outcome))
    const row = g.scoreboard.find((r) => r.playerId === white)
    check('victoire + mot deviné',
      row.breakdown.some((b) => b.key === 'win') && row.breakdown.some((b) => b.key === 'whiteGuess'),
      JSON.stringify(row.breakdown))
    done = true
  }
  check('scénario monté', done)
}

section('Dernier soupçon')
{
  const { g, ids } = started({ dyingGuess: true }, 5)
  describeAll(g)
  const civil = ids.find((id) => teamOf(g, id) === 'civilian')
  const alive = [...g.players.values()].filter((p) => p.alive)
  for (const p of alive) {
    if (g.phase !== 'vote') break
    g.submitVote(p.id, p.id === civil ? alive.find((x) => x.id !== civil).id : civil)
  }

  const pending = g.players.get(civil).data.dyingGuess
  check("l'éliminé reçoit son invite", Boolean(pending))
  check('rien de public', (g.publicState().dyingGuesses ?? []).length === 0)

  if (pending) {
    check('bonne réponse reconnue', g.submitDyingGuess(civil, pending.expected) === true)
    check('toujours rien de public', (g.publicState().dyingGuesses ?? []).length === 0)
    let refused = null
    try { g.submitDyingGuess(civil, []) } catch (e) { refused = e.message }
    check('pas deux fois', refused !== null, refused)
  }
}

section('Options coupées')
{
  const { g, ids } = started({ reactions: false, endTitles: false, dyingGuess: false, detectiveMode: false })
  const pub = g.publicState()
  check('palette vide', pub.reactionPalette.length === 0)
  check('réactions fermées', pub.reactionsOpen === false)
  let refused = null
  const speaker = g.currentSpeakerId
  g.submitClue(speaker, 'test')
  try { g.react(ids.find((i) => i !== speaker), speaker, '⭐') } catch (e) { refused = e.message }
  check('react refusé', refused !== null, refused)
}

section('Titres')
{
  const short = new Game('S')
  const sids = Array.from({ length: 3 }, (_, i) => short.addPlayer(`X${i}`).id)
  short.updateSettings({ ...FAST })
  short.start(); sids.forEach((id) => short.markReady(id))
  driveToEnd(short, (alive) => alive.find((p) => p.roleId !== 'civilian'))
  check("une partie d'une manche ne décerne rien",
    short.publicState().titles.length === 0,
    short.publicState().titles.map((t) => t.label).join(', '))

  let sawTitles = false
  for (let a = 0; a < 40 && !sawTitles; a++) {
    const g = new Game('L')
    const ids = Array.from({ length: 6 }, (_, i) => g.addPlayer(`Y${i}`).id)
    g.updateSettings({ ...FAST, undercoverCount: 2 })
    g.start(); ids.forEach((id) => g.markReady(id))
    driveToEnd(g, (alive) => alive.find((p) => p.roleId === 'civilian'))
    const titles = g.publicState().titles
    if (titles.length > 0) {
      sawTitles = true
      check('jamais plus de quatre', titles.length <= 4, `${titles.length}`)
      check('un titre par joueur', new Set(titles.map((t) => t.playerId)).size === titles.length)
      check('toujours renseignés', titles.every((t) => t.name && t.detail && t.emoji))
    }
  }
  check('des titres sortent sur des parties plus longues', sawTitles)
}

process.exit(report() ? 0 : 1)
