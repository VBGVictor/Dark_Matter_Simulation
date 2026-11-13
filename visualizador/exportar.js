/**
 * Dentro da Teia — exportar o estado atual (F3.12, 21/10/2026). Botão ⤓ ou tecla E.
 *
 * Critério do backlog: "quem achou uma configuração interessante salva em CSV (parâmetros, filtros ativos e
 * números da vista) e PDF (imagem + parâmetros + fontes de cada número). O CSV reabre a mesma configuração e o
 * PDF é legível por leigo."
 *
 * CSV: pensado para o Excel em português — separador ";", vírgula decimal, marca UTF-8 no início (acentos).
 *      Uma linha por item: chave ; valor ; explicação. A leitura aceita vírgula ou ponto decimal.
 * PDF: monta a página (imagem da tela + configuração explicada + fontes) num quadro invisível DENTRO desta página e
 *      chama a impressão; escolha "Salvar como PDF". Sem biblioteca nova.
 *      CORREÇÃO 21/10/2026 (Victor: "parece travado em Preparando a imagem"): a 1ª versão abria uma janela nova ANTES
 *      de capturar; a janela ia para a frente, a aba da teia ficava escondida, o navegador parava de desenhar nela e a
 *      captura (que espera quadros desenhados) nunca terminava. Agora captura primeiro, com a teia na tela, e não
 *      abre janela. Progresso com pontinhos animados; aviso de que pode levar ~1 minuto; desiste com mensagem em 60 s.
 */

