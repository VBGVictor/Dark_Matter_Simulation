"""Distância mediana entre manchas CONSECUTIVAS no arquivo: ordem atual × Morton × aleatória (para explicar a F3.22)."""
import sys
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
SPLATS = Path(__file__).resolve().parent.parent / "splats"
sys.path.insert(0, str(SPLATS))
import exportar_spz as ez  # noqa: E402

DADOS = SPLATS / "dados"
L = 25.0


def espalhar10(v):
    v = v.astype(np.uint64) & 0x3FF
    v = (v | (v << 16)) & 0x030000FF
    v = (v | (v << 8)) & 0x0300F00F
    v = (v | (v << 4)) & 0x030C30C3
    v = (v | (v << 2)) & 0x09249249
    return v


def passo_mediano(pos):
    d = np.abs(np.diff(pos, axis=0))
    d = np.minimum(d, L - d)
    return float(np.median(np.sqrt((d ** 2).sum(axis=1))))


for nome in sys.argv[1:]:
    pos = ez.ler_spz(DADOS / nome)["pos"]
    c = np.clip(((pos + L / 2) / L * 1024).astype(np.int64), 0, 1023)
    morton = pos[np.argsort((espalhar10(c[:, 0]) << 2) | (espalhar10(c[:, 1]) << 1) | espalhar10(c[:, 2]), kind="stable")]
    acaso = pos[np.random.default_rng(0).permutation(len(pos))]
    print(f"{nome}: distância mediana entre manchas consecutivas — atual {1000 * passo_mediano(pos):.0f} kpc/h · "
          f"Morton {1000 * passo_mediano(morton):.0f} kpc/h · aleatória {1000 * passo_mediano(acaso):.0f} kpc/h")
