import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AvatarPicker,
  CampTracker,
  ChatFeed,
  DyingGuesses,
  ConfirmButton,
  InviteButton,
  PhaseTimer,
  PlayerChip,
  ReactionBar,
  Recap,
  ScoreBoard,
  Titles,
  TurnTimer,
  outcomeStyle,
} from '../components.jsx'
import Dossier from './Dossier.jsx'
import HostSheet from './HostSheet.jsx'
import RulesSheet from '../RulesSheet.jsx'
import { play, playRoleSting } from '../audio.js'

export default function PlayerRound({ state, you, act, leave, connected, appearance, info }) {
  const [rulesOpen, setRulesOpen] = useState(false)

  const activeRoles = [
    ...Object.keys(state.composition?.comp ?? {}),
    ...(state.composition?.modifiers ?? []),
  ]

  return (
    <div className="screen">
      <header className="spread">
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: '1.5rem' }}>{you.avatar}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: you.color }}>{you.name}</div>
            <div className="faint" style={{ fontSize: '0.72rem' }}>
              {state.code} · {state.round > 0 ? `manche ${state.round}` : 'salon'}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          {/* Reassuring rather than alarming: the client retries by itself, and
              the seat is held server-side while it does. */}
          {!connected && (
            <span className="badge pulse" style={{ color: 'var(--gold)' }}>
              reconnexion…
            </span>
          )}
          {/* Your own card and every clue given so far — the two things people
              have actually forgotten by round three. */}
          <Dossier state={state} you={you} />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => { play('tap'); setRulesOpen(true) }}
            aria-label="Règles et rôles"
          >
            📖
          </button>
          {/* Always reachable: someone must be able to walk away at any moment
              without the whole table having to restart the game. */}
          <ConfirmButton
            className="btn btn--ghost btn--sm"
            label="Quitter"
            confirmLabel="Vraiment ?"
            onConfirm={leave}
          />
        </div>
      </header>

      {state.liveTeams && state.phase !== 'gameOver' && (
        <CampTracker liveTeams={state.liveTeams} />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={state.phase + (you.alive ? '' : '-dead')}
          className="stack grow"
          style={{ justifyContent: 'center' }}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -18 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          <Body state={state} you={you} act={act} appearance={appearance} info={info} />
        </motion.div>
      </AnimatePresence>

      {/* Sits above the round rather than replacing it: the table plays on
          while this phone counts down alone. */}
      {you.dyingGuess && <DyingGuess state={state} you={you} act={act} />}

      {/* Pinned below the round, so the host never has to scroll to find it. */}
      {you.isHost && <HostControls state={state} act={act} info={info} />}

      <RulesSheet
        info={info}
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        activeRoles={activeRoles}
        points={state.settings?.points}
        settings={state.settings}
      />
    </div>
  )
}

/**
 * Flow controls on the crowned player's phone.
 *
 * Just the one button that moves the round on, kept pinned so it never has to
 * be hunted for. Everything else the crown can do — settings, themes, scale,
 * kicking, passing the crown — lives in the sheet reachable from the lobby.
 */
function HostControls({ state, act, info }) {
  const [busy, setBusy] = useState(false)

  const run = async (event) => {
    if (busy) return
    setBusy(true)
    try {
      play('tap')
      await act(event)
    } catch { /* toast already shown */ } finally {
      setBusy(false)
    }
  }

  const min = info?.limits?.min ?? 3
  const enough = state.players.length >= min

  const control = {
    lobby: enough
      ? { label: '▶  Lancer la partie', event: 'host:start' }
      : { label: `Il faut ${min} joueurs minimum`, event: null },
    discuss: { label: 'Passer au vote →', event: 'host:skipDiscussion' },
    voteResult: { label: 'Manche suivante →', event: 'host:continue' },
    gameOver: { label: '↻  Rejouer', event: 'host:restart' },
  }[state.phase]

  if (!control) return null

  return (
    <div className="hostbar">
      <span className="hostbar__crown" title="Tu tiens la télécommande">👑</span>
      <button
        className="btn btn--primary grow"
        disabled={busy || !control.event}
        onClick={() => control.event && run(control.event)}
      >
        {control.label}
      </button>
    </div>
  )
}

/**
 * The eliminated civilian's private, timed shot at naming the impostors.
 *
 * Deliberately a panel and not a phase: the round is carrying on without him,
 * and blocking the table for twenty seconds after every single death would put
 * back exactly the dead time the reactions were added to remove.
 *
 * Nothing here reaches the public state. A dead player who could be seen
 * answering — or worse, seen answering *correctly* — would be an oracle the
 * living could read.
 */
