import { useCallback, useEffect, useState } from 'react'

// Chrome/Edge/Android fire beforeinstallprompt and let a page trigger the
// install UI programmatically; iOS Safari has no such API at all (its own
// "Add to Home Screen" lives in the share sheet, nothing a page can
// trigger), so canInstall simply stays false there — the Profile row this
// feeds just never renders, which is the "where the browser supports it"
// behavior asked for, with no browser-sniffing needed.
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installed, setInstalled] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
  )

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault()
      setDeferredPrompt(event)
    }
    function handleAppInstalled() {
      setInstalled(true)
      setDeferredPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }, [deferredPrompt])

  return { canInstall: !!deferredPrompt && !installed, promptInstall }
}
