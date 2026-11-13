/**
 * Dentro da Teia — a teia se formando no tempo (F4, 21/10/2026). Botão ⏱ ou tecla T.
 *
 * Dados: ../splats/dados/tempo/tempo_1_64.bin + .json (splats/tempo_f4.py): as MESMAS 262.144 partículas da versão
 * 1/64 em 12 momentos gravados pela simulação (z = 6 → hoje), com posição, ritmo da posição (dx/dt), tamanho e cor.
 *
 * ENTRE dois momentos gravados a posição é ESTIMADA (dito na tela) por Hermite cúbico no tempo cósmico, com a
 * posição e o dx/dt reais das duas pontas (caixa periódica desembrulhada). Tamanho: interpolação em log σ; cor:
 * interpolação do índice da paleta. Opacidade pela mesma regra das manchas (exposição · massa projetada / ρ̄m).
 * Coordenadas comóveis: a caixa acompanha a expansão (fica do mesmo tamanho); o painel diz o tamanho real.
 * Desenho: manchas no formato compacto do Spark (posição em meia precisão: degrau de até ~8 kpc/h, bem menor que
 * as manchas da 1/64, σ ~ 100 kpc/h), sem nível de detalhe e sem névoa (seriam recalculados a cada quadro).
 */
import * as THREE from "three";
import { SplatMesh, setPackedSplat } from "@sparkjsdev/spark";

const EXPOSICAO = 0.1;
const RHO_M = 83260993401.35243;     // Ωm·ρcrit da referência (exportar_ply.RHO_M), M☉/h por (Mpc/h)³
// play: do primeiro momento até hoje em 40 s, UNIFORME no tempo cósmico (22/10, pedido do Victor: "o começo
// pareceu mais rápido que o meio"). Causa provável: o avanço por quadro era limitado a 0,1 s; quando um quadro
// demorava mais (recalcular 262 mil posições), o play perdia tempo e ficava mais lento no meio. Agora o limite é
// 0,5 s (só contra saltos de aba escondida) e o tempo cósmico anda proporcional ao relógio.
const DURACAO_S = 40;
const PASSO_MAX_S = 0.5;

