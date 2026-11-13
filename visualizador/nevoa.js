/**
 * Dentro da Teia — névoa em volume (F3.17), FILTRO: liga com ?nevoa=1 (decisão do Victor, 17/10/2026)
 *
 * Ideia: as manchas maiores que uma célula da grade (σ ≥ Δ) são a "névoa" dos filamentos e vazios.
 * Uma grade 3D desenha algo desse tamanho sem perder detalhe, e custa o mesmo para a placa de vídeo
 * não importa quantas manchas caíram nela. As manchas menores que a célula (halos) continuam manchas.
 * Medido em 17/10 (grade 256³, Δ = 98 kpc/h): vão para a névoa 44 % das manchas da 1/64 (95 % da área
 * pintada), 19 % da 1/8 (78 %), 4 % da completa (36 %).
 *
 * FÍSICA (a mesma regra das manchas, só que contínua — exportar_ply.opacidades):
 *   mancha:  τ₀ = exposição · Σ₀ / ρ̄m,  Σ₀ = m / (2π σ²)  (massa projetada no centro), α = 1 − e^(−τ₀)
 *   volume:  dτ/dl = κ(x) = exposição · ρ(x) / ρ̄m,  ρ(x) = Σ manchas da névoa (gaussianas 3D de massa m)
 *   A integral de κ ao longo de uma linha pelo centro de UMA gaussiana dá exatamente o τ₀ da mancha
 *   (teste N1). Diferença honesta: o gerador de manchas limita α a [0,01; 0,99] (piso de 1 %); o
 *   volume não tem piso. Na 1/8 todas as manchas da névoa estavam no piso → no volume elas ficam
 *   com o brilho da física, mais fraco.
 *   Cor: cada mancha emite a sua cor (paleta magma da densidade, como no arquivo) na proporção da
 *   sua opacidade: ε = Σ κᵢ·corᵢ — a mesma mistura que o desenho de manchas faz (cor × α).
 *
 * ORDEM DE DESENHO (opção 1 escolhida pelo Victor): o Spark não deixa intercalar névoa e manchas
 * ponto a ponto. Então a névoa é desenhada em DUAS camadas, separadas por um plano perpendicular
 * à direção do olhar que passa pelo ponto de foco (alvo da câmera):
 *     névoa de trás → manchas (halos) → névoa da frente
 * Fiel no plano do foco. Um halo fora do plano recebe névoa de mais ou de menos: o brilho dele
 * erra no máximo por e^(τ) da névoa entre ele e o plano. O visualizador mostra essa estimativa
 * no raio central (erroCamadas).
 *
 * Integração no raio (como no exemplo oficial webgl_volume_cloud do three.js r180, com absorção
 * e emissão exatas por passo): a = 1 − e^(−κ·Δs); cor += T·(ε/κ)·a; T ← T·(1 − a).
 */
import * as THREE from "three";

// Constantes conferidas contra o Python em 17/10/2026 (e de novo, no navegador, pelo teste N3)
export const EXPOSICAO = 0.1;                 // exportar_ply.py (convenção visual, documentada lá)
export const RHO_M = 83260993401.35243;       // Ωm·ρcrit [M☉/h por (Mpc/h)³] = exportar_ply.RHO_M
// Corte da gaussiana. 1ª versão: esfera de 3σ renormalizada → os 2,9 % de massa de fora iam para
// dentro e engordavam o centro em 2,8 % (teste N1 pegou). Agora:
//   redonda: cubo de ±3σ POR EIXO, cada eixo renormalizado → perde-se 0,27 % por eixo, e o centro
//            fica ~0,5 % acima do exato (N1 confere, tolerância 1 %); 2,4× menos células que ±4σ
//   alongada: cubo de ±4σ com a forma completa (mais lenta; só no filtro de manchas alongadas)
const CORTE_REDONDA = 3;
const RAIO_NUCLEO = 4;

