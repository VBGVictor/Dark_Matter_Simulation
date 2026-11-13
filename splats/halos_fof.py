"""
halos_fof.py — halos dos universos CAMELS 1P pelo método friends-of-friends (F3.15 nos universos, 21/10/2026)
============================================================================================================

Motivo: "ir até um aglomerado" (tecla M) usava o catálogo oficial Rockstar, que só existe para a simulação
padrão (CV_0); o das simulações 1P não foi publicado (pasta vazia no servidor). O Victor: "é uma ferramenta
boa e precisa voltar a funcionar". Sem baixar nada: localizamos os halos nós mesmos, com o método publicado
mais clássico da área.

Método: friends-of-friends (Davis, Efstathiou, Frenk & White 1985): duas partículas são "amigas" se estão
a menos de b × (separação média); um halo é um grupo de amigos-de-amigos. b = 0,2: a convenção usual da área
(ex.: Millennium, Springel et al. 2005, "linking length equal to 0.2 of the mean particle separation"; Tinker et al.
2008). CORREÇÃO de 21/10: a 1ª versão dizia "o valor padrão do artigo" — o artigo de Davis et al. usa b = 0,25
(e mostra que agrupa a ~200× a densidade média); conferido no PDF.
Feito na versão 1/8 de cada universo (as partículas que o navegador desenha), caixa periódica.
  mínimo de 20 manchas por grupo (CONVENÇÃO usual; na 1/8 = 160 partículas da simulação)
  centro = centro de massa, com a caixa periódica desembrulhada a partir do 1º membro
  massa = nº de manchas × massa da mancha
  raio do anel = raio que conteria essa massa a 200× a densidade média DO universo (estimativa, dito no cartão;
                 o FoF não define um raio)
Diferente do Rockstar (massa virial; aqui massa do grupo FoF) — o cartão diz qual definição foi usada.

VALIDAÇÃO antes de usar (critério registrado ANTES de rodar, 21/10/2026): rodando na CV_0 (versão 1/8), os 10
maiores halos do Rockstar oficial precisam ter um grupo FoF a menos de 0,3 Mpc/h, e a razão de massas
FoF/Mvir (mediana dos 10) entre 0,8 e 1,25.

Saídas: dados/universos/<sim>_halos.json (mesmo formato do halos_marcadores.json) e dados/universos/validacao_fof.json
Uso:  python halos_fof.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

import exportar_ply as ep
import exportar_spz as ez

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent / "calculos"))
import teoria_lcdm as teo  # noqa: E402

DADOS = PASTA / "dados"
UNIV = DADOS / "universos"
L = 25.0
B = 0.2
MINIMO = 20


def fof(arq_spz: Path, m_mancha: float, omega_m: float) -> list[list]:
    """Halos FoF da versão: [[x, y, z (desenho, Mpc/h), massa (M☉), raio (Mpc/h), n_sub=None], …] por massa."""
    d = ez.ler_spz(arq_spz)
    pos = np.mod(d["pos"].astype(np.float64) + L / 2, L)
    n = len(pos)
    ll = B * L / n ** (1 / 3)
    pares = cKDTree(pos, boxsize=L).query_pairs(ll, output_type="ndarray")
    g = coo_matrix((np.ones(len(pares), np.int8), (pares[:, 0], pares[:, 1])), shape=(n, n))
    _, rot = connected_components(g, directed=False)
    tam = np.bincount(rot)
    grupos = np.flatnonzero(tam >= MINIMO)
    ordem = np.argsort(rot, kind="stable")
    inicio = np.concatenate([[0], np.cumsum(tam)[:-1]])
    rho_media = omega_m * teo.densidade_critica_h2()          # M☉/h por (Mpc/h)³, deste universo
    h = teo.COSMO.h
    halos = []
    for gid in grupos:
        membros = ordem[inicio[gid]: inicio[gid] + tam[gid]]
        p = pos[membros]
        rel = (p - p[0] + L / 2) % L - L / 2                    # desembrulha a caixa periódica
        centro = (p[0] + rel.mean(axis=0)) % L - L / 2          # coordenadas do desenho
        massa = tam[gid] * m_mancha                             # M☉/h
        raio = (3 * massa / (4 * np.pi * 200 * rho_media)) ** (1 / 3)
        halos.append([round(float(centro[0]), 4), round(float(centro[1]), 4), round(float(centro[2]), 4),
                      float(f"{massa / h:.4e}"), round(float(raio), 5), None])
    halos.sort(key=lambda x: -x[3])
    return halos


def validar_cv0() -> dict:
    meta = json.loads((DADOS / "teia_1_8_magma.json").read_text(encoding="utf-8"))
    halos = fof(DADOS / "teia_1_8_magma.spz", meta["massa_por_splat_msun_h"], 0.3)
    rock = json.loads((DADOS / "halos_marcadores.json").read_text(encoding="utf-8"))["halos"][:10]
    c_fof = np.array([x[:3] for x in halos])
    linhas, distancias, razoes = [], [], []
    for r in rock:
        dd = np.abs(c_fof - np.array(r[:3]))
        dd = np.minimum(dd, L - dd)
        dist = np.sqrt((dd ** 2).sum(axis=1))
        j = int(np.argmin(dist))
        distancias.append(float(dist[j])); razoes.append(halos[j][3] / r[3])
        linhas.append({"rockstar_massa_msun": r[3], "fof_massa_msun": halos[j][3], "distancia_mpc_h": float(dist[j]),
                       "posicao_fof": j + 1})
    passou = max(distancias) < 0.3 and 0.8 <= float(np.median(razoes)) <= 1.25
    return {"criterio": "10 maiores do Rockstar com grupo FoF a < 0,3 Mpc/h e mediana FoF/Mvir em [0,8; 1,25]",
            "passou": bool(passou), "distancia_max_mpc_h": max(distancias), "razao_massa_mediana": float(np.median(razoes)),
            "n_grupos_fof": len(halos), "detalhe": linhas}


if __name__ == "__main__":
    t0 = time.perf_counter()
    val = validar_cv0()
    (UNIV / "validacao_fof.json").write_text(json.dumps(val, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"VALIDAÇÃO na CV_0: {'PASSOU' if val['passou'] else 'FALHOU'} — distância máx {val['distancia_max_mpc_h']:.3f} Mpc/h, "
          f"massa FoF/Mvir mediana {val['razao_massa_mediana']:.3f}, {val['n_grupos_fof']} grupos")
    if not val["passou"]:
        raise SystemExit("validação falhou: não gravo os halos dos universos (critério prévio)")
    for arq in sorted(UNIV.glob("1P_p*_1_8.json")):
        sim = arq.name.replace("_1_8.json", "")
        destino = UNIV / f"{sim}_halos.json"
        if destino.exists():
            print(f"{sim}: já existe, pulando"); continue
        meta = json.loads(arq.read_text(encoding="utf-8"))
        om = meta["universo"]["omega_m"]
        halos = fof(UNIV / f"{sim}_1_8.spz", meta["massa_por_splat_msun_h"], om)
        m_part = meta["massa_por_splat_msun_h"] / 8 / teo.COSMO.h   # partícula da simulação completa, M☉
        saida = {"fonte": f"friends-of-friends (método: Davis et al. 1985; b = {B} como no Millennium, Springel et al. 2005) na versão 1/8 de {sim}, ≥ {MINIMO} manchas",
                 "colunas": ["x", "y", "z", "mvir_msun", "rvir_mpc_h", "n_sub"],
                 "definicao_massa": "massa do grupo FoF (não é a massa virial do Rockstar)",
                 "definicao_raio": "raio estimado: a massa a 200× a densidade média deste universo",
                 "coordenadas": "desenho: posição − L/2 [Mpc/h], caixa centrada na origem",
                 "massa_particula_msun": m_part, "total": len(halos), "halos": halos}
        destino.write_text(json.dumps(saida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{sim}: {len(halos)} halos, maior {halos[0][3]:.3e} M☉")
    print(f"tempo total {time.perf_counter() - t0:.0f} s")