const SEP = ";";
const num = (v, casas = 4) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(casas).replace(".", ",") : String(v ?? ""));
const lerNum = (s) => Number(String(s).replace(",", "."));
const escapar = (s) => (/[;"\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));

/** Linhas do CSV a partir do estado (lista de [chave, valor, explicação]). */
export function linhasDoEstado(e) {
  const L = [];
  const add = (k, v, x) => L.push([k, v, x]);
  add("ferramenta", "Dentro da Teia", "visualizador da teia de matéria escura de uma simulação real (CAMELS) — simulação, não foto");
  add("data_hora", e.dataHora, "quando esta configuração foi salva");
  add("universo", e.universo, "1 = principal; 2 = laboratório de receitas");
  add("receita_simulacao", e.sim ?? "", "nome técnico da simulação do Universo 2 (vazio no Universo 1)");
  add("receita_omega_m", num(e.omegaM, 2), "quantidade de matéria (Ωm)");
  add("receita_sigma8", num(e.sigma8, 2), "aglomeração (σ8)");
  add("arquivo", e.arquivo, "arquivo de manchas aberto");
  add("cor_camada", e.cor.camada, "o que a cor mostra: densidade, discordancia (incerteza do método) ou lab (sua regra)");
  add("cor_estimador", e.cor.estimador, "fórmula da densidade (A padrão, C, B, D)");
  add("cor_paleta", e.cor.paleta, "magma (padrão), corpo_negro, artistica");
  add("cor_par", e.cor.par, "par comparado na incerteza do método (X/Y)");
  add("cor_lab_x", e.cor.labX, "laboratório: estimador X");
  add("cor_lab_y", e.cor.labY, "laboratório: estimador Y");
  add("cor_lab_peso", e.cor.labPeso, "laboratório: peso de Y em % (sua regra — não publicada, não conferida)");
  add("cor_resolucao", e.cor.resolucao, "densidade da simulação completa ou da própria versão leve");
  add("camera_x", num(e.camera[0]), "posição da câmera [Mpc/h]");
  add("camera_y", num(e.camera[1]), "posição da câmera [Mpc/h]");
  add("camera_z", num(e.camera[2]), "posição da câmera [Mpc/h]");
  add("foco_x", num(e.alvo[0]), "ponto para onde a câmera olha [Mpc/h]");
  add("foco_y", num(e.alvo[1]), "ponto para onde a câmera olha [Mpc/h]");
  add("foco_z", num(e.alvo[2]), "ponto para onde a câmera olha [Mpc/h]");
  add("aglomerados_ligado", e.aglomerados ? "sim" : "não", "marcadores de halos (tecla M)");
  add("halo_escolhido", e.halo ? e.halo.numero : "", "nº do halo clicado (ordem de massa)");
  add("halo_massa_sois", e.halo ? num(e.halo.massa, 0) : "", "massa do halo clicado [massas do Sol]");
  // números da vista (só leitura — não são reaplicados)
  add("vista_distancia_ao_foco_mpc_h", num(e.distancia, 3), "número da vista: distância da câmera ao foco");
  add("vista_massa_por_mancha_sois", num(e.massaPorMancha, 0), "número da vista: massa de cada mancha [massas do Sol]");
  add("vista_nevoa", e.nevoa ?? "desligada", "número da vista: névoa em volume (grade) e erro máximo longe do foco");
  add("vista_detalhe_automatico", e.lod ?? "desligado", "número da vista: escala do nível de detalhe");
  return L;
}

export function gerarCSV(e) {
  const corpo = [["chave", "valor", "explicação"], ...linhasDoEstado(e)].map((l) => l.map(escapar).join(SEP)).join("\r\n");
  return "﻿" + corpo;
}

/** Lê o CSV (o nosso ou editado no Excel) → { chave: valor }. Aceita ";" ou "," como separador. */
export function lerCSV(texto) {
  const t = texto.replace(/^﻿/, "");
  const sep = t.split(/\r?\n/)[0].includes(";") ? ";" : ",";
  const mapa = {};
  for (const linha of t.split(/\r?\n/).slice(1)) {
    if (!linha.trim()) continue;
    const campos = [];
    let atual = "", aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const ch = linha[i];
      if (aspas) { if (ch === '"' && linha[i + 1] === '"') { atual += '"'; i++; } else if (ch === '"') aspas = false; else atual += ch; }
      else if (ch === '"') aspas = true;
      else if (ch === sep) { campos.push(atual); atual = ""; }
      else atual += ch;
    }
    campos.push(atual);
    if (campos[0]) mapa[campos[0]] = campos[1] ?? "";
  }
  return mapa;
}

/** Do CSV lido → mudanças que o app sabe aplicar. */
export function configuracaoDoCSV(m) {
  const vetor = (p) => [lerNum(m[`${p}_x`]), lerNum(m[`${p}_y`]), lerNum(m[`${p}_z`])];
  const camera = vetor("camera"), alvo = vetor("foco");
  return {
    universo: m.universo === "2" ? "2" : "1",
    sim: m.receita_simulacao || null,
    cor: { estimador: m.cor_estimador || "A", paleta: m.cor_paleta || "magma", camada: m.cor_camada || "densidade",
           par: m.cor_par || "B/A", labX: m.cor_lab_x || "A", labY: m.cor_lab_y || "B",
           labPeso: Number.isFinite(lerNum(m.cor_lab_peso)) ? lerNum(m.cor_lab_peso) : 50,
           resolucao: m.cor_resolucao || "completa" },
    camera: camera.every(Number.isFinite) ? camera : null,
    alvo: alvo.every(Number.isFinite) ? alvo : null,
    aglomerados: m.aglomerados_ligado === "sim",
  };
}

/** Página do PDF (HTML) — linguagem de leigo + fontes. */
export function paginaPDF(e, imagem, fontes) {
  const linha = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  const corTexto = e.cor.camada === "lab"
    ? `Sua regra (laboratório — não publicada, não conferida): ${100 - e.cor.labPeso} % ${e.cor.labX} + ${e.cor.labPeso} % ${e.cor.labY}`
    : e.cor.camada === "discordancia" ? `Incerteza do método: onde as fórmulas ${e.cor.par.replace("/", " e ")} discordam`
    : `Densidade de matéria escura (fórmula ${e.cor.estimador}, paleta ${e.cor.paleta.replace("_", " ")})`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Dentro da Teia — ${e.dataHora}</title>
  <style>body{font:13px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0}h2{font-size:15px;margin:18px 0 6px}
  img{width:100%;border-radius:6px;margin:10px 0}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:4px 6px;vertical-align:top}
  td:first-child{width:38%;color:#444}.selo{display:inline-block;padding:2px 8px;border:1px solid #a64;border-radius:4px;color:#a64;font-size:11px}
  li{margin:3px 0}.nota{font-size:11px;color:#555}@media print{body{margin:10mm}}</style></head><body>
  <h1>Dentro da Teia</h1><span class="selo">simulação, não foto</span> <span class="nota">${e.dataHora}</span>
  <img src="${imagem}" alt="Imagem da teia de matéria escura nesta configuração">
  <h2>O que você está vendo</h2>
  <p>Matéria escura numa simulação de computador de um cubo do universo com ~121 milhões de anos-luz de lado, hoje.
  Cada mancha de luz representa matéria escura (ela não emite luz de verdade: a cor é uma convenção). As regiões claras
  e alaranjadas são aglomerados (halos), os fios são filamentos, e o escuro são vazios. Não é um lugar real do céu:
  é um pedaço típico de um universo que segue as leis da física e as medidas do nosso.</p>
  <h2>Configuração</h2><table>
  ${linha("Universo", e.universo === "2" ? `2 — laboratório de receitas (quantidade de matéria Ωm ${num(e.omegaM, 1)}, aglomeração σ8 ${num(e.sigma8, 1)})`
                                         : "1 — principal (receita do nosso universo: Ωm 0,3, σ8 0,8)")}
  ${linha("O que a cor mostra", corTexto)}
  ${linha("Névoa", e.nevoa ?? "desligada")}
  ${linha("Aglomerados marcados", e.aglomerados ? "sim" : "não")}
  ${e.halo ? linha("Aglomerado escolhido", `nº ${e.halo.numero}, cerca de ${num(e.halo.massa / 1e12, 1)} trilhões de massas do Sol`) : ""}
  ${linha("Distância da câmera ao foco", `${num(e.distancia, 2)} Mpc/h (≈ ${num(e.distancia * 4.86, 1)} milhões de anos-luz)`)}
  ${linha("Massa de cada mancha", `${num(e.massaPorMancha / 1e6, 0)} milhões de massas do Sol`)}
  </table>
  <h2>De onde vem cada número</h2><ul>${fontes.map((f) => `<li>${f}</li>`).join("")}</ul>
  <p class="nota">Para reabrir exatamente esta vista, use o arquivo CSV salvo junto (botão ⤓ → Abrir configuração).</p>
  </body></html>`;
}

/**
 * Painel. c = { estado: () => objeto, aplicar: async (config) => void, capturarImagem: async () => dataURL,
 *               fontes: () => [texto…] }
 */
export function criarExportar(c) {
  const painel = Object.assign(document.createElement("aside"), { id: "exportar", hidden: true });
  painel.setAttribute("aria-label", "Exportar");
  document.body.appendChild(painel);
  const baixar = (conteudo, nome, tipo) => {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([conteudo], { type: tipo })), download: nome });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  const carimbo = () => new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "h");
  function montar(msg = "") {
    painel.innerHTML = `<h2>Exportar <button id="bt-fechar-exportar" aria-label="Fechar">×</button></h2>
      <p class="nota">Achou uma vista interessante? Guarde-a.</p>
      <button class="botao-texto" id="bt-csv">Salvar configuração (CSV)</button>
      <p class="nota">Uma linha por item (universo, cor, câmera, aglomerado escolhido, números da vista), com explicação.
      Abre no Excel e reabre aqui a mesma vista.</p>
      <label class="botao-texto" for="ent-csv">Abrir configuração (CSV)</label>
      <input type="file" id="ent-csv" accept=".csv,text/csv" hidden>
      <button class="botao-texto" id="bt-pdf">Gerar PDF</button>
      <p class="nota">Monta uma página com a imagem da tela, a configuração explicada e a fonte de cada número, e abre a
      janela de impressão: escolha "Salvar como PDF". <b>Pode levar até ~1 minuto</b> — deixe esta aba na frente.</p>
      <p id="status-pdf" class="status-pdf" role="status" hidden></p>
      ${msg ? `<p class="aviso-filtro">${msg}</p>` : ""}`;
    document.getElementById("bt-fechar-exportar").addEventListener("click", () => alternar(false));
    document.getElementById("bt-csv").addEventListener("click", () => {
      baixar(gerarCSV(c.estado()), `dentro_da_teia_${carimbo()}.csv`, "text/csv;charset=utf-8");
    });
    document.getElementById("ent-csv").addEventListener("change", async (ev) => {
      const arq = ev.target.files[0];
      if (!arq) return;
      try {
        await c.aplicar(configuracaoDoCSV(lerCSV(await arq.text())));
        montar(`Configuração "${arq.name}" aplicada.`);
      } catch (erro) { montar(`Não consegui ler "${arq.name}": ${erro.message}`); }
    });
    document.getElementById("bt-pdf").addEventListener("click", async () => {
      const bt = document.getElementById("bt-pdf"), status = document.getElementById("status-pdf");
      const passo = (txt) => { status.hidden = false; status.innerHTML = `${txt}<span class="pontinhos"><i>.</i><i>.</i><i>.</i></span>`; };
      bt.disabled = true;
      try {
        passo("Preparando a imagem");
        const imagem = await Promise.race([c.capturarImagem(), new Promise((_, falha) => setTimeout(() =>
          falha(new Error("a teia parou de ser desenhada (a aba ficou escondida?). Deixe esta aba na frente e tente de novo")), 60000))]);
        passo("Montando a página do PDF");
        const quadro = Object.assign(document.createElement("iframe"), { title: "página do PDF" });
        quadro.style.cssText = "position:fixed;left:-10000px;top:0;width:1000px;height:1400px;border:0";
        document.body.appendChild(quadro);
        const pronto = new Promise((r) => { quadro.onload = r; });
        quadro.srcdoc = paginaPDF(c.estado(), imagem, c.fontes());
        await pronto;
        const img = quadro.contentDocument.querySelector("img");
        if (img && !img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; });
        passo("Abrindo a janela de impressão");
        quadro.contentWindow.focus();
        quadro.contentWindow.print();
        status.textContent = "Pronto. Na janela de impressão, escolha \"Salvar como PDF\".";
        setTimeout(() => quadro.remove(), 60000);
      } catch (erro) {
        status.hidden = false; status.textContent = `Não consegui gerar o PDF: ${erro.message}.`;
      } finally { bt.disabled = false; }
    });
  }
  function alternar(mostrar = painel.hidden) {
    painel.hidden = !mostrar;
    const bt = document.getElementById("bt-exportar");
    if (bt) bt.setAttribute("aria-pressed", String(mostrar));
    if (mostrar) montar();
    return mostrar;
  }
  return { alternar, painel };
}