/** Grade de névoa: acumula κ e ε = Σ κ·cor, em células de lado Δ = L/N, caixa centrada na origem. */
export class GradeNevoa {
  constructor(n, lado) {
    this.n = n; this.lado = lado; this.delta = lado / n;
    // [εr, εg, εb, κ] lado a lado por célula (uma linha de memória por célula: o depósito
    // ficou mais rápido assim); vira a textura RGBA. Depois da textura sobra só κ (this.kappa).
    this.rgbk = new Float32Array(4 * n * n * n);
    this.kappa = null;
    this.manchas = 0;
  }

  /**
   * F3.21 (21/10/2026): grade já PRONTA (splats/nevoa_pre.py), em camadas: κ em meia precisão (Uint16Array,
   * N³) e a cor média ε/κ em RGBA de 1 byte (Uint8Array, 4·N³). Não aloca a acumulação nem refaz a conta.
   */
  static deCamadas(n, lado, kappaMeia, corRGBA8) {
    const g = Object.create(GradeNevoa.prototype);
    Object.assign(g, { n, lado, delta: lado / n, rgbk: null, kappa: null, kappaMeia, corRGBA8, manchas: 0 });
    return g;
  }

  /** κ da célula idx, venha de onde vier (acumulação, κ guardado ou grade pronta em meia precisão). */
  kappaCelula(idx) {
    if (this.kappa) return this.kappa[idx];
    if (this.rgbk) return this.rgbk[4 * idx + 3];
    return THREE.DataUtils.fromHalfFloat(this.kappaMeia[idx]);
  }

  /** true se a mancha (desvios s em Mpc/h) cabe na grade sem perder detalhe: menor eixo ≥ Δ. */
  vaiParaNevoa(sx, sy, sz) { return Math.min(sx, sy, sz) >= this.delta; }

