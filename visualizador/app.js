/**
 * Dentro da Teia — lógica do visualizador (F3.1 + F3.13)
 *
 * F3.1  carrega os splats (.spz por padrão) com o Spark sobre three.js; câmera orbital.
 * F3.13 navegação fácil: botão "voltar à caixa", botões + / − de zoom, contorno da caixa
 *       (liga/desliga) e atalhos de teclado. Limites de distância para não se perder.
 *
 * Coordenadas: 1 unidade = 1 Mpc/h; caixa de 25 Mpc/h centrada na origem (exportar_ply.py).
 * Bibliotecas (como no Quick Start do Spark): three.js 0.180.0, Spark 2.3.1.
 *
 * Para os testes automáticos, o estado fica exposto em window.teia (câmera, controles,
 * funções de navegação).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { GradeNevoa, criarCamadas, erroCamadas, testesGrade, EXPOSICAO, RHO_M } from "./nevoa.js";
import { criarMarcadores } from "./marcadores.js";
import { criarFiltros } from "./filtros.js";
import { criarUniversos, posicoesDe, OMEGAS, SIGMAS } from "./universos.js";
import { criarExportar } from "./exportar.js";
import { criarTempo } from "./tempo.js";
import { criarEsqueleto } from "./esqueleto.js";
import { criarVooLivre } from "./voo_livre.js";
import { criarIntro } from "./intro.js";

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const LADO_CAIXA = 25.0;                         // Mpc/h (CAMELS L25n256)
const FOV_VERTICAL = 50;                         // graus
const MARGEM = 1.08;                             // folga em volta da caixa na vista inicial
const VISTA_INICIAL = {
  posicao: new THREE.Vector3(0, 0, 40),          // recalculada por distanciaParaCaber()
  alvo: new THREE.Vector3(0, 0, 0),
};

/**
 * Distância (ao longo de z) para a caixa INTEIRA caber na tela, olhando de frente.
 * A face da frente (z = +L/2) é a maior na perspectiva; ela precisa caber no menor dos dois
 * campos de visão (vertical ou horizontal, que depende do formato da tela).
 */
function distanciaParaCaber(aspecto) {
  // Na abertura a janela pode ter tamanho 0 (0/0 = NaN): usa 16:9 até o primeiro resize.
  if (!Number.isFinite(aspecto) || aspecto <= 0) aspecto = 16 / 9;
  const meiaVert = THREE.MathUtils.degToRad(FOV_VERTICAL / 2);
  const meiaHoriz = Math.atan(Math.tan(meiaVert) * aspecto);
  const meiaMenor = Math.min(meiaVert, meiaHoriz);
  return (MARGEM * LADO_CAIXA / 2) / Math.tan(meiaMenor) + LADO_CAIXA / 2;
}
const ZOOM_FATOR = 0.7;                          // cada "+" multiplica a distância por 0,7
const DISTANCIA_MIN = 0.05;                      // Mpc/h (50 kpc/h): dá para entrar num halo da versão
                                                 // completa (era 0,5 até a F3.14, quando a 1/64 era a única)
const DISTANCIA_MAX = 120;                       // Mpc/h: não se perder no vazio
const DURACAO_ANIMACAO_MS = 450;

const params = new URLSearchParams(location.search);
const intro = criarIntro(params);   // F3.5: tela de introdução por cima enquanto carrega (intro.js)
/**
 * PADRÃO (decisão do Victor, 19/10/2026, depois do diagnóstico ?medir=nevoa): versão 1/8 +
 * detalhe automático 0,15 + névoa em volume (passo 2 células, ¼ de resolução). Medido girando:
 * 30 / 56 / 30 QPS (fluido, no limite). Até 19/10 o padrão era a 1/64 sem névoa (60/59/60).
 * Tudo continua escolhível pelo endereço; ?arquivo=teia_1_64_magma.spz&lod=0&nevoa=0 = padrão antigo.
 */
// F3.11 (21/10/2026): ?universo=1P_p2_n1 abre um universo do CAMELS 1P (splats/dados/universos/)
const UNIVERSO_INICIAL = /^1P_p[12]_(n?[12]|0)$/.test(params.get("universo") ?? "") ? params.get("universo") : null;
let universoAtual = UNIVERSO_INICIAL;           // null = simulação padrão (CV_0)
const arquivoDoUniverso = (sim) => (sim ? `universos/${sim}_1_8.spz` : "teia_1_8_magma.spz");
let arquivo = UNIVERSO_INICIAL ? arquivoDoUniverso(UNIVERSO_INICIAL) : (params.get("arquivo") || "teia_1_8_magma.spz");
const E_1_8 = /_1_8[_.]/.test(arquivo);         // versões 1/8 (redonda, alongada e os universos)
const E_COMPLETA = /completa/.test(arquivo);

/**
 * Ajustes de desenho do Spark (F3.3/F3.14), escolhíveis pelo endereço para comparar:
 *   ?desvio=2      maxStdDev: até quantos desvios-padrão cada mancha é pintada
 *                  (Spark: padrão √8 ≈ 2,83; aceitável de 2 a 3). Padrão aqui: 2 — corta só a
 *                  borda quase invisível e, pelo modelo da F3.3, ganha ~30 % de velocidade.
 *   ?alfamin=0.05  minAlpha: pula manchas com opacidade abaixo disso (Spark: padrão 0,5/255).
 *                  ESCOLHA VISUAL: as manchas mais transparentes são as grandes dos vazios
 *                  (a "névoa"); pular deixa os vazios mais vazios na tela (a massa continua lá).
 *   ?raio=512      maxPixelRadius: raio máximo de uma mancha na tela, em pixels (padrão 512).
 * Modelo da F3.3 (6 medições do Victor, 15/10/2026): tempo por quadro ≈ 12 ms
 * + 27 ms por milhão de splats + 0,18 ms por milhão de pixels pintados (só nesta máquina).
 */
const AJUSTES = {
  maxStdDev: Number(params.get("desvio") ?? 2),
  minAlpha: Number(params.get("alfamin") ?? 0.5 / 255),
  maxPixelRadius: Number(params.get("raio") ?? 512),
};

/**
 * Resolução de desenho (F3.3). Decisão do Victor (15/10/2026): a névoa dos vazios FICA (é massa
 * que existe), então a velocidade vem de desenhar em menos pixels, sem esconder nenhuma mancha.
 *   ?resolucao=auto (padrão): metade da resolução ENQUANTO a câmera se mexe; volta à total
 *                   quando para (RESOLUCAO_PARADO_MS depois). Modelo da F3.3 prevê, na 1/64,
 *                   ~46 / 32 / 46 QPS em movimento (frente / perto / girada).
 *   ?resolucao=1 | 0.75 | 0.5: fixa a escala (para medir e comparar).
 */
const RESOLUCAO = params.get("resolucao") ?? "auto";

/**
 * Nível de detalhe (F3.14), recurso do Spark 2 (sparkjs.dev/docs/lod-getting-started):
 *   ?lod=1        o Spark monta a árvore de detalhe ao carregar, num WebWorker
 *                 ("1–3 s por milhão de splats"); longe usa manchas-resumo, perto abre o detalhe.
 *   ?lodescala=   lodSplatScale: multiplica o número-alvo de manchas por quadro (padrão do Spark
 *                 no computador: 2,5 milhões). Aqui o padrão é 0,25 (~625 mil), porque o modelo
 *                 da F3.3 indica que esta máquina fica fluida até ~0,5–0,7 milhão.
 *   ?ext=0        desliga extSplats. PADRÃO = LIGADO (posições em float32). Teste de resposta
 *                 conhecida (15/10/2026, teste_precisao.spz): na codificação compacta do Spark,
 *                 5 manchas a cada 2 kpc/h em x ≈ 11 viraram 2 — degrau de ~7,8 kpc/h, igual
 *                 ao previsto para float16. Com float32 aparecem as 5. Isso borrava os centros
 *                 dos halos desde a F2.4 sem ninguém notar.
 */
// detalhe automático: ligado por padrão na 1/8 e na completa (?lod=0 desliga, ?lod=1 liga em qualquer uma)
const LOD = params.has("lod") ? params.get("lod") === "1" : (E_1_8 || E_COMPLETA);
// 0,15 desde 19/10 (era 0,25): com 0,25 a 1/8 SEM névoa já ficava no limite (31/30/55 girando)
const LOD_ESCALA = Number(params.get("lodescala") ?? 0.15);
const EXT = params.get("ext") !== "0";
/**
 * Névoa em volume (F3.17), FILTRO — decisão do Victor (17/10/2026, opção 1). Detalhes em nevoa.js.
 *   ?nevoa=1     liga, grade 256³ (célula 98 kpc/h). ?nevoa=192 ou 128: grade mais leve (células
 *                maiores → menos manchas viram névoa). Sem o parâmetro: só manchas, como antes.
 *   ?passo=1     passo do raio em células (padrão 1; 0,5 = mais fino e mais lento)
 */
// névoa: ligada por padrão SÓ na 1/8 (a completa levaria minutos para montar; ?nevoa=1 liga em
// qualquer uma, ?nevoa=0 desliga, ?nevoa=192/128 escolhe a grade)
const NEVOA_PARAM = params.get("nevoa") ?? (E_1_8 ? "1" : "0");
const NEVOA_N = NEVOA_PARAM === "1" ? 256 : Number(NEVOA_PARAM);
const NEVOA = NEVOA_N >= 32;
// passo 2 células desde 19/10 (conferido: erro médio 0,03 %, pior pixel 1,1 %; 3 células erra 20 %)
const NEVOA_PASSO = Number(params.get("passo") ?? 2);
// ?nevoaescala=0.5 (padrão): névoa desenhada fora da tela em meia resolução fixa (ver nevoa.js);
// ?nevoaescala=1: resolução total; ?nevoaescala=0 desliga o modo fora da tela (como na 1ª versão).
// ¼ de resolução desde 19/10 (diagnóstico: ½ = 30/20/30, ¼ + passo 2 = 30/56/30 girando)
const NEVOA_ESCALA = Number(params.get("nevoaescala") ?? 0.25);
const ESCALA_MOVENDO = 0.5;
const RESOLUCAO_PARADO_MS = 400;

// ---------------------------------------------------------------------------
// Cena
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false });
let escalaAtual = RESOLUCAO === "auto" ? 1 : Number(RESOLUCAO);
renderer.setPixelRatio(window.devicePixelRatio * escalaAtual);

