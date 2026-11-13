/**
 * Dentro da Teia — tela de introdução (F3.5, pedido do Victor em 02/11/2026: "uma tela de introdução [...] explica um
 * pouco o que é e como funciona, bem breve, sem muito texto" — e com a animação da supernova, que só aparecia ao trocar
 * de universo). Texto: versão curta do rascunho da F3.5 (seção 5 do RESUMO_PARA_ENTENDER.md), sem números que
 * mudam rápido.
 *
 * Aparece por cima enquanto a teia carrega (a supernova é ilustração, dito na tela); quando a teia fica pronta, o botão
 * "Entrar na teia" acende. Enter também entra. Não aparece com ?testes, ?medir ou ?intro=0 (roteiros automáticos).
 * "Não mostrar na próxima vez" fica no armazenamento local do navegador (se ele bloquear, a tela volta a aparecer).
 */
const CHAVE = "dentro_da_teia_pular_intro";
const SUPERNOVA = `<div class="supernova" aria-hidden="true"><i></i><i></i><i></i><b></b></div>`;

export function criarIntro(params) {
  let pular = false;
  try { pular = localStorage.getItem(CHAVE) === "1"; } catch (_) { /* sem armazenamento: mostra */ }
  if (params.has("testes") || params.has("medir") || params.get("intro") === "0" || pular) {
    return { pronta: () => {}, erro: () => {}, visivel: () => false };
  }
  const el = Object.assign(document.createElement("section"), { id: "intro" });
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Introdução");
  el.innerHTML = `<div class="cartao-intro">
      ${SUPERNOVA}
      <h1>Dentro da Teia</h1>
      <p class="sub">A matéria escura de um pedaço do universo, hoje.</p>
      <p>Um cubo de <b>121 milhões de anos-luz</b> calculado por cientistas (simulação CAMELS) com a teoria mais aceita
      da cosmologia. <b>Não é foto</b>: matéria escura não aparece em foto. O que você vê é a gravidade dela, calculada,
      formando a teia de aglomerados, filamentos e vazios.</p>
      <ul class="comandos">
        <li><kbd>arrastar</kbd> girar</li><li><kbd>roda</kbd> aproximar</li>
        <li><kbd>V</kbd> passeio pela teia</li><li><kbd>N</kbd> voo livre</li>
        <li><kbd>T</kbd> a teia se formando</li><li><kbd>M</kbd> aglomerados</li>
        <li><kbd>F</kbd> filtros</li><li><kbd>I</kbd> mais informações</li>
      </ul>
      <button id="bt-entrar" disabled>Carregando a teia…</button>
      <label class="pular"><input type="checkbox" id="ck-pular-intro"> não mostrar na próxima vez</label>
      <p class="nota">A explosão é só ilustração enquanto carrega.</p>
    </div>`;
  document.body.appendChild(el);
  const bt = el.querySelector("#bt-entrar");
  let pronto = false;

  function entrar() {
    if (!pronto) return;
    try {
      if (el.querySelector("#ck-pular-intro").checked) localStorage.setItem(CHAVE, "1");
    } catch (_) { /* sem armazenamento */ }
    el.classList.add("saindo");
    setTimeout(() => el.remove(), 400);
    window.removeEventListener("keydown", tecla);
  }
  function tecla(e) { if (e.key === "Enter" && pronto) { e.preventDefault(); entrar(); } }
  bt.addEventListener("click", entrar);
  window.addEventListener("keydown", tecla);

  return {
    /** A teia terminou de carregar: acende o botão. */
    pronta() { pronto = true; bt.disabled = false; bt.textContent = "Entrar na teia"; bt.focus(); },
    /** A teia não carregou: diz o motivo no lugar do botão. */
    erro(texto) { bt.textContent = texto; bt.disabled = true; },
    visivel: () => document.body.contains(el),
  };
}
