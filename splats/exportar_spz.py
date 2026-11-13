"""
exportar_spz.py — F2.5 do backlog
=================================

Converte os .ply da F2.4 para SPZ (formato comprimido de gaussian splats da Niantic, lido
pelo Spark). Escrito seguindo o CÓDIGO OFICIAL (github.com/nianticlabs/spz, conferido em
14/10/2026), porque a biblioteca Python oficial exige compilar C++:

  Versão 2 (legado, gzip; todo leitor de SPZ abre). src/cc/load-spz.cc:
  cabeçalho (16 bytes, DENTRO do gzip): magic 0x5053474e, version=2, numPoints (u32),
      shDegree=0 (u8), fractionalBits=12 (u8), flags=0 (u8), reserved=0 (u8)
  blocos, nesta ordem: posições, alfas, cores, escalas, rotações (sem harmônicos)
  posição: round(v · 2^12) como inteiro com sinal de 24 bits, little-endian (3 bytes)
  alfa:    toUint8(sigmoid(opacity) · 255)
  cor:     toUint8(f_dc · (colorScale · 255) + 0,5 · 255), colorScale = 0,15 (splat-utils.h:15)
  escala:  toUint8((log σ + 10) · 16)
  rotação v2: xyz do quaternion → toUint8(q · 127,5 + 127,5) (sinal de w ≥ 0)

Coordenadas: o .ply da F2.4 já está no sistema que o Spark mostrou certo (y para cima).
Gravamos as MESMAS coordenadas; o teste Z2 confere no Spark que a imagem não inverte.

Critérios (registrados ANTES de rodar, 14/10/2026), a partir dos degraus do formato:
  Z1 ida e volta: posição ≤ 1,3e−4 Mpc/h · σ relativo ≤ 3,2 % · cor ≤ 0,004 · α ≤ 0,002
  Z2 visual: no Spark, SPZ e PLY dão a mesma imagem na mesma câmera
  Z3 tamanho: medir e comparar com o PLY
"""

from __future__ import annotations

import gzip
import json
import struct
from pathlib import Path

import numpy as np

import exportar_ply as ep

PASTA = Path(__file__).resolve().parent
MAGIC, VERSAO, BITS_FRAC, COLOR_SCALE = 0x5053474E, 2, 12, 0.15


def _u8(x: np.ndarray) -> np.ndarray:
    """toUint8 do código oficial: arredonda e limita a 0–255."""
    return np.clip(np.round(x), 0, 255).astype(np.uint8)


def gravar_spz(arq_ply: Path, arq_spz: Path) -> None:
    """Converte um .ply (F2.4) em .spz."""
    c = _ler_campos_ply(arq_ply)
    gravar_spz_dados(arq_spz,
                     pos_centrada=np.stack([c["x"], c["y"], c["z"]], axis=1),
                     log_escalas=np.stack([c[f"scale_{i}"] for i in range(3)], axis=1),
                     f_dc=np.stack([c[f"f_dc_{i}"] for i in range(3)], axis=1),
                     logit_alfa=c["opacity"],
                     quat=np.stack([c[f"rot_{i}"] for i in range(4)], axis=1))


def gravar_spz_dados(arq_spz: Path, pos_centrada: np.ndarray, log_escalas: np.ndarray, f_dc: np.ndarray,
                     logit_alfa: np.ndarray, quat: np.ndarray | None = None) -> None:
    """Grava o .spz direto dos valores, SEM passar por um .ply (para a versão completa, cujo
    .ply teria 1,1 GB). Mesmas grandezas do .ply: posição centrada [Mpc/h], log(σ) por eixo,
    coeficiente de cor f_dc, logit da opacidade, quaternion (w, x, y, z) ou None (sem rotação)."""
    n = len(pos_centrada)
    fixo = np.round(np.asarray(pos_centrada, np.float64) * (1 << BITS_FRAC)).astype(np.int32).ravel()
    b_pos = np.stack([fixo & 0xFF, (fixo >> 8) & 0xFF, (fixo >> 16) & 0xFF], axis=1).astype(np.uint8)
    alfa = _u8(1 / (1 + np.exp(-np.asarray(logit_alfa, np.float64))) * 255)
    # cor e escala em float32, como o código oficial em C (load-spz.cc usa float): em float64,
    # valores exatamente no meio do degrau arredondam para o outro lado (9 bytes em 4,98 milhões
    # na 1ª versão desta função — achado pelo teste de regressão em 15/10/2026).
    cor = _u8(np.asarray(f_dc, np.float32) * np.float32(COLOR_SCALE * 255) + np.float32(0.5 * 255))
    esc = _u8((np.asarray(log_escalas, np.float32) + np.float32(10)) * np.float32(16))
    if quat is None:
        rot = np.full((n, 3), _u8(np.array([127.5]))[0], dtype=np.uint8)   # (0,0,0) → sem rotação
    else:
        q = np.asarray(quat, np.float64)
        q = q / np.linalg.norm(q, axis=1)[:, None]
        q[q[:, 0] < 0] *= -1
        rot = _u8(q[:, 1:4] * 127.5 + 127.5)
    cab = struct.pack("<IIIBBBB", MAGIC, VERSAO, n, 0, BITS_FRAC, 0, 0)
    corpo = cab + b_pos.tobytes() + alfa.tobytes() + cor.tobytes() + esc.tobytes() + rot.tobytes()
    with open(arq_spz, "wb") as f:
        f.write(gzip.compress(corpo, compresslevel=9))


