/**
 * Procedural sound engine.
 *
 * Every sound is synthesised with oscillators and noise buffers at play time —
 * there are no audio files to ship, nothing to download, and the whole thing
 * works with the machine offline, which is the point of a LAN party game.
 *
 * Signal path:  voices → [dry] ┐
 *                       → [send] → convolver → wet ┴→ master → limiter → out
 *
 * Browsers refuse to start an AudioContext before a user gesture, so `unlock()`
 * is wired to the first tap and everything is a no-op until then.
 */

let ctx = null
let master = null
let dry = null
let wet = null
let send = null
let enabled = true
let unlocked = false
let ambience = null

function ensure() {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null

  ctx = new AC()

  master = ctx.createGain()
  // Honour the level chosen before the context existed (it is created lazily,
  // on the first user gesture).
  master.gain.value = getVolume().gain

  // A gentle compressor stops layered chords from clipping on phone speakers,
  // which is where most of this will actually be heard.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -10
  limiter.knee.value = 12
  limiter.ratio.value = 8
  limiter.attack.value = 0.003
  limiter.release.value = 0.2

  const reverb = ctx.createConvolver()
  reverb.buffer = impulseResponse(2.4, 2.6)

  dry = ctx.createGain()
  dry.gain.value = 1

  send = ctx.createGain()
  send.gain.value = 0.28

  wet = ctx.createGain()
  wet.gain.value = 0.9

  dry.connect(master)
  send.connect(reverb).connect(wet).connect(master)
  master.connect(limiter).connect(ctx.destination)

  return ctx
}

/** Exponentially-decaying stereo noise — a cheap but convincing room. */
function impulseResponse(seconds, decay) {
  const rate = ctx.sampleRate
  const length = Math.floor(rate * seconds)
  const buffer = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay
    }
  }
  return buffer
}

export function unlock() {
  const c = ensure()
  if (!c) return
  if (c.state === 'suspended') c.resume()
  unlocked = true
}

/**
 * Volume as three steps rather than a slider.
 *
 * A party game gets its sound set once, in a hurry, by someone holding a drink.
 * Three taps through "fort → discret → coupé" is faster than aiming at a
 * slider, and the choice survives a reload.
 */
export const VOLUME_STEPS = [
  { id: 'full', label: 'Son fort', icon: '🔊', gain: 0.55 },
  { id: 'low', label: 'Son discret', icon: '🔉', gain: 0.22 },
  { id: 'off', label: 'Son coupé', icon: '🔇', gain: 0 },
]

const VOLUME_KEY = 'undercover.volume'
let volumeId = 'full'

try {
  const saved = localStorage.getItem(VOLUME_KEY)
  if (saved && VOLUME_STEPS.some((s) => s.id === saved)) volumeId = saved
} catch { /* private browsing */ }

enabled = volumeId !== 'off'

function applyVolume() {
  const step = VOLUME_STEPS.find((s) => s.id === volumeId) ?? VOLUME_STEPS[0]
  enabled = step.gain > 0
  if (master) master.gain.value = step.gain
  if (!enabled) stopAmbience()
  try { localStorage.setItem(VOLUME_KEY, volumeId) } catch { /* private browsing */ }
}

export function getVolume() {
  return VOLUME_STEPS.find((s) => s.id === volumeId) ?? VOLUME_STEPS[0]
}

/** Steps to the next level and returns it, for a single cycling button. */
export function cycleVolume() {
  const i = VOLUME_STEPS.findIndex((s) => s.id === volumeId)
  volumeId = VOLUME_STEPS[(i + 1) % VOLUME_STEPS.length].id
  applyVolume()
  return getVolume()
}

export function setEnabled(v) {
  volumeId = v ? 'full' : 'off'
  applyVolume()
}

export function isEnabled() {
  return enabled
}

function bus(reverbAmount = 1) {
  const g = ctx.createGain()
  g.connect(dry)
  if (reverbAmount > 0) {
    const s = ctx.createGain()
    s.gain.value = reverbAmount
    g.connect(s).connect(send)
  }
  return g
}

/** One shaped oscillator note. */
function tone({
  freq,
  dur = 0.2,
  type = 'sine',
  gain = 0.3,
  at = 0,
  sweep = null,
  detune = 0,
  reverb = 1,
  attack = 0.012,
}) {
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const g = ctx.createGain()

  osc.type = type
  osc.detune.value = detune
  osc.frequency.setValueAtTime(freq, t)
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t + dur)

  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)

  osc.connect(g).connect(bus(reverb))
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

