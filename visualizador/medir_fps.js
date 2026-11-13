/**
 * Roteiro automático de medição de quadros por segundo (F3.3). Liga com ?medir=1:
 *   http://127.0.0.1:8765/visualizador/index.html?medir=1                       (versão 1/64)
 *   http://127.0.0.1:8765/visualizador/index.html?medir=1&arquivo=teia_1_8_magma.spz  (versão 1/8)
 *
 * Passa por 3 vistas, sem precisar mexer em nada. Em cada uma mede DOIS estados:
 *   parado  — câmera parada (com ?resolucao=auto isso é resolução TOTAL);
 *   girando — câmera girando devagar (20°/s) em volta do centro, como quem explora
 *             (com resolucao=auto isso é a resolução de movimento).
 * A janela precisa ficar VISÍVEL (abas e janelas escondidas param de desenhar e dariam 0).
 *
 * Correção de 15/10/2026: a 1ª versão só media parado — e, com resolução automática, parado é
 * resolução total, justamente quando a velocidade menos importa. Medições antigas com
 * resolucao=auto mediam "parado"; a de resolucao=0.5 aproximava "girando".
 *
 * Critérios (registrados antes de medir):
 *   ≥ 30 QPS fluido · 20–30 aceitável · < 20 travando
 *   Decisão pela coluna GIRANDO: padrão = a versão de maior resolução fluida (≥ 30) nas 3 vistas.
 *   A coluna parado é informativa (imagem parada não "trava" para quem olha).
 */
const VISTAS = [
  { nome: "de frente (caixa inteira)", preparar: (t) => { t.voltarACaixa(); } },
  { nome: "de perto, no centro", preparar: (t) => { t.voltarACaixa(); t.passoAnimacao(Infinity); t.zoom(0.343); } },
  { nome: "girada (diagonal)", preparar: (t) => {
      const d = t.constantes.VISTA_INICIAL.posicao.z;
      t.camera.position.set(d * 0.55, d * 0.45, d * 0.7); t.controls.target.set(0, 0, 0); t.controls.update();
    } },
];
const ESTABILIZAR_MS = 1500;
const PARADO_MS = 4000;
const GIRANDO_MS = 5000;
const GRAUS_POR_SEGUNDO = 20;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const classificar = (q) => (q >= 30 ? "fluido" : q >= 20 ? "aceitável" : "travando");
// Menos de 1 quadro por segundo = o navegador não estava desenhando (aba/janela escondida).
// Isso NÃO é medida de desempenho e não pode virar "travando".
const semMedida = (e, ms) => e.quadros < ms / 1000;
const cor = (q) => (q >= 30 ? "🟢" : q >= 20 ? "🟡" : "🔴");

/** Gira a câmera em volta do alvo (eixo vertical) durante `ms`, avisando que está em movimento. */
function girar(t, ms) {
  return new Promise((resolver) => {
    let terminou = false;
    const fim = () => { if (!terminou) { terminou = true; resolver(); } };
    setTimeout(fim, ms + 300); // segurança: com a janela escondida o laço de desenho não anda
    const inicio = performance.now();
    let anterior = inicio;
    const passo = (agora) => {
      const dt = (agora - anterior) / 1000; anterior = agora;
      const rel = t.camera.position.clone().sub(t.controls.target);
      const ang = (GRAUS_POR_SEGUNDO * Math.PI / 180) * dt;
      const c = Math.cos(ang), s = Math.sin(ang);
      rel.set(rel.x * c - rel.z * s, rel.y, rel.x * s + rel.z * c);
      t.camera.position.copy(t.controls.target).add(rel);
      t.controls.update();
      t.controls.dispatchEvent({ type: "change" }); // aciona a resolução de movimento
      if (!terminou && agora - inicio < ms) requestAnimationFrame(passo); else fim();
    };
    requestAnimationFrame(passo);
  });
}