/** Muda a escala de resolução do desenho (1 = total), só se mudou de fato. */
function definirEscala(escala) {
  if (escala === escalaAtual) return;
  escalaAtual = escala;
  renderer.setPixelRatio(window.devicePixelRatio * escala);
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
/** Proporção largura/altura da janela, protegida contra janela de tamanho 0. */
function aspectoJanela() {
  const a = window.innerWidth / window.innerHeight;
  return Number.isFinite(a) && a > 0 ? a : 16 / 9;
}

const camera = new THREE.PerspectiveCamera(FOV_VERTICAL, aspectoJanela(), 0.01, 1000);
VISTA_INICIAL.posicao.set(0, 0, distanciaParaCaber(camera.aspect));
camera.position.copy(VISTA_INICIAL.posicao);

scene.add(new SparkRenderer({ renderer, ...AJUSTES, ...(LOD ? { lodSplatScale: LOD_ESCALA } : {}) }));

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(VISTA_INICIAL.alvo);
controls.minDistance = DISTANCIA_MIN;
controls.maxDistance = DISTANCIA_MAX;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

// Resolução adaptativa: metade enquanto se mexe, total quando para.
let ultimoMovimento = -Infinity;
function marcarMovimento() {
  ultimoMovimento = performance.now();
  if (RESOLUCAO === "auto") definirEscala(ESCALA_MOVENDO);
}
controls.addEventListener("change", marcarMovimento);

// Contorno da caixa: as 12 arestas do cubo de 25 Mpc/h
const contorno = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(LADO_CAIXA, LADO_CAIXA, LADO_CAIXA)),
  new THREE.LineBasicMaterial({ color: 0x8a7fa8, transparent: true, opacity: 0.45 }),
);
scene.add(contorno);

// ---------------------------------------------------------------------------
// Splats
// ---------------------------------------------------------------------------
const elEstado = document.getElementById("estado");
const elCarregando = document.getElementById("carregando");
const inicioCarga = performance.now();
let nevoa = null;  // { grade, camadas, testes, fracao } quando o filtro está ligado

// ---------------------------------------------------------------------------
// Cor das manchas (F3.7, 20/10/2026): estimador de densidade (A/C/B/D) e paleta, como FILTRO.
// Dados: ../splats/dados/estimadores_<versao>.bin (uint8, índice de cor de cada mancha para os 4
// estimadores, na resolução completa) + paletas_lut.json (as 256 cores de cada paleta). Gerados por
// splats/estimadores_web.py, que confere LUT[índice] = cor do gerador em TODAS as manchas.
// Só as versões 1/64 e 1/8 (e alongadas) têm os dados; a completa e a fatia ficam no padrão.
// O tamanho das manchas e a opacidade NÃO mudam com o estimador (vêm de h e da massa): só a cor.
// ---------------------------------------------------------------------------
// só a família da simulação padrão (teia_*) tem os dados de cor por estimador; os universos 1P não
const VERSAO_COR = UNIVERSO_INICIAL && !params.has("arquivo") ? "1_8"
  : /^teia_1_8_/.test(arquivo) ? "1_8" : /^teia_1_64_/.test(arquivo) ? "1_64" : null;
// F3.8 (ajuste de 21/10, pedido do Victor): qualquer par X ÷ Y entre os 4 estimadores, não só contra o A.
// log(X/Y) = log(X/A) − log(Y/A), com log(A/A) = 0 → sai dos mesmos dados (erro ≤ 0,01 em log₁₀).
const PARES_VALIDOS = ["C/A", "B/A", "D/A", "B/C", "D/C", "D/B"];
function normalizarPar(p) {
  const s = (p ?? "B/A").toUpperCase().replace("÷", "/");
  const par = s.includes("/") ? s : `${s}/A`;      // compatível com ?par=B (antes de 21/10)
  return PARES_VALIDOS.includes(par) ? par : "B/A";
}
const ORDEM_ESTIMADORES = ["A", "C", "B", "D"];           // blocos do .bin (gerar_splats.ESTIMADORES)
const CHAVE_PALETA = { magma: "c_magma", corpo_negro: "b_corpo_negro", artistica: "d_artistica" };
const cor = {
  estimador: ORDEM_ESTIMADORES.includes((params.get("estimador") ?? "A").toUpperCase())
    ? (params.get("estimador") ?? "A").toUpperCase() : "A",
  paleta: CHAVE_PALETA[params.get("paleta")] ? params.get("paleta") : "magma",
  // F3.8: o que a cor mostra — "densidade" (estimador acima) ou "discordancia" (par ÷ A)
  camada: ["discordancia", "lab"].includes(params.get("camada")) ? params.get("camada") : "densidade",
  par: normalizarPar(params.get("par")),
  // F3.9 laboratório (decisão do Victor, 21/10: só "mistura com peso"): ρ = ρ_X^(1−p) · ρ_Y^p
  labX: ORDEM_ESTIMADORES.includes((params.get("x") ?? "A").toUpperCase()) ? (params.get("x") ?? "A").toUpperCase() : "A",
  labY: ORDEM_ESTIMADORES.includes((params.get("y") ?? "B").toUpperCase()) ? (params.get("y") ?? "B").toUpperCase() : "B",
  labPeso: Math.min(100, Math.max(0, Math.round(Number(params.get("peso") ?? 50)) || 0)),
  // F3.10 (21/10): densidade da partícula na simulação COMPLETA (padrão) ou recalculada na própria VERSÃO leve
  resolucao: params.get("resolucao_cor") === "versao" ? "versao" : "completa",
};
if (cor.labX === cor.labY) cor.labY = cor.labX === "B" ? "A" : "B";
if (!VERSAO_COR) { cor.estimador = "A"; cor.paleta = "magma"; cor.camada = "densidade"; cor.resolucao = "completa"; }
const corPadrao = () => cor.estimador === "A" && cor.paleta === "magma" && cor.camada === "densidade" &&
  cor.resolucao === "completa";

// ---------------------------------------------------------------------------
// Camada "incerteza do método" (F3.8, 21/10/2026): a cor mostra log₁₀(ρ_par / ρ_A) de cada mancha
// numa paleta divergente (coolwarm, Moreland 2009): cinza = concordam, vermelho = par maior que A,
// azul = menor. Escala ÷3 a ×3 (convenção; além disso satura). Dados: discordancia_<versao>.bin
// (int8, passo 0,01 em log₁₀) + paleta_divergente.json, de splats/discordancia_web.py.
// ---------------------------------------------------------------------------
const ORDEM_PARES = ["C", "B", "D"];               // blocos do discordancia_<versao>.bin
let dadosDisc = null;     // { q: Int8Array (3·N), n, lut: Float32Array(768), passo, escala }
async function carregarDadosDisc() {
  if (dadosDisc || !VERSAO_COR) return dadosDisc;
  const [pal, bin] = await Promise.all([
    fetch("../splats/dados/paleta_divergente.json").then((r) => (r.ok ? r.json() : null)),
    fetch(`../splats/dados/discordancia_${VERSAO_COR}.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)),
  ]);
  if (!pal || !bin) return null;
  dadosDisc = { q: new Int8Array(bin), n: bin.byteLength / 3, lut: Float32Array.from(pal.lut.flat()),
                passo: pal.passo_log10, escala: pal.escala_log10 };
  return dadosDisc;
}
let dadosCor = null;      // { indices: Uint8Array (4·N), n, lut: {chave: Float32Array(768)} }
let conferenciaOrdem = null; // U9: cor do arquivo × LUT[índice A] (confere a ordem das manchas)

async function carregarDadosCor() {
  if (universoAtual) return null;              // F3.11: dados de cor são da CV_0
  if (dadosCor || !VERSAO_COR) return dadosCor;
  const [paletas, bin] = await Promise.all([
    fetch("../splats/dados/paletas_lut.json").then((r) => (r.ok ? r.json() : null)),
    fetch(`../splats/dados/estimadores_${VERSAO_COR}.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)),
  ]);
  if (!paletas || !bin) return null;
  const lut = {};
  for (const [chave, tabela] of Object.entries(paletas.lut)) lut[chave] = Float32Array.from(tabela.flat());
  dadosCor = { indices: new Uint8Array(bin), n: bin.byteLength / 4, lut, indicesVersao: null };
  return dadosCor;
}

/** F3.10: índices de cor da densidade recalculada na própria versão leve (carrega só quando pedido). */
async function carregarIndicesVersao() {
  const dc = await carregarDadosCor();
  if (!dc || dc.indicesVersao) return dc ? dc.indicesVersao : null;
  const bin = await fetch(`../splats/dados/estimadores_${VERSAO_COR}_versao.bin`).then((r) => (r.ok ? r.arrayBuffer() : null));
  if (bin && bin.byteLength === dc.indices.byteLength) dc.indicesVersao = new Uint8Array(bin);
  return dc.indicesVersao;
}

let malhaAtual = null;

/**
 * Carrega a teia. Caminho direto (cor padrão e sem névoa): o arquivo vai para o Spark.
 * Senão: lê o arquivo numa malha temporária e remonta mancha a mancha — trocando a cor pelo
 * estimador/paleta escolhidos (F3.7) e, com a névoa ligada (F3.17), mandando as manchas com
 * σ ≥ célula para a grade e o resto (halos) para a malha que o Spark desenha.
 * Pode ser chamada de novo (trocarCor) depois de descartarTeia().
 */
