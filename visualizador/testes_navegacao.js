/**
 * Testes automáticos da navegação (F3.1 + F3.13). Rodam abrindo o visualizador com ?testes=1:
 *   http://127.0.0.1:8765/visualizador/index.html?testes=1
 * O resultado aparece num quadro na tela e no console (F12).
 *
 * Critérios (registrados antes de testar, 15/10/2026):
 *   U1 voltar à caixa: depois de bagunçar câmera e alvo, volta exatamente (erro < 1e-3)
 *   U2 zoom: "+" multiplica a distância por 0,7; "−" divide; limites 0,5 e 120 Mpc/h seguram
 *   U3 contorno: arestas exatamente em ±12,5 Mpc/h; liga e desliga
 *   U4 atalhos: Home/H, +/= (inclui teclado numérico), −, C
 * A animação é avançada direto (passoAnimacao) para o teste não depender do navegador estar
 * desenhando (abas escondidas pausam o desenho).
 */
export function rodarTestes(t) {
  const C = t.constantes;
  const fim = () => { t.passoAnimacao(Infinity); t.controls.update(); };
  const dist = () => t.camera.position.distanceTo(t.controls.target);
  const tecla = (key, code) => { window.dispatchEvent(new KeyboardEvent("keydown", { key, code })); fim(); };
  const testes = [];
  const teste = (nome, passou, detalhe) => testes.push({ nome, passou: !!passou, detalhe });

  // U1
  t.camera.position.set(7.3, -4.1, 3.2); t.controls.target.set(2.5, 1.0, -3.0); t.controls.update();
  t.voltarACaixa(); for (let i = 0; i < 30; i++) fim();
  const e1 = t.camera.position.distanceTo(C.VISTA_INICIAL.posicao) + t.controls.target.distanceTo(C.VISTA_INICIAL.alvo);
  teste("U1 voltar à caixa", e1 < 1e-3, `erro ${e1.toExponential(2)}`);

  // U2
  t.voltarACaixa(); fim();
  let d0 = dist(); t.zoom(C.ZOOM_FATOR); fim(); const rMais = dist() / d0;
  d0 = dist(); t.zoom(1 / C.ZOOM_FATOR); fim(); const rMenos = dist() / d0;
  for (let i = 0; i < 25; i++) { t.zoom(C.ZOOM_FATOR); fim(); } const dMin = dist();
  for (let i = 0; i < 25; i++) { t.zoom(1 / C.ZOOM_FATOR); fim(); } const dMax = dist();
  teste("U2 zoom + e −", Math.abs(rMais - 0.7) < 1e-6 && Math.abs(rMenos - 1 / 0.7) < 1e-6,
        `+ ×${rMais.toFixed(4)}, − ×${rMenos.toFixed(4)}`);
  teste("U2 limites de distância", Math.abs(dMin - C.DISTANCIA_MIN) < 1e-6 && Math.abs(dMax - C.DISTANCIA_MAX) < 1e-6,
        `mín ${dMin.toFixed(3)}, máx ${dMax.toFixed(3)} Mpc/h`);

  // U3
  t.contorno.geometry.computeBoundingBox();
  const bb = t.contorno.geometry.boundingBox, meio = C.LADO_CAIXA / 2;
  const bordas = [...bb.min.toArray().map((x) => x + meio), ...bb.max.toArray().map((x) => x - meio)];
  const v0 = t.contorno.visible; t.alternarContorno(); const v1 = t.contorno.visible; t.alternarContorno();
  teste("U3 contorno da caixa", bordas.every((x) => Math.abs(x) < 1e-9) && v0 === true && v1 === false,
        `arestas em ±${meio}; liga/desliga ok`);

  // U4
  const casos = [["+", "Equal", 0.7], ["=", "Equal", 0.7], ["+", "NumpadAdd", 0.7],
                 ["-", "Minus", 1 / 0.7], ["-", "NumpadSubtract", 1 / 0.7]];
  let ok4 = true;
  for (const [k, c, esperado] of casos) { t.voltarACaixa(); fim(); d0 = dist(); tecla(k, c); ok4 &&= Math.abs(dist() / d0 - esperado) < 1e-6; }
  t.camera.position.set(5, 5, 5); t.controls.update(); tecla("Home", "Home");
  ok4 &&= t.camera.position.distanceTo(C.VISTA_INICIAL.posicao) < 1e-6;
  const vc = t.contorno.visible; tecla("c", "KeyC"); ok4 &&= t.contorno.visible === !vc; tecla("c", "KeyC");
  teste("U4 atalhos de teclado", ok4, "Home, +, =, + numérico, −, − numérico, C");

  // U6: massa por extenso sem ambiguidade (erro de mil vezes achado em 15/10/2026)
  const casosMassa = [[7.395e9, "7,4 bilhões de sóis"], [1.155e8, "116 milhões de sóis"], [9.24e8, "924 milhões de sóis"],
                      [1.5e13, "15 trilhões de sóis"], [1.88e12, "1,88 trilhão de sóis"]];
  const falhasMassa = casosMassa.filter(([m, esperado]) => t.textoMassa(m) !== esperado);
  teste("U6 massa por extenso", falhasMassa.length === 0,
        falhasMassa.length ? `errado: ${falhasMassa.map(([m]) => t.textoMassa(m)).join("; ")}` : "7,4 bilhões · 116 milhões · 924 milhões · 15 trilhões · 1,88 trilhão");

  // U5: aviso de limite de detalhe — desligado na vista inicial, ligado bem de perto
  if (t.metadados()) {
    const estavaFechado = t.avisoLimiteFechado();   // o usuário pode ter fechado o aviso (×): reabre para testar
    t.fecharAvisoLimite(false);
    t.voltarACaixa(); fim(); t.atualizarAvisoLimite();
    const longe = t.noLimiteDeDetalhe(), avisoLonge = !document.getElementById("limite").hidden;
    const s = t.separacaoMedia();
    const dLimite = 3 * s / (2 * Math.tan(t.camera.fov * Math.PI / 360));   // fronteira do critério
    t.camera.position.set(0, 0, dLimite * 0.9); t.controls.target.set(0, 0, 0); t.controls.update();
    t.atualizarAvisoLimite();
    const perto = t.noLimiteDeDetalhe(), avisoPerto = !document.getElementById("limite").hidden;
    t.camera.position.set(0, 0, dLimite * 1.1); t.controls.update();
    const foraDaFronteira = t.noLimiteDeDetalhe();
    teste("U5 aviso de limite de detalhe", !longe && !avisoLonge && perto && avisoPerto && !foraDaFronteira,
          `separação ${(s * 1000).toFixed(0)} kpc/h; aviso a partir de ${dLimite.toFixed(2)} Mpc/h`);
    // o × fecha e o aviso não volta, mesmo bem de perto
    t.camera.position.set(0, 0, dLimite * 0.9); t.controls.update(); t.atualizarAvisoLimite();
    t.fecharAvisoLimite(true); t.atualizarAvisoLimite();
    const naoVolta = document.getElementById("limite").hidden;
    if (!naoVolta) testes.push({ nome: "U5b × do aviso de limite", passou: false, detalhe: "o aviso voltou depois de fechado" });
    t.fecharAvisoLimite(estavaFechado);
    t.voltarACaixa(); fim(); t.atualizarAvisoLimite();
  } else {
    teste("U5 aviso de limite de detalhe", false, "metadados (.json) do arquivo não carregaram");
  }

  // U7: legenda (16/10/2026) — liga/desliga pela tecla L, mostra as 5 classes do catálogo e
  // a soma das classes bate com o total de halos principais (nenhum halo sumiu nas fronteiras)
  const cl = t.classesHalos();
  if (cl) {
    const leg = document.getElementById("legenda");
    const h0 = leg.hidden; tecla("l", "KeyL"); const h1 = leg.hidden; tecla("l", "KeyL");
    const linhas = leg.querySelectorAll("tbody tr").length;
    const soma = cl.classes.reduce((s, c) => s + c.quantos, 0);
    teste("U7 legenda das classes", h0 && !h1 && leg.hidden && linhas === cl.classes.length && soma === cl.total_halos_principais,
          `${linhas} classes, ${soma} de ${cl.total_halos_principais} halos; tecla L ok`);
  } else {
    teste("U7 legenda das classes", false, "classes_halos.json não carregou");
  }

  t.voltarACaixa(); fim();
  return testes;
}

