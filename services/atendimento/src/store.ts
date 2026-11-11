import { DatabaseSync } from 'node:sqlite';

export type Role = 'user' | 'assistant';

export type Conversation = {
  jid: string;
  mode: 'ai' | 'human';
  engagedAt: number | null;
  openChargeId: string | null;
  stage: 'greeting' | 'offered' | 'awaiting_payment' | 'delivered';
  /** Horário (ms) da última mensagem do cliente: base da janela de 24 h. */
  lastInboundAtMs?: number | null;
};

export type Charge = {
  chargeId: string;
  jid: string;
  itemId: string;
  amountCents: number;
  status: 'pending' | 'paid' | 'mismatch';
  cards: string[] | null;
  /** Código Pix copia e cola; guardado para poder reenviar se o envio falhar. */
  copyPaste?: string | null;
  /** true só depois que a leitura paga foi ENVIADA com sucesso ao cliente. */
  delivered?: boolean;
  /** Horário (ms) em que o provedor confirmou o pagamento. */
  paidAtMs?: number | null;
  /** Comprovante do provedor (InfinitePay), gravado só depois de confirmado por payment_check. */
  transactionNsu?: string | null;
  slug?: string | null;
};

/** Último gasto em anúncios lido da Meta (um único registro). */
export type AdSpendRecord = {
  totalCents: number | null;
  todayCents: number | null;
  currency: string | null;
  fetchedAtMs: number | null;
  errorKind: string | null;
};

/** Números agregados para o painel. */
export type StoreStats = {
  chats: { total: number; active24h: number; human: number; awaitingPayment: number };
  charges: { pending: number; paid: number };
  revenue: { totalCents: number; todayCents: number };
};

export type StoredMessage = { role: Role; content: string };

export type Notice = { id: number; atMs: number; text: string };

