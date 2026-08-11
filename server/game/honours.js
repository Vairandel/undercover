/**
 * The end-of-evening awards.
 *
 * Different from the per-round titles in `titles.js`, and deliberately so.
 * Those work on "the most X, or nobody" — rarity is what makes them land, and a
 * tie cancels them outright. These have the opposite job: **everyone leaves
 * with something**, and every one of them has to be earned.
 *
 * Two ideas make that work.
 *
 * **Claims are scored, not matched.** Each award reads the evening's record and
 * returns a strength for each player. The strongest claims are served first, so
 * the awards that get handed out are the ones somebody genuinely owns.
 *
 * **Meanness scales with the evidence.** Several awards carry a second, harsher
 * wording that only unlocks on an extreme number. Being teased for voting badly
 * is funny when the table can see you voted badly eight times; the same joke on
 * a mediocre statistic is just unpleasant. That threshold is the whole
 * difference, so it is data and never judgement.
 */

const pct = (n, d) => (d > 0 ? n / d : 0)
const avg = (n, d) => (d > 0 ? n / d : 0)
const emojiCount = (c, e) => c.reactionsGot?.[e] ?? 0

/**
 * `find` returns `{ score, detail, harsh? }` or nothing.
 *
 * `score` is only ever compared between players for the same award, so its
 * scale is free — what matters is that a stronger case scores higher.
 * `tone` decides the colour on screen.
 *
 * `min` is **a number of games played**, and nothing else. It exists so no
 * award can be handed out on one evening's opening round. Finer thresholds — so
 * many votes, so many reactions — belong inside each `find`, where they can be
 * read next to the figure they guard. Mixing the two units here once cost a
 * perfect voter his award because he had voted eight times across four games.
 */
