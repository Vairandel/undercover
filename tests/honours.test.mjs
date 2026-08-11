import { check, section, report, FAST, driveToEnd } from './helpers.mjs'
import { Game } from '../server/game/engine.js'
import { HONOURS, awardHonours, honourBudget } from '../server/game/honours.js'
import { blankCareer } from '../server/game/career.js'

/** Un joueur factice, pour éprouver les titres sans jouer une soirée entière. */
const who = (name, career = {}, extra = {}) => ({
  id: name, name, avatar: '🦊', color: '#fff', score: 0, left: false,
  career: { ...blankCareer(0), games: 4, ...career },
  ...extra,
})

section('Le catalogue tient debout')
{
  const keys = HONOURS.map((h) => h.key)
  check('aucune clé en double', new Set(keys).size === keys.length,
    keys.filter((k, i) => keys.indexOf(k) !== i).join(', ') || '—')
  check('chacun a un libellé, un emoji, un ton',
    HONOURS.every((h) => h.label && h.emoji && h.tone),
    HONOURS.filter((h) => !(h.label && h.emoji && h.tone)).map((h) => h.key).join(', ') || '—')
  check('les tons sont connus',
    HONOURS.every((h) => ['good', 'bad', 'neutral', 'sympathy'].includes(h.tone)))
  check('il y a des positifs et des négatifs',
    HONOURS.some((h) => h.tone === 'good') && HONOURS.some((h) => h.tone === 'bad'),
    `${HONOURS.filter((h) => h.tone === 'good').length} bons · ${HONOURS.filter((h) => h.tone === 'bad').length} piquants`)
  check('un dernier recours existe',
    HONOURS.some((h) => h.fallback && h.find({}, blankCareer(0), {}) === null) ||
    HONOURS.at(-1).find({}, { ...blankCareer(0), games: 1 }, {}) !== null)
}

section('Personne ne repart les mains vides')
{
  // Une table parfaitement terne : aucune statistique saillante nulle part.
  const bland = Array.from({ length: 6 }, (_, i) =>
    who(`J${i}`, { games: 3, votesCast: 3, votesRight: 1, lifespan: 6, survived: 1, eliminated: 2 }))
  const out = awardHonours({ players: bland, totalGames: 3 })

  const served = new Set(out.map((h) => h.playerId))
  check('chaque joueur a un titre', served.size === 6, `${served.size}/6`)
  check('aucun titre décerné deux fois',
    new Set(out.map((h) => h.key)).size === out.length)
  check('le plafond est respecté', out.length <= honourBudget(6), `${out.length} ≤ ${honourBudget(6)}`)
  check('tous les titres ont une justification', out.every((h) => h.detail?.length > 5))
}

section("Un titre ne tombe jamais sans les chiffres derrière")
{
  const nobody = [who('Seul', { games: 1, votesCast: 1 })]
  const out = awardHonours({ players: nobody, totalGames: 1 })
  check('une seule partie ne déclenche pas les titres exigeants',
    out.every((h) => !['invaincu', 'limier', 'consommable', 'mutique'].includes(h.key)),
    out.map((h) => h.key).join(', '))
  check('mais il a quand même quelque chose', out.length >= 1, out.map((h) => h.label).join(', '))
}

section('Le cran méchant ne sort que sur du massif')
{
  const soft = [who('Tiède', { games: 4, cluesTimedOut: 2 }), who('Autre', { games: 4 })]
  const hard = [who('Dur', { games: 6, cluesTimedOut: 6 }), who('Autre', { games: 6 })]

  const a = awardHonours({ players: soft, totalGames: 4 }).find((h) => h.key === 'mutique')
  const b = awardHonours({ players: hard, totalGames: 6 }).find((h) => h.key === 'mutique')

  check('deux ratés : formulation douce', a?.label === 'Le Mutique', a?.label)
  check('six ratés : formulation qui pique', b?.label === 'Le Mime', b?.label)
  check('et le texte change aussi', b?.detail?.includes('performance artistique'), b?.detail)
}

section('Les titres réellement mérités passent devant')
{
  const table = [
    who('Parfait', { games: 4, votesCast: 8, votesRight: 8, votesBlank: 0 }),
    who('Nul', { games: 8, votesCast: 8, votesRight: 0, votesBlank: 0 }),
    who('Quelconque', { games: 4, votesCast: 6, votesRight: 3 }),
  ]
  const out = awardHonours({ players: table, totalGames: 4 })
  const held = (id) => out.filter((h) => h.playerId === id)

  check('le bon voteur est reconnu', held('Parfait').some((h) => h.key === 'limier'),
    held('Parfait').map((h) => h.label).join(', '))
  check('le mauvais aussi', held('Nul').some((h) => h.key === 'boussole'),
    held('Nul').map((h) => h.label).join(', '))
  check('et il prend la version qui pique',
    held('Nul').some((h) => h.label === "Le Tireur d'élite"),
    held('Nul').map((h) => h.label).join(', '))
  check('le quelconque a quand même un titre', held('Quelconque').length > 0,
    held('Quelconque').map((h) => h.label).join(', '))
}

