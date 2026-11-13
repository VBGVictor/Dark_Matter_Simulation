"""
analise_sobreposicao.py — F3.3/F3.14: por que trava "de perto"?
=================================================================

Hipótese (a testar): o gargalo é a placa de vídeo pintar o mesmo pixel muitas
vezes (sobreposição, "overdraw"), porque de perto cada splat vira uma mancha enorme.

Método: refaz a câmera do visualizador (three.js, FOV vertical 50°, tela 1920×869 do Victor,
as mesmas 3 vistas do roteiro medir_fps.js) e, para cada splat, calcula o raio na tela como
o Spark (raio = maxStdDev · σ · f / profundidade, limitado por maxPixelRadius; splats com
opacidade < minAlpha são pulados; centro fora de clipXY = 1,4 × a tela é descartado).
Soma a área (em pixels, limitada à área da tela) = pixels pintados por quadro.

Teste da hipótese: se ela vale, QPS ≈ 1 / (a + b · pixels pintados). Ajustamos a e b nas 6
medições do Victor (15/10/2026) e vemos se o modelo reproduz as 6.

Opções do Spark conferidas na documentação (sparkjs.dev/docs/spark-renderer): maxStdDev
(padrão √8; aceitável √4 a √9), maxPixelRadius (padrão 512), minAlpha (padrão 0,5/255).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

import exportar_spz as ez

PASTA = Path(__file__).resolve().parent
LARGURA, ALTURA, FOV = 1920, 869, 50.0
L = 25.0
F_PIX = ALTURA / (2 * np.tan(np.radians(FOV / 2)))  # distância focal em pixels


def distancia_inicial(aspecto: float) -> float:
    """Igual a distanciaParaCaber() do app.js."""
    meia_v = np.radians(FOV / 2)
    meia_h = np.arctan(np.tan(meia_v) * aspecto)
    return 1.08 * L / 2 / np.tan(min(meia_v, meia_h)) + L / 2


D0 = distancia_inicial(LARGURA / ALTURA)
VISTAS = {  # posição da câmera; alvo sempre na origem (como no medir_fps.js)
    "de frente": np.array([0.0, 0.0, D0]),
    "de perto": np.array([0.0, 0.0, D0 * 0.343]),
    "girada": np.array([D0 * 0.55, D0 * 0.45, D0 * 0.7]),
}
MEDIDO_QPS = {  # medições do Victor, 15/10/2026 (prints)
    ("teia_1_64_magma", "de frente"): 30, ("teia_1_64_magma", "de perto"): 8, ("teia_1_64_magma", "girada"): 29,
    ("teia_1_8_magma", "de frente"): 10, ("teia_1_8_magma", "de perto"): 4, ("teia_1_8_magma", "girada"): 10,
}


def pixels_pintados(pos, sigma, alfa, cam, max_std=np.sqrt(8), max_px=512.0, min_alfa=0.5 / 255,
                    clip=1.4) -> dict:
    frente = -cam / np.linalg.norm(cam)                     # olhando para a origem
    direita = np.cross(frente, [0, 1, 0]); direita /= np.linalg.norm(direita)
    cima = np.cross(direita, frente)
    rel = pos - cam
    prof = rel @ frente
    x, y = rel @ direita, rel @ cima
    na_frente = prof > 0.01
    sx = x / np.where(na_frente, prof, 1) * F_PIX
    sy = y / np.where(na_frente, prof, 1) * F_PIX
    dentro = na_frente & (np.abs(sx) <= clip * LARGURA / 2) & (np.abs(sy) <= clip * ALTURA / 2)
    visivel = dentro & (alfa >= min_alfa)
    raio = np.minimum(max_std * sigma * F_PIX / np.where(na_frente, prof, 1), max_px)
    area = np.minimum(np.pi * raio ** 2, LARGURA * ALTURA)
    return {"splats_desenhados": int(visivel.sum()), "pixels_pintados": float(area[visivel].sum()),
            "sobreposicao_media": float(area[visivel].sum() / (LARGURA * ALTURA))}


def carregar(nome: str):
    d = ez.ler_spz(PASTA / "dados" / f"{nome}.spz")
    return d["pos"], d["sigma"], d["alfa"]


def main() -> dict:
    dados = {n: carregar(n) for n in ("teia_1_64_magma", "teia_1_8_magma")}
    # 1) explicar as 6 medições com o padrão do Spark
    linhas = []
    for (nome, vista), qps in MEDIDO_QPS.items():
        r = pixels_pintados(*dados[nome], VISTAS[vista])
        linhas.append({"arquivo": nome, "vista": vista, "qps_medido": qps, **r})
    X = np.array([[1, l["pixels_pintados"]] for l in linhas])
    y = np.array([1 / l["qps_medido"] for l in linhas])          # tempo por quadro
    (a, b), *_ = np.linalg.lstsq(X, y, rcond=None)
    for l in linhas:
        l["qps_modelo"] = 1 / (a + b * l["pixels_pintados"])
    erro_rel = [abs(l["qps_modelo"] / l["qps_medido"] - 1) for l in linhas]

    # 2) comparar ajustes do Spark (mesmas vistas, 1/8)
    ajustes = {
        "padrão (√8, 512 px)": {},
        "maxStdDev = 2": {"max_std": 2.0},
        "maxPixelRadius = 64": {"max_px": 64.0},
        "maxStdDev 2 + maxPixelRadius 64": {"max_std": 2.0, "max_px": 64.0},
        "maxStdDev 2 + maxPixelRadius 32": {"max_std": 2.0, "max_px": 32.0},
        "minAlpha = 0,05 (pula manchas quase transparentes)": {"min_alfa": 0.05},
    }
    comparacao = []
    for nome in dados:
        for rot, kw in ajustes.items():
            linha = {"arquivo": nome, "ajuste": rot}
            for vista, cam in VISTAS.items():
                r = pixels_pintados(*dados[nome], cam, **kw)
                linha[vista] = {"sobreposicao": r["sobreposicao_media"], "splats": r["splats_desenhados"],
                                "qps_previsto": 1 / (a + b * r["pixels_pintados"])}
            comparacao.append(linha)
    res = {"modelo": {"a_ms": a * 1000, "b_ms_por_megapixel": b * 1e9, "erro_relativo_max": max(erro_rel),
                      "erro_relativo_medio": float(np.mean(erro_rel))},
           "explicacao_medicoes": linhas, "comparacao_ajustes": comparacao}
    (PASTA / "resultados_sobreposicao.json").write_text(json.dumps(res, indent=2, ensure_ascii=False),
                                                         encoding="utf-8")
    return res


if __name__ == "__main__":
    r = main()
    m = r["modelo"]
    print(f"modelo: tempo/quadro = {m['a_ms']:.1f} ms + {m['b_ms_por_megapixel']:.2f} ms por milhão de pixels pintados")
    print(f"erro do modelo nas 6 medições: médio {100*m['erro_relativo_medio']:.0f} %, máximo {100*m['erro_relativo_max']:.0f} %\n")
    for l in r["explicacao_medicoes"]:
        print(f"{l['arquivo']:16s} {l['vista']:10s} medido {l['qps_medido']:3.0f} | modelo {l['qps_modelo']:5.1f} QPS"
              f" | sobreposição {l['sobreposicao_media']:7.0f}× a tela | {l['splats_desenhados']:>9,} splats")
    print()
    for c in r["comparacao_ajustes"]:
        print(f"{c['arquivo']:16s} {c['ajuste']:52s} " + " | ".join(
            f"{v}: {c[v]['sobreposicao']:6.0f}× → {c[v]['qps_previsto']:5.1f} QPS" for v in VISTAS))
