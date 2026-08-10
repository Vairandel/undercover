/**
 * Avatar palette, shared with the client through `/api/info` so both sides
 * agree on what is selectable. The server is still the authority: it rejects
 * anything outside these lists rather than trusting what a phone sends.
 *
 * Grouped into families because a flat wall of a hundred emoji is worse to
 * choose from than a short list — you scroll past the one you wanted twice.
 * The order is the order they appear in the picker.
 *
 * Deliberately conservative on which emoji are used: nothing newer than
 * Unicode 13, so an older Android does not render half the grid as tofu boxes.
 */
export const AVATAR_GROUPS = [
  {
    id: 'animals',
    label: 'Animaux',
    avatars: [
      '🦊', '🐼', '🦁', '🐺', '🐨', '🐯', '🐷', '🐵',
      '🐰', '🐻', '🦔', '🐴', '🦓', '🦌', '🐘', '🦏',
    ],
  },
  {
    id: 'water',
    label: 'Mer et bestioles',
    avatars: [
      '🐸', '🐙', '🐝', '🦋', '🐳', '🐢', '🦑', '🦂',
      '🐊', '🐬', '🦀', '🦈', '🐠', '🐡', '🦞', '🐌',
    ],
  },
  {
    id: 'birds',
    label: 'Oiseaux',
    avatars: ['🦉', '🦩', '🐧', '🦅', '🦇', '🦆', '🦜', '🦚'],
  },
  {
    id: 'legends',
    label: 'Créatures',
    avatars: ['🦄', '🦖', '🐉', '🦕', '🧜', '🧚', '🧞', '🧙'],
  },
  {
    id: 'space',
    label: 'Ailleurs',
    avatars: ['👽', '🤖', '👻', '🎃', '💀', '🔮', '🛸', '🌙', '⭐', '⚡', '🌈', '🧊'],
  },
  {
    id: 'food',
    label: 'À manger',
    avatars: [
      '🍕', '🍔', '🌮', '🍩', '🍄', '🌶️', '🍉', '🥑',
      '🍒', '🍓', '🍿', '🧁', '🍦', '🥐', '🍪', '🍋',
    ],
  },
  {
    id: 'things',
    label: 'Objets',
    avatars: ['🎩', '👑', '💎', '🎸', '🎺', '🚀', '⚽', '🎲', '🃏', '🔥', '🌵', '🧩'],
  },
  {
    id: 'faces',
    label: 'Têtes',
    avatars: ['😎', '🤠', '🥸', '🤡', '😈', '🤓', '🥶', '🤯'],
  },
]

export const AVATARS = AVATAR_GROUPS.flatMap((g) => g.avatars)

/**
 * Every colour has to stay legible on the near-black background *and* be
 * distinguishable from its neighbours across a room — these are read as a thin
 * border on a chip from two metres away, not as a filled square.
 */
export const COLORS = [
  '#7c5cff', '#a78bfa', '#c084fc', '#e879f9',
  '#4dd8ff', '#38bdf8', '#22d3ee', '#34d399',
  '#4ade80', '#a3e635', '#facc15', '#fbbf24',
  '#f97316', '#fb923c', '#fb7185', '#f43f5e',
  '#ec4899', '#94a3b8',
]

export function isValidAvatar(a) {
  return AVATARS.includes(a)
}

export function isValidColor(c) {
  return COLORS.includes(c)
}

/**
 * First avatar nobody in the room is using, or a fallback if all are taken.
 *
 * The fallback is deliberately not in the list: reaching it would need more
 * people than the room can hold, and if that ever happens it should be
 * visibly an oddity rather than a silent duplicate.
 */
export function freeAvatar(taken, preferred = null) {
  if (preferred && isValidAvatar(preferred) && !taken.has(preferred)) return preferred
  return AVATARS.find((a) => !taken.has(a)) ?? '🎭'
}

export function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}