function DyingGuess({ state, you, act }) {
  const [picked, setPicked] = useState([])
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const { deadline, total, count, points, candidates } = you.dyingGuess
  const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()))

  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, deadline - Date.now())), 200)
    return () => clearInterval(id)
  }, [deadline])

  const secs = Math.ceil(left / 1000)
  const targets = state.players.filter((p) => candidates.includes(p.id))

  const toggle = (id) => {
    play('select')
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= count ? prev : [...prev, id],
    )
  }

  const submit = async () => {
    if (busy || picked.length !== count) return
    setBusy(true)
    try {
      await act('player:dyingGuess', { targetIds: picked })
      // No feedback on whether it landed: knowing now would tell him — and
      // anyone reading his face — something the living must not learn.
      setSent(true)
      play('select')
    } catch { /* toast already shown */ } finally {
      setBusy(false)
    }
  }

  if (left <= 0 && !sent) return null

  return (
    <motion.div
      className="dying"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      {sent ? (
        <p className="subtitle center" style={{ fontSize: '0.9rem' }}>
          🔮 Ton dernier soupçon est scellé. Tu sauras à la fin de la partie.
        </p>
      ) : (
        <>
          <div className="spread">
            <p className="eyebrow">🔮 Dernier soupçon</p>
            <span className="badge mono" style={{ color: secs <= 5 ? 'var(--danger)' : 'var(--gold)' }}>
              {secs}s
            </span>
          </div>
          <p className="setting__hint">
            Nomme {count === 1 ? "l'imposteur encore en jeu" : `les ${count} imposteurs encore en jeu`}.
            Personne ne verra ta réponse. Si tu vises juste et que les civils perdent,
            tu marques {points} point{points > 1 ? 's' : ''} quand même.
          </p>

          <div className="players">
            {targets.map((p) => (
              <PlayerChip
                key={p.id}
                player={p}
                selectable={!busy}
                selected={picked.includes(p.id)}
                onSelect={toggle}
              />
            ))}
          </div>

          <button
            className="btn btn--primary btn--block btn--sm"
            disabled={busy || picked.length !== count}
            onClick={submit}
          >
            {picked.length === count
              ? 'Sceller ma réponse'
              : `Encore ${count - picked.length} à désigner`}
          </button>
        </>
      )}
    </motion.div>
  )
}

function Body({ state, you, act, appearance, info }) {
  switch (state.phase) {
    case 'lobby': return <Lobby state={state} you={you} act={act} appearance={appearance} info={info} />
    case 'reveal': return <Reveal state={state} you={you} act={act} />
    case 'describe': return <Describe state={state} you={you} act={act} />
    case 'discuss': return <Discuss state={state} you={you} act={act} />
    case 'vote': return <Vote state={state} you={you} act={act} />
    case 'tiebreak': return <Tiebreak state={state} you={you} act={act} />
    case 'revenge': return <Revenge state={state} you={you} act={act} />
    case 'mrwhiteGuess': return <Guess state={state} you={you} act={act} />
    case 'voteResult': return <RoundResult state={state} you={you} />
    case 'gameOver': return <GameOver state={state} you={you} />
    default: return null
  }
}

// ------------------------------------------------------------------- lobby

