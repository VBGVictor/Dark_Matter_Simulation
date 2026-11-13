/**
 * Dentro da Teia — esqueleto da teia e passeio "montanha-russa" por ele (F3.20, 28/10/2026). Botão 〰 ou tecla V.
 *
 * Dados (splats/esqueleto_mst.py; nada estimado da imagem):
 *   ../splats/dados/esqueleto_mst.json      árvore geradora mínima dos halos e sub-halos do Rockstar (Barrow, Bhavsar &
 *                                            Sonoda 1985; sub-halos como em Colberg 2007, nota 3), com as ligações mais
 *                                            longas que b cortadas pelo critério de Alpaslan et al. 2014 → filamentos
 *   ../splats/dados/esqueleto_passeio.json  o trilho: espinha da árvore INTEIRA (caminho mais longo de ponta a ponta)
 *
 * Esqueleto: linhas azuis retas entre centros de halos (filtro, desligado por padrão).
 * Passeio (pedido do Victor, 28/10: "passear pelo cubo quase inteiro [...] como uma montanha-russa, sentado em cima,
 * seguindo a linha e podendo mexer a tela para ver enquanto anda"; a 1ª versão — câmera de fora, 40 s num filamento
 * só — não era isso):
 *   - a câmera vai EM CIMA do trilho (ASSENTO acima da linha), em velocidade constante ajustável;
 *   - arrastar na tela vira a cabeça (olhar para os lados/cima/baixo) SEM parar o passeio; "olhar para a frente" volta;
 *   - o trilho é desenhado: amarelo onde a ligação é de filamento (≤ b), cinza-azulado onde atravessa entre filamentos;
 *   - a caixa é periódica: ao cruzar uma parede a câmera reaparece do lado oposto (é assim na simulação), com aviso;
 *   - o caminho real ziguezagueia de halo em halo (~0,3 Mpc/h entre eles, com curvas em U onde entra e sai de um
 *     aglomerado): qualquer câmera presa nele sacode. Medido em 28/10 (giro da vista a 1 Mpc/h/s): olhando para a
 *     corda de ±2 a ±6 Mpc/h, máx 87 a 26°/s, mas com ±6 o trilho sai da tela; olhando 1–4 Mpc/h à frente, até 284°/s.
 *     Solução (CONVENÇÃO visual, dita no painel): (1) o trilho em que se anda é o caminho real SUAVIZADO por uma média
 *     gaussiana de σ = SUAVE Mpc/h (passa a ≤ 0,3 Mpc/h das ligações reais; mediana 0,12); (2) a cabeça olha
 *     AFRENTE Mpc/h adiante no trilho, mas vira no máximo GIRO_MAX_GRAUS_S — numa curva em U ela vai virando aos
 *     poucos, como a cabeça de quem está no carrinho.
 *   - PARA ONDE OLHAR (pedido do Victor, 28/10: "não para o rumo do filamento, mas para o rumo mais panorâmico
 *     possível, olhando para dentro da caixa, onde vão estar as teias"): padrão = para o CENTRO DO CUBO (de dentro da
 *     caixa, é a direção que põe mais caixa na frente). Perto do centro (< ZONA_CENTRO) a direção fica indefinida → a
 *     cabeça mantém para onde estava. Ao atravessar uma parede o centro passa a ficar do outro lado: a cabeça vira com o
 *     mesmo limite de giro (sem salto). Opção no painel: "para a frente do trilho" (o modo anterior).
 * Sai: botão "sair", tecla Esc ou H (voltar à caixa). Espaço pausa.
 */
import * as THREE from "three";

