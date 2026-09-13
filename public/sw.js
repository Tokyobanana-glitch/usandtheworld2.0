// Minimal app-shell service worker. Deliberately narrow in scope: it exists
// to make the app installable and load its own shell (HTML/JS/CSS/icons)
// when offline or on a flaky connection — it must NEVER cache anything under
// /api/, and never anything served by api/trip-page.js or
// api/explore-page.js either, since those responses carry live trip data
// (and, for a trip page, the OG/meta injection for that exact slug) baked
// directly into the HTML. Caching those would mean showing a stale trip —
// exactly what this product exists to avoid. Only the root document ("/")
// and same-origin static assets (the hashed JS/CSS bundles, icons, fonts,
// manifest) are ever cached.
const CACHE_NAME = 'uatw-shell-v1'
const SHELL_URLS = ['/', '/manifest.json', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

function isApiRequest(url) {
  return url.pathname.startsWith('/api/')
}

// Only the bare root is treated as the cacheable "app shell" document. Every
// other navigable path (/trips, /explore, /trip/:slug, /sitemap.xml) either
// carries server-injected live data or is reached via client-side routing
// once the shell is already loaded — caching them here risks freezing a
// snapshot of a page whose whole point is staying current.
function isShellDocument(url) {
  return url.pathname === '/'
}

function isStaticAsset(request) {
  return ['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isApiRequest(url)) return // never intercept or cache API responses — trip data must stay live

  if (isShellDocument(url)) {
    // Network-first: an online visitor always gets the latest shell: the
    // cache only ever serves as an offline fallback.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() => caches.match(request)),
    )
    return
  }

  if (isStaticAsset(request)) {
    // Cache-first for hashed build assets: the filename itself changes on
    // every new deploy, so a cached entry is never stale by definition.
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
            return response
          }),
      ),
    )
  }
})
