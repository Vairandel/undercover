import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Headless game simulator, for tuning the point scale.
 *
 * The scale is the one thing playtesting answers slowly: you need dozens of
 * games before you can tell whether five points for Mister White is generous or
 * stingy, and by then the group has moved on. This plays thousands in a second
 * against the *real* engine — same roles, same win conditions, same scoring —
 * and reports what each camp actually walks away with.
 *
 * What it does NOT model is language. A bot cannot write a clue that is clever
 * or clumsy, so the thing that decides games in real life is replaced by a
 * single honest knob: `skill`, the chance a civilian's ballot finds an impostor.
 * Everything downstream — win rates, points per role, how often a title fires —
 * follows from that. So read the output as "given a table that catches
 * impostors 55% of the time, is this scale fair?", which is the question a
 * point scale actually has to answer.
 *
 * Its data directory is forced somewhere disposable, so a hundred thousand
 * simulated rounds never touch the household's real word history.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const simDir = path.join(root, 'simulations')

// Must be set before the engine is imported — `paths.js` reads it at load.
process.env.UNDERCOVER_DATA_DIR ??= path.join(simDir, '.scratch')

const { Game, BLANK_VOTE, MIN_PLAYERS, MAX_PLAYERS } = await import('../server/game/engine.js')
const { getRole } = await import('../server/game/roles/index.js')
const { DEFAULT_POINTS, POINT_FIELDS } = await import('../server/game/scoring.js')
const { store } = await import('../server/store.js')

// ------------------------------------------------------------------ config

const DEFAULT_SIM = {
  games: 2000,
  players: 6,
  /**
   * Games played by the same table before the scores are wiped — an evening.
   * Left at 1 you measure single games; raise it and you measure how a scale
   * behaves over a session, which is where the score floor and runaway leaders
   * actually show up.
   */
  sessionLength: 5,
  /** Chance a civilian's ballot lands on an impostor rather than a neighbour. */
  skill: 0.5,
  /** How much better the table gets with each round of evidence. */
  skillGrowth: 0.08,
  /** Chance a civilian votes blank instead, when the option is on. */
  blankRate: 0.1,
  /** Chance Mister White names the word when given his last chance. */
  whiteGuessRate: 0.35,
  /** Chance he blurts it out mid-description instead — usually a bad bet. */
  whiteBlurtRate: 0.03,
  /** Chance an eliminated civilian answers his dying guess at all. */
  dyingAnswerRate: 0.9,
  settings: {},
  /** e.g. { key: 'mrwhite', values: [3, 4, 5, 6, 7] } */
  sweep: null,
  out: null,
  seed: null,
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const [rawKey, inline] = arg.slice(2).split('=')
    const value = inline ?? (argv[i + 1]?.startsWith('--') ? 'true' : argv[++i] ?? 'true')

    if (rawKey === 'config') { out.config = value; continue }
    if (rawKey === 'sweep') {
      const [key, list] = value.split('=')
      out.sweep = { key, values: (list ?? '').split(',').map(Number).filter(Number.isFinite) }
      continue
    }
    // `--set.discussTime 0` and `--points.mrwhite 4` reach into the game itself.
    if (rawKey.startsWith('set.')) {
      out.settings ??= {}
      out.settings[rawKey.slice(4)] = coerce(value)
      continue
    }
    if (rawKey.startsWith('points.')) {
      out.settings ??= {}
      out.settings.points ??= {}
      out.settings.points[rawKey.slice(7)] = Number(value)
      continue
    }
    if (rawKey.startsWith('roles.')) {
      out.settings ??= {}
      out.settings.roles ??= {}
      out.settings.roles[rawKey.slice(6)] = coerce(value)
      continue
    }
    out[rawKey] = coerce(value)
  }
  return out
}

function coerce(v) {
  if (v === 'true') return true
  if (v === 'false') return false
  const n = Number(v)
  return Number.isFinite(n) && v.trim?.() !== '' ? n : v
}

async function readStdin() {
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return data
}