/**
 * U8 — filtro "ir até um aglomerado" (F3.15, 19/10/2026). Assíncrono (espera o .json dos halos).
 *   caixa inteira: exatamente os 10 maiores (índices 0–9); de perto do maior: ≤ 10, todos dentro
 *   da região, e aparecem halos fora do top 10 ("os 10 seguintes daquela região"); voar: alvo =
 *   centro do halo (erro < 1e-9) e distância = regra; cartão abre; desligar zera os marcadores.
 */
export async function rodarTestesMarcadores(t) {
  const M = t.marcadores;
  const fim = () => { t.passoAnimacao(Infinity); t.controls.update(); };
  await M.pronto;
  const d = M.dados();
  if (!d) return [{ nome: "U8 ir até um aglomerado", passou: false, detalhe: "halos_marcadores.json não carregou" }];
  await M.alternar(true);
  t.voltarACaixa(); fim(); M.atualizar();
  const v0 = M.visiveis();
  const okCaixa = v0.length === 10 && v0.every((i, k) => i === k);
  const h0 = new t.camera.position.constructor(d.halos[0][0], d.halos[0][1], d.halos[0][2]);
  t.controls.target.copy(h0); t.camera.position.copy(h0).add(new t.camera.position.constructor(0, 0, 1.5));
  t.controls.update(); M.atualizar();
  const v1 = M.visiveis(), { raio } = M.escolher();
  const dentro = v1.every((i) => h0.distanceTo(new t.camera.position.constructor(d.halos[i][0], d.halos[i][1], d.halos[i][2])) <= raio);
  const okPerto = v1.length > 0 && v1.length <= 10 && dentro && v1.some((i) => i >= 10);
  const { alvo } = M.voar(3); fim();
  const dist = t.camera.position.distanceTo(t.controls.target);
  const okVoo = t.controls.target.distanceTo(alvo) < 1e-9 && Math.abs(dist - M.distanciaChegada(d.halos[3][4])) < 1e-6;
  const card = document.getElementById("halo-info");
  const okCartao = !card.hidden && card.textContent.includes("Halo nº 4");
  await M.alternar(false);
  const okDesliga = M.visiveis().length === 0 && card.hidden;
  t.voltarACaixa(); fim();
  return [{ nome: "U8 ir até um aglomerado", passou: okCaixa && okPerto && okVoo && okCartao && okDesliga,
            detalhe: `caixa: ${v0.length} (top 10 ${okCaixa ? "ok" : "ERRO"}); perto do nº 1: ${v1.length} na região ` +
                     `(maior índice ${Math.max(...v1) + 1}); voo ${okVoo ? "ok" : "ERRO"}; cartão ${okCartao ? "ok" : "ERRO"}; ` +
                     `desligar ${okDesliga ? "ok" : "ERRO"}` }];
}