const VELOCIDADE_PADRAO = 1.0;   // Mpc/h por segundo (≈ 4,9 milhões de anos-luz/s): o trilho inteiro em ~3 min
const ASSENTO = 0.05;            // Mpc/h acima da linha (sentado em cima do trilho) — CONVENÇÃO visual
const FOCO = 1.0;                // Mpc/h à frente: ponto de foco (plano da névoa e da régua)
const SUAVE = 0.5;               // Mpc/h: σ da média gaussiana do trilho (ver cabeçalho)
const AMOSTRA = 0.05;            // Mpc/h entre amostras do trilho
const AFRENTE = 2.0;             // Mpc/h: para onde a cabeça quer olhar, adiante no trilho
const GIRO_MAX_GRAUS_S = 40;     // a cabeça vira no máximo isso (o giro automático da caixa faz 9°/s)
const ZONA_CENTRO = 4.0;         // Mpc/h: mais perto que isso do centro, a cabeça não persegue o centro (CONVENÇÃO)
const PASSO_MAX_S = 0.5;         // contra saltos de aba escondida (como no tempo.js)
const SENSIBILIDADE = 0.005;     // radianos por pixel de arrasto
const COR_ESQUELETO = 0x7fd8ff;
const COR_FILAMENTO = new THREE.Color(0xffc86e), COR_ENTRE = new THREE.Color(0x8fa3c8);
const CIMA = new THREE.Vector3(0, 1, 0);