async function carregarTeia() {
  const url = "../splats/dados/" + arquivo;
  // F3.21: névoa PRÉ-CALCULADA (splats/nevoa_pre.py) — cor padrão + névoa ligada + arquivo pronto existe.
  // ?nevoa_pre=0 força o cálculo no navegador (caminho antigo); ?conferir_nevoa=1 faz os dois e compara (N4).
  if (NEVOA && corPadrao() && params.get("nevoa_pre") !== "0") {
    const pronta = await carregarNevoaPronta();
    if (pronta) return pronta;
  }
  const dc = await carregarDadosCor();
  const dd = cor.camada === "discordancia" ? await carregarDadosDisc() : null;
  // F3.10: a densidade da própria versão vale para a camada "densidade"; incerteza e laboratório
  // continuam na resolução completa (dito no painel)
  const indicesVersao = cor.resolucao === "versao" && cor.camada === "densidade" ? await carregarIndicesVersao() : null;
  const recolorir = !corPadrao() && !!dc && (cor.camada !== "discordancia" || !!dd);
  if (!NEVOA && !recolorir) {
    const malha = new SplatMesh({ url, ...(LOD ? { lod: true } : {}), ...(EXT ? { extSplats: true } : {}) });
    scene.add(malha);
    malhaAtual = malha;
    return malha.initialized;
  }
  const base = arquivo.replace(/\.(spz|ply)$/, "");
  const meta = await fetch(`../splats/dados/${base}.json`).then((r) => (r.ok ? r.json() : null));
  if (NEVOA && (!meta || !meta.massa_por_splat_msun_h)) throw new Error(`névoa precisa de ${base}.json com a massa por mancha`);
  const m = meta ? meta.massa_por_splat_msun_h : 0;
  elCarregando.textContent = "Lendo as manchas…";
  const tempos = {}, marca = (nome, t0) => { tempos[nome] = +((performance.now() - t0) / 1000).toFixed(2); };
  let t0 = performance.now();
  const temp = new SplatMesh({ url, ...(EXT ? { extSplats: true } : {}) });
  await temp.initialized;
  marca("ler_arquivo_s", t0);
  const nArquivo = temp.numSplats;
  const usarCor = dc && dc.n === nArquivo;   // tamanhos diferentes = dados de outra versão: não usa
  if (dc && !usarCor) console.warn(`estimadores_${VERSAO_COR}.bin tem ${dc.n} manchas, o arquivo ${nArquivo}: cor padrão`);
  elCarregando.textContent = NEVOA ? `Montando a névoa (grade ${NEVOA_N}³)… o navegador pode parar por alguns segundos`
                                   : "Aplicando a cor do estimador escolhido…";
  await new Promise((r) => setTimeout(r, 50)); // deixa a mensagem aparecer antes da conta pesada
  const grade = NEVOA ? new GradeNevoa(NEVOA_N, LADO_CAIXA) : null;
  const razoesTau = [];  // N3: α do arquivo × regra das manchas, para manchas fora do piso de 1 %
  let total = 0;
  const usarDisc = usarCor && recolorir && cor.camada === "discordancia" && dd && dd.n === nArquivo;
  const [parX, parY] = cor.par.split("/");
  const blocoX = usarDisc && parX !== "A" ? ORDEM_PARES.indexOf(parX) * nArquivo : -1;   // −1 = é o A (log 0)
  const blocoY = usarDisc && parY !== "A" ? ORDEM_PARES.indexOf(parY) * nArquivo : -1;
  const blocoDisc = usarDisc ? 0 : -1;
  const usarLab = usarCor && recolorir && cor.camada === "lab";
  const blocoCor = usarCor && recolorir && !usarDisc && !usarLab ? ORDEM_ESTIMADORES.indexOf(cor.estimador) * nArquivo : -1;
  // F3.9: mistura em log = mistura dos ÍNDICES de cor (o índice é linear em log₁₀ρ dentro da faixa):
  // exato nas pontas (0 % = X, 100 % = Y); no meio, arredondamento de até 1 tom (em 256); onde um dos dois
  // estava fora da faixa de cor (saturado), a mistura parte do valor saturado.
  const labBX = usarLab ? ORDEM_ESTIMADORES.indexOf(cor.labX) * nArquivo : -1;
  const labBY = usarLab ? ORDEM_ESTIMADORES.indexOf(cor.labY) * nArquivo : -1;
  const labP = cor.labPeso / 100;
  const lutAtiva = usarCor ? dc.lut[CHAVE_PALETA[cor.paleta]] : null;
  const lutA = usarCor ? dc.lut.c_magma : null;
  const passoConf = usarCor ? Math.max(1, Math.floor(nArquivo / 20000)) : 0;
  const conf = { n: 0, difMax: 0 };
  const corNova = new THREE.Color();
  t0 = performance.now();
  const malha = new SplatMesh({
    ...(EXT ? { extSplats: true } : {}), ...(LOD ? { lod: true } : {}),
    constructSplats: (splats) => {
      temp.forEachSplat((i, centro, escalas, quat, opacidade, corArquivo) => {
        total++;
        if (passoConf && i % passoConf === 0) {  // U9: cor do arquivo = magma[índice A]? (ordem certa)
          const k = 3 * dc.indices[i];
          conf.difMax = Math.max(conf.difMax, Math.abs(corArquivo.r - lutA[k]), Math.abs(corArquivo.g - lutA[k + 1]),
                                 Math.abs(corArquivo.b - lutA[k + 2]));
          conf.n++;
        }
        let c = corArquivo;
        if (blocoCor >= 0) {
          const k = 3 * (indicesVersao ?? dc.indices)[blocoCor + i];
          c = corNova.setRGB(lutAtiva[k], lutAtiva[k + 1], lutAtiva[k + 2]);
        } else if (usarLab) {
          const k = 3 * Math.round((1 - labP) * dc.indices[labBX + i] + labP * dc.indices[labBY + i]);
          c = corNova.setRGB(lutAtiva[k], lutAtiva[k + 1], lutAtiva[k + 2]);
        } else if (blocoDisc >= 0) {   // F3.8: v = (r + escala) / (2·escala) → índice na coolwarm
          const r = ((blocoX >= 0 ? dd.q[blocoX + i] : 0) - (blocoY >= 0 ? dd.q[blocoY + i] : 0)) * dd.passo;
          const v = Math.min(1, Math.max(0, (r + dd.escala) / (2 * dd.escala)));
          const k = 3 * Math.min(255, Math.floor(v * 256));
          c = corNova.setRGB(dd.lut[k], dd.lut[k + 1], dd.lut[k + 2]);
        }
        if (grade && grade.vaiParaNevoa(escalas.x, escalas.y, escalas.z)) {
          grade.depositar(centro, escalas, quat, m, c);
          if (opacidade > 0.03 && opacidade < 0.9 && razoesTau.length < 20000) {
            const sg2 = Math.cbrt(escalas.x * escalas.y * escalas.z) ** 2;  // volume preservado na alongada
            razoesTau.push(-Math.log(1 - opacidade) / (EXPOSICAO * m / (2 * Math.PI * sg2 * RHO_M)));
          }
        } else {
          splats.pushSplat(centro, escalas, quat, opacidade, c);
        }
      });
      // Spark 2.3.1: no modo float32 (ExtSplats), montar por código NÃO envia os dados para a placa
      // de vídeo (só a leitura de arquivo envia) → os halos ficavam invisíveis. Achado em 17/10
      // medindo o brilho com a névoa escondida (tela preta). O modo compacto envia sozinho.
      if (typeof splats.updateTextures === "function") splats.updateTextures();
    },
  });
  await malha.initialized;
  marca(NEVOA ? "separar_e_depositar_s" : "recolorir_s", t0); t0 = performance.now();
  if (LOD) { await malha.createLodSplats(); marca("detalhe_automatico_s", t0); t0 = performance.now(); }
  temp.dispose();
  scene.add(malha);
  malhaAtual = malha;
  // SPZ guarda a cor com degrau de ~0,0074 (colorScale 0,15, 8 bits): tolerância 0,02
  conferenciaOrdem = usarCor ? { ...conf, passou: conf.n > 0 && conf.difMax < 0.02 } : null;
  if (!NEVOA) return malha;
  const camadas = criarCamadas(grade.textura(), LADO_CAIXA, NEVOA_PASSO * grade.delta,
                               NEVOA_ESCALA > 0 ? { escalaAlvo: NEVOA_ESCALA } : {});
  scene.add(camadas.tras, camadas.frente);
  marca("textura_s", t0);
  razoesTau.sort((a, b) => a - b);
  const mediana = razoesTau.length ? razoesTau[Math.floor(razoesTau.length / 2)] : NaN;
  const testes = [...testesGrade(), {
    nome: "N3 névoa: α do arquivo = regra das manchas (constantes batem)",
    passou: Math.abs(mediana / 1 - 1) < 0.02,
    detalhe: razoesTau.length ? `mediana τ_arquivo/τ_regra ${mediana.toFixed(4)} em ${razoesTau.length} manchas`
                              : "nenhuma mancha da névoa fora do piso de 1 % (nada a conferir)",
  }];
  if (!razoesTau.length) testes[testes.length - 1].passou = true;
  nevoa = { tempos, grade, camadas, testes, fracao: grade.manchas / total, manchasNevoa: grade.manchas, total };
  return malha;
}

/**
 * F3.21: carrega a névoa pronta (grade em meia precisão, gzip) + o .spz só dos halos. Devolve a malha,
 * ou null se não houver arquivo pronto para esta versão/grade (aí o chamador usa o caminho antigo).
 */