/**
 * U9 — filtro de cor (F3.7, 20/10/2026): a cor de cada mancha lida do ARQUIVO é igual à cor
 * magma do índice do estimador A no estimadores_<versao>.bin? Isso confere que as manchas do .bin
 * estão na MESMA ordem das do arquivo (senão o filtro pintaria uma mancha com a cor de outra).
 * Tolerância 0,02: o SPZ guarda a cor com degrau de ~0,0074. Só roda quando a teia foi remontada
 * mancha a mancha (névoa ligada ou cor diferente do padrão), que é o caso da página padrão.
 */
export function rodarTestesCor(t) {
  if (!t.versaoCor) return [];
  const c = t.conferenciaOrdem();
  if (!c) return [{ nome: "U9 ordem das cores (filtro de estimador)", passou: true,
                    detalhe: "não se aplica: arquivo carregado direto, sem remontar (abra com névoa para conferir)" }];
  return [{ nome: "U9 ordem das cores (filtro de estimador)", passou: c.passou,
            detalhe: `${c.n} manchas conferidas, maior diferença de cor ${c.difMax.toFixed(4)} (tolerância 0,02)` }];
}

/**
 * U10 — giro automático (F3.19, 21/10/2026): 1 s de giro = 20° em volta do foco, distância ao foco
 * preservada, altura (y) preservada; um clique na cena para o giro. Avança o tempo direto (passoGiro).
 */
