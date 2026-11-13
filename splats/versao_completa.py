"""
versao_completa.py — F3.14 (opção B): todas as 16,8 milhões de partículas, no navegador
========================================================================================

Gera `dados/teia_completa_magma.spz` direto da simulação, SEM arquivos intermediários
grandes (o .ply teria 1,1 GB e o densidade_z0.npz, 384 MB — regra do projeto: < ~1 GB).

Mesmas fórmulas e convenções das versões leves (nada novo aqui):
  tamanho: h = distância ao 33º vizinho; σ = 0,2739·h (gerar_splats.py, F2.1)
  cor:     estimador A (Casertano & Hut 1985), paleta magma, faixa log₁₀(ρ/ρ̄m) de −1 a 5
  opacidade: exposição 0,1 (convenção visual, exportar_ply.py)
  massa por mancha: a da partícula, 7,75×10⁷ M☉/h (sem subamostragem)
Opcional --alongada: manchas alongadas (Yu & Turk 2013, anisotropia.py) → *_alongada.spz.

Também grava `dados/<nome>.json` com os metadados que o visualizador usa no aviso de
"limite de detalhe" (F3.14-C): número de manchas, massa por mancha e o "grão" (ver grao()).

Uso:  python versao_completa.py              (~3 min, ~1 GB de RAM)
      python versao_completa.py --alongada   (+ ~20 min)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import psutil

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent / "calculos"))
import conferencia_snapshot as cs  # noqa: E402
import teoria_lcdm as teo  # noqa: E402

import exportar_ply as ep  # noqa: E402
import exportar_spz as ez  # noqa: E402
import gerar_splats as gs  # noqa: E402


def grao(sigma: np.ndarray, rho: np.ndarray) -> float:
    """"Grão" da versão: σ mediano das 10 % manchas de maior densidade (miolo dos halos).
    É o tamanho típico de uma partícula onde a estrutura é mais fina — abaixo disso, esta
    versão não tem mais detalhe. Usado só para o AVISO na tela (convenção, não física)."""
    corte = np.percentile(rho, 90)
    return float(np.median(sigma[rho >= corte]))


def gravar_metadados(nome: str, n: int, massa: float, g: float, origem: str) -> None:
    meta = {"arquivo": f"{nome}.spz", "n_splats": int(n), "massa_por_splat_msun_h": massa,
            "massa_por_splat_msun": massa / teo.COSMO.h, "grao_mpc_h": g, "origem": origem,
            "nota": "grão = σ mediano das 10 % manchas mais densas; aviso de limite de detalhe"}
    (PASTA / "dados" / f"{nome}.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False),
                                                   encoding="utf-8")


def main(alongada: bool) -> dict:
    proc = psutil.Process()
    t0 = time.perf_counter()
    _, pos = cs.ler_snapshot()
    L = teo.SIM.caixa_mpc_h
    pos = np.mod(pos.astype(np.float64), L)
    m_p = teo.massa_particula()
    h, rho = gs.densidades(pos, m_p, L)
    sigma = (gs.alfa_gaussiana() * h).astype(np.float64)
    rA = rho["A_knn"]
    del rho
    rgb = ep.cores(rA, "c_magma")
    alfa = ep.opacidades(m_p, sigma, 0.1)
    comum = dict(pos_centrada=(pos - L / 2).astype(np.float32),
                 f_dc=((rgb - 0.5) / ep.C0).astype(np.float32),
                 logit_alfa=np.log(alfa / (1 - alfa)).astype(np.float32))
    nome = "teia_completa_magma"
    g = grao(sigma, rA)
    # Regra do projeto: nunca sobrescrever arquivo existente. Se a redonda já existe, só faz a alongada.
    if not (PASTA / "dados" / f"{nome}.spz").exists():
        ez.gravar_spz_dados(PASTA / "dados" / f"{nome}.spz",
                            log_escalas=np.repeat(np.log(sigma)[:, None], 3, axis=1).astype(np.float32), **comum)
        gravar_metadados(nome, len(pos), m_p, g, "snapshot_090.hdf5 inteiro")
    res = {"n": len(pos), "tempo_redonda_s": time.perf_counter() - t0,
           "mb_redonda": (PASTA / "dados" / f"{nome}.spz").stat().st_size / 1e6,
           "grao_kpc_h": g * 1e3, "memoria_gb": proc.memory_info().rss / 1e9}
    if alongada:
        if (PASTA / "dados" / f"{nome}_alongada.spz").exists():
            raise SystemExit(f"{nome}_alongada.spz já existe — não sobrescrevo; apague à mão se quiser refazer.")
        import anisotropia as an
        t1 = time.perf_counter()
        f = an.formas(pos, h.astype(np.float64), L)
        escalas = sigma[:, None] * f["fatores"]
        ez.gravar_spz_dados(PASTA / "dados" / f"{nome}_alongada.spz",
                            log_escalas=np.log(escalas).astype(np.float32),
                            quat=f["quat"].astype(np.float32), **comum)
        gravar_metadados(f"{nome}_alongada", len(pos), m_p, g, "snapshot_090.hdf5 inteiro, manchas alongadas")
        res.update({"tempo_alongada_s": time.perf_counter() - t1,
                    "mb_alongada": (PASTA / "dados" / f"{nome}_alongada.spz").stat().st_size / 1e6})
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--alongada", action="store_true")
    print(json.dumps(main(ap.parse_args().alongada), indent=1, ensure_ascii=False))
