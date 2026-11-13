"""
anisotropia.py — F3.16: manchas alongadas (kernels anisotrópicos)
==================================================================

Cada splat ganha o formato da sua vizinhança: esticado ao longo de um filamento, achatado
numa parede, redondo onde não há direção preferida.

Método: Yu & Turk (2013), ACM Trans. Graphics 32, art. 5, §4.2 — conferido no PDF
(Yu & Turk 2013, doi:10.1145/2421636.2421641; lista em REFERENCIAS.xlsx):
  eq. 9–10  média e covariância PONDERADAS dos vizinhos dentro de r_i = 2·h_i:
            C_i = Σ_j w_ij (x_j − x̄_i)(x_j − x̄_i)ᵀ / Σ_j w_ij,   x̄_i = Σ_j w_ij x_j / Σ_j w_ij
  eq. 11    w_ij = 1 − (|x_i − x_j| / r_i)³  se |x_i − x_j| < r_i;  0 fora
  eq. 12–13 C_i = R Σ Rᵀ,  Σ = diag(σ1 ≥ σ2 ≥ σ3)  (direções e variâncias)
  eq. 14–15 σ_k ← max(σ_k, σ1/k_r), k_r = 4 (no máximo 2× mais longo que largo);
            se N ≤ N_ε = 25 vizinhos → mancha redonda.
  Constantes k_r = 4 e N_ε = 25: as do artigo ("In our examples, we use k_r = 4 … N_ε = 25").

ADAPTAÇÃO NOSSA (rotulada): o artigo multiplica C por uma constante k_s = 1400 "para manter o
volume do kernel constante" — número ajustado às unidades deles. Aqui o volume é mantido de
forma EXATA: a gaussiana alongada tem desvios a·σ_iso, b·σ_iso, c·σ_iso com a·b·c = 1, onde
σ_iso é o σ redondo da F2.1 (mesma variância do kernel do GADGET). Mesmo volume, outro formato.

Formato do splat: escala por eixo (3 valores) + rotação em quaternion (w, x, y, z), como no
.ply do 3D Gaussian Splatting (rot_0 = w).

Critérios (registrados ANTES de rodar, 15/10/2026)
  A1 nuvem aleatória: mediana de (eixo maior / eixo menor) < 1,3
  A2 filamento sintético: mediana |cos(eixo maior, filamento)| > 0,95
  A3 parede sintética: mediana |cos(eixo menor, normal da parede)| > 0,95
  A4 volume: |a·b·c − 1| < 1e−6 em todos os splats
  A5 visual no Spark (feito no navegador): mancha de orientação conhecida aparece certa

Uso:  python anisotropia.py --testes        (A1–A4, segundos)
      python anisotropia.py                 (aplica na versão 1/64 e grava o .spz alongado)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent / "calculos"))

K_R = 4.0       # Yu & Turk 2013, §4.2
N_EPS = 25      # Yu & Turk 2013, §4.2
ORCAMENTO = 3_000_000  # vizinhos processados por lote (controla a memória)


def formas(pos: np.ndarray, h: np.ndarray, caixa: float | None) -> dict:
    """Para cada partícula: fatores de eixo (a ≥ b ≥ c, a·b·c = 1), quaternion (w,x,y,z) e
    número de vizinhos N dentro de r_i = 2h_i.

    TODOS os vizinhos dentro de r_i entram (como no artigo). Como o número varia muito
    (de dezenas a >10 mil no centro dos halos), primeiro contamos quantos cada partícula tem
    e depois processamos em lotes de partículas com contagem parecida, buscando exatamente
    esse número — nenhuma vizinhança é cortada."""
    arvore = cKDTree(pos, boxsize=caixa)
    n = len(pos)
    raio = 2.0 * h                                                     # r_i = 2 h_i
    contagem = arvore.query_ball_point(pos, raio, workers=-1, return_length=True)
    ordem = np.argsort(contagem)
    fatores = np.ones((n, 3))
    quat = np.tile([1.0, 0.0, 0.0, 0.0], (n, 1))
    contagem_ordenada = contagem[ordem]
    ini = 0
    while ini < n:
        # Lote = partículas consecutivas na ordem crescente de contagem. A maior contagem do
        # lote é a do último; o lote cresce enquanto (tamanho × maior contagem) ≤ ORCAMENTO.
        tam = max(1, ORCAMENTO // int(contagem_ordenada[ini]))
        while tam > 1 and tam * int(contagem_ordenada[min(n, ini + tam) - 1]) > ORCAMENTO:
            tam = max(1, ORCAMENTO // int(contagem_ordenada[min(n, ini + tam) - 1]))
        sel = ordem[ini:ini + tam]
        ini += len(sel)
        k = int(max(2, contagem[sel].max()))                           # todos os vizinhos em 2h
        d, idx = arvore.query(pos[sel], k=min(k, n), workers=-1)
        r = raio[sel, None]
        dentro = d < r
        w = np.where(dentro, 1.0 - (d / r) ** 3, 0.0)                  # eq. 11
        rel = pos[idx] - pos[sel, None, :]
        if caixa:                                                      # caixa periódica: menor imagem
            rel -= caixa * np.round(rel / caixa)
        sw = w.sum(axis=1)
        media = (w[..., None] * rel).sum(axis=1) / sw[:, None]         # eq. 10 (relativa a x_i)
        dev = rel - media[:, None, :]
        C = np.einsum("nk,nki,nkj->nij", w, dev, dev) / sw[:, None, None]  # eq. 9
        sig, R = np.linalg.eigh(C)                                     # crescente
        sig, R = sig[:, ::-1], R[:, :, ::-1]                           # σ1 ≥ σ2 ≥ σ3
        sig = np.maximum(sig, sig[:, :1] / K_R)                        # eq. 15: limite de alongamento
        N = dentro.sum(axis=1)
        desvio = np.sqrt(sig)                                          # desvio-padrão por eixo
        f = desvio / np.cbrt(np.prod(desvio, axis=1))[:, None]         # a·b·c = 1 (volume igual)
        redonda = N <= N_EPS                                           # eq. 15: poucos vizinhos
        f[redonda] = 1.0
        det = np.linalg.det(R)
        R[det < 0, :, 2] *= -1                                         # rotação própria (det = +1)
        q = Rotation.from_matrix(R).as_quat()                          # (x, y, z, w)
        q = np.concatenate([q[:, 3:4], q[:, :3]], axis=1)              # → (w, x, y, z)
        q[redonda] = [1.0, 0.0, 0.0, 0.0]
        fatores[sel], quat[sel] = f, q
    return {"fatores": fatores, "quat": quat, "nviz": contagem.astype(np.int32)}


def eixos(quat: np.ndarray) -> np.ndarray:
    """Matriz de rotação a partir de (w,x,y,z): colunas = eixo maior, médio, menor."""
    return Rotation.from_quat(np.concatenate([quat[:, 1:], quat[:, :1]], axis=1)).as_matrix()


# ---------------------------------------------------------------------------
# Testes de resposta conhecida
# ---------------------------------------------------------------------------
def _h_por_vizinhos(pos: np.ndarray, caixa: float | None) -> np.ndarray:
    return cKDTree(pos, boxsize=caixa).query(pos, k=33, workers=-1)[0][:, -1]


def rodar_testes() -> dict:
    rng = np.random.default_rng(3)
    res = {}
    # A1: nuvem aleatória na caixa periódica
    p = rng.uniform(0, 10, size=(60_000, 3))
    f = formas(p, _h_por_vizinhos(p, 10.0), 10.0)
    razao = f["fatores"][:, 0] / f["fatores"][:, 2]
    res["A1_mediana_razao"] = float(np.median(razao))
    res["A1_passou"] = res["A1_mediana_razao"] < 1.3
    # A2: filamento ao longo de (1,1,0)/√2, raio 0,05, comprimento 20 (no meio de um volume vazio)
    eixo = np.array([1.0, 1.0, 0.0]) / np.sqrt(2)
    t = rng.uniform(-10, 10, 40_000)
    perp1 = np.array([0.0, 0.0, 1.0]); perp2 = np.cross(eixo, perp1)
    rr, th = 0.05 * np.sqrt(rng.uniform(0, 1, t.size)), rng.uniform(0, 2 * np.pi, t.size)
    p = t[:, None] * eixo + (rr * np.cos(th))[:, None] * perp1 + (rr * np.sin(th))[:, None] * perp2
    f = formas(p, _h_por_vizinhos(p, None), None)
    longe_ponta = np.abs(t) < 8
    cos = np.abs(eixos(f["quat"])[:, :, 0] @ eixo)[longe_ponta]
    res["A2_mediana_cos"] = float(np.median(cos)); res["A2_passou"] = res["A2_mediana_cos"] > 0.95
    res["A2_mediana_razao"] = float(np.median((f["fatores"][:, 0] / f["fatores"][:, 2])[longe_ponta]))
    # A3: parede de normal (0,1,1)/√2, espessura 0,05, 10×10
    normal = np.array([0.0, 1.0, 1.0]) / np.sqrt(2)
    u = np.array([1.0, 0.0, 0.0]); v = np.cross(normal, u)
    a, b = rng.uniform(-5, 5, (2, 60_000))
    e = rng.uniform(-0.025, 0.025, 60_000)
    p = a[:, None] * u + b[:, None] * v + e[:, None] * normal
    f = formas(p, _h_por_vizinhos(p, None), None)
    longe_borda = (np.abs(a) < 4) & (np.abs(b) < 4)
    cos = np.abs(eixos(f["quat"])[:, :, 2] @ normal)[longe_borda]
    res["A3_mediana_cos"] = float(np.median(cos)); res["A3_passou"] = res["A3_mediana_cos"] > 0.95
    # A4: volume (a·b·c = 1) — vale para todos os casos acima; confere no último
    res["A4_max_erro_volume"] = float(np.max(np.abs(np.prod(f["fatores"], axis=1) - 1)))
    res["A4_passou"] = res["A4_max_erro_volume"] < 1e-6
    return res


# ---------------------------------------------------------------------------
# Aplicação na simulação
# ---------------------------------------------------------------------------
def aplicar(origem: str = "sub_1_64.npz", destino: str = "teia_1_64_magma_alongada",
            gravar_ply: bool = True) -> dict:
    """gravar_ply=False grava só o .spz (sem o .ply intermediário) — usado nas versões grandes
    por causa da regra de disco do projeto (< ~1 GB). O .ply da 1/64 fica: o verificador usa."""
    import exportar_ply as ep
    import exportar_spz as ez

    d = np.load(PASTA / "dados" / origem)
    pos = d["pos"].astype(np.float64)
    h = d["h"].astype(np.float64)
    t0 = time.perf_counter()
    f = formas(pos, h, ep.L)
    tempo = time.perf_counter() - t0
    sigma = d["sigma"].astype(np.float64)
    escalas = sigma[:, None] * f["fatores"]
    rho = d["rho_msun_h_por_mpc_h3_A_knn_resolucao_completa"]
    rgb = ep.cores(rho, "c_magma")
    alfa = ep.opacidades(float(d["massa_por_splat"]), sigma, 0.1)  # mesma opacidade da redonda
    if gravar_ply:
        arq_ply = PASTA / "dados" / f"{destino}.ply"
        ep.gravar_ply(arq_ply, pos, escalas, rgb, alfa, quat=f["quat"])
        ez.gravar_spz(arq_ply, PASTA / "dados" / f"{destino}.spz")
    else:  # mesmas grandezas do .ply, em float32 como ele, gravadas direto no .spz
        ez.gravar_spz_dados(PASTA / "dados" / f"{destino}.spz",
                            pos_centrada=(pos - ep.L / 2).astype(np.float32),
                            log_escalas=np.log(escalas).astype(np.float32),
                            f_dc=((rgb - 0.5) / ep.C0).astype(np.float32),
                            logit_alfa=np.log(alfa / (1 - alfa)).astype(np.float32),
                            quat=f["quat"].astype(np.float32))
    razao = f["fatores"][:, 0] / f["fatores"][:, 2]
    return {"origem": origem, "n": len(pos), "tempo_s": tempo,
            "vizinhos_em_2h": {p: int(np.percentile(f["nviz"], q)) for p, q in (("p50", 50), ("p99", 99), ("max", 100))},
            "redondas_por_poucos_vizinhos": int(np.sum(f["nviz"] <= N_EPS)),
            "razao_eixos": {p: float(np.percentile(razao, q)) for p, q in (("p5", 5), ("p50", 50), ("p95", 95))},
            "fracao_no_limite_2x": float(np.mean(razao > 1.99)),
            "mb_spz": (PASTA / "dados" / f"{destino}.spz").stat().st_size / 1e6}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--testes", action="store_true")
    a = ap.parse_args()
    out = rodar_testes() if a.testes else {"testes": rodar_testes(), "simulacao": aplicar()}
    if not a.testes:
        (PASTA / "resultados_f3_16.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(out, indent=1, ensure_ascii=False))