export const HONOURS = [
  // ---------------------------------------------------------- performance
  {
    key: 'invaincu', emoji: '🔥', label: "L'Invaincu", tone: 'good', min: 3,
    find: (p, c) => c.games >= 3 && c.wins === c.games
      ? { score: 100 + c.games, detail: `${c.games} parties, ${c.games} victoires. Personne n'a rien pu faire.` }
      : null,
  },
  {
    key: 'remontada', emoji: '🚀', label: 'La Remontada', tone: 'good', min: 4,
    find: (p, c, ctx) => ctx.rankNow <= 2 && ctx.rankMid >= ctx.count - 2 && ctx.rankMid > ctx.rankNow + 1
      ? { score: 90, detail: `${ctx.rankMid + 1}ᵉ à mi-soirée, ${ctx.rankNow + 1}ᵉ à l'arrivée.` }
      : null,
  },
  {
    key: 'regulier', emoji: '🎯', label: 'Le Régulier', tone: 'good', min: 3,
    find: (p, c) => c.games >= 3 && c.zeroGames === 0
      ? { score: 40 + c.games, detail: `A marqué à chacune des ${c.games} parties. Jamais un blanc.` }
      : null,
  },
  {
    key: 'montagnes', emoji: '🎢', label: 'Les Montagnes russes', tone: 'neutral', min: 3,
    find: (p, c) => c.best - c.worst >= 6
      ? { score: c.best - c.worst, detail: `De ${c.worst} à ${c.best} points selon les parties. Aucune constance.` }
      : null,
  },
  {
    key: 'meuble', emoji: '🪑', label: 'Le Meuble', tone: 'bad', min: 3,
    find: (p, c) => c.games >= 3 && c.zeroGames === c.games
      ? { score: 80 + c.games, detail: `${c.games} parties. Zéro point. Présent, à défaut d'autre chose.` }
      : null,
  },
  {
    key: 'milieu', emoji: '🪞', label: 'Le Milieu de tableau', tone: 'neutral', min: 3,
    find: (p, c, ctx) => ctx.count >= 4 && ctx.rankNow > 0 && ctx.rankNow < ctx.count - 1
      ? { score: 10, detail: `${ctx.rankNow + 1}ᵉ sur ${ctx.count}. Ni gloire ni honte.` }
      : null,
  },

  // --------------------------------------------------------------- rôles
  {
    key: 'cameleon', emoji: '🦎', label: 'Le Caméléon', tone: 'good', min: 2,
    find: (p, c) => (c.roles.undercover ?? 0) >= 2 && c.votesReceived === 0
      ? { score: 95, detail: `Infiltré ${c.roles.undercover} fois. Pas un seul vote contre lui.` }
      : null,
  },
  {
    key: 'bluffeur', emoji: '🃏', label: 'Le Bluffeur', tone: 'good', min: 1,
    find: (p, c) => (c.roles.mrwhite ?? 0) > 0 && c.wins > 0
      ? { score: 70, detail: `A tenu le rôle de Mister White et s'en est sorti.` }
      : null,
  },
  {
    key: 'devin', emoji: '🎯', label: 'Le Devin', tone: 'good', min: 1,
    find: (p, c) => c.whiteGuessRight > 0
      ? { score: 88, detail: `A nommé le mot des civils. De mémoire, sans jamais l'avoir vu.` }
      : null,
  },
  {
    key: 'phare', emoji: '🔦', label: 'Le Phare', tone: 'bad', min: 2,
    harshAt: 3,
    find: (p, c) => {
      const n = Math.min(c.roles.undercover ?? 0, c.firstOut)
      return n >= 2
        ? {
            score: 60 + n * 10,
            detail: `Infiltré, grillé au premier tour ${n} fois.`,
            harsh: n >= 3 ? `${n} fois infiltré, ${n} fois sorti d'entrée. On te voit de loin.` : null,
          }
        : null
    },
  },
  {
    key: 'civilEternel', emoji: '🧑‍🌾', label: "L'Éternel civil", tone: 'neutral', min: 4,
    find: (p, c) => c.games >= 4 && !c.roles.undercover && !c.roles.mrwhite
      ? { score: 30, detail: `${c.games} parties, toujours du bon côté. Le hasard ne l'a jamais tenté.` }
      : null,
  },
  {
    key: 'polyvalent', emoji: '🎪', label: 'Le Polyvalent', tone: 'good', min: 3,
    find: (p, c) => {
      const n = Object.keys(c.roles).length + Object.keys(c.modifiers).length
      return n >= 4 ? { score: 20 + n * 5, detail: `${n} rôles différents dans la soirée.` } : null
    },
  },
  {
    key: 'stagiaire', emoji: '💼', label: 'Le Stagiaire', tone: 'bad', min: 2,
    harshAt: 3,
    find: (p, c) => c.quests >= 2 && c.questsDone === 0
      ? {
          score: 55 + c.quests * 8,
          detail: `${c.quests} missions annexes reçues, aucune remplie.`,
          harsh: c.quests >= 3
            ? `${c.quests} missions. ${c.quests} échecs. Le CV est vierge.`
            : null,
        }
      : null,
  },
  {
    key: 'couteauSuisse', emoji: '🏅', label: 'Le Couteau suisse', tone: 'good', min: 2,
    find: (p, c) => c.quests >= 2 && c.questsDone === c.quests
      ? { score: 85, detail: `${c.quests} missions annexes, ${c.quests} réussies.` }
      : null,
  },

  // ------------------------------------------------------------- déduction
  {
    key: 'limier', emoji: '🎯', label: 'Le Limier', tone: 'good', min: 3,
    find: (p, c) => {
      const named = c.votesCast - c.votesBlank
      const r = pct(c.votesRight, named)
      return named >= 5 && r >= 0.6
        ? { score: 40 + r * 60, detail: `${Math.round(r * 100)} % de ses votes visaient un imposteur.` }
        : null
    },
  },
  {
    key: 'boussole', emoji: '🧭', label: 'La Boussole cassée', tone: 'bad', min: 3,
    harshAt: 0,
    find: (p, c) => {
      const named = c.votesCast - c.votesBlank
      if (named < 5) return null
      const r = pct(c.votesRight, named)
      return r <= 0.2
        ? {
            score: 50 + (1 - r) * 40,
            detail: `${Math.round(r * 100)} % de votes justes sur ${named}.`,
            harsh: c.votesRight === 0
              ? `${named} votes. Zéro imposteur touché. Statistiquement, c'est un exploit.`
              : null,
            harshLabel: "Le Tireur d'élite", harshEmoji: '🎯',
          }
        : null
    },
  },
  {
    key: 'mouton', emoji: '🐑', label: 'Le Mouton', tone: 'bad', min: 3,
    harshAt: 1,
    find: (p, c) => {
      const named = c.votesCast - c.votesBlank
      const r = pct(c.votedWithPack, named)
      return named >= 5 && r >= 0.85
        ? {
            score: 45 + r * 30,
            detail: `A voté comme la majorité ${Math.round(r * 100)} % du temps.`,
            harsh: r === 1 ? `${named} votes, ${named} fois comme tout le monde. Aucune opinion propre.` : null,
          }
        : null
    },
  },
  {
    key: 'loupSolitaire', emoji: '🐺', label: 'Le Loup solitaire', tone: 'neutral', min: 3,
    find: (p, c) => {
      const named = c.votesCast - c.votesBlank
      const r = pct(named - c.votedWithPack, named)
      return named >= 5 && r >= 0.6
        ? { score: 25 + r * 25, detail: `A voté contre l'avis général ${Math.round(r * 100)} % du temps.` }
        : null
    },
  },
  {
    key: 'bourreau', emoji: '🗡️', label: 'Le Bourreau', tone: 'good', min: 3,
    find: (p, c) => c.executions >= 3
      ? { score: 35 + c.executions * 6, detail: `${c.executions} éliminations portaient son bulletin.` }
      : null,
  },
  {
    key: 'suisse', emoji: '🤷', label: 'Le Suisse', tone: 'bad', min: 3,
    harshAt: 1,
    find: (p, c) => {
      const r = pct(c.votesBlank, c.votesCast)
      return c.votesCast >= 4 && r >= 0.6
        ? {
            score: 40 + r * 25,
            detail: `${c.votesBlank} votes blancs sur ${c.votesCast}.`,
            harsh: r === 1 ? `Que des votes blancs. N'a offensé personne, n'a servi à rien.` : null,
          }
        : null
    },
  },
  {
    key: 'voyant', emoji: '🔮', label: 'Le Voyant', tone: 'good', min: 2,
    find: (p, c) => c.dyingAsked >= 2 && c.dyingRight === c.dyingAsked
      ? { score: 80, detail: `${c.dyingRight} derniers soupçons, tous justes. Même mort, il voyait clair.` }
      : null,
  },
  {
    key: 'brouillard', emoji: '🌫️', label: 'Le Brouillard', tone: 'bad', min: 3,
    find: (p, c) => c.dyingAsked >= 3 && c.dyingRight === 0
      ? { score: 45, detail: `${c.dyingAsked} derniers soupçons, aucun juste.` }
      : null,
  },

  // ------------------------------------------------------------ réputation
  {
    key: 'paratonnerre', emoji: '🪤', label: 'Le Paratonnerre', tone: 'sympathy', min: 3,
    find: (p, c) => c.votesReceivedInnocent >= 5
      ? { score: 30 + c.votesReceivedInnocent * 4, detail: `${c.votesReceivedInnocent} votes contre lui. Innocent à chaque fois. Vous devriez avoir honte.` }
      : null,
  },
  {
    key: 'intouchable', emoji: '🛡️', label: "L'Intouchable", tone: 'good', min: 3,
    find: (p, c) => c.games >= 3 && c.votesReceived <= 1
      ? { score: 50, detail: `${c.votesReceived} vote reçu de toute la soirée. Invisible.` }
      : null,
  },
  {
    key: 'appat', emoji: '🎣', label: "L'Appât", tone: 'bad', min: 3,
    find: (p, c) => c.accusedFirstRound >= 4
      ? { score: 35 + c.accusedFirstRound * 3, detail: `Accusé dès la première manche, ${c.accusedFirstRound} fois.` }
      : null,
  },

  // ---------------------------------------------------------------- survie
  {
    key: 'survivant', emoji: '🍀', label: 'Le Survivant', tone: 'good', min: 3,
    find: (p, c) => {
      const r = pct(c.survived, c.games)
      return c.games >= 3 && r >= 0.6
        ? { score: 30 + r * 40, detail: `Encore debout à la fin de ${c.survived} parties sur ${c.games}.` }
        : null
    },
  },
  {
    key: 'consommable', emoji: '⚰️', label: 'Le Consommable', tone: 'bad', min: 3,
    harshAt: 4,
    find: (p, c) => c.firstOut >= 3
      ? {
          score: 55 + c.firstOut * 8,
          detail: `Premier éliminé ${c.firstOut} fois.`,
          harsh: c.firstOut >= 4 ? `${c.firstOut} fois le premier à sortir. Vous ne cherchez même plus.` : null,
        }
      : null,
  },
  {
    key: 'marathonien', emoji: '🏃', label: 'Le Marathonien', tone: 'good', min: 3,
    find: (p, c) => avg(c.lifespan, c.games) >= 2.5
      ? { score: 20 + avg(c.lifespan, c.games) * 8, detail: `${avg(c.lifespan, c.games).toFixed(1)} manches vécues en moyenne.` }
      : null,
  },
  {
    key: 'figuration', emoji: '🎬', label: 'La Figuration', tone: 'bad', min: 3,
    find: (p, c) => c.games >= 3 && avg(c.lifespan, c.games) <= 1.4
      ? { score: 40, detail: `${avg(c.lifespan, c.games).toFixed(1)} manches de moyenne. Le temps de dire bonjour.` }
      : null,
  },

  // ---------------------------------------------------------------- parole
  {
    key: 'mutique', emoji: '🤐', label: 'Le Mutique', tone: 'bad', min: 2,
    harshAt: 5,
    find: (p, c) => c.cluesTimedOut >= 2
      ? {
          score: 45 + c.cluesTimedOut * 7,
          detail: `${c.cluesTimedOut} fois à court de mots.`,
          harsh: c.cluesTimedOut >= 5
            ? `${c.cluesTimedOut} fois le chrono, zéro mot. On a cru à une performance artistique.`
            : null,
          harshLabel: 'Le Mime', harshEmoji: '🗿',
        }
      : null,
  },
  {
    key: 'porteParole', emoji: '📢', label: 'Le Porte-parole', tone: 'neutral', min: 2,
    find: (p, c) => c.chatLines >= 12
      ? { score: 15 + c.chatLines, detail: `${c.chatLines} messages dans les débats.` }
      : null,
  },
  {
    key: 'taiseux', emoji: '🤫', label: 'Le Taiseux', tone: 'neutral', min: 3,
    find: (p, c) => c.games >= 3 && c.chatLines === 0
      ? { score: 25, detail: `Pas un message de toute la soirée. Tout dans le regard.` }
      : null,
  },
  {
    key: 'ouvreur', emoji: '🎤', label: "L'Ouvreur", tone: 'neutral', min: 3,
    find: (p, c) => c.spokeFirst >= 3
      ? { score: 18 + c.spokeFirst * 4, detail: `${c.spokeFirst} fois le premier à devoir se lancer.` }
      : null,
  },

  // ------------------------------------------------------------- réactions
  {
    key: 'star', emoji: '⭐', label: 'La Star', tone: 'good', min: 2,
    find: (p, c) => emojiCount(c, '⭐') >= 3
      ? { score: 30 + emojiCount(c, '⭐') * 5, detail: `${emojiCount(c, '⭐')} étoiles sur ses indices.` }
      : null,
  },
  {
    key: 'comique', emoji: '😂', label: 'Le Comique', tone: 'good', min: 2,
    find: (p, c) => emojiCount(c, '😂') >= 3
      ? { score: 30 + emojiCount(c, '😂') * 5, detail: `${emojiCount(c, '😂')} fous rires provoqués.` }
      : null,
  },
  {
    key: 'credible', emoji: '👍', label: 'Le Crédible', tone: 'good', min: 2,
    find: (p, c) => emojiCount(c, '👍') >= 4
      ? { score: 25 + emojiCount(c, '👍') * 4, detail: `${emojiCount(c, '👍')} indices jugés convaincants.` }
      : null,
  },
  {
    key: 'louche', emoji: '🤨', label: 'Le Plus louche', tone: 'bad', min: 2,
    find: (p, c) => emojiCount(c, '🤨') >= 4
      ? { score: 30 + emojiCount(c, '🤨') * 4, detail: `${emojiCount(c, '🤨')} sourcils levés sur ses indices.` }
      : null,
  },
  {
    key: 'titanic', emoji: '🚢', label: 'Le Titanic', tone: 'bad', min: 2,
    harshAt: 6,
    find: (p, c) => emojiCount(c, '💀') >= 3
      ? {
          score: 35 + emojiCount(c, '💀') * 5,
          detail: `${emojiCount(c, '💀')} indices jugés catastrophiques.`,
          harsh: emojiCount(c, '💀') >= 6
            ? `${emojiCount(c, '💀')} fois le 💀. À ce stade ce n'est plus de la malchance.`
            : null,
        }
      : null,
  },
  {
    key: 'bonPublic', emoji: '🫶', label: 'Le Bon public', tone: 'neutral', min: 2,
    find: (p, c) => c.reactionsGiven >= 10
      ? { score: 20 + c.reactionsGiven, detail: `${c.reactionsGiven} réactions distribuées. Toujours partant.` }
      : null,
  },
  {
    key: 'marbre', emoji: '🗿', label: 'Le Marbre', tone: 'bad', min: 3,
    find: (p, c, ctx) => c.games >= 3 && c.reactionsGiven === 0 && ctx.reactionsOn
      ? { score: 30, detail: `Pas une seule réaction de la soirée. Impassible.` }
      : null,
  },

  // --------------------------------------------------------- la tête en l'air
  {
    key: 'teteEnLair', emoji: '🌤️', label: "La Tête en l'air", tone: 'bad', min: 3,
    harshAt: 4,
    find: (p, c) => c.readyLast >= 2
      ? {
          score: 40 + c.readyLast * 9,
          detail: `Dernier à découvrir sa carte ${c.readyLast} fois. On t'attend.`,
          harsh: c.readyLast >= 4
            ? `${c.readyLast} fois le dernier à toucher sa carte. On a fini par prendre l'habitude.`
            : null,
          harshLabel: "L'Endormi", harshEmoji: '😴',
        }
      : null,
  },
  {
    key: 'gachette', emoji: '⚡', label: 'La Gâchette', tone: 'good', min: 3,
    find: (p, c) => c.readyFirst >= 3
      ? { score: 25 + c.readyFirst * 6, detail: `Premier à retourner sa carte ${c.readyFirst} fois.` }
      : null,
  },

  // ------------------------------------------------------------------ repli
  //
  // Toujours vrais, jamais flatteurs pour rien : ils servent à ce que personne
  // ne reparte les mains vides, sans jamais inventer un mérite.
  {
    key: 'pilier', emoji: '🧩', label: 'Le Pilier', tone: 'neutral', min: 1, fallback: true,
    find: (p, c, ctx) => c.joinedAtGame === 0 && c.games === ctx.totalGames
      ? { score: 8, detail: `Là depuis la première partie, et jusqu'à la dernière.` }
      : null,
  },
  {
    key: 'nouveau', emoji: '🆕', label: 'Le Petit nouveau', tone: 'neutral', min: 1, fallback: true,
    find: (p, c) => c.joinedAtGame > 0
      ? { score: 7, detail: `Arrivé en cours de soirée, à la partie ${c.joinedAtGame + 1}.` }
      : null,
  },
  {
    key: 'passage', emoji: '🎈', label: 'De passage', tone: 'neutral', min: 1, fallback: true,
    find: (p, c, ctx) => ctx.totalGames >= 3 && c.games <= ctx.totalGames / 2
      ? { score: 6, detail: `${c.games} parties sur ${ctx.totalGames}. Un passage éclair.` }
      : null,
  },
  {
    key: 'fidele', emoji: '🎲', label: 'Le Fidèle', tone: 'neutral', min: 1, fallback: true,
    find: (p, c, ctx) => c.games === ctx.totalGames && ctx.totalGames >= 2
      ? { score: 5, detail: `N'a manqué aucune des ${ctx.totalGames} parties.` }
      : null,
  },
  {
    key: 'present', emoji: '👋', label: 'Le Présent', tone: 'neutral', min: 1, fallback: true,
    // Le dernier recours : vrai pour quiconque a joué, et le seul qui ne
    // puisse jamais échouer. Sans lui, la promesse « un titre pour chacun »
    // tomberait sur une table où personne ne se distingue.
    find: (p, c) => (c.games > 0 ? { score: 1, detail: `${c.games} parties jouées ce soir.` } : null),
  },
]

