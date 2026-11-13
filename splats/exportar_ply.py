"""
exportar_ply.py — F2.4 do backlog
=================================

Grava os splats no formato .ply do 3D Gaussian Splatting (Kerbl et al. 2023), o formato que
o Spark e os visualizadores de splats leem.

Formato (conferido no código oficial, graphdeco-inria/gaussian-splatting, 14/10/2026):
  ordem dos campos: x y z nx ny nz f_dc_0 f_dc_1 f_dc_2 opacity scale_0 scale_1 scale_2 rot_0..rot_3
  (sem f_rest_*: cor de grau 0, sem harmônicos esféricos — a cor não depende do ângulo)
  normais = 0 · escala gravada em log(σ) · opacidade gravada como logit (inverso da sigmoide)
  cor: f_dc = (rgb − 0,5) / C0, C0 = 0,28209479177387814 (utils/sh_utils.py)
  rotação: quaternion (1, 0, 0, 0) = sem rotação (splat esférico)
  binário little-endian, float32 → 68 bytes por splat

Escolhas de visualização (CONVENÇÃO, não física — viram controles na Fase 3):
  posição: centrada na origem (x − 12,5), 1 unidade = 1 Mpc/h
  σ: o da F2.1/F2.2 (mesma variância do kernel do GADGET), igual nos 3 eixos
  cor: paleta aplicada a log₁₀(ρ/ρ̄m) do estimador escolhido, faixa fixa de −1 a 5
       (0,1× a 100.000× a média); padrão = estimador A na resolução completa, paleta magma
  opacidade: α = 1 − exp(−τ), τ = E · Σ₀ / (ρ̄m · 1 Mpc/h), com Σ₀ = m/(2πσ²) a massa
       projetada no centro do splat. E = "exposição" (padrão 0,1). Quanto mais massa
       concentrada, mais opaco. Limitado a [0,01; 0,99].
       Escolha do padrão (14/10/2026, olhando no Spark): com E = 0,5 a caixa inteira vira
       névoa (filamentos sobrepostos em 25 Mpc/h de profundidade); com 0,03 fica rarefeita
       demais; com 0,1 os filamentos aparecem em 3D. Convenção visual → controle na Fase 3.

Critérios (registrados ANTES de rodar, 14/10/2026)
  P1 ida e volta: ler o .ply gravado e decodificar → posição, σ, cor e α iguais (erro < 1e−5)
  P2 visual: abrir no Spark; a fatia z ∈ [10, 15) mostra a mesma teia da figura 06

Uso:   python exportar_ply.py
Saída: dados/teia_1_64_magma.ply (caixa inteira, 1/64) e dados/fatia_1_8_magma.ply (fatia, 1/8)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent / "calculos"))
import teoria_lcdm as teo  # noqa: E402

import paletas  # noqa: E402

C0 = 0.28209479177387814
CAMPOS = (["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity"]
          + [f"scale_{i}" for i in range(3)] + [f"rot_{i}" for i in range(4)])
L = teo.SIM.caixa_mpc_h
RHO_M = teo.COSMO.omega_m * teo.densidade_critica_h2()
FAIXA_LOG = (-1.0, 5.0)


def cores(rho: np.ndarray, paleta: str) -> np.ndarray:
    """RGB (0–1) pela paleta aplicada a log₁₀(ρ/ρ̄m) na faixa fixa."""
    v = np.clip((np.log10(rho / RHO_M) - FAIXA_LOG[0]) / (FAIXA_LOG[1] - FAIXA_LOG[0]), 0, 1)
    return paletas.PALETAS[paleta][1](v)[:, :3]


def opacidades(massa: float, sigma: np.ndarray, exposicao: float) -> np.ndarray:
    sigma0 = massa / (2 * np.pi * sigma.astype(np.float64) ** 2)
    tau = exposicao * sigma0 / (RHO_M * 1.0)
    return np.clip(1 - np.exp(-tau), 0.01, 0.99)


def gravar_ply(arq: Path, pos: np.ndarray, sigma: np.ndarray, rgb: np.ndarray, alfa: np.ndarray,
               quat: np.ndarray | None = None) -> None:
    """sigma: (n,) para splat redondo ou (n, 3) desvio por eixo (F3.16, manchas alongadas).
    quat: (n, 4) rotação (w, x, y, z), a mesma ordem do rot_0..rot_3 do 3DGS; None = sem rotação."""
    n = len(pos)
    dados = np.zeros((n, len(CAMPOS)), dtype="<f4")
    dados[:, 0:3] = pos - L / 2
    dados[:, 6:9] = (rgb - 0.5) / C0
    dados[:, 9] = np.log(alfa / (1 - alfa))
    dados[:, 10:13] = np.log(sigma) if np.ndim(sigma) == 2 else np.log(sigma)[:, None]
    if quat is None:
        dados[:, 13] = 1.0
    else:
        dados[:, 13:17] = quat
    cab = ["ply", "format binary_little_endian 1.0", f"element vertex {n}"]
    cab += [f"property float {c}" for c in CAMPOS] + ["end_header"]
    with open(arq, "wb") as f:
        f.write(("\n".join(cab) + "\n").encode("ascii"))
        f.write(dados.tobytes())


def ler_ply(arq: Path) -> dict[str, np.ndarray]:
    """Leitor independente do gravador: interpreta o cabeçalho e decodifica pelas fórmulas inversas."""
    with open(arq, "rb") as f:
        cab = []
        while True:
            linha = f.readline().decode("ascii").strip()
            cab.append(linha)
            if linha == "end_header":
                break
        n = int(next(l for l in cab if l.startswith("element vertex")).split()[-1])
        nomes = [l.split()[-1] for l in cab if l.startswith("property")]
        bruto = np.frombuffer(f.read(), dtype="<f4").reshape(n, len(nomes))
    c = {nome: bruto[:, i] for i, nome in enumerate(nomes)}
    return {
        "pos": np.stack([c["x"], c["y"], c["z"]], axis=1) + L / 2,
        "sigma": np.exp(c["scale_0"]),
        "escalas": np.exp(np.stack([c[f"scale_{i}"] for i in range(3)], axis=1)),
        "quat": np.stack([c[f"rot_{i}"] for i in range(4)], axis=1),
        "rgb": np.stack([c[f"f_dc_{i}"] for i in range(3)], axis=1) * C0 + 0.5,
        "alfa": 1 / (1 + np.exp(-c["opacity"])),
    }


def exportar(origem: str, destino: str, paleta: str = "c_magma", estimador: str = "A_knn",
             exposicao: float = 0.1, fatia: tuple[float, float] | None = None) -> dict:
    d = np.load(PASTA / "dados" / origem)
    pos, sig, m = d["pos"].astype(np.float64), d["sigma"], float(d["massa_por_splat"])
    rho = d[f"rho_msun_h_por_mpc_h3_{estimador}_resolucao_completa"]
    if fatia:
        s = (pos[:, 2] >= fatia[0]) & (pos[:, 2] < fatia[1])
        pos, sig, rho = pos[s], sig[s], rho[s]
    rgb = cores(rho, paleta)
    alfa = opacidades(m, sig, exposicao)
    arq = PASTA / "dados" / destino
    gravar_ply(arq, pos, sig, rgb, alfa)

    lido = ler_ply(arq)  # P1: ida e volta
    erros = {
        "pos_abs_mpc_h": float(np.max(np.abs(lido["pos"] - pos))),
        "sigma_rel": float(np.max(np.abs(lido["sigma"] / sig - 1))),
        "rgb_abs": float(np.max(np.abs(lido["rgb"] - rgb))),
        "alfa_abs": float(np.max(np.abs(lido["alfa"] - alfa))),
    }
    return {"arquivo": destino, "n_splats": len(pos), "mb": arq.stat().st_size / 1e6,
            "bytes_por_splat": (arq.stat().st_size) / len(pos),
            "alfa_percentis": {p: float(np.percentile(alfa, q)) for p, q in (("p5", 5), ("p50", 50), ("p95", 95))},
            "P1_erros": erros, "P1_passou": all(v < 1e-5 for v in erros.values())}


if __name__ == "__main__":
    res = [exportar("sub_1_64.npz", "teia_1_64_magma.ply"),
           exportar("sub_1_8.npz", "fatia_1_8_magma.ply", fatia=(10.0, 15.0))]
    (PASTA / "resultados_f2_4.json").write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(res, indent=1, ensure_ascii=False))
