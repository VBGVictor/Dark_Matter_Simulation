/**
 * Dentro da Teia — voo livre, o "nado" (F3.2, 28/10/2026). Botão ✈ ou tecla N.
 *
 * Critério do backlog: "atravessar a caixa de ponta a ponta", com velocidade ajustável.
 * Controles (como em jogos em primeira pessoa):
 *   W / ↑  frente     S / ↓  trás     A / ←  esquerda     D / →  direita     Espaço  sobe     Shift  desce
 *   arrastar  vira a cabeça          roda do mouse  velocidade (× 1,25 por clique)          Esc ou N  sai
 * Inércia (o "nado"): a velocidade real persegue a pedida com constante de tempo INERCIA_S (exata para qualquer passo de
 * tempo: v ← alvo + (v − alvo)·e^(−dt/τ)) — CONVENÇÃO visual, para o movimento não ser duro.
 * Caixa periódica (como no passeio da F3.20): ao passar por uma parede a câmera reaparece do lado oposto, com aviso.
 * Começando de FORA do cubo (a vista inicial fica fora), voa-se livre até entrar; só depois as paredes dão a volta
 * (a 1ª versão dobrava a câmera para dentro na hora: um salto, contado como parede — achado a olho em 28/10).
 * O foco (plano da névoa e da régua) fica FOCO à frente da câmera.
 * Nenhum dado novo: é só câmera.
 */
import * as THREE from "three";

const VELOCIDADE_PADRAO = 1.0;      // Mpc/h por segundo (≈ 4,9 milhões de anos-luz/s): a caixa (25 Mpc/h) em 25 s
const VELOCIDADE_MIN = 0.05, VELOCIDADE_MAX = 10;
const FATOR_RODA = 1.25;
const INERCIA_S = 0.3;              // constante de tempo do "nado" (CONVENÇÃO visual)
const FOCO = 1.0;                   // Mpc/h à frente
const SENSIBILIDADE = 0.004;        // radianos por pixel de arrasto
const PITCH_MAX = THREE.MathUtils.degToRad(85);
const PASSO_MAX_S = 0.5;            // contra saltos de aba escondida
const CIMA = new THREE.Vector3(0, 1, 0);
const TECLAS = {
  frente: ["KeyW", "ArrowUp"], tras: ["KeyS", "ArrowDown"], esquerda: ["KeyA", "ArrowLeft"],
  direita: ["KeyD", "ArrowRight"], sobe: ["Space"], desce: ["ShiftLeft", "ShiftRight"],
};

