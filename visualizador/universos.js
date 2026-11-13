/**
 * Dentro da Teia — "filtros de universo" (F3.11, 21/10/2026). Botão Ω ou tecla U.
 *
 * Cada posição é uma SIMULAÇÃO REAL do CAMELS, conjunto 1P (splats/universos_1p.py): mesma semente
 * (67), um parâmetro por vez — Ωm de 0,1 a 0,5 ou σ8 de 0,6 a 1,0. Nada interpolado. Por isso os dois
 * controles não se combinam: mexer num volta o outro para a referência (Ωm 0,3, σ8 0,8).
 *
 * Rótulos "possível pela física" × "compatível com o nosso universo" — medidas conferidas nos PDFs
 * (lista com link em REFERENCIAS.xlsx):
 *   Planck 2018 VI (resumo): Ωm = 0,315 ± 0,007; σ8 = 0,811 ± 0,006  → S8 ≈ 0,83
 *   KiDS-1000, Heymans et al. 2021 (resumo): S8 = 0,766 (+0,020 / −0,014)
 *   DES Y3, Abbott et al. 2022 (p. 3): S8 = 0,776 ± 0,017
 *   S8 = σ8 · √(Ωm / 0,3) (definição usada pelos três)
 * Regra (CONVENÇÃO, dita no painel): "compatível" = Ωm e σ8 a menos de 3 desvios do Planck 2018. Só a
 * referência passa (Ωm a 2,1 e σ8 a 1,8 desvios). A tensão do S8 é mostrada à parte, na barra.
 */
const PLANCK = { om: [0.315, 0.007], s8: [0.811, 0.006], S8: 0.832 };
const LENTES = [{ nome: "KiDS-1000", S8: 0.766 }, { nome: "DES Y3", S8: 0.776 }];
export const OMEGAS = [0.1, 0.2, 0.3, 0.4, 0.5];
export const SIGMAS = [0.6, 0.7, 0.8, 0.9, 1.0];
const ROTULO_PASSO = ["n2", "n1", "0", "1", "2"];

/** Nome da simulação 1P para as posições (i de Ωm, j de σ8); só um dos dois pode sair do centro. */
export function simDe(i, j) {
  if (i !== 2) return `1P_p1_${ROTULO_PASSO[i]}`;
  if (j !== 2) return `1P_p2_${ROTULO_PASSO[j]}`;
  return "1P_p1_0";
}
export function posicoesDe(sim) {
  const m = /^1P_p([12])_(n?\d)$/.exec(sim ?? "");
  if (!m) return null;
  const k = ROTULO_PASSO.indexOf(m[2]);
  return m[1] === "1" ? { i: k, j: 2 } : { i: 2, j: k };
}
export const S8de = (om, s8) => s8 * Math.sqrt(om / 0.3);

