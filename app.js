// CONTROLE FINANCEIRO MODERNO - APP.JS

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', async function() {
  console.log('App inicializado');
  verificarAutenticacao();
  await inicializarApp();
  aplicarTemaAutomatico();
});

function verificarAutenticacao() {
  const sessao = getSessionData();
  
  if (!sessao) {
    window.location.href = 'index.html';
    return;
  }
  
  dados.perfil.nome = sessao.nome;
  dados.perfil.email = sessao.email;
}

function getSessionData() {
  // Ler sessão apenas de sessionStorage (não persistir sessão em localStorage)
  const sessaoSession = sessionStorage.getItem('cfm_sessao');
  return sessaoSession ? JSON.parse(sessaoSession) : null;
}

async function inicializarApp() {
  await carregarDados();
  configurarEventListeners();
  atualizarDashboard();
  atualizarListaTransacoes();
  atualizarCategoriasSelect();
  atualizarCategoriasLista();
  // Atualizar relatório inicial para exibir resumo ao abrir a aplicação
  try { atualizarRelatorio(); } catch (e) { console.warn('Erro ao atualizar relatório na inicialização:', e.message); }
  carregarPerfil();
  configurarNavegacao();
  inicializarGraficos();
  configurarDataMaxima();
  inicializarFiltrosBusca();
}

// ==================== ESTRUTURA DE DADOS ====================
let dados = {
  transacoes: [],
  categorias: {
    // Removidas categorias pré-definidas: agora somente categorias persistidas no banco são usadas
    entrada: [],
    saida: []
  },
  perfil: {
    nome: 'Usuário',
    email: '',
    moeda: 'BRL',
    tema: 'auto',
    pin: ''
  }
};

let graficos = {
  categorias: null,
  evolucao: null
};

let filtrosBusca = {
  entrada: '',
  saida: ''
};

// ==================== TOAST/NOTIFICAÇÕES ====================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span style="font-size: 1.2rem;">${type === 'success' ? '✔' : '✕'}</span>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==================== VALIDAÇÃO ====================
function validarCampo(elemento, mensagem = 'Campo obrigatório') {
  if (!elemento.value.trim()) {
    elemento.classList.add('error');
    mostrarErro(elemento, mensagem);
    return false;
  }
  elemento.classList.remove('error');
  removerErro(elemento);
  return true;
}

function validarFormulario(form) {
  const campos = form.querySelectorAll('input[required], select[required]');
  let valido = true;
  
  campos.forEach(campo => {
    if (!validarCampo(campo)) {
      valido = false;
    }
  });
  
  return valido;
}

function mostrarErro(elemento, mensagem) {
  removerErro(elemento);
  const erro = document.createElement('span');
  erro.className = 'error-message';
  erro.textContent = mensagem;
  elemento.parentElement.appendChild(erro);
}

function removerErro(elemento) {
  const erro = elemento.parentElement.querySelector('.error-message');
  if (erro) erro.remove();
}

// ==================== STORAGE ====================
let salvarTimeout;

function salvarDados() {
  // Não salvamos mais o estado completo no localStorage. O banco é a fonte de verdade.
  // Esta função mantém compatibilidade com chamadas existentes, mas apenas loga a ação.
  clearTimeout(salvarTimeout);
  salvarTimeout = setTimeout(() => {
    const sessao = getSessionData();
    console.debug('salvarDados chamado. Sessão:', sessao ? sessao.email : null);
    // Para persistência de dados, as operações individuais (transações, perfil, categorias)
    // já chamam os endpoints correspondentes. Não gravar o objeto `dados` localmente.
  }, 500);
}

// API base (ajuste se necessário)
const API_BASE = window.API_BASE || 'http://localhost:4000';