export type Store = {
  markSeen(messageId: string): boolean;
  getConversation(jid: string): Conversation | null;
  saveConversation(c: Conversation): void;
  appendMessage(jid: string, role: Role, content: string): void;
  recentMessages(jid: string, limit: number): StoredMessage[];
  saveCharge(c: Charge): void;
  getCharge(chargeId: string): Charge | null;
  /** Cartas de tiragens já sorteadas para este cliente (de outras cobranças), da mais recente para a mais antiga. */
  previousDraws(jid: string, exceptChargeId: string): string[][];
  addNotice(text: string, atMs: number): void;
  /** Avisos ao dono, do mais novo para o mais antigo. */
  recentNotices(limit: number): Notice[];
  getAdSpend(): AdSpendRecord | null;
  saveAdSpend(record: AdSpendRecord): void;
  /** Contagens e faturamento para o painel. `dayStartMs` é o começo de "hoje". */
  getStats(nowMs: number, dayStartMs: number): StoreStats;
  /** Fecha o banco (desligamento do serviço; também libera o arquivo no Windows). */
  close(): void;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS seen_messages (
  message_id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS conversations (
  jid TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  engaged_at INTEGER,
  open_charge_id TEXT,
  stage TEXT NOT NULL,
  last_inbound_at INTEGER
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages (jid, id);
CREATE TABLE IF NOT EXISTS charges (
  charge_id TEXT PRIMARY KEY,
  jid TEXT NOT NULL,
  item_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  cards TEXT,
  copy_paste TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  paid_at INTEGER,
  transaction_nsu TEXT,
  slug TEXT
);
CREATE TABLE IF NOT EXISTS ad_spend (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_cents INTEGER,
  today_cents INTEGER,
  currency TEXT,
  fetched_at INTEGER,
  error_kind TEXT
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  text TEXT NOT NULL
);
`;

// Bancos criados antes das colunas novas: adiciona o que falta sem perder dados.
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'charges', column: 'copy_paste', ddl: 'ALTER TABLE charges ADD COLUMN copy_paste TEXT' },
  { table: 'charges', column: 'delivered', ddl: 'ALTER TABLE charges ADD COLUMN delivered INTEGER NOT NULL DEFAULT 0' },
  { table: 'conversations', column: 'last_inbound_at', ddl: 'ALTER TABLE conversations ADD COLUMN last_inbound_at INTEGER' },
  { table: 'charges', column: 'paid_at', ddl: 'ALTER TABLE charges ADD COLUMN paid_at INTEGER' },
  { table: 'charges', column: 'transaction_nsu', ddl: 'ALTER TABLE charges ADD COLUMN transaction_nsu TEXT' },
  { table: 'charges', column: 'slug', ddl: 'ALTER TABLE charges ADD COLUMN slug TEXT' },
];

type ConversationRow = {
  jid: string;
  mode: Conversation['mode'];
  engaged_at: number | null;
  open_charge_id: string | null;
  stage: Conversation['stage'];
  last_inbound_at: number | null;
};

type ChargeRow = {
  charge_id: string;
  jid: string;
  item_id: string;
  amount_cents: number;
  status: Charge['status'];
  cards: string | null;
  copy_paste: string | null;
  delivered: number;
  paid_at: number | null;
  transaction_nsu: string | null;
  slug: string | null;
};

type NoticeRow = { id: number; at_ms: number; text: string };

export function createStore(dbPath: string): Store {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  for (const migration of COLUMN_MIGRATIONS) {
    const columns = (db.prepare(`PRAGMA table_info(${migration.table})`).all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes(migration.column)) db.exec(migration.ddl);
  }

  const insertSeen = db.prepare('INSERT OR IGNORE INTO seen_messages (message_id) VALUES (?)');
  const selectConversation = db.prepare(
    'SELECT jid, mode, engaged_at, open_charge_id, stage, last_inbound_at FROM conversations WHERE jid = ?',
  );
  const upsertConversation = db.prepare(
    `INSERT INTO conversations (jid, mode, engaged_at, open_charge_id, stage, last_inbound_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       mode = excluded.mode,
       engaged_at = excluded.engaged_at,
       open_charge_id = excluded.open_charge_id,
       stage = excluded.stage,
       last_inbound_at = excluded.last_inbound_at`,
  );
  const insertMessage = db.prepare('INSERT INTO messages (jid, role, content) VALUES (?, ?, ?)');
  const selectRecent = db.prepare(
    'SELECT role, content FROM messages WHERE jid = ? ORDER BY id DESC LIMIT ?',
  );
  const upsertCharge = db.prepare(
    `INSERT INTO charges (charge_id, jid, item_id, amount_cents, status, cards, copy_paste, delivered, paid_at, transaction_nsu, slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(charge_id) DO UPDATE SET
       jid = excluded.jid,
       item_id = excluded.item_id,
       amount_cents = excluded.amount_cents,
       status = excluded.status,
       cards = excluded.cards,
       copy_paste = excluded.copy_paste,
       delivered = excluded.delivered,
       paid_at = excluded.paid_at,
       transaction_nsu = excluded.transaction_nsu,
       slug = excluded.slug`,
  );
  const selectCharge = db.prepare(
    'SELECT charge_id, jid, item_id, amount_cents, status, cards, copy_paste, delivered, paid_at, transaction_nsu, slug FROM charges WHERE charge_id = ?',
  );
  const selectPreviousDraws = db.prepare(
    'SELECT cards FROM charges WHERE jid = ? AND charge_id != ? AND cards IS NOT NULL ORDER BY rowid DESC',
  );
  const countChats = db.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN last_inbound_at >= ? THEN 1 ELSE 0 END), 0) AS active,
            COALESCE(SUM(CASE WHEN mode = 'human' THEN 1 ELSE 0 END), 0) AS human,
            COALESCE(SUM(CASE WHEN stage = 'awaiting_payment' THEN 1 ELSE 0 END), 0) AS awaiting
       FROM conversations`,
  );
  const sumCharges = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN status = 'paid' AND paid_at >= ? THEN amount_cents ELSE 0 END), 0) AS today
       FROM charges`,
  );
  const selectAdSpend = db.prepare(
    'SELECT total_cents, today_cents, currency, fetched_at, error_kind FROM ad_spend WHERE id = 1',
  );
  const upsertAdSpend = db.prepare(
    `INSERT INTO ad_spend (id, total_cents, today_cents, currency, fetched_at, error_kind)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       total_cents = excluded.total_cents,
       today_cents = excluded.today_cents,
       currency = excluded.currency,
       fetched_at = excluded.fetched_at,
       error_kind = excluded.error_kind`,
  );
  const insertNotice = db.prepare('INSERT INTO notices (at_ms, text) VALUES (?, ?)');
  const selectNotices = db.prepare('SELECT id, at_ms, text FROM notices ORDER BY id DESC LIMIT ?');

  return {
    markSeen(messageId) {
      return Number(insertSeen.run(messageId).changes) === 1;
    },

    getConversation(jid) {
      const row = selectConversation.get(jid) as ConversationRow | undefined;
      if (!row) return null;
      return {
        jid: row.jid,
        mode: row.mode,
        engagedAt: row.engaged_at,
        openChargeId: row.open_charge_id,
        stage: row.stage,
        lastInboundAtMs: row.last_inbound_at,
      };
    },

    saveConversation(c) {
      upsertConversation.run(c.jid, c.mode, c.engagedAt, c.openChargeId, c.stage, c.lastInboundAtMs ?? null);
    },

    appendMessage(jid, role, content) {
      insertMessage.run(jid, role, content);
    },

    recentMessages(jid, limit) {
      const rows = selectRecent.all(jid, Math.max(0, Math.floor(limit))) as StoredMessage[];
      return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
    },

    saveCharge(c) {
      upsertCharge.run(
        c.chargeId,
        c.jid,
        c.itemId,
        c.amountCents,
        c.status,
        c.cards === null ? null : JSON.stringify(c.cards),
        c.copyPaste ?? null,
        c.delivered ? 1 : 0,
        c.paidAtMs ?? null,
        c.transactionNsu ?? null,
        c.slug ?? null,
      );
    },

    getCharge(chargeId) {
      const row = selectCharge.get(chargeId) as ChargeRow | undefined;
      if (!row) return null;
      return {
        chargeId: row.charge_id,
        jid: row.jid,
        itemId: row.item_id,
        amountCents: row.amount_cents,
        status: row.status,
        cards: row.cards === null ? null : (JSON.parse(row.cards) as string[]),
        copyPaste: row.copy_paste,
        delivered: row.delivered === 1,
        paidAtMs: row.paid_at,
        // Só aparecem quando existem: cobranças sem comprovante mantêm o formato de antes.
        ...(row.transaction_nsu !== null ? { transactionNsu: row.transaction_nsu } : {}),
        ...(row.slug !== null ? { slug: row.slug } : {}),
      };
    },

    previousDraws(jid, exceptChargeId) {
      const rows = selectPreviousDraws.all(jid, exceptChargeId) as { cards: string }[];
      return rows.map((row) => JSON.parse(row.cards) as string[]);
    },

    getAdSpend() {
      const row = selectAdSpend.get() as
        | { total_cents: number | null; today_cents: number | null; currency: string | null; fetched_at: number | null; error_kind: string | null }
        | undefined;
      if (!row) return null;
      return {
        totalCents: row.total_cents,
        todayCents: row.today_cents,
        currency: row.currency,
        fetchedAtMs: row.fetched_at,
        errorKind: row.error_kind,
      };
    },

    saveAdSpend(r) {
      upsertAdSpend.run(r.totalCents, r.todayCents, r.currency, r.fetchedAtMs, r.errorKind);
    },

    getStats(nowMs, dayStartMs) {
      const chats = countChats.get(nowMs - 24 * 3_600_000) as { total: number; active: number; human: number; awaiting: number };
      const charges = sumCharges.get(dayStartMs) as { pending: number; paid: number; revenue: number; today: number };
      return {
        chats: { total: chats.total, active24h: chats.active, human: chats.human, awaitingPayment: chats.awaiting },
        charges: { pending: charges.pending, paid: charges.paid },
        revenue: { totalCents: charges.revenue, todayCents: charges.today },
      };
    },

    addNotice(text, atMs) {
      insertNotice.run(atMs, text);
    },

    recentNotices(limit) {
      const rows = selectNotices.all(Math.max(0, Math.floor(limit))) as NoticeRow[];
      return rows.map((r) => ({ id: r.id, atMs: r.at_ms, text: r.text }));
    },

    close() {
      db.close();
    },
  };
}