section('Ceux qui sont partis restent au palmarès')
{
  const table = [
    who('Resté', { games: 4 }),
    who('Parti', { games: 2, firstOut: 3 }, { left: true }),
  ]
  const out = awardHonours({ players: table, totalGames: 4 })
  check('le partant a un titre', out.some((h) => h.playerId === 'Parti'))
  check('et il est signalé comme parti', out.find((h) => h.playerId === 'Parti')?.left === true)
}

section('On ne commence pas par une vanne')
{
  const table = [
    who('Bon', { games: 5, wins: 5 }),
    who('Mauvais', { games: 5, firstOut: 4 }),
    who('Neutre', { games: 5, chatLines: 20 }),
  ]
  const out = awardHonours({ players: table, totalGames: 5 })
  check('le premier titre affiché est flatteur', out[0]?.tone === 'good', `${out[0]?.tone} — ${out[0]?.label}`)
}

section('Sur une vraie soirée jouée')
{
  const g = new Game('H')
  const ids = ['Ana', 'Bo', 'Cy', 'Dan', 'Eve'].map((n) => g.addPlayer(n).id)
  g.updateSettings({ ...FAST, undercoverCount: 1 })

  for (let n = 0; n < 4; n++) {
    if (n > 0) g.restart()
    g.start()
    for (let i = 0; i < ids.length; i++) g.markReady(ids[(i + n) % ids.length])
    driveToEnd(g, (alive) => alive.find((p) => p.roleId === 'civilian') ?? alive[0])
  }

  const players = [...g.players.values()]
  check('quatre parties enregistrées', players.every((p) => p.career.games === 4),
    players.map((p) => p.career.games).join(', '))

  const out = awardHonours({ players, totalGames: 4 })
  check('des titres sortent', out.length >= players.length, `${out.length} pour ${players.length} joueurs`)
  check('chacun a le sien', new Set(out.map((h) => h.playerId)).size === players.length)
  check('aucun doublon de titre', new Set(out.map((h) => h.key)).size === out.length)
  check('tous justifiés', out.every((h) => h.detail && h.name && h.emoji))

  console.log('\n   palmarès obtenu :')
  for (const h of out) console.log(`     ${h.emoji} ${h.label.padEnd(22)} ${h.name.padEnd(5)} ${h.detail}`)
}

section('Clore la soirée, puis en rouvrir une')
{
  const g = new Game('F')
  const ids = ['Ana', 'Bo', 'Cy', 'Dan'].map((n) => g.addPlayer(n).id)
  g.updateSettings({ ...FAST })

  let refused = null
  try { g.endSession() } catch (e) { refused = e.message }
  check('rien à clore avant la première partie', refused !== null, refused)

  for (let n = 0; n < 3; n++) {
    if (n > 0) g.restart()
    g.start()
    ids.forEach((id) => g.markReady(id))
    driveToEnd(g, (alive) => alive.find((p) => p.roleId === 'civilian') ?? alive[0])
  }

  check('la partie est finie', g.phase === 'gameOver', g.phase)
  g.endSession()

  const pub = g.publicState()
  check('la soirée est close', pub.sessionOver === true)
  check('le classement final est là', pub.finalStandings.length === 4)
  check('il est trié par score',
    pub.finalStandings.every((p, i, a) => i === 0 || a[i - 1].score >= p.score),
    pub.finalStandings.map((p) => p.score).join(' ≥ '))
  check('chacun a son titre',
    new Set(pub.honours.map((h) => h.playerId)).size === 4,
    pub.honours.map((h) => `${h.name}:${h.label}`).join(' · '))

  // Clore ne doit rien détruire : mêmes joueurs, même code, mêmes scores.
  check('les joueurs sont toujours là', g.players.size === 4)
  check('les scores tiennent', pub.finalStandings.some((p) => p.score > 0))

  const before = pub.finalStandings[0].score
  g.newEvening()
  const after = g.publicState()
  check('nouvelle soirée : retour au salon', after.phase === 'lobby', after.phase)
  check('scores remis à zéro', after.players.every((p) => p.score === 0), `avant ${before}`)
  check('carnets remis à zéro', [...g.players.values()].every((p) => p.career.games === 0))
  check('titres effacés', after.honours.length === 0)
  check('le salon garde son code et ses joueurs', after.code === 'F' && after.players.length === 4)
}

section('On ne clôt pas au milieu d\'une manche')
{
  const g = new Game('M')
  const ids = ['A', 'B', 'C', 'D'].map((n) => g.addPlayer(n).id)
  g.updateSettings({ ...FAST })
  g.start(); ids.forEach((id) => g.markReady(id))

  let refused = null
  try { g.endSession() } catch (e) { refused = e.message }
  check('refusé pendant la description', refused !== null, refused)
  check('et le message dit quoi faire', /abandonne|termine/i.test(refused ?? ''), refused)
}

process.exit(report() ? 0 : 1)
