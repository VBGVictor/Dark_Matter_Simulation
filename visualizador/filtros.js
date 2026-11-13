/**
 * Dentro da Teia — painel de FILTROS (F3.7 em diante). Botão ⚗ ou tecla F.
 *
 * F3.7 (20/10/2026) — estimador de densidade (A/C/B/D) e paleta. Filosofia do Victor (14/10): todas as
 * teorias publicadas entram como filtro, cada uma com o artigo de origem e ONDE ERRA, com aviso de
 * incompatibilidade visível; nada de inventar. Os números dos textos abaixo são os testes de resposta
 * conhecida da F2.1 (ARTIGOS §4.1, critérios registrados antes de rodar):
 *   T1 grade regular (±1 %) · T2 partículas ao acaso (±5 %) · T3 halo NFW sintético (±10 %)
 * Misturar estimadores ("B onde está arrumado, A onde está bagunçado") é o LABORATÓRIO (F3.9), não aqui.
 */
export const ESTIMADORES = {
  A: {
    nome: "A · vizinhos mais próximos (kNN)",
    origem: "Casertano & Hut (1985), apêndice A: ρ = 31·m / (4/3 π r³) até o 32º vizinho",
    acerta: "onde as partículas estão desordenadas — halos e filamentos (ao acaso +0,1 %; halo NFW 3,1 %)",
    erra: "numa grade regular perfeita (−7,5 %), arranjo que não existe na simulação",
    aviso: null,
    padrao: true,
  },
  C: {
    nome: "C · SPH sem a própria partícula",
    origem: "kernel do GADGET-2 (Springel 2005, eq. 4–5), sem a contribuição da própria partícula",
    acerta: "onde as partículas estão desordenadas (ao acaso +0,3 %; halo NFW 5,5 %)",
    erra: "numa grade regular perfeita (−32 %)",
    aviso: "Concorda com o A na maior parte da caixa; fica abaixo do A no miolo dos halos e acima nos filamentos " +
           "finos. A diferença entre os dois é incerteza do MÉTODO, não da física.",
  },
  B: {
    nome: "B · SPH do GADGET (original)",
    origem: "Springel (2005), eq. 5 — o mesmo código que rodou a simulação",
    acerta: "numa grade regular perfeita (0,00 %)",
    erra: "onde as partículas estão desordenadas: +35 % ao acaso, 30 % no halo NFW",
    aviso: "Superestima a densidade justamente onde está a estrutura (halos e filamentos): as cores ali ficam mais " +
           "quentes que a melhor estimativa. Bom para comparar, não para medir.",
  },
  D: {
    nome: "D · Wendland C2 + correção de Dehnen & Aly",
    origem: "kernel Wendland C2 com a correção de Dehnen & Aly (2012), eq. 18–19",
    acerta: "numa grade regular perfeita (−0,2 %)",
    erra: "onde as partículas estão desordenadas: +42 % ao acaso, +37 % no halo NFW — a correção foi " +
          "calibrada para arranjos quase regulares",
    aviso: "Superestima dentro dos halos e filamentos, como o B. Bom para comparar, não para medir.",
  },
};

/**
 * F3.8 — camada "incerteza do método": a cor mostra ρ_X ÷ ρ_Y. Ajuste de 21/10/2026 (pedido do Victor):
 * qualquer par entre os 4 (não só contra o A) e uma explicação do que a diferença significa.
 * Textos SÓ com o medido e com a definição das fórmulas (gerar_splats.py). Medições (21/10, versão 1/8):
 *   mediana por faixa de densidade (pelo A): abaixo da média · 1–100× · 100–10 mil× · acima de 10 mil×
 *   teste com pontos AO ACASO (262.144, sem estrutura): C/A ×0,52–×1,57 (p5–p95); B/C ×1,35;
 *   A ÷ densidade verdadeira ×0,74–×1,33  → cada estimador tem ruído de ±25–33 % com 32 vizinhos.
 *   % saturado = fora de ÷3 a ×3.
 */
export const COMO_MEDE = {
  A: "conta os 32 vizinhos mais próximos e divide a massa deles pelo volume da esfera que os contém.",
  C: "soma a massa dos 32 vizinhos, cada um com um peso que cai com a distância (o kernel do GADGET).",
  B: "igual ao C, mas soma também a própria partícula — com o peso máximo, porque ela está a distância zero.",
  D: "como o B, com outro kernel (Wendland C2) e uma correção publicada que desconta parte da própria partícula.",
};

