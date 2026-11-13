"""
conferencia_snapshot.py
=======================

Confere o snapshot z = 0 da simulação CAMELS (IllustrisTNG_DM/CV/CV_0) contra a
teoria calculada em teoria_lcdm.py.

Testes
------
1. Header: número de partículas, caixa, redshift, cosmologia e massa da partícula
   contra o valor teórico m_p = Ωm ρcrit L³ / N.
2. Posições: todas dentro da caixa periódica [0, L).
3. Espectro de potência medido (atribuição CIC em grade 256³ + FFT) contra o
   espectro linear CAMB da simulação:
     - nas maiores escalas da caixa (k ≲ 0,3 h/Mpc) devem ficar próximos, com
       muito ruído, porque a caixa tem pouquíssimos modos ali (variância cósmica);
     - em escalas menores o medido deve ficar MUITO ACIMA do linear: é o colapso
       gravitacional não linear que forma a teia (k_nl ≈ 0,26 h/Mpc).
4. Uma projeção da densidade (fatia de 5 Mpc/h) para ver a teia.

Referências do método: atribuição Cloud-in-Cell e correção da janela, prática
padrão em análise de simulações N-corpos (ver Springel 2005 e a documentação do
Pylians/CAMELS). O ruído de Poisson (shot noise) 1/n̄ é subtraído.

Uso:  python conferencia_snapshot.py
Gera: resultados_snapshot.json e figuras/05_*.png, figuras/06_*.png
"""

from __future__ import annotations

import json
from pathlib import Path

import h5py
import hdf5plugin  # noqa: F401  registra o filtro Blosc (id 32001) usado nos snapshots do CAMELS
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import teoria_lcdm as teo

PASTA = Path(__file__).resolve().parent
ARQ_SNAP = PASTA.parent / "dados" / "CAMELS_IllustrisTNG_DM_CV_0" / "snapshot_090.hdf5"
NGRADE = 256


def ler_snapshot() -> tuple[dict, np.ndarray]:
    """Lê o header e as posições (convertidas para Mpc/h, float32 para economizar memória)."""
    with h5py.File(ARQ_SNAP, "r") as f:
        hd = {k: (v.tolist() if hasattr(v, "tolist") else v) for k, v in f["Header"].attrs.items()}
        pos = f["PartType1/Coordinates"][:].astype(np.float32) / 1e3  # kpc/h -> Mpc/h
    return hd, pos


def cic(pos: np.ndarray, L: float, n: int) -> np.ndarray:
    """Cloud-in-Cell: cada partícula distribui massa para as 8 células vizinhas,
    com pesos lineares, em caixa periódica. Retorna o contraste δ = ρ/ρ̄ − 1."""
    grade = np.zeros(n ** 3, dtype=np.float64)
    x = pos / L * n
    i0 = np.floor(x).astype(np.int64)
    d = (x - i0).astype(np.float64)
    for dx in (0, 1):
        wx = d[:, 0] if dx else 1 - d[:, 0]
        for dy in (0, 1):
            wy = d[:, 1] if dy else 1 - d[:, 1]
            for dz in (0, 1):
                wz = d[:, 2] if dz else 1 - d[:, 2]
                idx = (i0 + np.array([dx, dy, dz])) % n
                plano = (idx[:, 0] * n + idx[:, 1]) * n + idx[:, 2]
                grade += np.bincount(plano, weights=wx * wy * wz, minlength=n ** 3)
    grade = grade.reshape(n, n, n)
    return grade / grade.mean() - 1.0


