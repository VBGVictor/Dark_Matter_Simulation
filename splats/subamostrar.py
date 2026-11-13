"""
subamostrar.py — F2.2 do backlog
================================

Gera as versões leves da simulação para o navegador:
  1/8  → 2.097.152 splats      1/64 → 262.144 splats
Sorteio SEM reposição, com número exato de partículas (semente fixa = reprodutível).
Cada splat leva massa m_p / f. Em cada versão, h e as 4 densidades (A, B, C, D) são
RECALCULADOS na própria subamostra (gerar_splats.densidades): com menos partículas os
vizinhos ficam mais longe, então o splat fica maior (h cresce ~ f^(−1/3)).

Critérios (registrados ANTES de rodar, 14/10/2026)
--------------------------------------------------
S1 massa:   N_sub · m_sub = massa total da caixa  (|razão − 1| < 1e−6)
S2 teia:    P_sub(k) = P_completo(k) a menos de 5 % para 0,5 ≤ k ≤ 5 h/Mpc
            (ambos sem o ruído de contagem L³/N de cada um)
S3 densidade (INFORMATIVO): ρ_sub / ρ_completo nas mesmas partículas — a resolução cai,
            então os picos ficam mais suaves por natureza; medimos quanto.

Uso:   python subamostrar.py
Saída: dados/sub_1_8.npz, dados/sub_1_64.npz, resultados_f2_2.json, figura 14
Cada .npz: idx (posição no snapshot), pos [Mpc/h], h, sigma [Mpc/h], massa_por_splat [Msun/h],
           rho_* (recalculada na subamostra) e rho_*_resolucao_completa (da F2.1, mesma
           partícula), para os 4 estimadores, em Msun/h/(Mpc/h)³
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import psutil

PASTA = Path(__file__).resolve().parent
RAIZ = PASTA.parent
sys.path.insert(0, str(RAIZ / "calculos"))
import conferencia_snapshot as cs  # noqa: E402
import teoria_lcdm as teo  # noqa: E402

import gerar_splats as gs  # noqa: E402

FRACOES = {"1_8": 1 / 8, "1_64": 1 / 64}
SEMENTE = 20261014


def pk(pos: np.ndarray, L: float) -> tuple[np.ndarray, np.ndarray]:
    """P(k) sem ruído de contagem, grade 256³, mesmo método validado na F1.1."""
    k, P, _ = cs.espectro_medido(cs.cic(np.mod(pos, L), L, 256), L, len(pos))
    return k, P


def main() -> dict:
    proc = psutil.Process()
    L = teo.SIM.caixa_mpc_h
    _, pos = cs.ler_snapshot()
    N = len(pos)
    m_p = teo.massa_particula()
    M_total = N * m_p
    completo = np.load(PASTA / "dados" / "densidade_z0.npz")
    rho_A_completo = completo["rho_msun_h_por_mpc_h3_A_knn"]
    k_full, P_full = pk(pos, L)
    alfa = gs.alfa_gaussiana()
    rho_m = teo.COSMO.omega_m * teo.densidade_critica_h2()

    res = {"semente": SEMENTE, "n_completo": N}
    curvas = {}
    for nome, f in FRACOES.items():
        t0 = time.perf_counter()
        n_sub = int(round(N * f))
        idx = np.sort(np.random.default_rng(SEMENTE).choice(N, size=n_sub, replace=False)).astype(np.uint32)
        p_sub = np.mod(pos[idx].astype(np.float64), L)
        m_sub = M_total / n_sub
        h, rho = gs.densidades(p_sub, m_sub, L)
        k, P = pk(p_sub, L)
        sel = (k_full >= 0.5) & (k_full <= 5)
        razao_pk = P[: len(P_full)][sel] / P_full[sel]
        razao_rho = rho["A_knn"] / rho_A_completo[idx]
        res[nome] = {
            "n_splats": n_sub, "massa_por_splat_msun_h": m_sub,
            "S1_massa_total_razao": n_sub * m_sub / M_total,
            "S1_passou": abs(n_sub * m_sub / M_total - 1) < 1e-6,
            "S2_pk_max_desvio": float(np.max(np.abs(razao_pk - 1))),
            "S2_passou": bool(np.max(np.abs(razao_pk - 1)) < 0.05),
            "S3_rho_A_sub_sobre_completo": {p: float(np.percentile(razao_rho, q)) for p, q in
                                            (("p5", 5), ("p25", 25), ("p50", 50), ("p75", 75), ("p95", 95))},
            "h_kpc_h": {p: float(np.percentile(h, q) * 1e3) for p, q in (("min", 0), ("p50", 50), ("max", 100))},
            "rho_A_sobre_media_p50": float(np.median(rho["A_knn"] / rho_m)),
            "tempo_s": time.perf_counter() - t0,
            "memoria_gb": proc.memory_info().rss / 1e9,
        }
        # Duas versões da densidade para cada splat (filtro no visualizador):
        #   rho_*                    recalculada na própria subamostra (coerente com o tamanho do splat,
        #                            mas perde halos pequenos: resolução cai ~f^(−1/3))
        #   rho_*_resolucao_completa a densidade que ESSA MESMA partícula tem na simulação completa
        #                            (F2.1) — desenho leve, cor com a resolução total
        np.savez(PASTA / "dados" / f"sub_{nome}.npz", idx=idx, pos=p_sub.astype(np.float32), h=h,
                 sigma=(alfa * h).astype(np.float32), massa_por_splat=np.float64(m_sub),
                 **{f"rho_msun_h_por_mpc_h3_{e}": v for e, v in rho.items()},
                 **{f"rho_msun_h_por_mpc_h3_{e}_resolucao_completa": completo[f"rho_msun_h_por_mpc_h3_{e}"][idx]
                    for e in gs.ESTIMADORES})
        res[nome]["arquivo_mb"] = (PASTA / "dados" / f"sub_{nome}.npz").stat().st_size / 1e6
        curvas[nome] = (k, P, razao_rho)

    figura(k_full, P_full, curvas)
    (PASTA / "resultados_f2_2.json").write_text(json.dumps(res, indent=2, ensure_ascii=False, default=float),
                                                encoding="utf-8")
    return res


def figura(k_full, P_full, curvas) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4.8))
    a1.axhline(1, color="k", lw=0.8)
    for y in (0.95, 1.05):
        a1.axhline(y, ls=":", color="gray")
    cores = {"1_8": "#4b3b8f", "1_64": "#e76f51"}
    for nome, (k, P, razao_rho) in curvas.items():
        m = (k_full >= 0.3) & (k_full <= 12)
        a1.semilogx(k_full[m], P[: len(P_full)][m] / P_full[m], color=cores[nome], label=f"{nome.replace('_', '/')}")
        a2.hist(np.log10(razao_rho), bins=150, range=(-1.5, 1), histtype="step", color=cores[nome],
                density=True, label=f"{nome.replace('_', '/')}")
    a1.axvspan(0.5, 5, color="#2a9d8f", alpha=0.08)
    a1.set_ylim(0.85, 1.15); a1.set_xlabel("k [h/Mpc]"); a1.set_ylabel("P(subamostra) / P(completa)")
    a1.set_title("A teia é a mesma? (faixa do critério sombreada)"); a1.legend()
    a2.axvline(0, color="k", lw=0.8)
    a2.set_xlabel("log₁₀ (densidade A na subamostra / na completa)"); a2.set_ylabel("fração de partículas")
    a2.set_title("Quanto a resolução menor suaviza a densidade (informativo)"); a2.legend()
    fig.tight_layout(); fig.savefig(RAIZ / "calculos" / "figuras" / "14_subamostras.png", dpi=130); plt.close(fig)


if __name__ == "__main__":
    print(json.dumps(main(), indent=1, ensure_ascii=False, default=float))
