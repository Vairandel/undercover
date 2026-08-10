import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { play } from './audio.js'

export const phaseMotion = {
  initial: { opacity: 0, y: 18, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -18, scale: 0.985 },
  transition: { duration: 0.36, ease: [0.22, 1, 0.36, 1] },
}

export function Toast({ message, onDone }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDone, 3600)
    return () => clearTimeout(t)
  }, [message, onDone])

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="toast"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Collapses `[{ by, emoji }]` into one badge per emoji, with the names behind.
 *
 * The count is the point: `🤨 3` reads the table's temperature at a glance in a
 * way three separate marks never would.
 */
function groupReactions(list, players, mine) {
  if (!list?.length) return []
  const byEmoji = new Map()
  for (const { by, emoji } of list) {
    const entry = byEmoji.get(emoji) ?? { emoji, count: 0, who: [], byMe: false }
    entry.count += 1
    entry.who.push(players?.find((p) => p.id === by)?.name ?? '?')
    if (by === mine) entry.byMe = true
    byEmoji.set(emoji, entry)
  }
  return [...byEmoji.values()].sort((a, b) => b.count - a.count)
}

/**
 * The badges under a clue, plus the ＋ that opens the palette.
 *
 * Shared by the big screen (read-only, `onReact` omitted) and the phones, so
 * the same marks are read the same way on both — which is the whole point of
 * putting them on the clue rather than in the chat.
 */
/**
 * The comic awards on the final screen.
 *
 * Points say who won. These say how the evening actually went, and they are
 * what gets retold afterwards — so they are staged as a reveal, one after the
 * other, rather than dumped as a list.
 */
