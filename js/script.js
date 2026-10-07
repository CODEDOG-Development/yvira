/* ==========================================================
   Yvira Engenharia e Meio Ambiente — script.js

   Índice
   0. CONFIG (preencher antes de publicar)
   1. Utilidades
   2. Menu mobile
   3. Hero: terreno topográfico (curvas de nível em canvas)
   4. Mapeamento aéreo: abas
   5. Contatos (lidos do CONFIG)
   6. Formulário de contato
   7. Diagnóstico (7.1 regras · 7.2 etapas · 7.3 resultado)
   8. Inicialização
   ========================================================== */
(() => {
  'use strict';

  /* 0. CONFIG ------------------------------------------------ */
  const CONFIG = {
    whatsapp: '',  // somente números, com DDI e DDD. Ex.: '5531999999999'
    email: '',     // Ex.: 'contato@yvira.eco.br'
    endereco: '',  // Ex.: 'Rua Exemplo, 100 — Cidade/UF'

    // Fase 4: caminho do PHP que grava o diagnóstico no banco.
    // Vazio = o parecer aparece na tela, mas nada é gravado.
    endpointDiagnostico: ''
  };

  /* 1. Utilidades -------------------------------------------- */
  const somenteNumeros = (texto) => texto.replace(/\D/g, '');

  function formatarTelefone(texto) {
    let d = somenteNumeros(texto);
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return texto;
  }

  /* 2. Menu mobile ------------------------------------------- */
  function iniciarMenu() {
    const botao = document.querySelector('.topo__menu');
    const menu = document.getElementById('menu-principal');
    if (!botao || !menu) return;

    const rotulo = botao.querySelector('.sr-only');

    function alternar(abrir) {
      botao.setAttribute('aria-expanded', String(abrir));
      menu.classList.toggle('menu--aberto', abrir);
      rotulo.textContent = abrir ? 'Fechar menu' : 'Abrir menu';
    }

    botao.addEventListener('click', () => {
      alternar(botao.getAttribute('aria-expanded') !== 'true');
    });

    menu.addEventListener('click', (evento) => {
      if (evento.target.closest('a')) alternar(false);
    });

    document.addEventListener('keydown', (evento) => {
      if (evento.key === 'Escape' && botao.getAttribute('aria-expanded') === 'true') {
        alternar(false);
        botao.focus();
      }
    });
  }

  /* 3. Hero: terreno topográfico ----------------------------- */

  // Ruído de valor (value noise): base para gerar o relevo
  function hash(x, y) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  function ruido(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
    const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // Três camadas de ruído somadas: relevo grande + detalhes menores
  function ruidoFractal(x, y) {
    return ruido(x, y) * 0.6 + ruido(x * 2 + 5.2, y * 2 + 1.3) * 0.3 + ruido(x * 4 + 9.1, y * 4 + 3.7) * 0.1;
  }

  // Marching squares: para cada célula, quais arestas a curva de nível atravessa
  // Arestas: 0 = topo, 1 = direita, 2 = base, 3 = esquerda
  const SEGMENTOS = [
    null, [3, 2], [2, 1], [3, 1], [0, 1], [0, 1, 3, 2], [0, 2], [0, 3],
    [0, 3], [0, 2], [0, 3, 2, 1], [0, 1], [3, 1], [2, 1], [3, 2], null
  ];

  function pontoNaAresta(aresta, x, y, cel, a, b, c, d, nivel, saida) {
    if (aresta === 0) {
      saida.x = x + cel * (nivel - a) / (b - a);
      saida.y = y;
    } else if (aresta === 1) {
      saida.x = x + cel;
      saida.y = y + cel * (nivel - b) / (c - b);
    } else if (aresta === 2) {
      saida.x = x + cel * (nivel - d) / (c - d);
      saida.y = y + cel;
    } else {
      saida.x = x;
      saida.y = y + cel * (nivel - a) / (d - a);
    }
  }

  function iniciarTerreno() {
    const canvas = document.querySelector('.hero__terreno');
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx) return;

    const CELULA = 14; // tamanho da célula da grade, em px
    const NIVEIS = Array.from({ length: 16 }, (_, i) => 0.12 + i * 0.055);
    const COR_FINA = 'rgba(76, 175, 125, 0.22)';
    const COR_MESTRA = 'rgba(76, 175, 125, 0.5)';
    const movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)');

    let largura = 0;
    let altura = 0;
    let colunas = 0;
    let linhas = 0;
    let campo = new Float32Array(0);
    let tempo = 0;
    let ultimoQuadro = 0;
    let idAnimacao = 0;
    let visivel = true;
    const ponteiro = { x: 0, y: 0, forca: 0, alvo: 0 };
    const p1 = { x: 0, y: 0 };
    const p2 = { x: 0, y: 0 };

    function calcularCampo() {
      const escala = 0.0045;
      const dx = tempo * 0.012;
      const dy = tempo * 0.006;
      for (let j = 0; j < linhas; j++) {
        for (let i = 0; i < colunas; i++) {
          const px = i * CELULA;
          const py = j * CELULA;
          let valor = ruidoFractal(px * escala + dx, py * escala + dy);
          if (ponteiro.forca > 0.001) {
            const ddx = px - ponteiro.x;
            const ddy = py - ponteiro.y;
            // "Colina" gaussiana que sobe onde o ponteiro está
            valor += 0.3 * ponteiro.forca * Math.exp(-(ddx * ddx + ddy * ddy) / (2 * 170 * 170));
          }
          campo[j * colunas + i] = valor;
        }
      }
    }

    function tracarNivel(nivel) {
      for (let j = 0; j < linhas - 1; j++) {
        for (let i = 0; i < colunas - 1; i++) {
          const a = campo[j * colunas + i];
          const b = campo[j * colunas + i + 1];
          const c = campo[(j + 1) * colunas + i + 1];
          const d = campo[(j + 1) * colunas + i];
          const codigo = (a > nivel ? 8 : 0) | (b > nivel ? 4 : 0) | (c > nivel ? 2 : 0) | (d > nivel ? 1 : 0);
          const pares = SEGMENTOS[codigo];
          if (!pares) continue;
          const x = i * CELULA;
          const y = j * CELULA;
          for (let k = 0; k < pares.length; k += 2) {
            pontoNaAresta(pares[k], x, y, CELULA, a, b, c, d, nivel, p1);
            pontoNaAresta(pares[k + 1], x, y, CELULA, a, b, c, d, nivel, p2);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
          }
        }
      }
    }

    function desenhar() {
      calcularCampo();
      ctx.clearRect(0, 0, largura, altura);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      NIVEIS.forEach((nivel, n) => {
        const mestra = n % 4 === 0; // a cada 4 níveis, uma curva mestra (mais forte)
        ctx.beginPath();
        tracarNivel(nivel);
        ctx.strokeStyle = mestra ? COR_MESTRA : COR_FINA;
        ctx.lineWidth = mestra ? 1.4 : 0.9;
        ctx.stroke();
      });
    }

    function redimensionar() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      largura = canvas.clientWidth;
      altura = canvas.clientHeight;
      canvas.width = Math.round(largura * dpr);
      canvas.height = Math.round(altura * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      colunas = Math.ceil(largura / CELULA) + 1;
      linhas = Math.ceil(altura / CELULA) + 1;
      campo = new Float32Array(colunas * linhas);
      desenhar();
    }

    function quadro(agora) {
      idAnimacao = requestAnimationFrame(quadro);
      if (agora - ultimoQuadro < 33) return; // limita a ~30 quadros por segundo
      tempo += Math.min((agora - ultimoQuadro) / 1000, 0.1);
      ultimoQuadro = agora;
      ponteiro.forca += (ponteiro.alvo - ponteiro.forca) * 0.08;
      desenhar();
    }

    function iniciar() {
      if (idAnimacao || movimentoReduzido.matches || !visivel || document.hidden) return;
      ultimoQuadro = performance.now();
      idAnimacao = requestAnimationFrame(quadro);
    }

    function parar() {
      cancelAnimationFrame(idAnimacao);
      idAnimacao = 0;
    }

    const hero = canvas.parentElement;

    hero.addEventListener('pointermove', (evento) => {
      const caixa = canvas.getBoundingClientRect();
      ponteiro.x = evento.clientX - caixa.left;
      ponteiro.y = evento.clientY - caixa.top;
      ponteiro.alvo = 1;
    });

    hero.addEventListener('pointerleave', () => {
      ponteiro.alvo = 0;
    });

    // Só anima enquanto o hero está na tela e a aba está ativa
    new IntersectionObserver(([entrada]) => {
      visivel = entrada.isIntersecting;
      if (visivel) iniciar(); else parar();
    }).observe(hero);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) parar(); else iniciar();
    });

    movimentoReduzido.addEventListener('change', () => {
      if (movimentoReduzido.matches) parar(); else iniciar();
    });

    new ResizeObserver(redimensionar).observe(canvas);
    iniciar();
  }

  /* 4. Mapeamento aéreo: abas -------------------------------- */
  function iniciarCamadas() {
    const figura = document.querySelector('.mapeamento__figura');
    const abas = Array.from(document.querySelectorAll('.camada'));
    const paineis = Array.from(document.querySelectorAll('.camadas__painel'));
    if (!figura || !abas.length) return;

    function ativar(aba, focar) {
      abas.forEach((item) => {
        const ativa = item === aba;
        item.setAttribute('aria-selected', String(ativa));
        item.tabIndex = ativa ? 0 : -1;
      });
      paineis.forEach((painel) => {
        painel.hidden = painel.id !== aba.getAttribute('aria-controls');
      });
      figura.dataset.ativa = aba.dataset.camada;
      if (focar) aba.focus();
    }

    const teclas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

    abas.forEach((aba, indice) => {
      aba.addEventListener('click', () => ativar(aba, false));
      aba.addEventListener('keydown', (evento) => {
        if (!(evento.key in teclas)) return;
        evento.preventDefault();
        const proxima = (indice + teclas[evento.key] + abas.length) % abas.length;
        ativar(abas[proxima], true);
      });
    });
  }

  /* 5. Contatos (lidos do CONFIG) ---------------------------- */
  function iniciarContatos() {
    const numero = somenteNumeros(CONFIG.whatsapp);
    const dados = {
      whatsapp: numero && { texto: formatarTelefone(CONFIG.whatsapp), href: `https://wa.me/${numero}` },
      email: CONFIG.email && { texto: CONFIG.email, href: `mailto:${CONFIG.email}` },
      endereco: CONFIG.endereco && { texto: CONFIG.endereco }
    };

    document.querySelectorAll('[data-contato]').forEach((item) => {
      const dado = dados[item.dataset.contato];
      if (!dado) return;
      const valor = item.querySelector('.contatos__valor');
      valor.textContent = dado.texto;
      if (dado.href) valor.href = dado.href;
      item.hidden = false;
    });
  }

  /* 6. Formulário -------------------------------------------- */
  function mensagemDeErro(campo) {
    if (campo.validity.valueMissing) return 'Preencha este campo.';
    if (campo.validity.tooShort) return `Use ao menos ${campo.minLength} caracteres.`;
    return 'Confira este campo.';
  }

  function mostrarErro(campo) {
    campo.setAttribute('aria-invalid', 'true');
    const alvo = document.getElementById(`${campo.id}-erro`);
    if (alvo) alvo.textContent = mensagemDeErro(campo);
  }

  function limparErro(campo) {
    if (!campo || !campo.id) return;
    campo.removeAttribute('aria-invalid');
    const alvo = document.getElementById(`${campo.id}-erro`);
    if (alvo) alvo.textContent = '';
  }

  function definirStatus(elemento, texto, tipo) {
    elemento.textContent = texto;
    elemento.dataset.tipo = tipo;
  }

  function montarTexto(dados) {
    const nome = dados.get('nome');
    const empresa = dados.get('empresa');
    const mensagem = dados.get('mensagem');
    return [
      `Olá, Yvira! Meu nome é ${nome}${empresa ? `, da empresa ${empresa}` : ''}.`,
      `Assunto: ${dados.get('servico')}`,
      mensagem ? `Mensagem: ${mensagem}` : '',
      `Meu contato: ${dados.get('contato')}`
    ].filter(Boolean).join('\n');
  }

  function enviar(dados, status) {
    const texto = montarTexto(dados);
    const numero = somenteNumeros(CONFIG.whatsapp);

    if (numero) {
      window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
      definirStatus(status, 'Abrimos o WhatsApp com a sua mensagem pronta. É só enviar.', 'ok');
      return;
    }

    if (CONFIG.email) {
      const assunto = encodeURIComponent(`Contato pelo site: ${dados.get('servico')}`);
      window.location.href = `mailto:${CONFIG.email}?subject=${assunto}&body=${encodeURIComponent(texto)}`;
      definirStatus(status, 'Abrimos o seu e-mail com a mensagem pronta. É só enviar.', 'ok');
      return;
    }

    definirStatus(status, 'Os canais de contato ainda não foram configurados. Preencha CONFIG em js/script.js.', 'erro');
  }

  function iniciarFormulario() {
    const form = document.getElementById('form-contato');
    if (!form) return;

    const status = form.querySelector('.form__status');
    const assunto = form.elements.servico;

    // Links como "Falar sobre o PGRS" já deixam o assunto selecionado no formulário
    document.addEventListener('click', (evento) => {
      const gatilho = evento.target.closest('[data-servico]');
      if (gatilho && gatilho.dataset.servico) assunto.value = gatilho.dataset.servico;
    });

    form.addEventListener('input', (evento) => limparErro(evento.target));

    form.addEventListener('submit', (evento) => {
      evento.preventDefault();
      status.textContent = '';

      const campos = Array.from(form.elements).filter((c) => c.willValidate && c.type !== 'submit');
      const invalidos = campos.filter((c) => !c.checkValidity());
      campos.forEach(limparErro);

      if (invalidos.length) {
        invalidos.forEach(mostrarErro);
        invalidos[0].focus();
        return;
      }

      enviar(new FormData(form), status);
    });
  }

  /* 7. Diagnóstico ------------------------------------------- */

  /* 7.1 Regras do parecer.
     Cada resposta soma pontos de risco. Respostas em CRITICOS levam
     direto ao nível mais alto, independentemente da soma. */
  const PESOS = {
    licenca: { nao: 4, vencida: 3, nao_sei: 2, vigente: 0 },
    notificacao: { sim_aberto: 4, sim_respondido: 1, nao: 0 },
    residuos: { perigosos: 2, comuns: 1, nao: 0 },
    pgrs: { nao: 3, desatualizado: 2, sim: 0 },
    mtr: { nao: 2, as_vezes: 1, sim: 0, nao_se_aplica: 0 },
    inflamaveis: { sim: 1, nao: 0 },
    pgr_pcmso: { nao: 3, parcial: 2, nao_sei: 2, sim: 0 },
    treinamentos_dia: { nao: 3, parcial: 2, nao_sei: 2, sim: 0 }
  };

  // Cada regra: quando `quando` devolve true, o ponto entra no parecer.
  const REGRAS = [
    {
      critico: true,
      quando: (r) => r.licenca === 'nao' || r.licenca === 'vencida',
      texto: 'Operar sem licença ambiental vigente expõe a empresa a autuação e a embargo. Regularizar a licença é a primeira prioridade.'
    },
    {
      critico: true,
      quando: (r) => r.notificacao === 'sim_aberto',
      texto: 'Há notificação ou auto de infração sem resposta. Prazos de defesa são curtos e perdê-los agrava a penalidade.'
    },
    {
      critico: true,
      quando: (r) => r.residuos === 'perigosos' && r.pgrs !== 'sim',
      texto: 'A empresa gera resíduos perigosos sem PGRS implantado e atualizado, o que é exigência legal para essa atividade.'
    },
    {
      critico: true,
      quando: (r) => r.inflamaveis === 'sim' && r.treinamentos_dia !== 'sim',
      texto: 'Há inflamáveis e combustíveis com treinamentos de NR pendentes. A capacitação da NR-20 é obrigatória para quem atua nessas áreas.'
    },
    {
      quando: (r) => r.licenca === 'nao_sei',
      texto: 'A situação da licença ambiental não é conhecida internamente. O primeiro passo é levantar o que está vigente e o que venceu.'
    },
    {
      quando: (r) => r.pgrs === 'desatualizado',
      texto: 'O PGRS existe, mas está desatualizado. Em fiscalização, um plano fora de validade costuma ser tratado como ausência de plano.'
    },
    {
      quando: (r) => r.residuos !== 'nao' && (r.mtr === 'nao' || r.mtr === 'as_vezes'),
      texto: 'A emissão de MTR está irregular. O manifesto é a prova de destinação correta dos resíduos gerados.'
    },
    {
      quando: (r) => r.pgr_pcmso === 'nao' || r.pgr_pcmso === 'parcial',
      texto: 'PGR e PCMSO são documentos-base da gestão de SST. Sem os dois atualizados, os demais controles ficam sem sustentação.'
    },
    {
      quando: (r) => r.pgr_pcmso === 'nao_sei',
      texto: 'Vale confirmar a validade do PGR e do PCMSO: os dois têm prazo de revisão e são os primeiros documentos pedidos em fiscalização.'
    },
    {
      quando: (r) => r.treinamentos_dia === 'nao' || r.treinamentos_dia === 'parcial',
      texto: 'Treinamentos obrigatórios de NR estão pendentes. Além da exigência legal, são eles que sustentam a defesa da empresa em caso de acidente.'
    },
    {
      quando: (r) => r.treinamentos_dia === 'nao_sei',
      texto: 'Não há controle claro da validade dos treinamentos. Um cronograma de reciclagem evita vencimentos silenciosos.'
    },
    {
      quando: (r) => r.notificacao === 'sim_respondido',
      texto: 'Houve notificação já respondida. Vale acompanhar se as exigências foram integralmente cumpridas e arquivadas.'
    }
  ];

  const NIVEIS = {
    alto: {
      selo: 'Atenção imediata',
      titulo: 'Identificamos pendências que pedem ação imediata.',
      resumo: 'Pelas respostas, a empresa está exposta a autuação em pontos que não admitem espera. Recomendamos tratar os itens abaixo antes de qualquer outra frente.'
    },
    medio: {
      selo: 'Pontos a regularizar',
      titulo: 'A base existe, mas há pontos a regularizar.',
      resumo: 'A operação tem estrutura, e identificamos pendências que podem ser resolvidas com um plano de trabalho organizado por prioridade.'
    },
    baixo: {
      selo: 'Situação organizada',
      titulo: 'A sua operação aparenta estar organizada.',
      resumo: 'Pelas respostas, não identificamos pendências graves. O foco passa a ser manter prazos, revisões e treinamentos em dia.'
    }
  };

  function avaliar(respostas) {
    let pontos = 0;
    Object.keys(PESOS).forEach((campo) => {
      const peso = PESOS[campo][respostas[campo]];
      if (peso) pontos += peso;
    });

    const aplicadas = REGRAS.filter((regra) => regra.quando(respostas));
    const temCritico = aplicadas.some((regra) => regra.critico);

    // "Situação organizada" exige lista vazia: um selo verde com pendência abaixo
    // passaria a mensagem errada
    let nivel = 'baixo';
    if (temCritico || pontos >= 10) nivel = 'alto';
    else if (pontos >= 4 || aplicadas.length) nivel = 'medio';

    // Críticos primeiro, e no máximo cinco pontos para o texto não cansar
    const ordenadas = [...aplicadas].sort((a, b) => Number(!!b.critico) - Number(!!a.critico));
    const itens = ordenadas.slice(0, 5).map((regra) => regra.texto);

    if (!itens.length) {
      itens.push('Mantenha o controle de validade das licenças, do PGRS e dos treinamentos: a maior parte das autuações nasce de documento vencido, não de documento inexistente.');
    }

    return { nivel, pontos, itens };
  }

  /* 7.2 Interface por etapas */
  function iniciarDiagnostico() {
    const form = document.getElementById('form-diagnostico');
    if (!form) return;

    const cartao = form.closest('.diagnostico__cartao');
    const etapas = Array.from(form.querySelectorAll('.etapa-form'));
    const passos = Array.from(form.querySelectorAll('.passos__item'));
    const status = form.querySelector('.form__status');
    const parecer = document.getElementById('parecer');
    const btVoltar = form.querySelector('[data-acao="voltar"]');
    const btAvancar = form.querySelector('[data-acao="avancar"]');
    const btEnviar = form.querySelector('[data-acao="enviar"]');
    if (!etapas.length) return;

    let atual = 0;

    function mostrarEtapa(indice) {
      atual = indice;
      etapas.forEach((etapa, i) => { etapa.hidden = i !== indice; });
      passos.forEach((passo, i) => { passo.toggleAttribute('data-ativo', i === indice); });

      const ultima = indice === etapas.length - 1;
      btVoltar.hidden = indice === 0;
      btAvancar.hidden = ultima;
      btEnviar.hidden = !ultima;
      status.textContent = '';
    }

    function irPara(indice) {
      mostrarEtapa(indice);
      cartao.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const primeiro = etapas[indice].querySelector('input, select, textarea');
      if (primeiro) primeiro.focus({ preventScroll: true });
    }

    /* Validação da etapa visível.
       Rádios do mesmo name são um único erro, não um por alternativa. */
    function erroDoGrupo(pergunta, texto) {
      let alvo = pergunta.querySelector('.campo__erro');
      if (!alvo && texto) {
        alvo = document.createElement('p');
        alvo.className = 'campo__erro';
        pergunta.appendChild(alvo);
      }
      if (alvo) alvo.textContent = texto;
    }

    function validarEtapa(etapa) {
      const controles = Array.from(etapa.querySelectorAll('input, select, textarea'))
        .filter((c) => c.willValidate);

      etapa.querySelectorAll('.pergunta').forEach((p) => erroDoGrupo(p, ''));
      controles.forEach(limparErro);

      const vistos = new Set();
      let primeiroInvalido = null;

      controles.forEach((controle) => {
        if (controle.checkValidity()) return;
        if (controle.name && vistos.has(controle.name)) return;
        if (controle.name) vistos.add(controle.name);

        const pergunta = controle.closest('.pergunta');
        if (pergunta) erroDoGrupo(pergunta, 'Escolha uma opção.');
        else mostrarErro(controle);

        if (!primeiroInvalido) primeiroInvalido = controle;
      });

      if (primeiroInvalido) {
        primeiroInvalido.focus();
        definirStatus(status, 'Confira os campos destacados para continuar.', 'erro');
        return false;
      }
      return true;
    }

    /* 7.3 Resultado */
    function preencherParecer(resultado) {
      const nivel = NIVEIS[resultado.nivel];
      parecer.dataset.nivel = resultado.nivel;
      parecer.querySelector('[data-selo]').textContent = nivel.selo;
      parecer.querySelector('[data-parecer-titulo]').textContent = nivel.titulo;
      parecer.querySelector('[data-parecer-resumo]').textContent = nivel.resumo;

      const lista = parecer.querySelector('[data-parecer-pontos]');
      lista.textContent = '';
      resultado.itens.forEach((texto) => {
        const item = document.createElement('li');
        item.textContent = texto;
        lista.appendChild(item);
      });

      form.hidden = true;
      parecer.hidden = false;
      cartao.scrollIntoView({ behavior: 'smooth', block: 'start' });
      parecer.focus({ preventScroll: true });
    }

    async function registrar(dados, resultado) {
      if (!CONFIG.endpointDiagnostico) return;
      dados.append('nivel', resultado.nivel);
      dados.append('pontuacao', String(resultado.pontos));
      try {
        await fetch(CONFIG.endpointDiagnostico, { method: 'POST', body: dados });
      } catch (erro) {
        // O parecer já está na tela: uma falha de rede não pode travar o resultado
        console.error('Diagnóstico não registrado:', erro);
      }
    }

    btAvancar.addEventListener('click', () => {
      if (validarEtapa(etapas[atual])) irPara(atual + 1);
    });

    btVoltar.addEventListener('click', () => irPara(atual - 1));

    form.addEventListener('input', (evento) => {
      limparErro(evento.target);
      const pergunta = evento.target.closest('.pergunta');
      if (pergunta) erroDoGrupo(pergunta, '');
    });

    // Enter em um campo de texto avança a etapa em vez de enviar o formulário
    form.addEventListener('keydown', (evento) => {
      if (evento.key !== 'Enter' || evento.target.tagName === 'TEXTAREA') return;
      if (atual === etapas.length - 1) return;
      evento.preventDefault();
      btAvancar.click();
    });

    form.addEventListener('submit', (evento) => {
      evento.preventDefault();
      if (!validarEtapa(etapas[atual])) return;

      const dados = new FormData(form);
      if (dados.get('site')) return; // honeypot: envio automatizado

      const respostas = Object.fromEntries(dados.entries());
      const resultado = avaliar(respostas);

      preencherParecer(resultado);
      registrar(dados, resultado);
    });

    mostrarEtapa(0);
  }

  /* 8. Inicialização ----------------------------------------- */
  document.querySelectorAll('[data-ano]').forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  iniciarMenu();
  iniciarTerreno();
  iniciarCamadas();
  iniciarContatos();
  iniciarFormulario();
  iniciarDiagnostico();
})();
