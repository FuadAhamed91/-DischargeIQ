/**
 * A tiny in-memory stand-in for the Supabase query builder, enough to run
 * the WhatsApp webhook handler end to end without a database:
 *
 *   from(table).select(cols, { count, head }).eq().in().order().limit().single()/maybeSingle()
 *   from(table).insert(row | rows).select().single()
 *   from(table).upsert(row, { onConflict }).select().single()
 *   from(table).update(values).eq()
 *   storage.from(bucket).upload(path, body, { contentType })   (kept in db.uploads)
 *
 * Embeds in select strings ("patients!inner(id, full_name)") follow the
 * relations declared in RELATIONS; a filter on "patients.phone_e164" applies
 * to the embedded row and "metadata->>kind" reads a JSON key as text.
 * UNIQUE columns raise 23505 like Postgres does.
 *
 * Deliberately not a general PostgREST clone — it covers what the handler
 * and its helpers use, and throws on anything else so a new query pattern
 * is noticed rather than silently returning nothing.
 */

type Row = Record<string, unknown>

interface Relation {
  /** Column on the parent row holding the foreign key. */
  local: string
  /** Column on the related table it points to. */
  foreign: string
  /** true: the embed is a list of related rows (one-to-many). */
  many: boolean
}

const RELATIONS: Record<string, Record<string, Relation>> = {
  care_episodes: {
    patients: { local: 'patient_id', foreign: 'id', many: false },
    whatsapp_conversations: { local: 'id', foreign: 'episode_id', many: false },
  },
  whatsapp_messages: {
    whatsapp_conversations: { local: 'conversation_id', foreign: 'id', many: false },
  },
  discharge_summaries: {
    medications: { local: 'id', foreign: 'summary_id', many: true },
  },
}

const UNIQUE: Record<string, string[][]> = {
  whatsapp_messages: [['wa_message_id']],
  whatsapp_conversations: [['episode_id']],
  whatsapp_number_sessions: [['hospital_id', 'wa_phone']],
  patients: [['hospital_id', 'mrn']],
}

let nextId = 1
const newId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'neq'; col: string; val: unknown }
  | { kind: 'in'; col: string; vals: unknown[] }
  | { kind: 'lt'; col: string; val: string | number }
  | { kind: 'lte'; col: string; val: string | number }
  | { kind: 'gte'; col: string; val: string | number }

export interface QueryResult<T = unknown> {
  data: T
  error: { code?: string; message: string } | null
  count: number | null
}

export class FakeDb {
  tables: Record<string, Row[]> = {}
  /** Every insert/upsert/update, in order — handy for assertions. */
  log: Array<{ op: string; table: string; row: Row }> = []
  /** Files "uploaded" to Storage. Set failUploads to see how the caller copes without them. */
  uploads: Array<{ bucket: string; path: string; contentType: string | undefined; bytes: number }> = []
  failUploads = false

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: { length?: number; byteLength?: number }, opts: { contentType?: string } = {}) => {
        if (this.failUploads) return { data: null, error: { message: `Bucket not found: ${bucket}` } }
        this.uploads.push({ bucket, path, contentType: opts.contentType, bytes: body.byteLength ?? body.length ?? 0 })
        return { data: { path }, error: null }
      },
    }),
  }

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) this.tables[table] = rows.map((r) => ({ ...r }))
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= [])
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table)
  }
}