/** Deterministic PRNG, so a run can be replayed exactly. */
function makeRandom(seed) {
  if (seed == null) return Math.random
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const trueRandom = Math.random

/**
 * Seeds the engine's own randomness as well as the bots'.
 *
 * Role dealing, turn order and the word draw all reach for `Math.random`
 * directly, so seeding only the bots left half the run unreproducible — two
 * sweeps of the same scale would deal different roles and the comparison would
 * be measuring luck. Overriding the global is heavy-handed, but this is a
 * single-purpose script with no server in it, and the alternative is threading
 * a generator through every corner of the engine for the benefit of one caller.
 */
function seedEverything(seed) {
  const rng = makeRandom(seed)
  Math.random = seed == null ? trueRandom : rng
  return rng
}

// -------------------------------------------------------------------- bots

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]

/**
 * An evening: the same table playing several games in a row, scores carrying
 * over exactly as they do in a real room.
 *
 * This is the only way some rules can be judged at all. The score floor is the
 * clearest case — `par manche` and `cumulé` are indistinguishable inside a
 * single game and only diverge once there is a running total to bite into. The
 * same goes for the point scale itself: what matters is not who wins one game
 * but whether an evening ends close or crushed.
 */
function playSession(config, rng, index) {
  const g = new Game(`S${index}`)
  const names = Array.from({ length: config.players }, (_, i) => `J${i + 1}`)
  const ids = names.map((n) => g.addPlayer(n).id)
  g.updateSettings({ ...config.settings })

  const games = []
  for (let round = 0; round < config.sessionLength; round++) {
    if (round > 0) g.restart()
    games.push(playGame(g, ids, config, rng))
  }

  // The evening's final table, which is what people actually argue about.
  const standings = [...g.players.values()]
    .map((p) => ({ name: p.name, score: p.score, wins: p.wins }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'))

  return { games, standings }
}

/**
 * Plays one game of an already-seated table to completion.
 *
 * Every decision goes through the real engine, so anything the rules do — a
 * Vengeuse taking someone with her, a tie handed to the Justicier, a shared
 * victory — happens here exactly as it would at the table.
 */
function playGame(g, ids, config, rng) {
  g.start()
  for (const id of ids) g.markReady(id)

  const teamOf = (id) => {
    const p = g.players.get(id)
    return p?.roleId ? getRole(p.roleId).team : null
  }
  const aliveIds = () => [...g.players.values()].filter((p) => p.alive).map((p) => p.id)
  const impostorsAlive = () => aliveIds().filter((id) => teamOf(id) !== 'civilian')

  let clueSeq = 0
  let guard = 0

  while (g.phase !== 'gameOver' && guard++ < 400) {
    switch (g.phase) {
      case 'describe': {
        const id = g.currentSpeakerId
        if (!id) break
        // Mister White occasionally gambles on saying the word outright.
        const isWhite = g.players.get(id).roleId === 'mrwhite'
        if (isWhite && g.settings.writtenClues && rng() < config.whiteBlurtRate) {
          try { g.submitClue(id, g.words.civilianWord); break } catch { /* fall through */ }
        }
        try { g.submitClue(id, `c${clueSeq++}`) } catch { g.advanceTurn() }
        break
      }

      case 'discuss':
        g.skipDiscussion()
        break

      case 'vote': {
        // A snapshot: the engine tallies the moment the last ballot lands, and
        // iterating a list that is being eliminated underneath is a bug farm.
        const voters = [...g.players.values()].filter((p) => g.canVote(p)).map((p) => p.id)
        for (const voterId of voters) {
          if (g.phase !== 'vote' || g.votes.has(voterId)) continue
          const others = aliveIds().filter((id) => id !== voterId)
          if (others.length === 0) break

          const impostors = impostorsAlive().filter((id) => id !== voterId)
          let target

          if (teamOf(voterId) === 'civilian') {
            // The table sharpens as clues pile up — that is what rounds are for.
            const acuity = Math.min(0.95, config.skill + config.skillGrowth * (g.round - 1))
            const innocents = others.filter((id) => teamOf(id) === 'civilian')

            if (g.settings.blankVote && rng() < config.blankRate) target = BLANK_VOTE
            else if (impostors.length > 0 && rng() < acuity) target = pick(rng, impostors)
            // A miss lands on an innocent *by construction*. Falling back to
            // "any other player" would let luck sneak extra hits in, and the
            // measured accuracy would drift well above the `skill` asked for —
            // which would make the one honest knob in here a liar.
            else target = pick(rng, innocents.length > 0 ? innocents : others)
          } else {
            // An impostor steers the vote onto a civilian — any civilian.
            const civils = others.filter((id) => teamOf(id) === 'civilian')
            target = civils.length > 0 ? pick(rng, civils) : pick(rng, others)
          }

          try { g.submitVote(voterId, target) } catch { /* target died mid-loop */ }
        }
        // Nobody could vote: force the round on rather than spin.
        if (g.phase === 'vote' && voters.length === 0) g.tallyVotes()
        break
      }

      case 'tiebreak': {
        const { playerId, tiedIds, allowAbstain } = g.pendingTiebreak ?? {}
        if (!playerId) break
        const choice = allowAbstain && rng() < 0.15 ? null : pick(rng, tiedIds ?? [])
        try { g.resolveTiebreak(playerId, choice) } catch { g.runNextInterrupt() }
        break
      }

      case 'revenge': {
        const { playerId } = g.pendingRevenge ?? {}
        if (!playerId) break
        const targets = aliveIds().filter((id) => id !== playerId)
        try { g.submitRevenge(playerId, targets.length ? pick(rng, targets) : null) }
        catch { g.runNextInterrupt() }
        break
      }

      case 'mrwhiteGuess': {
        const id = g.pendingGuesser
        if (!id) break
        const right = rng() < config.whiteGuessRate
        g.submitGuess(id, right ? g.words.civilianWord : '???')
        break
      }

      case 'voteResult':
        // Answer any dying guess still open before the round moves on.
        answerDyingGuesses(g, config, rng)
        g.continueRound()
        break

      default:
        // reveal, or a phase with nothing to do — nudge it along.
        if (g.phase === 'reveal') for (const id of ids) g.markReady(id)
        else guard = 400
        break
    }
    answerDyingGuesses(g, config, rng)
  }

  return summarise(g, teamOf)
}

/**
 * Eliminated civilians answering their private guess.
 *
 * A correct answer needs *every* impostor named, so the odds fall away fast as
 * the table grows — which is exactly why it is worth points.
 */
function answerDyingGuesses(g, config, rng) {
  for (const player of g.players.values()) {
    const pending = player.data?.dyingGuess
    if (!pending || pending.answer) continue
    if (rng() > config.dyingAnswerRate) { pending.answer = []; continue }

    const acuity = Math.min(0.95, config.skill + config.skillGrowth * (g.round - 1))
    const answer =
      rng() < Math.pow(acuity, pending.expected.length)
        ? pending.expected
        : shuffled(rng, pending.candidates).slice(0, pending.expected.length)

    try { g.submitDyingGuess(player.id, answer) } catch { pending.answer = [] }
  }
}

function shuffled(rng, arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function summarise(g, teamOf) {
  return {
    code: g.code,
    game: g.gameNumber,
    rounds: g.round,
    outcome: g.outcome,
    finished: g.phase === 'gameOver',
    titles: (g.titles ?? []).map((t) => t.key),
    players: [...g.players.values()].map((p) => ({
      name: p.name,
      role: p.roleId,
      team: teamOf(p.id),
      modifiers: [...(p.modifiers ?? [])],
      alive: p.alive,
      points: p.roundPoints,
      // Running total after this game — the number that makes an evening.
      score: p.score,
      won: (g.scoreboard ?? []).find((r) => r.playerId === p.id)?.won ?? false,
      breakdown: (g.scoreboard ?? []).find((r) => r.playerId === p.id)?.breakdown ?? [],
      dyingGuess: p.data?.dyingGuess
        ? { answered: Boolean(p.data.dyingGuess.answer), correct: p.data.dyingGuess.correct }
        : null,
      detective: p.data?.detective ?? null,
    })),
  }
}

// ------------------------------------------------------------------ report

/**
 * How the evenings ended, which is the part players remember.
 *
 * `byRank` averages the 1st place, the 2nd, and so on across every session, so
 * a scale that produces runaway leaders shows up as a gap between the top row
 * and the rest. `gap` is that gap — first minus last — and it is the number to
 * watch: a low one means everyone stayed in it until the end.
 */
function aggregateSessions(sessions) {
  if (sessions.length === 0) return null

  const size = sessions[0].standings.length
  const byRank = Array.from({ length: size }, () => ({ total: 0, best: -Infinity, worst: Infinity }))
  const all = []
  let gap = 0
  let ties = 0

  for (const s of sessions) {
    s.standings.forEach((row, i) => {
      const slot = byRank[i]
      if (!slot) return
      slot.total += row.score
      slot.best = Math.max(slot.best, row.score)
      slot.worst = Math.min(slot.worst, row.score)
      all.push(row.score)
    })
    const top = s.standings[0]?.score ?? 0
    gap += top - (s.standings[s.standings.length - 1]?.score ?? 0)
    if (s.standings.filter((r) => r.score === top).length > 1) ties += 1
  }

  const sorted = [...all].sort((a, b) => a - b)
  return {
    sessions: sessions.length,
    byRank: byRank.map((slot, i) => ({
      rank: i + 1,
      avg: slot.total / sessions.length,
      best: slot.best,
      worst: slot.worst,
    })),
    avgGap: gap / sessions.length,
    tieRate: ties / sessions.length,
    lowest: sorted[0] ?? 0,
    highest: sorted[sorted.length - 1] ?? 0,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    negatives: all.filter((s) => s < 0).length / (all.length || 1),
  }
}

/** Aggregates a batch into the handful of numbers that judge a point scale. */
function aggregate(games) {
  const done = games.filter((g) => g.finished)
  const wins = {}
  const perRole = new Map()
  const titles = new Map()
  let rounds = 0
  let dyingAsked = 0
  let dyingRight = 0
  let ballotsRight = 0
  let ballotsWrong = 0

  for (const game of done) {
    rounds += game.rounds
    for (const team of game.outcome?.teams ?? [game.outcome?.team]) {
      if (team) wins[team] = (wins[team] ?? 0) + 1
    }
    for (const t of game.titles) titles.set(t, (titles.get(t) ?? 0) + 1)

    for (const p of game.players) {
      const key = p.role
      const row = perRole.get(key) ?? { role: key, games: 0, points: 0, wins: 0, best: -Infinity, worst: Infinity }
      row.games += 1
      row.points += p.points
      row.wins += p.won ? 1 : 0
      row.best = Math.max(row.best, p.points)
      row.worst = Math.min(row.worst, p.points)
      perRole.set(key, row)

      if (p.dyingGuess) { dyingAsked += 1; if (p.dyingGuess.correct) dyingRight += 1 }
      if (p.detective) { ballotsRight += p.detective.right; ballotsWrong += p.detective.wrong }
    }
  }

  return {
    games: done.length,
    unfinished: games.length - done.length,
    avgRounds: done.length ? rounds / done.length : 0,
    wins,
    winRate: Object.fromEntries(
      Object.entries(wins).map(([k, n]) => [k, done.length ? n / done.length : 0]),
    ),
    perRole: [...perRole.values()]
      .map((r) => ({
        ...r,
        avgPoints: r.games ? r.points / r.games : 0,
        winRate: r.games ? r.wins / r.games : 0,
      }))
      .sort((a, b) => b.avgPoints - a.avgPoints),
    titles: Object.fromEntries([...titles].sort((a, b) => b[1] - a[1])),
    dyingGuess: { asked: dyingAsked, correct: dyingRight, rate: dyingAsked ? dyingRight / dyingAsked : 0 },
    ballots: { right: ballotsRight, wrong: ballotsWrong },
  }
}

const pct = (n) => `${(n * 100).toFixed(1)}%`
const num = (n) => n.toFixed(2)

function printBatch(label, agg, config) {
  console.log(`\n—— ${label} ——`)
  console.log(`  ${agg.games} parties · ${num(agg.avgRounds)} manches en moyenne` +
    (config?.sessionLength > 1 ? ` · ${agg.evenings.sessions} soirées de ${config.sessionLength}` : '') +
    (agg.unfinished ? ` · ⚠️ ${agg.unfinished} non terminées` : ''))

  console.log('\n  Victoires par camp')
  for (const [team, rate] of Object.entries(agg.winRate).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${team.padEnd(12)} ${pct(rate).padStart(7)}  ${bar(rate)}`)
  }

  console.log('\n  Points moyens par rôle')
  console.log(`    ${'rôle'.padEnd(12)} ${'moy'.padStart(6)} ${'victoire'.padStart(9)} ${'pire'.padStart(6)} ${'meilleur'.padStart(9)}`)
  for (const r of agg.perRole) {
    console.log(
      `    ${r.role.padEnd(12)} ${num(r.avgPoints).padStart(6)} ${pct(r.winRate).padStart(9)}` +
      ` ${String(r.worst).padStart(6)} ${String(r.best).padStart(9)}`,
    )
  }

  const ev = agg.evenings
  if (ev && ev.byRank.length > 0) {
    console.log('\n  Scores finaux — moyenne par place')
    console.log(`    ${'place'.padEnd(8)} ${'moy'.padStart(7)} ${'pire'.padStart(6)} ${'meilleur'.padStart(9)}`)
    for (const r of ev.byRank) {
      console.log(`    ${(r.rank + (r.rank === 1 ? 'er' : 'e')).padEnd(8)} ${num(r.avg).padStart(7)}` +
        ` ${String(r.worst).padStart(6)} ${String(r.best).padStart(9)}`)
    }
    console.log(`\n    écart 1er/dernier ${num(ev.avgGap).padStart(6)}   ${
      ev.avgGap < 4 ? '✅ soirée serrée' : ev.avgGap < 8 ? '🟡 écart net' : '❌ soirée écrasée'
    }`)
    console.log(`    ex æquo en tête   ${pct(ev.tieRate).padStart(6)}`)
    console.log(`    score médian      ${String(ev.median).padStart(6)}   (de ${ev.lowest} à ${ev.highest})`)
    if (ev.negatives > 0) console.log(`    scores négatifs   ${pct(ev.negatives).padStart(6)}`)
  }

  if (agg.dyingGuess.asked > 0) {
    console.log(`\n  Dernier soupçon : ${agg.dyingGuess.correct}/${agg.dyingGuess.asked} justes (${pct(agg.dyingGuess.rate)})`)
  }
  if (agg.ballots.right + agg.ballots.wrong > 0) {
    const total = agg.ballots.right + agg.ballots.wrong
    console.log(`  Bulletins de civils : ${pct(agg.ballots.right / total)} justes (${agg.ballots.right} / ${agg.ballots.wrong})`)
  }
  if (Object.keys(agg.titles).length) {
    console.log('\n  Titres décernés')
    for (const [k, n] of Object.entries(agg.titles)) {
      console.log(`    ${k.padEnd(14)} ${String(n).padStart(5)}  (${pct(n / agg.games)} des parties)`)
    }
  }
}

const bar = (rate) => '█'.repeat(Math.round(rate * 30))

/**
 * The point of the whole tool: is this scale balanced?
 *
 * Balance here means every camp's *expected* haul is close. A camp that wins
 * rarely should be paid more per win, and this is the number that says by how
 * much — it is average points per game, across every player of that camp,
 * winners and losers alike.
 */
function verdict(agg, { quiet = false } = {}) {
  const byTeam = new Map()
  for (const r of agg.perRole) {
    const team = getRole(r.role)?.team ?? r.role
    const row = byTeam.get(team) ?? { team, games: 0, points: 0 }
    row.games += r.games
    row.points += r.points
    byTeam.set(team, row)
  }
  const rows = [...byTeam.values()].map((r) => ({ ...r, avg: r.games ? r.points / r.games : 0 }))
  const avgs = rows.map((r) => r.avg)
  const spread = Math.max(...avgs) - Math.min(...avgs)

  rows.sort((a, b) => b.avg - a.avg)
  const grade = spread < 0.4 ? 'good' : spread < 0.9 ? 'ok' : 'bad'

  if (!quiet) {
    console.log('\n  Équilibre — points moyens par partie et par joueur du camp')
    for (const r of rows) console.log(`    ${r.team.padEnd(12)} ${num(r.avg).padStart(6)}`)
    console.log(`    écart max    ${num(spread).padStart(6)}  ${
      { good: '✅ équilibré', ok: '🟡 acceptable', bad: '❌ déséquilibré' }[grade]
    }`)
  }
  return { rows, spread, grade }
}

// -------------------------------------------------------------------- main

const cli = parseArgs(process.argv.slice(2))
// `--config -` reads stdin, which is how the web page hands over a nested
// config without quoting JSON through a shell and losing a character to it.
const fileConfig = cli.config
  ? JSON.parse(cli.config === '-' ? await readStdin() : fs.readFileSync(cli.config, 'utf8'))
  : {}
const config = {
  ...DEFAULT_SIM,
  ...fileConfig,
  ...cli,
  settings: { ...(fileConfig.settings ?? {}), ...(cli.settings ?? {}) },
}
config.sweep = cli.sweep ?? fileConfig.sweep ?? null

if (config.players < MIN_PLAYERS || config.players > MAX_PLAYERS) {
  console.error(`\n  --players doit être entre ${MIN_PLAYERS} et ${MAX_PLAYERS}.\n`)
  process.exit(1)
}
if (config.sweep && !POINT_FIELDS.some((f) => f.key === config.sweep.key)) {
  console.error(`\n  Barème inconnu : ${config.sweep.key}\n  Clés valides : ${POINT_FIELDS.map((f) => f.key).join(', ')}\n`)
  process.exit(1)
}

const variants = config.sweep
  ? config.sweep.values.map((v) => ({
      label: `${config.sweep.key} = ${v}`,
      value: v,
      settings: {
        ...config.settings,
        points: { ...DEFAULT_POINTS, ...(config.settings.points ?? {}), [config.sweep.key]: v },
      },
    }))
  : [{ label: 'barème courant', value: null, settings: config.settings }]

// In `--json` mode stdout carries the report and nothing else, so a caller can
// parse it without stripping chatter first.
if (!config.json) {
  console.log(`\n🎲  ${config.games} parties × ${variants.length} barème(s) · ${config.players} joueurs · adresse de la table ${pct(config.skill)}`)
}

const started = Date.now()
const report = { ranAt: new Date().toISOString(), config: { ...config, settings: undefined }, variants: [] }

for (const variant of variants) {
  const rng = seedEverything(config.seed)
  // The word history decides which pairs are still fresh, and a draw from a
  // half-used bank consumes the generator differently. Wiping it puts every
  // variant back on the same footing — otherwise the second scale in a sweep
  // would play subtly different games from the first.
  if (config.seed != null) store.resetAll()

  const sessions = []
  const games = []
  const sessionCount = Math.max(1, Math.round(config.games / config.sessionLength))

  for (let i = 0; i < sessionCount; i++) {
    try {
      const session = playSession({ ...config, settings: variant.settings }, rng, i)
      sessions.push(session)
      games.push(...session.games)
    } catch (err) {
      games.push({ finished: false, error: err.message, players: [], titles: [] })
    }
  }

  const agg = aggregate(games)
  agg.evenings = aggregateSessions(sessions)
  if (!config.json) printBatch(variant.label, agg, config)
  const balance = verdict(agg, { quiet: config.json })
  report.variants.push({
    label: variant.label,
    value: variant.value,
    settings: variant.settings,
    summary: agg,
    balance,
    games,
    // Only the standings travel; the per-game detail is already in `games`.
    sessions: sessions.map((s) => s.standings),
  })
}

const best =
  variants.length > 1
    ? [...report.variants].sort((a, b) => a.balance.spread - b.balance.spread)[0]
    : null

if (best && !config.json) {
  console.log(`\n—— Comparatif : ${config.sweep.key} ——`)
  for (const v of report.variants) {
    console.log(`    ${String(v.value).padStart(4)}  écart ${num(v.balance.spread).padStart(6)}` +
      (v === best ? '   ← le plus équilibré' : ''))
  }
}

fs.mkdirSync(simDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outPath = path.resolve(config.out ?? path.join(simDir, `sim-${stamp}.json`))
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')

const elapsed = Date.now() - started

if (config.json) {
  // The per-game log is megabytes and nothing on screen reads it — it stays in
  // the file for anyone who wants to dig. Only the aggregates go over the wire.
  process.stdout.write(JSON.stringify({
    ranAt: report.ranAt,
    ms: elapsed,
    file: path.relative(root, outPath),
    sweepKey: config.sweep?.key ?? null,
    bestValue: best?.value ?? null,
    variants: report.variants.map(({ games: _drop, ...rest }) => rest),
  }))
} else {
  console.log(`\n  ⏱  ${(elapsed / 1000).toFixed(1)}s`)
  console.log(`  📄  ${path.relative(root, outPath)}  (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} Mo)\n`)
}
