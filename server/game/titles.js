/**
 * Comic awards handed out on the final screen.
 *
 * The points already reward winning. These reward *how* you played, and they
 * are what the table actually retells the next day — so the bar is relevance,
 * not coverage. Two rules keep them meaningful:
 *
 *  - **Every title has a floor.** "Voted wrong every time" says nothing after a
 *    single round. Each candidate declares how much evidence it needs, and
 *    stays silent below it. A title nobody earned is better than one everybody
 *    could have.
 *  - **Ties are dropped, not broken.** "The most X" is only funny when one
 *    person clearly was. Where a winner must stand out, an equal second place
 *    cancels the award outright.
 *
 * One player can hold only one title, and only the four rarest are shown: a
 * screen where everyone gets a medal is a participation trophy.
 */

const MAX_TITLES = 4

/**
 * Strict argmax: the single highest scorer, or null if anyone matches them.
 * `floor` is the minimum score worth talking about.
 */
function loneLeader(entries, floor = 1) {
  let best = null
  let tied = false
  for (const [id, score] of entries) {
    if (score < floor) continue
    if (!best || score > best[1]) {
      best = [id, score]
      tied = false
    } else if (score === best[1]) {
      tied = true
    }
  }
  return best && !tied ? best : null
}

/**
 * Every award, rarest first — the order is the tie-break when one player
 * qualifies for several, so they keep the one that says the most about them.
 */
const CANDIDATES = [
  {
    key: 'cameleon',
    emoji: '🦎',
    label: 'Le caméléon',
    /** An impostor who went the whole game without drawing a single vote. */
    find: ({ players, votesAgainst, roundsVoted, teamOf }) => {
      if (roundsVoted < 2) return null
      const clean = players.filter(
        (p) => teamOf(p) !== 'civilian' && (votesAgainst.get(p.id) ?? 0) === 0,
      )
      return clean.length === 1
        ? { playerId: clean[0].id, detail: 'Pas un seul vote contre lui de toute la partie.' }
        : null
    },
  },
  {
    key: 'limier',
    emoji: '🎯',
    label: 'Le limier',
    /** Voted against an impostor every single time they voted. */
    find: ({ players, voteLog, teamOf }) => {
      const perfect = players.filter((p) => {
        const casts = voteLog.get(p.id) ?? []
        return casts.length >= 2 && casts.every((t) => teamOf(t) !== 'civilian')
      })
      return perfect.length === 1
        ? { playerId: perfect[0].id, detail: "N'a jamais accusé un innocent." }
        : null
    },
  },
  {
    key: 'boussole',
    emoji: '🧭',
    label: 'La boussole cassée',
    /** The exact opposite, and only when there was something to find. */
    find: ({ players, voteLog, teamOf, hadImpostors }) => {
      if (!hadImpostors) return null
      const lost = players.filter((p) => {
        const casts = voteLog.get(p.id) ?? []
        return casts.length >= 2 && casts.every((t) => teamOf(t) === 'civilian')
      })
      return lost.length === 1
        ? { playerId: lost[0].id, detail: "N'a accusé que des innocents, du début à la fin." }
        : null
    },
  },
  {
    key: 'paratonnerre',
    emoji: '🪤',
    label: 'Le paratonnerre',
    /** The civilian the table kept suspecting for nothing. */
    find: ({ players, votesAgainst, teamOf }) => {
      const civils = players.filter((p) => teamOf(p) === 'civilian')
      const lead = loneLeader(civils.map((p) => [p.id, votesAgainst.get(p.id) ?? 0]), 3)
      return lead
        ? { playerId: lead[0], detail: `${lead[1]} votes contre lui. Il était innocent.` }
        : null
    },
  },
  {
    key: 'mouton',
    emoji: '🐑',
    label: 'Le mouton',
    /** Never once broke from the majority. */
    find: ({ players, voteLog, majorityTarget }) => {
      const followers = players.filter((p) => {
        const casts = voteLog.get(p.id) ?? []
        if (casts.length < 3) return false
        return casts.every((t, i) => t === majorityTarget[i])
      })
      return followers.length === 1
        ? { playerId: followers[0].id, detail: "A voté comme tout le monde, à chaque fois." }
        : null
    },
  },
  {
    key: 'star',
    emoji: '⭐',
    label: 'La star',
    find: ({ reactionsGot }) => {
      const lead = loneLeader([...reactionsGot].map(([id, t]) => [id, t['⭐'] ?? 0]), 3)
      return lead ? { playerId: lead[0], detail: `${lead[1]} étoiles sur ses indices.` } : null
    },
  },
  {
    key: 'clown',
    emoji: '🎪',
    label: 'Le clown',
    find: ({ reactionsGot }) => {
      const lead = loneLeader([...reactionsGot].map(([id, t]) => [id, t['😂'] ?? 0]), 3)
      return lead ? { playerId: lead[0], detail: `${lead[1]} fous rires provoqués.` } : null
    },
  },
  {
    key: 'louche',
    emoji: '🤨',
    label: 'Le plus louche',
    find: ({ reactionsGot }) => {
      const lead = loneLeader([...reactionsGot].map(([id, t]) => [id, t['🤨'] ?? 0]), 3)
      return lead ? { playerId: lead[0], detail: `${lead[1]} sourcils levés sur ses indices.` } : null
    },
  },
  {
    key: 'bourreau',
    emoji: '🗡️',
    label: 'Le bourreau',
    /** Their name was on the ballot of whoever actually went down. */
    find: ({ players, voteLog, eliminatedByVote }) => {
      const scores = players.map((p) => {
        const casts = voteLog.get(p.id) ?? []
        return [p.id, casts.filter((t, i) => t && t === eliminatedByVote[i]).length]
      })
      const lead = loneLeader(scores, 3)
      return lead ? { playerId: lead[0], detail: `${lead[1]} éliminations sur son bulletin.` } : null
    },
  },
  {
    key: 'mutique',
    emoji: '🤐',
    label: 'Le mutique',
    /** Let the clock run out rather than commit to anything. */
    find: ({ players, blanks }) => {
      const lead = loneLeader(players.map((p) => [p.id, blanks.get(p.id) ?? 0]), 2)
      return lead ? { playerId: lead[0], detail: `${lead[1]} fois à court de mots.` } : null
    },
  },
  {
    key: 'porteparole',
    emoji: '🗣️',
    label: 'Le porte-parole',
    find: ({ players, chatCount }) => {
      const lead = loneLeader(players.map((p) => [p.id, chatCount.get(p.id) ?? 0]), 5)
      return lead ? { playerId: lead[0], detail: `${lead[1]} messages dans le débat.` } : null
    },
  },
  {
    key: 'premier',
    emoji: '💀',
    label: 'Le premier tombé',
    /** Only worth saying when the game went on without them for a while. */
    find: ({ players, rounds }) => {
      if (rounds.length < 3) return null
      const first = players.filter((p) => p.data?.eliminatedOrder === 1)
      return first.length === 1
        ? { playerId: first[0].id, detail: 'Sorti dès la première manche. La partie a duré sans lui.' }
        : null
    },
  },
]

