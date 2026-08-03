import { useEffect, useState } from 'react'
import HostApp from './host/HostApp.jsx'
import PlayerApp from './player/PlayerApp.jsx'
import { unlock } from './audio.js'

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Browsers block audio until the user has interacted with the page at least
  // once. Any first tap anywhere counts, so we listen globally and once only.
  useEffect(() => {
    const arm = () => unlock()
    window.addEventListener('pointerdown', arm, { once: true })
    window.addEventListener('keydown', arm, { once: true })
    return () => {
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('keydown', arm)
    }
  }, [])

  return path.startsWith('/host') ? <HostApp /> : <PlayerApp />
}
