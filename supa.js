// Nosso Caixa · ponte entre a página e o Supabase.
// A página foi escrita sobre `window.claude.use(nome)` (db, user, sample, assets, downloads).
// Aqui a mesma interface é atendida pelo Supabase: login por e-mail, documentos com Realtime,
// arquivos no Storage e o copiloto numa Edge Function (OpenRouter).
;(function () {
  const URL = 'https://iatjrfrwngkltnxmaugf.supabase.co'
  const KEY = 'sb_publishable_AG1_7NBEbO8W-415lX-ReA_nSO1iD7S'
  const sb = window.supabase.createClient(URL, KEY, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'implicit' } })
  window.sb = sb

  let casa = null, pessoa = null, uid = null
  const pronto = (async () => {
    const { data } = await sb.auth.getSession()
    if (!data.session) return false
    uid = data.session.user.id
    const { data: m } = await sb.from('membros').select('casa_id, pessoa').eq('user_id', uid).maybeSingle()
    if (!m) return 'sem-convite'
    casa = m.casa_id; pessoa = m.pessoa
    return true
  })()

  // ── documentos ────────────────────────────────────────────────────────────
  const cache = {}        // colecao -> Map(id -> data)
  const ouvintes = {}     // colecao -> Set(fn)
  const ouvDoc = {}       // 'colecao/id' -> Set(fn)
  let canal = null
  const snapQ = (col) => { const docs = [...(cache[col] || new Map()).entries()].map(([id, d]) => ({ id, exists: true, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } })); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } } }
  const snapD = (col, id) => { const d = cache[col]?.get(id); return { id, exists: !!d, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } } }
  const avisa = (col, id) => { ouvintes[col]?.forEach((f) => f(snapQ(col))); if (id) ouvDoc[`${col}/${id}`]?.forEach((f) => f(snapD(col, id))) }
  const carregados = {}
  async function carrega(col) {
    if (carregados[col]) return carregados[col]
    carregados[col] = (async () => {
      const { data, error } = await sb.from('docs').select('id, data').eq('casa_id', casa).eq('colecao', col)
      if (error) throw error
      cache[col] = new Map(data.map((r) => [r.id, r.data]))
      ligaCanal()
    })()
    return carregados[col]
  }
  function ligaCanal() {
    if (canal) return
    canal = sb.channel('docs-' + casa).on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: `casa_id=eq.${casa}` }, (p) => {
      const r = p.new && Object.keys(p.new).length ? p.new : p.old
      const col = r.colecao, id = r.id
      if (!cache[col]) return
      if (p.eventType === 'DELETE') cache[col].delete(id); else cache[col].set(id, p.new.data)
      avisa(col, id)
    }).subscribe()
  }
  // aplica já no cache local (a confirmação chega pelo Realtime)
  const local = (col, id, d) => { if (!cache[col]) return; d === null ? cache[col].delete(id) : cache[col].set(id, d); avisa(col, id) }
  const novoId = () => crypto.randomUUID().replace(/-/g, '')
  function docRef(col, id) {
    return {
      id, path: `${col}/${id}`,
      async get() { await carrega(col); return snapD(col, id) },
      async set(data) { const { error } = await sb.from('docs').upsert({ casa_id: casa, colecao: col, id, data }); if (error) throw err(error); local(col, id, data) },
      async update(patch) {
        await carrega(col)
        const atual = cache[col].get(id) || {}
        const novo = { ...atual }; for (const [k, v] of Object.entries(patch)) { if (v && v.__delete__) delete novo[k]; else novo[k] = v }
        const { error } = await sb.from('docs').upsert({ casa_id: casa, colecao: col, id, data: novo }); if (error) throw err(error); local(col, id, novo)
      },
      async delete() { const { error } = await sb.from('docs').delete().match({ casa_id: casa, colecao: col, id }); if (error) throw err(error); local(col, id, null) },
      onSnapshot(next, onErr) { const k = `${col}/${id}`; (ouvDoc[k] = ouvDoc[k] || new Set()).add(next); carrega(col).then(() => next(snapD(col, id))).catch((e) => onErr?.(err(e))); return () => ouvDoc[k].delete(next) },
    }
  }
  function colRef(col) {
    return {
      path: col,
      doc: (id) => docRef(col, id || novoId()),
      async add(data) { const r = docRef(col, novoId()); await r.set(data); return r },
      async get() { await carrega(col); return snapQ(col) },
      onSnapshot(next, onErr) { (ouvintes[col] = ouvintes[col] || new Set()).add(next); carrega(col).then(() => next(snapQ(col))).catch((e) => onErr?.(err(e))); return () => ouvintes[col].delete(next) },
      where() { return this }, orderBy() { return this }, limit() { return this },
    }
  }
  const err = (e) => ({ code: /permission|policy|RLS/i.test(e?.message || '') ? 'not_granted' : 'unavailable', message: e?.message || String(e) })
  const db = { doc: (path) => { const [c, i] = path.split('/'); return docRef(c, i) }, collection: (c) => colRef(c) }

  // ── copiloto (Edge Function → OpenRouter) ────────────────────────────────
  async function chamaCopiloto(input, opts = {}, json = false) {
    const mensagens = typeof input === 'string' ? [{ role: 'user', content: input }] : input
    const { data, error } = await sb.functions.invoke('copiloto', { body: { mensagens, json } })
    if (error) { const ctx = await error.context?.json?.().catch(() => null); throw { code: ctx?.code || 'unavailable', message: ctx?.message || error.message } }
    opts.onText?.({ text: data.text, delta: data.text })
    return data
  }
  const sample = async (input, opts) => { const d = await chamaCopiloto(input, opts); return { text: d.text, truncated: false } }
  sample.json = async (input, opts) => { const d = await chamaCopiloto(input, opts, true); return d.json ?? JSON.parse(d.text.replace(/^```(json)?|```$/g, '')) }
  sample.limits = async () => ({ images: false })

  // ── arquivos (Storage privado, pasta da casa) ────────────────────────────
  const assets = {
    async upload(blob) {
      const nome = (blob.name || 'arquivo').replace(/[^\w.\-]+/g, '_')
      const path = `${casa}/${novoId()}-${nome}`
      const { error } = await sb.storage.from('faturas').upload(path, blob, { contentType: blob.type || 'application/octet-stream' })
      if (error) throw err(error)
      return { id: path, url: '', sizeBytes: blob.size, contentType: blob.type }
    },
    async abrir(path) { const { data, error } = await sb.storage.from('faturas').createSignedUrl(path, 300); if (error) throw err(error); window.open(data.signedUrl, '_blank', 'noopener') },
    async delete(path) { await sb.storage.from('faturas').remove([path]) },
  }
  const downloads = { async save({ filename, data }) { const b = data instanceof Blob ? data : new Blob([data]); const a = document.createElement('a'); a.href = URL_.createObjectURL(b); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL_.revokeObjectURL(a.href); a.remove() }, 1000); return { status: 'saved' } } }
  const URL_ = window.URL

  const user = { id: async () => uid, pessoa: () => pessoa, isOwner: () => true, canEdit: () => true, can: () => true }

  window.claude = {
    use: async (nome) => {
      const ok = await pronto
      if (ok !== true) return null
      return { db, user, sample, assets, downloads }[nome] ?? null
    },
  }
  window.nossoCaixa = { pronto, sb, sair: async () => { await sb.auth.signOut(); location.reload() } }
})()