export function criarTempo(c) {
  // c = { scene, entrar: () => void (esconde a teia normal), sair: () => void (devolve), textoMassa }
  const painel = Object.assign(document.createElement("aside"), { id: "tempo", hidden: true });
  painel.setAttribute("aria-label", "Tempo");
  document.body.appendChild(painel);
  let meta = null, bruto = null, lut = null, malha = null, ativo = false, tocando = false, tAtual = 0, ultimo = null;
  let carregando = null;

  const ler = (k) => {   // vistas tipadas do momento k
    const n = meta.n, base = k * meta.bytes_por_momento;
    return { pos: new Uint16Array(bruto, base, 3 * n), v: new Int16Array(bruto, base + 6 * n, 3 * n),
             ls: new Uint8Array(bruto, base + 12 * n, n), cor: new Uint8Array(bruto, base + 13 * n, n) };
  };

  async function carregar() {
    if (meta) return true;
    if (!carregando) carregando = (async () => {
      const [m, b, p] = await Promise.all([
        fetch("../splats/dados/tempo/tempo_1_64.json").then((r) => (r.ok ? r.json() : null)),
        fetch("../splats/dados/tempo/tempo_1_64.bin").then((r) => (r.ok ? r.arrayBuffer() : null)),
        fetch("../splats/dados/paletas_lut.json").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (!m || !b || !p) return false;
      meta = m; bruto = b; lut = Float32Array.from(p.lut.c_magma.flat());
      return true;
    })();
    return carregando;
  }

  /** Escreve na malha as 262 mil manchas no tempo t (bilhões de anos). */
  function desenhar(t) {
    const M = meta.momentos, L = meta.lado_mpc_h, n = meta.n;
    t = Math.min(Math.max(t, M[0].t_gyr), M[M.length - 1].t_gyr);
    let k = 0;
    while (k < M.length - 2 && t > M[k + 1].t_gyr) k++;
    const A = ler(k), B = ler(k + 1);
    const dt = M[k + 1].t_gyr - M[k].t_gyr, s = (t - M[k].t_gyr) / dt;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
    const ep = meta.escala_pos, ev = meta.escala_dxdt_mpc_h_por_gyr, m = meta.massa_por_splat_msun_h;
    const arr = malha.packedSplats.packedArray;
    const xyz = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      for (let e = 0; e < 3; e++) {
        const j = 3 * i + e;
        const x0 = A.pos[j] * ep - L / 2;
        let d = B.pos[j] * ep - L / 2 - x0;
        d -= L * Math.round(d / L);                       // caixa periódica: o caminho mais curto
        let x = h00 * x0 + h10 * dt * A.v[j] * ev + h01 * (x0 + d) + h11 * dt * B.v[j] * ev;
        x -= L * Math.floor((x + L / 2) / L);             // volta para dentro da caixa
        xyz[e] = x;
      }
      const sigma = Math.exp(((1 - s) * A.ls[i] + s * B.ls[i]) / 16 - 10);
      const ic = 3 * Math.min(255, Math.round((1 - s) * A.cor[i] + s * B.cor[i]));
      const tau = EXPOSICAO * m / (2 * Math.PI * sigma * sigma * RHO_M);
      const alfa = Math.min(0.99, Math.max(0.01, 1 - Math.exp(-tau)));
      setPackedSplat(arr, i, xyz[0], xyz[1], xyz[2], sigma, sigma, sigma, 0, 0, 0, 1, alfa, lut[ic], lut[ic + 1], lut[ic + 2]);
    }
    malha.packedSplats.needsUpdate = true;
    malha.needsUpdate = true;
    tAtual = t;
    return { k, s };
  }

  function textoMomento(t) {
    const M = meta.momentos;
    let k = 0;
    while (k < M.length - 2 && t > M[k + 1].t_gyr) k++;
    const gravado = M.find((x) => Math.abs(x.t_gyr - t) < 0.02);
    // a(t): interpolação em t entre os momentos (só para o texto); z = 1/a − 1
    const s = (t - M[k].t_gyr) / (M[k + 1].t_gyr - M[k].t_gyr);
    const a = gravado ? gravado.a : M[k].a + s * (M[k + 1].a - M[k].a);
    const fmt = (x, d = 1) => x.toFixed(d).replace(".", ",");
    return `<b>Universo com ${fmt(t, 2)} bilhões de anos</b> · z = ${fmt(1 / a - 1, 2)}<br>` +
      `Tamanho real: <b>${fmt(100 * a, 0)} %</b> do de hoje (a caixa acompanha a expansão, por isso não cresce na tela)<br>` +
      (gravado ? `<span class="selo-ok">momento GRAVADO pela simulação</span>`
               : `<span class="selo-fisica">entre momentos gravados: posição ESTIMADA pela velocidade real</span>`);
  }

  async function entrar() {
    if (ativo) return true;
    const ok = await carregar();
    if (!ok) { montar("Os dados do tempo ainda não existem (rode splats/tempo_f4.py)."); return false; }
    c.entrar();
    if (!malha) {
      malha = new SplatMesh({ maxSplats: meta.n, constructSplats: (splats) => {
        const zero = new THREE.Vector3(), um = new THREE.Vector3(0.1, 0.1, 0.1), q = new THREE.Quaternion(), cor = new THREE.Color();
        for (let i = 0; i < meta.n; i++) splats.pushSplat(zero, um, q, 0.5, cor);
      } });
      await malha.initialized;
    }
    c.scene.add(malha);
    ativo = true;
    desenhar(tAtual || meta.momentos[0].t_gyr);
    montar();
    return true;
  }
  function sair() {
    if (!ativo) return;
    tocando = false; ativo = false;
    if (malha) c.scene.remove(malha);
    c.sair();
  }

  /** Chamar a cada quadro: avança o play. */
  function quadro(agoraMs) {
    if (!ativo || !tocando) { ultimo = agoraMs; return; }
    const M = meta.momentos, total = M[M.length - 1].t_gyr - M[0].t_gyr;
    const dtReal = ultimo === null ? 0 : Math.min(PASSO_MAX_S, (agoraMs - ultimo) / 1000);
    ultimo = agoraMs;
    let t = tAtual + dtReal * total / DURACAO_S;
    if (t >= M[M.length - 1].t_gyr) { t = M[M.length - 1].t_gyr; tocando = false; }
    desenhar(t);
    atualizarControles();
  }

  function atualizarControles() {
    const r = painel.querySelector("input[name=t]"), txt = painel.querySelector(".momento"), bt = painel.querySelector("#bt-play");
    if (r) r.value = String(tAtual);
    if (txt) txt.innerHTML = textoMomento(tAtual);
    if (bt) bt.textContent = tocando ? "❚❚ pausar" : "▶ tocar";
  }

  function montar(msg = "") {
    const M = meta ? meta.momentos : null;
    painel.innerHTML = `<h2>Tempo <button id="bt-fechar-tempo" aria-label="Fechar">×</button></h2>
      <p class="nota">Veja a teia se formar: a matéria escura escorre dos vazios para paredes, filamentos e aglomerados.
      São as mesmas 262 mil partículas em 12 momentos gravados pela simulação (Universo 1).</p>
      ${M ? `<div class="linha-tempo">
          <button class="botao-texto" id="bt-play">${tocando ? "❚❚ pausar" : "▶ tocar"}</button>
          <input type="range" name="t" min="${M[0].t_gyr}" max="${M[M.length - 1].t_gyr}" step="0.005" value="${tAtual || M[0].t_gyr}"
            aria-label="Tempo cósmico">
        </div>
        <div class="marcas"><span>~1 bilhão de anos</span><span>hoje (${M[M.length - 1].t_gyr.toFixed(1).replace(".", ",")} bi)</span></div>
        <div class="momentos">${M.map((x) => `<span style="left:${(100 * (x.t_gyr - M[0].t_gyr) / (M[M.length - 1].t_gyr - M[0].t_gyr)).toFixed(1)}%"
          title="momento gravado: z = ${x.z.toFixed(2)}"></span>`).join("")}</div>
        <p class="momento">${textoMomento(tAtual || M[0].t_gyr)}</p>
        <p class="nota">Entre dois momentos gravados (tracinhos acima) a posição é estimada com a posição e a velocidade
        reais das duas pontas. Nesta vista: versão 1/64, sem névoa e sem marcadores (eles são do momento de hoje).
        Fechar este painel volta à teia normal.</p>` : `<p class="nota">Carregando os momentos…</p>`}
      ${msg ? `<p class="aviso-filtro">${msg}</p>` : ""}`;
    painel.querySelector("#bt-fechar-tempo").addEventListener("click", () => alternar(false));
    const bt = painel.querySelector("#bt-play"), r = painel.querySelector("input[name=t]");
    if (bt) bt.addEventListener("click", () => {
      if (!tocando && tAtual >= M[M.length - 1].t_gyr - 1e-6) tAtual = M[0].t_gyr;   // no fim: recomeça
      tocando = !tocando; ultimo = null; atualizarControles();
    });
    if (r) r.addEventListener("input", () => { tocando = false; desenhar(Number(r.value)); atualizarControles(); });
  }

  async function alternar(mostrar = painel.hidden) {
    painel.hidden = !mostrar;
    const btn = document.getElementById("bt-tempo");
    if (btn) btn.setAttribute("aria-pressed", String(mostrar));
    if (mostrar) { montar(); await entrar(); montar(); } else sair();
    return mostrar;
  }
  return { alternar, quadro, painel, desenhar, ativo: () => ativo, meta: () => meta, tAtual: () => tAtual,
           malha: () => malha, carregar };
}
