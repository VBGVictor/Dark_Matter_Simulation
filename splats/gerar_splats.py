"""
gerar_splats.py — F2.1 do backlog
=================================

Para cada partícula da simulação calcula:
  h_i   "raio de alisamento": distância até o 33º vizinho mais próximo (contando ela mesma)
  ρ_i   densidade local, por TRÊS estimadores (o visualizador vai poder alternar entre eles):
          A  kNN de Casertano & Hut (1985), apêndice A:  ρ = (j−1)·m / (4/3 π r_j³),
             com j = 32 (vizinhos SEM contar a própria) → fator 31.  ← PADRÃO
          C  SPH do GADGET sem a contribuição da própria partícula
          B  SPH do GADGET original (eq. 5)
          D  Wendland C2 + correção de Dehnen & Aly (2012), eq. 18–19
        Todos ficam disponíveis como filtro; A é o padrão.
  σ_i   desvio-padrão da gaussiana 3D (o splat) com o mesmo espalhamento do kernel

Por que três (decisão do Victor, 14/10/2026, depois dos testes de resposta conhecida):
  A e C acertam onde as partículas estão desordenadas (halos, filamentos): T2 e T3 ✅.
  B acerta numa grade perfeita (T1 ✅) mas superestima ~35 % dentro dos halos (T2/T3 ❌).
  A correção publicada para B (Dehnen & Aly 2012, eq. 18–19) foi calibrada para arranjos
  semi-regulares e só tem constantes para kernels Wendland; testada, continua +42 % em
  arranjo aleatório. Falha conhecida e registrada: A erra −7,5 % na grade regular perfeita
  (casca degenerada de 6 vizinhos à mesma distância) — arranjo que não existe na simulação.

Onde a matéria é densa (nós, filamentos) h é pequeno → splat pequeno e nítido.
Onde é rala (vazios) h é grande → splat grande e difuso.

Fórmulas (todas do artigo do GADGET-2, o mesmo código que rodou a simulação):
  Kernel, Springel 2005, eq. (4), com suporte compacto em r = h:
      W(r,h) = 8/(π h³) · { 1 − 6u² + 6u³      se 0 ≤ u ≤ ½
                            2 (1 − u)³          se ½ < u ≤ 1
                            0                   se u > 1 },   u = r/h
  Densidade, eq. (5):  ρ_i = Σ_j m_j W(|r_i − r_j|, h_i)
  Número de vizinhos: 33 (DesNumNgb = 33 no G3.param desta simulação).
  Visualização de partículas por kernel: Price 2007 (SPLASH).

Gaussiana do splat: σ = α·h, onde α é tal que a gaussiana tem a MESMA variância por eixo
que o kernel: α² = (1/3) ∫ u² W(u) 4πu² du  (calculado numericamente abaixo).

Critérios de aprovação (registrados ANTES de rodar, 14/10/2026; não foram alterados depois)
---------------------------------------------------------------------------------------
T1 grade regular:      |⟨ρ/ρ̄⟩ − 1| < 1 %
T2 partículas ao acaso: |⟨ρ/ρ̄⟩ − 1| < 5 %
T3 halo NFW sintético:  mediana de ρ_est/ρ_verdadeiro a menos de 10 % em cada faixa de raio
                        entre 0,05 e 0,8 R200
T4 simulação:          |Σ m/ρ_i ÷ L³ − 1| < 5 %  (soma dos "volumes" = volume da caixa)
   → T4 foi um ERRO DE DESENHO: a identidade só vale para métodos que fatiam o espaço sem
     sobreposição (Voronoi), não para estimadores por vizinhos/kernel. Fica só INFORMATIVO.

Uso
---
    python gerar_splats.py --testes        # só os testes T1–T3 (segundos)
    python gerar_splats.py --amostra 0.0625  # mede custo numa fração (1/16) da simulação
    python gerar_splats.py                 # simulação completa + T4 + figura
Saídas: dados/densidade_z0.npz (h, ρ, σ em float32), resultados_f2_1.json, figuras/13_*.png
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import psutil
from scipy import integrate
from scipy.spatial import cKDTree

PASTA = Path(__file__).resolve().parent
RAIZ = PASTA.parent
sys.path.insert(0, str(RAIZ / "calculos"))
import teoria_lcdm as teo  # noqa: E402

N_VIZINHOS = 33  # inclui a própria partícula (DesNumNgb = 33)


# ---------------------------------------------------------------------------
# Kernel e gaussiana equivalente
# ---------------------------------------------------------------------------
def kernel_gadget(u: np.ndarray) -> np.ndarray:
    """W(u) para h = 1 (Springel 2005, eq. 4). Para h qualquer: W(r,h) = kernel_gadget(r/h)/h³."""
    u = np.asarray(u, dtype=np.float64)
    w = np.zeros_like(u)
    a = u <= 0.5
    b = (u > 0.5) & (u <= 1.0)
    w[a] = 1 - 6 * u[a] ** 2 + 6 * u[a] ** 3
    w[b] = 2 * (1 - u[b]) ** 3
    return 8 / np.pi * w


def normalizacao_kernel() -> float:
    """∫ W 4πu² du deve dar 1 (conferência da fórmula)."""
    return integrate.quad(lambda u: kernel_gadget(np.array([u]))[0] * 4 * np.pi * u ** 2, 0, 1, points=[0.5])[0]


def alfa_gaussiana() -> float:
    """σ/h da gaussiana com a mesma variância por eixo do kernel."""
    var3 = integrate.quad(lambda u: u ** 2 * kernel_gadget(np.array([u]))[0] * 4 * np.pi * u ** 2, 0, 1,
                          points=[0.5])[0]
    return float(np.sqrt(var3 / 3))


# ---------------------------------------------------------------------------
# Densidade SPH com árvore de vizinhos
# ---------------------------------------------------------------------------
# Todos os estimadores ficam disponíveis como FILTRO no visualizador (decisão do Victor,
# 14/10/2026): "a gente embute todas as teorias, avisa onde são incompatíveis, e quem quiser
# combinar, combina". Cada um acerta num regime e erra noutro (ver testes T1–T3).
ESTIMADORES = ("A_knn", "C_sph_sem_propria", "B_sph_gadget", "D_wendland_dehnen_aly")
ESTIMADOR_PADRAO = "A_knn"
J_VIZINHO = N_VIZINHOS - 1  # 32: vizinhos sem contar a própria partícula (Casertano & Hut: j)
# Dehnen & Aly 2012, Tabela 1 (Wendland C2, ν = 3): W = 21/(2π) (1−u)⁴ (1+4u);
# eq. 18: ρ_corr = ρ − ε m W(0,h); eq. 19: ε = 0,0294 (N_H/100)^−0,977
EPS_DEHNEN_ALY = 0.0294 * (N_VIZINHOS / 100) ** (-0.977)


def kernel_wendland_c2(u: np.ndarray) -> np.ndarray:
    """Wendland C2 em 3D para h = 1 (Dehnen & Aly 2012, Tabela 1)."""
    u = np.asarray(u, dtype=np.float64)
    w = np.zeros_like(u)
    a = u < 1.0
    w[a] = (1 - u[a]) ** 4 * (1 + 4 * u[a])
    return 21 / (2 * np.pi) * w


def densidades(pos: np.ndarray, massa: float, caixa: float | None, lote: int = 500_000
               ) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """h_i e ρ_i pelos três estimadores. caixa = lado da caixa periódica (None = sem periodicidade).
    Uma única busca de vizinhos serve aos três. Processa em lotes para não estourar a memória
    (as distâncias de 16,8 mi × 33 vizinhos ocupariam 4,4 GB de uma vez)."""
    arvore = cKDTree(pos, boxsize=caixa)
    n = len(pos)
    h = np.empty(n, dtype=np.float32)
    rho = {e: np.empty(n, dtype=np.float32) for e in ESTIMADORES}
    for ini in range(0, n, lote):
        d, _ = arvore.query(pos[ini:ini + lote], k=N_VIZINHOS, workers=-1)
        hi = d[:, -1]
        W = kernel_gadget(d / hi[:, None])
        s = slice(ini, ini + lote)
        rho["A_knn"][s] = (J_VIZINHO - 1) * massa / (4 / 3 * np.pi * hi ** 3)
        rho["B_sph_gadget"][s] = massa * W.sum(axis=1) / hi ** 3
        rho["C_sph_sem_propria"][s] = massa * W[:, 1:].sum(axis=1) / hi ** 3
        Ww = kernel_wendland_c2(d / hi[:, None])
        rho["D_wendland_dehnen_aly"][s] = massa * (Ww.sum(axis=1) - EPS_DEHNEN_ALY * 21 / (2 * np.pi)) / hi ** 3
        h[s] = hi
    return h, rho


def densidade_sph(pos: np.ndarray, massa: float, caixa: float | None,
                  estimador: str = ESTIMADOR_PADRAO) -> tuple[np.ndarray, np.ndarray]:
    """Atalho: h e ρ por um estimador só."""
    h, rho = densidades(pos, massa, caixa)
    return h, rho[estimador]


# ---------------------------------------------------------------------------
# Testes de resposta conhecida
# ---------------------------------------------------------------------------
def teste_grade_regular(n_lado: int = 48, L: float = 10.0) -> dict[str, float]:
    q = (np.indices((n_lado,) * 3).reshape(3, -1).T + 0.5) * (L / n_lado)
    _, rho = densidades(q, 1.0, L)
    return {e: float(np.mean(v) / (n_lado ** 3 / L ** 3)) for e, v in rho.items()}


def teste_aleatorio(n: int = 200_000, L: float = 10.0, semente: int = 7) -> dict[str, float]:
    pos = np.random.default_rng(semente).uniform(0, L, size=(n, 3))
    _, rho = densidades(pos, 1.0, L)
    return {e: float(np.mean(v) / (n / L ** 3)) for e, v in rho.items()}


def teste_nfw(n: int = 200_000, c: float = 8.0, semente: int = 11) -> dict[str, list[dict]]:
    """Halo NFW sintético (R200 = 1, massa total = 1, cortado em R200). Raios sorteados
    invertendo M(<r) ∝ ln(1+x) − x/(1+x), x = r/rs; direções uniformes."""
    rng = np.random.default_rng(semente)
    mu = lambda x: np.log1p(x) - x / (1 + x)  # noqa: E731
    xs = np.logspace(-5, np.log10(c), 20000)
    alvo = rng.uniform(0, mu(c), n)
    x = np.interp(alvo, mu(xs), xs)
    r = x / c
    v = rng.normal(size=(n, 3))
    pos = r[:, None] * v / np.linalg.norm(v, axis=1)[:, None]
    m = 1.0 / n
    _, rhos = densidades(pos, m, None)
    rs = 1.0 / c
    rho_s = 1.0 / (4 * np.pi * rs ** 3 * mu(c))
    rho_v = rho_s / ((r / rs) * (1 + r / rs) ** 2)
    bordas = np.logspace(np.log10(0.05), np.log10(0.8), 7)
    saida = {}
    for e, rho in rhos.items():
        linhas = []
        for a, b in zip(bordas[:-1], bordas[1:]):
            s = (r >= a) & (r < b)
            linhas.append({"r_de": float(a), "r_ate": float(b), "n": int(s.sum()),
                           "mediana_rho_est_sobre_verdadeiro": float(np.median(rho[s] / rho_v[s]))})
        saida[e] = linhas
    return saida


def rodar_testes() -> dict:
    t1, t2, t3 = teste_grade_regular(), teste_aleatorio(), teste_nfw()
    por_estimador = {}
    for e in ESTIMADORES:
        pior_t3 = max(abs(x["mediana_rho_est_sobre_verdadeiro"] - 1) for x in t3[e])
        por_estimador[e] = {
            "T1_grade_regular": {"media_rho_sobre_rhobar": t1[e], "passou": abs(t1[e] - 1) < 0.01},
            "T2_aleatorio": {"media_rho_sobre_rhobar": t2[e], "passou": abs(t2[e] - 1) < 0.05},
            "T3_nfw": {"pior_desvio": pior_t3, "faixas": t3[e], "passou": pior_t3 < 0.10},
        }
    return {"normalizacao_kernel": normalizacao_kernel(), "alfa_sigma_sobre_h": alfa_gaussiana(),
            "estimador_padrao": ESTIMADOR_PADRAO, "por_estimador": por_estimador}


# ---------------------------------------------------------------------------
# Simulação
# ---------------------------------------------------------------------------
def rodar_simulacao(fracao: float = 1.0) -> dict:
    import conferencia_snapshot as cs

    proc = psutil.Process()
    t0 = time.perf_counter()
    _, pos = cs.ler_snapshot()
    L = teo.SIM.caixa_mpc_h
    pos = np.mod(pos.astype(np.float64), L)
    m_p = teo.massa_particula()
    if fracao < 1.0:  # subamostra aleatória: massa por partícula cresce 1/f
        sel = np.random.default_rng(2026).random(len(pos)) < fracao
        pos, m_p = pos[sel], m_p / fracao
    t_leitura = time.perf_counter() - t0
    mem_pico = [proc.memory_info().rss]

    t1 = time.perf_counter()
    h, rho = densidades(pos, m_p, L)
    t_dens = time.perf_counter() - t1
    mem_pico.append(proc.memory_info().rss)

    rho_m = teo.COSMO.omega_m * teo.densidade_critica_h2()
    alfa = alfa_gaussiana()
    razao_CA = rho["C_sph_sem_propria"] / rho["A_knn"]
    res = {
        "fracao": fracao, "n_particulas": int(len(pos)), "massa_por_particula_msun_h": m_p,
        "tempo_leitura_s": t_leitura, "tempo_densidades_s": t_dens,
        "memoria_processo_gb": max(mem_pico) / 1e9,
        "T4_informativo_soma_volumes_sobre_caixa": {
            e: float(np.sum(m_p / v.astype(np.float64)) / L ** 3) for e, v in rho.items()},
        "rho_sobre_media": {e: {p: float(np.percentile(v / rho_m, q)) for p, q in
                                (("p1", 1), ("p50", 50), ("p99", 99), ("max", 100))} for e, v in rho.items()},
        "discordancia_C_sobre_A": {p: float(np.percentile(razao_CA, q)) for p, q in
                                   (("p5", 5), ("p50", 50), ("p95", 95))},
        "h_kpc_h": {p: float(np.percentile(h, q) * 1e3) for p, q in
                    (("min", 0), ("p1", 1), ("p50", 50), ("p99", 99), ("max", 100))},
        "alfa_sigma_sobre_h": alfa,
    }
    if fracao == 1.0:
        (PASTA / "dados").mkdir(exist_ok=True)
        np.savez(PASTA / "dados" / "densidade_z0.npz", h=h, sigma=(alfa * h).astype(np.float32),
                 **{f"rho_msun_h_por_mpc_h3_{e}": v for e, v in rho.items()})
        figura_fatia(pos, {e: v / rho_m for e, v in rho.items()}, h)
    return res


def figura_fatia(pos: np.ndarray, delta1: dict[str, np.ndarray], h: np.ndarray) -> None:
    """Fatia z ∈ [10, 15) Mpc/h (a mesma da figura 06): densidade pelos estimadores A e C,
    o mapa de discordância entre eles (log₁₀ C/A) e a distribuição do tamanho dos splats."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    s = (pos[:, 2] >= 10) & (pos[:, 2] < 15)
    x, y = pos[s, 0], pos[s, 1]
    fig, eixos = plt.subplots(2, 2, figsize=(13, 13))
    paineis = [("A_knn", "A — kNN (Casertano & Hut 1985) · padrão"),
               ("C_sph_sem_propria", "C — SPH sem a própria partícula")]
    for ax, (e, titulo) in zip(eixos[0], paineis):
        v = delta1[e][s]
        o = np.argsort(v)
        sc = ax.scatter(x[o], y[o], c=np.log10(v[o]), s=0.05, cmap="magma", vmin=-1, vmax=3, linewidths=0)
        ax.set_title(f"{titulo}\nlog₁₀ ρ/ρ̄m"); fig.colorbar(sc, ax=ax, fraction=0.046)
    disc = np.log10(delta1["C_sph_sem_propria"][s] / delta1["A_knn"][s])
    o = np.argsort(np.abs(disc))
    sc = eixos[1, 0].scatter(x[o], y[o], c=disc[o], s=0.05, cmap="coolwarm", vmin=-0.3, vmax=0.3, linewidths=0)
    eixos[1, 0].set_title("Onde os métodos discordam: log₁₀(C/A)\n(0 = concordam; ±0,3 = fator 2)")
    fig.colorbar(sc, ax=eixos[1, 0], fraction=0.046)
    for ax in (eixos[0, 0], eixos[0, 1], eixos[1, 0]):
        ax.set_aspect("equal"); ax.set_xlim(0, 25); ax.set_ylim(0, 25)
        ax.set_xlabel("x [Mpc/h]"); ax.set_ylabel("y [Mpc/h]")
    eixos[1, 1].hist(np.log10(h * 1e3), bins=120, color="#4b3b8f")
    eixos[1, 1].set_xlabel("log₁₀ h [kpc/h]  (tamanho do splat ∝ h)"); eixos[1, 1].set_ylabel("partículas")
    eixos[1, 1].set_title("Distribuição do tamanho dos splats (igual para todos os estimadores)")
    fig.tight_layout()
    (RAIZ / "calculos" / "figuras").mkdir(exist_ok=True)
    fig.savefig(RAIZ / "calculos" / "figuras" / "13_densidade_estimadores_fatia.png", dpi=110)
    plt.close(fig)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--testes", action="store_true")
    ap.add_argument("--amostra", type=float, default=None)
    a = ap.parse_args()
    if a.testes:
        out = rodar_testes()
    elif a.amostra:
        out = rodar_simulacao(a.amostra)
    else:
        out = {"testes": rodar_testes(), "simulacao": rodar_simulacao(1.0)}
        (PASTA / "resultados_f2_1.json").write_text(json.dumps(out, indent=2, ensure_ascii=False, default=float),
                                                    encoding="utf-8")
    print(json.dumps(out, indent=1, ensure_ascii=False, default=float))
