require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// Ler e sanitizar a connection string do ambiente.
// Alguns provedores ou uploads acidentais colocam várias variáveis em um único valor
// (ex.: "postgresql://.../cfm\nPORT=4000"). Detectamos e cortamos tudo após a primeira linha/whitespace.
const rawDb = process.env.DATABASE_URL || 'postgresql://postgres:031119@localhost:5432/gestao';
let connectionString = rawDb;
if (typeof rawDb === 'string') {
  // cortar em quebras de linha e espaços extras; usar o primeiro token
  const firstLine = rawDb.split(/\r?\n/)[0];
  const firstToken = firstLine.split(/\s+/)[0];
  if (firstToken !== rawDb) {
    console.warn('DATABASE_URL parece conter conteúdo extra; usando apenas o primeiro token. Verifique suas variáveis de ambiente. (valor truncado)');
  }
  connectionString = firstToken.trim();
}
// Neon/Postgres on cloud requires SSL. Usamos ssl: { rejectUnauthorized: false } para compatibilidade
// (em produção, prefira validar certificados/CA corretamente).
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, idleTimeoutMillis: 30000 });

const app = express();
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos do frontend (index.html, app.js, style.css)
const staticDir = path.join(__dirname);
app.use(express.static(staticDir));

const PORT = process.env.PORT || 4000;

