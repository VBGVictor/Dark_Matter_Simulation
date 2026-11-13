"""
tempo_f4.py — a teia se formando no tempo (F4.1–F4.3, 21/10/2026)
=================================================================

Decisão do Victor (21/10): 12 momentos da simulação principal (Universo 1, CAMELS IllustrisTNG_DM CV_0),
de z = 6 (universo com ~1 bilhão de anos) até hoje. ~2,2 GB de internet (cada snapshot ~200 MB numa pasta
temporária FORA do projeto, apagado depois); ~44 MB no projeto.

Para a animação, as MESMAS 262.144 partículas da versão 1/64 (as do sub_1_64.npz, achadas em cada momento pelo
número de identidade, ParticleIDs). Por momento e por partícula guarda:
  posição (comóvel, Mpc/h)  — exata do arquivo (quantizada em 16 bits: degrau L/65535 = 0,38 kpc/h)
  ritmo da posição dx/dt (Mpc/h por bilhão de anos) — para estimar a posição ENTRE momentos (Hermite cúbico)
       Unidade conferida na documentação do CAMELS (camels.readthedocs.io, snapshots): "need to multiply by
       sqrt(a) to get peculiar velocities" → v_pec = u·√a [km/s]; coordenada comóvel x = r/a → dx/dt = v_pec/a.
       1 km/s = 1,0227×10⁻³ Mpc/Gyr; × h para Mpc/h.
  tamanho σ da mancha naquele momento (32º vizinho NA VERSÃO 1/64, como as versões leves — F2.2)
  cor: índice magma da densidade A da partícula NA SIMULAÇÃO COMPLETA naquele momento (como o padrão), com a
       mesma régua (ρ̄m comóvel é constante no tempo)
Tempo cósmico t(a): integral de Friedmann, ΛCDM plano (Ωm 0,3, h 0,6711), t = ∫ da / (a H(a)).
Conferências guardadas para o verificador: P(k) medido de cada momento (para comparar com o oficial do CAMELS),
e a velocidade × o deslocamento real entre momentos vizinhos.

Saídas (não sobrescreve): dados/tempo/tempo_1_64.bin, tempo_1_64.json, e dados/tempo/<snap>/ (P(k) e conferências)
Uso:  python tempo_f4.py --temp <pasta fora do projeto>      (retoma: pula momentos já processados)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import h5py
import hdf5plugin  # noqa: F401
import numpy as np
from scipy import integrate

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA.parent / "calculos"))
import conferencia_snapshot as cs  # noqa: E402
import teoria_lcdm as teo  # noqa: E402

import estimadores_web as ew  # noqa: E402
import gerar_splats as gs  # noqa: E402

SERVIDOR = "https://users.flatironinstitute.org/~camels"
SIM = "CV/CV_0"
# 12 momentos (z aproximado → snapshot), aprovados pelo Victor; z exato é lido do próprio arquivo
MOMENTOS = ["014", "024", "032", "044", "052", "060", "068", "074", "080", "084", "088", "090"]
LOCAL_090 = PASTA.parent / "dados" / "CAMELS_IllustrisTNG_DM_CV_0" / "snapshot_090.hdf5"
SAIDA = PASTA / "dados" / "tempo"
L = 25.0
KM_S_EM_MPC_GYR = 1.0227121650537077e-3   # 1 km/s em Mpc por bilhão de anos (3,15576e16 s / 3,0857e19 km)


def baixar(url: str, destino: Path) -> int:
    destino.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["curl", "-sS", "-f", "-L", "-C", "-", "--speed-time", "60", "--speed-limit", "1024",
                    "--retry", "5", "--retry-delay", "10", "--retry-all-errors", "-o", str(destino), url], check=True)
    return destino.stat().st_size


def tempo_cosmico_gyr(a: float) -> float:
    """t(a) = ∫₀ᵃ da' / (a' H(a')), ΛCDM plano. H0 = 100 h km/s/Mpc → 1/H0 em Gyr."""
    h, om = teo.COSMO.h, teo.COSMO.omega_m
    inv_h0_gyr = 1 / (100 * h * KM_S_EM_MPC_GYR)          # 1/H0 em Gyr (H0 em 1/Gyr = 100h·km/s/Mpc)
    f = lambda x: 1 / (x * np.sqrt(om / x ** 3 + (1 - om)))
    return float(integrate.quad(f, 1e-8, a, limit=200)[0] * inv_h0_gyr)


def processar(snap: str, temp: Path, ids_alvo: np.ndarray, log) -> dict:
    pasta = SAIDA / snap
    pasta.mkdir(parents=True, exist_ok=True)
    if snap == "090":
        arq = LOCAL_090
    else:
        arq = temp / snap / f"snapshot_{snap}.hdf5"
        log(f"{snap}: baixando…")
        baixar(f"{SERVIDOR}/Sims/IllustrisTNG_DM/{SIM}/snapshot_{snap}.hdf5", arq)
    with h5py.File(arq, "r") as f:
        hd = dict(f["Header"].attrs)
        ids = f["PartType1/ParticleIDs"][:]
        pos = f["PartType1/Coordinates"][:].astype(np.float64) / 1e3
        u = f["PartType1/Velocities"][:].astype(np.float64)
    a, z = float(hd["Time"]), float(hd["Redshift"])
    pos = np.mod(pos, L)
    N = len(pos)
    m_p = float(hd["MassTable"][1]) * 1e10
    # as mesmas partículas da 1/64, pela identidade
    ordem = np.argsort(ids)
    onde = ordem[np.searchsorted(ids[ordem], ids_alvo)]
    assert np.array_equal(ids[onde], ids_alvo), "identidades não encontradas"
    # densidade A na simulação completa (cor) e P(k) (conferência)
    log(f"{snap}: z = {z:.3f}; densidades (16,8 mi)…")
    _, rho_full = gs.densidades(pos, m_p, L)
    k, P, nmod = cs.espectro_medido(cs.cic(pos, L, 256), L, N)
    np.savez(pasta / "pk_nosso.npz", k=k, P=P + L ** 3 / N, n=nmod, z=z)
    p = pos[onde]
    m_sub = N * m_p / len(p)
    h_sub, _ = gs.densidades(p, m_sub, L)
    sigma = gs.alfa_gaussiana() * h_sub
    v_pec = u[onde] * np.sqrt(a)                                       # km/s (documentação do CAMELS)
    dxdt = v_pec / a * KM_S_EM_MPC_GYR * teo.COSMO.h                    # Mpc/h por Gyr, comóvel
    cor = ew.indice_cor(rho_full["A_knn"][onde]).astype(np.uint8)
    np.savez(pasta / "momento.npz", pos=p.astype(np.float32), dxdt=dxdt.astype(np.float32),
             sigma=sigma.astype(np.float32), cor=cor, a=a, z=z, t=tempo_cosmico_gyr(a), m_sub=m_sub)
    if snap != "090":
        arq.unlink()
    return {"snap": snap, "z": z, "a": a, "t_gyr": tempo_cosmico_gyr(a),
            "sigma_mediano_kpc_h": float(np.median(sigma) * 1e3), "vel_mediana_km_s": float(np.median(np.linalg.norm(v_pec, axis=1)))}


def empacotar() -> dict:
    """Junta os momentos num binário compacto para o navegador (por momento, em blocos):
       pos int16×3 (x+L/2 em 0..65535), dxdt int16×3 (escala ESC_V), log σ uint8 (degrau 1/16, como o SPZ), cor uint8."""
    momentos = [np.load(SAIDA / s / "momento.npz") for s in MOMENTOS]
    vmax = float(max(np.abs(m["dxdt"]).max() for m in momentos))
    esc_v = vmax / 32767
    partes, meta_m = [], []
    for s, m in zip(MOMENTOS, momentos):
        # posições do momento.npz estão em [0, L) (np.mod), NÃO centradas. 1ª versão somava L/2 aqui → metade
        # das partículas estourava 65535 e ficava grudada nas paredes da caixa (achado a olho no navegador, 22/10)
        q = np.clip(np.round(m["pos"] / L * 65535), 0, 65535).astype("<u2")
        qv = np.clip(np.round(m["dxdt"] / esc_v), -32767, 32767).astype("<i2")
        ls = np.clip(np.round((np.log(m["sigma"]) + 10) * 16), 0, 255).astype(np.uint8)
        partes += [q.tobytes(), qv.tobytes(), ls.tobytes(), m["cor"].tobytes()]
        meta_m.append({"snap": s, "z": float(m["z"]), "a": float(m["a"]), "t_gyr": float(m["t"])})
    arq = SAIDA / "tempo_1_64.bin"
    arq.write_bytes(b"".join(partes))
    n = len(momentos[0]["pos"])
    meta = {"n": n, "momentos": meta_m, "lado_mpc_h": L, "massa_por_splat_msun_h": float(momentos[0]["m_sub"]),
            "escala_pos": L / 65535, "pos_origem": "byte·escala_pos em [0, L); o navegador subtrai L/2 (caixa centrada)", "escala_dxdt_mpc_h_por_gyr": esc_v, "log_sigma": "σ = exp(byte/16 − 10)",
            "bytes_por_momento": n * 14, "layout": "por momento: pos u16×3·n, dxdt i16×3·n, logσ u8·n, cor u8·n",
            "cor": "índice magma (paleta_lut.json) da densidade A na simulação completa naquele momento",
            "interpolacao": "Hermite cúbico em t com posição e dx/dt dos dois momentos vizinhos (estimativa, dita na tela)"}
    (SAIDA / "tempo_1_64.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"mb": arq.stat().st_size / 1e6, **{k: meta[k] for k in ("n", "escala_dxdt_mpc_h_por_gyr")}}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--temp", required=True)
    a = ap.parse_args()
    temp = Path(a.temp)
    if PASTA.parent in temp.resolve().parents:
        raise SystemExit("a pasta temporária precisa ficar FORA do projeto")
    SAIDA.mkdir(parents=True, exist_ok=True)
    diario = SAIDA / "diario.txt"

    def log(msg):
        linha = f"{time.strftime('%H:%M:%S')} {msg}"
        print(linha, flush=True)
        with diario.open("a", encoding="utf-8") as fh:
            fh.write(linha + "\n")

    sub = np.load(PASTA / "dados" / "sub_1_64.npz")
    with h5py.File(LOCAL_090, "r") as f:
        ids090 = f["PartType1/ParticleIDs"][:]
    ids_alvo = ids090[sub["idx"]]
    for s in MOMENTOS:
        if (SAIDA / s / "momento.npz").exists():
            log(f"{s}: já processado, pulando"); continue
        try:
            r = processar(s, temp, ids_alvo, log)
            log(f"{s}: pronto — z {r['z']:.3f}, t {r['t_gyr']:.2f} Gyr, σ mediano {r['sigma_mediano_kpc_h']:.0f} kpc/h, "
                f"velocidade mediana {r['vel_mediana_km_s']:.0f} km/s")
        except Exception as e:
            log(f"{s}: FALHOU — {e!r}")
    if all((SAIDA / s / "momento.npz").exists() for s in MOMENTOS):
        if (SAIDA / "tempo_1_64.bin").exists():
            log("tempo_1_64.bin já existe — não sobrescrevo")
        else:
            log(f"empacotado: {empacotar()}")
    log("fim")