/**
 * Diagnóstico da névoa (?medir=nevoa, junto com &nevoa=1), 19/10/2026. Pedido depois que a 1/8 +
 * névoa caiu de 38/61/60 (17/10) para 20/15/20 (19/10) com a 1/64 intacta em 60/59/60.
 * Mede só GIRANDO, nas mesmas 3 vistas, 5 variantes seguidas na mesma página (mesma máquina, mesmo
 * momento — a comparação entre variantes vale mesmo que a máquina varie de um dia para outro):
 *   A sem névoa (só halos — diagnóstico, NÃO é opção de desenho: falta a massa da névoa)
 *   B névoa como está (passo 1 célula, ½ resolução)
 *   C passo 2 células (erro médio 0,03 %, conferido) · D ¼ de resolução · E passo 2 + ¼ de resolução
 */
const VARIANTES = [
  { nome: "A sem névoa (só diagnóstico)", cfg: { visivel: false } },
  { nome: "B passo 1 + ½ (1ª versão)", cfg: { visivel: true, passo: 1, escala: 0.5 } },
  { nome: "C passo 2", cfg: { visivel: true, passo: 2, escala: 0.5 } },
  { nome: "D ¼ resolução", cfg: { visivel: true, passo: 1, escala: 0.25 } },
  { nome: "E passo 2 + ¼ (padrão)", cfg: { visivel: true, passo: 2, escala: 0.25 } },
];

export async function rodarDiagnosticoNevoa(t, arquivo) {
  const n = t.nevoa();
  const quadro = Object.assign(document.createElement("div"), { id: "medicao" });
  quadro.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:min(560px,92vw);" +
    "background:rgba(12,10,20,.9);color:#eee;border:1px solid rgba(255,255,255,.25);border-radius:12px;" +
    "padding:14px 18px;font:14px system-ui;line-height:1.6;z-index:10";
  document.body.appendChild(quadro);
  if (!n) { quadro.textContent = "Diagnóstico da névoa precisa de &nevoa=1 no endereço."; return null; }
  const delta = n.grade.delta;
  const res = VARIANTES.map(() => []);
  const desenhar = (status) => {
    quadro.innerHTML = `<b style="font-size:15px">Diagnóstico da névoa — ${arquivo}</b><br>` +
      `<span style="opacity:.7">girando 20°/s · tela ${innerWidth}×${innerHeight} · ${devicePixelRatio}x` +
      `${t.lod ? ` · detalhe ×${t.lod.escala}` : ""} · carga ${t.tempoCargaS ?? "?"} s</span>` +
      `<table style="border-collapse:collapse;margin-top:4px"><tr style="opacity:.7"><td>variante</td>` +
      VISTAS.map((v) => `<td style="padding-left:14px">${v.nome.split(" (")[0]}</td>`).join("") + `</tr>` +
      VARIANTES.map((va, i) => `<tr><td>${va.nome}</td>` + VISTAS.map((_, j) => {
        const e = res[i][j];
        if (!e) return `<td style="padding-left:14px;opacity:.4">…</td>`;
        if (semMedida(e, GIRANDO_MS)) return `<td style="padding-left:14px">⚠️</td>`;
        return `<td style="padding-left:14px">${cor(e.qps_mediano)} <b>${e.qps_mediano.toFixed(0)}</b> ` +
               `<span style="opacity:.6">(${e.qps_pior5.toFixed(0)})</span></td>`;
      }).join("") + `</tr>`).join("") +
      `</table><span style="opacity:.8">${status}</span>`;
  };
  for (let j = 0; j < VISTAS.length; j++) {
    for (let i = 0; i < VARIANTES.length; i++) {
      const cfg = { ...VARIANTES[i].cfg };
      if (cfg.passo !== undefined) cfg.passo *= delta;
      n.camadas.configurar(cfg);
      desenhar(`medindo: ${VISTAS[j].nome} · ${VARIANTES[i].nome}…`);
      VISTAS[j].preparar(t);
      await espera(800);
      await girar(t, 600);
      await girar(t, GIRANDO_MS);
      res[i][j] = t.estatisticasFps(GIRANDO_MS);
    }
  }
  n.camadas.configurar({ ...VARIANTES[4].cfg, passo: 2 * delta });  // volta ao padrão (E)
  t.voltarACaixa();
  const invalida = res.flat().some((e) => semMedida(e, GIRANDO_MS));
  desenhar(invalida ? "<b>Medição inválida:</b> a página saiu da tela. Recarregue (F5) e deixe-a visível."
                    : "<b>Pronto.</b> Números = mediana (pior 5 %). Tire um print e mande.");
  t.resultadoDiagnostico = { arquivo, variantes: VARIANTES.map((v, i) => ({ nome: v.nome, vistas: res[i] })) };
  return t.resultadoDiagnostico;
}

