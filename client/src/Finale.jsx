import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { play } from './audio.js'

/**
 * The end of an evening: podium, final table, and the awards.
 *
 * Two presentations of the same data rather than one that stretches: the shared
 * screen gets the theatre — a three-step podium, confetti, a slow reveal — and
 * a phone gets the same facts stacked vertically and quickly. Trying to make a
 * single responsive component do both ends up mediocre on each.
 *
 * Everything animated here moves with `transform` and `opacity` only. The app
 * already leans on backdrop blur; animating anything that repaints on top of it
 * is what makes a cheap Android stutter, and this screen is precisely the
 * moment where dropped frames would be noticed.
 */

const TONE = {
  good: { color: 'var(--ok)', ring: 'rgba(52, 211, 153, 0.35)' },
  bad: { color: 'var(--undercover)', ring: 'rgba(244, 63, 94, 0.35)' },
  sympathy: { color: 'var(--gold)', ring: 'rgba(251, 191, 36, 0.35)' },
  neutral: { color: 'var(--accent-2)', ring: 'rgba(77, 216, 255, 0.3)' },
}

const MEDALS = ['🥇', '🥈', '🥉']

export default function Finale({ state, onNewEvening, onLeave, compact = false, canControl = true }) {
  const standings = state.finalStandings ?? []
  const honours = state.honours ?? []
  const [skipped, setSkipped] = useState(false)

  // Every delay flows from here, so "show it all" is a single switch rather
  // than a special case threaded through each element.
  const beat = skipped ? 0 : 1
  const podiumAt = 0.4 * beat
  const tableAt = podiumAt + 1.6 * beat
  const honoursAt = tableAt + 0.8 * beat

  useEffect(() => {
    if (skipped) return undefined
    const t = setTimeout(() => play('scoreTop'), podiumAt * 1000 + 900)
    return () => clearTimeout(t)
  }, [skipped, podiumAt])

  const top = standings.slice(0, 3)
  const rest = standings.slice(3)

  return (
    <div className={compact ? 'finale finale--compact' : 'finale'}>
      {!skipped && !compact && <Confetti />}

      <motion.div
        className="stack center"
        style={{ gap: 4 }}
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <p className="eyebrow">Fin de soirée</p>
        <h1 className={compact ? 'title' : 'host__display'}>Le palmarès</h1>
        <p className="subtitle">
          {state.gameNumber} partie{state.gameNumber > 1 ? 's' : ''} · {standings.length} joueurs
        </p>
      </motion.div>

      {compact ? (
        <CompactPodium top={top} at={podiumAt} />
      ) : (
        <Podium top={top} at={podiumAt} />
      )}

      {rest.length > 0 && (
        <motion.div
          className="stack"
          style={{ gap: 4, width: '100%', maxWidth: 520 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: tableAt, duration: 0.4 }}
        >
          {rest.map((p, i) => (
            <div className="finale__row" key={p.id} style={{ '--chip': p.color }}>
              <span className="finale__rank mono">{i + 4}</span>
              <span className="finale__avatar">{p.avatar}</span>
              <span className="grow finale__name">
                {p.name}
                {p.left && <span className="faint" style={{ fontSize: '0.72rem' }}> · parti</span>}
              </span>
              <span className="mono finale__score">{p.score}</span>
            </div>
          ))}
        </motion.div>
      )}

      {honours.length > 0 && (
        <div className="stack" style={{ gap: 8, width: '100%', maxWidth: 620 }}>
          <motion.p
            className="eyebrow center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: honoursAt, duration: 0.3 }}
          >
            🏅 Les titres de la soirée
          </motion.p>

          {honours.map((h, i) => (
            <Honour key={h.key} honour={h} at={honoursAt + 0.3 + i * 0.55 * beat} silent={skipped} />
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {!skipped && (
          <button className="btn btn--ghost btn--sm" onClick={() => { play('tap'); setSkipped(true) }}>
            ⏩  Tout afficher
          </button>
        )}
        {canControl && (
          <button className="btn btn--primary" onClick={() => { play('tap'); onNewEvening() }}>
            🔄  Nouvelle soirée
          </button>
        )}
        <button className="btn btn--ghost" onClick={() => { play('tap'); onLeave() }}>
          ← Revenir à l'écran principal
        </button>
      </div>
    </div>
  )
}

/** Three steps of different heights — the shape everyone reads instantly. */
function Podium({ top, at }) {
  const order = [top[1], top[0], top[2]].filter(Boolean) // 2e, 1er, 3e
  const heightOf = (place) => (place === 0 ? 190 : place === 1 ? 140 : 110)

  return (
    <div className="podium">
      {order.map((p) => {
        const place = top.indexOf(p)
        return (
          <motion.div
            className="podium__slot"
            key={p.id}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: at + (2 - place) * 0.45, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="podium__who">
              <span className="podium__medal">{MEDALS[place]}</span>
              <span className="podium__avatar" style={{ color: p.color }}>{p.avatar}</span>
              <span className="podium__name">{p.name}</span>
              <Counter to={p.score} at={at + (2 - place) * 0.45 + 0.3} className="podium__score mono" />
            </div>
            <motion.div
              className={`podium__block podium__block--${place + 1}`}
              style={{ height: heightOf(place), '--chip': p.color }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: at + (2 - place) * 0.45, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            />
          </motion.div>
        )
      })}
    </div>
  )
}

/** On a phone, three columns become three lines — same information, readable. */
function CompactPodium({ top, at }) {
  return (
    <div className="stack" style={{ gap: 6, width: '100%', maxWidth: 420 }}>
      {top.map((p, i) => (
        <motion.div
          className={`finale__row finale__row--top${i === 0 ? ' finale__row--gold' : ''}`}
          key={p.id}
          style={{ '--chip': p.color }}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: at + i * 0.3, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="finale__medal">{MEDALS[i]}</span>
          <span className="finale__avatar">{p.avatar}</span>
          <span className="grow finale__name">
            {p.name}
            {p.left && <span className="faint" style={{ fontSize: '0.72rem' }}> · parti</span>}
          </span>
          <Counter to={p.score} at={at + i * 0.3 + 0.2} className="mono finale__score" />
        </motion.div>
      ))}
    </div>
  )
}

/** One award, turned over. */
function Honour({ honour, at, silent }) {
  const [shown, setShown] = useState(at === 0)
  const tone = TONE[honour.tone] ?? TONE.neutral

  useEffect(() => {
    if (at === 0) { setShown(true); return undefined }
    const t = setTimeout(() => { setShown(true); if (!silent) play('scoreRow') }, at * 1000)
    return () => clearTimeout(t)
  }, [at, silent])

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          className="honour"
          style={{ '--tone': tone.color, '--ring': tone.ring }}
          initial={{ opacity: 0, rotateX: -70, y: 10 }}
          animate={{ opacity: 1, rotateX: 0, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="honour__emoji">{honour.emoji}</span>
          <div className="grow">
            <div className="honour__label">{honour.label}</div>
            <div className="honour__who">
              {honour.avatar} {honour.name}
              {honour.left && <span className="faint"> · parti</span>}
            </div>
            <div className="honour__detail">{honour.detail}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A score that rolls up to its value instead of appearing. */
function Counter({ to, at, className }) {
  const [n, setN] = useState(0)

  useEffect(() => {
    if (at === 0) { setN(to); return undefined }
    let raf = null
    const start = performance.now() + at * 1000
    const dur = 700
    const tick = (now) => {
      if (now < start) { raf = requestAnimationFrame(tick); return }
      const t = Math.min(1, (now - start) / dur)
      // Ease out, so it lands rather than stops.
      setN(Math.round(to * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, at])

  return <span className={className}>{n}</span>
}

/**
 * Confetti, drawn rather than shipped.
 *
 * The whole app carries no asset — the sounds are synthesised, there is not one
 * image. A canvas keeps that true, and costs less than the animated DOM nodes
 * it replaces.
 */
function Confetti() {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)

    const size = () => {
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    window.addEventListener('resize', size)

    const colours = ['#7c5cff', '#4dd8ff', '#34d399', '#fbbf24', '#fb7185', '#e879f9']
    const bits = Array.from({ length: 90 }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: -20 - Math.random() * canvas.offsetHeight,
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      vy: 40 + Math.random() * 90,
      vx: -20 + Math.random() * 40,
      spin: -3 + Math.random() * 6,
      a: Math.random() * Math.PI,
      c: colours[Math.floor(Math.random() * colours.length)],
    }))

    let raf = null
    let last = performance.now()
    const started = last

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)

      // Fades out rather than looping: confetti that never lands stops reading
      // as celebration and starts reading as a broken page.
      const life = Math.max(0, 1 - (now - started) / 9000)
      if (life === 0) return

      ctx.globalAlpha = life
      for (const b of bits) {
        b.y += b.vy * dt
        b.x += b.vx * dt
        b.a += b.spin * dt
        if (b.y > canvas.offsetHeight + 20) b.y = -20

        ctx.save()
        ctx.translate(b.x, b.y)
        ctx.rotate(b.a)
        ctx.fillStyle = b.c
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h)
        ctx.restore()
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', size)
    }
  }, [])

  return <canvas ref={ref} className="confetti" aria-hidden="true" />
}
