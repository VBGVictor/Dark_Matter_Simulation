/**
 * Dentro da Teia — filtro "ir até um aglomerado" (F3.15). Botão ◎ ou tecla M; DESLIGADO por padrão
 * (decisão do Victor, 14/10/2026: filtro que liga e desliga, para quem quer andar livre não ser
 * atrapalhado).
 *
 * Dados: ../splats/dados/halos_marcadores.json (halos_marcadores.py, só o catálogo oficial Rockstar;
 * halos principais em ordem de massa). Nada é estimado da imagem.
 *
 * Quais marcadores aparecem (regra do Victor: "os 10 maiores; ao se aproximar, os 10 seguintes
 * daquela região"):
 *   região = esfera em volta do ponto de foco (alvo da câmera) com raio = REGIAO × meia-altura da
 *   vista na distância do foco (× proporção da tela, se mais larga que alta). Na vista da caixa
 *   inteira a região cobre a caixa toda → os 10 maiores de todos. Aproximando, a região encolhe e
 *   entram os maiores DALI. Só conta halo na frente da câmera e dentro da tela. Nunca mais de 10.
 *   REGIAO = 1,2 é CONVENÇÃO (folga para a vista inicial pegar a caixa inteira).
 *
 * Anel = raio virial do catálogo projetado na tela (mínimo de 9 px para dar para clicar).
 * Clique → a câmera voa até o centro do halo e para a uma distância em que o diâmetro virial ocupa
 * OCUPACAO da altura da vista (convenção: 0,6); abre o cartão do halo com os números do catálogo.
 */
import * as THREE from "three";

const MAXIMO = 10;
const REGIAO = 1.2;
const OCUPACAO = 0.6;
const RAIO_MIN_PX = 9;
const H = 0.6711;                     // h (teoria_lcdm.COSMO.h) — raio do catálogo em Mpc/h → kpc
const ANOS_LUZ_POR_KPC = 3261.563777; // IAU (o mesmo de classes_halos.py)
// F3.4 (22/10/2026): "massa ≈ X Vias Lácteas". Massa virial da Via Láctea = 1,3 ± 0,3 × 10¹² M☉
// (Bland-Hawthorn & Gerhard 2016, Annu. Rev. A&A 54, 529, §6.3 — conferido no PDF). Incerteza de ±23 % dita no cartão.
const MASSA_VIA_LACTEA = 1.3e12;
function textoViasLacteas(m) {
  const r = m / MASSA_VIA_LACTEA;
  const fmt = (x) => x.toLocaleString("pt-BR", { maximumSignificantDigits: 2 });
  if (r >= 1.5) return `≈ ${fmt(r)} Vias Lácteas`;
  if (r >= 0.67) return "≈ 1 Via Láctea";
  return `≈ 1/${fmt(1 / r)} da Via Láctea`;
}
// Clique (correção de 20/10/2026, pedido do Victor: "a câmera tem que funcionar normal com o M
// ligado"). Antes, o anel era um botão clicável por inteiro: de perto, o anel do halo em foco cobria
// a tela e engolia a roda do mouse e o arrasto. Agora anéis e rótulos são só desenho; o clique é
// detectado sobre a cena: toque rápido (sem arrastar) perto do CENTRO de um anel ou sobre o rótulo.
const CLIQUE_RAIO_MAX_PX = 40;   // anel grande: só conta perto do centro (não a área toda)
const CLIQUE_MOVIMENTO_PX = 6;   // mais que isso entre apertar e soltar = arrasto (é da câmera)
const CLIQUE_TEMPO_MS = 500;

/**
 * Qual marcador o clique em (x, y) acerta. alvos = [{ indice, x, y, r, rotulo: {x0,x1,y0,y1} | null }].
 * Acerta se estiver a ≤ min(r, 40 px) do centro (no mínimo 9 px) ou dentro do rótulo; havendo
 * vários, fica o de anel menor (o mais específico). Devolve o índice do halo ou null. Função pura
 * (testada no Node sem navegador).
 */
