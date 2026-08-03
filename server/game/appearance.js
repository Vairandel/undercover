/**
 * Avatar palette, shared with the client through `/api/info` so both sides
 * agree on what is selectable. The server is still the authority: it rejects
 * anything outside these lists rather than trusting what a phone sends.
 */

export const AVATARS = [
  '🦊', '🐼', '🦁', '🐸', '🐙', '🦉', '🐺', '🦄',
  '🐝', '🦋', '🐳', '🦖', '🐨', '🦩', '🐢', '🦔',
  '🐯', '🐷', '🐵', '🐰', '🐻', '🐧', '🦅', '🦇',
  '🐊', '🦑', '🦂', '🐴', '🦓', '🦌', '🐘', '🦏',
  '🍕', '🍔', '🌮', '🍩', '🍄', '🌶️', '🍉', '🥑',
  '👽', '🤖', '👻', '🎃', '💀', '🧊', '⚡', '🔮',
]

export const COLORS = [
  '#7c5cff', '#4dd8ff', '#34d399', '#fbbf24',
  '#fb7185', '#f43f5e', '#a78bfa', '#38bdf8',
  '#f97316', '#ec4899',
]

export function isValidAvatar(a) {
  return AVATARS.includes(a)
}

export function isValidColor(c) {
  return COLORS.includes(c)
}

/** First avatar nobody in the room is using, or a fallback if all are taken. */
export function freeAvatar(taken, preferred = null) {
  if (preferred && isValidAvatar(preferred) && !taken.has(preferred)) return preferred
  return AVATARS.find((a) => !taken.has(a)) ?? '🎭'
}

export function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}