/** How many awards a table of this size should see. */
export function honourBudget(players) {
  return Math.min(12, players + 3)
}

/**
 * Hands out the evening's awards.
 *
 * The assignment problem, solved the blunt way: collect every claim anyone can
 * make, serve the strongest first, one award per player and one player per
 * award. Then, if there is room left, add the best remaining claims as extras —
 * those are the "and by the way" moments worth showing even though their owner
 * already has something.
 *
 * A player who claims nothing still gets an award: the fallbacks at the end of
 * `HONOURS` are true of anyone who sat down, so "at least one each" holds
 * without ever inventing a merit.
 */
export function awardHonours({ players, totalGames, reactionsOn = true }) {
  const seated = players.filter((p) => p.career?.games > 0)
  if (seated.length === 0) return []

  const ranked = [...seated].sort((a, b) => b.score - a.score)
  const rankOf = new Map(ranked.map((p, i) => [p.id, i]))

  // Claims, strongest first.
  const claims = []
  for (const player of seated) {
    const career = player.career
    const ctx = {
      totalGames,
      reactionsOn,
      count: seated.length,
      rankNow: rankOf.get(player.id),
      // Where they stood halfway through, from the trail left after each game.
      rankMid: career.ranks?.length
        ? career.ranks[Math.floor((career.ranks.length - 1) / 2)]
        : rankOf.get(player.id),
    }

    for (const honour of HONOURS) {
      if (career.games < (honour.min ?? 1)) continue
      const hit = honour.find(player, career, ctx)
      if (!hit) continue

      // The harsh wording only unlocks on the extreme figure the award itself
      // defines — never on a judgement call made here.
      const harsh = Boolean(hit.harsh)
      claims.push({
        key: honour.key,
        emoji: (harsh && hit.harshEmoji) || honour.emoji,
        label: (harsh && hit.harshLabel) || honour.label,
        tone: honour.tone,
        fallback: Boolean(honour.fallback),
        playerId: player.id,
        name: player.name,
        avatar: player.avatar,
        color: player.color,
        left: Boolean(player.left),
        detail: hit.harsh || hit.detail,
        score: hit.score,
      })
    }
  }

  claims.sort((a, b) => b.score - a.score)

  const budget = honourBudget(seated.length)
  const takenAward = new Set()
  const servedPlayer = new Set()
  const out = []

  // Pass one: the strongest claim each player owns, nobody twice.
  for (const claim of claims) {
    if (servedPlayer.has(claim.playerId) || takenAward.has(claim.key)) continue
    out.push(claim)
    servedPlayer.add(claim.playerId)
    takenAward.add(claim.key)
  }

  // Pass two: fill the remaining room with the best claims left over. Fallbacks
  // are excluded — "played tonight" is worth saying once about someone who has
  // nothing else, never as a highlight.
  for (const claim of claims) {
    if (out.length >= budget) break
    if (takenAward.has(claim.key) || claim.fallback) continue
    out.push(claim)
    takenAward.add(claim.key)
  }

  // Best first, but never opening on a jab: a screen that starts by mocking
  // someone sets the wrong tone for what is meant to be a celebration.
  const rank = { good: 0, sympathy: 1, neutral: 2, bad: 3 }
  return out
    .sort((a, b) => rank[a.tone] - rank[b.tone] || b.score - a.score)
    .slice(0, budget)
}
