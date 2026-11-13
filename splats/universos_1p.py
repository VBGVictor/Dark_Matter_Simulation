"""
universos_1p.py — F3.11 "filtros de universo": as simulações CAMELS 1P de Ωm e σ8 (21/10/2026)
=============================================================================================

Decisão do Victor (14/10 e 21/10): cada posição dos controles de universo é uma SIMULAÇÃO REAL E
COMPLETA do CAMELS (conjunto 1P), nada interpolado. Downloads aprovados em 21/10 (~1,8 GB de
tráfego); versões 1/8 aprovadas (+~170 MB no disco; o 1 GB do projeto é "linha d'água").

Conjunto 1P (Villaescusa-Navarro et al. 2021, conferido no PDF): "Simulations in the 1P set have the
same initial random seed and only the value of one parameter is varied at a time." Conferido nos
2LPT.param do servidor (21/10): todas com Seed 67; Ωm 0,1 / 0,2 / 0,3 / 0,4 / 0,5 (p1) e σ8 0,6 / 0,7 /
0,8 / 0,9 / 1,0 (p2); h = 0,6711. A semente é DIFERENTE da nossa CV_0: a família 1P é comparada
consigo mesma (referência = 1P_p1_0, idêntica a 1P_p2_0).

Para cada simulação (uma por vez; o snapshot de 207 MB fica numa pasta TEMPORÁRIA fora do projeto e é
apagado depois de processado):
  1. baixa snapshot_090.hdf5 (z = 0) + 2LPT.param + P(k) linear das condições iniciais + P(k) oficial z = 0
  2. lê massa da partícula, Ωm, h e caixa do PRÓPRIO arquivo (Ωm muda a massa da partícula)
  3. densidades (gerar_splats.densidades, os 4 estimadores) na resolução completa
  4. P(k) medido (mesmo método da F1, conferido a 0,05 % contra o oficial na CV_0) → para o verificador
  5. versões 1/8 e 1/64 com a MESMA subamostragem da F2.2 (semente 20261014): h e σ recalculados
     na versão; cor = estimador A na resolução completa (como as versões padrão); opacidade pela massa
  6. grava dados/universos/<sim>_1_8.spz, <sim>_1_64.spz e os .json de metadados

CONVENÇÃO (dita no visualizador): a cor e a exposição usam a densidade média da REFERÊNCIA
(Ωm = 0,3) para TODOS os universos — mesma régua, como uma câmera com a mesma exposição. Assim um
universo com Ωm = 0,1 (3× menos matéria) aparece de fato mais apagado. A alternativa (cada universo
contra a própria média) esconderia essa diferença.

Uso:  python universos_1p.py --temp <pasta temporária fora do projeto>   (retoma: pula o que já existe)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import h5py
import hdf5plugin  # noqa: F401  (filtro Blosc dos snapshots do CAMELS)
import numpy as np

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent / "calculos"))
import conferencia_snapshot as cs  # noqa: E402

import exportar_ply as ep  # noqa: E402
import exportar_spz as ez  # noqa: E402
import gerar_splats as gs  # noqa: E402
from versao_completa import grao  # noqa: E402

SERVIDOR = "https://users.flatironinstitute.org/~camels"
SIMS = ["1P_p1_0", "1P_p2_n2", "1P_p2_n1", "1P_p2_1", "1P_p2_2", "1P_p1_n2", "1P_p1_n1", "1P_p1_1", "1P_p1_2"]
SEMENTE = 20261014                       # a mesma da F2.2 (subamostrar.py)
FRACOES = {"1_8": 1 / 8, "1_64": 1 / 64}
EXPOSICAO = 0.1                          # a mesma das versões padrão (exportar_ply)
SAIDA = PASTA / "dados" / "universos"


def baixar(url: str, destino: Path) -> int:
    """curl com retomada (-C -) e falha em erro HTTP; devolve o tamanho final em bytes.
    Proteção (21/10, a internet caiu e o curl ficou parado esperando): desiste se ficar 60 s abaixo de
    1 kB/s e tenta de novo até 5 vezes, continuando de onde parou."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["curl", "-sS", "-f", "-L", "-C", "-", "--speed-time", "60", "--speed-limit", "1024",
                    "--retry", "5", "--retry-delay", "10", "--retry-all-errors", "-o", str(destino), url], check=True)
    return destino.stat().st_size


def tamanho_remoto(url: str) -> int:
    r = subprocess.run(["curl", "-sSI", "-f", "-L", url], check=True, capture_output=True, text=True)
    linhas = [l for l in r.stdout.lower().splitlines() if l.startswith("content-length:")]
    return int(linhas[-1].split(":")[1])


def ler_param(arq: Path) -> dict:
    """Valores numéricos do 2LPT.param (Omega, Sigma8, HubbleParam, Seed, …)."""
    out = {}
    for linha in arq.read_text(errors="replace").splitlines():
        p = linha.split("%")[0].split()
        if len(p) >= 2:
            try:
                out[p[0]] = float(p[1])
            except ValueError:
                pass
    return out


