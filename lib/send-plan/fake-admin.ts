/**
 * In-memory stand-in for the Supabase admin client, for lib/send-plan tests only.
 * Supports the query shapes lib/send-plan uses; every filter is applied to plain rows.
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

function same(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == b;
  return String(a) === String(b);
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export class FakeAdmin {
  readonly tables = new Map<string, Row[]>();
  private seq = 0;

  rows(table: string): Row[] {
    let list = this.tables.get(table);
    if (!list) {
      list = [];
      this.tables.set(table, list);
    }
    return list;
  }

  seed(table: string, rows: Row[]): void {
    for (const row of rows) this.rows(table).push({ ...row });
  }

  nextId(): string {
    this.seq += 1;
    return `row-${this.seq}`;
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
}

export class FakeQuery implements PromiseLike<{ data: unknown; error: null | { message: string } }> {
  private filters: Filter[] = [];
  private mode: "select" | "update" | "upsert" | "insert" | "delete" = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private returning = false;
  private single: "none" | "maybe" | "one" = "none";
  private limitN: number | null = null;
  private orders: Array<{ col: string; asc: boolean }> = [];
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};

  constructor(
    private readonly db: FakeAdmin,
    private readonly table: string
  ) {}

  select(): this {
    if (this.mode === "select") return this;
    this.returning = true;
    return this;
  }
  update(patch: Row): this {
    this.mode = "update";
    this.patch = patch;
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.mode = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.upsertOpts = opts;
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.mode = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  delete(): this {
    this.mode = "delete";
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push((row) => same(row[col], value));
    return this;
  }
  neq(col: string, value: unknown): this {
    this.filters.push((row) => !same(row[col], value));
    return this;
  }
  in(col: string, values: readonly unknown[]): this {
    this.filters.push((row) => values.some((v) => same(row[col], v)));
    return this;
  }
  gte(col: string, value: unknown): this {
    this.filters.push((row) => row[col] != null && cmp(row[col], value) >= 0);
    return this;
  }
  gt(col: string, value: unknown): this {
    this.filters.push((row) => row[col] != null && cmp(row[col], value) > 0);
    return this;
  }
  lte(col: string, value: unknown): this {
    this.filters.push((row) => row[col] != null && cmp(row[col], value) <= 0);
    return this;
  }
  lt(col: string, value: unknown): this {
    this.filters.push((row) => row[col] != null && cmp(row[col], value) < 0);
    return this;
  }
  like(col: string, pattern: string): this {
    const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
    this.filters.push((row) => re.test(String(row[col] ?? "")));
    return this;
  }
  is(col: string, value: null): this {
    this.filters.push((row) => row[col] == value);
    return this;
  }
  not(col: string, op: string, value: unknown): this {
    if (op === "is") this.filters.push((row) => row[col] != value);
    else this.filters.push((row) => !same(row[col], value));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.orders.push({ col, asc: opts.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  maybeSingle(): this {
    this.single = "maybe";
    return this;
  }
  singleRow(): this {
    this.single = "one";
    return this;
  }

  private matches(): Row[] {
    return this.db.rows(this.table).filter((row) => this.filters.every((f) => f(row)));
  }

  private run(): { data: unknown; error: null | { message: string } } {
    let out: Row[] = [];
    if (this.mode === "select") {
      out = [...this.matches()];
      for (const o of [...this.orders].reverse()) {
        out.sort((a, b) => (o.asc ? cmp(a[o.col], b[o.col]) : cmp(b[o.col], a[o.col])));
      }
      if (this.limitN != null) out = out.slice(0, this.limitN);
    } else if (this.mode === "update") {
      out = this.matches();
      for (const row of out) Object.assign(row, this.patch);
    } else if (this.mode === "delete") {
      const hit = new Set(this.matches());
      const list = this.db.rows(this.table);
      out = list.filter((row) => hit.has(row));
      this.db.tables.set(
        this.table,
        list.filter((row) => !hit.has(row))
      );
    } else {
      const keys = (this.upsertOpts.onConflict ?? "").split(",").map((k) => k.trim()).filter(Boolean);
      for (const incoming of this.payload) {
        const existing =
          this.mode === "upsert" && keys.length
            ? this.db.rows(this.table).find((row) => keys.every((k) => same(row[k], incoming[k])))
            : undefined;
        if (existing) {
          if (this.upsertOpts.ignoreDuplicates) continue;
          Object.assign(existing, incoming);
          out.push(existing);
          continue;
        }
        const row = { id: this.db.nextId(), created_at: new Date().toISOString(), ...incoming };
        this.db.rows(this.table).push(row);
        out.push(row);
      }
    }
    const copy = out.map((row) => ({ ...row }));
    if (this.single !== "none") {
      return { data: copy[0] ?? null, error: null };
    }
    if (this.mode !== "select" && !this.returning) return { data: null, error: null };
    return { data: copy, error: null };
  }

  then<A = { data: unknown; error: null | { message: string } }, B = never>(
    onfulfilled?: ((value: { data: unknown; error: null | { message: string } }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }
}

/** The fake, typed as the admin client lib/send-plan expects. */
export function fakeAdmin<T>(): { db: FakeAdmin; admin: T } {
  const db = new FakeAdmin();
  return { db, admin: db as unknown as T };
}