export function marcadorNoClique(alvos, x, y) {
  let melhor = null;
  for (const a of alvos) {
    const raio = Math.max(RAIO_MIN_PX, Math.min(a.r, CLIQUE_RAIO_MAX_PX));
    const noCentro = Math.hypot(x - a.x, y - a.y) <= raio;
    const q = a.rotulo;
    const noRotulo = q && x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1;
    if ((noCentro || noRotulo) && (melhor === null || a.r < melhor.r)) melhor = a;
  }
  return melhor ? melhor.indice : null;
}

export function criarMarcadores(c) {
  // c = { camera, controls, renderer, animarPara, distanciaMin, distanciaMax, ladoCaixa, textoMassa,
  //       textoAnosLuz, classes: () => classesHalos, massaPorMancha: () => M☉ ou null, arquivo }
  let dados = null, ligado = false, visiveis = [], alvos = [];
  const camada = Object.assign(document.createElement("div"), { id: "marcadores", hidden: true });
  document.body.appendChild(camada);
  const cartao = Object.assign(document.createElement("aside"), { id: "halo-info", hidden: true });
  cartao.setAttribute("aria-live", "polite");
  document.body.appendChild(cartao);
  const elementos = Array.from({ length: MAXIMO }, () => {
    const b = document.createElement("button");
    b.className = "marcador";
    b.innerHTML = `<span class="anel"></span><span class="rotulo"></span>`;
    // continua botão para o teclado (Tab + Enter); o mouse passa direto para a cena (ver CSS)
    b.addEventListener("click", (e) => { e.stopPropagation(); voar(Number(b.dataset.indice)); });
    camada.appendChild(b);
    return b;
  });
  // clique detectado na cena, sem bloquear a câmera
  const tela = c.renderer.domElement;
  let apertou = null;
  const posNaTela = (e) => { const r = tela.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  tela.addEventListener("pointerdown", (e) => { if (e.button === 0) apertou = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  tela.addEventListener("pointerup", (e) => {
    if (!ligado || !apertou || e.button !== 0) return;
    const rapido = performance.now() - apertou.t < CLIQUE_TEMPO_MS;
    const parado = Math.hypot(e.clientX - apertou.x, e.clientY - apertou.y) < CLIQUE_MOVIMENTO_PX;
    apertou = null;
    if (!rapido || !parado) return;
    const i = marcadorNoClique(alvos, ...posNaTela(e));
    if (i !== null) voar(i);
  });
  tela.addEventListener("pointermove", (e) => {   // mãozinha quando dá para clicar num halo
    if (!ligado) return;
    tela.style.cursor = marcadorNoClique(alvos, ...posNaTela(e)) !== null ? "pointer" : "";
  });
  // catálogo do universo aberto (21/10: nos universos do laboratório, halos pelo FoF — splats/halos_fof.py)
  const carregar = (url) => fetch(`../splats/dados/${url}`).then((r) => (r.ok ? r.json() : null))
    .then((d) => { dados = d; return d; }).catch(() => { dados = null; return null; });
  let pronto = carregar(c.urlHalos ? c.urlHalos() : "halos_marcadores.json");
  /** Troca o catálogo (mudou o universo): desliga os marcadores e carrega o do universo novo. */
  async function recarregar() {
    await alternar(false);
    dados = null;
    pronto = carregar(c.urlHalos ? c.urlHalos() : "halos_marcadores.json");
    return pronto;
  }

  const halo = (i) => {
    const h = dados.halos[i];
    return { indice: i, centro: new THREE.Vector3(h[0], h[1], h[2]), massa: h[3], rvir: h[4], nSub: h[5] };
  };
  const classe = (m) => {
    const cl = c.classes();
    if (!cl) return "";
    const k = cl.classes.find((x) => m >= x.faixa_msun[0] && (x.faixa_msun[1] === null || m < x.faixa_msun[1]));
    return k ? k.nome : "";
  };

  /** Escolhe os até 10 halos de maior massa na região em volta do foco (regra no topo do arquivo). */
  function escolher() {
    const { camera, controls } = c;
    const d = camera.position.distanceTo(controls.target);
    const meia = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const raio = REGIAO * d * meia * Math.max(1, camera.aspect);
    camera.updateMatrixWorld();
    const p = new THREE.Vector3(), escolhidos = [];
    for (let i = 0; i < dados.halos.length && escolhidos.length < MAXIMO; i++) {
      const h = dados.halos[i];
      p.set(h[0], h[1], h[2]);
      if (p.distanceTo(controls.target) > raio) continue;
      const ndc = p.clone().project(camera);
      if (ndc.z > 1 || ndc.z < -1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;
      escolhidos.push(i);
    }
    return { escolhidos, raio };
  }

  /** Chamar a cada quadro: reposiciona os marcadores. */
  function atualizar() {
    if (!ligado || !dados) return;
    const { camera, renderer } = c;
    const { escolhidos } = escolher();
    visiveis = escolhidos;
    alvos = [];
    const tela = renderer.domElement.getBoundingClientRect();
    const meia = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // Rótulos sem sobreposição: o de maior massa (vem primeiro) fica com o texto completo; um vizinho
    // que colidir mostra só "nº k"; se ainda colidir, fica só o anel (o texto continua no cartão).
    const ocupados = [];
    const colide = (q) => ocupados.some((o) => q.x0 < o.x1 && q.x1 > o.x0 && q.y0 < o.y1 && q.y1 > o.y0);
    const caixaTexto = (x, y, texto) => {
      const w = texto.length * 6.2 + 6;  // largura aproximada a 11 px (sem medir o DOM a cada quadro)
      return { x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + 15 };
    };
    elementos.forEach((el, k) => {
      if (k >= escolhidos.length) { el.hidden = true; return; }
      const h = halo(escolhidos[k]);
      const ndc = h.centro.clone().project(camera);
      const x = (ndc.x + 1) / 2 * tela.width, y = (1 - ndc.y) / 2 * tela.height;
      const dist = camera.position.distanceTo(h.centro);
      const r = Math.max(RAIO_MIN_PX, h.rvir / (dist * meia) * tela.height / 2);
      el.hidden = false;
      el.dataset.indice = String(h.indice);
      el.style.transform = `translate(${x}px, ${y}px)`;
      const anel = el.firstElementChild;
      anel.style.width = anel.style.height = `${2 * r}px`;
      anel.style.marginLeft = anel.style.marginTop = `${-r}px`;
      el.lastElementChild.style.top = `${r + 2}px`;
      const completo = `nº ${h.indice + 1} · ${c.textoMassa(h.massa)}`, curto = `nº ${h.indice + 1}`;
      let texto = "", caixaRotulo = null;
      for (const tentativa of [completo, curto]) {
        const q = caixaTexto(x, y + r + 2, tentativa);
        if (!colide(q)) { texto = tentativa; caixaRotulo = q; ocupados.push(q); break; }
      }
      alvos.push({ indice: h.indice, x, y, r, rotulo: caixaRotulo });
      el.lastElementChild.textContent = texto;
      el.title = `${classe(h.massa)} — clique para ir até ele`;
      el.setAttribute("aria-label", `Halo nº ${h.indice + 1}, ${classe(h.massa)}, ${c.textoMassa(h.massa)}. Ir até ele.`);
    });
  }

  /** Distância de chegada: diâmetro virial ocupa OCUPACAO da altura da vista (respeita os limites). */
  function distanciaChegada(rvir) {
    const meia = Math.tan(THREE.MathUtils.degToRad(c.camera.fov / 2));
    return THREE.MathUtils.clamp(rvir / (OCUPACAO * meia), c.distanciaMin, c.distanciaMax);
  }

  let escolhido = null;   // F3.12: o último halo clicado entra no CSV/PDF
  /** Voa até o halo i (índice na lista por massa) e mostra o cartão. */
  function voar(i) {
    const h = halo(i);
    escolhido = { numero: h.indice + 1, massa: h.massa };
    const dir = c.camera.position.clone().sub(c.controls.target);
    if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
    const destino = h.centro.clone().add(dir.setLength(distanciaChegada(h.rvir)));
    c.animarPara(destino, h.centro);
    mostrarCartao(h);
    return { destino, alvo: h.centro };
  }

  function mostrarCartao(h) {
    const mp = dados.massa_particula_msun;
    const particulas = Math.round(h.massa / mp);
    const porMancha = c.massaPorMancha();
    const manchas = porMancha ? Math.round(h.massa / porMancha) : null;
    const meio = c.ladoCaixa / 2;
    const naBorda = [h.centro.x, h.centro.y, h.centro.z].some((v) => Math.abs(v) + h.rvir > meio);
    const d = distanciaChegada(h.rvir);
    const fof = !!dados.definicao_massa;   // halos do FoF (universos do laboratório) × Rockstar (Universo 1)
    const linkCompleta = /completa/.test(c.arquivo) || /^universos\//.test(c.arquivo) ? "" :
      `<p><a href="?arquivo=teia_completa_magma.spz&alvo=${h.centro.toArray().map((v) => v.toFixed(4)).join(",")}` +
      `&dist=${d.toFixed(4)}">Ver este halo na versão completa</a> (todas as partículas; ~1 min para abrir).</p>`;
    cartao.innerHTML = `<h2>Halo nº ${h.indice + 1} <span>de ${dados.total.toLocaleString("pt-BR")}, por massa</span>
      <button id="bt-fechar-halo" aria-label="Fechar">×</button></h2>
      <p><b>${classe(h.massa) || "Halo"}</b> · ${c.textoMassa(h.massa)}</p>
      <table>
        <tr><td>Comparado à Via Láctea</td><td>${textoViasLacteas(h.massa)}</td></tr>
        <tr><td>Partículas da simulação</td><td>${particulas.toLocaleString("pt-BR")}</td></tr>
        ${manchas !== null && manchas !== particulas ? `<tr><td>Manchas nesta versão</td><td>≈ ${manchas.toLocaleString("pt-BR")}</td></tr>` : ""}
        <tr><td>${fof ? "Raio (estimado pela massa)" : "Raio virial"}</td><td>${c.textoAnosLuz(h.rvir / H * 1000 * ANOS_LUZ_POR_KPC)}</td></tr>
        ${h.nSub === null || h.nSub === undefined ? "" : `<tr><td>Sub-halos (catálogo)</td><td>${h.nSub.toLocaleString("pt-BR")}</td></tr>`}
      </table>
      ${naBorda ? `<p class="nota">Encosta na borda da caixa: na simulação ele continua do outro lado (a caixa é periódica); aqui aparece cortado.</p>` : ""}
      ${linkCompleta}
      <p class="nota">${fof
        ? "Halos localizados por nós com o método friends-of-friends (Davis et al. 1985; b = 0,2, a convenção usada no Millennium, Springel et al. 2005) — o catálogo oficial deste universo não foi publicado. Massa = massa do grupo; raio estimado pela massa a 200× a densidade média. Conferido contra o catálogo oficial no Universo 1 (10 maiores a < 0,1 Mpc/h, massa ×1,03)."
        : "Catálogo Rockstar do CAMELS (z = 0). Massa e raio virial: Bryan &amp; Norman (1998)."}
      Partículas = massa ÷ massa de uma partícula. Via Láctea: halo de 1,3 ± 0,3 trilhão de sóis (Bland-Hawthorn &amp;
      Gerhard 2016) — a comparação tem essa incerteza (±23 %). Simulação só de matéria escura: não há estrelas.</p>`;
    cartao.hidden = false;
    document.getElementById("bt-fechar-halo").addEventListener("click", () => { cartao.hidden = true; });
  }

  async function alternar(estado = !ligado) {
    await pronto;
    ligado = estado && !!dados;
    camada.hidden = !ligado;
    if (!ligado) {
      escolhido = null;
      cartao.hidden = true; elementos.forEach((el) => { el.hidden = true; }); visiveis = []; alvos = [];
      c.renderer.domElement.style.cursor = "";
    }
    const bt = document.getElementById("bt-marcadores");
    if (bt) bt.setAttribute("aria-pressed", String(ligado));
    atualizar();
    return ligado;
  }

  return { get pronto() { return pronto; }, recarregar, alternar, atualizar, voar, escolher, distanciaChegada,
           disponivel: () => !!dados, haloEscolhido: () => escolhido, textoViasLacteas,
           ligado: () => ligado, visiveis: () => visiveis.slice(), alvos: () => alvos.slice(), dados: () => dados };
}