def processar(sim: str, temp: Path, log) -> dict:
    pasta_sim = SAIDA / sim
    pasta_sim.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    # pequenos (ficam no projeto, para o verificador)
    baixar(f"{SERVIDOR}/Sims/IllustrisTNG_DM/1P/{sim}/ICs/2LPT.param", pasta_sim / "2LPT.param")
    baixar(f"{SERVIDOR}/Sims/IllustrisTNG_DM/1P/{sim}/ICs/Pk_m_z=0.000.txt", pasta_sim / "Pk_linear_z0_ICs.txt")
    baixar(f"{SERVIDOR}/Pk/IllustrisTNG_DM/L25n256/1P/{sim}/Pk_m_z=0.00.txt", pasta_sim / "Pk_oficial_z0.txt")
    par = ler_param(pasta_sim / "2LPT.param")
    # snapshot (grande, pasta temporária)
    url = f"{SERVIDOR}/Sims/IllustrisTNG_DM/1P/{sim}/snapshot_090.hdf5"
    arq = temp / sim / "snapshot_090.hdf5"
    esperado = tamanho_remoto(url)
    log(f"{sim}: baixando {esperado / 1e6:.0f} MB…")
    obtido = baixar(url, arq)
    if obtido != esperado:
        raise RuntimeError(f"{sim}: download incompleto ({obtido} de {esperado} bytes)")
    t_baixar = time.perf_counter() - t0
    with h5py.File(arq, "r") as f:
        hd = dict(f["Header"].attrs)
        pos = f["PartType1/Coordinates"][:].astype(np.float64) / 1e3   # kpc/h → Mpc/h
    L = float(hd["BoxSize"]) / 1e3
    m_p = float(hd["MassTable"][1]) * 1e10                              # M☉/h
    h_hub = float(hd["HubbleParam"])
    pos = np.mod(pos, L)
    N = len(pos)
    log(f"{sim}: Ωm={hd['Omega0']:.3f} σ8={par.get('Sigma8')} m_p={m_p:.4e} M☉/h, N={N}; densidades…")
    _, rho_full = gs.densidades(pos, m_p, L)
    # P(k) medido (mesmo procedimento do fase1_conferencia.pk_nosso_z0: devolve o shot noise)
    k, P, nmod = cs.espectro_medido(cs.cic(pos, L, 256), L, N)
    np.savez(pasta_sim / "pk_nosso_z0.npz", k=k, P=P + L ** 3 / N, n=nmod)
    alfa_g = gs.alfa_gaussiana()
    res = {"sim": sim, "omega_m": float(hd["Omega0"]), "sigma8": par.get("Sigma8"), "h": h_hub,
           "seed": par.get("Seed"), "massa_particula_msun_h": m_p, "n": N, "versoes": {}}
    for nome, f in FRACOES.items():
        n_sub = int(round(N * f))
        idx = np.sort(np.random.default_rng(SEMENTE).choice(N, size=n_sub, replace=False))
        p_sub = pos[idx]
        m_sub = N * m_p / n_sub
        h_sub, rho_sub = gs.densidades(p_sub, m_sub, L)
        sigma = (alfa_g * h_sub).astype(np.float64)
        rgb = ep.cores(rho_full["A_knn"][idx], "c_magma")         # régua da referência (ep.RHO_M, Ωm = 0,3)
        alfa = ep.opacidades(m_sub, sigma, EXPOSICAO)             # idem: mesma exposição para todos
        base = f"{sim}_{nome}"
        ez.gravar_spz_dados(SAIDA / f"{base}.spz", pos_centrada=(p_sub - L / 2).astype(np.float32),
                            log_escalas=np.repeat(np.log(sigma)[:, None], 3, axis=1).astype(np.float32),
                            f_dc=((rgb - 0.5) / ep.C0).astype(np.float32),
                            logit_alfa=np.log(alfa / (1 - alfa)).astype(np.float32))
        meta = {"arquivo": f"universos/{base}.spz", "n_splats": n_sub, "massa_por_splat_msun_h": m_sub,
                "massa_por_splat_msun": m_sub / h_hub, "grao_mpc_h": grao(sigma, rho_sub["A_knn"]),
                "origem": f"CAMELS IllustrisTNG_DM/1P/{sim}/snapshot_090.hdf5, subamostra {nome} (semente {SEMENTE})",
                "universo": {"sim": sim, "omega_m": res["omega_m"], "sigma8": res["sigma8"], "h": h_hub,
                             "seed": res["seed"]},
                "convencao": "cor e exposição com a densidade média da referência (Ωm = 0,3) para todos os universos",
                "nota": "grão = σ mediano das 10 % manchas mais densas; aviso de limite de detalhe"}
        (SAIDA / f"{base}.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        res["versoes"][nome] = {"mb": (SAIDA / f"{base}.spz").stat().st_size / 1e6,
                                "rho_A_mediana_sobre_media_ref": float(np.median(rho_full["A_knn"] / ep.RHO_M))}
    arq.unlink()                                                   # apaga o snapshot temporário
    res["tempo_s"] = {"baixar": round(t_baixar), "total": round(time.perf_counter() - t0)}
    (pasta_sim / "resultado.json").write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--temp", required=True, help="pasta temporária FORA do projeto para os snapshots")
    ap.add_argument("--sims", nargs="*", default=SIMS)
    a = ap.parse_args()
    temp = Path(a.temp)
    if PASTA.parent in temp.resolve().parents:
        raise SystemExit("a pasta temporária precisa ficar FORA do projeto")
    SAIDA.mkdir(parents=True, exist_ok=True)
    diario = SAIDA / "diario_download.txt"

    def log(msg: str) -> None:
        linha = f"{time.strftime('%H:%M:%S')} {msg}"
        print(linha, flush=True)
        with diario.open("a", encoding="utf-8") as fh:
            fh.write(linha + "\n")

    for sim in a.sims:
        if all((SAIDA / f"{sim}_{n}.spz").exists() for n in FRACOES):
            log(f"{sim}: já processada, pulando")
            continue
        try:
            r = processar(sim, temp, log)
            log(f"{sim}: pronta em {r['tempo_s']['total']} s ({r['versoes']['1_8']['mb']:.1f} + "
                f"{r['versoes']['1_64']['mb']:.1f} MB)")
        except Exception as e:  # registra e segue para a próxima (uma falha não derruba as outras)
            log(f"{sim}: FALHOU — {e!r}")
    log("fim")