class FakeQuery implements PromiseLike<QueryResult> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  private columns = '*'
  private countMode: 'exact' | null = null
  private headOnly = false
  private payload: Row[] = []
  private conflict: string[] | null = null
  private filters: Filter[] = []
  private ordering: { col: string; ascending: boolean } | null = null
  private limitN: number | null = null
  private wantSingle: 'single' | 'maybe' | null = null
  private returning = false

  constructor(private db: FakeDb, private table: string) {}

  select(columns = '*', opts: { count?: 'exact'; head?: boolean } = {}) {
    if (this.op !== 'select') this.returning = true
    this.columns = columns
    if (opts.count) this.countMode = opts.count
    if (opts.head) this.headOnly = true
    return this
  }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this }
  upsert(rows: Row | Row[], opts: { onConflict?: string } = {}) {
    this.op = 'upsert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    this.conflict = (opts.onConflict ?? 'id').split(',').map((c) => c.trim())
    return this
  }
  update(values: Row) { this.op = 'update'; this.payload = [values]; return this }
  delete() { this.op = 'delete'; return this }
  eq(col: string, val: unknown) { this.filters.push({ kind: 'eq', col, val }); return this }
  neq(col: string, val: unknown) { this.filters.push({ kind: 'neq', col, val }); return this }
  in(col: string, vals: unknown[]) { this.filters.push({ kind: 'in', col, vals }); return this }
  lt(col: string, val: string | number) { this.filters.push({ kind: 'lt', col, val }); return this }
  lte(col: string, val: string | number) { this.filters.push({ kind: 'lte', col, val }); return this }
  gte(col: string, val: string | number) { this.filters.push({ kind: 'gte', col, val }); return this }
  order(col: string, opts: { ascending?: boolean } = {}) { this.ordering = { col, ascending: opts.ascending !== false }; return this }
  limit(n: number) { this.limitN = n; return this }
  single() { this.wantSingle = 'single'; return this }
  maybeSingle() { this.wantSingle = 'maybe'; return this }

  then<A = QueryResult, B = never>(onfulfilled?: ((v: QueryResult) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected)
  }

  // ------------------------------------

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const value = this.resolveColumn(row, f.col)
      switch (f.kind) {
        case 'eq': return value === f.val
        case 'neq': return value !== f.val
        case 'in': return f.vals.includes(value)
        case 'lt': return value !== null && value !== undefined && (value as string | number) < f.val
        case 'lte': return value !== null && value !== undefined && (value as string | number) <= f.val
        case 'gte': return value !== null && value !== undefined && (value as string | number) >= f.val
      }
    })
  }

  /** "patients.phone_e164" reaches into the embedded relation; "metadata->>kind" into a JSON column (as text, like PostgREST). */
  private resolveColumn(row: Row, col: string): unknown {
    if (col.includes('->>')) {
      const [jsonCol, key] = col.split('->>')
      const inner = row[jsonCol]
      const value = inner && typeof inner === 'object' ? (inner as Row)[key] : undefined
      return value === undefined || value === null ? undefined : typeof value === 'string' ? value : JSON.stringify(value)
    }
    if (!col.includes('.')) return row[col]
    const [relName, ...rest] = col.split('.')
    const related = this.embed(row, relName)
    if (!related || Array.isArray(related)) return undefined
    return rest.reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Row)[key] : undefined), related)
  }

  private embed(row: Row, relName: string): Row | Row[] | null {
    const rel = RELATIONS[this.table]?.[relName]
    if (!rel) throw new Error(`fake-supabase: no relation ${this.table} → ${relName}`)
    const rows = this.db.rows(relName).filter((r) => r[rel.foreign] === row[rel.local])
    return rel.many ? rows : (rows[0] ?? null)
  }

  private project(row: Row): Row {
    const out: Row = {}
    const spec = this.columns.replace(/\s+/g, ' ').trim()
    if (spec === '*') return { ...row }
    // Split on commas outside parentheses.
    const parts: string[] = []
    let depth = 0, current = ''
    for (const ch of spec) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { parts.push(current.trim()); current = '' } else current += ch
    }
    if (current.trim()) parts.push(current.trim())
    for (const part of parts) {
      const embedMatch = part.match(/^([a-z_]+)(?:!\w+)?\s*\((.*)\)$/i)
      if (embedMatch) {
        const [, relName, inner] = embedMatch
        const related = this.embed(row, relName)
        const pick = (r: Row) => (inner.trim() === '*' ? { ...r } : Object.fromEntries(inner.split(',').map((c) => c.trim()).map((c) => [c, r[c]])))
        out[relName] = Array.isArray(related) ? related.map(pick) : related ? pick(related) : null
      } else if (part === '*') {
        Object.assign(out, row)
      } else {
        out[part] = row[part]
      }
    }
    return out
  }

  private uniqueViolation(row: Row, ignoreIndex: number | null): { code: string; message: string } | null {
    for (const cols of UNIQUE[this.table] ?? []) {
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue
      const clash = this.db.rows(this.table).findIndex((r, i) => i !== ignoreIndex && cols.every((c) => r[c] === row[c]))
      if (clash >= 0) return { code: '23505', message: `duplicate key value violates unique constraint "${this.table}_${cols.join('_')}_key"` }
    }
    return null
  }

  private finish(rows: Row[]): QueryResult {
    if (this.headOnly) return { data: null, error: null, count: rows.length }
    const projected = rows.map((r) => this.project(r))
    if (this.wantSingle === 'single') {
      if (projected.length !== 1) {
        return { data: null, error: { code: 'PGRST116', message: `JSON object requested, multiple (or no) rows returned: ${projected.length}` }, count: null }
      }
      return { data: projected[0], error: null, count: null }
    }
    if (this.wantSingle === 'maybe') {
      if (projected.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' }, count: null }
      return { data: projected[0] ?? null, error: null, count: null }
    }
    return { data: projected, error: null, count: this.countMode ? projected.length : null }
  }

  private run(): QueryResult {
    const table = this.db.rows(this.table)
    switch (this.op) {
      case 'select': {
        let rows = table.filter((r) => this.matches(r))
        if (this.ordering) {
          const { col, ascending } = this.ordering
          rows = [...rows].sort((a, b) => {
            const av = a[col] as string | number | null, bv = b[col] as string | number | null
            if (av === bv) return 0
            if (av === null || av === undefined) return 1
            if (bv === null || bv === undefined) return -1
            return (av < bv ? -1 : 1) * (ascending ? 1 : -1)
          })
        }
        if (this.limitN !== null) rows = rows.slice(0, this.limitN)
        return this.finish(rows)
      }
      case 'insert': {
        const inserted: Row[] = []
        for (const input of this.payload) {
          const row: Row = { id: newId(), created_at: new Date().toISOString(), ...input }
          const violation = this.uniqueViolation(row, null)
          if (violation) return { data: null, error: violation, count: null }
          table.push(row)
          this.db.log.push({ op: 'insert', table: this.table, row })
          inserted.push(row)
        }
        return this.returning ? this.finish(inserted) : { data: null, error: null, count: null }
      }
      case 'upsert': {
        const touched: Row[] = []
        for (const input of this.payload) {
          const cols = this.conflict ?? ['id']
          const index = table.findIndex((r) => cols.every((c) => r[c] === input[c]))
          if (index >= 0) {
            Object.assign(table[index], input)
            this.db.log.push({ op: 'upsert:update', table: this.table, row: table[index] })
            touched.push(table[index])
          } else {
            const row: Row = { id: newId(), created_at: new Date().toISOString(), ...input }
            const violation = this.uniqueViolation(row, null)
            if (violation) return { data: null, error: violation, count: null }
            table.push(row)
            this.db.log.push({ op: 'upsert:insert', table: this.table, row })
            touched.push(row)
          }
        }
        return this.returning ? this.finish(touched) : { data: null, error: null, count: null }
      }
      case 'update': {
        const updated: Row[] = []
        table.forEach((r, i) => {
          if (!this.matches(r)) return
          Object.assign(r, this.payload[0])
          const violation = this.uniqueViolation(r, i)
          if (violation) throw new Error(violation.message)
          this.db.log.push({ op: 'update', table: this.table, row: r })
          updated.push(r)
        })
        return this.returning ? this.finish(updated) : { data: null, error: null, count: null }
      }
      case 'delete': {
        const removed = table.filter((r) => this.matches(r))
        this.db.tables[this.table] = table.filter((r) => !this.matches(r))
        return this.returning ? this.finish(removed) : { data: null, error: null, count: removed.length }
      }
    }
  }
}