export function rodarTestesGiro(t) {
  t.voltarACaixa(); t.passoAnimacao(Infinity); t.controls.update();
  const alvo = t.controls.target.clone(), antes = t.camera.position.clone().sub(alvo);
  t.alternarGiro(true);
  const t0 = 1e6;
  t.passoGiro(t0);
  for (let k = 1; k <= 10; k++) t.passoGiro(t0 + 100 * k);   // 10 passos de 0,1 s = 1 s
  const depois = t.camera.position.clone().sub(alvo);
  const ang = Math.atan2(antes.x * depois.z - antes.z * depois.x, antes.x * depois.x + antes.z * depois.z);
  const graus = Math.abs(ang) * 180 / Math.PI;
  const okGiro = Math.abs(graus - t.GIRO_GRAUS_POR_S) < 1e-6 && Math.abs(depois.length() - antes.length()) < 1e-9
                 && Math.abs(depois.y - antes.y) < 1e-9;
  t.renderer.domElement.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));
  const okPara = !t.giroLigado();
  t.alternarGiro(false);
  t.voltarACaixa(); t.passoAnimacao(Infinity); t.controls.update();
  return [{ nome: "U10 giro automático", passou: okGiro && okPara,
            detalhe: `1 s → ${graus.toFixed(6)}° (esperado ${t.GIRO_GRAUS_POR_S}); distância e altura mantidas; clique ${okPara ? "para" : "NÃO para"} o giro` }];
}

/**
 * U11 — ajustes de tela (21/10/2026): só um painel aberto por vez; quadro de informação começa minimizado e
 * abre/fecha; "limpar tudo" fecha painéis, desliga giro e volta a câmera à caixa.
 */
export async function rodarTestesTela(t) {
  const info = document.getElementById("info");
  const comecaRecolhido = info.classList.contains("recolhido");
  t.abrirPainel("universos"); t.abrirPainel("filtros"); t.abrirPainel("legenda");
  const umSo = t.paineisAbertos().length === 1 && t.paineisAbertos()[0] === "legenda";
  t.abrirPainel("legenda");
  const fechouTodos = t.paineisAbertos().length === 0;
  t.alternarInfo(true); const abriu = !info.classList.contains("recolhido");
  t.alternarInfo(false); const fechou = info.classList.contains("recolhido");
  t.abrirPainel("filtros"); t.alternarGiro(true);
  t.camera.position.set(3, 2, 5); t.controls.update();
  await t.limparTudo(); t.passoAnimacao(Infinity); t.controls.update();
  const limpo = t.paineisAbertos().length === 0 && !t.giroLigado() &&
                t.camera.position.distanceTo(t.constantes.VISTA_INICIAL.posicao) < 1e-6;
  return [{ nome: "U11 tela: um painel por vez, informação minimizada, limpar tudo",
            passou: comecaRecolhido && umSo && fechouTodos && abriu && fechou && limpo,
            detalhe: `minimizado ao abrir ${comecaRecolhido ? "ok" : "ERRO"}; um painel por vez ${umSo ? "ok" : "ERRO"}; ` +
                     `informação abre/fecha ${abriu && fechou ? "ok" : "ERRO"}; limpar tudo ${limpo ? "ok" : "ERRO"}` }];
}

/**
 * U12 — exportar (F3.12, 21/10/2026): o CSV gerado do estado, relido, devolve o mesmo universo, cor e câmera
 * (até 4 casas), e aplicar a configuração lida leva a câmera de volta ao lugar salvo.
 */
export async function rodarTestesExportar(t) {
  const m = await import("./exportar.js");
  t.voltarACaixa(); t.passoAnimacao(Infinity);
  t.camera.position.set(4.25, -3.5, 9.125); t.controls.target.set(1.5, 0.25, -2); t.controls.update();
  const e = t.estadoAtual();
  const conf = m.configuracaoDoCSV(m.lerCSV(m.gerarCSV(e)));
  const perto = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
  const okLeitura = conf.universo === e.universo && perto(conf.camera, e.camera) && perto(conf.alvo, e.alvo) &&
                    ["estimador", "paleta", "camada", "par", "resolucao"].every((k) => conf.cor[k] === e.cor[k]);
  t.voltarACaixa(); t.passoAnimacao(Infinity); t.controls.update();
  await t.aplicarConfiguracao(conf);
  const okAplica = perto(t.camera.position.toArray(), e.camera) && perto(t.controls.target.toArray(), e.alvo);
  const fontes = t.fontesAtuais();
  t.voltarACaixa(); t.passoAnimacao(Infinity); t.controls.update();
  return [{ nome: "U12 exportar: CSV relido = estado salvo; reaplicar volta a câmera",
            passou: okLeitura && okAplica && fontes.length >= 4,
            detalhe: `leitura ${okLeitura ? "ok" : "ERRO"}; reaplicar ${okAplica ? "ok" : "ERRO"}; ${fontes.length} fontes no PDF` }];
}