// Healthcheck
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT 1 as ok');
    res.json({ ok: true, db: r.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Migration (cria as tabelas se não existirem). Use com cuidado.
app.post('/migrate', async (req, res) => {
  try {
    // DDL baseado no create_transactions_db.sql (seção Postgres)
    const ddl = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  currency CHAR(3) DEFAULT 'BRL',
  theme TEXT,
  pin_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categorias (
  id TEXT PRIMARY KEY,
  user_email TEXT REFERENCES users(email) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  icone TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  custom BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transacoes (
  id BIGINT PRIMARY KEY,
  uuid UUID DEFAULT uuid_generate_v4() NOT NULL,
  user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  descricao TEXT NOT NULL,
  valor NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
  data DATE NOT NULL,
  categoria_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,
  deleted BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE IF EXISTS transacoes
  ADD CONSTRAINT IF NOT EXISTS fk_categoria
  FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transacoes_user_date ON transacoes (user_email, data DESC);
CREATE INDEX IF NOT EXISTS idx_transacoes_user_tipo ON transacoes (user_email, tipo);
CREATE INDEX IF NOT EXISTS idx_transacoes_categoria ON transacoes (categoria_id);
CREATE INDEX IF NOT EXISTS idx_transacoes_ts ON transacoes (timestamp DESC);

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp ON transacoes;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON transacoes
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();
`;

    await pool.query(ddl);
    res.json({ ok: true, message: 'Migração executada (Postgres DDL aplicada).' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Helpers
function ensureUserEmail(req, res) {
  const user = req.query.user_email || (req.body && req.body.user_email);
  if (!user) {
    res.status(400).json({ error: 'user_email é obrigatório (query string ou body).' });
    return null;
  }
  return user;
}

// CRUD transações
app.get('/transacoes', async (req, res) => {
  const user_email = ensureUserEmail(req, res);
  if (!user_email) return;

  const { tipo, start, end } = req.query;

  try {
    const params = [user_email];
    let where = 'WHERE user_email = $1 AND deleted = false';
    let idx = 2;
    if (tipo) {
      where += ` AND tipo = $${idx++}`;
      params.push(tipo);
    }
    if (start) {
      where += ` AND data >= $${idx++}`;
      params.push(start);
    }
    if (end) {
      where += ` AND data <= $${idx++}`;
      params.push(end);
    }

    const q = `SELECT * FROM transacoes ${where} ORDER BY data DESC, timestamp DESC`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/transacoes', async (req, res) => {
  const body = req.body;
  const user_email = body.user_email;
  if (!user_email) return res.status(400).json({ error: 'user_email é obrigatório no body.' });

  const { id, tipo, descricao, valor, data, categoria_id, metadata } = body;
  if (!id || !tipo || !descricao || valor == null || !data) {
    return res.status(400).json({ error: 'Campos obrigatórios: id, tipo, descricao, valor, data.' });
  }

  try {
    const q = `INSERT INTO transacoes(id, user_email, tipo, descricao, valor, data, categoria_id, metadata, timestamp)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING *`;
    const params = [id, user_email, tipo, descricao, valor, data, categoria_id || null, metadata ? JSON.stringify(metadata) : null];
    const r = await pool.query(q, params);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/transacoes/:id', async (req, res) => {
  const user_email = ensureUserEmail(req, res);
  if (!user_email) return;

  const id = req.params.id;
  const { tipo, descricao, valor, data, categoria_id, metadata } = req.body;

  try {
    // construir update dinâmico
    const fields = [];
    const params = [];
    let idx = 1;
    if (tipo) { fields.push(`tipo = $${idx++}`); params.push(tipo); }
    if (descricao) { fields.push(`descricao = $${idx++}`); params.push(descricao); }
    if (valor != null) { fields.push(`valor = $${idx++}`); params.push(valor); }
    if (data) { fields.push(`data = $${idx++}`); params.push(data); }
    if (categoria_id !== undefined) { fields.push(`categoria_id = $${idx++}`); params.push(categoria_id); }
    if (metadata !== undefined) { fields.push(`metadata = $${idx++}`); params.push(JSON.stringify(metadata)); }

    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });

    params.push(user_email);
    params.push(id);

    const q = `UPDATE transacoes SET ${fields.join(', ')} WHERE user_email = $${idx++} AND id = $${idx} RETURNING *`;
    const r = await pool.query(q, params);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Transação não encontrada.' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// soft delete por padrão
app.delete('/transacoes/:id', async (req, res) => {
  const user_email = ensureUserEmail(req, res);
  if (!user_email) return;

  const id = req.params.id;
  const soft = req.query.soft !== 'false';

  try {
    if (soft) {
      const q = 'UPDATE transacoes SET deleted = true WHERE user_email = $1 AND id = $2 RETURNING *';
      const r = await pool.query(q, [user_email, id]);
      if (r.rowCount === 0) return res.status(404).json({ error: 'Transação não encontrada.' });
      return res.json({ ok: true, deleted: r.rows[0] });
    } else {
      const q = 'DELETE FROM transacoes WHERE user_email = $1 AND id = $2 RETURNING *';
      const r = await pool.query(q, [user_email, id]);
      if (r.rowCount === 0) return res.status(404).json({ error: 'Transação não encontrada.' });
      return res.json({ ok: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Categorias: listar e criar
app.get('/categorias', async (req, res) => {
  const user_email = ensureUserEmail(req, res);
  if (!user_email) return;

  try {
    const r = await pool.query('SELECT * FROM categorias WHERE user_email = $1 ORDER BY nome', [user_email]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/categorias', async (req, res) => {
  const body = req.body;
  const user_email = body.user_email;
  if (!user_email) return res.status(400).json({ error: 'user_email é obrigatório no body.' });

  const { id, nome, icone, tipo, custom } = body;
  if (!id || !nome || !tipo) return res.status(400).json({ error: 'Campos obrigatórios: id, nome, tipo.' });

  try {
    const q = `INSERT INTO categorias(id, user_email, nome, icone, tipo, custom, created_at)
               VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING *`;
    const params = [id, user_email, nome, icone || null, tipo, custom ? true : false];
    const r = await pool.query(q, params);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Usuários: criar/atualizar e obter
app.post('/users', async (req, res) => {
  const { email, name, currency, theme, pin_hash } = req.body;
  if (!email) return res.status(400).json({ error: 'email é obrigatório' });

  try {
    // upsert
    const q = `INSERT INTO users(email, name, currency, theme, pin_hash, created_at)
               VALUES($1,$2,$3,$4,$5,now())
               ON CONFLICT (email) DO UPDATE SET
                 name = EXCLUDED.name,
                 currency = EXCLUDED.currency,
                 theme = EXCLUDED.theme,
                 pin_hash = EXCLUDED.pin_hash`;
    await pool.query(q, [email, name || null, currency || 'BRL', theme || null, pin_hash || null]);
    const r = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email query param é obrigatório' });
  try {
    // incluir pin_hash para permitir verificação de senha no front (apenas por simplicidade/dev)
    const r = await pool.query('SELECT email, name, currency, theme, pin_hash, created_at FROM users WHERE email = $1', [email]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health & start
app.listen(PORT, async () => {
  console.log(`API rodando na porta ${PORT}`);
  console.log('DATABASE_URL está configurada (valor não exibido por segurança)');

  // Migração automática opcional
  if (process.env.MIGRATE === 'true') {
    console.log('MIGRATE=true detectado: executando migração automática...');
    try {
      const resm = await pool.query('SELECT 1');
      // executar /migrate internamente
      await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
      // executar DDL mínimo
      await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  currency CHAR(3) DEFAULT 'BRL',
  theme TEXT,
  pin_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
`);
      // chamar endpoint localmente para completar
      // nota: para simplicidade não re-executamos toda a DDL aqui
      console.log('Migração mínima executada (users). Para rodar a migração completa chame POST /migrate');
    } catch (err) {
      console.error('Erro na migração automática:', err.message);
    }
  }
});