export function criarEsqueleto(c) {
  // c = { scene, camera, controls, renderer, animarPara, animando: () => bool, marcadores, textoMassa, textoAnosLuz,
  //       anosLuzPorMpcH, avisar, ladoCaixa, motivoIndisponivel: () => string | null, aoMexer, pararGiro }
  const L = c.ladoCaixa;
  const painel = Object.assign(document.createElement("aside"), { id: "esqueleto", hidden: true });
  painel.setAttribute("aria-label", "Esqueleto da teia");
  document.body.appendChild(painel);
  const hud = Object.assign(document.createElement("div"), { id: "hud-passeio", hidden: true });
  document.body.appendChild(hud);
  let dados = null, trilhoDados = null, linhas = null, trilho = null, curva = null, comprimento = 0, mostrar = false;
  let rail = null;      // trilho suavizado: { pts: Vector3[], acum: Mpc/h acumulado, tOrig: posição no caminho real, desvio }
  let passeio = null;   // { fase: "indo" | "andando", dist, ultimo, pausado, yaw, pitch, base: Vector3, dobra, paredes }
  let velocidade = VELOCIDADE_PADRAO, mensagem = "";
  let modoOlhar = "caixa";   // "caixa" (para o centro do cubo, padrão) | "frente" (para onde o trilho vai)

  const pronto = Promise.all([
    fetch("../splats/dados/esqueleto_mst.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("../splats/dados/esqueleto_passeio.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([d, p]) => { dados = d; trilhoDados = p; if (d && p) montarGeometria(); return d && p; });

  /** Dobra um ponto (coordenadas desembrulhadas) para dentro da caixa centrada: devolve o deslocamento usado. */
  const dobra = (p) => new THREE.Vector3(...["x", "y", "z"].map((e) => -L * Math.floor((p[e] + L / 2) / L)));

  function montarGeometria() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dados.segmentos.flat()), 3));
    // por cima das manchas (sem teste de profundidade): as manchas são semitransparentes e apagavam as linhas finas
    linhas = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: COR_ESQUELETO, transparent: true, opacity: 0.85, depthTest: false }));
    linhas.renderOrder = 10; linhas.visible = false;
    c.scene.add(linhas);
    const pts = trilhoDados.pontos.map((p) => new THREE.Vector3(...p));
    curva = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    curva.arcLengthDivisions = 50 * pts.length;   // o padrão (200) é grosso demais para 527 pontos
    curva.updateArcLengths();
    // amostras uniformes do caminho real → média gaussiana (σ = SUAVE) → trilho em que se anda
    const n = Math.ceil(curva.getLength() / AMOSTRA);
    const brutos = [], tOrig = [];
    for (let i = 0; i <= n; i++) { brutos.push(curva.getPointAt(i / n)); tOrig.push(curva.getUtoTmapping(i / n) * (pts.length - 1)); }
    const s = SUAVE / (curva.getLength() / n), R = Math.ceil(3 * s);
    const peso = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-0.5 * ((k - R) / s) ** 2));
    const suaves = brutos.map((_, i) => {
      const v = new THREE.Vector3(); let W = 0;
      for (let k = -R; k <= R; k++) { const j = Math.min(n, Math.max(0, i + k)); v.addScaledVector(brutos[j], peso[k + R]); W += peso[k + R]; }
      return v.multiplyScalar(1 / W);
    });
    const acum = [0];
    for (let i = 1; i <= n; i++) acum.push(acum[i - 1] + suaves[i].distanceTo(suaves[i - 1]));
    rail = { pts: suaves, acum, tOrig, desvio: brutos.map((b, i) => b.distanceTo(suaves[i])) };
    comprimento = acum[n];
    // trilho desenhado = o suavizado (é nele que se anda), dobrado para dentro da caixa em pedaços; cor pela ligação real
    const pos = [], cor = [];
    let ant = null, antCor = null;
    for (let i = 0; i <= n; i++) {
      const p = suaves[i].clone();
      p.add(dobra(p));
      const k = Math.min(trilhoDados.passos_mpc_h.length - 1, Math.floor(tOrig[i]));
      const cc = trilhoDados.passos_mpc_h[k] <= trilhoDados.b_mpc_h ? COR_FILAMENTO : COR_ENTRE;
      if (ant && ant.distanceTo(p) < L / 2) { pos.push(ant.x, ant.y, ant.z, p.x, p.y, p.z); cor.push(...antCor.toArray(), ...cc.toArray()); }
      ant = p; antCor = cc;
    }
    const gt = new THREE.BufferGeometry();
    gt.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    gt.setAttribute("color", new THREE.Float32BufferAttribute(cor, 3));
    trilho = new THREE.LineSegments(gt, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }));
    trilho.renderOrder = 11; trilho.visible = false;
    c.scene.add(trilho);
  }

  const disponivel = () => !!dados && !!trilhoDados && !c.motivoIndisponivel();
  function motivo() {
    if (!dados || !trilhoDados) return "Os arquivos do esqueleto não carregaram (rode <code>splats/esqueleto_mst.py</code>).";
    return c.motivoIndisponivel();
  }

  /** Índice da amostra do trilho na distância d (Mpc/h) e a fração até a próxima. */
  function amostra(d) {
    const a = rail.acum, x = THREE.MathUtils.clamp(d, 0, comprimento);
    let lo = 0, hi = a.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m; else hi = m; }
    return { i: lo, f: a[hi] > a[lo] ? (x - a[lo]) / (a[hi] - a[lo]) : 0 };
  }
  /** Ponto do trilho suavizado (desembrulhado) na distância d. */
  function pontoEm(d) {
    const { i, f } = amostra(d);
    return rail.pts[i].clone().lerp(rail.pts[Math.min(i + 1, rail.pts.length - 1)], f);
  }
  /** Para onde a cabeça quer olhar na distância d: AFRENTE adiante no trilho (no fim, a direção de chegada). */
  function desejada(d) {
    const v = d + AFRENTE <= comprimento ? pontoEm(d + AFRENTE).sub(pontoEm(d))
      : pontoEm(comprimento).sub(pontoEm(comprimento - AFRENTE));
    return v.normalize();
  }
  /** Para onde a cabeça quer olhar na distância d, conforme o modo; `base` = para onde olha agora. */
  function desejadaPara(d, base) {
    if (modoOlhar === "frente") return desejada(d);
    const p = pontoEm(d);
    const centro = p.add(dobra(p)).negate();      // do ponto (dentro da caixa centrada) até o centro (origem)
    if (centro.length() < ZONA_CENTRO) return base.clone();
    return centro.normalize();
  }

  /** Gira `base` em direção a `alvo` no máximo `maxRad` (devolve o vetor novo). */
  function girarAte(base, alvo, maxRad) {
    const ang = Math.acos(THREE.MathUtils.clamp(base.dot(alvo), -1, 1));
    if (ang <= maxRad || ang < 1e-9) return alvo.clone();
    let eixo = new THREE.Vector3().crossVectors(base, alvo);
    if (eixo.lengthSq() < 1e-12) eixo = new THREE.Vector3().crossVectors(base, CIMA);
    if (eixo.lengthSq() < 1e-12) eixo.set(1, 0, 0);
    return base.clone().applyAxisAngle(eixo.normalize(), maxRad).normalize();
  }

  /** Posição (desembrulhada) na distância `dist` e foco olhando para `base` com a cabeça virada (yaw, pitch). */
  function pose(dist, yaw = 0, pitch = 0, base = desejada(dist)) {
    // cabeça virada em relação à direção do olhar: "lado" e "cima local" perpendiculares a ela (assim virar 90° dá
    // sempre 90°, mesmo com o trilho quase vertical; com o eixo vertical do mundo isso falhava — teste U14)
    let lado = new THREE.Vector3().crossVectors(base, CIMA);
    if (lado.lengthSq() < 1e-8) lado.set(1, 0, 0);
    lado.normalize();
    const cimaLocal = new THREE.Vector3().crossVectors(lado, base).normalize();
    const olhar = base.clone().applyAxisAngle(cimaLocal, yaw);
    olhar.applyAxisAngle(new THREE.Vector3().crossVectors(olhar, cimaLocal).normalize(), pitch).normalize();
    const posicao = pontoEm(dist).addScaledVector(CIMA, ASSENTO);
    return { posicao, alvo: posicao.clone().addScaledVector(olhar, FOCO) };
  }

  function aplicarPose() {
    const p = pose(passeio.dist, passeio.yaw, passeio.pitch, passeio.base);
    const d = dobra(p.posicao);
    const chave = d.toArray().join();
    if (passeio.dobra !== null && chave !== passeio.dobra) {
      passeio.paredes++;
      c.avisar("Você atravessou uma parede do cubo e voltou pelo lado oposto: a simulação é <b>periódica</b> — o que sai " +
               "de um lado entra pelo outro, como num videogame antigo. A teia continua.", 5000);
    }
    passeio.dobra = chave;
    c.camera.position.copy(p.posicao.add(d));
    c.controls.target.copy(p.alvo.add(d));
    c.camera.lookAt(c.controls.target);
    c.aoMexer();
  }

  function mostrarEsqueleto(estado = !mostrar) {
    mostrar = estado && disponivel();
    if (linhas) linhas.visible = mostrar;
    montar();
    return mostrar;
  }

  function iniciar() {
    if (!disponivel()) { mensagem = motivo(); montar(); return false; }
    c.pararGiro();
    const p = pose(0);
    const d = dobra(p.posicao);
    c.animarPara(p.posicao.add(d), p.alvo.add(d));
    passeio = { fase: "indo", dist: 0, ultimo: null, pausado: false, yaw: 0, pitch: 0, base: desejadaPara(0, desejada(0)), dobra: null, paredes: 0 };
    mensagem = "";
    if (trilho) trilho.visible = true;
    hud.hidden = false;
    montar();
    return true;
  }

  function parar(texto = "Passeio encerrado — a câmera voltou a ser sua (arrastar gira em volta do foco).") {
    if (!passeio) return;
    passeio = null;
    c.controls.enabled = true;
    hud.hidden = true;
    if (trilho) trilho.visible = !painel.hidden;
    mensagem = texto;
    montar();
  }

  function pausar(estado = !(passeio && passeio.pausado)) {
    if (!passeio) return false;
    passeio.pausado = estado; passeio.ultimo = null;
    montar();
    return estado;
  }

  /** Vira a cabeça (radianos). Arrastar na tela chama isto; o passeio continua. */
  function olhar(dYaw, dPitch) {
    if (!passeio) return;
    passeio.yaw += dYaw;
    passeio.pitch = THREE.MathUtils.clamp(passeio.pitch + dPitch, -1.4, 1.4);
    if (passeio.fase === "andando") aplicarPose();
  }
  function olharParaFrente() { if (passeio) { passeio.yaw = 0; passeio.pitch = 0; if (passeio.fase === "andando") aplicarPose(); } }

  // arrasto na tela durante o passeio = virar a cabeça (OrbitControls fica desligado enquanto anda)
  const tela = c.renderer.domElement;
  let arrasto = null;
  tela.addEventListener("pointerdown", (e) => {
    if (!passeio || passeio.fase !== "andando") return;
    arrasto = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointermove", (e) => {
    if (!arrasto) return;
    olhar(-(e.clientX - arrasto.x) * SENSIBILIDADE, -(e.clientY - arrasto.y) * SENSIBILIDADE);
    arrasto = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointerup", () => { arrasto = null; });
  window.addEventListener("keydown", (e) => {
    if (!passeio || (e.target.closest && e.target.closest("input, textarea, select"))) return;
    if (e.key === "Escape") parar();
    else if (e.key === " ") { e.preventDefault(); pausar(); }
  });

  /** Chamar a cada quadro (agora em ms). Separado do laço para os testes simularem o tempo. */
  function quadro(agora) {
    if (!passeio) return;
    if (passeio.fase === "indo") {
      if (c.animando()) { passeio.ultimo = agora; return; }
      passeio.fase = "andando"; passeio.ultimo = agora;
      c.controls.enabled = false;
    }
    const dt = passeio.ultimo === null || passeio.pausado ? 0 : Math.min(PASSO_MAX_S, (agora - passeio.ultimo) / 1000);
    passeio.ultimo = agora;
    passeio.dist = Math.min(comprimento, passeio.dist + velocidade * dt);
    passeio.base = girarAte(passeio.base, desejadaPara(passeio.dist, passeio.base), THREE.MathUtils.degToRad(GIRO_MAX_GRAUS_S) * dt);
    aplicarPose();
    atualizarHud();
    if (passeio.dist >= comprimento) {
      const n = trilhoDados.donos.length - 1;
      parar(`Fim do trilho: aglomerado nº ${trilhoDados.donos[n] + 1} (${c.textoMassa(trilhoDados.massas_msun[n])}). ` +
            `${al(comprimento)} percorridos; a câmera voltou a ser sua.`);
    }
  }

  const al = (mpch) => c.textoAnosLuz(mpch * c.anosLuzPorMpcH);

  /** Onde estou: índice do ponto do trilho, se a ligação é de filamento e se estou dentro de um aglomerado. */
  function ondeEstou() {
    const { i: a, f } = amostra(passeio.dist);
    const t = rail.tOrig[a] + f * (rail.tOrig[Math.min(a + 1, rail.tOrig.length - 1)] - rail.tOrig[a]);
    const k = Math.min(trilhoDados.passos_mpc_h.length - 1, Math.floor(t));
    const i = Math.round(t);
    const noFilamento = trilhoDados.passos_mpc_h[k] <= trilhoDados.b_mpc_h;
    let dentro = null;
    const halos = c.marcadores.dados() && c.marcadores.dados().halos;
    if (halos) {
      const h = halos[trilhoDados.donos[i]];
      const d = new THREE.Vector3(h[0], h[1], h[2]).sub(c.camera.position);
      for (const e of ["x", "y", "z"]) d[e] -= L * Math.round(d[e] / L);
      if (d.length() < h[4]) dentro = { numero: trilhoDados.donos[i] + 1, massa: h[3] };
    }
    return { k, i, noFilamento, dentro };
  }

  function atualizarHud() {
    if (!passeio) return;
    const o = ondeEstou();
    hud.innerHTML = `<b>${al(passeio.dist)}</b> de ${al(comprimento)} · ${Math.round(100 * passeio.dist / comprimento)} %` +
      (passeio.pausado ? " · <b>pausado</b>" : "") + `<br>` +
      (o.dentro ? `<span class="dentro">dentro do aglomerado nº ${o.dentro.numero} (${c.textoMassa(o.dentro.massa)})</span>`
        : o.noFilamento ? `<span class="fil">no filamento</span>` : `<span class="entre">atravessando entre filamentos</span>`) +
      ` · paredes atravessadas: ${passeio.paredes}` +
      `<br><small>arrastar: olhar em volta · espaço: pausar · Esc: sair</small>`;
  }

  function montar() {
    if (painel.hidden) return;
    const d = dados, p = trilhoDados;
    const indis = motivo();
    const pct = d ? Math.round(100 * d.halos_em_filamentos / d.n_principais) : 0;
    const minutos = p ? comprimento / velocidade / 60 : 0;
    painel.innerHTML = `<h2>Esqueleto da teia <button id="bt-fechar-esqueleto" aria-label="Fechar">×</button></h2>
      ${!d || !p ? `<p class="aviso-filtro">${indis}</p>` : `
      <p>Ligamos os centros dos aglomerados com a <b>árvore mínima</b>: a rede de linhas retas, sem voltas, que liga
      todos eles com o menor comprimento total. Cortando as ligações mais longas que <b>${al(d.b_mpc_h)}</b>, o que
      continua ligado é um <b>filamento</b>.</p>
      <table>
        <tr><td>Filamentos</td><td>${d.n_filamentos.toLocaleString("pt-BR")}</td></tr>
        <tr><td>Aglomerados em filamentos</td><td>${d.halos_em_filamentos.toLocaleString("pt-BR")} de ${d.n_principais.toLocaleString("pt-BR")} (${pct} %)</td></tr>
      </table>
      ${indis ? `<p class="aviso-filtro">${indis}</p>` : ""}
      <label class="opcao"><input type="checkbox" id="ck-esqueleto" ${mostrar ? "checked" : ""} ${indis ? "disabled" : ""}>
        Mostrar o esqueleto <small>(linhas azuis)</small></label>
      <h3>Passeio pela teia <small>(montanha-russa)</small></h3>
      <p>Você vai <b>sentado em cima do trilho</b>: a espinha da teia inteira, o caminho mais longo da árvore de uma ponta
      à outra — <b>${al(comprimento)}</b>, ${p.pontos.length} aglomerados, passando pelo maior deles (75 trilhões de sóis)
      e cobrindo ${Math.round(100 * p.cobertura.ate_4_mpc_h)} % do cubo a até ${al(4)}. Trilho <span class="fil">amarelo</span>:
      dentro de filamento; <span class="entre">cinza</span>: atravessando entre filamentos. Cruza as paredes do cubo
      ${p.cruza_parede} vezes (a simulação é periódica). <b>Arraste a tela para olhar em volta</b> sem parar.</p>
      <div class="linha-tempo">
        <span>Olhar para:</span>
        <label class="opcao"><input type="radio" name="olhar" value="caixa" ${modoOlhar === "caixa" ? "checked" : ""}>
          dentro do cubo <small>(panorâmico)</small></label>
        <label class="opcao"><input type="radio" name="olhar" value="frente" ${modoOlhar === "frente" ? "checked" : ""}>
          a frente do trilho</label>
      </div>
      <div class="linha-tempo">
        ${passeio ? `<button class="botao-texto" id="bt-pausar">${passeio.pausado ? "▶ continuar" : "❚❚ pausar"}</button>
                     <button class="botao-texto" id="bt-frente">olhar para a frente</button>
                     <button class="botao-texto" id="bt-sair">■ sair</button>`
                  : `<button class="botao-texto" id="bt-voar" ${indis ? "disabled" : ""}>▶ começar o passeio</button>`}
      </div>
      <div class="linha-tempo">
        <label for="rg-velocidade">Velocidade</label>
        <input type="range" id="rg-velocidade" min="0.25" max="4" step="0.25" value="${velocidade}" aria-label="Velocidade do passeio">
        <span>${al(velocidade)}/s · ~${minutos < 1 ? "<1" : Math.round(minutos)} min</span>
      </div>
      ${mensagem ? `<p class="momento">${mensagem}</p>` : ""}
      <p class="nota">Método publicado: árvore mínima (Barrow, Bhavsar &amp; Sonoda 1985); sub-halos incluídos como em
      Colberg 2007 — sem eles o maior aglomerado ficaria isolado; corte pelo critério de Alpaslan et al. 2014 (o menor
      corte em que mais de 90 % dos aglomerados mais pesados estão em filamentos; adaptado a halos, porque o artigo usa
      grupos de galáxias); trilho = espinha (caminho mais longo, Alpaslan §3.1.2) da árvore sem corte, como Colberg 2007.
      As linhas ligam CENTROS em reta: mostram quem está ligado a quem, não o desenho exato das cristas de matéria. O trilho
      em que você anda é o caminho real suavizado (média de ${al(SUAVE)}): passa a no máximo
      ${al(Math.max(...rail.desvio))} das ligações reais e tira o zigue-zague de aglomerado em aglomerado
      (${al(p.comprimento_mpc_h)} no caminho exato). A cabeça vira no máximo ${GIRO_MAX_GRAUS_S}°/s. Dentro de aglomerados grandes a tela fica clara: é a densidade de lá. Só no Universo 1, hoje.</p>`}`;
    painel.querySelector("#bt-fechar-esqueleto").addEventListener("click", () => alternar(false));
    const ck = painel.querySelector("#ck-esqueleto");
    if (ck) ck.addEventListener("change", () => mostrarEsqueleto(ck.checked));
    const liga = (id, f) => { const b = painel.querySelector(id); if (b) b.addEventListener("click", f); };
    liga("#bt-voar", () => iniciar());
    liga("#bt-pausar", () => pausar());
    liga("#bt-frente", () => olharParaFrente());
    liga("#bt-sair", () => parar());
    painel.querySelectorAll("input[name=olhar]").forEach((x) => x.addEventListener("change", () => { modoOlhar = x.value; }));
    const rg = painel.querySelector("#rg-velocidade");
    if (rg) rg.addEventListener("input", () => { velocidade = Number(rg.value); montar(); });
  }

  async function alternar(abrir = painel.hidden) {
    painel.hidden = !abrir;
    const btn = document.getElementById("bt-esqueleto");
    if (btn) btn.setAttribute("aria-pressed", String(abrir));
    if (!abrir) parar("");
    await pronto;
    if (trilho) trilho.visible = abrir && disponivel();
    montar();
    return abrir;
  }

  /** O universo ou o modo tempo mudou: esconde o que não vale mais e atualiza o painel. */
  function revisar() {
    if (!disponivel()) { parar(""); mostrarEsqueleto(false); if (trilho) trilho.visible = false; }
    else if (trilho) trilho.visible = !painel.hidden;
    montar();
  }

  /** Simula o passeio inteiro na velocidade padrão em passos de 0,1 s, no modo de olhar atual: maior giro da vista (°/s),
   *  atraso mediano da cabeça em relação a para onde o trilho vai (°) e o afastamento trilho suavizado × caminho real. */
  function medirConforto() {
    let base = desejadaPara(0, desejada(0)), pior = 0;
    const atrasos = [], dt = 0.1, max = THREE.MathUtils.degToRad(GIRO_MAX_GRAUS_S) * dt;
    for (let d = VELOCIDADE_PADRAO * dt; d <= comprimento; d += VELOCIDADE_PADRAO * dt) {
      const alvo = desejadaPara(d, base), nova = girarAte(base, alvo, max);
      pior = Math.max(pior, THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(nova.dot(base), -1, 1))) / dt);
      atrasos.push(THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(nova.dot(alvo), -1, 1))));
      base = nova;
    }
    atrasos.sort((a, b) => a - b);
    const desvios = rail.desvio.slice().sort((a, b) => a - b);
    return { giroMax: pior, atrasoMediano: atrasos[atrasos.length >> 1], desvioMax: desvios.at(-1),
             desvioMediano: desvios[desvios.length >> 1] };
  }

  return { alternar, painel, pronto, iniciar, parar, pausar, olhar, olharParaFrente, quadro, mostrarEsqueleto, revisar,
           pose, pontoEm, disponivel, medirConforto, GIRO_MAX_GRAUS_S, dobra, ondeEstou, rail: () => rail,
           dados: () => dados, trilhoDados: () => trilhoDados, andando: () => !!passeio,
           estado: () => (passeio ? { ...passeio } : null), comprimento: () => comprimento,
           velocidade: (v) => { if (v !== undefined) velocidade = v; return velocidade; },
           modoOlhar: (m) => { if (m !== undefined) modoOlhar = m; return modoOlhar; },
           mostrando: () => mostrar, linhas: () => linhas, trilho: () => trilho, curva: () => curva };
}
