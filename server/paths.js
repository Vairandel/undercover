import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Where mutable state lives.
 *
 * Overridable through `UNDERCOVER_DATA_DIR` for one blunt reason: the test
 * suites boot the *real* server, so every simulated game was drawing real word
 * pairs and stamping them "already played" in the household's own history.
 * Hundreds of pairs ended up burnt by robots that nobody at the table ever saw.
 *
 * Tests and simulations now point this somewhere disposable. The shipped word
 * files are read-only and stay where they are, next to the code.
 */
export const dataDir = process.env.UNDERCOVER_DATA_DIR
  ? path.resolve(process.env.UNDERCOVER_DATA_DIR)
  : path.join(here, 'data')

/** The bundled themes — never written to, so never redirected. */
export const wordsDir = path.join(here, 'data', 'words')

export const statePath = path.join(dataDir, 'state.json')
export const customWordsPath = path.join(dataDir, 'custom-words.json')

/** True when we are not running against the household's real data. */
export const isScratchData = Boolean(process.env.UNDERCOVER_DATA_DIR)
