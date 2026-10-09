// Nosso Caixa · service worker
// Tela: rede primeiro (pega versão nova), cai no cache se estiver sem internet.
// Arquivos estáticos (ícones, bibliotecas): cache primeiro. Dados do Supabase nunca passam pelo cache.
const VERSAO = 'nc-1791511887'
const BASICO = ['/', '/index.html', '/supa.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(BASICO)).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url)
  if (req.method !== 'GET' || url.hostname.endsWith('supabase.co') || url.hostname.includes('pluggy')) return
  const navegacao = req.mode === 'navigate' || (url.origin === location.origin && (url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('supa.js')))
  if (navegacao) {
    e.respondWith(fetch(req).then((r) => { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); return r }).catch(() => caches.match(req).then((r) => r || caches.match('/'))))
    return
  }
  if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|cdn\.pluggy\.ai/.test(url.hostname) || url.origin === location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok || r.type === 'opaque') { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)) } return r })))
  }
})