function Lobby({ state, you, act, appearance, info }) {
  const [editing, setEditing] = useState(false)
  const taken = state.players.filter((p) => p.id !== you.id).map((p) => p.avatar)

  const change = async (look) => {
    try {
      await act('player:appearance', look)
    } catch { /* toast already shown */ }
  }

  return (
    <div className="stack center">
      <p className="eyebrow">En attente</p>
      <h1 className="title">Tu es dans la partie</h1>
      <p className="subtitle">
        {you.isHost
          ? 'Tu tiens la télécommande : règle la partie et lance quand tout le monde est là.'
          : "L'hôte lance la partie dans un instant."}
      </p>

      {/* The code, big enough to read out loud — a game started from a phone has
          no shared screen to display it. */}
      <div className="stack center" style={{ gap: 2, width: '100%' }}>
        <p className="eyebrow">Code de la partie</p>
        <div className="joincode mono" style={{ fontSize: 'clamp(2rem, 12vw, 3rem)' }}>
          {state.code}
        </div>
        {/* Reading four letters aloud works in a living room and nowhere else.
            Anyone at the table can invite, not just the crown. */}
        <InviteButton code={state.code} />
      </div>

      {you.isHost && <HostSheet state={state} info={info} act={act} />}

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => { play('tap'); setEditing((v) => !v) }}
      >
        {editing ? 'Terminé' : '🎨 Personnaliser mon avatar'}
      </button>

      {editing && appearance?.avatars?.length > 0 && (
        <div className="card" style={{ width: '100%' }}>
          <AvatarPicker
            avatars={appearance.avatars}
            groups={appearance.groups}
            colors={appearance.colors}
            avatar={you.avatar}
            color={you.color}
            taken={taken}
            onChange={change}
          />
        </div>
      )}

      <div className="players" style={{ marginTop: 12 }}>
        {state.players.map((p) => (
          <PlayerChip key={p.id} player={p} />
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ reveal

/**
 * Press-and-hold to see the word.
 *
 * Holding — rather than a toggle — is deliberate: the card is only readable
 * while a finger is on the screen, so it can never be left face-up on a table,
 * and a neighbour glancing over sees the covered state most of the time.
 */
/** How long the card stays open with nobody touching it. */
const REVEAL_IDLE_MS = 20_000

function Reveal({ state, you, act }) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(false)
  const [left, setLeft] = useState(REVEAL_IDLE_MS)
  const soundedRef = useRef(false)
  const deadlineRef = useRef(0)

  /**
   * Reveal is a *state*, not a gesture.
   *
   * It used to be press-and-hold, which is safer but physically impossible to
   * combine with scrolling — and a card carrying two or three modifiers has to
   * scroll. So: tap to open, tap to close, and it closes itself after a spell
   * of inactivity so a phone is never left face-up by accident.
   */
  const bumpIdle = () => {
    deadlineRef.current = Date.now() + REVEAL_IDLE_MS
    setLeft(REVEAL_IDLE_MS)
  }

  const reveal = () => {
    setOpen(true)
    setSeen(true)
    bumpIdle()
    if (!soundedRef.current) {
      soundedRef.current = true
      play('reveal')
      // The sting matches what the card *claims* to be, so a disguised
      // undercover hears the civilian one — the audio must not betray them.
      setTimeout(() => playRoleSting(you.role.id), 120)
    }
  }

  const hide = () => setOpen(false)

  useEffect(() => {
    if (!open) return undefined
    const id = setInterval(() => {
      const remaining = deadlineRef.current - Date.now()
      setLeft(Math.max(0, remaining))
      if (remaining <= 0) setOpen(false)
    }, 200)
    return () => clearInterval(id)
  }, [open])

  // Switching apps or locking the screen must not leave the card open behind us.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState !== 'visible') setOpen(false) }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  const waiting = state.players.filter((p) => !p.ready && !p.left).length
  // One modifier still fits comfortably; from two the card needs to breathe, so
  // the word shrinks a notch and the body starts scrolling.
  const crowded = (you.extras?.length ?? 0) >= 2

  return (
    <div className="stack">
      <div
        className={`wordcard${open ? ' wordcard--open' : ' wordcard--hidden'}`}
        // Closed, the whole card is one big button. Open, it is scrollable
        // content — so tapping inside must never toggle it, or every scroll
        // would slam it shut.
        onClick={open ? undefined : reveal}
        onPointerDown={open ? bumpIdle : undefined}
        // Scroll events do not bubble, hence the capture phase; touchmove is
        // the belt-and-braces for phones mid-swipe.
        onScrollCapture={open ? bumpIdle : undefined}
        onTouchMove={open ? bumpIdle : undefined}
        onContextMenu={(e) => e.preventDefault()}
      >
        {open ? (
          <>
            {/* The word is pinned: with two or three modifiers the card gets
                long, and the one thing you must never have to hunt for is your
                own word. Everything else scrolls underneath it. */}
            <div className="wordcard__head">
              <button
                type="button"
                className="btn btn--ghost btn--sm wordcard__hide"
                onClick={(e) => { e.stopPropagation(); play('tap'); hide() }}
              >
                Masquer
              </button>

              <span
                className="wordcard__role"
                style={{ background: `${you.role.color}22`, color: you.role.color }}
              >
                {you.role.emoji} {you.brief.title}
              </span>

              {you.word ? (
                <div className={`wordcard__word${crowded ? ' wordcard__word--compact' : ''}`}>
                  {you.word}
                </div>
              ) : (
                <div
                  className={`wordcard__word${crowded ? ' wordcard__word--compact' : ''}`}
                  style={{ opacity: 0.55 }}
                >
                  ? ? ?
                </div>
              )}

              {/* Only some words carry a definition — shown when the bank has
                  one, so nobody is stuck describing a word they've never heard
                  of. */}
              {you.wordDef && (
                <p className="wordcard__hint" style={{ fontStyle: 'italic', opacity: 0.85 }}>
                  {you.wordDef}
                </p>
              )}
            </div>

            <div className="wordcard__scroll scroll-y">
              <p className="wordcard__hint">{you.brief.body}</p>

              {/* Modifiers stack on top of the role — the Amoureux keep whatever
                  they were dealt and get this extra block. */}
              {you.extras?.map((extra, i) => (
                <div
                  key={i}
                  className="intel"
                  style={{ borderColor: extra.color, background: `${extra.color}18` }}
                >
                  <div style={{ fontWeight: 750, color: extra.color, marginBottom: 4 }}>
                    {extra.title}
                  </div>
                  <p className="wordcard__hint" style={{ maxWidth: 'none' }}>{extra.body}</p>
                </div>
              ))}

              {crowded && (
                <p className="faint" style={{ fontSize: '0.72rem' }}>
                  ↕ fais défiler pour tout lire
                </p>
              )}
            </div>

            {/* Visible countdown, so the card closing is never a surprise. It
                refills the moment you touch or scroll. */}
            <div className="timer wordcard__idle">
              <div
                className={`timer__bar${left < 6000 ? ' timer__bar--urgent' : ''}`}
                style={{ width: `${(left / REVEAL_IDLE_MS) * 100}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: '2.6rem' }}>🤫</div>
            <div className="title">Touche pour révéler</div>
            <p className="wordcard__hint">
              {seen
                ? 'Reste discret. Elle se masquera toute seule.'
                : 'Personne d\'autre ne doit voir ta carte. Elle se masquera toute seule au bout de quelques secondes.'}
            </p>
          </>
        )}
      </div>

      {/* Once tapped it turns green, goes dead, and says what it is waiting for.
          A button that merely greys out reads as "nothing happened", and people
          press it again unsure whether it registered. */}
      <button
        className={you.ready ? 'btn btn--done btn--block' : 'btn btn--primary btn--block'}
        disabled={!seen || you.ready}
        onClick={() => {
          // Confirm the tap before the server round-trip, for the same reason.
          play('select')
          navigator.vibrate?.(30)
          act('player:ready')
        }}
      >
        {you.ready
          ? waiting === 0
            ? '✓  Tout le monde est prêt'
            : `✓  En attente des autres joueurs (${waiting})`
          : seen
            ? "J'ai vu ma carte"
            : "Regarde ta carte d'abord"}
      </button>

      {/* Who the round is still waiting on, by name and face — far clearer than
          a bare countdown, and it makes the tap visibly land. */}
      {you.ready && (
        <div className="stack center" style={{ gap: 8 }}>
          <p className="eyebrow">
            {waiting === 0
              ? 'Tout le monde est prêt'
              : `On attend ${waiting} joueur${waiting > 1 ? 's' : ''}`}
          </p>
          <div className="players">
            {state.players
              .filter((p) => !p.left)
              .map((p) => (
                <PlayerChip key={p.id} player={p} />
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- describe

function Describe({ state, you, act }) {
  const [clue, setClue] = useState('')
  const [busy, setBusy] = useState(false)
  const mine = state.currentSpeakerId === you.id
  const speaker = state.players.find((p) => p.id === state.currentSpeakerId)
  const buzzed = useRef(false)

  // Vibrate once when the turn lands, so a phone face-down on the table still
  // gets your attention.
  useEffect(() => {
    if (mine && !buzzed.current) {
      buzzed.current = true
      play('turn')
      navigator.vibrate?.([40, 60, 40])
    }
    if (!mine) buzzed.current = false
  }, [mine])

  useEffect(() => { setClue('') }, [state.currentSpeakerId])

  const submit = async (e) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await act('player:clue', { text: clue })
      setClue('')
    } catch {
      // Refused by the rules: own word, a word in play, or already used.
      play('rejected')
    } finally {
      setBusy(false)
    }
  }

  if (!you.alive) {
    return (
      <div className="stack center">
        <p className="eyebrow">Éliminé</p>
        <h1 className="title">Tu observes</h1>
        <p className="subtitle">Ne dis rien. Regarde-les se déchirer.</p>
        <WordReminder you={you} />
        <ClueList state={state} you={you} act={act} />
      </div>
    )
  }

  if (!mine) {
    return (
      <div className="stack center">
        <p className="eyebrow">Au tour de</p>
        <h1 className="display" style={{ fontSize: 'clamp(1.8rem, 8vw, 2.6rem)' }}>
          {speaker?.avatar} {speaker?.name}
        </h1>
        <p className="subtitle">Écoute bien. Ton tour arrive.</p>
        {state.settings.turnTimer > 0 && (
          <TurnTimer deadline={state.turnDeadline} total={state.settings.turnTimer} />
        )}
        <WordReminder you={you} />
        <ClueList state={state} you={you} act={act} />
      </div>
    )
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="center stack" style={{ gap: 6 }}>
        <p className="eyebrow">C'est à toi</p>
        <h1 className="title">
          {state.settings.writtenClues ? 'Écris un indice' : 'Décris ton mot à voix haute'}
        </h1>
        <p className="subtitle">Un seul mot. Ni le tien, ni un indice déjà donné.</p>
      </div>

      {state.settings.turnTimer > 0 && (
        <TurnTimer deadline={state.turnDeadline} total={state.settings.turnTimer} />
      )}

      <WordReminder you={you} big />

      {state.settings.writtenClues && (
        <input
          className="input"
          value={clue}
          onChange={(e) => setClue(e.target.value.slice(0, 40))}
          placeholder="ton indice…"
          autoFocus
          autoComplete="off"
          maxLength={40}
        />
      )}

      <button
        className="btn btn--primary btn--block"
        disabled={busy || (state.settings.writtenClues && !clue.trim())}
      >
        {state.settings.writtenClues ? 'Valider mon indice' : "J'ai parlé →"}
      </button>

      <ClueList state={state} you={you} act={act} />
    </form>
  )
}

/** Always-available reminder of your own word, hidden behind a press. */
function WordReminder({ you, big }) {
  const [open, setOpen] = useState(false)

  if (!you.word) {
    return (
      <div className="card card--tight center">
        <p className="eyebrow">Ton mot</p>
        <p className="title" style={{ marginTop: 4 }}>🃏 Aucun</p>
        <p className="subtitle" style={{ fontSize: '0.82rem', marginTop: 4 }}>
          Improvise à partir de ce que disent les autres.
        </p>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="card card--tight center"
      style={{ cursor: 'pointer', width: '100%', color: 'inherit' }}
      onPointerDown={() => setOpen(true)}
      onPointerUp={() => setOpen(false)}
      onPointerLeave={() => setOpen(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="eyebrow">Ton mot</p>
      <p
        className="title"
        style={{
          marginTop: 4,
          fontSize: big ? '1.7rem' : '1.2rem',
          filter: open ? 'none' : 'blur(11px)',
          transition: 'filter 0.16s',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
      >
        {you.word}
      </p>
      {open && you.wordDef && (
        <p className="subtitle" style={{ fontSize: '0.78rem', marginTop: 6, fontStyle: 'italic' }}>
          {you.wordDef}
        </p>
      )}
      {!open && (
        <p className="faint" style={{ fontSize: '0.74rem', marginTop: 4 }}>
          appuie pour révéler
        </p>
      )}
    </button>
  )
}

/**
 * The round's clues, and where reactions are cast on a phone.
 *
 * This list is on screen during description, debate and vote alike, so a mark
 * placed while someone was still speaking is still under their clue when the
 * ballot opens — which is exactly when it is worth the most.
 */
function ClueList({ state, you, act }) {
  const given = state.players.filter((p) => p.hasClue && p.clue)
  if (!state.settings.writtenClues || given.length === 0) return null

  // The dead do not react, for the same reason they do not chat: they know
  // things, and a well-placed 🤨 would keep them steering the game.
  const canReact = state.reactionsOpen && you?.alive && act

  const react = (targetId, emoji) => {
    play('tap')
    act('player:react', { targetId, emoji }).catch(() => {})
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="eyebrow">Indices de la manche</p>
      {given.map((p) => (
        <div className="clue" key={p.id}>
          <span style={{ fontSize: '1.3rem' }}>{p.avatar}</span>
          <div className="grow">
            <div
              className="clue__text"
              style={p.clueTimedOut ? { color: 'var(--text-faint)', fontStyle: 'italic' } : undefined}
            >
              {p.clueTimedOut ? '…' : `« ${p.clue} »`}
            </div>
            <div className="clue__author">
              {p.name}
              {p.clueTimedOut && ' · temps écoulé'}
            </div>
            <ReactionBar
              reactions={state.reactions?.[p.id]}
              players={state.players}
              mine={you?.id}
              palette={state.reactionPalette}
              onReact={canReact && p.id !== you?.id ? (emoji) => react(p.id, emoji) : null}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ----------------------------------------------------------------- discuss

/**
 * Open floor. The phone deliberately shows almost nothing here — the point is
 * that everyone looks up and argues. It only keeps the clock and the clues.
 */
function Discuss({ state, you, act }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const chatOpen = state.chatOpen && you.alive

  const send = async (e) => {
    e?.preventDefault()
    const text = msg.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await act('player:chat', { text })
      setMsg('')
    } catch {
      play('rejected')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack center">
      <p className="eyebrow">Discussion</p>
      <h1 className="title">Débattez</h1>
      <p className="subtitle">
        {you.alive
          ? 'Accusez, défendez-vous, mentez. Le vote arrive.'
          : 'Tu es éliminé : écoute, mais ne dis rien.'}
      </p>

      <PhaseTimer deadline={state.phaseDeadline} total={state.settings.discussTime} />

      {/* Written clues means the table is arguing in text, so the debate needs
          somewhere to happen. With spoken clues this whole block is absent. */}
      {state.settings.writtenClues && (
        <>
          <ChatFeed messages={state.chat} meId={you.id} />
          {chatOpen ? (
            <form className="chat__form" onSubmit={send}>
              <input
                className="input grow"
                value={msg}
                onChange={(e) => setMsg(e.target.value.slice(0, 140))}
                placeholder="Dis ce que tu en penses…"
                autoComplete="off"
                maxLength={140}
              />
              <button className="btn btn--primary" disabled={busy || !msg.trim()}>
                ➤
              </button>
            </form>
          ) : (
            <p className="faint" style={{ fontSize: '0.78rem' }}>
              {you.alive ? 'Le débat est clos.' : 'Les éliminés ne participent pas au débat.'}
            </p>
          )}
        </>
      )}

      <WordReminder you={you} />
      <ClueList state={state} you={you} act={act} />

      {/* One impatient player must not be able to cut the debate short: the
          vote opens only when everyone has asked, or when the host forces it. */}
      {you.canVote && (
        <div className="stack" style={{ gap: 6 }}>
          <button
            type="button"
            className={you.wantsSkip ? 'btn btn--primary btn--block' : 'btn btn--ghost btn--block'}
            onClick={() => { play('tap'); act('player:skipDiscussion') }}
          >
            {you.wantsSkip ? '✓ Tu es prêt à voter' : 'Passer au vote →'}
          </button>
          <p className="faint center" style={{ fontSize: '0.78rem' }}>
            {state.skipRequests.length} / {state.skipNeeded} prêts — il faut tout le monde, ou
            l'écran principal.
          </p>
        </div>
      )}
    </div>
  )
}

// -------------------------------------------------------------- revenge

/** The Vengeuse was lynched and picks who falls with her. */
function Revenge({ state, you, act }) {
  const [busy, setBusy] = useState(false)
  const mine = you.revenge

  if (!mine) {
    return (
      <div className="stack center">
        <p className="eyebrow">Vengeance</p>
        <h1 className="title pulse">🗡️ Quelqu'un ne part pas seul</h1>
        <p className="subtitle">
          La personne éliminée désigne qui tombe avec elle. Ça peut être toi.
        </p>
      </div>
    )
  }

  const decide = async (targetId) => {
    if (busy) return
    setBusy(true)
    try {
      await act('player:revenge', { targetId })
    } catch { /* toast already shown */ } finally {
      setBusy(false)
    }
  }

  const targets = mine.targets
    .map((id) => state.players.find((p) => p.id === id))
    .filter(Boolean)

  return (
    <div className="stack">
      <div className="center stack" style={{ gap: 6 }}>
        <div style={{ fontSize: '3rem' }}>{mine.emoji}</div>
        <h1 className="title">{mine.label}</h1>
        <p className="subtitle">{mine.prompt}</p>
      </div>

      <div className="players">
        {targets.map((p) => (
          <PlayerChip key={p.id} player={p} selectable={!busy} onSelect={decide} />
        ))}
      </div>

      {mine.allowSkip && (
        <button
          type="button"
          className="btn btn--ghost btn--block"
          disabled={busy}
          onClick={() => { play('tap'); decide(null) }}
        >
          {mine.skipLabel ?? 'Partir seule'}
        </button>
      )}
    </div>
  )
}

// --------------------------------------------------------------- tiebreak

/**
 * The vote deadlocked and this player's role lets them decide.
 *
 * Everyone else sees a neutral waiting screen, so the arbiter's identity stays
 * hidden — which is the whole point of the power.
 */
function Tiebreak({ state, you, act }) {
  const [busy, setBusy] = useState(false)
  const mine = you.tiebreak

  if (!mine) {
    const tied = (state.tiebreak?.tiedIds ?? [])
      .map((id) => state.players.find((p) => p.id === id))
      .filter(Boolean)
    return (
      <div className="stack center">
        <p className="eyebrow">Égalité</p>
        <h1 className="title pulse">⚖️ Quelqu'un tranche…</h1>
        <p className="subtitle">
          {tied.map((p) => p.name).join(' et ')} sont à égalité. Une personne à cette table
          décide — et ce n'est pas toi.
        </p>
        <div className="players" style={{ marginTop: 10 }}>
          {tied.map((p) => (
            <PlayerChip key={p.id} player={p} highlighted />
          ))}
        </div>
      </div>
    )
  }

  const decide = async (targetId) => {
    if (busy) return
    setBusy(true)
    try {
      await act('player:tiebreak', { targetId })
    } catch { /* toast already shown */ } finally {
      setBusy(false)
    }
  }

  const tied = mine.tiedIds
    .map((id) => state.players.find((p) => p.id === id))
    .filter(Boolean)

  return (
    <div className="stack">
      <div className="center stack" style={{ gap: 6 }}>
        <div style={{ fontSize: '3rem' }}>{mine.emoji}</div>
        <h1 className="title">{mine.label}</h1>
        <p className="subtitle">{mine.prompt}</p>
      </div>

      <div className="players">
        {tied.map((p) => (
          <PlayerChip key={p.id} player={p} selectable={!busy} onSelect={decide} />
        ))}
      </div>

      {mine.allowAbstain && (
        <button
          type="button"
          className="btn btn--ghost btn--block"
          disabled={busy}
          onClick={() => { play('tap'); decide(null) }}
        >
          {mine.abstainLabel ?? 'Personne ne part'}
        </button>
      )}

      <ClueList state={state} you={you} act={act} />
    </div>
  )
}

// -------------------------------------------------------------------- vote

function Vote({ state, you, act }) {
  const [busy, setBusy] = useState(false)
  const targets = state.players.filter((p) => p.alive && p.id !== you.id)

  // A Fantôme keeps voting from beyond the grave — hence `canVote` rather than
  // a plain "am I alive" test.
  if (!you.canVote) {
    return (
      <div className="stack center">
        <p className="eyebrow">Vote en cours</p>
        <h1 className="title">Tu ne votes plus</h1>
        <p className="subtitle">Les vivants décident.</p>
        {state.settings.writtenClues && state.chat?.length > 0 && (
          <ChatFeed messages={state.chat} meId={you.id} compact />
        )}
        <ClueList state={state} you={you} act={act} />
      </div>
    )
  }

  // A ballot stays changeable until the last player casts theirs — at which
  // point the server tallies immediately and the question is closed.
  const pick = async (id) => {
    if (busy || id === you.vote) return
    setBusy(true)
    try {
      await act('player:vote', { targetId: id })
    } catch { /* toast already shown */ } finally {
      setBusy(false)
    }
  }

  const blank = you.vote === 'blank'
  const chosen = you.vote && !blank ? state.players.find((p) => p.id === you.vote) : null
  const waiting = state.players.filter((p) => p.canVote && !p.hasVoted).length
  const stakes = state.settings.detectiveMode ? state.settings.points?.detective ?? 0 : 0

  return (
    <div className="stack">
      <div className="center stack" style={{ gap: 6 }}>
        <p className="eyebrow">Vote</p>
        <h1 className="title">
          {blank
            ? 'Tu votes blanc'
            : chosen
              ? `Tu accuses ${chosen.avatar} ${chosen.name}`
              : "Qui est l'imposteur ?"}
        </h1>
        <p className="subtitle">
          {!you.alive && '👻 Tu es mort, mais ton bulletin compte encore. '}
          {you.vote
            ? waiting > 0
              ? `Tu peux encore changer d'avis — ${waiting} joueur${waiting > 1 ? 's' : ''} n'${waiting > 1 ? 'ont' : 'a'} pas voté.`
              : 'Dépouillement en cours…'
            : 'Touche quelqu\'un pour voter.'}
        </p>
        {/* Say the price before the ballot, not after: the whole point of the
            mode is that accusing someone should feel like it costs something. */}
        {stakes > 0 && (
          <p className="setting__hint">
            🔍 {stakes} point{stakes > 1 ? 's' : ''} si tu vises un imposteur, autant en moins sinon.
          </p>
        )}
      </div>

      <div className="players">
        {targets.map((p) => (
          <PlayerChip
            key={p.id}
            player={p}
            selectable={!busy}
            selected={you.vote === p.id}
            onSelect={pick}
          />
        ))}
      </div>

      {/* Refusing to accuse is a real answer. Without it, a table that scores
          its ballots pushes people to name someone at random rather than admit
          they have nothing. */}
      {state.settings.blankVote && (
        <button
          type="button"
          className={blank ? 'btn btn--done btn--block btn--sm' : 'btn btn--ghost btn--block btn--sm'}
          disabled={busy}
          onClick={() => { play('tap'); pick('blank') }}
        >
          {blank ? '✓  Vote blanc' : '🤷  Voter blanc'}
        </button>
      )}

      {/* Read-only during the vote: the argument is closed, but re-reading it
          is exactly what you want while choosing a name. */}
      {state.settings.writtenClues && state.chat?.length > 0 && (
        <ChatFeed messages={state.chat} meId={you.id} compact />
      )}

      <ClueList state={state} you={you} act={act} />
    </div>
  )
}

// ------------------------------------------------------------ mister white

function Guess({ state, you, act }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const mine = state.pendingGuesser === you.id

  if (!mine) {
    return (
      <div className="stack center">
        <p className="eyebrow">Suspense</p>
        <h1 className="title pulse">🃏 Mister White tente sa chance</h1>
        <p className="subtitle">S'il devine le mot des civils, il gagne tout seul.</p>
      </div>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !text.trim()) return
    setBusy(true)
    try {
      await act('player:guess', { text })
    } catch { /* toast already shown */ } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="center stack" style={{ gap: 6 }}>
        <div style={{ fontSize: '3rem' }}>🃏</div>
        <h1 className="title">Tu es démasqué</h1>
        <p className="subtitle">
          Dernière chance : quel était le mot des civils ? Trouve-le et tu gagnes la partie
          à toi tout seul.
        </p>
      </div>

      <input
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 40))}
        placeholder="le mot des civils…"
        autoFocus
        autoComplete="off"
      />

      <button className="btn btn--danger btn--block" disabled={busy || !text.trim()}>
        Je tente : « {text.trim() || '…'} »
      </button>
    </form>
  )
}

// ------------------------------------------------------------------ result

function RoundResult({ state, you }) {
  const { lastResult } = state

  if (lastResult?.tie) {
    return (
      <div className="stack center">
        <div style={{ fontSize: '3rem' }}>⚖️</div>
        <h1 className="title">Personne n'est éliminé</h1>
        <p className="subtitle">
          {lastResult.tiebreak?.abstained
            ? "Le pouvoir de départage a choisi d'épargner tout le monde."
            : 'Les votes se sont annulés. On repart pour un tour.'}
        </p>
      </div>
    )
  }

  const el = lastResult?.eliminated
  const isMe = el?.id === you.id

  return (
    <div className="stack center">
      <p className="eyebrow">
        {el?.cause === 'tiebreak'
          ? '⚖️ Départagé'
          : isMe
            ? 'Tu as été éliminé'
            : 'Éliminé'}
      </p>
      <div style={{ fontSize: '3.2rem' }}>{el?.avatar}</div>
      <h1 className="title">{el?.name}</h1>
      <p className="title" style={{ color: el?.roleColor, fontSize: '1.1rem' }}>
        {el?.roleEmoji} {el?.roleLabel}
      </p>
      {/* Same reasoning as the host screen: the word stays secret until the end,
          otherwise a single elimination gives the Infiltré everything. */}
      {el?.hadWord === false && <p className="subtitle">Il n'avait aucun mot.</p>}

      {lastResult?.announce && <p className="subtitle">{lastResult.announce}</p>}

      {lastResult?.alsoEliminated?.map((x) => (
        <p className="subtitle" key={x.id}>
          {x.avatar} <strong>{x.name}</strong> tombe aussi — {x.roleEmoji} {x.roleLabel}
        </p>
      ))}

      {lastResult?.notes?.map((n, i) => (
        <p className="subtitle faint" key={i}>{n}</p>
      ))}

      {lastResult?.guess && (
        <p className="subtitle">
          Tentative « {lastResult.guess.text} » —{' '}
          <strong style={{ color: lastResult.guess.correct ? 'var(--ok)' : 'var(--danger)' }}>
            {lastResult.guess.correct ? 'exact' : 'raté'}
          </strong>
        </p>
      )}

      <p className="subtitle faint" style={{ marginTop: 10 }}>
        La manche suivante démarre depuis l'écran principal.
      </p>
    </div>
  )
}

function GameOver({ state, you }) {
  const team = outcomeStyle(state.outcome)
  // The server already decided who won — including the Amoureux and shared
  // victories, neither of which follows team lines. Trust its scoring rather
  // than re-deriving it here.
  const mine = state.scoreboard?.find((r) => r.playerId === you.id)

  return (
    <div className="stack center">
      <p className="eyebrow">Fin de partie</p>
      <div style={{ fontSize: '3.4rem' }}>{team.emoji}</div>
      <h1 className="title" style={{ color: team.color }}>{team.label} {team.verb}</h1>
      <p className="subtitle">{state.outcome?.reason}</p>

      <div className="card card--tight" style={{ marginTop: 6, width: '100%' }}>
        <p className="eyebrow">
          {mine?.won ? '🎉 Tu gagnes' : 'Perdu cette fois'}
          {mine?.points > 0 && ` · +${mine.points} pts`}
        </p>
        {/* Side objectives pay even when your camp lost. */}
        {mine?.breakdown?.length > 0 && (
          <p className="subtitle" style={{ fontSize: '0.8rem', marginTop: 6 }}>
            {mine.breakdown.map((b) => `${b.label} +${b.points}`).join(' · ')}
          </p>
        )}
        {state.words && (
          <p className="subtitle" style={{ marginTop: 8 }}>
            <span style={{ color: 'var(--civilian)' }}>{state.words.civilianWord}</span>
            {' vs '}
            <span style={{ color: 'var(--undercover)' }}>{state.words.undercoverWord}</span>
          </p>
        )}
      </div>

      <ScoreBoard rows={state.scoreboard} compact />

      <Titles titles={state.titles} />

      <DyingGuesses guesses={state.dyingGuesses} players={state.players} />

      <Recap rounds={state.recap} players={state.players} />

      <div className="players" style={{ marginTop: 8 }}>
        {state.players.map((p) => (
          <PlayerChip key={p.id} player={p} />
        ))}
      </div>
    </div>
  )
}