/** c = { atual: () => sim | null (null = CV_0 padrão), trocar: async (sim | null) => bool, ocupado: () => bool } */
export function criarUniversos(c) {
  const painel = Object.assign(document.createElement("aside"), { id: "universos", hidden: true });
  painel.setAttribute("aria-label", "Universos");
  document.body.appendChild(painel);
  const existe = {};   // sim → true/false (há arquivos processados?)
  let resumo = null;   // números de cada universo (splats/resumo_universos.py)
  fetch("../splats/dados/universos/resumo.json").then((r) => (r.ok ? r.json() : null)).then((j) => { resumo = j; if (!painel.hidden) montar(); }).catch(() => {});
  const pct = (x) => `${(100 * x).toFixed(0)} %`;
  const conferir = Promise.all([...OMEGAS.map((_, i) => simDe(i, 2)), ...SIGMAS.map((_, j) => simDe(2, j))]
    .map((s) => fetch(`../splats/dados/universos/${s}_1_8.json`, { method: "HEAD" })
      .then((r) => { existe[s] = r.ok; }).catch(() => { existe[s] = false; })));

  function montar() {
    const sim = c.atual();
    const p = posicoesDe(sim) ?? { i: 2, j: 2 };
    const om = OMEGAS[p.i], s8 = SIGMAS[p.j], S8 = S8de(om, s8);
    const desvios = Math.max(Math.abs(om - PLANCK.om[0]) / PLANCK.om[1], Math.abs(s8 - PLANCK.s8[0]) / PLANCK.s8[1]);
    const compativel = desvios < 3;
    const trava = c.ocupado() ? "disabled" : "";
    const faltam = Object.entries(existe).filter(([, v]) => v === false).map(([k]) => k);
    const x = (v) => `${(100 * (v - 0.4) / 0.7).toFixed(1)}%`;   // barra de S8 de 0,4 a 1,1
    const receita = `Ωm ${om.toFixed(1).replace(".", ",")} · σ8 ${s8.toFixed(1).replace(".", ",")}`;
    // 21/10 (pedido do Victor): nada de siglas na tela ("1P_p1_0", "CV_0") — Universo 1 e Universo 2, com botões
    painel.innerHTML = `<h2>Universos <button id="bt-fechar-universos" aria-label="Fechar">×</button></h2>
      <div class="escolha-universo">
        <button data-u="1" class="${sim ? "" : "ativo"}" ${trava}><b>Universo 1</b><small>principal — a teia de sempre</small></button>
        <button data-u="2" class="${sim ? "ativo" : ""}" ${trava}><b>Universo 2</b><small>laboratório de receitas</small></button>
      </div>
      ${!sim ? `<p>O <b>Universo 1</b> é a simulação principal, com a receita do nosso universo (Ωm 0,3 · σ8 0,8). Tem o
        catálogo oficial de aglomerados (tecla M) e todos os filtros de cor (tecla F).</p>
        <p class="nota">Abra o <b>Universo 2</b> para mexer na receita do universo: quanto de matéria existe e quão
        aglomerada ela é. Ele nasceu de outra "semente", então a teia fica em outro lugar.</p>`
      : `<p>O <b>Universo 2</b> é um laboratório: o MESMO universo em 9 receitas, cada uma uma simulação real e completa
        (nada inventado). Todas nascem da mesma semente — as estruturas ficam nos mesmos lugares, só ficam mais ou
        menos aglomeradas. Mude uma coisa de cada vez:</p>
      <p class="nota"><b>Ωm</b> = QUANTIDADE de matéria (mais = teia mais cheia e mais brilhante) · <b>σ8</b> = AGLOMERAÇÃO
        (mais = grumos mais fortes e vazios mais vazios; menos = teia mais lisa). Compare os extremos olhando sempre o
        mesmo pedaço da teia.</p>
      <label class="controle">Quantidade de matéria (Ωm): <b>${om.toFixed(1).replace(".", ",")}</b>
        <input type="range" name="om" min="0" max="4" step="1" value="${p.i}" ${trava}></label>
      <div class="marcas"><span>0,1</span><span>0,2</span><span>0,3</span><span>0,4</span><span>0,5</span></div>
      <label class="controle">Aglomeração (σ8): <b>${s8.toFixed(1).replace(".", ",")}</b>
        <input type="range" name="s8" min="0" max="4" step="1" value="${p.j}" ${trava}></label>
      <div class="marcas"><span>0,6</span><span>0,7</span><span>0,8</span><span>0,9</span><span>1,0</span></div>
      ${resumo && resumo.universos[sim] ? (() => {
        const u = resumo.universos[sim], r = resumo.universos["1P_p1_0"];
        const linha = (rotulo, a, b, explica) => `<tr><td>${rotulo}<br><small>${explica}</small></td><td><b>${a}</b></td><td>${b}</td></tr>`;
        return `<div class="ficha"><p><b>O que mudou nesta receita</b> (números da própria simulação):</p>
          <table class="numeros"><tr><th></th><th>esta</th><th>receita do nosso universo</th></tr>
          ${linha("Quantidade de matéria", `×${u.massa_relativa.toFixed(2).replace(".", ",")}`, "×1,00", "massa total da caixa (Ωm ÷ 0,3)")}
          ${linha("Matéria em aglomerados", pct(u.frac_massa_densa), pct(r.frac_massa_densa), "onde a densidade passa de 200× a média")}
          ${linha("Volume dos vazios", pct(u.frac_volume_vazio), pct(r.frac_volume_vazio), "onde a densidade fica abaixo de 0,2× a média")}
          </table>
          <p class="nota">Aproximação por partícula na versão 1/8. 200× a média é o limiar usual da área para "dentro de um halo".</p></div>`;
      })() : ""}
      <div class="ficha">
        <p><b>Receita: ${receita}</b> · S8 = σ8·√(Ωm/0,3) = <b>${S8.toFixed(3).replace(".", ",")}</b></p>
        <p class="${compativel ? "selo-ok" : "selo-fisica"}">${compativel
          ? "É A RECEITA DO NOSSO UNIVERSO — Ωm e σ8 a menos de 3 desvios das medições do Planck 2018"
          : "POSSÍVEL PELA FÍSICA, mas não é o nosso universo (descartado pelas medições)"}</p>
        <div class="barra-s8">
          <span class="marca-s8 planck" style="left:${x(PLANCK.S8)}" title="Planck 2018: S8 ≈ 0,83"></span>
          ${LENTES.map((l) => `<span class="marca-s8 lente" style="left:${x(l.S8)}" title="${l.nome}: S8 = ${l.S8}"></span>`).join("")}
          <span class="marca-s8 este" style="left:${x(S8)}" title="esta receita"></span>
        </div>
        <div class="rotulos-escala"><span>S8 0,4</span><span>0,75</span><span>1,1</span></div>
        <p class="nota">Barra do S8: <span class="ponto planck"></span> Planck 2018 (≈ 0,83) ·
        <span class="ponto lente"></span> lentes gravitacionais KiDS-1000 (0,766) e DES Y3 (0,776) ·
        <span class="ponto este"></span> esta receita. A diferença entre o Planck e as lentes é a <b>tensão do
        S8</b>: as lentes veem um universo um pouco menos aglomerado do que o Planck prevê. Compare σ8 0,7 e 0,8.</p>
      </div>
      <p class="nota">Cor e brilho usam a mesma régua em todas as receitas, como uma câmera com a mesma exposição: com
        menos matéria a teia aparece de fato mais apagada. Aglomerados (tecla M): localizados por nós com um método
        publicado, conferido contra o catálogo oficial do Universo 1. Filtros de cor (tecla F): só no Universo 1.</p>`}
      ${faltam.length ? `<p class="aviso-filtro">Ainda não processadas: ${faltam.join(", ")}.</p>` : ""}`;
    document.getElementById("bt-fechar-universos").addEventListener("click", () => alternar(false));
    painel.querySelectorAll(".escolha-universo button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.u === "1") c.trocar(null); else if (!c.atual()) c.trocar("1P_p1_0");
    }));
    if (!sim) return;
    const om_ = painel.querySelector("input[name=om]"), s8_ = painel.querySelector("input[name=s8]");
    const escolher = (i, j) => {
      const alvo = simDe(i, j);
      if (existe[alvo] === false) { montar(); return; }   // posição ainda sem arquivo: não troca
      c.trocar(alvo);
    };
    om_.addEventListener("change", () => escolher(Number(om_.value), 2));   // mexeu em Ωm → σ8 volta a 0,8
    s8_.addEventListener("change", () => escolher(2, Number(s8_.value)));   // mexeu em σ8 → Ωm volta a 0,3
  }

  function alternar(mostrar = painel.hidden) {
    painel.hidden = !mostrar;
    const bt = document.getElementById("bt-universos");
    if (bt) bt.setAttribute("aria-pressed", String(mostrar));
    if (mostrar) { montar(); conferir.then(() => { if (!painel.hidden) montar(); }); }
    return mostrar;
  }
  return { alternar, atualizar: () => { if (!painel.hidden) montar(); }, existe, painel };
}
