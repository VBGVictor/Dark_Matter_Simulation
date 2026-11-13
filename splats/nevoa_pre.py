"""
nevoa_pre.py — névoa PRÉ-CALCULADA (F3.21, 21/10/2026)
=====================================================

Princípio (conversa com o Victor sobre armazenamento, 21/10): calcular uma vez no preparo, ler muitas
vezes no consumo. Hoje o navegador, ao abrir a 1/8 com névoa, passa por 2,1 milhões de manchas e espalha
~400 mil delas numa grade 256³ (~13 s no navegador do Victor). Aqui essa MESMA conta é feita uma vez em
Python e gravada pronta.

Mesma conta do navegador (visualizador/nevoa.js, GradeNevoa.depositar, caminho da mancha redonda):
  vai para a névoa: menor eixo ≥ célula (Δ = L/N)
  gaussiana em cubo de ±3σ POR EIXO, pesos nos centros das células, cada eixo renormalizado
  κ integrado = exposição · m / ρ̄m;  por célula κ0·wx·wy·wz;  emissão ε = κ · cor
  partes fora da caixa se perdem (renormaliza contando com elas), como no navegador
Lê as manchas do PRÓPRIO .spz (as mesmas que o navegador recebe), não do .npz.

Saídas (não sobrescreve):
  dados/<base>_nevoa<N>.bin.gz   grade em CAMADAS (gzip), ordem do navegador (x varia mais rápido):
                                   κ em meia precisão (float16 LE, N³ valores)  — exato, o mesmo do navegador
                                   cor média ε/κ em 1 byte por canal (R, G, B: N³ cada) — erro ≤ 0,2 %
                                 1ª versão (21/10): RGBA float16 intercalado = 122 MB (meia precisão quase não
                                 comprime). Medido: κ f16 + cor u8 em camadas = 54 MB; κ em 1 byte = 37 MB, mas
                                 com degraus de 5,5 % na opacidade (faixas visíveis) → descartado.
                                 No navegador: κ vira uma textura de 1 canal e a cor outra; a placa combina.
  dados/<base>_halos<N>.spz      só as manchas que NÃO viram névoa (os halos)
  dados/<base>_nevoa<N>.json     metadados (N, Δ, nº de manchas em cada parte, constantes, tempos)

Só para a cor padrão (estimador A, magma): com outro filtro de cor a névoa muda de cor, e o navegador
volta a calcular na hora (caminho antigo, que continua existindo).

Uso:  python nevoa_pre.py --base teia_1_8_magma [--n 256]
"""

from __future__ import annotations

import argparse
import gzip
import json
import time
from pathlib import Path

import numpy as np

import exportar_ply as ep
import exportar_spz as ez

PASTA = Path(__file__).resolve().parent
DADOS = PASTA / "dados"
EXPOSICAO = 0.1          # visualizador/nevoa.js e exportar_ply (a mesma)
CORTE = 3                # ±3σ por eixo (nevoa.js: CORTE_REDONDA)
L = 25.0


def depositar(pos: np.ndarray, sigma: np.ndarray, rgb: np.ndarray, m: float, n: int) -> tuple[np.ndarray, np.ndarray]:
    """Grade (n, n, n) de κ e (n, n, n, 3) de ε, índice [z, y, x] = navegador (x mais rápido)."""
    delta = L / n
    kappa = np.zeros((n, n, n), np.float32)
    emis = np.zeros((n, n, n, 3), np.float32)
    k_total = EXPOSICAO * m / ep.RHO_M
    for c, s, cor in zip(pos, sigma, rgb):
        r = int(np.ceil(CORTE * s / delta))
        lado = 2 * r + 1
        i0 = np.floor((c + L / 2) / delta).astype(np.int64) - r           # 1º índice do cubo, por eixo
        idx = i0[:, None] + np.arange(lado)[None, :]                        # (3, lado)
        centros = (idx + 0.5) * delta - L / 2
        w = np.exp(-(centros - c[:, None]) ** 2 / (2 * s * s))              # (3, lado), float64 como no JS
        soma = w[0].sum() * w[1].sum() * w[2].sum()
        k0 = k_total / (soma * delta ** 3)
        a = np.maximum(0, -i0); b = np.minimum(lado, n - i0)                # parte dentro da caixa
        if np.any(b <= a):
            continue
        bloco = (k0 * w[2, a[2]:b[2], None, None] * w[1, None, a[1]:b[1], None] * w[0, None, None, a[0]:b[0]])
        zs, ys, xs = (slice(i0[2] + a[2], i0[2] + b[2]), slice(i0[1] + a[1], i0[1] + b[1]),
                      slice(i0[0] + a[0], i0[0] + b[0]))
        kappa[zs, ys, xs] += bloco.astype(np.float32)
        emis[zs, ys, xs, :] += (bloco[..., None] * cor[None, None, None, :]).astype(np.float32)
    return kappa, emis