export const PARES = {
  "C/A": { mediana: "×1,00", saturado: "7,8 %", faixas: "×0,98 · ×1,05 · ×0,96 · ×1,00",
    leitura: "Dois métodos diferentes que não contam a própria partícula. Na média concordam em todas as faixas " +
             "de densidade (cinza), mas mancha a mancha variam de ×0,40 a ×2,86. Parte disso é ruído de medir com " +
             "só 32 vizinhos: com pontos ao acaso, sem estrutura nenhuma, já dá ×0,52 a ×1,57. O resto vem da " +
             "estrutura (medido na F2.1: C abaixo do A no miolo dos halos, acima nos filamentos finos)." },
  "B/A": { mediana: "×1,35", saturado: "5,8 %", faixas: "×1,33 · ×1,39 · ×1,30 · ×1,35",
    leitura: "Vermelho quase em toda parte, com o mesmo tamanho em todas as faixas: é a parcela da própria " +
             "partícula que o B soma (veja B ÷ C), mais o ruído entre métodos diferentes (veja C ÷ A)." },
  "D/A": { mediana: "×1,41", saturado: "7,4 %", faixas: "×1,40 · ×1,48 · ×1,37 · ×1,41",
    leitura: "Quase igual ao B ÷ A: o D também soma a própria partícula, e a correção de Dehnen & Aly — calibrada " +
             "para arranjos quase regulares — não tira esse excesso onde as partículas estão desordenadas." },
  "B/C": { mediana: "×1,35", saturado: "0,6 %", faixas: "×1,35 · ×1,33 · ×1,36 · ×1,34",
    leitura: "O par mais limpo: B e C são a MESMA fórmula, a única diferença é somar a própria partícula. O " +
             "resultado é um excesso quase constante de ~35 % em toda a caixa (vazios, filamentos e halos), e o " +
             "mesmo ×1,35 com pontos ao acaso: depende do número de vizinhos, não da estrutura." },
  "D/C": { mediana: "×1,41", saturado: "0,7 %", faixas: "×1,43 · ×1,41 · ×1,43 · ×1,41",
    leitura: "Mesmo retrato do B ÷ C: um excesso quase constante (~41 %) vindo da própria partícula, que a " +
             "correção do D não remove." },
  "D/B": { mediana: "×1,05", saturado: "0,0 %", faixas: "×1,06 · ×1,06 · ×1,05 · ×1,05",
    leitura: "Quase iguais (5 % de diferença, a mesma em toda parte): trocar o kernel e aplicar a correção muda " +
             "pouco. B e D são, na prática, a mesma família." },
};

export const PALETAS = {
  magma: { nome: "Magma", nota: "científica, perceptual (padrão)" },
  corpo_negro: { nome: "Corpo negro", nota: "lei de Planck + curvas do olho (CIE 1931)" },
  artistica: { nome: "Artística", nota: "só estética" },
};

/**
 * c = { disponivel: bool, cor: {estimador, paleta, camada, par}, trocarCor: async ({...mudanças}) => bool,
 *       ocupado: () => bool, motivoIndisponivel: string, lutDivergente: () => Float32Array(768) | null }
 */