/** Two detuned oscillators — thicker and more "produced" than a single one. */
function fat({ freq, detune = 9, ...rest }) {
  tone({ freq, detune: -detune, ...rest })
  tone({ freq, detune, ...rest, gain: (rest.gain ?? 0.3) * 0.75 })
}

/** Filtered noise burst — impacts, whooshes, breath. */
function noise({ dur = 0.3, at = 0, gain = 0.2, from = 2000, to = 200, q = 1, reverb = 1, type = 'bandpass' }) {
  const t = ctx.currentTime + at
  const frames = Math.max(1, Math.ceil(ctx.sampleRate * dur))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1

  const src = ctx.createBufferSource()
  src.buffer = buffer

  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.Q.value = q
  filter.frequency.setValueAtTime(from, t)
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur)

  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)

  src.connect(filter).connect(g).connect(bus(reverb))
  src.start(t)
  src.stop(t + dur)
}

function chord(freqs, opts = {}) {
  freqs.forEach((f, i) => tone({ freq: f, ...opts, at: (opts.at ?? 0) + (opts.stagger ?? 0) * i }))
}

function arp(freqs, { step = 0.075, ...opts } = {}) {
  freqs.forEach((f, i) => tone({ freq: f, ...opts, at: (opts.at ?? 0) + step * i }))
}

// ---------------------------------------------------------------- ambience

/**
 * Sustained beds that run under a whole phase and stop cleanly.
 * Only one can play at a time; starting the same one twice is a no-op.
 */
const AMBIENCES = {
  /** Voting: a slow low pulse plus a barely-there high shimmer. */
  vote() {
    const nodes = []
    const base = ctx.createGain()
    base.gain.value = 0
    base.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 1.2)
    base.connect(bus(0.6))

    for (const f of [55, 82.5]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      const filt = ctx.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = 220
      o.connect(filt).connect(base)
      o.start()
      nodes.push(o)
    }

    // Heartbeat-ish LFO on the amplitude.
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.frequency.value = 0.9
    lfoGain.gain.value = 0.05
    lfo.connect(lfoGain).connect(base.gain)
    lfo.start()
    nodes.push(lfo)

    return { nodes, gain: base }
  },

  /** Open discussion: a warm, low room tone that does not demand attention. */
  discuss() {
    const nodes = []
    const out = ctx.createGain()
    out.gain.value = 0
    out.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 1.5)
    out.connect(bus(0.8))

    for (const [f, type] of [[98, 'sine'], [147, 'sine'], [196, 'triangle']]) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.value = 0.4
      const filt = ctx.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = 500
      o.connect(g).connect(filt).connect(out)
      o.start()
      nodes.push(o)
    }

    // Very slow drift so it never sits perfectly still.
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.frequency.value = 0.07
    lfoGain.gain.value = 0.02
    lfo.connect(lfoGain).connect(out.gain)
    lfo.start()
    nodes.push(lfo)

    return { nodes, gain: out }
  },

  /** Mister White's last chance: an actual heartbeat, getting no calmer. */
  suspense() {
    const nodes = []
    const out = ctx.createGain()
    out.gain.value = 0.0001
    out.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.6)
    out.connect(bus(0.5))

    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = 48
    const vca = ctx.createGain()
    vca.gain.value = 0
    o.connect(vca).connect(out)
    o.start()
    nodes.push(o)

    // Two thumps per beat, ~66 bpm — lub-dub.
    const beat = 0.9
    let t = ctx.currentTime + 0.2
    const stop = ctx.currentTime + 120
    while (t < stop) {
      for (const [offset, amp] of [[0, 0.9], [0.22, 0.55]]) {
        vca.gain.setValueAtTime(0.0001, t + offset)
        vca.gain.exponentialRampToValueAtTime(amp, t + offset + 0.02)
        vca.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.2)
      }
      t += beat
    }

    return { nodes, gain: out }
  },
}

export function startAmbience(name) {
  if (!enabled || !unlocked) return
  const c = ensure()
  if (!c) return
  if (ambience?.name === name) return
  stopAmbience()
  try {
    const built = AMBIENCES[name]?.()
    if (built) ambience = { name, ...built }
  } catch {
    /* ambience is decoration; never let it break the game */
  }
}

export function stopAmbience() {
  if (!ambience) return
  const { nodes, gain } = ambience
  ambience = null
  try {
    const t = ctx.currentTime
    gain.gain.cancelScheduledValues(t)
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
    for (const n of nodes) n.stop(t + 0.55)
  } catch {
    /* already stopped */
  }
}