def ler_spz(arq_spz: Path) -> dict[str, np.ndarray]:
    """Leitor independente do gravador, pelas fórmulas de DEScompactação do código oficial."""
    bruto = gzip.decompress(Path(arq_spz).read_bytes())
    magic, versao, n, sh, frac, flags, _ = struct.unpack("<IIIBBBB", bruto[:16])
    assert magic == MAGIC and versao == VERSAO and sh == 0
    o = 16
    p = np.frombuffer(bruto, np.uint8, n * 9, o).reshape(-1, 3).astype(np.int32); o += n * 9
    v = p[:, 0] | (p[:, 1] << 8) | (p[:, 2] << 16)
    v = np.where(v & 0x800000, v | ~0xFFFFFF, v)  # extensão de sinal (bit 0x800000)
    pos = v.reshape(n, 3) / (1 << frac)
    alfa = np.frombuffer(bruto, np.uint8, n, o) / 255.0; o += n
    fdc = (np.frombuffer(bruto, np.uint8, n * 3, o).reshape(n, 3) / 255.0 - 0.5) / COLOR_SCALE; o += n * 3
    sig = np.exp(np.frombuffer(bruto, np.uint8, n * 3, o).reshape(n, 3) / 16.0 - 10.0); o += n * 3
    xyz = np.frombuffer(bruto, np.uint8, n * 3, o).reshape(n, 3) / 127.5 - 1.0; o += n * 3
    w = np.sqrt(np.clip(1.0 - np.sum(xyz ** 2, axis=1), 0, None))  # v2: w ≥ 0, derivado
    return {"pos": pos, "alfa": alfa, "rgb": fdc * ep.C0 + 0.5, "sigma": sig[:, 0], "escalas": sig,
            "quat": np.concatenate([w[:, None], xyz], axis=1)}


def _ler_campos_ply(arq: Path) -> dict[str, np.ndarray]:
    with open(arq, "rb") as f:
        cab = []
        while (linha := f.readline().decode("ascii").strip()) != "end_header":
            cab.append(linha)
        n = int(next(l for l in cab if l.startswith("element vertex")).split()[-1])
        nomes = [l.split()[-1] for l in cab if l.startswith("property")]
        b = np.frombuffer(f.read(), dtype="<f4").reshape(n, len(nomes))
    return {nome: b[:, i] for i, nome in enumerate(nomes)}


def converter(nome_ply: str) -> dict:
    ply, spz = PASTA / "dados" / nome_ply, PASTA / "dados" / nome_ply.replace(".ply", ".spz")
    gravar_spz(ply, spz)
    a = ep.ler_ply(ply)
    b = ler_spz(spz)
    erros = {
        "pos_mpc_h": float(np.max(np.abs(b["pos"] - (a["pos"] - ep.L / 2)))),
        "sigma_rel": float(np.max(np.abs(b["sigma"] / a["sigma"] - 1))),
        "rgb": float(np.max(np.abs(b["rgb"] - a["rgb"]))),
        "alfa": float(np.max(np.abs(b["alfa"] - a["alfa"]))),
    }
    limites = {"pos_mpc_h": 1.3e-4, "sigma_rel": 0.032, "rgb": 0.004, "alfa": 0.002}
    return {"spz": spz.name, "n": len(b["pos"]), "mb_ply": ply.stat().st_size / 1e6,
            "mb_spz": spz.stat().st_size / 1e6, "reducao_x": ply.stat().st_size / spz.stat().st_size,
            "Z1_erros": erros, "Z1_passou": all(erros[k] <= limites[k] for k in limites)}


if __name__ == "__main__":
    res = [converter("teia_1_64_magma.ply"), converter("fatia_1_8_magma.ply")]
    (PASTA / "resultados_f2_5.json").write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(res, indent=1, ensure_ascii=False))