async function apiRequest(path, opts = {}) {
  const url = API_BASE + path;
  const headers = opts.headers || {};
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  try {
    const res = await fetch(url, { ...opts, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText} - ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await res.json();
    return await res.text();
  } catch (err) {
    throw err;
  }
}

async function fetchTransacoesFromApi(user_email) {
  return await apiRequest(`/transacoes?user_email=${encodeURIComponent(user_email)}`, { method: 'GET' });
}

async function fetchCategoriasFromApi(user_email) {
  return await apiRequest(`/categorias?user_email=${encodeURIComponent(user_email)}`, { method: 'GET' });
}

async function apiCreateTransacao(transacao) {
  return await apiRequest('/transacoes', { method: 'POST', body: JSON.stringify(transacao) });
}

async function apiUpdateTransacao(id, body, user_email) {
  return await apiRequest(`/transacoes/${encodeURIComponent(id)}?user_email=${encodeURIComponent(user_email)}`, { method: 'PUT', body: JSON.stringify(body) });
}

async function apiDeleteTransacao(id, user_email) {
  return await apiRequest(`/transacoes/${encodeURIComponent(id)}?user_email=${encodeURIComponent(user_email)}`, { method: 'DELETE' });
}

async function apiCreateCategoria(categoria) {
  return await apiRequest('/categorias', { method: 'POST', body: JSON.stringify(categoria) });
}

async function carregarDados() {
  const sessao = getSessionData();
  if (!sessao) return;

  try {
    const [transacoesApi, categoriasApi] = await Promise.all([
      fetchTransacoesFromApi(sessao.email),
      fetchCategoriasFromApi(sessao.email)
    ]);

    // mapear campos da API para estrutura esperada pelo front
    dados.transacoes = (transacoesApi || []).map(t => ({
      id: t.id,
      tipo: t.tipo,
      descricao: t.descricao,
      valor: parseFloat(t.valor),
      data: (t.data && t.data.slice(0,10)) || t.data,
      categoria: t.categoria_id || null,
      timestamp: t.timestamp || new Date().toISOString()
    }));

    // montar categorias no formato { entrada: [], saida: [] }
    const entrada = [];
    const saida = [];
    (categoriasApi || []).forEach(c => {
      const item = { id: c.id, nome: c.nome, icone: c.icone || '📌', customizada: c.custom };
      if (c.tipo === 'entrada') entrada.push(item);
      else saida.push(item);
    });
    // se não houver categorias na API, manter defaults locais
    if (entrada.length) dados.categorias.entrada = entrada;
    if (saida.length) dados.categorias.saida = saida;

    console.debug('Dados carregados do backend para', sessao.email);
  } catch (err) {
    // Não usar localStorage como fallback: operação offline não suportada neste modo.
    dados.transacoes = [];
    console.error('Não foi possível carregar dados do backend. O aplicativo funciona apenas com o servidor ativo.', err.message);
    showToast('Erro: não foi possível carregar dados do servidor. Tente novamente mais tarde.', 'error');
  }
}

// ==================== EVENT LISTENERS ====================
function configurarEventListeners() {
  const formEntrada = document.querySelector('#entradas .transaction-form');
  if (formEntrada) {
    formEntrada.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (validarFormulario(formEntrada)) {
        await adicionarTransacao('entrada');
      }
    });
  }

  const formSaida = document.querySelector('#saidas .transaction-form');
  if (formSaida) {
    formSaida.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (validarFormulario(formSaida)) {
        await adicionarTransacao('saida');
      }
    });
  }

  const formCategoria = document.querySelector('.category-form');
  if (formCategoria) {
    formCategoria.addEventListener('submit', (e) => {
      e.preventDefault();
      if (validarFormulario(formCategoria)) {
        adicionarCategoria();
      }
    });
  }

  const formPerfil = document.querySelector('.profile-form');
  if (formPerfil) {
    formPerfil.addEventListener('submit', (e) => {
      e.preventDefault();
      salvarPerfil();
    });
  }

  const formPreferencias = document.querySelector('.preferences-form');
  if (formPreferencias) {
    formPreferencias.addEventListener('submit', (e) => {
      e.preventDefault();
      salvarPreferencias();
    });
  }

  const filtroPeriodo = document.getElementById('periodo');
  if (filtroPeriodo) {
    filtroPeriodo.addEventListener('change', function() {
      togglePeriodoPersonalizado();
      atualizarRelatorio();
    });
  }

  const logoutBtn = document.querySelector('.logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function(e) {
      e.preventDefault();
      if (confirm('Deseja realmente sair?')) {
        localStorage.removeItem('cfm_sessao');
        sessionStorage.removeItem('cfm_sessao');
        window.location.href = 'index.html';
      }
    });
  }

  document.querySelectorAll('input, select').forEach(campo => {
    campo.addEventListener('input', function() {
      if (this.classList.contains('error')) {
        this.classList.remove('error');
        removerErro(this);
      }
    });
  });

  configurarExportacao();
}

// ==================== NAVEGAÇÃO ====================
function configurarNavegacao() {
  const navTabs = document.querySelectorAll('.nav-tab');
  const sections = document.querySelectorAll('.app-section');
  
  navTabs.forEach(tab => {
    tab.addEventListener('click', function(e) {
      e.preventDefault();
      
      navTabs.forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      
      sections.forEach(s => s.classList.remove('active'));
      
      const targetId = this.getAttribute('href').substring(1);
      const targetSection = document.getElementById(targetId);
      
      if (targetSection) {
        targetSection.classList.add('active');

        if (targetId === 'relatorios') {
          setTimeout(() => {
            togglePeriodoPersonalizado();
            atualizarRelatorio();
            atualizarGraficos();
          }, 100);
        }

        // ao entrar na aba de categorias, garantir que a grid e selects estejam atualizados
        if (targetId === 'categorias') {
          setTimeout(() => {
            atualizarCategoriasSelect();
            atualizarCategoriasLista();
          }, 50);
        }
      }
    });
  });
}

// ==================== FILTROS E BUSCA ====================
function inicializarFiltrosBusca() {
  const secaoEntradas = document.getElementById('entradas');
  if (secaoEntradas) {
    const filtroHTML = `
      <div class="search-filter-container">
        <h3>🔍 Buscar Entradas</h3>
        <input type="text" 
               class="search-input" 
               id="search-entrada" 
               placeholder="Buscar por descrição, valor ou categoria..."
               aria-label="Buscar entradas">
      </div>
    `;
    const formCard = secaoEntradas.querySelector('.form-card:last-of-type');
    formCard.insertAdjacentHTML('beforebegin', filtroHTML);
    
    document.getElementById('search-entrada').addEventListener('input', (e) => {
      filtrosBusca.entrada = e.target.value.toLowerCase();
      atualizarListaEspecifica('entrada', 'lista-entradas');
    });
  }

  const secaoSaidas = document.getElementById('saidas');
  if (secaoSaidas) {
    const filtroHTML = `
      <div class="search-filter-container">
        <h3>🔍 Buscar Saídas</h3>
        <input type="text" 
               class="search-input" 
               id="search-saida" 
               placeholder="Buscar por descrição, valor ou categoria..."
               aria-label="Buscar saídas">
      </div>
    `;
    const formCard = secaoSaidas.querySelector('.form-card:last-of-type');
    formCard.insertAdjacentHTML('beforebegin', filtroHTML);
    
    document.getElementById('search-saida').addEventListener('input', (e) => {
      filtrosBusca.saida = e.target.value.toLowerCase();
      atualizarListaEspecifica('saida', 'lista-saidas');
    });
  }
}