/**
 * Builds the tallies once, then lets each candidate read what it needs.
 *
 * `rounds` are the finished rounds in order, each with its `votes` map
 * (voter → target) and its `clues`.
 */
export function awardTitles({ players, rounds, teamOfId, reactionTotals, chatTotals, blankClue }) {
  const votesAgainst = new Map() // id -> how many ballots named them
  const voteLog = new Map() // id -> the target they picked, round by round
  const blanks = new Map() // id -> clues they let time out
  const majorityTarget = [] // per round, who the pack went for
  const eliminatedByVote = [] // per round, who actually went down

  let roundsVoted = 0

  for (const round of rounds) {
    const votes = round?.votes ?? {}
    const cast = Object.entries(votes)
    if (cast.length > 0) roundsVoted += 1

    for (const [voter, target] of cast) {
      votesAgainst.set(target, (votesAgainst.get(target) ?? 0) + 1)
      voteLog.set(voter, [...(voteLog.get(voter) ?? []), target])
    }

    const tally = round?.tally ?? {}
    const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1])
    majorityTarget.push(ranked[0]?.[0] ?? null)
    eliminatedByVote.push(round?.eliminated?.cause === 'vote' ? round.eliminated.id : null)

    for (const [id, text] of Object.entries(round?.clues ?? {})) {
      if (text === blankClue) blanks.set(id, (blanks.get(id) ?? 0) + 1)
    }
  }

  const teamOf = (p) => teamOfId(typeof p === 'string' ? p : p.id)
  const ctx = {
    players,
    rounds,
    votesAgainst,
    voteLog,
    blanks,
    chatCount: chatTotals,
    majorityTarget,
    eliminatedByVote,
    roundsVoted,
    reactionsGot: reactionTotals,
    teamOf,
    hadImpostors: players.some((p) => teamOf(p) !== 'civilian'),
  }

  const taken = new Set()
  const out = []
  for (const candidate of CANDIDATES) {
    if (out.length >= MAX_TITLES) break
    const hit = candidate.find(ctx)
    if (!hit || taken.has(hit.playerId)) continue
    const player = players.find((p) => p.id === hit.playerId)
    if (!player) continue

    taken.add(hit.playerId)
    out.push({
      key: candidate.key,
      emoji: candidate.emoji,
      label: candidate.label,
      detail: hit.detail,
      playerId: player.id,
      name: player.name,
      avatar: player.avatar,
      color: player.color,
    })
  }
  return out
}