  /**
   * Deposita uma gaussiana 3D (centro c, desvios s, rotação q = THREE.Quaternion, massa m [M☉/h],
   * cor rgb 0–1) num cubo de ±4σ. Pesos renormalizados para a soma ser a massa inteira, contando
   * também a parte que cai fora da caixa (essa se perde, como no desenho de manchas, que também não
   * dá a volta na caixa).
   * Mancha redonda: a gaussiana se separa por eixo (peso = wx·wy·wz), conta rápida. Alongada:
   * forma quadrática completa, mais lenta (só no filtro de manchas alongadas).
   */
  depositar(c, s, q, m, cor) {
    const { n, delta, lado } = this;
    const redonda = Math.abs(s.x - s.y) < 1e-3 * s.x && Math.abs(s.x - s.z) < 1e-3 * s.x;
    const smax = Math.max(s.x, s.y, s.z);
    const r = Math.ceil((redonda ? CORTE_REDONDA : RAIO_NUCLEO) * smax / delta);
    const lado2 = 2 * r + 1;
    const i0 = [c.x, c.y, c.z].map((v) => Math.floor((v + lado / 2) / delta) - r);  // 1º índice do cubo
    const centroCelula = (i) => (i + 0.5) * delta - lado / 2;
    const fora = (i) => i < 0 || i >= n;
    let soma;
    let pesoEm; // (a, b, c) índices locais no cubo → peso
    if (redonda) {
      const inv = 1 / (2 * s.x * s.x);
      const w = [c.x, c.y, c.z].map((v, e) => {
        const arr = new Float64Array(lado2);
        for (let k = 0; k < lado2; k++) { const d = centroCelula(i0[e] + k) - v; arr[k] = Math.exp(-d * d * inv); }
        return arr;
      });
      const somaEixo = w.map((arr) => arr.reduce((x, y) => x + y, 0));
      soma = somaEixo[0] * somaEixo[1] * somaEixo[2];
      pesoEm = (a, b2, c2) => w[0][a] * w[1][b2] * w[2][c2];
      pesoEm.w = w;
    } else {
      const R = new THREE.Matrix4().makeRotationFromQuaternion(q).elements; // coluna k = eixo k da mancha
      const inv = [1 / (s.x * s.x), 1 / (s.y * s.y), 1 / (s.z * s.z)];
      const M = new Float64Array(9); // M = R diag(1/s²) Rᵀ (inversa da covariância)
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) {
        M[3 * x + y] = R[x] * R[y] * inv[0] + R[4 + x] * R[4 + y] * inv[1] + R[8 + x] * R[8 + y] * inv[2];
      }
      const pesos = new Float64Array(lado2 * lado2 * lado2);
      soma = 0;
      for (let cz = 0; cz < lado2; cz++) {
        const dz = centroCelula(i0[2] + cz) - c.z;
        for (let cy = 0; cy < lado2; cy++) {
          const dy = centroCelula(i0[1] + cy) - c.y;
          for (let cx = 0; cx < lado2; cx++) {
            const dx = centroCelula(i0[0] + cx) - c.x;
            const q2 = dx * (M[0] * dx + M[1] * dy + M[2] * dz) + dy * (M[3] * dx + M[4] * dy + M[5] * dz) +
                       dz * (M[6] * dx + M[7] * dy + M[8] * dz);
            const w = q2 > 2 * RAIO_NUCLEO * RAIO_NUCLEO ? 0 : Math.exp(-0.5 * q2);
            pesos[cx + lado2 * (cy + lado2 * cz)] = w; soma += w;
          }
        }
      }
      pesoEm = (a, b2, c2) => pesos[a + lado2 * (b2 + lado2 * c2)];
    }
    if (!(soma > 0)) return;
    if (redonda) { this.depositarSeparavel(i0, lado2, pesoEm.w, soma, m, cor); this.manchas++; return; }
    // κ integrado no volume = exposição · m / ρ̄m  [(Mpc/h)²]; por célula: × peso / soma / volume
    const k0 = EXPOSICAO * m / RHO_M / (soma * delta * delta * delta);
    const { rgbk } = this;
    for (let cz = 0; cz < lado2; cz++) {
      const iz = i0[2] + cz; if (fora(iz)) continue;
      for (let cy = 0; cy < lado2; cy++) {
        const iy = i0[1] + cy; if (fora(iy)) continue;
        const base = n * (iy + n * iz);
        for (let cx = 0; cx < lado2; cx++) {
          const ix = i0[0] + cx; if (fora(ix)) continue;
          const k = k0 * pesoEm(cx, cy, cz);
          if (k === 0) continue;
          const idx = ix + base;
          const e = 4 * idx;
          rgbk[e] += k * cor.r; rgbk[e + 1] += k * cor.g; rgbk[e + 2] += k * cor.b; rgbk[e + 3] += k;
        }
      }
    }
    this.manchas++;
  }

  /** Depósito da gaussiana redonda: peso = wx·wy·wz, laço sem chamadas (é aqui que vai o tempo). */
  depositarSeparavel(i0, lado2, w, soma, m, cor) {
    const { n, delta, rgbk } = this;
    const k0 = EXPOSICAO * m / RHO_M / (soma * delta * delta * delta);
    const [wx, wy, wz] = w;
    const ax = Math.max(0, -i0[0]), bx = Math.min(lado2, n - i0[0]);
    const ay = Math.max(0, -i0[1]), by = Math.min(lado2, n - i0[1]);
    const az = Math.max(0, -i0[2]), bz = Math.min(lado2, n - i0[2]);
    const cr = cor.r, cg = cor.g, cb = cor.b;
    for (let cz = az; cz < bz; cz++) {
      const kz = k0 * wz[cz], baseZ = n * n * (i0[2] + cz);
      for (let cy = ay; cy < by; cy++) {
        const kyz = kz * wy[cy];
        let idx = baseZ + n * (i0[1] + cy) + i0[0] + ax;
        for (let cx = ax; cx < bx; cx++, idx++) {
          const k = kyz * wx[cx];
          const e = 4 * idx;
          rgbk[e] += k * cr; rgbk[e + 1] += k * cg; rgbk[e + 2] += k * cb; rgbk[e + 3] += k;
        }
      }
    }
  }

  /** F3.21: a cor média da grade pronta como textura RGBA de 1 byte (null no caminho antigo). */
  texturaCor() {
    if (!this.corRGBA8) return null;
    const t = new THREE.Data3DTexture(this.corRGBA8, this.n, this.n, this.n);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  }

  /** κ por interpolação trilinear no ponto p (Mpc/h), igual à textura com filtro linear. */
  kappaEm(p) {
    const { n, delta, lado } = this;
    const f = (v) => (v + lado / 2) / delta - 0.5;
    const x = f(p.x), y = f(p.y), z = f(p.z);
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    let soma = 0;
    for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const ix = Math.min(n - 1, Math.max(0, x0 + dx)), iy = Math.min(n - 1, Math.max(0, y0 + dy)),
            iz = Math.min(n - 1, Math.max(0, z0 + dz));
      const w = (dx ? x - x0 : 1 - (x - x0)) * (dy ? y - y0 : 1 - (y - y0)) * (dz ? z - z0 : 1 - (z - z0));
      soma += w * this.kappaCelula(ix + n * (iy + n * iz));
    }
    return soma;
  }

  /** Profundidade óptica ∫κ dl de a até b (Mpc/h), em passos de Δ/4 (regra do ponto médio). */
  tauEntre(a, b) {
    const comp = a.distanceTo(b);
    const passos = Math.max(1, Math.ceil(comp / (this.delta / 4)));
    const p = new THREE.Vector3(), ds = comp / passos;
    let tau = 0;
    for (let i = 0; i < passos; i++) tau += this.kappaEm(p.lerpVectors(a, b, (i + 0.5) / passos)) * ds;
    return tau;
  }

  /** Textura 3D RGBA meia-precisão: rgb = ε = Σκ·cor, a = κ. Libera a memória de acumulação. */
  textura() {
    const { n } = this, total = n * n * n;
    if (this.kappaMeia) {   // F3.21: grade pronta — κ (1 canal, meia precisão) vai direto para a placa
      const t = new THREE.Data3DTexture(this.kappaMeia, n, n, n);
      t.format = THREE.RedFormat; t.type = THREE.HalfFloatType;
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = 1; t.needsUpdate = true;
      return t;
    }
    const dados = new Uint16Array(4 * total);
    const meia = THREE.DataUtils.toHalfFloat, { rgbk } = this;
    this.kappa = new Float32Array(total); // κ fica para a estimativa de erro das camadas
    for (let i = 0; i < 4 * total; i++) dados[i] = meia(rgbk[i]);
    for (let i = 0; i < total; i++) this.kappa[i] = rgbk[4 * i + 3];
    this.rgbk = null;
    const t = new THREE.Data3DTexture(dados, n, n, n);
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType;
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  }
}