export async function rodarMedicao(t, arquivo) {
  const quadro = Object.assign(document.createElement("div"), { id: "medicao" });
  quadro.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:min(460px,90vw);" +
    "background:rgba(12,10,20,.9);color:#eee;border:1px solid rgba(255,255,255,.25);border-radius:12px;" +
    "padding:14px 18px;font:14px system-ui;line-height:1.6;z-index:10";
  document.body.appendChild(quadro);
  const linhas = [];
  const desenhar = (status) => {
    quadro.innerHTML = `<b style="font-size:15px">Medindo quadros por segundo — ${arquivo}</b><br>` +
      `<span style="opacity:.7">${navigator.userAgent.includes("Mobile") ? "celular" : "computador"} · ` +
      `tela ${innerWidth}×${innerHeight} · ${devicePixelRatio}x · desvio ${t.ajustes.maxStdDev} · ` +
      `opacidade mín. ${t.ajustes.minAlpha < 0.01 ? "padrão" : t.ajustes.minAlpha} · ` +
      `resolução ${t.resolucao().modo}${t.lod ? ` · detalhe ×${t.lod.escala}` : ""}${t.ext ? " · float32" : ""}` +
      `${t.tempoCargaS ? ` · carga ${t.tempoCargaS} s` : ""}</span><br>` +
      `<table style="border-collapse:collapse;margin-top:4px"><tr style="opacity:.7"><td>vista</td>` +
      `<td style="padding-left:14px"><b>girando</b> (decide)</td><td style="padding-left:14px">parado</td></tr>` +
      linhas.map((l) => `<tr><td>${l.vista}</td>` +
        (semMedida(l.girando, GIRANDO_MS) ? `<td style="padding-left:14px">⚠️ sem medida</td>`
          : `<td style="padding-left:14px">${cor(l.girando.qps_mediano)} <b>${l.girando.qps_mediano.toFixed(0)}</b> ` +
            `<span style="opacity:.6">(pior 5%: ${l.girando.qps_pior5.toFixed(0)})</span></td>`) +
        (semMedida(l.parado, PARADO_MS) ? `<td style="padding-left:14px">⚠️ sem medida</td>`
          : `<td style="padding-left:14px">${l.parado.qps_mediano.toFixed(0)} ` +
            `<span style="opacity:.6">(${l.parado.qps_pior5.toFixed(0)})</span></td>`) + `</tr>`).join("") +
      `</table><span style="opacity:.8">${status}</span>`;
  };
  for (const v of VISTAS) {
    desenhar(`medindo: ${v.nome} (parado)…`);
    v.preparar(t);
    await espera(ESTABILIZAR_MS + 500);      // passa o tempo de voltar à resolução total
    await espera(PARADO_MS);
    const parado = t.estatisticasFps(PARADO_MS);
    desenhar(`medindo: ${v.nome} (girando)…`);
    await girar(t, 600);                     // entra no modo de movimento antes de medir
    await girar(t, GIRANDO_MS);
    const girando = t.estatisticasFps(GIRANDO_MS);
    linhas.push({ vista: v.nome, parado, girando });
    desenhar("…");
  }
  t.voltarACaixa();
  const pior = Math.min(...linhas.map((l) => l.girando.qps_mediano));
  if (linhas.some((l) => semMedida(l.girando, GIRANDO_MS) || semMedida(l.parado, PARADO_MS))) {
    desenhar("<b>Medição inválida:</b> a página saiu da tela durante a medição. Recarregue (F5) e deixe-a visível.");
  } else {
    desenhar(`<b>Resultado (girando): ${classificar(pior)}</b> (pior vista ${pior.toFixed(0)} QPS). Tire um print e mande.`);
  }
  t.resultadoMedicao = { arquivo, ajustes: t.ajustes, linhas, pior_vista_girando_qps: pior,
                         tela: [innerWidth, innerHeight, devicePixelRatio], dispositivo: navigator.userAgent };
  console.table(linhas.map((l) => ({ vista: l.vista, girando: l.girando.qps_mediano, parado: l.parado.qps_mediano })));
  return t.resultadoMedicao;
}