/**
 * U13 — régua de escala (F3.4, 22/10/2026): para 3 distâncias da câmera, o comprimento escolhido é "redondo"
 * (1, 2 ou 5 × 10^k anos-luz), a barra fica entre 50 e 300 px, e largura ÷ px por Mpc/h × 4,8600 Mal = o rótulo.
 * E a conta da Via Láctea: 1,3 trilhão de sóis → "≈ 1 Via Láctea"; 6,5 trilhões → "≈ 5 Vias Lácteas".
 */
export function rodarTestesRegua(t) {
  const ok = [];
  t.passoAnimacao(Infinity);   // conclui qualquer voo em curso antes de posicionar a câmera
  for (const d of [40, 4, 0.4]) {
    t.controls.target.set(0, 0, 0); t.camera.position.set(0, 0, d); t.controls.update();
    const r = t.calcularRegua(800);   // altura fixa: com a aba escondida a tela mede 0
    const mant = r.anosLuz / 10 ** Math.floor(Math.log10(r.anosLuz) + 1e-9);
    const redondo = [1, 2, 5].some((m) => Math.abs(mant - m) < 1e-6);
    const coerente = Math.abs(r.px / r.pxPorMpcH * t.ANOS_LUZ_POR_MPC_H / r.anosLuz - 1) < 1e-9;
    ok.push(redondo && coerente && r.px >= 50 && r.px <= 300);
  }
  const vl = t.marcadores.textoViasLacteas;
  const okVL = vl(1.3e12) === "≈ 1 Via Láctea" && vl(6.5e12) === "≈ 5 Vias Lácteas";
  t.voltarACaixa(); t.passoAnimacao(Infinity); t.controls.update();
  return [{ nome: "U13 régua de escala e Vias Lácteas", passou: ok.every(Boolean) && okVL,
            detalhe: `3 distâncias: ${ok.map((x) => (x ? "ok" : "ERRO")).join(", ")}; Via Láctea ${okVL ? "ok" : "ERRO"}` }];
}

/**
 * U14 — esqueleto e passeio "montanha-russa" (F3.20, 28/10/2026): linhas desenhadas = segmentos do arquivo; o painel
 * abre sozinho; com o tempo simulado, depois de 10 s a 1 Mpc/h/s a câmera está em cima do trilho a 10 Mpc/h do começo
 * (dobrada para dentro da caixa) e a câmera normal está desligada; virar a cabeça muda a direção do olhar mas não a
 * posição; olhando para a frente a vista gira no máximo GIRO_MAX_GRAUS_S, com atraso mediano < 15° em relação ao
 * trilho, e o trilho suavizado fica a < 0,35 Mpc/h do caminho real; no fim do trilho cruzou as paredes o mesmo
 * número de vezes do arquivo e devolveu a câmera; Esc sai.
 */