function filtrarTransacoes(transacoes, termoBusca) {
  if (!termoBusca) return transacoes;
  
  return transacoes.filter(t => {
    const descricao = t.descricao.toLowerCase();
    const valor = t.valor.toString();
    const categoria = obterNomeCategoria(t.categoria, t.tipo).toLowerCase();
    
    return descricao.includes(termoBusca) || 
           valor.includes(termoBusca) || 
           categoria.includes(termoBusca);
  });
}

// ==================== TRANSAÇÕES ====================
async function adicionarTransacao(tipo) {
  const prefixo = tipo;
  
  const descricao = document.getElementById(`desc-${prefixo}`).value;
  const valor = parseFloat(document.getElementById(`valor-${prefixo}`).value);
  const data = document.getElementById(`data-${prefixo}`).value;
  const categoria = document.getElementById(`categoria-${prefixo}`).value;

  if (!descricao || !valor || !data || !categoria) {
    showToast('Por favor, preencha todos os campos!', 'error');
    return;
  }

  const transacao = {
    id: Date.now(),
    tipo: tipo,
    descricao: descricao,
    valor: valor,
    data: data,
    categoria: categoria,
    timestamp: new Date().toISOString()
  };

  dados.transacoes.push(transacao);
  salvarDados();
  // tentar persistir no backend
  try {
    const sessao = getSessionData();
    if (sessao && sessao.email) {
      const body = {
        id: transacao.id,
        user_email: sessao.email,
        tipo: transacao.tipo,
        descricao: transacao.descricao,
        valor: transacao.valor,
        data: transacao.data,
        categoria_id: transacao.categoria,
        metadata: null
      };
      await apiCreateTransacao(body);
    }
  } catch (err) {
    console.warn('Erro ao enviar transação para backend:', err.message);
    showToast('Transação salva localmente, mas falhou ao sincronizar com o servidor.', 'error');
  }
  
  document.getElementById(`desc-${prefixo}`).value = '';
  document.getElementById(`valor-${prefixo}`).value = '';
  document.getElementById(`data-${prefixo}`).value = '';
  document.getElementById(`categoria-${prefixo}`).value = '';

  atualizarDashboard();
  atualizarListaTransacoes();
  
  setTimeout(() => destacarNovaTransacao(transacao.id, tipo), 100);
  
  showToast(`${tipo === 'entrada' ? 'Entrada' : 'Saída'} adicionada com sucesso!`);
}

function destacarNovaTransacao(id, tipo) {
  const listaId = tipo === 'entrada' ? 'lista-entradas' : 'lista-saidas';
  const lista = document.getElementById(listaId);
  if (!lista) return;
  
  const items = lista.querySelectorAll('.transaction-item');
  if (items.length > 0) {
    items[0].classList.add('highlight');
    setTimeout(() => items[0].classList.remove('highlight'), 800);
  }
}

function editarTransacao(id) {
  const transacao = dados.transacoes.find(t => t.id === id);
  if (!transacao) return;

  const modal = criarModal('Editar Transação', `
    <form id="form-editar">
      <div class="input-group">
        <label>Descrição</label>
        <input type="text" id="edit-desc" value="${transacao.descricao}" required>
      </div>
      <div class="input-group">
        <label>Valor (R$)</label>
        <input type="number" id="edit-valor" value="${transacao.valor}" step="0.01" required>
      </div>
      <div class="input-group">
        <label>Data</label>
        <input type="date" id="edit-data" value="${transacao.data}" required>
      </div>
      <div class="modal-buttons">
        <button type="submit" class="btn-primary">Salvar</button>
        <button type="button" class="btn-danger" onclick="fecharModal()">Cancelar</button>
      </div>
    </form>
  `);

  document.body.appendChild(modal);

  document.getElementById('form-editar').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    transacao.descricao = document.getElementById('edit-desc').value;
    transacao.valor = parseFloat(document.getElementById('edit-valor').value);
    transacao.data = document.getElementById('edit-data').value;
    
    salvarDados();
    atualizarDashboard();
    atualizarListaTransacoes();
    fecharModal();

    // sincronizar alteração com backend
    try {
      const sessao = getSessionData();
      if (sessao && sessao.email) {
        const body = {
          tipo: transacao.tipo,
          descricao: transacao.descricao,
          valor: transacao.valor,
          data: transacao.data,
          categoria_id: transacao.categoria
        };
        await apiUpdateTransacao(transacao.id, body, sessao.email);
      }
      showToast('Transação atualizada com sucesso!');
    } catch (err) {
      console.warn('Erro ao atualizar transação no backend:', err.message);
      showToast('Atualizada localmente, falha ao sincronizar com servidor.', 'error');
    }
  });
}

async function deletarTransacao(id) {
  if (!confirm('Tem certeza que deseja deletar esta transação?')) return;

  const sessao = getSessionData();
  if (!sessao || !sessao.email) {
    showToast('Usuário não autenticado.', 'error');
    return;
  }

  try {
    await apiDeleteTransacao(id, sessao.email);
    // remover localmente após sucesso no backend
    dados.transacoes = dados.transacoes.filter(t => t.id !== id);
    salvarDados();
    atualizarDashboard();
    atualizarListaTransacoes();
    showToast('Transação removida!');
  } catch (err) {
    console.warn('Erro ao remover transação no backend:', err.message);
    showToast('Falha ao remover no servidor. Tente novamente.', 'error');
  }
}