// ------------------------------------------------------------------ sounds

const SOUNDS = {
  tap: () => tone({ freq: 660, dur: 0.06, type: 'triangle', gain: 0.12, reverb: 0.2 }),

  select: () => {
    tone({ freq: 880, dur: 0.07, type: 'triangle', gain: 0.14, reverb: 0.3 })
    tone({ freq: 1320, dur: 0.1, type: 'sine', gain: 0.1, at: 0.05, reverb: 0.4 })
  },

  join: () => {
    tone({ freq: 523, dur: 0.12, type: 'triangle', gain: 0.18 })
    tone({ freq: 784, dur: 0.16, type: 'triangle', gain: 0.16, at: 0.07 })
    tone({ freq: 1046, dur: 0.2, type: 'sine', gain: 0.1, at: 0.14 })
  },

  leave: () => {
    tone({ freq: 660, dur: 0.14, type: 'triangle', gain: 0.14, sweep: 440 })
    tone({ freq: 440, dur: 0.24, type: 'triangle', gain: 0.12, at: 0.1, sweep: 294 })
  },

  /** Game starting — a held breath, then the drop. */
  start: () => {
    noise({ dur: 1.1, gain: 0.1, from: 400, to: 4500, q: 0.7 })
    fat({ freq: 196, dur: 1.4, type: 'sawtooth', gain: 0.09, sweep: 98 })
    chord([294, 349, 440], { dur: 1.0, type: 'triangle', gain: 0.1, stagger: 0.07, at: 0.75 })
    noise({ dur: 0.7, gain: 0.24, from: 2200, to: 60, q: 0.5, at: 0.8 })
  },

  /** The word card flips over. */
  reveal: () => {
    noise({ dur: 0.28, gain: 0.1, from: 700, to: 5000, q: 0.6, reverb: 0.5 })
    tone({ freq: 880, dur: 0.3, type: 'sine', gain: 0.18, sweep: 1320 })
    tone({ freq: 1760, dur: 0.5, type: 'sine', gain: 0.07, at: 0.1 })
  },

  /** Reveal stings, one per camp — heard once, right after the card flips. */
  stingCivilian: () => chord([523, 659, 784], { dur: 1.1, type: 'triangle', gain: 0.1, stagger: 0.05, at: 0.12 }),

  stingUndercover: () => {
    fat({ freq: 220, dur: 1.3, type: 'sawtooth', gain: 0.1, at: 0.12, sweep: 185 })
    tone({ freq: 466, dur: 0.9, type: 'triangle', gain: 0.08, at: 0.2 })
  },

  stingWhite: () => {
    arp([784, 932, 1109, 1245], { step: 0.06, dur: 0.4, type: 'square', gain: 0.07, at: 0.12 })
  },

  stingSpecial: () => {
    chord([392, 587, 880], { dur: 1.2, type: 'sine', gain: 0.1, stagger: 0.08, at: 0.12 })
    tone({ freq: 1760, dur: 0.6, type: 'triangle', gain: 0.05, at: 0.34 })
  },

  /** Your turn to speak. */
  turn: () => {
    tone({ freq: 740, dur: 0.13, type: 'triangle', gain: 0.22, reverb: 0.5 })
    tone({ freq: 988, dur: 0.22, type: 'triangle', gain: 0.2, at: 0.1 })
    tone({ freq: 1480, dur: 0.3, type: 'sine', gain: 0.08, at: 0.18 })
  },

  clue: () => {
    tone({ freq: 1046, dur: 0.1, type: 'sine', gain: 0.14, reverb: 0.6 })
    tone({ freq: 1568, dur: 0.14, type: 'sine', gain: 0.06, at: 0.05 })
  },

  /** A clue was rejected by the rules. */
  rejected: () => {
    tone({ freq: 311, dur: 0.12, type: 'square', gain: 0.15, reverb: 0.3 })
    tone({ freq: 233, dur: 0.2, type: 'square', gain: 0.15, at: 0.09 })
    noise({ dur: 0.2, gain: 0.06, from: 900, to: 200, at: 0.02 })
  },

  vote: () => {
    fat({ freq: 110, dur: 1.0, type: 'sawtooth', gain: 0.09 })
    tone({ freq: 440, dur: 0.35, type: 'square', gain: 0.1, at: 0.15, sweep: 330 })
    noise({ dur: 0.5, gain: 0.08, from: 3000, to: 400, at: 0.05 })
  },

  voteCast: () => {
    tone({ freq: 392, dur: 0.1, type: 'square', gain: 0.13, reverb: 0.4 })
    noise({ dur: 0.09, gain: 0.07, from: 1600, to: 700, q: 2 })
  },

  /** Someone is voted out. */
  eliminate: () => {
    noise({ dur: 0.7, gain: 0.22, from: 1800, to: 80, q: 0.8 })
    chord([220, 175, 131], { dur: 0.9, type: 'sawtooth', gain: 0.12, stagger: 0.05, sweep: 70 })
    tone({ freq: 65, dur: 1.2, type: 'sine', gain: 0.16, at: 0.05 })
  },

  /** The Justicier executes someone. */
  execute: () => {
    noise({ dur: 0.14, gain: 0.3, from: 6000, to: 900, q: 0.4 })
    tone({ freq: 1400, dur: 0.1, type: 'square', gain: 0.14, sweep: 300 })
    tone({ freq: 55, dur: 1.4, type: 'sine', gain: 0.2, at: 0.04 })
    noise({ dur: 1.0, gain: 0.1, from: 1200, to: 60, at: 0.05 })
  },

  /** A lover dies of grief. */
  grief: () => {
    tone({ freq: 587, dur: 1.4, type: 'sine', gain: 0.12, sweep: 294 })
    tone({ freq: 440, dur: 1.6, type: 'sine', gain: 0.09, at: 0.15, sweep: 220 })
  },

  tie: () => {
    tone({ freq: 330, dur: 0.2, type: 'square', gain: 0.14 })
    tone({ freq: 311, dur: 0.34, type: 'square', gain: 0.14, at: 0.17 })
  },

  whiteGuess: () => {
    tone({ freq: 1174, dur: 0.6, type: 'sine', gain: 0.12, sweep: 587 })
    noise({ dur: 0.9, gain: 0.06, from: 5000, to: 700, q: 3 })
  },

  /** Civilians win — bright, resolved. */
  winCivilian: () => {
    chord([523, 659, 784, 1046], { dur: 1.6, type: 'triangle', gain: 0.15, stagger: 0.08 })
    arp([1046, 1318, 1568, 2093], { step: 0.09, dur: 0.7, type: 'sine', gain: 0.09, at: 0.4 })
    noise({ dur: 1.2, gain: 0.05, from: 6000, to: 2000 })
  },

  /** Impostors win — minor, smug, a little cruel. */
  winUndercover: () => {
    chord([440, 523, 659, 880], { dur: 1.8, type: 'sawtooth', gain: 0.1, stagger: 0.09 })
    arp([880, 1046, 1318], { step: 0.11, dur: 0.6, type: 'triangle', gain: 0.08, at: 0.5 })
    fat({ freq: 110, dur: 2.0, type: 'sawtooth', gain: 0.07 })
  },

  /** Mister White wins alone — the funniest outcome gets the silliest sound. */
  winWhite: () => {
    arp([523, 587, 659, 784, 880, 1046, 1318], { step: 0.075, dur: 0.22, type: 'square', gain: 0.12 })
    tone({ freq: 1318, dur: 1.2, type: 'triangle', gain: 0.16, at: 0.55 })
    chord([659, 831, 988], { dur: 1.4, type: 'triangle', gain: 0.08, at: 0.6, stagger: 0.05 })
  },

  /** The Bouffon's bet paid off — fired when his row lands on the scoreboard. */
  bouffonPaid: () => {
    arp([392, 494, 587, 494, 392, 494, 587, 740], { step: 0.1, dur: 0.24, type: 'square', gain: 0.12 })
    noise({ dur: 0.8, gain: 0.07, from: 3000, to: 800, at: 0.7 })
    tone({ freq: 880, dur: 1.0, type: 'triangle', gain: 0.13, at: 0.8 })
  },

  /** The lovers made it to the end together. */
  winLovers: () => {
    chord([392, 494, 587, 784], { dur: 2.0, type: 'sine', gain: 0.13, stagger: 0.12 })
    arp([1175, 1568, 1976], { step: 0.14, dur: 1.0, type: 'sine', gain: 0.08, at: 0.6 })
  },

  /** Discussion opens — a bell that says "the floor is yours". */
  discuss: () => {
    tone({ freq: 523, dur: 1.2, type: 'sine', gain: 0.14 })
    tone({ freq: 784, dur: 1.0, type: 'sine', gain: 0.08, at: 0.06 })
    noise({ dur: 0.5, gain: 0.05, from: 4000, to: 900 })
  },

  /** The vote deadlocked and someone secretly holds the casting decision. */
  tiebreak: () => {
    fat({ freq: 146, dur: 1.4, type: 'sawtooth', gain: 0.1 })
    tone({ freq: 622, dur: 0.5, type: 'triangle', gain: 0.13, at: 0.2 })
    tone({ freq: 415, dur: 0.9, type: 'triangle', gain: 0.11, at: 0.45 })
    noise({ dur: 1.0, gain: 0.06, from: 3000, to: 300, at: 0.1 })
  },

  /** The arbiter has chosen. */
  gavel: () => {
    noise({ dur: 0.1, gain: 0.28, from: 3500, to: 500, q: 0.5 })
    tone({ freq: 180, dur: 0.5, type: 'sine', gain: 0.2, sweep: 90 })
    tone({ freq: 90, dur: 0.9, type: 'sine', gain: 0.14, at: 0.03 })
  },

  /** One row of the final scoreboard sliding in. */
  scoreRow: () => {
    tone({ freq: 880, dur: 0.09, type: 'triangle', gain: 0.1, reverb: 0.4 })
    tone({ freq: 1320, dur: 0.12, type: 'sine', gain: 0.06, at: 0.04 })
  },

  /** The leader's row landing at the top. */
  scoreTop: () => {
    arp([784, 988, 1175, 1568], { step: 0.06, dur: 0.4, type: 'triangle', gain: 0.11 })
  },

  tick: () => tone({ freq: 1200, dur: 0.04, type: 'square', gain: 0.09, reverb: 0.15 }),

  tickUrgent: () => {
    tone({ freq: 1600, dur: 0.05, type: 'square', gain: 0.13, reverb: 0.2 })
    tone({ freq: 800, dur: 0.05, type: 'square', gain: 0.08 })
  },

  error: () => {
    tone({ freq: 220, dur: 0.15, type: 'square', gain: 0.16, reverb: 0.3 })
    tone({ freq: 165, dur: 0.24, type: 'square', gain: 0.16, at: 0.1 })
  },
}

