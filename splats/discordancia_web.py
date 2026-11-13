"""
discordancia_web.py — dados da camada "incerteza do método" (F3.8, 21/10/2026)
=============================================================================

Motivo (Victor, 21/10): no filtro de estimador (F3.7) a diferença entre as fórmulas quase não se vê —
a escala de cor cobre 6 décadas de densidade e os estimadores discordam em dezenas de por cento.
Esta camada pinta a DIFERENÇA em vez da densidade: log₁₀(ρ_X / ρ_A) de cada mancha, X ∈ {C, B, D},
numa paleta divergente. É só a razão entre dois métodos publicados — nada inventado.

Grava, por versão leve (1/64 e 1/8):
  dados/discordancia_<versao>.bin  int8: q = round(log₁₀(ρ_X/ρ_A) / PASSO), limitado a ±127, em blocos
                                   [C/A (N), B/A (N), D/A (N)], na ordem das manchas do .spz.
                                   PASSO = 0,01 em log₁₀ (2,3 % de densidade, mais fino que a tela);
                                   ±127 → ±1,27 em log₁₀ (÷18,6 a ×18,6) cobre até os percentis 0,1/99,9.
                                   Densidade da partícula na RESOLUÇÃO COMPLETA (a mesma da F3.7).
e uma vez:
  dados/paleta_divergente.json     as 256 cores da paleta "coolwarm" (Moreland 2009, "Diverging Color
                                   Maps for Scientific Visualization": cinza claro no centro = concordam)
                                   + a escala de exibição: ±log₁₀(3), de ÷3 a ×3 (CONVENÇÃO: medido em
                                   21/10, deixa ~95 % das manchas sem saturar; além disso a cor satura).

Distribuição medida (21/10, versão 1/8, log₁₀ da razão): C/A mediana −0,002 (p5 −0,40, p95 +0,46);
B/A mediana +0,127 (×1,34; p5 −0,13, p95 +0,51); D/A mediana +0,149 (×1,41; p5 −0,12, p95 +0,56).

Uso:  python discordancia_web.py      (não sobrescreve: para se algum arquivo existir)
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

PASTA = Path(__file__).resolve().parent
DADOS = PASTA / "dados"
VERSOES = {"1_64": "sub_1_64.npz", "1_8": "sub_1_8.npz"}
PARES = (("C", "C_sph_sem_propria"), ("B", "B_sph_gadget"), ("D", "D_wendland_dehnen_aly"))
PASSO = 0.01
ESCALA = float(np.log10(3.0))


def gravar_versao(versao: str, origem: str) -> dict:
    d = np.load(DADOS / origem)
    a = d["rho_msun_h_por_mpc_h3_A_knn_resolucao_completa"].astype(np.float64)
    blocos, resumo = [], {}
    for nome, chave in PARES:
        r = np.log10(d[f"rho_msun_h_por_mpc_h3_{chave}_resolucao_completa"].astype(np.float64) / a)
        q = np.clip(np.round(r / PASSO), -127, 127).astype(np.int8)
        blocos.append(q)
        resumo[f"{nome}/A"] = {"mediana_log10": float(np.median(r)),
                               "erro_max_quantizacao_log10": float(np.max(np.abs(q * PASSO - r)[np.abs(r) <= 1.27])),
                               "fora_da_faixa_pct": float(100 * np.mean(np.abs(r) > 1.27)),
                               "saturado_na_tela_pct": float(100 * np.mean(np.abs(r) > ESCALA))}
    arq = DADOS / f"discordancia_{versao}.bin"
    arq.write_bytes(np.concatenate(blocos).tobytes())
    return {"arquivo": arq.name, "n": int(len(a)), "mb": arq.stat().st_size / 1e6, "pares": resumo}


def gravar_paleta() -> dict:
    lut = np.round(plt.get_cmap("coolwarm")(np.arange(256))[:, :3], 8).tolist()
    info = {"nome": "coolwarm (Moreland 2009)", "lut": lut, "passo_log10": PASSO, "escala_log10": ESCALA,
            "pares": [p[0] for p in PARES], "referencia": "A",
            "regra": "r = q·passo; v = clip((r + escala) / (2·escala), 0, 1); indice = min(255, floor(v·256))"}
    (DADOS / "paleta_divergente.json").write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
    return {"arquivo": "paleta_divergente.json", "centro_rgb": lut[128]}


if __name__ == "__main__":
    alvos = [DADOS / f"discordancia_{v}.bin" for v in VERSOES] + [DADOS / "paleta_divergente.json"]
    existentes = [x.name for x in alvos if x.exists()]
    if existentes:
        raise SystemExit(f"já existem: {existentes} — não sobrescrevo; apague à mão se quiser refazer.")
    res = {v: gravar_versao(v, o) for v, o in VERSOES.items()}
    res["paleta"] = gravar_paleta()
    print(json.dumps(res, indent=1, ensure_ascii=False))