export function criarFiltros(c) {
  const painel = Object.assign(document.createElement("aside"), { id: "filtros", hidden: true });
  painel.setAttribute("aria-label", "Filtros");
  document.body.appendChild(painel);

  function montar() {
    const est = ESTIMADORES[c.cor.estimador];
    const disc = c.cor.camada === "discordancia";
    const lab = c.cor.camada === "lab";
    const travado = !c.disponivel || c.ocupado() ? "disabled" : "";
    const escolha = (nome, valor) => `<select name="${nome}" ${travado}>${Object.keys(ESTIMADORES)
      .map((k) => `<option value="${k}" ${k === valor ? "selected" : ""}>${k}</option>`).join("")}</select>`;
    const par = PARES[c.cor.par] ?? PARES["B/A"];
    const [pX, pY] = c.cor.par.split("/");
    const lut = c.lutDivergente();
    const barra = lut ? `linear-gradient(to right, ${[0, 32, 64, 96, 128, 160, 192, 224, 255]
      .map((i) => `rgb(${[0, 1, 2].map((k) => Math.round(255 * lut[3 * i + k])).join(",")})`).join(", ")})` : "#888";
    const radio = (grupo, valor, rotulo, nota, marcado) =>
      `<label class="opcao"><input type="radio" name="${grupo}" value="${valor}" ${marcado ? "checked" : ""}
         ${!c.disponivel || c.ocupado() ? "disabled" : ""}> <span><b>${rotulo}</b>${nota ? ` <small>${nota}</small>` : ""}</span></label>`;
    painel.innerHTML = `<h2>Filtros <button id="bt-fechar-filtros" aria-label="Fechar filtros">×</button></h2>
      ${c.disponivel ? "" : `<p class="aviso-filtro">${c.motivoIndisponivel}</p>`}
      <section>
        <h3>O que a cor mostra</h3>
        ${radio("camada", "densidade", "Densidade", "pelo estimador escolhido abaixo", !disc)}
        ${radio("camada", "discordancia", "Incerteza do método", "diferença entre dois estimadores", disc)}
        ${radio("camada", "lab", "Laboratório", "sua regra: mistura de dois estimadores", lab)}
        ${lab ? `<div class="ficha lab">
          <p class="selo-usuario">CRIAÇÃO DO USUÁRIO — não publicada, não conferida</p>
          <p>Mistura em log (média geométrica com peso): <b>ρ = ρ<sub>X</sub><sup>1−p</sup> · ρ<sub>Y</sub><sup>p</sup></b>.
          Em 0 % é exatamente o X; em 100 %, exatamente o Y. Nenhum artigo propõe essa mistura: a regra é sua;
          o projeto só entrega os ingredientes (as 4 fórmulas publicadas, com os erros de cada uma na ficha abaixo).</p>
          <div class="lab-linha">X ${escolha("labX", c.cor.labX)} <span>${100 - c.cor.labPeso} %</span>
            <input type="range" name="labPeso" min="0" max="100" step="5" value="${c.cor.labPeso}" ${travado}
              aria-label="Peso de Y na mistura">
            <span>${c.cor.labPeso} %</span> ${escolha("labY", c.cor.labY)} Y</div>
          ${c.cor.labX === c.cor.labY ? `<p class="aviso-filtro">Escolha dois estimadores diferentes.</p>` : ""}
          <p class="nota">Cada mudança remonta a teia (com névoa, uns segundos). Arredondamento: até 1 tom (em 256)
          no meio da mistura; onde um dos dois saturava a escala de cor, a mistura parte do valor saturado.
          Dica: misturar A e C (mesmo grupo) mexe pouco; misturar com B ou D desloca tudo em até ~35–41 %.</p>
        </div>` : ""}
        ${disc ? `<div class="ficha">
          <p><b>Como cada um mede a densidade de uma partícula:</b></p>
          <ul class="como-mede">${Object.entries(COMO_MEDE).map(([k, txt]) => `<li><b>${k}</b> ${txt}</li>`).join("")}</ul>
          <p>Por isso eles formam <b>dois grupos</b>: <b>A e C</b> não contam a própria partícula; <b>B e D</b> contam.
          Entre os grupos a diferença é quase constante (~35–41 %); dentro de cada grupo, pequena na média.
          E todos têm ruído: com pontos ao acaso, o próprio A erra de ×0,74 a ×1,33 a densidade verdadeira.</p>
          <p><b>Escolha o par</b> (X ÷ Y):</p>
          <div class="pares">${Object.entries(PARES).map(([k, p]) => radio("par", k, k.replace("/", " ÷ "), p.mediana, k === c.cor.par)).join("")}</div>
          <div class="barra-escala" style="background:${barra}"></div>
          <div class="rotulos-escala"><span>÷3</span><span>÷1,7</span><span>igual</span><span>×1,7</span><span>×3</span></div>
          <p class="nota">Azul = ${pX} menor que ${pY} · cinza = concordam · vermelho = ${pX} maior que ${pY}.</p>
          <p><b>Como ler ${pX} ÷ ${pY}:</b> ${par.leitura}</p>
          <p class="nota">Mediana por faixa de densidade (abaixo da média · 1–100× · 100–10 mil× · acima de 10 mil×):
          ${par.faixas}. Escala de ÷3 a ×3 (convenção): além disso a cor satura (${par.saturado} das manchas).
          Paleta coolwarm (Moreland 2009). É só a razão entre dois métodos publicados — não diz qual está certo;
          os testes de cada um estão na ficha do estimador.</p>
        </div>` : ""}
      </section>
      <section${disc || lab ? ' class="apagada"' : ""}>
        <h3>Estimador de densidade (cor das manchas)${disc ? " — não usado na incerteza do método" : lab ? " — o laboratório usa X e Y" : ""}</h3>
        ${Object.entries(ESTIMADORES).map(([k, e]) => radio("estimador", k, e.nome, e.padrao ? "padrão" : "", k === c.cor.estimador)).join("")}
        <div class="ficha">
          <p><b>Origem:</b> ${est.origem}.</p>
          <p><b>Acerta</b> ${est.acerta}.</p>
          <p><b>Erra</b> ${est.erra}.</p>
          ${est.aviso ? `<p class="aviso-filtro">⚠ ${est.aviso}</p>` : ""}
          <p class="nota">Só a COR muda: o tamanho de cada mancha (33º vizinho) e a opacidade (massa) são os
          mesmos nos quatro. Densidade de cada partícula calculada ${c.cor.resolucao === "versao" ? "na própria versão leve" : "na simulação completa"}. Medianas: A 74×,
          C 73,5×, B 102×, D 108× a densidade média.</p>
        </div>
      </section>
      <section${disc || lab ? ' class="apagada"' : ""}>
        <h3>Resolução da cor${disc || lab ? " — incerteza e laboratório usam a completa" : ""}</h3>
        ${radio("resolucao", "completa", "Simulação completa", "padrão", c.cor.resolucao === "completa")}
        ${radio("resolucao", "versao", `Própria versão leve (${c.versao === "1_64" ? "1/64" : "1/8"})`, "", c.cor.resolucao === "versao")}
        <div class="ficha">
          ${c.cor.resolucao === "completa"
            ? `<p><b>Cor fiel, desenho leve.</b> Cada mancha leva a densidade que a SUA partícula tem na simulação
               inteira (16,8 milhões). Halos pequenos continuam visíveis pela cor, mesmo com poucas manchas.
               Perde: a cor pode ser mais "quente" do que o tamanho da mancha sugere (a mancha foi dimensionada pela versão leve).</p>`
            : `<p><b>Coerente com o desenho, sem os halos pequenos.</b> Densidade recalculada só com as manchas desta
               versão: combina com o tamanho de cada mancha. Perde: halos pequenos somem — um halo de 100 partículas
               vira ~12 manchas na 1/8 e ~1,6 na 1/64, e a densidade ali despenca.</p>`}
          <p class="nota">Medido (estimador A, 21/10): com a densidade da própria versão, ${c.versao === "1_64" ? "32" : "20"} % das
          manchas ficam 10 tons ou mais mais ESCURAS (densidade menor) que na completa; mediana igual. Na F2.2,
          densidade versão ÷ completa: ${c.versao === "1_64" ? "p5 0,002 · mediana 0,96 · p95 3,1" : "p5 0,04 · mediana 1,02 · p95 2,1"}.</p>
        </div>
      </section>
      <section${disc ? ' class="apagada"' : ""}>
        <h3>Paleta${disc ? " — a incerteza do método usa a coolwarm" : ""}</h3>
        ${Object.entries(PALETAS).map(([k, p]) => radio("paleta", k, p.nome, p.nota, k === c.cor.paleta)).join("")}
        <p class="nota">Matéria escura não emite luz: toda cor é convenção. A paleta não muda nenhum número.</p>
      </section>
      ${c.ocupado() ? `<p class="nota">Remontando a teia com a nova cor…</p>` : ""}`;
    document.getElementById("bt-fechar-filtros").addEventListener("click", () => alternar(false));
    const ligar = (nome, chave) => painel.querySelectorAll(`input[name=${nome}]`)
      .forEach((r) => r.addEventListener("change", () => c.trocarCor({ [chave]: r.value })));
    ligar("estimador", "estimador"); ligar("paleta", "paleta"); ligar("camada", "camada"); ligar("par", "par");
    ligar("resolucao", "resolucao");
    painel.querySelectorAll("select[name=labX], select[name=labY]")
      .forEach((s) => s.addEventListener("change", () => {
        // escolheu no X o que estava no Y (ou vice-versa): troca os dois de lugar
        const outro = s.name === "labX" ? "labY" : "labX";
        const mud = { [s.name]: s.value };
        if (s.value === c.cor[outro]) mud[outro] = c.cor[s.name];
        c.trocarCor(mud);
      }));
    const peso = painel.querySelector("input[name=labPeso]");
    if (peso) {
      // enquanto arrasta só mostra o número; remonta ao soltar (cada remontagem custa segundos)
      peso.addEventListener("input", () => {
        const s = peso.parentElement.querySelectorAll("span");
        s[0].textContent = `${100 - Number(peso.value)} %`; s[1].textContent = `${peso.value} %`;
      });
      peso.addEventListener("change", () => c.trocarCor({ labPeso: Number(peso.value) }));
    }
  }

  function alternar(mostrar = painel.hidden) {
    painel.hidden = !mostrar;
    const bt = document.getElementById("bt-filtros");
    if (bt) bt.setAttribute("aria-pressed", String(mostrar));
    if (mostrar) montar();
    return mostrar;
  }

  return { alternar, atualizar: () => { if (!painel.hidden) montar(); }, painel };
}