const VERTICE = /* glsl */`
  in vec3 position;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform vec3 cameraPos;
  out vec3 vOrigem;
  out vec3 vDirecao;
  void main() {
    vOrigem = cameraPos;                 // a caixa não tem transformação: objeto = mundo
    vDirecao = position - cameraPos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENTO = /* glsl */`
  precision highp float;
  precision highp sampler3D;
  in vec3 vOrigem;
  in vec3 vDirecao;
  out vec4 saida;
  uniform sampler3D mapa;
  uniform sampler3D corTex;   // F3.21: cor média separada (modoCor = 1); no caminho antigo não é usada
  uniform int modoCor;        // 0: mapa = (ε, κ) em RGBA · 1: mapa.r = κ e corTex.rgb = cor média ε/κ
  uniform float meioLado;     // L/2
  uniform float passo;        // Δs [Mpc/h]
  uniform vec3 olhar;         // direção do olhar (unitária)
  uniform float dPlano;       // distância do plano de corte ao longo do olhar (= distância ao alvo)
  uniform int camada;         // 0 = de trás do plano, 1 = da frente
  uniform float quadro;

  uint hashWang(uint s) {     // mesmo sorteio do exemplo oficial (desfaz faixas no degrau)
    s = (s ^ 61u) ^ (s >> 16u); s *= 9u; s = s ^ (s >> 4u); s *= 0x27d4eb2du; s = s ^ (s >> 15u); return s;
  }
  vec2 cruzaCaixa(vec3 o, vec3 d) {
    vec3 inv = 1.0 / d;
    vec3 t0 = (vec3(-meioLado) - o) * inv, t1 = (vec3(meioLado) - o) * inv;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    return vec2(max(tmin.x, max(tmin.y, tmin.z)), min(tmax.x, min(tmax.y, tmax.z)));
  }
  void main() {
    vec3 d = normalize(vDirecao);
    vec2 b = cruzaCaixa(vOrigem, d);
    b.x = max(b.x, 0.0);
    float cosOlhar = dot(d, olhar);
    float tPlano = cosOlhar > 1e-4 ? dPlano / cosOlhar : 1e30;
    if (camada == 0) b.x = max(b.x, tPlano); else b.y = min(b.y, tPlano);
    if (b.x >= b.y) discard;
    uint semente = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(quadro) * 26699u;
    float t = b.x + passo * (float(hashWang(semente)) / 4294967296.0);
    vec3 cor = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < 4096; i++) {
      if (t >= b.y || T < 0.004) break;
      float ds = min(passo, b.y - t);
      vec3 uvw = (vOrigem + (t + 0.5 * ds) * d) / (2.0 * meioLado) + 0.5;
      vec4 v = texture(mapa, uvw);
      float k = modoCor == 1 ? v.r : v.a;
      if (k > 0.0) {
        float a = 1.0 - exp(-k * ds);
        vec3 c = modoCor == 1 ? texture(corTex, uvw).rgb : v.rgb / k;
        cor += T * c * a;
        T *= 1.0 - a;
      }
      t += ds;
    }
    if (T > 0.999) discard;
    saida = vec4(cor, 1.0 - T);   // pré-multiplicada
  }
