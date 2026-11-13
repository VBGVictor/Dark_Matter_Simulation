"""
classes_halos.py — legenda "o que é cada mancha" do visualizador (pedido do Victor, 16/10/2026)
===============================================================================================

Gera `dados/classes_halos.json` com uma classificação simples dos aglomerados (halos) da
simulação, tirada SÓ do catálogo oficial Rockstar do CAMELS (hlist_1.00000.list) — nenhum
número digitado à mão.

O que é dado e o que é convenção:
  DADO (catálogo): massa Mvir (Bryan & Norman 1998) e raio Rvir de cada halo; quantos halos
                   há em cada faixa; mediana de massa, de partículas e de raio.
  CONVENÇÃO (da área, não da física): as fronteiras das classes em potências de 10 de M☉ e
                   os nomes "anão / galáxia / tipo Via Láctea / grupo / aglomerado". A física
                   não tem fronteira exata entre as classes; os nomes seguem o uso comum
                   (halo da Via Láctea ≈ 10¹² M☉; grupos 10¹³–10¹⁴; aglomerados > 10¹⁴).
  Só halos principais (pid = −1); sub-halos ficam dentro deles e não são contados à parte.
  O Rockstar só guarda halos com ≥ 100 partículas no grupo que ele acha (rockstar_params.cfg);
  a Mvir conta só o que está dentro do raio virial e pode equivaler a menos de 100 partículas.
  1ª versão (16/10) usava fronteiras em M☉/h: a própria Via Láctea (~1–1,5×10¹² M☉) cairia
  na classe "de galáxia" — trocado para M☉, a unidade em que os nomes são usados.

Unidades no .json: massas em M☉ (já divididas por h), raios em kpc e em anos-luz (comóvel,
z = 0, já divididos por h) — o visualizador mostra como está, sem fazer conta.

Uso:  python classes_halos.py      (não sobrescreve: se o .json existir, para)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent / "calculos"))
import fase1_conferencia as f1  # noqa: E402
import teoria_lcdm as teo  # noqa: E402

ARQ = PASTA / "dados" / "classes_halos.json"
ANOS_LUZ_POR_KPC = 3261.563777  # 1 kpc = 3.261,56 anos-luz (IAU)

# (limite inferior, limite superior) em M☉ — convenção, ver docstring
CLASSES = [
    ("Halo anão", 0.0, 1e11),
    ("Halo de galáxia", 1e11, 1e12),
    ("Halo tipo Via Láctea", 1e12, 1e13),
    ("Grupo de galáxias", 1e13, 1e14),
    ("Aglomerado de galáxias", 1e14, np.inf),
]


def classes() -> dict:
    """Conta e resume os halos principais do catálogo por faixa de massa."""
    r = f1.ler_rockstar()
    h = teo.COSMO.h
    m_p = teo.massa_particula()  # M☉/h
    principal = r["pid"] == -1
    m, R = r["Mvir"][principal] / h, r["Rvir"][principal] / h   # M☉ e kpc
    saida = []
    for nome, a, b in CLASSES:
        s = (m >= a) & (m < b)
        item = {"nome": nome, "faixa_msun": [a, None if np.isinf(b) else b], "quantos": int(s.sum())}
        if s.any():
            item.update({
                "massa_mediana_msun": float(np.median(m[s])),
                "massa_min_msun": float(m[s].min()), "massa_max_msun": float(m[s].max()),
                "particulas_mediana": int(round(np.median(m[s]) / (m_p / h))),
                "raio_mediano_kpc": float(np.median(R[s])),
                "raio_mediano_anos_luz": float(np.median(R[s]) * ANOS_LUZ_POR_KPC),
            })
        saida.append(item)
    return {"fonte": "CAMELS IllustrisTNG_DM/CV/CV_0, Rockstar hlist_1.00000.list (z = 0), só halos principais",
            "definicao_massa": "Mvir (Bryan & Norman 1998), dentro do raio virial; Rockstar guarda grupos com >= 100 partículas",
            "convencao": "fronteiras em potências de 10 de M☉ e nomes = uso comum da área, não física",
            "massa_particula_msun": m_p / h,
            "total_halos_principais": int(principal.sum()),
            "classes": saida}


if __name__ == "__main__":
    if ARQ.exists():
        raise SystemExit(f"{ARQ.name} já existe — não sobrescrevo; apague à mão se quiser refazer.")
    d = classes()
    ARQ.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(d, indent=1, ensure_ascii=False))