// ==================== MODAL ====================
function criarModal(titulo, conteudo) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>${titulo}</h3>
      ${conteudo}
    </div>
  `;
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) fecharModal();
  });
  
  return modal;
}

function fecharModal() {
  const modal = document.querySelector('.modal-overlay');
  if (modal) modal.remove();
}

// ==================== DASHBOARD ====================
function atualizarDashboard() {
  const entradas = calcularTotal('entrada');
  const saidas = calcularTotal('saida');
  const saldo = entradas - saidas;
  const totalTransacoes = dados.transacoes.length;

  const cardSaldo = document.querySelector('.dashboard-card.balance .card-value');
  const cardEntradas = document.querySelector('.dashboard-card.income .card-value');
  const cardSaidas = document.querySelector('.dashboard-card.expense .card-value');
  const cardTransacoes = document.querySelector('.dashboard-card.transactions .card-value');

  if (cardSaldo) cardSaldo.textContent = formatarMoeda(saldo);
  if (cardEntradas) cardEntradas.textContent = formatarMoeda(entradas);
  if (cardSaidas) cardSaidas.textContent = formatarMoeda(saidas);
  if (cardTransacoes) cardTransacoes.textContent = totalTransacoes;

  const changeEntradas = document.querySelector('.dashboard-card.income .card-change');
  const changeSaidas = document.querySelector('.dashboard-card.expense .card-change');
  const changeSaldo = document.querySelector('.dashboard-card.balance .card-change');

  if (changeEntradas) {
    const qtdEntradas = dados.transacoes.filter(t => t.tipo === 'entrada').length;
    changeEntradas.textContent = entradas > 0 ? `${qtdEntradas} entradas` : 'Sem entradas';
    changeEntradas.className = 'card-change ' + (entradas > 0 ? 'positive' : 'neutral');
  }

  if (changeSaidas) {
    const qtdSaidas = dados.transacoes.filter(t => t.tipo === 'saida').length;
    const percentGasto = entradas > 0 ? ((saidas / entradas) * 100).toFixed(1) : 0;
    changeSaidas.textContent = saidas > 0 ? `${percentGasto}% das entradas` : 'Sem saídas';
    changeSaidas.className = 'card-change ' + (saidas > 0 ? 'negative' : 'neutral');
  }

  if (changeSaldo) {
    if (saldo > 0) {
      changeSaldo.textContent = '↑ Saldo positivo';
      changeSaldo.className = 'card-change positive';
    } else if (saldo < 0) {
      changeSaldo.textContent = '↓ Saldo negativo';
      changeSaldo.className = 'card-change negative';
    } else {
      changeSaldo.textContent = 'Sem movimentações';
      changeSaldo.className = 'card-change neutral';
    }
  }

  atualizarTransacoesRecentes();
}

function atualizarTransacoesRecentes() {
  const lista = document.querySelector('#dashboard .transaction-list');
  if (!lista) return;

  if (dados.transacoes.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        <p>🔭 Nenhuma transação registrada ainda.</p>
        <p>Comece adicionando suas entradas e saídas!</p>
      </div>
    `;
    return;
  }

  const recentes = [...dados.transacoes]
    .sort((a, b) => new Date(b.data) - new Date(a.data))
    .slice(0, 5);

  lista.innerHTML = recentes.map(t => criarElementoTransacao(t, false)).join('');
}

// ==================== LISTAS ====================
function atualizarListaTransacoes() {
  atualizarListaEspecifica('entrada', 'lista-entradas');
  atualizarListaEspecifica('saida', 'lista-saidas');
}

function atualizarListaEspecifica(tipo, idLista) {
  const lista = document.getElementById(idLista);
  if (!lista) return;

  let transacoesFiltradas = dados.transacoes
    .filter(t => t.tipo === tipo)
    .sort((a, b) => new Date(b.data) - new Date(a.data));

  const termoBusca = filtrosBusca[tipo];
  transacoesFiltradas = filtrarTransacoes(transacoesFiltradas, termoBusca);

  if (transacoesFiltradas.length === 0) {
    const mensagem = termoBusca ? 
      `🔍 Nenhum resultado encontrado para "${termoBusca}"` :
      `🔭 Nenhuma ${tipo} registrada ainda.`;
    lista.innerHTML = `
      <div class="empty-state">
        <p>${mensagem}</p>
      </div>
    `;
    return;
  }

  lista.innerHTML = transacoesFiltradas.map(t => criarElementoTransacao(t, true)).join('');
}

function criarElementoTransacao(transacao, comAcoes) {
  const acoes = comAcoes ? `
    <div class="transaction-actions">
      <span class="transaction-amount">${formatarMoeda(transacao.valor)}</span>
      <button onclick="editarTransacao(${transacao.id})" 
              class="btn-action" 
              aria-label="Editar">✏️</button>
      <button onclick="deletarTransacao(${transacao.id})" 
              class="btn-action delete" 
              aria-label="Deletar">🗑️</button>
    </div>
  ` : `<span class="transaction-amount">${transacao.tipo === 'entrada' ? '+' : '-'} ${formatarMoeda(transacao.valor)}</span>`;

  return `
    <div class="transaction-item ${transacao.tipo}">
      <div class="transaction-info">
        <span class="transaction-desc">${transacao.descricao}</span>
        <span class="transaction-date">${formatarData(transacao.data)} - ${obterNomeCategoria(transacao.categoria, transacao.tipo)}</span>
      </div>
      ${acoes}
    </div>
  `;
}