export async function rodarTestesEsqueleto(t) {
  const e = t.esqueleto;
  await e.pronto;
  const d = e.dados(), p = e.trilhoDados();
  if (!d || !p) return [{ nome: "U14 esqueleto e passeio", passou: false, detalhe: "arquivos do esqueleto não carregaram" }];
  const okLinhas = e.linhas().geometry.attributes.position.count === 2 * d.segmentos.length;
  e.modoOlhar("frente");
  const confFrente = e.medirConforto();
  e.modoOlhar("caixa");                         // padrão (28/10): olhar para o centro do cubo
  const conf = e.medirConforto(), giro = Math.max(conf.giroMax, confFrente.giroMax);
  const okGiro = giro <= e.GIRO_MAX_GRAUS_S + 1e-6 && conf.atrasoMediano < 15 && confFrente.atrasoMediano < 15 &&
                 conf.desvioMax < 0.35;
  t.abrirPainel("esqueleto");
  const okPainel = t.paineisAbertos().join() === "esqueleto";
  e.velocidade(1);
  e.iniciar();
  t.passoAnimacao(Infinity);                    // conclui a aproximação até o começo do trilho
  const t0 = 3e6;
  e.quadro(t0);
  for (let k = 1; k <= 20; k++) e.quadro(t0 + 500 * k);   // 10 s
  const esperado = e.pose(10).posicao, dob = e.dobra(esperado);
  esperado.add(dob);
  const okPosicao = Math.abs(e.estado().dist - 10) < 1e-9 && t.camera.position.distanceTo(esperado) < 1e-6 &&
                    !t.controls.enabled && Math.max(...t.camera.position.toArray().map(Math.abs)) <= t.constantes.LADO_CAIXA / 2 + 1e-6;
  const paraCentro = t.camera.position.clone().negate().normalize();
  const olhandoCentro = t.controls.target.clone().sub(t.camera.position).normalize().dot(paraCentro);
  const okCentro = olhandoCentro > 0.99 || t.camera.position.length() < 4;
  const antesPos = t.camera.position.clone(), antesDir = t.controls.target.clone().sub(t.camera.position).normalize();
  e.olhar(Math.PI / 2, 0);                      // vira a cabeça 90° para o lado
  const depoisDir = t.controls.target.clone().sub(t.camera.position).normalize();
  const okOlhar = t.camera.position.distanceTo(antesPos) < 1e-9 && Math.abs(antesDir.dot(depoisDir)) < 0.2 && e.andando();
  e.olharParaFrente();
  let k = 21;
  while (e.andando() && k < 100000) e.quadro(t0 + 500 * k++);   // até o fim do trilho
  const okFim = !e.andando() && t.controls.enabled;
  const paredesOk = true;   // contadas abaixo num 2º passeio rápido (o estado some ao terminar)
  e.velocidade(4); e.iniciar(); t.passoAnimacao(Infinity); e.quadro(t0);
  let paredes = 0, kk = 1;
  while (e.andando() && kk < 100000) { e.quadro(t0 + 500 * kk++); if (e.estado()) paredes = e.estado().paredes; }
  const okParedes = paredesOk && paredes === p.cruza_parede;
  e.iniciar(); t.passoAnimacao(Infinity); e.quadro(t0); e.quadro(t0 + 500);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  const okEsc = !e.andando() && t.controls.enabled;
  e.velocidade(1);
  t.abrirPainel("esqueleto");                   // fecha
  t.voltarACaixa(); t.passoAnimacao(Infinity); t.controls.update();
  const tudo = okLinhas && okGiro && okPainel && okPosicao && okCentro && okOlhar && okFim && okParedes && okEsc;
  return [{ nome: "U14 esqueleto e passeio", passou: tudo,
            detalhe: `linhas ${okLinhas ? "ok" : "ERRO"}; vista gira no máx. ${giro.toFixed(1)}°/s, atraso mediano ${conf.atrasoMediano.toFixed(1)}° (para o centro) / ${confFrente.atrasoMediano.toFixed(1)}° (para a frente), trilho a ≤ ${conf.desvioMax.toFixed(2)} Mpc/h do real ${okGiro ? "ok" : "ERRO"}; ` +
                     `painel ${okPainel ? "ok" : "ERRO"}; em cima do trilho a 10 Mpc/h ${okPosicao ? "ok" : "ERRO"}; ` +
                     `olhando para o centro do cubo ${okCentro ? "ok" : "ERRO"} (cos ${olhandoCentro.toFixed(3)}); ` +
                     `virar a cabeça ${okOlhar ? "ok" : "ERRO"}; fim ${okFim ? "ok" : "ERRO"}; ` +
                     `paredes ${paredes} de ${p.cruza_parede} ${okParedes ? "ok" : "ERRO"}; Esc ${okEsc ? "ok" : "ERRO"}` }];
}

/**
 * U15 — voo livre (F3.2, 28/10/2026). Critério do backlog: "atravessar a caixa de ponta a ponta".
 *  (a) olhando para +x, W apertado 10 s a 1 Mpc/h/s: desloca exatamente 10 − τ(1 − e^(−10/τ)) (inércia) ao longo do olhar;
 *  (b) a 5 Mpc/h/s por 8 s atravessa a caixa inteira (> 25 Mpc/h), cruza a parede, conta e fica dentro da caixa;
 *  (c) virar a cabeça não move a câmera; a roda muda a velocidade; Esc sai e devolve a câmera normal;
 *  (d) entrando de fora do cubo (vista inicial), a câmera não salta para dentro nem conta parede.
 */
