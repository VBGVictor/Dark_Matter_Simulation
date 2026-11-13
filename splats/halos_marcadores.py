"""
halos_marcadores.py — dados do filtro "ir até um aglomerado" (F3.15, decisão do Victor 14/10 e 19/10/2026)
=========================================================================================================

Gera `dados/halos_marcadores.json` com os halos PRINCIPAIS do catálogo oficial Rockstar do CAMELS
(hlist_1.00000.list, z = 0), em ordem de massa (maior primeiro). Nenhum número digitado à mão.

Por halo (lista compacta, na ordem das colunas em "colunas"):
  x, y, z     centro em coordenadas do DESENHO [Mpc/h]: posição do catálogo − L/2 (a caixa do
              visualizador é centrada na origem — mesma conversão do exportar_ply.py). Conferido:
              o maior halo (x = 0,6309) cai em −11,869, igual à comparação 1/8 × completa (15/10).
  mvir_msun   massa virial Mvir (Bryan & Norman 1998) em M☉ (dividida por h)
  rvir_mpc_h  raio virial em Mpc/h (comóvel; o catálogo dá kpc/h) — tamanho do anel no desenho
  n_sub       sub-halos do catálogo dentro dele (upid = id do halo principal)

Avisos (ditos também na tela):
  * Caixa periódica: um halo encostado na borda continua do outro lado na simulação; o desenho
    não dá a volta, então ali o halo aparece cortado.
  * O Rockstar só guarda grupos com ≥ 100 partículas.

Uso:  python halos_marcadores.py      (não sobrescreve: se o .json existir, para)
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

ARQ = PASTA / "dados" / "halos_marcadores.json"


def halos() -> dict:
    """Lê o hlist (colunas do cabeçalho: id 1, upid 6, Mvir 10, Rvir 11, x/y/z 17–19)."""
    d = np.loadtxt(f1.ARQ_ROCKSTAR, comments="#", usecols=(1, 6, 10, 11, 17, 18, 19))
    ident, upid, mvir, rvir, xyz = d[:, 0].astype(np.int64), d[:, 1].astype(np.int64), d[:, 2], d[:, 3], d[:, 4:7]
    h, L = teo.COSMO.h, teo.SIM.caixa_mpc_h
    principal = upid == -1
    # sub-halos por halo principal. upid deveria apontar direto para o halo principal, mas em 3
    # dos 1.189 sub-halos ele aponta para outro sub-halo (achado em 19/10: a soma dava 1.186) →
    # sobe a cadeia até chegar num halo principal.
    upid_de = dict(zip(ident.tolist(), upid.tolist()))
    def raiz(u: int) -> int:
        for _ in range(50):
            if upid_de.get(u, -1) == -1:
                return u
            u = upid_de[u]
        raise ValueError(f"cadeia de upid sem fim a partir de {u}")
    ids_sub, contagem = np.unique([raiz(int(u)) for u in upid[~principal]], return_counts=True)
    n_sub = dict(zip(ids_sub.tolist(), contagem.tolist()))
    idx = np.flatnonzero(principal)
    idx = idx[np.argsort(-mvir[idx], kind="stable")]
    linhas = [[round(float(xyz[i, 0] - L / 2), 4), round(float(xyz[i, 1] - L / 2), 4), round(float(xyz[i, 2] - L / 2), 4),
               float(f"{mvir[i] / h:.4e}"), round(float(rvir[i]) / 1000, 5), int(n_sub.get(int(ident[i]), 0))]
              for i in idx]
    return {"fonte": "CAMELS IllustrisTNG_DM/CV/CV_0, Rockstar hlist_1.00000.list (z = 0), só halos principais (upid = -1)",
            "colunas": ["x", "y", "z", "mvir_msun", "rvir_mpc_h", "n_sub"],
            "coordenadas": "desenho: posição do catálogo − L/2 [Mpc/h], caixa centrada na origem",
            "massa_particula_msun": teo.massa_particula() / h,
            "total": len(linhas), "halos": linhas}


if __name__ == "__main__":
    if ARQ.exists():
        raise SystemExit(f"{ARQ.name} já existe — não sobrescrevo; apague à mão se quiser refazer.")
    dados = halos()
    ARQ.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{dados['total']} halos → {ARQ.name} ({ARQ.stat().st_size / 1e3:.0f} kB); maior: {dados['halos'][0]}")