// ==================== CATEGORIAS ====================
async function adicionarCategoria() {
  const nome = document.getElementById('nome-categoria').value;
  const tipo = document.getElementById('tipo-categoria').value;

  if (!nome || !tipo) {
    showToast('Por favor, preencha todos os campos!', 'error');
    return;
  }

  const novaCategoria = {
    id: nome.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
    nome: nome,
    icone: '📌',
    customizada: true
  };

  // salvar no backend
  try {
    const sessao = getSessionData();
    if (sessao && sessao.email) {
      const body = {
        id: novaCategoria.id,
        user_email: sessao.email,
        nome: novaCategoria.nome,
        icone: novaCategoria.icone,
        tipo: tipo,
        custom: true
      };
      await apiCreateCategoria(body);
    }

    // atualizar local
    dados.categorias[tipo].push(novaCategoria);
    salvarDados();

    document.getElementById('nome-categoria').value = '';
    atualizarCategoriasSelect();
    atualizarCategoriasLista();
    
    showToast('Categoria adicionada com sucesso!');
  } catch (err) {
    console.warn('Erro ao salvar categoria no backend:', err.message);
    showToast('Categoria salva localmente, falha ao sincronizar com servidor.', 'error');
  }
}

function removerCategoria(id, tipo) {
  const categoria = dados.categorias[tipo].find(c => c.id === id);
  
  if (!categoria || !categoria.customizada) {
    showToast('Não é possível remover categorias padrão!', 'error');
    return;
  }

  const temTransacoes = dados.transacoes.some(t => t.categoria === id);
  if (temTransacoes) {
    showToast('Não é possível remover categoria com transações!', 'error');
    return;
  }

  if (confirm(`Deseja remover a categoria "${categoria.nome}"?`)) {
    dados.categorias[tipo] = dados.categorias[tipo].filter(c => c.id !== id);
    salvarDados();
    atualizarCategoriasSelect();
    atualizarCategoriasLista();
    showToast('Categoria removida!');
  }
}

function atualizarCategoriasSelect() {
  const selectEntrada = document.getElementById('categoria-entrada');
  const selectSaida = document.getElementById('categoria-saida');

  if (selectEntrada) {
    selectEntrada.innerHTML = '<option value="">Selecione uma categoria</option>' +
      dados.categorias.entrada.map(c => 
        `<option value="${c.id}">${c.icone} ${c.nome}</option>`
      ).join('');
  }

  if (selectSaida) {
    selectSaida.innerHTML = '<option value="">Selecione uma categoria</option>' +
      dados.categorias.saida.map(c => 
        `<option value="${c.id}">${c.icone} ${c.nome}</option>`
      ).join('');
  }
}

function atualizarCategoriasLista() {
  const grid = document.querySelector('.category-grid');
  if (!grid) return;

  const todasCategorias = [
    ...dados.categorias.entrada.map(c => ({ ...c, tipo: 'entrada' })),
    ...dados.categorias.saida.map(c => ({ ...c, tipo: 'saida' }))
  ];

  grid.innerHTML = todasCategorias.map(c => `
    <div class="category-item ${c.tipo === 'entrada' ? 'income' : 'expense'}">
      <span class="category-icon">${c.icone}</span>
      <span class="category-name">${c.nome}</span>
      <span class="category-type">${c.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span>
      ${c.customizada ? `<button onclick="removerCategoria('${c.id}', '${c.tipo}')" class="btn-action delete" style="font-size: 0.8rem;">✕</button>` : ''}
    </div>
  `).join('');
}

// ==================== RELATÓRIOS ====================
function togglePeriodoPersonalizado() {
  const periodo = document.getElementById('periodo')?.value;
  let periodoPersonalizado = document.getElementById('periodo-personalizado-container');
  
  if (periodo === 'personalizado') {
    if (!periodoPersonalizado) {
      const reportFilters = document.querySelector('.report-filters');
      if (!reportFilters) return;
      
      periodoPersonalizado = document.createElement('div');
      periodoPersonalizado.id = 'periodo-personalizado-container';
      periodoPersonalizado.className = 'periodo-personalizado';
      periodoPersonalizado.innerHTML = `
        <div class="filter-group">
          <label for="data-inicio">Data Início</label>
          <input type="date" id="data-inicio" aria-label="Data de início">
        </div>
        <div class="filter-group">
          <label for="data-fim">Data Fim</label>
          <input type="date" id="data-fim" aria-label="Data de fim">
        </div>
      `;
      reportFilters.appendChild(periodoPersonalizado);
      
      document.getElementById('data-inicio').addEventListener('change', atualizarRelatorio);
      document.getElementById('data-fim').addEventListener('change', atualizarRelatorio);
      
      const hoje = new Date().toISOString().split('T')[0];
      document.getElementById('data-inicio').max = hoje;
      document.getElementById('data-fim').max = hoje;
    }
    periodoPersonalizado.style.display = 'flex';
  } else if (periodoPersonalizado) {
    periodoPersonalizado.style.display = 'none';
  }
}