`;

/**
 * As duas camadas (de trás e da frente). Ordem de desenho via renderOrder: trás (−10) →
 * manchas do Spark (0) → frente (+10). Mistura pré-multiplicada (cor + (1 − α)·fundo).
 */
const VERTICE_TELA = /* glsl */`
  in vec3 position;
  in vec2 uv;
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const FRAGMENTO_TELA = /* glsl */`
  precision highp float;
  in vec2 vUv;
  out vec4 saida;
  uniform sampler2D imagem;
  void main() { saida = texture(imagem, vUv); }   // já pré-multiplicada
`;

/**
 * As duas camadas de névoa.
 *  Sem opções: as caixas vão direto para a cena (resolução da tela).
 *  { escalaAlvo: 0.5 } (padrão do app, correção de 17/10/2026): cada camada é desenhada FORA da
 *  tela, numa imagem de meia resolução FIXA (não muda quando a câmera para), e esticada por cima.
 *  Não perde detalhe: o menor detalhe da névoa é a célula da grade (98 kpc/h), lisa por construção.
 *  Motivo: medição do Victor (1/8 + névoa): girando 38/61/60 (fluido), mas PARADO 20/6/19 e
 *  engasgos de 5–9 QPS — a névoa voltava à resolução total quando a câmera parava.
 *  Nesse modo, chamar renderizar(renderer, camera) antes de cada renderer.render(cena).
 */
const TEXTURA_VAZIA = (() => {   // corTex precisa de algo ligado mesmo no caminho antigo
  const t = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.needsUpdate = true;
  return t;
})();