async function carregarNevoaPronta() {
  const base = arquivo.replace(/\.(spz|ply)$/, "");
  const meta = await fetch(`../splats/dados/${base}_nevoa${NEVOA_N}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!meta) return null;
  const tempos = {}, marca = (nome, t0) => { tempos[nome] = +((performance.now() - t0) / 1000).toFixed(2); };
  let t0 = performance.now();
  elCarregando.textContent = "Carregando a névoa pré-calculada…";
  const urlGrade = `../splats/dados/${meta.grade}`;
  const resposta = await fetch(urlGrade);
  if (!resposta.ok) return null;
  const bruto = await new Response(resposta.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const n3 = meta.n ** 3;
  if (bruto.byteLength !== 5 * n3) { console.warn("grade da névoa com tamanho errado: caminho antigo"); return null; }
  // camadas: κ float16 (N³) + R, G, B uint8 (N³ cada) → κ direto; cor intercalada em RGBA para a textura
  const kappaMeia = new Uint16Array(bruto, 0, n3);
  const planos = [0, 1, 2].map((c) => new Uint8Array(bruto, 2 * n3 + c * n3, n3));
  const corRGBA8 = new Uint8Array(4 * n3);
  for (let i = 0, j = 0; i < n3; i++, j += 4) { corRGBA8[j] = planos[0][i]; corRGBA8[j + 1] = planos[1][i]; corRGBA8[j + 2] = planos[2][i]; }
  marca("grade_s", t0); t0 = performance.now();
  const malha = new SplatMesh({ url: `../splats/dados/${meta.halos}`, ...(LOD ? { lod: true } : {}), ...(EXT ? { extSplats: true } : {}) });
  scene.add(malha);
  await malha.initialized;
  malhaAtual = malha;
  marca("halos_s", t0); t0 = performance.now();
  const grade = GradeNevoa.deCamadas(meta.n, LADO_CAIXA, kappaMeia, corRGBA8);
  const camadas = criarCamadas(grade.textura(), LADO_CAIXA, NEVOA_PASSO * grade.delta,
                               { ...(NEVOA_ESCALA > 0 ? { escalaAlvo: NEVOA_ESCALA } : {}), corTextura: grade.texturaCor() });
  scene.add(camadas.tras, camadas.frente);
  marca("textura_s", t0);
  conferenciaOrdem = null;
  const testes = [...testesGrade(), { nome: "N3 névoa: α do arquivo = regra das manchas (constantes batem)", passou: true,
    detalhe: "não se aplica: névoa pré-calculada (o Python já confere as constantes; N4 compara as duas contas)" }];
  if (params.has("conferir_nevoa")) testes.push(await conferirNevoaPronta(grade, meta));
  nevoa = { tempos, grade, camadas, testes, fracao: meta.manchas_nevoa / meta.manchas_total,
            manchasNevoa: meta.manchas_nevoa, total: meta.manchas_total, pronta: true };
  return malha;
}

/**
 * N4 (F3.21): refaz a grade NO NAVEGADOR (a conta antiga, mesma do nevoa.js) e compara com a pronta do
 * Python, célula a célula. Critério (registrado antes de medir): massa total (Σκ·Δ³) igual a 0,5 % e,
 * nas células com κ acima de 1 % do máximo, diferença relativa mediana < 0,5 % e máxima < 2 % (meia
 * precisão guarda ~3 algarismos; ordem de soma e decodificação do .spz podem diferir no último dígito).
 */
async function conferirNevoaPronta(pronta, meta) {
  elCarregando.textContent = "Conferindo: refazendo a névoa no navegador para comparar (N4)…";
  await new Promise((r) => setTimeout(r, 50));
  const temp = new SplatMesh({ url: "../splats/dados/" + arquivo, ...(EXT ? { extSplats: true } : {}) });
  await temp.initialized;
  const g = new GradeNevoa(meta.n, LADO_CAIXA);
  temp.forEachSplat((i, centro, escalas, quat, opacidade, cor) => {
    if (g.vaiParaNevoa(escalas.x, escalas.y, escalas.z)) g.depositar(centro, escalas, quat, meta.massa_por_splat_msun_h, cor);
  });
  temp.dispose();
  const total = meta.n ** 3;
  let somaJs = 0, somaPy = 0, maxPy = 0;
  for (let i = 0; i < total; i++) { const k = pronta.kappaCelula(i); somaPy += k; if (k > maxPy) maxPy = k; somaJs += g.rgbk[4 * i + 3]; }
  const difs = [];
  for (let i = 0; i < total; i += 7) {
    const kp = pronta.kappaCelula(i);
    if (kp > 0.01 * maxPy) difs.push(Math.abs(g.rgbk[4 * i + 3] / kp - 1));
  }
  difs.sort((a, b) => a - b);
  const med = difs[Math.floor(difs.length / 2)] ?? 0, max = difs[difs.length - 1] ?? 0;
  const massa = Math.abs(somaJs / somaPy - 1);
  return { nome: "N4 névoa pronta (Python) = névoa calculada no navegador", passou: massa < 0.005 && med < 0.005 && max < 0.02,
           detalhe: `massa ${(100 * massa).toFixed(3)} %; ${difs.length} células: mediana ${(100 * med).toFixed(3)} %, máx ${(100 * max).toFixed(3)} %; ` +
                    `manchas na névoa: navegador ${g.manchas}, Python ${meta.manchas_nevoa}` };
}

/** Tira a teia da cena e libera a memória (malha do Spark, textura e imagens da névoa). */
function descartarTeia() {
  if (malhaAtual) { scene.remove(malhaAtual); malhaAtual.dispose(); malhaAtual = null; }
  if (nevoa) {
    scene.remove(nevoa.camadas.tras, nevoa.camadas.frente);
    nevoa.camadas.descartar();
    nevoa = null;
  }
}

/** Texto curto da cor ativa, para a linha de estado. */
const textoCor = () => (!VERSAO_COR || universoAtual ? "" : cor.camada === "lab"
  ? ` · cor: SUA REGRA (não publicada): ${100 - cor.labPeso} % ${cor.labX} + ${cor.labPeso} % ${cor.labY} (média em log), paleta ${cor.paleta.replace("_", " ")}`
  : cor.camada === "discordancia"
  ? ` · cor: incerteza do método, ${cor.par.replace("/", " ÷ ")} (coolwarm, ÷3 a ×3)`
  : ` · cor: estimador ${cor.estimador}${cor.estimador === "A" ? " (padrão)" : ""}, paleta ${cor.paleta.replace("_", " ")}` +
    (cor.resolucao === "versao" ? ", densidade da própria versão leve" : ""));

let trocandoCor = false;
let trocaPendente = null;
/**
 * Troca o que a cor mostra SEM recarregar a página: descarta e remonta a teia (a câmera fica onde
 * está). mudancas = { estimador, paleta, camada, par } (só o que muda). Custa o tempo de montar de
 * novo (com névoa, a grade é refeita com as novas cores). Guarda a escolha no endereço
 * (?estimador=&paleta=&camada=&par=) para recarregar e compartilhar igual.
 * Compatível com a forma antiga trocarCor(estimador, paleta).
 */
async function trocarCor(mudancas = {}, paletaAntiga) {
  if (typeof mudancas === "string") mudancas = { estimador: mudancas, paleta: paletaAntiga ?? cor.paleta };
  const novo = { ...cor, ...mudancas };
  if (novo.labX === novo.labY) return false;     // laboratório precisa de dois estimadores diferentes
  const igual = ["estimador", "paleta", "camada", "par", "labX", "labY", "labPeso", "resolucao"].every((k) => novo[k] === cor[k]);
  if (!VERSAO_COR || universoAtual || igual) return false;
  if (trocandoCor) { trocaPendente = { ...(trocaPendente ?? {}), ...mudancas }; return false; }  // aplica ao terminar
  trocandoCor = true;
  Object.assign(cor, novo);
  filtros.atualizar();   // trava as opções e avisa "remontando" enquanto troca
  const u = new URL(location.href);
  const guardar = (chave, valor, padrao) => { if (valor === padrao) u.searchParams.delete(chave); else u.searchParams.set(chave, valor); };
  guardar("estimador", cor.estimador, "A"); guardar("paleta", cor.paleta, "magma");
  guardar("camada", cor.camada, "densidade"); guardar("par", cor.camada === "discordancia" ? cor.par : "B/A", "B/A");
  const lab = cor.camada === "lab";
  guardar("resolucao_cor", cor.resolucao, "completa");
  guardar("x", lab ? cor.labX : "A", "A"); guardar("y", lab ? cor.labY : "B", "B"); guardar("peso", lab ? String(cor.labPeso) : "50", "50");
  history.replaceState(null, "", u);
  elCarregando.hidden = false; elCarregando.classList.remove("oculto");
  elCarregando.textContent = "Trocando a cor…";
  await new Promise((r) => setTimeout(r, 50));
  const inicio = performance.now();
  try {
    descartarTeia();
    await carregarTeia();
    window.teia.tempoTrocaCorS = +((performance.now() - inicio) / 1000).toFixed(1);
    elEstado.textContent = elEstado.textContent.replace(/ · cor: .*$/, "") + textoCor();
  } finally {
    elCarregando.classList.add("oculto");
    setTimeout(() => { elCarregando.hidden = true; }, 500);
    trocandoCor = false;
    filtros.atualizar();
  }
  if (trocaPendente) { const m = trocaPendente; trocaPendente = null; trocarCor(m); }  // ex.: mexeu no peso durante a troca
  return true;
}

const elNevoa = NEVOA ? Object.assign(document.createElement("div"), { className: "estado", id: "estado-nevoa" }) : null;
if (elNevoa) document.getElementById("info").appendChild(elNevoa);
let ultimaEstimativa = -Infinity;

/** Linha de estado da névoa: quantas manchas viraram névoa e o erro estimado da ordem em camadas. */
function atualizarEstadoNevoa() {
  if (!nevoa) return;
  const e = erroCamadas(nevoa.grade, camera, controls.target);
  nevoa.erro = e;
  elNevoa.textContent = `névoa em volume (grade ${NEVOA_N}³, célula ${(nevoa.grade.delta * 1000).toFixed(0)} kpc/h): ` +
    `${(100 * nevoa.fracao).toFixed(0)} % das manchas viraram névoa · fiel no ponto de foco; ` +
    `fora dele, o brilho de um halo pode errar até ×${e.fatorMax.toFixed(2)} ` +
    `(névoa na frente τ=${e.tauFrente.toFixed(2)}, atrás τ=${e.tauTras.toFixed(2)}, raio central)`;
}

/** Linha de estado: arquivo, tempo de carga, ajustes de desenho, universo e cor. */
function textoEstado(segundos) {
  // 21/10: nome amigável primeiro (Universo 1 / Universo 2 + receita); o arquivo fica no fim, para as medições
  const fmt = (v) => String(v).replace(".", ",");
  const nome = universoAtual && metadados && metadados.universo
    ? `Universo 2 (laboratório) · receita Ωm ${fmt(metadados.universo.omega_m)} · σ8 ${fmt(metadados.universo.sigma8)}`
    : "Universo 1 (principal)";
  return `${nome} · carregado em ${segundos} s · desvio ${AJUSTES.maxStdDev.toFixed(2)} · ` +
    `opacidade mín. ${AJUSTES.minAlpha < 0.01 ? "padrão" : AJUSTES.minAlpha} · resolução ${RESOLUCAO}` +
    (LOD ? ` · detalhe automático (×${LOD_ESCALA})` : "") + (EXT ? " · posições float32" : "") + textoCor() + ` · arquivo ${arquivo}`;
}

carregarTeia()
  .then(async () => {
    const segundos = ((performance.now() - inicioCarga) / 1000).toFixed(1);
    window.teia.tempoCargaS = Number(segundos);
    await metadadosProntos;
    elEstado.textContent = textoEstado(segundos);
    elCarregando.classList.add("oculto");
    // a transição de opacidade pode travar com o WebGL pesado: remove de vez em seguida
    setTimeout(() => { elCarregando.hidden = true; }, 500);
    // ?alvo=x,y,z&dist=d: abre olhando para esse ponto (link "ver na versão completa" da F3.15)
    if (params.has("alvo")) {
      const a = params.get("alvo").split(",").map(Number);
      const d = Number(params.get("dist") ?? 2);
      if (a.length === 3 && a.every(Number.isFinite) && Number.isFinite(d)) {
        controls.target.set(a[0], a[1], a[2]);
        camera.position.set(a[0], a[1], a[2] + THREE.MathUtils.clamp(d, DISTANCIA_MIN, DISTANCIA_MAX));
        controls.update();
      }
    }
    window.teia.pronta = true;
    intro.pronta();
    if (params.has("testes")) {  // ?testes=1 → roda os testes de navegação (testes_navegacao.js)
      import("./testes_navegacao.js").then(async (m) => m.mostrarResultado([...m.rodarTestes(window.teia),
        ...(await m.rodarTestesMarcadores(window.teia)), ...m.rodarTestesCor(window.teia), ...m.rodarTestesGiro(window.teia),
        ...(await m.rodarTestesTela(window.teia)), ...(await m.rodarTestesExportar(window.teia)),
        ...m.rodarTestesRegua(window.teia), ...(await m.rodarTestesEsqueleto(window.teia)), ...m.rodarTestesVooLivre(window.teia),
        ...(nevoa ? nevoa.testes : [])]));
    }
    if (params.has("medir")) {   // ?medir=1 → roteiro de medição de QPS (medir_fps.js)
      import("./medir_fps.js").then((m) => (params.get("medir") === "nevoa"
        ? m.rodarDiagnosticoNevoa(window.teia, arquivo) : m.rodarMedicao(window.teia, arquivo)));
    }
  })
  .catch((erro) => {
    intro.erro("Não foi possível carregar a teia (veja o README).");
    elEstado.textContent = `erro ao carregar ${arquivo}: ${erro}`;
    elCarregando.textContent = "Não foi possível carregar a teia. Veja o README (problemas comuns).";
  });

// ---------------------------------------------------------------------------
// Navegação (F3.13)
// ---------------------------------------------------------------------------
let animacao = null; // { de: {pos, alvo}, para: {pos, alvo}, inicio }

/**
 * Zera a inércia do giro (amortecimento do OrbitControls). Sem isso, o resto do movimento
 * de um arrasto anterior continua sendo aplicado e tira a câmera do destino da animação.
 * Truque só com API pública: com o amortecimento desligado, update() consome todo o resto
 * de uma vez; depois devolvemos câmera e alvo para onde estavam.
 */
function zerarInercia() {
  const pos = camera.position.clone(), alvo = controls.target.clone();
  const amortecimento = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  camera.position.copy(pos);
  controls.target.copy(alvo);
  controls.update();
  controls.enableDamping = amortecimento;
}

/** Move câmera e alvo suavemente até o destino. */
function animarPara(posicao, alvo) {
  zerarInercia();
  animacao = {
    dePos: camera.position.clone(), deAlvo: controls.target.clone(),
    paraPos: posicao.clone(), paraAlvo: alvo.clone(), inicio: performance.now(),
  };
}

/** Volta à vista inicial (a caixa inteira de frente). */
function voltarACaixa() {
  animarPara(VISTA_INICIAL.posicao, VISTA_INICIAL.alvo);
}

/** Aproxima (fator < 1) ou afasta (fator > 1) ao longo da linha de visão, respeitando os limites. */
function zoom(fator) {
  passoAnimacao(Infinity); // se havia animação em curso, conclui antes (cliques rápidos se acumulam)
  const dir = camera.position.clone().sub(controls.target);
  const distancia = THREE.MathUtils.clamp(dir.length() * fator, DISTANCIA_MIN, DISTANCIA_MAX);
  const destino = controls.target.clone().add(dir.setLength(distancia));
  animarPara(destino, controls.target);
}

/** Liga/desliga o contorno da caixa. */
function alternarContorno() {
  contorno.visible = !contorno.visible;
  document.getElementById("bt-contorno").setAttribute("aria-pressed", String(contorno.visible));
}

document.getElementById("bt-voltar").addEventListener("click", voltarACaixa);
document.getElementById("bt-mais").addEventListener("click", () => zoom(ZOOM_FATOR));
document.getElementById("bt-menos").addEventListener("click", () => zoom(1 / ZOOM_FATOR));
document.getElementById("bt-contorno").addEventListener("click", alternarContorno);
document.getElementById("bt-legenda").addEventListener("click", () => abrirPainel("legenda"));
document.getElementById("bt-marcadores").addEventListener("click", () => alternarMarcadores());
document.getElementById("bt-filtros").addEventListener("click", () => abrirPainel("filtros"));
document.getElementById("bt-universos").addEventListener("click", () => abrirPainel("universos"));
document.getElementById("bt-limpar").addEventListener("click", () => limparTudo());
document.getElementById("bt-exportar").addEventListener("click", () => abrirPainel("exportar"));
document.getElementById("bt-tempo").addEventListener("click", () => abrirPainel("tempo"));
document.getElementById("bt-info").addEventListener("click", () => alternarInfo());
document.getElementById("bt-giro").addEventListener("click", () => alternarGiro());
document.getElementById("bt-esqueleto").addEventListener("click", () => abrirPainel("esqueleto"));
document.getElementById("bt-voo").addEventListener("click", () => vooLivre.alternar());

// Atalhos: reconhece pelo caractere (e.key) E pela tecla física (e.code), para funcionar no
// teclado americano, no ABNT brasileiro e no teclado numérico.
const TECLAS = {
  voltar: { key: ["Home", "h", "H"], code: ["Home", "KeyH"] },
  aproximar: { key: ["+", "="], code: ["NumpadAdd", "Equal"] },
  afastar: { key: ["-", "_"], code: ["NumpadSubtract", "Minus"] },
  contorno: { key: ["c", "C"], code: ["KeyC"] },
  legenda: { key: ["l", "L"], code: ["KeyL"] },
  marcadores: { key: ["m", "M"], code: ["KeyM"] },
  filtros: { key: ["f", "F"], code: ["KeyF"] },
  universos: { key: ["u", "U"], code: ["KeyU"] },
  limpar: { key: ["x", "X"], code: ["KeyX"] },
  exportar: { key: ["e", "E"], code: ["KeyE"] },
  tempo: { key: ["t", "T"], code: ["KeyT"] },
  info: { key: ["i", "I"], code: ["KeyI"] },
  esqueleto: { key: ["v", "V"], code: ["KeyV"] },
  voo: { key: ["n", "N"], code: ["KeyN"] },
};
const bate = (e, nome) => TECLAS[nome].key.includes(e.key) || TECLAS[nome].code.includes(e.code);

window.addEventListener("keydown", (e) => {
  // F3.19: G liga/desliga o giro; teclas de navegação devolvem o controle
  if (["g", "G"].includes(e.key) || e.code === "KeyG") { if (!(e.target.closest && e.target.closest("input, textarea, select"))) alternarGiro(); return; }
  if (giroLigado && ["voltar", "aproximar", "afastar"].some((n) => bate(e, n))) alternarGiro(false);
  if (esqueleto.andando() && ["voltar", "aproximar", "afastar"].some((n) => bate(e, n))) esqueleto.parar();
  if (vooLivre.ativo() && ["voltar", "aproximar", "afastar"].some((n) => bate(e, n))) vooLivre.sair();
  if (e.target.closest && e.target.closest("input, textarea")) return;
  if (bate(e, "voltar")) voltarACaixa();
  else if (bate(e, "aproximar")) zoom(ZOOM_FATOR);
  else if (bate(e, "afastar")) zoom(1 / ZOOM_FATOR);
  else if (bate(e, "contorno")) alternarContorno();
  else if (bate(e, "legenda")) abrirPainel("legenda");
  else if (bate(e, "marcadores")) alternarMarcadores();
  else if (bate(e, "filtros")) abrirPainel("filtros");
  else if (bate(e, "universos")) abrirPainel("universos");
  else if (bate(e, "limpar")) limparTudo();
  else if (bate(e, "exportar")) abrirPainel("exportar");
  else if (bate(e, "tempo")) abrirPainel("tempo");
  else if (bate(e, "info")) alternarInfo();
  else if (bate(e, "esqueleto")) abrirPainel("esqueleto");
  else if (bate(e, "voo")) vooLivre.alternar();
});

// ---------------------------------------------------------------------------
// Laço de desenho
// ---------------------------------------------------------------------------
window.addEventListener("resize", () => {
  if (window.innerWidth === 0 || window.innerHeight === 0) return; // janela minimizada/oculta
  camera.aspect = aspectoJanela();
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  VISTA_INICIAL.posicao.set(0, 0, distanciaParaCaber(camera.aspect)); // "voltar" segue o formato da tela
});

/**
 * Avança a animação de câmera até o instante `agora` (ms). Separada do laço de desenho para
 * poder ser testada mesmo quando o navegador pausa o desenho (aba/painel escondido).
 */
function passoAnimacao(agora) {
  if (!animacao) return;
  const t = Math.min(1, (agora - animacao.inicio) / DURACAO_ANIMACAO_MS);
  const suave = t * t * (3 - 2 * t); // smoothstep: começa e termina devagar
  camera.position.lerpVectors(animacao.dePos, animacao.paraPos, suave);
  controls.target.lerpVectors(animacao.deAlvo, animacao.paraAlvo, suave);
  if (t >= 1) {
    animacao = null;
    zerarInercia(); // chega parado, sem deslizar depois
  }
}

// ---------------------------------------------------------------------------
// Aviso de limite de detalhe (F3.14-C). Separação média entre partículas da versão:
// s = L / N^(1/3) (1/64: 0,39 · 1/8: 0,20 · completa: 0,098 Mpc/h). Quando a altura do campo de
// visão na distância do alvo (2·d·tan(FOV/2)) cabe menos de PARTICULAS_NA_TELA separações, a
// pessoa está vendo as partículas uma a uma: aproximar mais não traz detalhe dos dados.
// CONVENÇÃO (o 3), documentada. 1ª ideia (grão do miolo dos halos) descartada antes de usar:
// só dispararia abaixo da distância mínima da câmera.
// ---------------------------------------------------------------------------
const MAIS_FINA = { teia_1_64_magma: "teia_1_8_magma", teia_1_64_magma_alongada: "teia_1_8_magma_alongada",
                    teia_1_8_magma: "teia_completa_magma", teia_1_8_magma_alongada: "teia_completa_magma_alongada" };
const PARTICULAS_NA_TELA = 3;
let baseArquivo = arquivo.replace(/\.(spz|ply)$/, "");
let metadados = null;
/** (Re)carrega o .json de metadados do arquivo aberto (de novo quando troca de universo, F3.11). */
function carregarMetadados() {
  baseArquivo = arquivo.replace(/\.(spz|ply)$/, "");
  metadados = null;
  return fetch(`../splats/dados/${baseArquivo}.json`).then((r) => (r.ok ? r.json() : null))
    .then((m) => { metadados = m; montarLegenda(); }).catch(() => { metadados = null; });
}
let metadadosProntos = Promise.resolve();
setTimeout(() => { metadadosProntos = carregarMetadados(); }, 0);  // depois de montarLegenda existir
const elLimite = Object.assign(document.createElement("div"), { id: "limite", hidden: true });
document.body.appendChild(elLimite);

/**
 * Massa em sóis por extenso, sem ambiguidade: "7,4 bilhões de sóis", "115 milhões de sóis".
 * (A 1ª versão escrevia "7.395 milhões" — o ponto de milhar do português fazia 7,4 bilhões
 * parecer 7 milhões: erro de mil vezes para quem lê.)
 */
function textoMassa(msun) {
  const fmt = (x) => x.toLocaleString("pt-BR", { maximumSignificantDigits: 3 });
  // singular abaixo de 2 ("1,88 trilhão"), como manda o português
  const por = (div, um, varios) => `${fmt(msun / div)} ${msun / div < 2 ? um : varios} de sóis`;
  if (msun >= 1e12) return por(1e12, "trilhão", "trilhões");
  if (msun >= 1e9) return por(1e9, "bilhão", "bilhões");
  if (msun >= 1e6) return por(1e6, "milhão", "milhões");
  return `${fmt(msun)} sóis`;
}

/** Separação média entre partículas desta versão [Mpc/h]. */
const separacaoMedia = () => LADO_CAIXA / Math.cbrt(metadados.n_splats);

/** true se cabem menos de PARTICULAS_NA_TELA separações médias na altura do campo de visão. */
function noLimiteDeDetalhe() {
  if (!metadados) return false;
  const d = camera.position.distanceTo(controls.target);
  const alturaVista = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return alturaVista / separacaoMedia() < PARTICULAS_NA_TELA;
}

// 21/10/2026 (pedido do Victor): o aviso tem um × — "é uma coisa que você lê uma vez só". Fechado, não volta
// mais neste navegador (guardado no armazenamento local; se o navegador bloquear, vale só até recarregar).
const CHAVE_AVISO_LIMITE = "dentro_da_teia_aviso_limite_fechado";
let avisoLimiteFechado = (() => { try { return localStorage.getItem(CHAVE_AVISO_LIMITE) === "1"; } catch (_) { return false; } })();
function fecharAvisoLimite(fechar = true) {
  avisoLimiteFechado = fechar;
  try { if (fechar) localStorage.setItem(CHAVE_AVISO_LIMITE, "1"); else localStorage.removeItem(CHAVE_AVISO_LIMITE); } catch (_) { /* sem armazenamento */ }
  elLimite.hidden = true;
}
function atualizarAvisoLimite() {
  const mostrar = noLimiteDeDetalhe() && !avisoLimiteFechado;
  if (mostrar === !elLimite.hidden) return;
  elLimite.hidden = !mostrar;
  if (mostrar) {
    const fina = MAIS_FINA[baseArquivo];
    elLimite.innerHTML = `<button class="fechar-aviso" aria-label="Fechar este aviso (não aparece mais)" title="Fechar (não aparece mais)">×</button>` +
      `<b>Limite de detalhe desta versão.</b> Aqui você já vê ${textoUnidade()} uma a uma ` +
      `(cada uma ≈ ${textoMassa(metadados.massa_por_splat_msun)}). As nuvens e os pontos brilhantes não são ` +
      `uma mancha só: são halos feitos de centenas a centenas de milhares delas — tamanhos na legenda (tecla L). ` +
      `Não há detalhe menor nestes dados — aproximar mais só aumenta as manchas.` +
      (fina ? ` Versão mais fina: <a href="?arquivo=${fina}.spz${fina.includes("completa") || fina.includes("1_8") ? "&lod=1" : ""}">${fina}</a>.`
            : " Esta já é a resolução completa da simulação.");
    elLimite.querySelector(".fechar-aviso").addEventListener("click", () => fecharAvisoLimite(true));
  }
}

/** "as partículas da simulação" (versão completa) ou "as manchas (cada uma junta N partículas)". */
function textoUnidade() {
  const n = Math.round(metadados.massa_por_splat_msun / MASSA_PARTICULA_MSUN);
  return n <= 1 ? "as partículas da simulação" : `as manchas (cada uma junta ${n} partículas da simulação)`;
}

// ---------------------------------------------------------------------------
// Legenda "o que é cada mancha" (pedido do Victor, 16/10/2026). Tecla L ou botão ℹ.
// Números SÓ do arquivo ../splats/dados/classes_halos.json (gerado por classes_halos.py a
// partir do catálogo oficial Rockstar). Fronteiras e nomes das classes = convenção da área,
// dito na própria legenda. A cor é densidade (paleta magma), não tamanho — também dito.
// ---------------------------------------------------------------------------
const MASSA_PARTICULA_MSUN = 7.75e7 / 0.6711;  // 7,75×10⁷ M☉/h ÷ h (teoria_lcdm.massa_particula)
const elLegenda = Object.assign(document.createElement("aside"), { id: "legenda", hidden: true });
elLegenda.setAttribute("aria-label", "Legenda: o que é cada mancha");
document.body.appendChild(elLegenda);
let classesHalos = null;
fetch("../splats/dados/classes_halos.json").then((r) => (r.ok ? r.json() : null))
  .then((c) => { classesHalos = c; montarLegenda(); }).catch(() => { classesHalos = null; montarLegenda(); });

/** Distância em anos-luz por extenso ("230 mil anos-luz", "1,3 milhão de anos-luz"). */
function textoAnosLuz(al) {
  const fmt = (x) => x.toLocaleString("pt-BR", { maximumSignificantDigits: 2 });
  if (al >= 1e6) return `${fmt(al / 1e6)} ${al < 2e6 ? "milhão" : "milhões"} de anos-luz`;
  return `${fmt(al / 1e3)} mil anos-luz`;
}

/** Monta o conteúdo da legenda (de novo quando os metadados ou as classes chegam). */
function montarLegenda() {
  const n = metadados ? Math.round(metadados.massa_por_splat_msun / MASSA_PARTICULA_MSUN) : 0;
  const unidade = metadados
    ? `<p><b>Menor mancha do desenho</b> = ${n <= 1 ? "1 partícula da simulação" : `${n} partículas juntas (versão reduzida)`}
       ≈ ${textoMassa(metadados.massa_por_splat_msun)}.</p>` : "";
  const linhas = classesHalos ? classesHalos.classes.map((c) => c.quantos === 0
    ? `<tr><td>${c.nome}</td><td colspan="4" class="vazio">nenhum nesta caixa (pequena demais para eles)</td></tr>`
    : `<tr><td>${c.nome}</td><td>${c.quantos.toLocaleString("pt-BR")}</td><td>${textoMassa(c.massa_mediana_msun)}</td>` +
      `<td>${c.particulas_mediana.toLocaleString("pt-BR")}</td><td>${textoAnosLuz(c.raio_mediano_anos_luz)}</td></tr>`).join("")
    : `<tr><td colspan="5">classes_halos.json não carregou</td></tr>`;
  elLegenda.innerHTML = `<h2>O que é cada mancha <button id="bt-fechar-legenda" aria-label="Fechar legenda">×</button></h2>
    ${unidade}
    <p><b>Cor = densidade, não tamanho.</b> Roxo escuro: pouca matéria; laranja/amarelo: muita.
       Um ponto laranja pequeno é um halo pequeno e denso; uma nuvem roxa grande é a periferia
       de um halo ou um filamento.</p>
    <p><b>Halos</b> (aglomerados de matéria escura) desta caixa, pelo catálogo oficial:</p>
    <table><thead><tr><th>Classe</th><th>Quantos</th><th>Massa típica</th><th>Partículas</th><th>Raio típico</th></tr></thead>
    <tbody>${linhas}</tbody></table>
    <p class="nota">Valores típicos = mediana de cada classe. Massa e raio virial (Bryan &amp; Norman 1998),
       catálogo Rockstar do CAMELS, z = 0. As fronteiras (10¹¹, 10¹², 10¹³, 10¹⁴ sóis) e os nomes são
       convenção da área, não física: não há fronteira exata entre as classes. Um halo tipo Via Láctea
       abrigaria uma galáxia como a nossa — mas esta simulação só tem matéria escura, sem estrelas.</p>`;
  document.getElementById("bt-fechar-legenda").addEventListener("click", () => alternarLegenda(false));
}

/** Mostra/esconde a legenda (sem argumento: alterna). */
function alternarLegenda(mostrar = elLegenda.hidden) {
  elLegenda.hidden = !mostrar;
  document.getElementById("bt-legenda").setAttribute("aria-pressed", String(mostrar));
}

// ---------------------------------------------------------------------------
// Medidor de quadros por segundo (F3.3). Liga com ?fps=1. Guarda o instante de cada quadro
// dos últimos segundos; mostra a mediana e o pior 5 % (os "engasgos").
// ---------------------------------------------------------------------------
const instantesQuadros = [];
const elFps = params.has("fps") ? Object.assign(document.createElement("div"), { id: "fps" }) : null;
if (elFps) {
  elFps.style.cssText = "position:absolute;top:16px;right:16px;background:rgba(12,10,20,.8);color:#fff;" +
    "border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:8px 12px;font:13px ui-monospace,monospace";
  document.body.appendChild(elFps);
}

/** Estatísticas de QPS dos últimos `janelaMs` milissegundos. */
function estatisticasFps(janelaMs = 3000) {
  const agora = performance.now();
  const q = instantesQuadros.filter((t) => agora - t <= janelaMs);
  if (q.length < 3) return { qps_mediano: 0, qps_pior5: 0, quadros: q.length };
  const intervalos = q.slice(1).map((t, i) => t - q[i]).sort((a, b) => a - b);
  const mediana = intervalos[Math.floor(intervalos.length / 2)];
  const p95 = intervalos[Math.min(intervalos.length - 1, Math.floor(intervalos.length * 0.95))];
  return { qps_mediano: 1000 / mediana, qps_pior5: 1000 / p95, quadros: q.length };
}

let ultimaAtualizacaoFps = 0;
function registrarQuadro(agora) {
  instantesQuadros.push(agora);
  while (instantesQuadros.length && agora - instantesQuadros[0] > 10000) instantesQuadros.shift();
  if (elFps && agora - ultimaAtualizacaoFps > 500) {
    ultimaAtualizacaoFps = agora;
    const e = estatisticasFps();
    elFps.textContent = `${e.qps_mediano.toFixed(0)} QPS (pior 5%: ${e.qps_pior5.toFixed(0)}) · ${arquivo}`;
  }
}

// ---------------------------------------------------------------------------
// Giro automático (F3.19, ideia do Victor 21/10: "aquele movimento dentro da caixa é muito legal").
// Tecla G ou botão ▶. A câmera gira em volta do foco, no eixo vertical, a 20°/s — a mesma velocidade do
// roteiro de medição (girando = fluido). Conta pelo tempo real entre quadros (não pelo número de quadros),
// então a velocidade não muda se a máquina desenhar mais devagar. Qualquer gesto do usuário (clicar,
// arrastar, roda do mouse, tecla de navegação) devolve o controle e para o giro.
// ---------------------------------------------------------------------------
const GIRO_GRAUS_POR_S = 9;    // 22/10: 1 volta a cada 40 s (pedido do Victor); antes 12 (30 s) e 20
let giroLigado = false, giroUltimo = null;
function alternarGiro(estado = !giroLigado) {
  giroLigado = estado;
  giroUltimo = null;
  const bt = document.getElementById("bt-giro");
  if (bt) { bt.setAttribute("aria-pressed", String(giroLigado)); bt.textContent = giroLigado ? "❚❚" : "▶"; }
  return giroLigado;
}
/** Avança o giro até o instante `agora` (ms). Separado do laço para os testes (aba escondida pausa o desenho). */
function passoGiro(agora) {
  if (!giroLigado || animacao) { giroUltimo = agora; return; }
  const dt = giroUltimo === null ? 0 : Math.min(0.1, (agora - giroUltimo) / 1000);  // ≤ 0,1 s: sem saltos
  giroUltimo = agora;
  if (dt <= 0) return;
  const rel = camera.position.clone().sub(controls.target);
  rel.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(GIRO_GRAUS_POR_S) * dt);
  camera.position.copy(controls.target).add(rel);
  camera.lookAt(controls.target);
  marcarMovimento();   // resolução de movimento, como no giro manual
}
for (const ev of ["pointerdown", "wheel"]) renderer.domElement.addEventListener(ev, () => { if (giroLigado) alternarGiro(false); });

renderer.setAnimationLoop(() => {
  registrarQuadro(performance.now());
  passoAnimacao(performance.now());
  passoGiro(performance.now());
  esqueleto.quadro(performance.now());
  vooLivre.quadro(performance.now());
  tempo.quadro(performance.now());
  if (animacao) marcarMovimento();
  marcadores.atualizar();
  atualizarRegua();
  atualizarAvisoLimite();
  if (nevoa) {
    nevoa.camadas.atualizar(camera, controls.target);
    // estimativa do erro das camadas: na 1ª vez e, depois, a cada 0,5 s enquanto a câmera se mexe
    const agora = performance.now();
    if (!nevoa.erro || (agora - ultimaEstimativa > 500 && agora - ultimoMovimento < 1500)) {
      ultimaEstimativa = agora; atualizarEstadoNevoa();
    }
  }
  if (RESOLUCAO === "auto" && performance.now() - ultimoMovimento > RESOLUCAO_PARADO_MS) definirEscala(1);
  controls.update();
  // Rede de segurança: se a câmera ficar inválida por qualquer motivo, volta à vista inicial
  if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z)) {
    camera.position.copy(VISTA_INICIAL.posicao);
    controls.target.copy(VISTA_INICIAL.alvo);
    controls.update();
  }
  if (nevoa) nevoa.camadas.renderizar(renderer, camera);
  renderer.render(scene, camera);
  if (pedidoImagem && --pedidoImagem.quadros <= 0) {   // F3.12: imagem para o PDF, logo depois de desenhar
    const r = pedidoImagem.resolver; pedidoImagem = null;
    r(renderer.domElement.toDataURL("image/png"));
  }
});

// ---------------------------------------------------------------------------
// Filtro "ir até um aglomerado" (F3.15) — lógica em marcadores.js. Tecla M ou botão ◎.
// ---------------------------------------------------------------------------
const marcadores = criarMarcadores({
  camera, controls, renderer, animarPara, distanciaMin: DISTANCIA_MIN, distanciaMax: DISTANCIA_MAX,
  ladoCaixa: LADO_CAIXA, textoMassa, textoAnosLuz, classes: () => classesHalos,
  get arquivo() { return arquivo; },
  // Universo 1: catálogo oficial (Rockstar); laboratório: halos pelo FoF (splats/halos_fof.py, 21/10)
  urlHalos: () => (universoAtual ? `universos/${universoAtual}_halos.json` : "halos_marcadores.json"),
  massaPorMancha: () => (metadados ? metadados.massa_por_splat_msun : null),
});

// Painel de filtros (F3.7 em diante) — lógica em filtros.js. Tecla F ou botão ⚗.
const filtros = criarFiltros({
  get disponivel() { return !!VERSAO_COR && !universoAtual; }, cor, trocarCor, ocupado: () => trocandoCor, versao: VERSAO_COR,
  lutDivergente: () => (dadosDisc ? dadosDisc.lut : null),
  get motivoIndisponivel() {
    return universoAtual ? "Os filtros de cor só existem no Universo 1 (principal). Volte a ele no painel Ω (tecla U)."
      : "Os filtros de cor existem para as versões 1/64 e 1/8 (e alongadas). Esta versão usa a cor padrão (estimador A, magma).";
  },
});

// ---------------------------------------------------------------------------
// Universos (F3.11) — painel em universos.js. Tecla U ou botão Ω. Troca SEM recarregar a página:
// descarta a teia e monta a do universo escolhido; a câmera fica onde está.
// ---------------------------------------------------------------------------
let trocandoUniverso = false;
const SUPERNOVA = `<div class="supernova" aria-hidden="true"><i></i><i></i><i></i><b></b></div>`;
async function trocarUniverso(sim) {
  if (trocandoUniverso || trocandoCor || sim === universoAtual) return false;
  trocandoUniverso = true;
  universoAtual = sim;
  arquivo = arquivoDoUniverso(sim);
  Object.assign(cor, { estimador: "A", paleta: "magma", camada: "densidade", resolucao: "completa" });
  await marcadores.alternar(false);
  const u = new URL(location.href);
  for (const k of ["arquivo", "estimador", "paleta", "camada", "par", "x", "y", "peso", "resolucao_cor"]) u.searchParams.delete(k);
  if (sim) u.searchParams.set("universo", sim); else u.searchParams.delete("universo");
  history.replaceState(null, "", u);
  const p = posicoesDe(sim);
  elCarregando.hidden = false; elCarregando.classList.remove("oculto");
  elCarregando.innerHTML = `${SUPERNOVA}<div>Carregando ${sim ? `o Universo 2 · receita Ωm ${String(OMEGAS[p.i]).replace(".", ",")} · σ8 ${String(SIGMAS[p.j]).replace(".", ",")}`
    : "o Universo 1 (principal)"}… (uns segundos)<br><small>a explosão é só ilustração enquanto carrega</small></div>`;
  universos.atualizar();
  await new Promise((r) => setTimeout(r, 50));
  const inicio = performance.now();
  try {
    await carregarMetadados();
    await marcadores.recarregar();
    descartarTeia();
    await carregarTeia();
    const segundos = ((performance.now() - inicio) / 1000).toFixed(1);
    window.teia.tempoTrocaUniversoS = Number(segundos);
    elEstado.textContent = textoEstado(segundos);
  } finally {
    elCarregando.classList.add("oculto");
    setTimeout(() => { elCarregando.hidden = true; elCarregando.textContent = ""; }, 500);
    trocandoUniverso = false;
    universos.atualizar(); filtros.atualizar(); atualizarBotaoMarcadores(); esqueleto.revisar();
  }
  return true;
}
const universos = criarUniversos({ atual: () => universoAtual, trocar: trocarUniverso, ocupado: () => trocandoUniverso });
setTimeout(atualizarBotaoMarcadores, 0);

// ---------------------------------------------------------------------------
// Aviso rápido na tela (21/10/2026). Motivo: nos universos 1P a tecla M não fazia nada, em silêncio — o
// Victor achou que estava quebrado. Toda função desligada tem que DIZER por quê.
// ---------------------------------------------------------------------------
const elAviso = Object.assign(document.createElement("div"), { id: "aviso-rapido", hidden: true });
elAviso.setAttribute("role", "status");
document.body.appendChild(elAviso);
let temporizadorAviso = null;
function avisar(texto, ms = 6000) {
  elAviso.innerHTML = texto; elAviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { elAviso.hidden = true; }, ms);
}
const MOTIVO_SEM_MARCADORES = "<b>Ir até um aglomerado</b>: o catálogo de halos deste universo não carregou " +
  "(arquivo ausente). Rode <code>splats/halos_fof.py</code> ou volte ao Universo 1 no painel Ω (tecla U).";
async function alternarMarcadores() {
  await marcadores.pronto;
  if (!marcadores.disponivel()) { avisar(MOTIVO_SEM_MARCADORES); return false; }
  return marcadores.alternar();
}
/** Botão ◎ com aparência e dica de "indisponível" nos universos. */
async function atualizarBotaoMarcadores() {
  const bt = document.getElementById("bt-marcadores");
  if (!bt) return;
  await marcadores.pronto;
  const ok = marcadores.disponivel();
  bt.classList.toggle("indisponivel", !ok);
  bt.title = ok ? "Ir até um aglomerado: marca os maiores halos (tecla M)"
                : "Indisponível: o catálogo de aglomerados deste universo não carregou";
}

// ---------------------------------------------------------------------------
// Ajustes de tela (21/10/2026, pedidos do Victor):
//  1. só UM painel lateral aberto por vez (Universos, Filtros, Legenda abriam um em cima do outro)
//  2. quadro de informação minimizado por padrão (título + "simulação, não foto"); clica para abrir
//  3. "Limpar tudo": volta ao padrão de uma vez
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Exportar (F3.12) — lógica em exportar.js. Botão ⤓ ou tecla E.
// ---------------------------------------------------------------------------
let pedidoImagem = null;
/** Imagem da tela em resolução TOTAL (espera 3 quadros desenhados nela). */
function capturarImagem() {
  definirEscala(1);
  return new Promise((resolver) => { pedidoImagem = { quadros: 3, resolver }; });
}
function estadoAtual() {
  const u = universoAtual && metadados && metadados.universo;
  const h = marcadores.haloEscolhido();
  return {
    dataHora: new Date().toLocaleString("pt-BR"), universo: universoAtual ? "2" : "1", sim: universoAtual,
    omegaM: u ? metadados.universo.omega_m : 0.3, sigma8: u ? metadados.universo.sigma8 : 0.8, arquivo,
    cor: { ...cor }, camera: camera.position.toArray(), alvo: controls.target.toArray(),
    aglomerados: marcadores.ligado(), halo: h,
    distancia: camera.position.distanceTo(controls.target),
    massaPorMancha: metadados ? metadados.massa_por_splat_msun : NaN,
    nevoa: nevoa ? `grade ${NEVOA_N}³ (célula ${(nevoa.grade.delta * 1000).toFixed(0)} kpc/h)` +
                   (nevoa.erro ? `, brilho longe do foco pode errar até ×${nevoa.erro.fatorMax.toFixed(2).replace(".", ",")}` : "") : null,
    lod: LOD ? `×${LOD_ESCALA}` : null,
  };
}
/** Fontes do que está na tela (para o PDF) — só artigos conferidos (lista com link em REFERENCIAS.xlsx). */
function fontesAtuais() {
  const f = [
    "Simulação: CAMELS, IllustrisTNG só matéria escura (Villaescusa-Navarro et al. 2021; liberação dos dados 2023), " +
    "rodada com GADGET (Springel 2005). Caixa de 25 Mpc/h, 256³ partículas, hoje (z = 0).",
    "Receita do nosso universo (Ωm, σ8): Planck 2018, artigo VI (Planck Collaboration 2020).",
    "Desenho: cada partícula vira uma mancha gaussiana 3D (Kerbl et al. 2023), tamanho pelo 32º vizinho.",
  ];
  if (!universoAtual) {
    const est = { A: "Casertano & Hut 1985", C: "kernel do GADGET-2, Springel 2005", B: "Springel 2005, eq. 5",
                  D: "Dehnen & Aly 2012" };
    if (cor.camada === "densidade") f.push(`Cor = densidade pela fórmula ${cor.estimador} (${est[cor.estimador]}).`);
    if (cor.camada === "discordancia") f.push(`Cor = razão entre as fórmulas ${cor.par.replace("/", " e ")} (paleta coolwarm, Moreland 2009).`);
    if (cor.camada === "lab") f.push("Cor = regra do usuário (laboratório): mistura de duas fórmulas publicadas — não publicada, não conferida.");
  } else {
    f.push("Universo 2: conjunto 1P do CAMELS (mesma semente, um parâmetro por vez). Tensão do S8: KiDS-1000 " +
           "(Heymans et al. 2021) e DES Y3 (Abbott et al. 2022).");
  }
  if (marcadores.ligado() || marcadores.haloEscolhido()) {
    f.push(universoAtual
      ? "Aglomerados: localizados por nós com friends-of-friends (método de Davis et al. 1985; b = 0,2 como no Millennium, " +
        "Springel et al. 2005), conferido contra o catálogo oficial do Universo 1."
      : "Aglomerados: catálogo oficial Rockstar do CAMELS (Behroozi, Wechsler & Wu 2013); massa virial de Bryan & Norman 1998.");
  }
  if (esqueleto.mostrando() || esqueleto.andando()) {
    f.push("Esqueleto: árvore geradora mínima dos halos e sub-halos do Rockstar (Barrow, Bhavsar & Sonoda 1985; " +
           "sub-halos como em Colberg 2007), corte pelo critério de Alpaslan et al. 2014; trilho do passeio = espinha da árvore inteira.");
  }
  if (nevoa) f.push("Névoa: a mesma regra de opacidade das manchas, contínua numa grade 3D (método deste projeto, conferido).");
  f.push("Todos os números foram conferidos por 150+ testes automáticos contra fontes externas (calculos/verificar_tudo.py).");
  return f;
}
/** Aplica uma configuração lida do CSV: universo, cor, câmera e aglomerados. */
async function aplicarConfiguracao(conf) {
  if (conf.universo === "2" && conf.sim) { if (conf.sim !== universoAtual) await trocarUniverso(conf.sim); }
  else if (universoAtual) await trocarUniverso(null);
  if (!universoAtual) await trocarCor(conf.cor);
  if (conf.camera && conf.alvo) {
    passoAnimacao(Infinity); alternarGiro(false);
    controls.target.fromArray(conf.alvo); camera.position.fromArray(conf.camera); controls.update();
  }
  if (conf.aglomerados !== marcadores.ligado()) await alternarMarcadores();
}
const exportar = criarExportar({ estado: estadoAtual, aplicar: aplicarConfiguracao, capturarImagem, fontes: fontesAtuais });

// ---------------------------------------------------------------------------
// Tempo (F4) — lógica em tempo.js. Botão ⏱ ou tecla T. Enquanto o painel está aberto, a teia normal (e a névoa)
// fica escondida e a animação dos 12 momentos aparece no lugar; fechar devolve tudo.
// ---------------------------------------------------------------------------
const tempo = criarTempo({
  scene, textoMassa,
  entrar: () => {
    if (malhaAtual) malhaAtual.visible = false;
    if (nevoa) nevoa.camadas.configurar({ visivel: false });
    marcadores.alternar(false);
    esqueleto.revisar();
  },
  sair: () => {
    if (malhaAtual) malhaAtual.visible = true;
    if (nevoa) nevoa.camadas.configurar({ visivel: true });
    esqueleto.revisar();
  },
});

// ---------------------------------------------------------------------------
// Esqueleto da teia e passeio "montanha-russa" (F3.20) — lógica em esqueleto.js. Botão 〰 ou tecla V. Só no Universo 1
// e fora do tempo (motivo dito no painel). Durante o passeio, arrastar vira a cabeça (não para); H, +, − e Esc param.
// ---------------------------------------------------------------------------
const esqueleto = criarEsqueleto({
  scene, camera, controls, renderer, animarPara, animando: () => !!animacao, marcadores, textoMassa, textoAnosLuz,
  avisar: (txt, ms) => avisar(txt, ms), ladoCaixa: LADO_CAIXA,
  anosLuzPorMpcH: 3.261563777e6 / 0.6711, aoMexer: () => marcarMovimento(), pararGiro: () => { alternarGiro(false); vooLivre.sair(); },
  motivoIndisponivel: () => (universoAtual
    ? "Só no Universo 1: os aglomerados dos universos do laboratório foram achados por nós (friends-of-friends) e não " +
      "têm sub-halos — sem eles o método deixaria os maiores de fora. Volte ao Universo 1 no painel Ω (tecla U)."
    : tempo.ativo() ? "O esqueleto é de hoje: feche o painel do tempo (tecla T) para usar." : null),
});

// ---------------------------------------------------------------------------
// Voo livre, o "nado" (F3.2) — lógica em voo_livre.js. Botão ✈ ou tecla N. W A S D / setas, Espaço/Shift, arrastar
// para olhar, roda para a velocidade. Entrar para giro, passeio e animações; H, +, − e Esc saem.
// ---------------------------------------------------------------------------
const vooLivre = criarVooLivre({
  camera, controls, renderer, ladoCaixa: LADO_CAIXA, avisar: (txt, ms) => avisar(txt, ms), textoAnosLuz,
  anosLuzPorMpcH: 3.261563777e6 / 0.6711, aoMexer: () => marcarMovimento(),
  aoEntrar: () => { alternarGiro(false); esqueleto.parar(""); passoAnimacao(Infinity); },
});

const PAINEIS = {
  tempo: { aberto: () => !tempo.painel.hidden, alternar: (m) => tempo.alternar(m) },
  exportar: { aberto: () => !exportar.painel.hidden, alternar: (m) => exportar.alternar(m) },
  legenda: { aberto: () => !elLegenda.hidden, alternar: (m) => alternarLegenda(m) },
  filtros: { aberto: () => !filtros.painel.hidden, alternar: (m) => filtros.alternar(m) },
  universos: { aberto: () => !universos.painel.hidden, alternar: (m) => universos.alternar(m) },
  esqueleto: { aberto: () => !esqueleto.painel.hidden, alternar: (m) => esqueleto.alternar(m) },
};
/** Abre (ou fecha, se já aberto) o painel `nome`; ao abrir, fecha os outros para não se sobreporem. */
function abrirPainel(nome) {
  const vaiAbrir = !PAINEIS[nome].aberto();
  if (vaiAbrir) for (const [k, p] of Object.entries(PAINEIS)) if (k !== nome && p.aberto()) p.alternar(false);
  PAINEIS[nome].alternar(vaiAbrir);
  return vaiAbrir;
}
function alternarInfo(abrir) {
  const info = document.getElementById("info");
  const vaiAbrir = abrir ?? info.classList.contains("recolhido");
  info.classList.toggle("recolhido", !vaiAbrir);
  document.getElementById("bt-info").setAttribute("aria-expanded", String(vaiAbrir));
  return vaiAbrir;
}
/** Volta tudo ao padrão: Universo 1, cor padrão, aglomerados/giro/painéis desligados, caixa inteira. */
async function limparTudo() {
  if (trocandoCor || trocandoUniverso) return false;
  alternarGiro(false); vooLivre.sair();
  esqueleto.parar(""); esqueleto.mostrarEsqueleto(false);
  await marcadores.alternar(false);
  for (const p of Object.values(PAINEIS)) if (p.aberto()) p.alternar(false);
  alternarInfo(false);
  if (!contorno.visible) alternarContorno();
  if (universoAtual) await trocarUniverso(null);   // já volta a cor ao padrão
  else if (!corPadrao()) {
    await trocarCor({ estimador: "A", paleta: "magma", camada: "densidade", resolucao: "completa", par: "B/A",
                      labX: "A", labY: "B", labPeso: 50 });
  }
  voltarACaixa();
  avisar("Tudo limpo: Universo 1, cor padrão, câmera na caixa inteira.", 3000);
  return true;
}

// ---------------------------------------------------------------------------
// Régua de escala (F3.4, 22/10/2026). Canto inferior esquerdo; escolhe um comprimento "redondo" (1, 2 ou 5 × 10^k
// anos-luz) que dê entre ~60 e ~200 px na altura do PONTO DE FOCO (perspectiva: mais perto da câmera parece maior —
// dito na régua). Conversão: 1 Mpc/h = (1/h) Mpc = 4,8600 milhões de anos-luz (h = 0,6711; 1 Mpc = 3,26156 Mal).
// Coordenadas comóveis: a régua mede o tamanho de HOJE; no modo tempo também diz quanto media naquele momento (× a).
// ---------------------------------------------------------------------------
const ANOS_LUZ_POR_MPC_H = 3.261563777e6 / 0.6711;
const elRegua = Object.assign(document.createElement("div"), { id: "regua" });
elRegua.innerHTML = `<div class="barra"></div><div class="rotulo"></div>`;
document.body.appendChild(elRegua);
function textoAnosLuzRegua(al) {
  const fmt = (x) => x.toLocaleString("pt-BR", { maximumSignificantDigits: 3 });
  if (al >= 1e9) return `${fmt(al / 1e9)} ${al < 2e9 ? "bilhão" : "bilhões"} de anos-luz`;
  if (al >= 1e6) return `${fmt(al / 1e6)} ${al < 2e6 ? "milhão" : "milhões"} de anos-luz`;
  if (al >= 1e3) return `${fmt(al / 1e3)} mil anos-luz`;
  return `${fmt(al)} anos-luz`;
}
/** Comprimento e largura da régua para a vista atual: { anosLuz, px, pxPorMpcH }. `altura` (px) só para testes
 *  (com a aba escondida a tela mede 0). */
function calcularRegua(altura = renderer.domElement.getBoundingClientRect().height || window.innerHeight) {
  const d = Math.max(1e-6, camera.position.distanceTo(controls.target));
  const pxPorMpcH = (altura / 2) / (d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const alvoAnosLuz = 120 / pxPorMpcH * ANOS_LUZ_POR_MPC_H;
  const pot = 10 ** Math.floor(Math.log10(alvoAnosLuz));
  const anosLuz = [1, 2, 5, 10].map((m) => m * pot).reduce((a, b) => (Math.abs(Math.log(b / alvoAnosLuz)) < Math.abs(Math.log(a / alvoAnosLuz)) ? b : a));
  return { anosLuz, px: anosLuz / ANOS_LUZ_POR_MPC_H * pxPorMpcH, pxPorMpcH };
}
let reguaUltima = "";
function atualizarRegua() {
  const r = calcularRegua();
  let rotulo = `${textoAnosLuzRegua(r.anosLuz)} <small>no plano do foco</small>`;
  if (tempo.ativo()) {
    const M = tempo.meta().momentos, t = tempo.tAtual();
    let k = 0;
    while (k < M.length - 2 && t > M[k + 1].t_gyr) k++;
    const s = (t - M[k].t_gyr) / (M[k + 1].t_gyr - M[k].t_gyr), a = M[k].a + s * (M[k + 1].a - M[k].a);
    rotulo += `<br><small>medida de hoje · naquele momento: ${textoAnosLuzRegua(r.anosLuz * a)}</small>`;
  }
  const dica = document.getElementById("dica");   // fica logo acima da dica (que quebra em 2 linhas em tela estreita)
  const base = dica && dica.offsetHeight ? 16 + dica.offsetHeight + 8 : 16;
  const chave = `${r.px.toFixed(1)}|${base}|${rotulo}`;
  if (chave === reguaUltima) return;
  reguaUltima = chave;
  elRegua.style.bottom = `${base}px`;
  elRegua.firstElementChild.style.width = `${r.px}px`;
  elRegua.lastElementChild.innerHTML = rotulo;
}

// Estado exposto para testes e depuração
window.teia = {
  pronta: false, renderer, scene, camera, controls, contorno, voltarACaixa, zoom, alternarContorno,
  distanciaParaCaber, passoAnimacao, estatisticasFps, ajustes: AJUSTES,
  resolucao: () => ({ modo: RESOLUCAO, escala_atual: escalaAtual }),
  lod: LOD ? { escala: LOD_ESCALA } : null, ext: EXT, nevoa: () => nevoa, marcadores,
  filtros, cor, trocarCor, conferenciaOrdem: () => conferenciaOrdem, versaoCor: VERSAO_COR,
  universos, trocarUniverso, universoAtual: () => universoAtual, alternarMarcadores, avisar,
  abrirPainel, alternarInfo, limparTudo, paineisAbertos: () => Object.keys(PAINEIS).filter((k) => PAINEIS[k].aberto()),
  estadoAtual, aplicarConfiguracao, fontesAtuais, capturarImagem, tempo, calcularRegua, ANOS_LUZ_POR_MPC_H,
  alternarGiro, passoGiro, giroLigado: () => giroLigado, GIRO_GRAUS_POR_S, esqueleto, vooLivre,
  noLimiteDeDetalhe, atualizarAvisoLimite, metadados: () => metadados, separacaoMedia, textoMassa,
  fecharAvisoLimite, avisoLimiteFechado: () => avisoLimiteFechado,
  alternarLegenda, montarLegenda, classesHalos: () => classesHalos, textoAnosLuz,
  constantes: { LADO_CAIXA, FOV_VERTICAL, MARGEM, VISTA_INICIAL, ZOOM_FATOR, DISTANCIA_MIN, DISTANCIA_MAX,
                DURACAO_ANIMACAO_MS },
};