export function play(name) {
  if (!enabled || !unlocked) return
  const c = ensure()
  if (!c) return
  if (c.state === 'suspended') c.resume()
  try {
    SOUNDS[name]?.()
  } catch {
    /* an audio glitch must never break the game */
  }
}

/** The sting that plays right after a player uncovers their card. */
export function playRoleSting(roleId) {
  if (roleId === 'undercover') return play('stingUndercover')
  if (roleId === 'mrwhite') return play('stingWhite')
  if (roleId === 'civilian') return play('stingCivilian')
  return play('stingSpecial')
}

const WIN_SOUND = {
  civilian: 'winCivilian',
  undercover: 'winUndercover',
  mrwhite: 'winWhite',
  // No 'bouffon' entry: he is a modifier on a normal role now, so he never
  // wins a camp — he scores. His moment is the scoreboard, not the fanfare.
  lovers: 'winLovers',
}

/** Maps a server `event` to its sound. Kept here so screens stay declarative. */
export function playForEvent(event) {
  switch (event?.type) {
    case 'playerJoined': return play('join')
    case 'playerLeft': return play('leave')
    case 'gameStarted': return play('start')
    case 'roundStarted': return play('turn')
    case 'clueGiven': return play('clue')
    case 'discussStarted': return play('discuss')
    case 'chat': return play('clue')
    case 'voteStarted': return play('vote')
    case 'voteCast': return play('voteCast')
    case 'voteTie': return play('tie')
    case 'tiebreakStarted': return play('tiebreak')
    case 'tiebreakResolved': return play('gavel')
    case 'revengeStarted': return play('tiebreak')
    case 'revengeResolved': return play('execute')
    case 'playerKicked': return play('leave')
    case 'eliminated':
      if (event.cause === 'grief') return play('grief')
      // The gavel and the revenge blow already fired their own sound.
      if (event.cause === 'tiebreak' || event.cause === 'revenge') return undefined
      return play('eliminate')
    case 'whiteGuessRight': return play('winWhite')
    case 'whiteGuessWrong': return play('error')
    case 'timeout': return play('error')
    case 'gameOver':
      stopAmbience()
      return play(WIN_SOUND[event.team] ?? 'winCivilian')
    default:
      return undefined
  }
}

/** Phase-driven background beds. Call on every phase change. */
export function ambienceForPhase(phase) {
  if (phase === 'discuss') return startAmbience('discuss')
  if (phase === 'vote') return startAmbience('vote')
  if (phase === 'tiebreak' || phase === 'revenge' || phase === 'mrwhiteGuess') {
    return startAmbience('suspense')
  }
  return stopAmbience()
}