export function criarCamadas(textura, lado, passoMpc, { escalaAlvo = null, corTextura = null } = {}) {
  const geo = new THREE.BoxGeometry(lado, lado, lado);
  const camadas = [0, 1].map((camada) => {
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERTICE, fragmentShader: FRAGMENTO,
      uniforms: {
        mapa: { value: textura }, meioLado: { value: lado / 2 }, passo: { value: passoMpc },
        corTex: { value: corTextura ?? TEXTURA_VAZIA }, modoCor: { value: corTextura ? 1 : 0 },
        cameraPos: { value: new THREE.Vector3() }, olhar: { value: new THREE.Vector3(0, 0, -1) },
        dPlano: { value: 1 }, camada: { value: camada }, quadro: { value: 0 },
      },
      side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const malha = new THREE.Mesh(geo, mat);
    malha.renderOrder = camada === 0 ? -10 : 10;
    malha.frustumCulled = false;
    return malha;
  });
  /** Atualiza câmera, direção do olhar e plano de corte (passa pelo alvo). Chamar a cada quadro. */
  function atualizar(camera, alvo) {
    const olhar = new THREE.Vector3();
    camera.getWorldDirection(olhar);
    const dPlano = Math.max(0, alvo.clone().sub(camera.position).dot(olhar));
    for (const m of camadas) {
      const u = m.material.uniforms;
      u.cameraPos.value.copy(camera.position); u.olhar.value.copy(olhar); u.dPlano.value = dPlano;
      u.quadro.value = (u.quadro.value + 1) % 100000;
    }
  }
  /**
   * Ajustes em tempo de execução (roteiro de diagnóstico ?medir=nevoa).
   * passo em Mpc/h. Conferido em 17/10 (pior caso σ = 1 célula, início sorteado): passo de 1 célula
   * erro 0 %; 2 células erro médio 0,03 %, pior pixel 1,1 %; 3 células pior pixel 20 % → máximo 2.
   */
  const estado = { escala: escalaAlvo, visivel: true };
  function configurar({ passo, escala, visivel } = {}) {
    if (passo !== undefined) for (const m of camadas) m.material.uniforms.passo.value = passo;
    if (escala !== undefined) estado.escala = escala;
    if (visivel !== undefined) estado.visivel = visivel;
  }
  /** Libera a memória da placa de vídeo (troca de cor do F3.7 remonta tudo). */
  const descartarCaixas = () => {
    geo.dispose(); for (const m of camadas) m.material.dispose(); textura.dispose();
    if (corTextura) corTextura.dispose();
  };
  if (!escalaAlvo) {
    return { tras: camadas[0], frente: camadas[1], atualizar, renderizar: () => {
      camadas[0].visible = camadas[1].visible = estado.visivel; }, configurar, descartar: descartarCaixas };
  }

  // Modo fora da tela: cada caixa numa cena própria → imagem → retângulo na tela, mesma ordem.
  const cenas = camadas.map((m) => { const c = new THREE.Scene(); c.add(m); return c; });
  const alvos = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  }));
  const geoTela = new THREE.PlaneGeometry(2, 2);
  const telas = alvos.map((alvo, k) => {
    const q = new THREE.Mesh(geoTela, new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERTICE_TELA, fragmentShader: FRAGMENTO_TELA,
      uniforms: { imagem: { value: alvo.texture } },
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    q.renderOrder = k === 0 ? -10 : 10;
    q.frustumCulled = false;
    return q;
  });
  const tamanho = new THREE.Vector2(), corFundo = new THREE.Color();
  /** Desenha as duas camadas nas imagens fora da tela (tamanho = janela × escalaAlvo, fixo). */
  function renderizar(renderer, camera) {
    telas[0].visible = telas[1].visible = estado.visivel;
    if (!estado.visivel) return;
    renderer.getSize(tamanho);
    const w = Math.max(1, Math.round(tamanho.x * window.devicePixelRatio * estado.escala));
    const h = Math.max(1, Math.round(tamanho.y * window.devicePixelRatio * estado.escala));
    const anterior = renderer.getRenderTarget();
    renderer.getClearColor(corFundo);
    const alfaFundo = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);   // fundo transparente: a imagem guarda só a névoa
    for (let k = 0; k < 2; k++) {
      if (alvos[k].width !== w || alvos[k].height !== h) alvos[k].setSize(w, h);
      renderer.setRenderTarget(alvos[k]);
      renderer.clear();
      renderer.render(cenas[k], camera);
    }
    renderer.setRenderTarget(anterior);
    renderer.setClearColor(corFundo, alfaFundo);
  }
  function descartar() {
    descartarCaixas(); geoTela.dispose();
    for (const q of telas) q.material.dispose();
    for (const a of alvos) a.dispose();
  }
  return { tras: telas[0], frente: telas[1], atualizar, renderizar, configurar, descartar, alvos };
}

/**
 * Estimativa do erro da ordem em camadas, no raio central: τ da névoa entre a câmera e o plano
 * (frente) e entre o plano e a saída da caixa (trás). Um halo fora do plano pode ter o brilho
 * errado em até e^(máximo dos dois). Devolve { tauFrente, tauTras, fatorMax }.
 */