function atualizarRelatorio() {
  const periodo = document.getElementById('periodo')?.value || 'mes';
  const transacoesFiltradas = filtrarTransacoesPorPeriodo(dados.transacoes, periodo);

  // Debug: informar quantidade de transações e período
  console.debug('atualizarRelatorio', { periodo, totalTransacoes: dados.transacoes.length, transacoesFiltradas: transacoesFiltradas.length });

  const entradas = transacoesFiltradas
    .filter(t => t.tipo === 'entrada')
    .reduce((sum, t) => sum + (Number(t.valor) || 0), 0);

  const saidas = transacoesFiltradas
    .filter(t => t.tipo === 'saida')
    .reduce((sum, t) => sum + (Number(t.valor) || 0), 0);

  const saldo = entradas - saidas;

  const summaryItems = document.querySelectorAll('.summary-item span:last-child');
  if (summaryItems.length >= 3) {
    summaryItems[0].textContent = formatarMoeda(entradas);
    summaryItems[0].className = entradas > 0 ? 'positive' : 'neutral';

    summaryItems[1].textContent = formatarMoeda(saidas);
    summaryItems[1].className = saidas > 0 ? 'negative' : 'neutral';

    summaryItems[2].textContent = formatarMoeda(saldo);
    summaryItems[2].className = saldo > 0 ? 'positive' : saldo < 0 ? 'negative' : 'neutral';
  } else {
    console.warn('atualizarRelatorio: elementos summary não encontrados no DOM');
    // tentar atualizar via ids alternativos se existirem
    const entradasEl = document.querySelector('.summary-itemEntradas');
    const saidasEl = document.querySelector('.summary-itemSaidas');
    const saldoEl = document.querySelector('.summary-itemSaldo');
    if (entradasEl) entradasEl.textContent = formatarMoeda(entradas);
    if (saidasEl) saidasEl.textContent = formatarMoeda(saidas);
    if (saldoEl) saldoEl.textContent = formatarMoeda(saldo);
  }

  atualizarGraficos();
}

function filtrarTransacoesPorPeriodo(transacoes, periodo) {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();

  if (periodo === 'personalizado') {
    const dataInicio = document.getElementById('data-inicio')?.value;
    const dataFim = document.getElementById('data-fim')?.value;

    if (!dataInicio || !dataFim) {
      return transacoes;
    }

    return transacoes.filter(t => {
      // Normalizar t.data para string YYYY-MM-DD
      const dateStr = (typeof t.data === 'string' && t.data.includes('T')) ? t.data.split('T')[0] : (typeof t.data === 'string' ? t.data : (t.data instanceof Date ? t.data.toISOString().split('T')[0] : String(t.data)));
      const dataTransacao = new Date(dateStr + 'T00:00:00');
      const inicio = new Date(dataInicio + 'T00:00:00');
      const fim = new Date(dataFim + 'T00:00:00');

      return dataTransacao >= inicio && dataTransacao <= fim;
    });
  }

  return transacoes.filter(t => {
    const dateStr = (typeof t.data === 'string' && t.data.includes('T')) ? t.data.split('T')[0] : (typeof t.data === 'string' ? t.data : (t.data instanceof Date ? t.data.toISOString().split('T')[0] : String(t.data)));
    const dataTransacao = new Date(dateStr + 'T00:00:00');
    
    switch(periodo) {
      case 'mes':
        return dataTransacao.getMonth() === mes && dataTransacao.getFullYear() === ano;
      case 'trimestre':
        const trimestreAtual = Math.floor(mes / 3);
        const trimestreTransacao = Math.floor(dataTransacao.getMonth() / 3);
        return trimestreTransacao === trimestreAtual && dataTransacao.getFullYear() === ano;
      case 'ano':
        return dataTransacao.getFullYear() === ano;
      default:
        return true;
    }
  });
}

// ==================== GRÁFICOS ====================
function inicializarGraficos() {
  const canvasCategorias = document.createElement('canvas');
  canvasCategorias.id = 'grafico-categorias';
  canvasCategorias.style.cssText = 'max-height: 300px;';

  const canvasEvolucao = document.createElement('canvas');
  canvasEvolucao.id = 'grafico-evolucao';
  canvasEvolucao.style.cssText = 'max-height: 300px;';

  const reportSummary = document.querySelector('.report-summary');
  if (reportSummary) {
    const graficoCategorias = document.createElement('div');
    graficoCategorias.className = 'form-card';
    graficoCategorias.style.marginTop = '20px';
    graficoCategorias.innerHTML = '<h3>Gastos por Categoria</h3>';
    graficoCategorias.appendChild(canvasCategorias);

    const graficoEvolucao = document.createElement('div');
    graficoEvolucao.className = 'form-card';
    graficoEvolucao.style.marginTop = '20px';
    graficoEvolucao.innerHTML = '<h3>Evolução do Saldo</h3>';
    graficoEvolucao.appendChild(canvasEvolucao);

    reportSummary.after(graficoCategorias);
    graficoCategorias.after(graficoEvolucao);
  }

  carregarChartJS();
}

