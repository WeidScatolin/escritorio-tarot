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
  addNotice(text: string, atMs: number): void;
  /** Avisos ao dono, do mais novo para o mais antigo. */
  recentNotices(limit: number): Notice[];
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
  paid_at INTEGER
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
    `INSERT INTO charges (charge_id, jid, item_id, amount_cents, status, cards, copy_paste, delivered, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(charge_id) DO UPDATE SET
       jid = excluded.jid,
       item_id = excluded.item_id,
       amount_cents = excluded.amount_cents,
       status = excluded.status,
       cards = excluded.cards,
       copy_paste = excluded.copy_paste,
       delivered = excluded.delivered,
       paid_at = excluded.paid_at`,
  );
  const selectCharge = db.prepare(
    'SELECT charge_id, jid, item_id, amount_cents, status, cards, copy_paste, delivered, paid_at FROM charges WHERE charge_id = ?',
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
      };
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