export function erroCamadas(grade, camera, alvo) {
  const olhar = new THREE.Vector3();
  camera.getWorldDirection(olhar);
  const m = grade.lado / 2;
  const o = camera.position, inv = new THREE.Vector3(1 / olhar.x, 1 / olhar.y, 1 / olhar.z);
  const t0 = new THREE.Vector3((-m - o.x) * inv.x, (-m - o.y) * inv.y, (-m - o.z) * inv.z);
  const t1 = new THREE.Vector3((m - o.x) * inv.x, (m - o.y) * inv.y, (m - o.z) * inv.z);
  const entra = Math.max(0, Math.min(t0.x, t1.x), Math.min(t0.y, t1.y), Math.min(t0.z, t1.z));
  const sai = Math.min(Math.max(t0.x, t1.x), Math.max(t0.y, t1.y), Math.max(t0.z, t1.z));
  if (!(sai > entra)) return { tauFrente: 0, tauTras: 0, fatorMax: 1 };
  const tPlano = Math.min(sai, Math.max(entra, alvo.clone().sub(o).dot(olhar)));
  const ponto = (t) => o.clone().addScaledVector(olhar, t);
  const tauFrente = grade.tauEntre(ponto(entra), ponto(tPlano));
  const tauTras = grade.tauEntre(ponto(tPlano), ponto(sai));
  return { tauFrente, tauTras, fatorMax: Math.exp(Math.max(tauFrente, tauTras)) };
}

/**
 * Testes de resposta conhecida da grade (rodam na CPU, sem placa de vídeo):
 *   N1 uma gaussiana: ∫κ dl pelo centro = τ₀ = exposição · m / (2π σ² ρ̄m) — a regra das manchas
 *   N2 massa conservada: Σ κ · Δ³ = exposição · m / ρ̄m (gaussiana inteira dentro da caixa)
 *   N3 (feito no app, com o arquivo): α do arquivo = 1 − e^(−τ₀) para manchas fora do piso —
 *      confere de ponta a ponta que RHO_M, exposição e massa do .json batem com o gerador
 */
export function testesGrade() {
  const g = new GradeNevoa(64, 25), sigma = 3 * g.delta, m = 1e12;
  const centro = new THREE.Vector3(0.5 * g.delta, 0.5 * g.delta, 0.5 * g.delta); // centro de célula
  g.depositar(centro, new THREE.Vector3(sigma, sigma, sigma), new THREE.Quaternion(), m, { r: 1, g: 1, b: 1 });
  const tau0 = EXPOSICAO * m / (2 * Math.PI * sigma * sigma * RHO_M);
  const tau = g.tauEntre(centro.clone().setX(-12.5), centro.clone().setX(12.5));
  const somaK = (gr) => { let s = 0; for (let i = 3; i < gr.rgbk.length; i += 4) s += gr.rgbk[i]; return s; };
  const massa = somaK(g) * g.delta ** 3, massa0 = EXPOSICAO * m / RHO_M;
  // alongada girada: a massa continua conservada
  const g2 = new GradeNevoa(64, 25);
  g2.depositar(centro, new THREE.Vector3(2 * sigma, sigma, 0.7 * sigma),
               new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.9, -0.3)), m, { r: 1, g: 1, b: 1 });
  const massa2 = somaK(g2) * g2.delta ** 3;
  return [
    { nome: "N1 névoa: ∫κ pelo centro = τ₀ da mancha", passou: Math.abs(tau / tau0 - 1) < 0.01,
      detalhe: `razão ${(tau / tau0).toFixed(4)} (esperado ~1,005 pelo corte em ±3σ; tolerância 1 %)` },
    { nome: "N2 névoa: massa conservada (redonda e alongada)",
      passou: Math.abs(massa / massa0 - 1) < 1e-4 && Math.abs(massa2 / massa0 - 1) < 1e-4,
      detalhe: `razões ${(massa / massa0).toFixed(6)} e ${(massa2 / massa0).toFixed(6)}` },
  ];
}
