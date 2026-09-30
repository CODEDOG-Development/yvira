/* ==========================================================
   Yvira Engenharia e Meio Ambiente — script.js

   Índice
   0. CONFIG (preencher antes de publicar)
   1. Utilidades
   2. Menu mobile
   3. Hero: terreno topográfico (curvas de nível em canvas)
   4. Mapeamento aéreo: abas
   5. Contatos (lidos do CONFIG)
   6. Formulário
   7. Inicialização
   ========================================================== */
(() => {
  'use strict';

  /* 0. CONFIG ------------------------------------------------ */
  const CONFIG = {
    whatsapp: '',  // somente números, com DDI e DDD. Ex.: '5531999999999'
    email: '',     // Ex.: 'contato@yvira.eco.br'
    endereco: ''   // Ex.: 'Rua Exemplo, 100 — Cidade/UF'
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

  /* 7. Inicialização ----------------------------------------- */
  document.querySelectorAll('[data-ano]').forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  iniciarMenu();
  iniciarTerreno();
  iniciarCamadas();
  iniciarContatos();
  iniciarFormulario();
})();