function carregarChartJS() {
  if (typeof Chart !== 'undefined') {
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js';
  script.onload = atualizarGraficos;
  document.head.appendChild(script);
}

function atualizarGraficos() {
  if (typeof Chart === 'undefined') return;

  const periodo = document.getElementById('periodo')?.value || 'mes';
  const transacoesFiltradas = filtrarTransacoesPorPeriodo(dados.transacoes, periodo);

  atualizarGraficoCategorias(transacoesFiltradas);
  atualizarGraficoEvolucao(transacoesFiltradas);
}

function atualizarGraficoCategorias(transacoes) {
  const canvas = document.getElementById('grafico-categorias');
  if (!canvas) return;

  const saidas = transacoes.filter(t => t.tipo === 'saida');
  
  if (saidas.length === 0) {
    const container = canvas.parentElement;
    container.innerHTML = '<h3>Gastos por Categoria</h3><p style="text-align: center; color: var(--text-secondary); padding: 40px;">Nenhum gasto registrado neste período</p>';
    return;
  }

  const porCategoria = {};
  saidas.forEach(t => {
    const catNome = obterNomeCategoria(t.categoria, 'saida');
    porCategoria[catNome] = (porCategoria[catNome] || 0) + t.valor;
  });

  const cores = [
    '#e74c3c', '#3498db', '#f39c12', '#9b59b6', 
    '#1abc9c', '#e67e22', '#34495e', '#16a085'
  ];

  if (graficos.categorias) {
    graficos.categorias.destroy();
  }

  graficos.categorias = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: Object.keys(porCategoria),
      datasets: [{
        data: Object.values(porCategoria),
        backgroundColor: cores,
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.label + ': ' + formatarMoeda(context.parsed);
            }
          }
        }
      }
    }
  });
}

function atualizarGraficoEvolucao(transacoes) {
  const canvas = document.getElementById('grafico-evolucao');
  if (!canvas) return;

  if (transacoes.length === 0) {
    const container = canvas.parentElement;
    container.innerHTML = '<h3>Evolução do Saldo</h3><p style="text-align: center; color: var(--text-secondary); padding: 40px;">Nenhuma transação registrada neste período</p>';
    return;
  }

  const ordenadas = [...transacoes].sort((a, b) => new Date(a.data) - new Date(b.data));
  
  const pontos = {};
  let saldoAcumulado = 0;

  ordenadas.forEach(t => {
    const data = formatarData(t.data);
    if (!pontos[data]) {
      pontos[data] = saldoAcumulado;
    }
    saldoAcumulado += t.tipo === 'entrada' ? t.valor : -t.valor;
    pontos[data] = saldoAcumulado;
  });

  if (graficos.evolucao) {
    graficos.evolucao.destroy();
  }

  graficos.evolucao = new Chart(canvas, {
    type: 'line',
    data: {
      labels: Object.keys(pontos),
      datasets: [{
        label: 'Saldo',
        data: Object.values(pontos),
        borderColor: '#2ecc71',
        backgroundColor: 'rgba(46, 204, 113, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return 'Saldo: ' + formatarMoeda(context.parsed.y);
            }
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: function(value) {
              return formatarMoeda(value);
            }
          }
        }
      }
    }
  });
}

// ==================== PERFIL ====================
function salvarPerfil() {
  const nome = document.getElementById('nome-perfil').value;
  const email = document.getElementById('email-perfil').value;

  dados.perfil.nome = nome || 'Usuário';
  dados.perfil.email = email;
  
  salvarDados();
  
  const userNameElement = document.querySelector('.user-name');
  if (userNameElement) {
    userNameElement.textContent = `Olá, ${dados.perfil.nome}!`;
  }

  showToast('Perfil atualizado com sucesso!');
}

// salvar perfil no backend (upsert)
async function salvarPerfil() {
  const nome = document.getElementById('nome-perfil').value;
  const email = document.getElementById('email-perfil').value;
  const moeda = document.getElementById('moeda')?.value;
  const tema = document.getElementById('tema')?.value;
  const pin = document.getElementById('pin')?.value;

  dados.perfil.nome = nome || 'Usuário';
  dados.perfil.email = email;
  if (moeda) dados.perfil.moeda = moeda;
  if (tema) dados.perfil.tema = tema;
  if (pin) dados.perfil.pin = pin;

  salvarDados();

  const userNameElement = document.querySelector('.user-name');
  if (userNameElement) {
    userNameElement.textContent = `Olá, ${dados.perfil.nome}!`;
  }

  // tentar persistir no backend
  try {
    if (email) {
      // não enviar PIN em texto plano em produção; aqui apenas exemplo
      const body = {
        email: email,
        name: dados.perfil.nome,
        currency: dados.perfil.moeda,
        theme: dados.perfil.tema,
        pin_hash: null
      };
      await apiRequest('/users', { method: 'POST', body: JSON.stringify(body) });
      showToast('Perfil atualizado com sucesso!');
    } else {
      showToast('Perfil salvo localmente (sem e-mail).', 'error');
    }
  } catch (err) {
    console.warn('Erro ao salvar perfil no backend:', err.message);
    showToast('Perfil salvo localmente, falha ao sincronizar com servidor.', 'error');
  }
}

function salvarPreferencias() {
  const moeda = document.getElementById('moeda').value;
  const tema = document.getElementById('tema').value;
  const pin = document.getElementById('pin').value;

  dados.perfil.moeda = moeda;
  dados.perfil.tema = tema;
  if (pin) dados.perfil.pin = pin;

  salvarDados();
  aplicarTemaAutomatico();
  atualizarDashboard();
  atualizarListaTransacoes();
  
  showToast('Preferências salvas com sucesso!');
}

function carregarPerfil() {
  const nomeInput = document.getElementById('nome-perfil');
  const emailInput = document.getElementById('email-perfil');
  const moedaSelect = document.getElementById('moeda');
  const temaSelect = document.getElementById('tema');
  const userNameElement = document.querySelector('.user-name');

  if (nomeInput) nomeInput.value = dados.perfil.nome;
  if (emailInput) emailInput.value = dados.perfil.email;
  if (moedaSelect) moedaSelect.value = dados.perfil.moeda;
  if (temaSelect) temaSelect.value = dados.perfil.tema;
  if (userNameElement) userNameElement.textContent = `Olá, ${dados.perfil.nome}!`;
}