def main(base: str, n: int) -> dict:
    arq_grade = DADOS / f"{base}_nevoa{n}.bin.gz"
    arq_halos = DADOS / f"{base}_halos{n}.spz"
    arq_meta = DADOS / f"{base}_nevoa{n}.json"
    existentes = [a.name for a in (arq_grade, arq_halos, arq_meta) if a.exists()]
    if existentes:
        raise SystemExit(f"já existem: {existentes} — não sobrescrevo; apague à mão se quiser refazer.")
    t0 = time.perf_counter()
    meta_versao = json.loads((DADOS / f"{base}.json").read_text(encoding="utf-8"))
    m = meta_versao["massa_por_splat_msun_h"]
    d = ez.ler_spz(DADOS / f"{base}.spz")
    pos, esc, rgb, alfa = d["pos"].astype(np.float64), d["escalas"].astype(np.float64), d["rgb"], d["alfa"]
    delta = L / n
    nevoa = esc.min(axis=1) >= delta
    if not np.allclose(esc[nevoa, 0], esc[nevoa, 1]) or not np.allclose(esc[nevoa, 0], esc[nevoa, 2]):
        raise SystemExit("esta versão tem manchas alongadas: só o caminho redondo foi implementado aqui")
    t1 = time.perf_counter()
    kappa, emis = depositar(pos[nevoa], esc[nevoa, 0], rgb[nevoa].astype(np.float64), m, n)
    t_dep = time.perf_counter() - t1
    k16 = kappa.astype("<f2")
    k32 = k16.astype(np.float32)   # a cor média usa o κ que o navegador vai ler
    cor = np.where(k32[..., None] > 0, emis / np.maximum(k32[..., None], 1e-30), 0.0)
    cor8 = np.clip(np.round(cor * 255), 0, 255).astype(np.uint8)
    camadas = k16.tobytes() + b"".join(np.ascontiguousarray(cor8[..., c]).tobytes() for c in range(3))
    arq_grade.write_bytes(gzip.compress(camadas, compresslevel=6))
    # halos: as manchas que ficam como manchas, regravadas com os MESMOS valores lidos do .spz
    h = ~nevoa
    ez.gravar_spz_dados(arq_halos, pos_centrada=pos[h].astype(np.float32),
                        log_escalas=np.log(esc[h]).astype(np.float32),
                        f_dc=((rgb[h] - 0.5) / ep.C0).astype(np.float32),
                        logit_alfa=np.log(alfa[h] / (1 - alfa[h])).astype(np.float32))
    meta = {"base": base, "n": n, "delta_mpc_h": delta, "manchas_total": int(len(pos)),
            "manchas_nevoa": int(nevoa.sum()), "manchas_halos": int(h.sum()),
            "massa_por_splat_msun_h": m, "exposicao": EXPOSICAO, "rho_m": ep.RHO_M, "corte_sigma": CORTE,
            "grade": arq_grade.name, "halos": arq_halos.name, "formato_grade": "camadas: κ float16 LE (N³) + R, G, B uint8 (N³ cada) da cor média ε/κ; x mais rápido",
            "cor": "estimador A, magma (padrão) — outros filtros de cor recalculam no navegador",
            "kappa_soma_vezes_volume": float(kappa.astype(np.float64).sum() * delta ** 3),
            "mb_grade": arq_grade.stat().st_size / 1e6, "mb_halos": arq_halos.stat().st_size / 1e6,
            "tempo_s": {"depositar": round(t_dep, 1), "total": round(time.perf_counter() - t0, 1)}}
    arq_meta.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="teia_1_8_magma")
    ap.add_argument("--n", type=int, default=256)
    a = ap.parse_args()
    print(json.dumps(main(a.base, a.n), indent=1, ensure_ascii=False))
