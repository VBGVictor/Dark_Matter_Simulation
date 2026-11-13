"""
esqueleto_mst.py — o esqueleto da teia pela árvore geradora mínima dos halos (F3.20, 28/10/2026)
================================================================================================

Pedido do Victor (21/10): "a câmera andando por dentro das teias principais e terminando numa menor".
O catálogo oficial de filamentos do CAMELS (DisPerSE) não é público → usamos o método publicado mais simples
que liga halos em filamentos: a ÁRVORE GERADORA MÍNIMA (em inglês MST).

Método (cada passo com a fonte; lista com link em ../REFERENCIAS.xlsx):
  1. Nós = TODOS os objetos do catálogo oficial Rockstar (5.958 halos principais + 1.189 sub-halos).
     Colberg 2007 (MNRAS 375, 337), nota 3: "para halos grandes usamos os sub-halos [...] o raio virial dos
     halos do tamanho de aglomerados é maior que o comprimento de ligação; usando só os halos, eles ficariam de
     fora". Conferido aqui: só com os halos principais, o MAIOR halo fica sozinho (vizinho mais perto além do b).
  2. Árvore geradora mínima: liga todos os nós com o menor comprimento total de ligações, sem laços
     (Barrow, Bhavsar & Sonoda 1985, MNRAS 216, 17 — PDF não acessível: ADS 404 e revista 403 em 28/10;
     método descrito em Colberg 2007 §3.3 e Alpaslan et al. 2014 §3.1). Caixa periódica: distância pelo
     caminho mais curto. Cálculo: grafo dos 20 vizinhos mais próximos (scipy) → MST; o verificador confere com
     um algoritmo de Prim independente, na matriz completa de distâncias.
  3. Filamentos: cortam-se as ligações mais longas que b (Alpaslan et al. 2014, MNRAS 438, 177, §3.1.1); o que
     continua ligado é um filamento. Escolha de b pelo critério DO ARTIGO: o MENOR b em que > 90 % dos grupos
     brilhantes estão em filamentos. Adaptação (dita na tela): "brilhante" = halos principais acima do mesmo
     quantil do artigo (98,65 %); "em filamento" = ligado a pelo menos 1 OUTRO halo principal (o artigo pede ≥ 2
     grupos — sub-halos do próprio halo não contam). O b = 5,75 Mpc/h do artigo NÃO se aplica aqui: lá os nós são
     grupos de galáxias, bem mais espaçados que os nossos halos (≥ 100 partículas).
  4. Voo: começa no maior halo e segue pela árvore até a ponta MAIS DISTANTE do filamento dele (distância medida
     ao longo das ligações) — o ramo mais longo que sai do maior halo; a ponta é um halo pequeno. É o mesmo
     espírito da "espinha" de Alpaslan (§3.1.2: o caminho mais longo de uma ponta à outra).

  5. PASSEIO "montanha-russa" (pedido do Victor, 28/10: "passear pelo cubo quase inteiro", sentado em cima da
     linha): a ESPINHA DA ÁRVORE INTEIRA (sem corte) = o caminho mais longo de uma ponta à outra (diâmetro da árvore;
     Alpaslan §3.1.2 define a espinha assim dentro de cada filamento; Colberg 2007 usa a árvore sem cortar). Achado:
     ela passa pelo maior halo. Ligações mais longas que b atravessam regiões menos densas entre filamentos — marcadas
     no arquivo e na tela. Atravessa as paredes da caixa periódica (o que sai de um lado entra pelo outro).
     Cobertura medida: fração do cubo a até 2,5 e 4 Mpc/h do trilho (grade de 1 Mpc/h).

Limites (ditos na tela): o esqueleto liga CENTROS de halos com segmentos retos — não segue as cristas de
densidade; existe só no Universo 1 (os universos do laboratório não têm sub-halos: os halos do FoF não guardam
subestrutura) e só para hoje (z = 0).

Saídas (não sobrescreve; cada uma é pulada se já existir): dados/esqueleto_mst.json, dados/esqueleto_passeio.json
Uso:  python esqueleto_mst.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, minimum_spanning_tree, shortest_path
from scipy.spatial import cKDTree

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent / "calculos"))
import fase1_conferencia as f1  # noqa: E402
import teoria_lcdm as teo  # noqa: E402

ARQ = PASTA / "dados" / "esqueleto_mst.json"
ARQ_PASSEIO = PASTA / "dados" / "esqueleto_passeio.json"
L = teo.SIM.caixa_mpc_h
VIZINHOS = 20                 # grafo de vizinhos para a MST (conferido contra Prim denso no verificador)
QUANTIL_BRILHANTE = 0.9865    # Alpaslan et al. 2014 §3.1.1: "roughly equivalent to the 98.65% quantile"
FRACAO_MINIMA = 0.9           # Alpaslan et al. 2014 §3.1.1: "fraction of these bright groups in filaments > 0.9"
PASSO_B = 0.01                # Mpc/h, varredura do b


def ler_catalogo() -> dict:
    """Todos os objetos do Rockstar (z = 0): posição [0, L) Mpc/h, massa M☉/h, se é principal e o halo principal
    dono (índice na lista POR MASSA do halos_marcadores.json — a mesma ordem do cartão do aglomerado)."""
    d = np.loadtxt(f1.ARQ_ROCKSTAR, comments="#", usecols=(1, 6, 10, 11, 17, 18, 19))
    ident, upid, mvir = d[:, 0].astype(np.int64), d[:, 1].astype(np.int64), d[:, 2]
    pos = np.mod(d[:, 4:7], L)
    principal = upid == -1
    upid_de = dict(zip(ident.tolist(), upid.tolist()))

    def raiz(u: int) -> int:   # mesma subida de cadeia do halos_marcadores.py (3 sub-halos apontam para sub-halos)
        for _ in range(50):
            if upid_de.get(u, -1) == -1:
                return u
            u = upid_de[u]
        raise ValueError(f"cadeia de upid sem fim a partir de {u}")

    idx = np.flatnonzero(principal)
    idx = idx[np.argsort(-mvir[idx], kind="stable")]
    ordem_de_id = {int(ident[i]): k for k, i in enumerate(idx)}
    dono = np.array([ordem_de_id[int(ident[i])] if principal[i] else ordem_de_id[raiz(int(upid[i]))]
                     for i in range(len(ident))])
    return {"pos": pos, "mvir": mvir, "principal": principal, "dono": dono}


def arvore_minima(pos: np.ndarray, k: int = VIZINHOS) -> tuple[np.ndarray, np.ndarray]:
    """MST com distância periódica: arestas (n−1, 2) e comprimentos (n−1,) em Mpc/h."""
    n = len(pos)
    dist, idx = cKDTree(pos, boxsize=L).query(pos, k=k + 1)
    g = coo_matrix((dist[:, 1:].ravel(), (np.repeat(np.arange(n), k), idx[:, 1:].ravel())), shape=(n, n)).tocsr()
    t = minimum_spanning_tree(g).tocoo()
    if connected_components(t, directed=False)[0] != 1:
        raise RuntimeError(f"grafo de {k} vizinhos desconexo: aumente VIZINHOS")
    return np.c_[t.row, t.col], t.data


def componentes(n: int, arestas: np.ndarray, comp: np.ndarray, b: float) -> np.ndarray:
    """Rótulo do filamento de cada nó depois de cortar as ligações mais longas que b."""
    k = comp <= b
    g = coo_matrix((comp[k], (arestas[k, 0], arestas[k, 1])), shape=(n, n))
    return connected_components(g, directed=False)[1]


def fracao_brilhantes(cat: dict, arestas: np.ndarray, comp: np.ndarray, b: float) -> float:
    """Fração dos halos brilhantes ligados a pelo menos 1 OUTRO halo principal (critério adaptado de Alpaslan)."""
    rot = componentes(len(cat["pos"]), arestas, comp, b)
    principais_no_filamento = np.bincount(rot, weights=cat["principal"].astype(float))
    m_princ = cat["mvir"][cat["principal"]]
    brilhante = cat["principal"] & (cat["mvir"] >= np.quantile(m_princ, QUANTIL_BRILHANTE))
    return float((principais_no_filamento[rot][brilhante] >= 2).mean())


def escolher_b(cat: dict, arestas: np.ndarray, comp: np.ndarray) -> tuple[float, list]:
    """Menor b (passo 0,01 Mpc/h) com fração de brilhantes em filamentos > 0,9. Devolve b e a tabela da varredura."""
    tabela = []
    for b in np.round(np.arange(PASSO_B, comp.max() + PASSO_B, PASSO_B), 2):
        f = fracao_brilhantes(cat, arestas, comp, float(b))
        tabela.append([float(b), round(f, 4)])
        if f > FRACAO_MINIMA:
            return float(b), tabela
    raise RuntimeError("nenhum b satisfaz o critério")


def caminho_do_voo(n: int, arestas: np.ndarray, comp: np.ndarray, b: float, inicio: int) -> tuple[list[int], float]:
    """Caminho pela árvore (só ligações ≤ b) do nó `inicio` até o nó mais distante do mesmo filamento."""
    k = comp <= b
    g = coo_matrix((comp[k], (arestas[k, 0], arestas[k, 1])), shape=(n, n)).tocsr()
    dist, pred = shortest_path(g, directed=False, indices=inicio, return_predecessors=True)
    alcancavel = np.isfinite(dist)
    fim = int(np.flatnonzero(alcancavel)[np.argmax(dist[alcancavel])])
    cam = [fim]
    while cam[-1] != inicio:
        cam.append(int(pred[cam[-1]]))
    return cam[::-1], float(dist[fim])


def diametro(n: int, arestas: np.ndarray, comp: np.ndarray, de: int) -> tuple[list[int], float]:
    """Caminho mais longo da árvore inteira (sem corte): varredura dupla — a ponta mais distante de `de`, e depois a
    ponta mais distante dessa. Numa árvore isso dá exatamente o diâmetro."""
    g = coo_matrix((comp, (arestas[:, 0], arestas[:, 1])), shape=(n, n)).tocsr()
    d1 = shortest_path(g, directed=False, indices=de)
    a = int(np.argmax(d1))
    d2, pred = shortest_path(g, directed=False, indices=a, return_predecessors=True)
    z = int(np.argmax(d2))
    cam = [z]
    while cam[-1] != a:
        cam.append(int(pred[cam[-1]]))
    return cam[::-1], float(d2[z])


def desembrulhar(pos: np.ndarray, cam: list[int]) -> tuple[np.ndarray, np.ndarray, int]:
    """Pontos do caminho contínuos (sem o salto da parede periódica), comprimento de cada passo e quantas vezes cruza."""
    pts, passos, cruza = [pos[cam[0]].copy()], [], 0
    for a, c in zip(cam[:-1], cam[1:]):
        d = pos[c] - pos[a]
        if np.any(np.abs(d) > L / 2):
            cruza += 1
        d -= L * np.round(d / L)
        pts.append(pts[-1] + d)
        passos.append(float(np.linalg.norm(d)))
    return np.array(pts), np.array(passos), cruza


def cobertura(pts: np.ndarray, raio: float) -> float:
    """Fração do cubo (grade de 1 Mpc/h) a até `raio` Mpc/h do trilho (amostrado a cada ~1/10 de passo), periódica."""
    finos = [pts[0]]
    for a, c in zip(pts[:-1], pts[1:]):
        finos += [a + f * (c - a) for f in np.linspace(0.1, 1, 10)]
    arvore = cKDTree(np.mod(np.array(finos), L), boxsize=L)
    grade = np.stack(np.meshgrid(*[np.arange(0.5, L, 1.0)] * 3, indexing="ij"), -1).reshape(-1, 3)
    return float((arvore.query(grade)[0] <= raio).mean())


def recortar_na_caixa(a: np.ndarray, d: np.ndarray) -> np.ndarray:
    """Segmento a → a + d (coordenadas [0, L)) cortado onde sai da caixa: devolve o ponto final dentro dela."""
    t = 1.0
    for e in range(3):
        if d[e] > 0 and a[e] + d[e] > L:
            t = min(t, (L - a[e]) / d[e])
        elif d[e] < 0 and a[e] + d[e] < 0:
            t = min(t, -a[e] / d[e])
    return a + t * d


def segmentos(pos: np.ndarray, arestas: np.ndarray, comp: np.ndarray, b: float, rot: np.ndarray,
              no_filamento: np.ndarray) -> tuple[list, int]:
    """Segmentos para desenhar (coordenadas do desenho, caixa centrada). Ligação que atravessa a parede da caixa
    periódica vira dois pedaços, cada um até a parede."""
    saida, cruzam = [], 0
    for (i, j), c in zip(arestas, comp):
        if c > b or not no_filamento[rot[i]]:
            continue
        d = pos[j] - pos[i]
        d -= L * np.round(d / L)
        if np.allclose(pos[i] + d, pos[j]):
            pares = [(pos[i], pos[j])]
        else:
            cruzam += 1
            pares = [(pos[i], recortar_na_caixa(pos[i], d)), (pos[j], recortar_na_caixa(pos[j], -d))]
        for p, q in pares:
            saida.append([round(float(v - L / 2), 4) for v in (*p, *q)])
    return saida, cruzam


def passeio(cat: dict, arestas: np.ndarray, comp: np.ndarray, b: float) -> dict:
    """O trilho da montanha-russa: espinha da árvore inteira (ver item 5 do cabeçalho)."""
    pos, n = cat["pos"], len(cat["pos"])
    maior = int(np.flatnonzero(cat["principal"] & (cat["dono"] == 0))[0])
    cam, comprimento = diametro(n, arestas, comp, maior)
    pts, passos, cruza = desembrulhar(pos, cam)
    h = teo.COSMO.h
    return {
        "fonte": "CAMELS IllustrisTNG_DM/CV/CV_0, catálogo Rockstar z = 0 (halos principais + sub-halos)",
        "metodo": "espinha da árvore geradora mínima inteira (caminho mais longo de ponta a ponta; Barrow, Bhavsar & "
                  "Sonoda 1985; Colberg 2007; Alpaslan et al. 2014 §3.1.2)",
        "coordenadas": "desenho: posição do catálogo − L/2 [Mpc/h], DESEMBRULHADAS (o navegador dobra para dentro da caixa)",
        "b_mpc_h": b,
        "pontos": [[round(float(v - L / 2), 4) for v in p] for p in pts],
        "donos": [int(cat["dono"][i]) for i in cam],
        "massas_msun": [float(f"{cat['mvir'][i] / h:.4e}") for i in cam],
        "passos_mpc_h": [round(x, 4) for x in passos],
        "comprimento_mpc_h": round(comprimento, 4),
        "comprimento_em_filamento_mpc_h": round(float(passos[passos <= b].sum()), 4),
        "cruza_parede": cruza,
        "indice_maior_halo": cam.index(maior) if maior in cam else None,
        "cobertura": {"ate_2_5_mpc_h": round(cobertura(pts, 2.5), 4), "ate_4_mpc_h": round(cobertura(pts, 4.0), 4)},
    }


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")   # terminal do Windows (cp1252) não imprime "☉"
    if ARQ.exists() and ARQ_PASSEIO.exists():
        raise SystemExit(f"{ARQ.name} e {ARQ_PASSEIO.name} já existem — não sobrescrevo; apague à mão se quiser refazer.")
    t0 = time.perf_counter()
    cat = ler_catalogo()
    pos, n = cat["pos"], len(cat["pos"])
    arestas, comp = arvore_minima(pos)
    b, varredura = escolher_b(cat, arestas, comp)
    if not ARQ_PASSEIO.exists():
        ps = passeio(cat, arestas, comp, b)
        ARQ_PASSEIO.write_text(json.dumps(ps, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"passeio: {ps['comprimento_mpc_h']:.1f} Mpc/h, {len(ps['pontos'])} pontos, cruza parede {ps['cruza_parede']}×, "
              f"passa pelo maior halo no ponto {ps['indice_maior_halo']}, cobertura {ps['cobertura']} → {ARQ_PASSEIO.name} "
              f"({ARQ_PASSEIO.stat().st_size / 1e3:.0f} kB)")
    if ARQ.exists():
        print(f"{ARQ.name} já existe — não sobrescrevo")
        return
    rot = componentes(n, arestas, comp, b)
    principais_por_fil = np.bincount(rot, weights=cat["principal"].astype(float))
    no_filamento = principais_por_fil >= 2                               # por rótulo
    inicio = int(np.flatnonzero(cat["principal"] & (cat["dono"] == 0))[0])
    cam, comprimento = caminho_do_voo(n, arestas, comp, b, inicio)
    # caminho desembrulhado (contínuo mesmo se cruzar a parede)
    pts = [pos[cam[0]].copy()]
    cruza_voo = 0
    for a, c in zip(cam[:-1], cam[1:]):
        d = pos[c] - pos[a]
        if np.any(np.abs(d) > L / 2):
            cruza_voo += 1
        d -= L * np.round(d / L)
        pts.append(pts[-1] + d)
    segs, cruzam = segmentos(pos, arestas, comp, b, rot, no_filamento)
    h = teo.COSMO.h
    halos_fil = int(np.sum(cat["principal"] & no_filamento[rot]))
    fil_maior = rot[inicio]
    saida = {
        "fonte": "CAMELS IllustrisTNG_DM/CV/CV_0, catálogo Rockstar z = 0 (halos principais + sub-halos)",
        "metodo": "árvore geradora mínima (Barrow, Bhavsar & Sonoda 1985), nós com sub-halos (Colberg 2007, nota 3), "
                  "corte b pelo critério de Alpaslan et al. 2014 (§3.1.1), voo = ramo mais longo a partir do maior halo",
        "coordenadas": "desenho: posição do catálogo − L/2 [Mpc/h], caixa centrada na origem",
        "b_mpc_h": b,
        "criterio_b": f"menor b (passo {PASSO_B}) com > {FRACAO_MINIMA:.0%} dos halos acima do quantil {QUANTIL_BRILHANTE} "
                      "ligados a outro halo principal",
        "varredura_b": varredura,
        "n_nos": n, "n_principais": int(cat["principal"].sum()), "n_sub": int((~cat["principal"]).sum()),
        "comprimento_total_arvore_mpc_h": round(float(comp.sum()), 4),
        "n_filamentos": int(no_filamento.sum()), "halos_em_filamentos": halos_fil,
        "filamento_do_maior": {"nos": int(np.sum(rot == fil_maior)),
                               "halos_principais": int(principais_por_fil[fil_maior])},
        "segmentos_cruzam_parede": cruzam,
        "segmentos": segs,
        "voo": {
            "pontos": [[round(float(v - L / 2), 4) for v in p] for p in pts],
            "donos": [int(cat["dono"][i]) for i in cam],
            "e_sub": [bool(not cat["principal"][i]) for i in cam],
            "massas_msun": [float(f"{cat['mvir'][i] / h:.4e}") for i in cam],
            "comprimento_mpc_h": round(comprimento, 4),
            "cruza_parede": cruza_voo,
            "dono_final": int(cat["dono"][cam[-1]]),
        },
    }
    ARQ.write_text(json.dumps(saida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"b = {b} Mpc/h · {saida['n_filamentos']} filamentos · {halos_fil} de {saida['n_principais']} halos em filamentos")
    print(f"filamento do maior halo: {saida['filamento_do_maior']} · voo {comprimento:.2f} Mpc/h, {len(cam)} pontos, "
          f"termina no halo nº {saida['voo']['dono_final'] + 1} ({saida['voo']['massas_msun'][-1]:.3e} M☉), cruza parede {cruza_voo}×")
    print(f"{len(segs)} segmentos ({cruzam} ligações cortadas na parede) → {ARQ.name} ({ARQ.stat().st_size / 1e3:.0f} kB) "
          f"em {time.perf_counter() - t0:.1f} s")


if __name__ == "__main__":
    main()