function aplicarTemaAutomatico() {
  const tema = dados.perfil.tema;
  
  document.body.classList.remove('tema-escuro', 'tema-claro-forcado');
  
  if (tema === 'escuro') {
    document.body.classList.add('tema-escuro');
  } else if (tema === 'claro') {
    document.body.classList.add('tema-claro-forcado');
  }
}

// ==================== EXPORTAÇÃO ====================
function configurarExportacao() {
  const reportsContainer = document.querySelector('.reports-container');
  if (!reportsContainer) return;

  const botoesExportacao = document.createElement('div');
  botoesExportacao.className = 'export-buttons';
  botoesExportacao.innerHTML = `
    <button onclick="exportarPDF()" class="btn-primary" style="width: 100%;">
      📄 Exportar PDF
    </button>
  `;

  const reportSummary = document.querySelector('.report-summary');
  if (reportSummary) {
    reportSummary.after(botoesExportacao);
  }
}

function exportarPDF() {
  const periodo = document.getElementById('periodo')?.value || 'mes';
  const transacoesFiltradas = filtrarTransacoesPorPeriodo(dados.transacoes, periodo);

  if (transacoesFiltradas.length === 0) {
    showToast('Não há transações para exportar neste período!', 'error');
    return;
  }

  const entradas = calcularTotal('entrada', transacoesFiltradas);
  const saidas = calcularTotal('saida', transacoesFiltradas);
  const saldo = entradas - saidas;

  const periodoTexto = {
    'mes': 'Este Mês',
    'trimestre': 'Este Trimestre',
    'ano': 'Este Ano',
    'personalizado': 'Período Personalizado'
  }[periodo] || 'Período Selecionado';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Relatório Financeiro</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; }
        h1 { color: #2ecc71; text-align: center; }
        h2 { color: #2c3e50; border-bottom: 2px solid #2ecc71; padding-bottom: 10px; }
        .resumo { background: #ecf0f1; padding: 20px; border-radius: 10px; margin: 20px 0; }
        .resumo-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #bdc3c7; }
        .resumo-item:last-child { border-bottom: none; }
        .valor-positivo { color: #2ecc71; font-weight: bold; }
        .valor-negativo { color: #e74c3c; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #2ecc71; color: white; }
        tr:hover { background-color: #f5f5f5; }
        .entrada { color: #2ecc71; }
        .saida { color: #e74c3c; }
      </style>
    </head>
    <body>
      <h1>💰 Controle Financeiro Moderno</h1>
      <p style="text-align: center; color: #7f8c8d;">Relatório Financeiro - ${periodoTexto}</p>
      <p style="text-align: center; color: #7f8c8d;">Gerado em: ${formatarData(new Date().toISOString().split('T')[0])}</p>
      
      <div class="resumo">
        <h2>Resumo do Período</h2>
        <div class="resumo-item">
          <span>Total de Entradas:</span>
          <span class="valor-positivo">${formatarMoeda(entradas)}</span>
        </div>
        <div class="resumo-item">
          <span>Total de Saídas:</span>
          <span class="valor-negativo">${formatarMoeda(saidas)}</span>
        </div>
        <div class="resumo-item">
          <span><strong>Saldo do Período:</strong></span>
          <span class="${saldo >= 0 ? 'valor-positivo' : 'valor-negativo'}"><strong>${formatarMoeda(saldo)}</strong></span>
        </div>
      </div>

      <h2>Transações Detalhadas</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Descrição</th>
            <th>Categoria</th>
            <th>Tipo</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          ${transacoesFiltradas.map(t => `
            <tr>
              <td>${formatarData(t.data)}</td>
              <td>${t.descricao}</td>
              <td>${obterNomeCategoria(t.categoria, t.tipo)}</td>
              <td class="${t.tipo}">${t.tipo === 'entrada' ? 'Entrada' : 'Saída'}</td>
              <td class="${t.tipo}">${formatarMoeda(t.valor)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `;

  const janela = window.open('', '_blank');
  janela.document.write(htmlContent);
  janela.document.close();
  
  setTimeout(() => {
    janela.print();
  }, 500);
  
  showToast('Relatório PDF gerado!');
}

// ==================== FUNÇÕES AUXILIARES ====================
function calcularTotal(tipo, transacoes = dados.transacoes) {
  return transacoes
    .filter(t => t.tipo === tipo)
    .reduce((sum, t) => sum + t.valor, 0);
}

function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: dados.perfil.moeda
  }).format(valor);
}

function formatarData(data) {
  const d = new Date(data + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
}

function obterNomeCategoria(id, tipo) {
  const categoria = dados.categorias[tipo].find(c => c.id === id);
  return categoria ? `${categoria.icone} ${categoria.nome}` : id;
}

function configurarDataMaxima() {
  const hoje = new Date().toISOString().split('T')[0];
  const camposData = document.querySelectorAll('input[type="date"]');
  camposData.forEach(campo => {
    campo.max = hoje;
  });
}

// ==================== EXPOR FUNÇÕES GLOBAIS ====================
window.deletarTransacao = deletarTransacao;
window.editarTransacao = editarTransacao;
window.removerCategoria = removerCategoria;
window.exportarPDF = exportarPDF;
window.fecharModal = fecharModal;
window.toggleMenu = function() {
  const nav = document.querySelector('.main-nav');
  const overlay = document.querySelector('.menu-overlay');
  if (nav && overlay) {
    nav.classList.toggle('active');
    overlay.classList.toggle('active');
  }
};