export function Titles({ titles }) {
  if (!titles?.length) return null

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="eyebrow center">Palmarès de la manche</p>
      {titles.map((t, i) => (
        <motion.div
          className="title-card"
          key={t.key}
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.25 + i * 0.35, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          onAnimationStart={() => play('scoreRow')}
        >
          <span className="title-card__emoji">{t.emoji}</span>
          <div className="grow">
            <div className="title-card__label">{t.label}</div>
            <div className="title-card__who" style={{ color: t.color }}>
              {t.avatar} {t.name}
            </div>
            <div className="title-card__detail">{t.detail}</div>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

/** What the dead worked out, revealed only now that it cannot help anyone. */
export function DyingGuesses({ guesses, players }) {
  if (!guesses?.length) return null
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '?'

  return (
    <div className="stack" style={{ gap: 6 }}>
      <p className="eyebrow center">🔮 Derniers soupçons</p>
      {guesses.map((g) => (
        <div className="clue" key={g.playerId}>
          <span style={{ fontSize: '1.2rem' }}>{g.avatar}</span>
          <div className="grow">
            <div className="clue__text" style={{ fontSize: '0.9rem' }}>
              {g.correct ? '✅ ' : '❌ '}
              {g.answer.map(nameOf).join(', ')}
            </div>
            <div className="clue__author">
              {g.name}, éliminé manche {g.round}
              {!g.correct && ` · c'était ${g.expected.map(nameOf).join(', ')}`}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function ReactionBar({ reactions, players, mine, palette, onReact }) {
  const [picking, setPicking] = useState(false)
  const grouped = groupReactions(reactions, players, mine)

  useEffect(() => {
    if (!picking) return undefined
    const close = () => setPicking(false)
    // Any tap elsewhere closes it, including the one that picked an emoji.
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [picking])

  if (grouped.length === 0 && !onReact) return null

  return (
    <span className="reacts">
      {grouped.map((r) => (
        <button
          type="button"
          className={r.byMe ? 'reacts__tag reacts__tag--mine' : 'reacts__tag'}
          key={r.emoji}
          /* Signed, never anonymous — you can be asked about your 🤨. */
          title={r.who.join(', ')}
          disabled={!onReact}
          onPointerDown={(e) => { e.stopPropagation(); onReact?.(r.emoji) }}
        >
          {r.emoji}
          {r.count > 1 && <b>{r.count}</b>}
        </button>
      ))}

      {onReact && (
        <span className="reactpick">
          <button
            type="button"
            className="reactpick__open"
            onPointerDown={(e) => { e.stopPropagation(); play('tap'); setPicking((v) => !v) }}
            aria-label="Réagir"
          >
            ＋
          </button>
          <AnimatePresence>
            {picking && (
              <motion.span
                className="reactpick__menu"
                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.9 }}
                transition={{ duration: 0.16 }}
              >
                {(palette ?? []).map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    onPointerDown={(e) => { e.stopPropagation(); onReact(emoji); setPicking(false) }}
                  >
                    {emoji}
                  </button>
                ))}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      )}
    </span>
  )
}

export function PlayerChip({
  player,
  selectable,
  selected,
  onSelect,
  showClue,
  votes,
  speaking,
  highlighted,
  voteState,
  reactions,
  palette,
  onReact,
  mine,
  players,
}) {
  // Reactions land on a clue, not in the chat: the chat only exists during the
  // debate, while the dead moment worth filling is the description round.
  // Sticking them under the clue also means they are still there at vote time.
  const canReact = Boolean(onReact) && player.id !== mine && Boolean(player.clue)

  const classes = [
    'player',
    !player.alive && 'player--dead',
    speaking && 'player--speaking',
    highlighted && 'player--tied',
    // During the vote, the host screen greys out everyone who has not answered
    // yet and lights up each ballot as it lands — readable across a room.
    voteState === 'voted' && 'player--voted',
    voteState === 'waiting' && 'player--waiting',
    player.ready && 'player--ready',
    (!player.connected || player.left) && 'player--offline',
    selectable && 'player--selectable',
    selected && 'player--selected',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <motion.div
      layout
      className={classes}
      style={{ '--chip': player.color ?? 'var(--accent)' }}
      onClick={selectable ? () => { play('select'); onSelect?.(player.id) } : undefined}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {player.isHost && <span className="player__host" title="Tient la télécommande">👑</span>}
      <span className="player__avatar">{player.avatar}</span>
      <span className="player__name">{player.name}</span>

      {player.role && (
        <span className="player__meta" style={{ color: player.role.color }}>
          {player.role.emoji} {player.role.label}
        </span>
      )}

      {player.modifiers?.map((m) => (
        <span className="player__meta" key={m.id} style={{ color: m.color }}>
          {m.emoji} {m.label}
        </span>
      ))}

      {player.roundPoints > 0 && (
        <span className="badge" style={{ marginTop: 4, color: 'var(--ok)' }}>
          +{player.roundPoints}
        </span>
      )}

      {showClue && player.clue ? (
        <span
          className="player__meta"
          style={{
            color: player.clueTimedOut ? 'var(--text-faint)' : 'var(--text-dim)',
            fontStyle: player.clueTimedOut ? 'italic' : 'normal',
          }}
        >
          {player.clueTimedOut ? '…' : `« ${player.clue} »`}
        </span>
      ) : null}

      <ReactionBar
        reactions={reactions}
        players={players}
        mine={mine}
        palette={palette}
        onReact={canReact ? (emoji) => onReact(player.id, emoji) : null}
      />

      {votes > 0 && <span className="badge" style={{ marginTop: 4 }}>{votes} vote{votes > 1 ? 's' : ''}</span>}
      {voteState === 'voted' && <span className="player__meta" style={{ color: player.color }}>a voté</span>}
      {player.wantsSkip && <span className="player__meta" style={{ color: 'var(--ok)' }}>prêt à voter</span>}
      {player.left && <span className="player__meta">a quitté</span>}
      {!player.connected && !player.left && player.alive && <span className="player__meta">déconnecté</span>}
      {player.ready && <span className="player__meta" style={{ color: 'var(--ok)' }}>✓ prêt</span>}
      {player.ready === false && (
        <span className="player__meta" style={{ color: 'var(--text-faint)' }}>lit sa carte…</span>
      )}
    </motion.div>
  )
}

/** Countdown bar driven by an absolute server deadline, so it survives lag. */
export function TurnTimer({ deadline, total }) {
  const [left, setLeft] = useState(() => Math.max(0, (deadline ?? 0) - Date.now()))
  const tickedAt = useRef(null)

  useEffect(() => {
    if (!deadline) return undefined
    const id = setInterval(() => {
      const ms = Math.max(0, deadline - Date.now())
      setLeft(ms)
      const secs = Math.ceil(ms / 1000)
      if (secs <= 5 && secs > 0 && tickedAt.current !== secs) {
        tickedAt.current = secs
        play(secs <= 3 ? 'tickUrgent' : 'tick')
      }
    }, 100)
    return () => clearInterval(id)
  }, [deadline])

  if (!deadline || !total) return null

  const ratio = Math.max(0, Math.min(1, left / (total * 1000)))
  const urgent = left < 5000

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="timer">
        <div
          className={`timer__bar${urgent ? ' timer__bar--urgent' : ''}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div className="center mono faint" style={{ fontSize: '0.78rem' }}>
        {Math.ceil(left / 1000)} s
      </div>
    </div>
  )
}

/**
 * Big countdown for a whole phase (the discussion clock), driven by an absolute
 * server deadline so it stays honest across lag and reconnects.
 */
export function PhaseTimer({ deadline, total, large }) {
  const [left, setLeft] = useState(() => Math.max(0, (deadline ?? 0) - Date.now()))
  const tickedAt = useRef(null)

  useEffect(() => {
    if (!deadline) return undefined
    const id = setInterval(() => {
      const ms = Math.max(0, deadline - Date.now())
      setLeft(ms)
      const secs = Math.ceil(ms / 1000)
      if (secs <= 10 && secs > 0 && tickedAt.current !== secs) {
        tickedAt.current = secs
        play(secs <= 3 ? 'tickUrgent' : 'tick')
      }
    }, 120)
    return () => clearInterval(id)
  }, [deadline])

  if (!deadline || !total) return null

  const secs = Math.ceil(left / 1000)
  const ratio = Math.max(0, Math.min(1, left / (total * 1000)))
  const urgent = left < 10000

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div
        className="mono center"
        style={{
          fontSize: large ? 'clamp(3rem, 12vmin, 7rem)' : '2rem',
          fontWeight: 850,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          color: urgent ? 'var(--undercover)' : 'var(--text)',
          transition: 'color 0.3s',
        }}
      >
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      </div>
      <div className="timer">
        <div
          className={`timer__bar${urgent ? ' timer__bar--urgent' : ''}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}

/**
 * End-of-game standings.
 *
 * Rows land one by one, and each player's total counts up from what they had
 * before this game to what they have now — so everyone can actually see who
 * gained what, rather than being shown a finished table.
 */
export function ScoreBoard({ rows, compact }) {
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!rows?.length) return undefined
    setShown(0)
    let i = 0
    const id = setInterval(() => {
      i += 1
      setShown(i)
      // The Bouffon's row gets its own silly little fanfare — his whole game
      // was that one bet, and the scoreboard is where it finally pays.
      const paidOff = rows[i - 1]?.breakdown?.some((b) => b.key === 'bouffon')
      play(paidOff ? 'bouffonPaid' : i === 1 ? 'scoreTop' : 'scoreRow')
      if (i >= rows.length) clearInterval(id)
    }, 420)
    return () => clearInterval(id)
  }, [rows])

  if (!rows?.length) return null

  return (
    <div className="scoreboard">
      {rows.map((row, i) => (
        <motion.div
          key={row.playerId}
          className={`scorerow${i === 0 ? ' scorerow--leader' : ''}`}
          style={{ '--chip': row.color }}
          initial={{ opacity: 0, x: -28 }}
          animate={i < shown ? { opacity: 1, x: 0 } : { opacity: 0, x: -28 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="scorerow__rank mono">{i + 1}</span>
          <span className="scorerow__avatar">{row.avatar}</span>

          <div className="grow" style={{ minWidth: 0 }}>
            <div className="scorerow__name">{row.name}</div>
            <div className="scorerow__detail">
              {row.breakdown.length
                ? row.breakdown.map((b) => `${b.label} +${b.points}`).join(' · ')
                : 'aucun point'}
            </div>
          </div>

          {row.points > 0 && (
            <motion.span
              className="scorerow__gain"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={i < shown ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
              transition={{ delay: 0.18, type: 'spring', stiffness: 400, damping: 16 }}
            >
              +{row.points}
            </motion.span>
          )}

          <span className="scorerow__total mono">
            <CountUp from={row.before} to={row.after} run={i < shown} />
          </span>
        </motion.div>
      ))}
      {!compact && (
        <p className="faint center" style={{ fontSize: '0.76rem', marginTop: 6 }}>
          Les points se cumulent tant que la salle reste ouverte.
        </p>
      )}
    </div>
  )
}

function CountUp({ from, to, run, ms = 700 }) {
  const [value, setValue] = useState(from)

  useEffect(() => {
    if (!run) { setValue(from); return undefined }
    if (from === to) { setValue(to); return undefined }
    const start = performance.now()
    let raf = 0
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms)
      // Ease-out so the number decelerates into its final value.
      setValue(Math.round(from + (to - from) * (1 - (1 - t) ** 3)))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [from, to, run, ms])

  return <>{value}</>
}

/**
 * Live headcount per camp, shown during a round.
 *
 * Safe to display: everyone saw the starting composition in the lobby, and each
 * elimination reveals the victim's role — so these numbers are already
 * deducible with a pen. Showing them removes the bookkeeping without giving
 * away who is who.
 */
const TRACKER_ORDER = ['civilian', 'undercover', 'mrwhite', 'lovers']
const TRACKER_LABEL = {
  civilian: { emoji: '🧑', one: 'civil', many: 'civils', color: 'var(--civilian)' },
  undercover: { emoji: '🕵️', one: 'infiltré', many: 'infiltrés', color: 'var(--undercover)' },
  mrwhite: { emoji: '🃏', one: 'Mister White', many: 'Mister White', color: 'var(--white-role)' },
  lovers: { emoji: '💘', one: 'amoureux', many: 'amoureux', color: '#fb7185' },
}

export function CampTracker({ liveTeams }) {
  if (!liveTeams) return null

  const entries = TRACKER_ORDER.filter((t) => liveTeams[t]).map((t) => [t, liveTeams[t]])
  if (entries.length === 0) return null

  return (
    <div className="tracker">
      {entries.map(([team, { alive, total }]) => {
        const meta = TRACKER_LABEL[team]
        return (
          <span
            key={team}
            className="tracker__item"
            data-empty={String(alive === 0)}
            style={{ color: meta.color }}
          >
            <span>{meta.emoji}</span>
            <span className="tracker__count">
              {alive}/{total}
            </span>
            <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>
              {total > 1 ? meta.many : meta.one}
            </span>
          </span>
        )
      })}
    </div>
  )
}

/**
 * The written debate.
 *
 * Only shown when the table plays with written clues — with spoken clues the
 * argument happens out loud and a chat box would just split attention. Read-only
 * once the vote opens, so people can re-read the accusations while choosing.
 */
export function ChatFeed({ messages, meId, compact }) {
  const endRef = useRef(null)
  const count = messages?.length ?? 0

  // Follow the conversation, but only when it grows — no jumping on every
  // unrelated state broadcast.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [count])

  if (!messages) return null

  return (
    <div className={`chat${compact ? ' chat--compact' : ''} scroll-y`}>
      {count === 0 ? (
        <p className="faint center" style={{ fontSize: '0.8rem', margin: 'auto' }}>
          Personne n'a encore parlé.
        </p>
      ) : (
        messages.map((m) => (
          <div
            key={m.id}
            className={`chat__line${m.playerId === meId ? ' chat__line--mine' : ''}`}
            style={{ '--chip': m.color }}
          >
            <span className="chat__avatar">{m.avatar}</span>
            <div className="chat__bubble">
              <span className="chat__name" style={{ color: m.color }}>{m.name}</span>
              <span className="chat__text">{m.text}</span>
            </div>
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  )
}

/**
 * Round-by-round post-mortem.
 *
 * The scoreboard says who won; this says *how* — the clues, who accused whom,
 * and who it actually was. It is the part of the evening people argue about
 * afterwards, and the server already had every byte of it.
 */
export function Recap({ rounds, players }) {
  const [open, setOpen] = useState(false)
  if (!rounds?.length) return null

  const byId = new Map(players.map((p) => [p.id, p]))
  const who = (id) => byId.get(id) ?? { name: '?', avatar: '·', color: 'var(--text-dim)' }

  return (
    <div className="stack" style={{ gap: 10, width: '100%' }}>
      <button
        type="button"
        className="btn btn--ghost btn--block btn--sm"
        onClick={() => { play('tap'); setOpen((v) => !v) }}
      >
        {open ? 'Masquer le déroulé' : `📜  Revoir la partie (${rounds.length} manche${rounds.length > 1 ? 's' : ''})`}
      </button>

      {open && (
        <div className="recap scroll-y">
          {rounds.map((r) => {
            const clues = Object.entries(r.clues ?? {}).filter(([, text]) => text)
            const votes = Object.entries(r.votes ?? {})
            return (
              <section className="recap__round" key={r.round}>
                <p className="eyebrow">Manche {r.round}</p>

                {clues.length > 0 && (
                  <div className="recap__group">
                    {clues.map(([pid, text]) => {
                      const p = who(pid)
                      return (
                        <span className="recap__chip" key={pid} style={{ '--chip': p.color }}>
                          {p.avatar} {p.name}
                          <strong>{text === '…' ? '—' : `« ${text} »`}</strong>
                        </span>
                      )
                    })}
                  </div>
                )}

                {votes.length > 0 && (
                  <div className="recap__group">
                    {votes.map(([voter, target]) => (
                      <span className="recap__vote" key={voter}>
                        {who(voter).avatar} {who(voter).name}
                        <span className="faint"> → </span>
                        {who(target).avatar} {who(target).name}
                      </span>
                    ))}
                  </div>
                )}

                <p className="recap__outcome">
                  {r.tie ? (
                    <span className="faint">⚖️ Égalité, personne n'est éliminé.</span>
                  ) : r.eliminated ? (
                    <>
                      {r.eliminated.avatar} <strong>{r.eliminated.name}</strong> éliminé —{' '}
                      <span style={{ color: r.eliminated.roleColor }}>
                        {r.eliminated.roleEmoji} {r.eliminated.roleLabel}
                      </span>
                      {r.eliminated.word && <span className="faint"> · « {r.eliminated.word} »</span>}
                    </>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </p>

                {r.alsoEliminated?.map((x) => (
                  <p className="recap__outcome" key={x.id}>
                    {x.avatar} <strong>{x.name}</strong> tombe aussi —{' '}
                    <span style={{ color: x.roleColor }}>{x.roleEmoji} {x.roleLabel}</span>
                  </p>
                ))}

                {r.guess && (
                  <p className="recap__outcome">
                    🃏 tentative « {r.guess.text} » —{' '}
                    <strong style={{ color: r.guess.correct ? 'var(--ok)' : 'var(--danger)' }}>
                      {r.guess.correct ? 'exact' : 'raté'}
                    </strong>
                  </p>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Switch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      className="switch"
      data-on={String(Boolean(checked))}
      disabled={disabled}
      aria-pressed={Boolean(checked)}
      onClick={() => { play('tap'); onChange(!checked) }}
    />
  )
}

export function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          data-active={String(o.value === value)}
          onClick={() => { play('tap'); onChange(o.value) }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Slider and number box driving the same value.
 *
 * Dragging fires continuously, so the network write is debounced and the local
 * draft stays authoritative while the user is interacting — otherwise the
 * server echo would fight the thumb under their finger.
 */
export function NumberSlider({ value, min = 0, max = 10, step = 1, disabled, onCommit }) {
  const [draft, setDraft] = useState(value)
  const [text, setText] = useState(String(value))
  const dirty = useRef(false)
  const timer = useRef(null)

  // Adopt the server's value only when we are not mid-edit.
  useEffect(() => {
    if (dirty.current) return
    setDraft(value)
    setText(String(value))
  }, [value])

  useEffect(() => () => clearTimeout(timer.current), [])

  const commit = (n) => {
    const clamped = Math.max(min, Math.min(max, Math.round(n)))
    setDraft(clamped)
    setText(String(clamped))
    dirty.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      dirty.current = false
      onCommit(clamped)
    }, 280)
    return clamped
  }

  return (
    <div className="numslider">
      <input
        className="numslider__range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => commit(Number(e.target.value))}
      />
      <input
        className="numslider__box mono"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        // Let the field be briefly empty while typing, then snap on blur.
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(n)) commit(n)
        }}
        onBlur={() => {
          const n = Number(text)
          commit(Number.isFinite(n) && text !== '' ? n : draft)
        }}
      />
    </div>
  )
}

export function Setting({ label, hint, children, dimmed }) {
  return (
    <div className="setting" style={dimmed ? { opacity: 0.45 } : undefined}>
      <div className="grow">
        <div className="setting__label">{label}</div>
        {hint && <div className="setting__hint">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

/**
 * Avatar + colour picker.
 *
 * `taken` greys out avatars already claimed in the room, so two players never
 * end up as the same fox — recognising each other at a glance is how the
 * voting screen stays readable.
 */
export function AvatarPicker({ avatars, groups, colors, avatar, color, taken = [], onChange }) {
  const takenSet = new Set(taken.filter((a) => a !== avatar))

  // Families keep a hundred emoji browsable; without them you scroll past the
  // one you wanted twice. Falls back to one flat block if the server is older.
  const families = groups?.length ? groups : [{ id: 'all', label: null, avatars }]

  const cell = (a) => (
    <button
      key={a}
      type="button"
      className="avatarpick__cell"
      data-active={String(a === avatar)}
      disabled={takenSet.has(a)}
      style={{ '--chip': color }}
      onClick={() => { play('select'); onChange({ avatar: a, color }) }}
    >
      {a}
    </button>
  )

  /** For anyone who does not want to browse ninety-six of anything. */
  const surprise = () => {
    play('select')
    const free = avatars.filter((a) => !takenSet.has(a))
    onChange({
      avatar: free[Math.floor(Math.random() * free.length)] ?? avatar,
      color: colors[Math.floor(Math.random() * colors.length)],
    })
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="avatarpick scroll-y">
        {families.map((family) => (
          <div className="avatarpick__family" key={family.id}>
            {family.label && <p className="avatarpick__label">{family.label}</p>}
            <div className="avatarpick__grid">{family.avatars.map(cell)}</div>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 7, flexWrap: 'wrap', justifyContent: 'center' }}>
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            data-active={String(c === color)}
            style={{ background: c }}
            aria-label={`Couleur ${c}`}
            onClick={() => { play('select'); onChange({ avatar, color: c }) }}
          />
        ))}
      </div>

      <button type="button" className="btn btn--ghost btn--sm" onClick={surprise}>
        🎲  Au hasard
      </button>
    </div>
  )
}

/** Two-step button: the first tap arms it, the second confirms. */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn', ...rest }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <button
      type="button"
      className={armed ? `${className} btn--danger` : className}
      onClick={() => {
        play('tap')
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
        }
      }}
      {...rest}
    >
      {armed ? (confirmLabel ?? 'Confirmer ?') : label}
    </button>
  )
}

const TEAM_STYLE = {
  civilian: { label: 'Les Civils', color: 'var(--civilian)', emoji: '🧑' },
  undercover: { label: 'Les Infiltrés', color: 'var(--undercover)', emoji: '🕵️' },
  mrwhite: { label: 'Mister White', color: 'var(--white-role)', emoji: '🃏' },
  lovers: { label: 'Les Amoureux', color: '#fb7185', emoji: '💘' },
}

export function teamStyle(team) {
  return TEAM_STYLE[team] ?? { label: team, color: 'var(--text)', emoji: '🎭' }
}

/**
 * Headline for an outcome, shared victories included.
 *
 * A win can name several camps at once — Mister White and the Infiltrés split
 * the pot when only one civilian is left — so the banner has to be able to say
 * two names instead of one.
 */
export function outcomeStyle(outcome) {
  const teams = outcome?.teams ?? (outcome?.team ? [outcome.team] : [])
  if (teams.length <= 1) {
    const s = teamStyle(teams[0])
    return { ...s, emoji: s.emoji, verb: "l'emporte" }
  }
  const parts = teams.map(teamStyle)
  return {
    label: parts.map((p) => p.label).join(' & '),
    emoji: parts.map((p) => p.emoji).join(''),
    color: parts[0].color,
    verb: "l'emportent ensemble",
    shared: true,
  }
}
