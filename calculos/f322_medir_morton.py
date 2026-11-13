"""F3.22 — mede o ganho de ordenar as manchas pela curva de Morton (Z), SEM gravar nada no projeto.

Para cada .spz: descomprime, reordena os 5 blocos (posição 9 B, alfa 1, cor 3, escala 3, rotação 3 por mancha) pela
chave de Morton da posição (10 bits por eixo, célula de 25/1024 Mpc/h), recomprime com gzip nível 9 (o mesmo do
exportar_spz.py) e compara: tamanho e tempo de descompressão (5 repetições, mediana). Os bytes de cada mancha são os
mesmos (só a ordem muda) — conferido com a soma ordenada dos registros.
"""
import gzip
import struct
import sys
import time
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
DADOS = Path(__file__).resolve().parent.parent / "splats" / "dados"


def espalhar10(v: np.ndarray) -> np.ndarray:
    """Intercala zeros entre os 10 bits (x → x0 0 0 x1 0 0 …), para montar a chave de Morton 3D."""
    v = v.astype(np.uint64) & 0x3FF
    v = (v | (v << 16)) & 0x030000FF
    v = (v | (v << 8)) & 0x0300F00F
    v = (v | (v << 4)) & 0x030C30C3
    v = (v | (v << 2)) & 0x09249249
    return v


def descomprimir_ms(dado: bytes) -> float:
    t = []
    for _ in range(5):
        t0 = time.perf_counter(); gzip.decompress(dado); t.append(time.perf_counter() - t0)
    return 1000 * float(np.median(t))


for nome in sys.argv[1:]:
    arq = DADOS / nome
    comp = arq.read_bytes()
    bruto = gzip.decompress(comp)
    n = struct.unpack("<IIIBBBB", bruto[:16])[2]
    o = 16
    blocos = {}
    for chave, tam in [("pos", 9), ("alfa", 1), ("cor", 3), ("esc", 3), ("rot", 3)]:
        blocos[chave] = np.frombuffer(bruto, np.uint8, n * tam, o).reshape(n, tam); o += n * tam
    p = blocos["pos"].reshape(n, 3, 3).astype(np.int32)
    v = p[..., 0] | (p[..., 1] << 8) | (p[..., 2] << 16)
    v = np.where(v & 0x800000, v | ~0xFFFFFF, v)                     # posição fixa com sinal (2^12 por Mpc/h)
    L = 25.0
    celula = np.clip(((v / 4096.0 + L / 2) / L * 1024).astype(np.int64), 0, 1023)
    chave = (espalhar10(celula[:, 0]) << 2) | (espalhar10(celula[:, 1]) << 1) | espalhar10(celula[:, 2])
    ordem = np.argsort(chave, kind="stable")
    novo = bruto[:16] + b"".join(blocos[k][ordem].tobytes() for k in ("pos", "alfa", "cor", "esc", "rot"))
    t0 = time.perf_counter(); comp_novo = gzip.compress(novo, compresslevel=9); t_comp = time.perf_counter() - t0
    # mesmos registros, outra ordem
    reg = lambda b: np.concatenate([np.frombuffer(b, np.uint8, n * 9, 16).reshape(n, 9)], axis=1)
    mesmos = np.array_equal(np.sort(reg(bruto).view("V9").ravel()), np.sort(reg(novo).view("V9").ravel()))
    a, b = descomprimir_ms(comp), descomprimir_ms(comp_novo)
    print(f"{nome}: {n:,} manchas · {len(comp) / 1e6:.2f} MB → {len(comp_novo) / 1e6:.2f} MB "
          f"({100 * (len(comp_novo) / len(comp) - 1):+.1f} %) · descompressão {a:.0f} → {b:.0f} ms ({100 * (b / a - 1):+.0f} %) · "
          f"mesmas posições: {mesmos} · (compressão levou {t_comp:.0f} s)")
