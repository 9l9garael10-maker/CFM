# CFM Backend (API mínima)

Este é um backend mínimo em Node.js/Express para persistir e consultar transações no PostgreSQL.

Arquivos principais:
- `server.js` - servidor Express com endpoints CRUD para `transacoes` e `categorias` e endpoint `/migrate` para criar o schema.
- `create_transactions_db.sql` - DDL completo (Postgres e SQLite) já presente no repositório.
- `.env.example` - arquivo de exemplo com `DATABASE_URL` e `PORT`.

Requisitos:
- Node.js 18+ (ou 16+), npm
- PostgreSQL (o usuário/DB da string de conexão precisa existir)

Configuração rápida (PowerShell):

1) Copie o `.env.example` para `.env` e ajuste a variável `DATABASE_URL` se desejar.

Se você estiver usando o Neon (Postgres gerenciado) a string de conexão será algo como:

postgresql://neondb_owner:SEU_PASSWORD@ep-XXXXX-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require

Exemplo (PowerShell):

```powershell
copy .env.example .env
# Abra .env e substitua DATABASE_URL pelo valor do seu provedor (Neon, Heroku, etc.)
```

2) Instale dependências:

```powershell
npm install
```

3) Rodar migração (cria as tabelas no banco apontado por DATABASE_URL):

```powershell
# inicia o servidor e então chame o endpoint /migrate (ou use curl/Invoke-RestMethod)
npm start
# em outro terminal PowerShell:
Invoke-RestMethod -Method Post -Uri http://localhost:4000/migrate
```

4) Exemplos de uso (PowerShell / Invoke-RestMethod):

Inserir uma transação (POST /transacoes):

```powershell
$body = @{
  id = [int64](Get-Date -UFormat %s) * 1000; # ou use Date.now() do front-end
  user_email = 'usuario@exemplo.com'
  tipo = 'entrada'
  descricao = 'Salário'
  valor = 3500.00
  data = '2025-10-01'
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:4000/transacoes -ContentType 'application/json' -Body $body
```

Listar transações de um usuário (GET /transacoes):

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:4000/transacoes?user_email=usuario@exemplo.com"
```

Observações / Próximos passos:
- Recomendo adaptar o front-end (`app.js`) para enviar as requisições para a API em vez de usar `localStorage`.
- Para produção, não deixe credenciais no `.env` em repositórios públicos. Use um secrets manager.
- Em produção, rode as migrations com uma ferramenta (Flyway, Liquibase, Sequelize/TypeORM migrations) em vez de endpoint `/migrate`.

Se quiser, posso:
- Gerar o código de migração separado (arquivo JS) que executa a DDL com retries/locks.
- Implementar autenticação mínima (JWT) para proteger os endpoints.
- Atualizar o front-end para sincronizar com essa API automaticamente.
