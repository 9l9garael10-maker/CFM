-- create_transactions_db.sql
-- DDL e instruções para criar o banco de dados de transações
-- Inclui seções para PostgreSQL (recomendado) e SQLite (simples/local)

/* ==========================
   1) PostgreSQL (recomendado)
   ==========================
   Observações:
   - Use NUMERIC(...) ou armazene "valor_cents" como BIGINT para evitar problemas de ponto flutuante.
   - Recomendado criar usuários/app roles e aplicar migrations via ferramenta (Flyway/Knex/TypeORM/liquibase).
*/

-- Ativar extensão para UUIDs (opcional)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabela de usuários (simples, baseada no armazenamento do app que usa email como chave)
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  currency CHAR(3) DEFAULT 'BRL',
  theme TEXT,
  pin_hash TEXT, -- recomenda-se armazenar hash em vez do PIN em texto
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de categorias
CREATE TABLE IF NOT EXISTS categorias (
  id TEXT PRIMARY KEY,
  user_email TEXT REFERENCES users(email) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  icone TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  custom BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabela de transações
CREATE TABLE IF NOT EXISTS transacoes (
  id BIGINT PRIMARY KEY, -- preserva o id gerado pelo front-end (Date.now()) quando aplicável
  uuid UUID DEFAULT uuid_generate_v4() NOT NULL,
  user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  descricao TEXT NOT NULL,
  -- valor em unidade monetária (usar NUMERIC para precisão) - alternativa recomendada: usar valor_cents BIGINT
  valor NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
  -- alternativa (mais robusta para contabilidade):
  -- valor_cents BIGINT NOT NULL CHECK (valor_cents >= 0),
  data DATE NOT NULL,
  categoria_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(), -- quando a transação foi criada no sistema
  metadata JSONB, -- para extensões (tags, origens, referencia externa)
  deleted BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- FK simples para categoria (se desejar comportamento composto, ajustar)
ALTER TABLE transacoes
  ADD CONSTRAINT fk_categoria
  FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL;

-- Índices de desempenho
CREATE INDEX IF NOT EXISTS idx_transacoes_user_date ON transacoes (user_email, data DESC);
CREATE INDEX IF NOT EXISTS idx_transacoes_user_tipo ON transacoes (user_email, tipo);
CREATE INDEX IF NOT EXISTS idx_transacoes_categoria ON transacoes (categoria_id);
CREATE INDEX IF NOT EXISTS idx_transacoes_ts ON transacoes (timestamp DESC);

-- Trigger para atualizar updated_at (Postgres)
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

-- Exemplo: inserir usuário, categoria e transação
-- INSERT INTO users(email, name) VALUES('usuario@exemplo.com', 'Usuário Teste');
-- INSERT INTO categorias(id, user_email, nome, icone, tipo, custom) VALUES('salario', 'usuario@exemplo.com', 'Salário','💼','entrada', false);
-- INSERT INTO transacoes(id, user_email, tipo, descricao, valor, data, categoria_id) VALUES(1630000000000, 'usuario@exemplo.com', 'entrada', 'Salário salário CT', 3500.00, '2025-10-01', 'salario');

/* ==========================
   2) SQLite (local / dev)
   ==========================
   Observações:
   - SQLite não tem CHECK/JSONB tão ricos quanto Postgres; ainda assim oferece boa portabilidade local.
   - Para criar um arquivo local: sqlite3 transactions.db < create_transactions_db.sql
*/

-- Abaixo estão as instruções compatíveis com SQLite. Se for executar no sqlite3, execute apenas a seção SQLite.

-- Tabela users
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  currency TEXT DEFAULT 'BRL',
  theme TEXT,
  pin_hash TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tabela categorias
CREATE TABLE IF NOT EXISTS categorias (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  nome TEXT NOT NULL,
  icone TEXT,
  tipo TEXT NOT NULL,
  custom INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tabela transacoes
CREATE TABLE IF NOT EXISTS transacoes (
  id INTEGER PRIMARY KEY, -- aceita valores do Date.now()
  uuid TEXT,
  user_email TEXT NOT NULL,
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  valor NUMERIC NOT NULL,
  data TEXT NOT NULL,
  categoria_id TEXT,
  timestamp TEXT DEFAULT (datetime('now')),
  metadata TEXT,
  deleted INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transacoes_user_date_sqlite ON transacoes (user_email, data DESC);
CREATE INDEX IF NOT EXISTS idx_transacoes_user_tipo_sqlite ON transacoes (user_email, tipo);
CREATE INDEX IF NOT EXISTS idx_transacoes_categoria_sqlite ON transacoes (categoria_id);

-- Exemplos (SQLite)
-- INSERT INTO users(email, name) VALUES('usuario@exemplo.com','Usuário Teste');
-- INSERT INTO categorias(id, user_email, nome, icone, tipo, custom) VALUES('salario', 'usuario@exemplo.com', 'Salário', '💼', 'entrada', 0);
-- INSERT INTO transacoes(id, uuid, user_email, tipo, descricao, valor, data, categoria_id) VALUES(1630000000000, 'uuid-ex', 'usuario@exemplo.com', 'entrada', 'Salário', 3500.00, '2025-10-01', 'salario');

/* ==========================
   Boas práticas e recomendações rápidas
   ==========================
   - Preferir armazenar valores monetários como inteiros (cents) para contabilidade: valor_cents BIGINT.
   - Nunca armazenar PIN em texto; use hashing (bcrypt/argon2) e, idealmente, autenticação externa (OAuth).
   - Use migrations (Flyway, Alembic, Knex, TypeORM migrations) em vez de rodar SQL ad-hoc.
   - Adicione backups regulares e monitoramento (wal_keep, pg_dump/pg_basebackup para Postgres).
   - Em produção, crie roles/permssions e não use o superuser direto para a app.
   - Para multi-tenant simples: use user_email na tabela `transacoes` para isolar dados.

   Exemplos de consultas úteis:
*/

-- Saldo atual do usuário (Postgres)
-- SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) AS saldo
-- FROM transacoes WHERE user_email = 'usuario@exemplo.com' AND deleted = false;

-- Entradas e saídas por mês
-- SELECT date_trunc('month', data::date) AS mes,
--        SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) AS entradas,
--        SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END) AS saidas
-- FROM transacoes
-- WHERE user_email = 'usuario@exemplo.com' AND deleted = false
-- GROUP BY 1 ORDER BY 1 DESC;

-- Obter transações de um período
-- SELECT * FROM transacoes WHERE user_email = 'usuario@exemplo.com' AND data BETWEEN '2025-10-01' AND '2025-10-31' ORDER BY data DESC;

/* ==========================
   Como criar / comandos (PowerShell)
   ==========================
   - SQLite (local)
     PS> sqlite3 .\transactions.db ".read create_transactions_db.sql"

   - PostgreSQL (local)
     PS> createdb cfm_db
     PS> psql -d cfm_db -f create_transactions_db.sql

   - Usando psql com autenticação/usuario específico:
     PS> psql -h localhost -U app_user -d cfm_db -f create_transactions_db.sql

   Observação: em Windows, instale sqlite3 e psql/pg tools ou use containers Docker.
*/