export function criarVooLivre(c) {
  // c = { camera, controls, renderer, ladoCaixa, avisar, textoAnosLuz, anosLuzPorMpcH, aoMexer, aoEntrar: () => void }
  const L = c.ladoCaixa;
  const hud = Object.assign(document.createElement("div"), { id: "hud-voo", hidden: true });
  document.body.appendChild(hud);
  let voo = null;   // { yaw, pitch, vel: Vector3, percorrido, paredes, ultimo }
  let velocidade = VELOCIDADE_PADRAO;
  const apertadas = new Set();

  /** Direção do olhar a partir de yaw (em volta do eixo vertical) e pitch (para cima/baixo). */
  const direcao = (yaw, pitch) => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

  function entrar() {
    if (voo) return true;
    c.aoEntrar();                                      // para giro, passeio e animações
    const d = c.controls.target.clone().sub(c.camera.position).normalize();
    voo = { yaw: Math.atan2(d.x, -d.z), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), vel: new THREE.Vector3(),
            percorrido: 0, paredes: 0, ultimo: null, dentro: dentroDaCaixa(c.camera.position) };
    voo.pitch = THREE.MathUtils.clamp(voo.pitch, -PITCH_MAX, PITCH_MAX);
    c.controls.enabled = false;
    apertadas.clear();
    hud.hidden = false;
    aplicar();
    atualizarHud();
    const bt = document.getElementById("bt-voo");
    if (bt) bt.setAttribute("aria-pressed", "true");
    return true;
  }

  function sair() {
    if (!voo) return;
    voo = null;
    apertadas.clear();
    c.controls.enabled = true;
    hud.hidden = true;
    const bt = document.getElementById("bt-voo");
    if (bt) bt.setAttribute("aria-pressed", "false");
  }

  const alternar = () => (voo ? (sair(), false) : entrar());

  const dentroDaCaixa = (p) => Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) <= L / 2;

  /** Posiciona o foco à frente da câmera e, depois que ela já entrou no cubo, dobra nas paredes (periódicas). */
  function aplicar() {
    const p = c.camera.position;
    let cruzou = false;
    if (!voo.dentro) voo.dentro = dentroDaCaixa(p);
    if (voo.dentro) for (const e of ["x", "y", "z"]) {
      const desloc = -L * Math.floor((p[e] + L / 2) / L);
      if (desloc !== 0) { p[e] += desloc; cruzou = true; }
    }
    if (cruzou) {
      voo.paredes++;
      c.avisar("Você atravessou uma parede do cubo e voltou pelo lado oposto: a simulação é <b>periódica</b> — o que sai " +
               "de um lado entra pelo outro. A teia continua.", 4000);
    }
    c.controls.target.copy(p).addScaledVector(direcao(voo.yaw, voo.pitch), FOCO);
    c.camera.lookAt(c.controls.target);
  }

  /** Vira a cabeça (radianos). */
  function olhar(dYaw, dPitch) {
    if (!voo) return;
    voo.yaw += dYaw;
    voo.pitch = THREE.MathUtils.clamp(voo.pitch + dPitch, -PITCH_MAX, PITCH_MAX);
    aplicar();
  }

  function mudarVelocidade(fator) {
    velocidade = THREE.MathUtils.clamp(velocidade * fator, VELOCIDADE_MIN, VELOCIDADE_MAX);
    atualizarHud();
    return velocidade;
  }

  /** Velocidade pedida pelas teclas apertadas (Mpc/h/s, coordenadas do mundo). */
  function pedida() {
    const frente = direcao(voo.yaw, voo.pitch);
    const lado = new THREE.Vector3(Math.cos(voo.yaw), 0, Math.sin(voo.yaw));   // direita, sempre na horizontal
    const v = new THREE.Vector3();
    const tem = (n) => TECLAS[n].some((k) => apertadas.has(k));
    if (tem("frente")) v.add(frente);
    if (tem("tras")) v.sub(frente);
    if (tem("direita")) v.add(lado);
    if (tem("esquerda")) v.sub(lado);
    if (tem("sobe")) v.add(CIMA);
    if (tem("desce")) v.sub(CIMA);
    return v.lengthSq() > 0 ? v.normalize().multiplyScalar(velocidade) : v;
  }

  /** Chamar a cada quadro (agora em ms). Separado do laço para os testes simularem o tempo. */
  function quadro(agora) {
    if (!voo) return;
    const dt = voo.ultimo === null ? 0 : Math.min(PASSO_MAX_S, (agora - voo.ultimo) / 1000);
    voo.ultimo = agora;
    if (dt <= 0) return;
    const alvo = pedida(), k = Math.exp(-dt / INERCIA_S);
    // posição exata para velocidade que relaxa exponencialmente: Δx = alvo·dt + (v0 − alvo)·τ·(1 − e^(−dt/τ))
    const desloc = alvo.clone().multiplyScalar(dt).addScaledVector(voo.vel.clone().sub(alvo), INERCIA_S * (1 - k));
    voo.vel.sub(alvo).multiplyScalar(k).add(alvo);
    if (desloc.lengthSq() < 1e-16) return;
    c.camera.position.add(desloc);
    voo.percorrido += desloc.length();
    aplicar();
    c.aoMexer();
    atualizarHud();
  }

  function atualizarHud() {
    if (!voo) return;
    const al = (mpch) => c.textoAnosLuz(mpch * c.anosLuzPorMpcH);
    hud.innerHTML = `<b>Voo livre</b> · velocidade ${al(velocidade)}/s · percorrido ${al(voo.percorrido)} · paredes: ${voo.paredes}` +
      `<br><small>W A S D ou setas: andar · Espaço/Shift: subir/descer · arrastar: olhar · roda: velocidade · Esc ou N: sair</small>`;
  }

  // teclado: só enquanto voa, e nunca dentro de campos de texto
  const emCampo = (e) => e.target.closest && e.target.closest("input, textarea, select");
  window.addEventListener("keydown", (e) => {
    if (!voo || emCampo(e)) return;
    if (e.key === "Escape") { sair(); return; }
    if (Object.values(TECLAS).some((ks) => ks.includes(e.code))) { apertadas.add(e.code); e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => { apertadas.delete(e.code); });
  window.addEventListener("blur", () => apertadas.clear());   // trocou de janela com tecla apertada: não sai voando

  // mouse: arrastar vira a cabeça; roda muda a velocidade
  const tela = c.renderer.domElement;
  let arrasto = null;
  tela.addEventListener("pointerdown", (e) => { if (voo) arrasto = { x: e.clientX, y: e.clientY }; });
  window.addEventListener("pointermove", (e) => {
    if (!arrasto || !voo) return;
    olhar((e.clientX - arrasto.x) * SENSIBILIDADE, -(e.clientY - arrasto.y) * SENSIBILIDADE);
    arrasto = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointerup", () => { arrasto = null; });
  tela.addEventListener("wheel", (e) => { if (voo) { e.preventDefault(); mudarVelocidade(e.deltaY < 0 ? FATOR_RODA : 1 / FATOR_RODA); } },
                        { passive: false });

  return { entrar, sair, alternar, quadro, olhar, mudarVelocidade, ativo: () => !!voo,
           estado: () => (voo ? { ...voo, vel: voo.vel.clone() } : null), direcao,
           apertar: (code, sim = true) => (sim ? apertadas.add(code) : apertadas.delete(code)),
           velocidade: (v) => { if (v !== undefined) velocidade = v; return velocidade; },
           INERCIA_S, VELOCIDADE_MAX };
}