export function rodarTestesVooLivre(t) {
  const v = t.vooLivre;
  t.voltarACaixa(); t.passoAnimacao(Infinity); t.controls.update();
  t.controls.target.set(0, 0, 0); t.camera.position.set(-5, 0, 0); t.controls.update();   // olhando para +x
  v.velocidade(1);
  v.entrar();
  const okEntrou = v.ativo() && !t.controls.enabled;
  const t0 = 4e6;
  v.quadro(t0);
  v.apertar("KeyW");
  for (let k = 1; k <= 100; k++) v.quadro(t0 + 100 * k);           // 10 s em passos de 0,1 s
  v.apertar("KeyW", false);
  const tau = v.INERCIA_S, esperado = 10 - tau * (1 - Math.exp(-10 / tau));
  const p = t.camera.position;
  const okReta = Math.abs(p.x - (-5 + esperado)) < 1e-6 && Math.abs(p.y) < 1e-9 && Math.abs(p.z) < 1e-9;
  // (b) ponta a ponta
  v.velocidade(5);
  const antes = v.estado().percorrido, paredesAntes = v.estado().paredes;
  v.apertar("KeyW");
  for (let k = 101; k <= 180; k++) v.quadro(t0 + 100 * k);         // 8 s
  v.apertar("KeyW", false);
  const e = v.estado();
  const dentro = Math.max(...t.camera.position.toArray().map(Math.abs)) <= t.constantes.LADO_CAIXA / 2 + 1e-9;
  const okPonta = e.percorrido - antes > t.constantes.LADO_CAIXA && e.paredes > paredesAntes && dentro;
  // (c) olhar, roda, Esc
  const pos = t.camera.position.clone();
  v.olhar(Math.PI / 2, 0.3);
  const okOlhar = t.camera.position.distanceTo(pos) < 1e-12 && Math.abs(t.controls.target.distanceTo(t.camera.position) - 1) < 1e-9;
  const vAntes = v.velocidade();
  t.renderer.domElement.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
  const okRoda = Math.abs(v.velocidade() / vAntes - 1.25) < 1e-9;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }));
  const okSaiu = !v.ativo() && t.controls.enabled;
  // (d) de FORA do cubo (vista inicial): entra sem salto e sem contar parede
  t.controls.target.set(0, 0, 0); t.camera.position.set(0, 0, 35); t.controls.update();
  v.entrar();
  const okFora = t.camera.position.z === 35 && v.estado().paredes === 0;
  v.sair();
  v.velocidade(1);
  t.voltarACaixa(); t.passoAnimacao(Infinity); t.controls.update();
  const tudo = okEntrou && okReta && okPonta && okOlhar && okRoda && okSaiu && okFora;
  return [{ nome: "U15 voo livre", passou: tudo,
            detalhe: `entra ${okEntrou ? "ok" : "ERRO"}; 10 s para a frente = ${esperado.toFixed(4)} Mpc/h ${okReta ? "ok" : "ERRO"}; ` +
                     `ponta a ponta (${(e.percorrido - antes).toFixed(1)} Mpc/h, paredes ${e.paredes - paredesAntes}) ${okPonta ? "ok" : "ERRO"}; ` +
                     `olhar ${okOlhar ? "ok" : "ERRO"}; roda ${okRoda ? "ok" : "ERRO"}; Esc ${okSaiu ? "ok" : "ERRO"}; ` +
                     `de fora do cubo sem salto ${okFora ? "ok" : "ERRO"}` }];
}

/** Mostra o resultado num quadro na tela e no console. */
export function mostrarResultado(testes) {
  const ok = testes.filter((x) => x.passou).length;
  console.table(testes);
  const div = document.createElement("div");
  div.id = "resultado-testes";
  div.style.cssText = "position:absolute;top:16px;right:16px;max-width:360px;background:rgba(12,10,20,.85);" +
    "border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:10px 14px;font:13px system-ui;color:#ddd";
  div.innerHTML = `<b style="color:#fff">Testes de navegação: ${ok}/${testes.length}</b><br>` +
    testes.map((x) => `${x.passou ? "✅" : "❌"} ${x.nome} <span style="opacity:.6">— ${x.detalhe}</span>`).join("<br>");
  document.body.appendChild(div);
  window.teia.resultadoTestes = { ok, total: testes.length, testes };
}
