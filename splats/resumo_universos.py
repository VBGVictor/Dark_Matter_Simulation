"""
resumo_universos.py — números simples de cada universo CAMELS 1P para o painel (F3.11, 21/10/2026)
=================================================================================================

Pedido do Victor (21/10): "um cientista entende, mas eu olho e não entendo" → o painel de universos
mostra, além dos controles, NÚMEROS REAIS de cada simulação, para o olho ter onde se apoiar.

Medidas (todas da versão 1/8 de cada universo, densidade pelo estimador A na própria versão:
ρ = 31·m / (4/3·π·h³), h = σ/α — a mesma definição de gerar_splats.py):
  massa_relativa      massa total ÷ a da referência = Ωm / 0,3 (exato, pela massa das partículas)
  frac_massa_densa    fração da massa em regiões com ρ > 200 × a densidade média DESTE universo —
                      200× é o limiar usual da área para "dentro de um halo" (ex.: M200); aqui é uma
                      APROXIMAÇÃO por partícula (não é um catálogo de halos), dito no painel
  frac_volume_vazio   fração do volume com ρ < 0,2 × a média deste universo; volume de cada mancha =
                      m/ρ, normalizado pela soma (os volumes do kNN não somam exatamente a caixa — F2.1, T4)
Precisão: o .spz guarda o tamanho da mancha em degraus de 1/16 em log → ρ de cada mancha ±9 %; nas
frações (milhões de manchas) o efeito some na média.

Uso:  python resumo_universos.py      (grava dados/universos/resumo.json; não sobrescreve)
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

import exportar_ply as ep
import exportar_spz as ez
import gerar_splats as gs

PASTA = Path(__file__).resolve().parent
UNIV = PASTA / "dados" / "universos"
ARQ = UNIV / "resumo.json"


def medir(sim: str) -> dict:
    meta = json.loads((UNIV / f"{sim}_1_8.json").read_text(encoding="utf-8"))
    d = ez.ler_spz(UNIV / f"{sim}_1_8.spz")
    m = meta["massa_por_splat_msun_h"]
    om = meta["universo"]["omega_m"]
    h = d["sigma"].astype(np.float64) / gs.alfa_gaussiana()
    rho = 31 * m / (4 / 3 * np.pi * h ** 3)
    rho_media = om / 0.3 * ep.RHO_M          # ep.RHO_M é a média da referência (Ωm = 0,3)
    vol = m / rho
    return {"sim": sim, "omega_m": om, "sigma8": meta["universo"]["sigma8"],
            "S8": meta["universo"]["sigma8"] * np.sqrt(om / 0.3),
            "massa_relativa": om / 0.3,
            "frac_massa_densa": float(np.mean(rho > 200 * rho_media)),
            "frac_volume_vazio": float(vol[rho < 0.2 * rho_media].sum() / vol.sum()),
            "mediana_rho_sobre_media": float(np.median(rho / rho_media))}


if __name__ == "__main__":
    if ARQ.exists():
        raise SystemExit("resumo.json já existe — não sobrescrevo; apague à mão se quiser refazer.")
    sims = sorted(p.name.replace("_1_8.json", "") for p in UNIV.glob("1P_p*_1_8.json"))
    res = {"nota": "versão 1/8, estimador A na própria versão; 200× e 0,2× a média DO universo; aproximação por partícula",
           "universos": {s: medir(s) for s in sims}}
    ARQ.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
    for s, r in res["universos"].items():
        print(f"{s:9s} Ωm {r['omega_m']:.1f} σ8 {r['sigma8']:.1f} | massa ×{r['massa_relativa']:.2f} | "
              f"massa em aglomerados {100 * r['frac_massa_densa']:.1f} % | volume vazio {100 * r['frac_volume_vazio']:.1f} % | "
              f"mediana {r['mediana_rho_sobre_media']:.1f}×")
