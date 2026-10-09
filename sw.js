// ateofin (Nosso Caixa) · service worker
// Tela: rede primeiro (pega versão nova), cai no cache se estiver sem internet.
// Arquivos estáticos (ícones, bibliotecas): cache primeiro. Dados do Supabase nunca passam pelo cache.
const VERSAO = 'nc-1791515433'
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

// ── Notificações (Web Push) ──
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { corpo: e.data && e.data.text() } }
  // com o app aberto, avisa a tela para tocar o som do tipo (moeda para gasto, aviso para lembrete)
  self.clients.matchAll({ type: 'window' }).then((ws) => ws.forEach((w) => w.postMessage({ nc: 'push', tipo: d.tipo || 'lembrete' })))
  e.waitUntil(self.registration.showNotification(d.titulo || 'ateofin', {
    body: d.corpo || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag || undefined, data: { url: d.url || '/' },
  }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    const w = ws.find((x) => x.url.startsWith(self.location.origin))
    if (w) { w.focus(); return w.navigate(url) }
    return self.clients.openWindow(url)
  }))
})