def espectro_medido(delta: np.ndarray, L: float, n_part: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """P(k) = |δ_k|² V / N⁶, corrigido pela janela CIC e sem shot noise, em cascas de k.

    Convenções (as mesmas do P(k) oficial do CAMELS; conferido em 14/10/2026: diferença
    máxima de 0,05 % entre 0,5 e 10 h/Mpc, ver fase1_conferencia.py):
      - casca n contém as ondas com n ≤ |k|/k_f < n + 1 (piso);
      - nos planos kz = 0 e kz = Nyquist da FFT real cada onda aparece duas vezes
        (k e −k): conta-se só a metade independente.
    Versão anterior (até 14/10) usava cascas arredondadas e contava as ondas duplicadas,
    o que dava até 8 % de diferença nas cascas com poucas ondas.
    """
    n = delta.shape[0]
    dk = np.fft.rfftn(delta)
    kf = 2 * np.pi / L
    i1 = np.fft.fftfreq(n, d=1.0 / n)
    iz = np.fft.rfftfreq(n, d=1.0 / n)
    IX, IY, IZ = np.meshgrid(i1, i1, iz, indexing="ij")
    imod = np.sqrt(IX ** 2 + IY ** 2 + IZ ** 2)
    # janela CIC: W(k) = Π sinc²(π i / N); np.sinc(x) = sin(πx)/(πx)
    W = (np.sinc(IX / n) * np.sinc(IY / n) * np.sinc(IZ / n)) ** 2
    P3 = (np.abs(dk) ** 2) * (L ** 3) / n ** 6 / W ** 2
    plano = (IZ == 0) | (IZ == n // 2)
    metade = (IX > 0) | ((IX == 0) & (IY >= 0)) | (np.abs(IX) == n // 2)
    peso = np.where(plano & ~metade, 0.0, 1.0)
    shot = L ** 3 / n_part
    idx = np.floor(imod).astype(np.int64).ravel()
    Psum = np.bincount(idx, weights=(P3 * peso).ravel())
    Ksum = np.bincount(idx, weights=(imod * kf * peso).ravel())
    Nm = np.bincount(idx, weights=peso.ravel())
    ok = (np.arange(len(Nm)) >= 1) & (np.arange(len(Nm)) < n // 2) & (Nm > 0)
    k = Ksum[ok] / Nm[ok]
    P = Psum[ok] / Nm[ok] - shot
    return k, P, Nm[ok].astype(np.int64)


def main() -> None:
    hd, pos = ler_snapshot()
    L = hd["BoxSize"] / 1e3
    N = int(hd["NumPart_Total"][1])
    m_p_snap = hd["MassTable"][1] * 1e10
    m_p_teo = teo.massa_particula()

    res = {
        "header": {
            "redshift": hd["Redshift"], "scale_factor_Time": hd["Time"], "caixa_mpc_h": L,
            "n_particulas_dm": N, "Omega0": hd["Omega0"], "OmegaLambda": hd["OmegaLambda"],
            "HubbleParam": hd["HubbleParam"],
        },
        "teste_massa_particula": {
            "snapshot_msun_h": m_p_snap, "teoria_msun_h": m_p_teo,
            "diferenca_relativa": m_p_snap / m_p_teo - 1,
        },
        "teste_posicoes_na_caixa": {
            "min": float(pos.min()), "max": float(pos.max()),
            "todas_dentro": bool((pos >= 0).all() and (pos < L).all()),
        },
    }

    delta = cic(np.mod(pos, L), L, NGRADE)
    k, P, nmodos = espectro_medido(delta, L, N)
    camb = teo.sigma8_do_espectro_camb()
    P_lin = np.interp(np.log(k), np.log(camb["_k"]), camb["_p"])
    razao = P / P_lin
    k_ny = np.pi * NGRADE / L
    res["espectro_medido"] = {
        "nota": "razao = P medido / P linear CAMB, z = 0. Esperado ~1 nas maiores escalas (com ruído) e >> 1 em k > k_nl",
        "pontos": [{"k_h_mpc": float(a), "n_modos": int(m), "P_medido": float(b), "P_linear": float(c), "razao": float(r)}
                   for a, b, c, r, m in zip(k, P, P_lin, razao, nmodos) if a < k_ny / 2][:: 3],
    }
    (PASTA / "resultados_snapshot.json").write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")

    figs = PASTA / "figuras"
    sel = k < k_ny / 2  # acima de ~metade do Nyquist da grade o CIC perde confiabilidade
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.loglog(camb["_k"], camb["_p"], color="#e76f51", ls="--", label="linear (CAMB da simulação)")
    ax.loglog(k[sel], P[sel], "o-", ms=3, color="#4b3b8f", label="medido na simulação, z = 0")
    ax.axvline(teo.escala_nao_linear(), ls=":", color="#2a9d8f"); ax.text(teo.escala_nao_linear() * 1.05, 2, "k_nl", fontsize=8)
    ax.set_xlim(0.2, k_ny / 2); ax.set_ylim(1e-1, 1e4)
    ax.set_xlabel("k [h/Mpc]"); ax.set_ylabel("P(k) [(Mpc/h)³]"); ax.legend(fontsize=8)
    ax.set_title("Teia formada pela gravidade: medido × teoria linear")
    fig.tight_layout(); fig.savefig(figs / "05_espectro_medido_vs_linear.png", dpi=130); plt.close(fig)

    # Projeção: fatia de 5 Mpc/h em z, densidade em grade 1024² (log)
    fatia = pos[(pos[:, 2] >= 10) & (pos[:, 2] < 15)]
    H, _, _ = np.histogram2d(fatia[:, 0], fatia[:, 1], bins=1024, range=[[0, L], [0, L]])
    fig, ax = plt.subplots(figsize=(7.5, 7.5))
    ax.imshow(np.log10(H.T + 1), origin="lower", extent=[0, L, 0, L], cmap="magma")
    ax.set_xlabel("x [Mpc/h]"); ax.set_ylabel("y [Mpc/h]")
    ax.set_title(f"Matéria escura hoje: fatia de 5 Mpc/h ({len(fatia):,} partículas)".replace(",", "."))
    fig.tight_layout(); fig.savefig(figs / "06_teia_fatia_z10_15.png", dpi=130); plt.close(fig)

    print(json.dumps({k_: v for k_, v in res.items() if k_ != "espectro_medido"}, indent=2, ensure_ascii=False))
    for p in res["espectro_medido"]["pontos"]:
        print(f"k={p['k_h_mpc']:.3f}  modos={p['n_modos']:>6}  razao medido/linear={p['razao']:.2f}")


if __name__ == "__main__":
    main()
