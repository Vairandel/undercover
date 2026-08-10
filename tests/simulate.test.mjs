import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { check, section, report, root, SCRATCH } from './helpers.mjs'

/**
 * The simulator is a product feature now — the balance workbench runs it — so
 * its contract is worth pinning: valid JSON on stdout, coherent aggregates, and
 * above all **nothing written to the household's data**.
 */
const script = path.join(root, 'scripts', 'simulate.mjs')

function runSim(config) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--json', '--config', '-'], {
      cwd: root,
      env: { ...process.env, UNDERCOVER_DATA_DIR: path.join(SCRATCH, 'sim') },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { err += c })
    child.on('close', (code) =>
      code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err || `code ${code}`)))
    child.stdin.end(JSON.stringify({ out: path.join(SCRATCH, 'sim-out.json'), ...config }))
  })
}

section('Le simulateur produit un rapport exploitable')
{
  const r = await runSim({ games: 200, players: 6, seed: 11 })
  const v = r.variants[0]

  check('une variante', r.variants.length === 1)
  check('toutes les parties vont au bout', v.summary.unfinished === 0, `${v.summary.unfinished}`)
  check('le compte y est', v.summary.games === 200, `${v.summary.games}`)
  check('des manches sont jouées', v.summary.avgRounds > 1, v.summary.avgRounds.toFixed(2))

  const rates = Object.values(v.summary.winRate)
  check('quelqu\'un gagne toujours', rates.length > 0 && rates.every((x) => x >= 0 && x <= 1),
    JSON.stringify(v.summary.winRate))
  check('un verdict est rendu', ['good', 'ok', 'bad'].includes(v.balance.grade), v.balance.grade)
  check('chaque rôle a des parties', v.summary.perRole.every((x) => x.games > 0))
}

section('La graine rend une série rejouable')
{
  const a = await runSim({ games: 150, players: 6, seed: 99 })
  const b = await runSim({ games: 150, players: 6, seed: 99 })
  check('deux exécutions identiques',
    JSON.stringify(a.variants[0].summary.wins) === JSON.stringify(b.variants[0].summary.wins),
    JSON.stringify(a.variants[0].summary.wins))

  const c = await runSim({ games: 150, players: 6, seed: 100 })
  check('une autre graine change le résultat',
    JSON.stringify(a.variants[0].summary.wins) !== JSON.stringify(c.variants[0].summary.wins))
}

section('Le balayage compare et tranche')
{
  const r = await runSim({ games: 150, players: 6, seed: 5, sweep: { key: 'mrwhite', values: [2, 5, 8] } })
  check('trois variantes', r.variants.length === 3, `${r.variants.length}`)
  check('la clé est reportée', r.sweepKey === 'mrwhite', r.sweepKey)
  check('une valeur est désignée', [2, 5, 8].includes(r.bestValue), String(r.bestValue))

  const best = r.variants.find((v) => v.value === r.bestValue)
  check("c'est bien la moins déséquilibrée",
    r.variants.every((v) => v.balance.spread >= best.balance.spread),
    r.variants.map((v) => `${v.value}:${v.balance.spread.toFixed(2)}`).join(' '))

  // Each variant must actually have been played with its own scale.
  check('chaque variante a son barème',
    r.variants.every((v, i) => v.settings.points.mrwhite === [2, 5, 8][i]),
    r.variants.map((v) => v.settings.points.mrwhite).join(','))
}

section("Les réglages du jeu sont respectés")
{
  const r = await runSim({
    games: 200, players: 6, seed: 3,
    settings: { detectiveMode: true, blankVote: true, scoreFloor: 'none' },
  })
  const s = r.variants[0].summary
  check('des bulletins sont comptés', s.ballots.right + s.ballots.wrong > 0,
    `${s.ballots.right} / ${s.ballots.wrong}`)
  check('sans limite basse, un score plonge',
    s.perRole.some((x) => x.worst < 0), s.perRole.map((x) => x.worst).join(', '))

  const off = await runSim({ games: 100, players: 6, seed: 3, settings: { detectiveMode: false } })
  check('mode éteint, aucun bulletin scoré',
    off.variants[0].summary.ballots.right + off.variants[0].summary.ballots.wrong === 0)
}

section('Les vraies données ne sont jamais touchées')
{
  const real = path.join(root, 'server', 'data', 'state.json')
  const before = fs.existsSync(real) ? fs.readFileSync(real, 'utf8') : null

  await runSim({ games: 300, players: 6, seed: 1 })

  const after = fs.existsSync(real) ? fs.readFileSync(real, 'utf8') : null
  check("l'historique de la maison est intact", before === after,
    before === after ? 'aucun octet modifié' : 'FICHIER MODIFIÉ')

  const sandbox = path.join(SCRATCH, 'sim', 'state.json')
  check('tout est allé dans le bac à sable', fs.existsSync(sandbox),
    fs.existsSync(sandbox) ? `${JSON.parse(fs.readFileSync(sandbox, 'utf8')).gamesPlayed} manches` : 'absent')
}

process.exit(report() ? 0 : 1)
