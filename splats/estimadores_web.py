"""
estimadores_web.py — dados do filtro de estimador de densidade (F3.7, 20/10/2026)
================================================================================

Para o visualizador trocar a cor das manchas entre os 4 estimadores SEM recarregar a página,
grava, por versão leve (1/64 e 1/8):

  dados/estimadores_<versao>.bin  uint8: o ÍNDICE DE COR (0–255 na tabela da paleta) de cada mancha
                                  para os 4 estimadores, em blocos: [A(N), C(N), B(N), D(N)] (ordem de
                                  gerar_splats.ESTIMADORES), na MESMA ordem das manchas do .spz
                                  (o .spz foi gravado na ordem do sub_*.npz — verificador K).
                                  Densidade da partícula na RESOLUÇÃO COMPLETA (*_resolucao_completa),
                                  a mesma que já colore os arquivos (exportar_ply: estimador A na
                                  resolução completa). A densidade "da própria versão" é a F3.10.
e uma vez:
  dados/paletas_lut.json          as 256 cores de cada paleta (a mesma tabela que o matplotlib usa
                                  em exportar_ply.cores) + a faixa fixa log₁₀ de −1 a 5.

Regra de cor reproduzida no navegador (igual ao matplotlib com v contínuo):
  v = clip((log₁₀(ρ/ρ̄m) − (−1)) / 6, 0, 1);  índice = min(255, ⌊v · 256⌋);  cor = LUT[índice]

1ª versão (20/10) guardava log₁₀(ρ/ρ̄m) em float16: 3 % das manchas mudavam 1 tom (em 256) por
arredondamento → trocado para o índice exato, calculado pela MESMA conta de exportar_ply.cores.
Conferência embutida (exata): LUT[índice] = exportar_ply.cores(ρ) em TODAS as manchas e paletas.
A discordância entre estimadores (F3.8) vai precisar dos valores — decidir o formato lá.

Uso:  python estimadores_web.py                      (não sobrescreve: para se algum arquivo existir)
      python estimadores_web.py --resolucao-versao   (F3.10: estimadores_<versao>_versao.bin)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

PASTA = Path(__file__).resolve().parent
import exportar_ply as ep  # noqa: E402
import gerar_splats as gs  # noqa: E402
import paletas  # noqa: E402

DADOS = PASTA / "dados"
VERSOES = {"1_64": "sub_1_64.npz", "1_8": "sub_1_8.npz"}


def indice_cor(rho: np.ndarray) -> np.ndarray:
    """Índice na tabela de 256 cores: a mesma conta (e os mesmos tipos numéricos) de
    exportar_ply.cores, seguida da regra do matplotlib para v contínuo (v·N, v = 1 → N − 1)."""
    lo, hi = ep.FAIXA_LOG
    v = np.clip((np.log10(rho / ep.RHO_M) - lo) / (hi - lo), 0, 1)
    return np.clip((v * 256).astype(np.int64), 0, 255)


def gravar_versao(versao: str, origem: str, resolucao: str = "completa") -> dict:
    """resolucao = "completa": densidade da partícula na simulação inteira (padrão, a que colore os
    arquivos) → estimadores_<versao>.bin. "versao" (F3.10, 21/10/2026): densidade recalculada na
    própria versão leve (subamostrar.py; coerente com o tamanho da mancha, mas sem os halos pequenos)
    → estimadores_<versao>_versao.bin. Mesmo formato e mesma conferência de cor."""
    d = np.load(DADOS / origem)
    sufixo_npz = "_resolucao_completa" if resolucao == "completa" else ""
    blocos, iguais = [], []
    for e in gs.ESTIMADORES:
        rho = d[f"rho_msun_h_por_mpc_h3_{e}{sufixo_npz}"]   # mesmo tipo que exportar_ply usa
        idx = indice_cor(rho)
        blocos.append(idx.astype(np.uint8))
        for nome in paletas.PALETAS_FILTRO:   # LUT[índice] tem que ser EXATAMENTE a cor do gerador
            lut = paletas.PALETAS[nome][1](np.arange(256))[:, :3]
            assert np.array_equal(lut[idx], ep.cores(rho, nome)), f"cor diferente: {e} {nome}"
        iguais.append(1.0)
    arq = DADOS / (f"estimadores_{versao}.bin" if resolucao == "completa" else f"estimadores_{versao}_versao.bin")
    arq.write_bytes(np.concatenate(blocos).tobytes())
    return {"arquivo": arq.name, "n": int(len(blocos[0])), "mb": arq.stat().st_size / 1e6,
            "cor_identica_ao_gerador": dict(zip(gs.ESTIMADORES, iguais))}


def gravar_paletas() -> dict:
    # chamada com inteiro i = entrada i da tabela (sem passar por v) — 8 casas bastam (cor 0–1)
    lut = {nome: np.round(paletas.PALETAS[nome][1](np.arange(256))[:, :3], 8).tolist() for nome in paletas.PALETAS_FILTRO}
    info = {"faixa_log10_rho_sobre_media": list(ep.FAIXA_LOG), "estimadores": list(gs.ESTIMADORES),
            "padrao": gs.ESTIMADOR_PADRAO, "paleta_padrao": paletas.PALETA_PADRAO,
            "nomes_paletas": {nome: paletas.PALETAS[nome][0] for nome in paletas.PALETAS_FILTRO}, "lut": lut,
            "regra": "indice = min(255, floor(clip((log10(rho/rho_m) + 1) / 6, 0, 1) * 256))"}
    (DADOS / "paletas_lut.json").write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
    return {"arquivo": "paletas_lut.json", "paletas": list(lut)}


if __name__ == "__main__":
    if "--resolucao-versao" in sys.argv:   # F3.10: só os arquivos da densidade da própria versão
        alvos = [DADOS / f"estimadores_{v}_versao.bin" for v in VERSOES]
        existentes = [a.name for a in alvos if a.exists()]
        if existentes:
            raise SystemExit(f"já existem: {existentes} — não sobrescrevo; apague à mão se quiser refazer.")
        print(json.dumps({v: gravar_versao(v, o, "versao") for v, o in VERSOES.items()}, indent=1, ensure_ascii=False))
        raise SystemExit(0)
    alvos = [DADOS / f"estimadores_{v}.bin" for v in VERSOES] + [DADOS / "paletas_lut.json"]
    existentes = [a.name for a in alvos if a.exists()]
    if existentes:
        raise SystemExit(f"já existem: {existentes} — não sobrescrevo; apague à mão se quiser refazer.")
    res = {v: gravar_versao(v, o) for v, o in VERSOES.items()}
    res["paletas"] = gravar_paletas()
    print(json.dumps(res, indent=1, ensure_ascii=False))
