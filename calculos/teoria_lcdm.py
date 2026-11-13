"""
teoria_lcdm.py
==============

Cálculos teóricos de referência do projeto "Dentro da Teia" (dark_matter_3D).

Objetivo
--------
Antes de olhar a simulação, calcular com a teoria publicada o que ela DEVE
mostrar. Depois que os dados forem baixados, cada número abaixo vira um teste:
se a simulação não bater com a teoria dentro da tolerância conhecida, tem erro
de leitura ou de unidade no nosso código (não na física).

Nada aqui é inventado. Cada fórmula cita o artigo de origem, que está em
REFERENCIAS.xlsx (com link). Onde usamos um ajuste (fit) empírico, isso está dito, junto com
a precisão declarada pelos autores.

Cosmologia
----------
Parâmetros fiduciais do conjunto CV do CAMELS (camels.readthedocs.io,
página "parameters"):
    Omega_m = 0.3, Omega_b = 0.049, h = 0.6711, n_s = 0.9624,
    sigma_8 = 0.8, w = -1, M_nu = 0, Omega_k = 0  (universo plano)
Simulação: 256^3 partículas de matéria escura, caixa de 25 Mpc/h comóvel,
condições iniciais em z = 127 via 2LPT (Villaescusa-Navarro et al. 2021).

Convenções de unidade
---------------------
Massas em Msun/h, distâncias comóveis em Mpc/h, número de onda k em h/Mpc,
velocidades em km/s. Com essas unidades, h some das contas de densidade.

Uso
---
    python teoria_lcdm.py
Gera:
    resultados_teoria.json   -> todos os números
    figuras/*.png            -> gráficos de referência
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # sem janela: só salva arquivo
import matplotlib.pyplot as plt
import numpy as np
from scipy import integrate, optimize

# ---------------------------------------------------------------------------
# Constantes físicas
# ---------------------------------------------------------------------------
G_MPC_KMS2_MSUN = 4.300917e-9   # G em Mpc (km/s)^2 / Msun
HUBBLE_TIME_GYR_H = 9.777922    # 1/H0 em Gyr para H0 = 100 km/s/Mpc (dividir por h)
MPC_EM_MILHOES_ANOS_LUZ = 3.261564  # 1 Mpc = 3,26 milhões de anos-luz
T_CMB_K = 2.7255                # temperatura da radiação cósmica de fundo (Fixsen 2009)
DELTA_C_COLAPSO = 1.686         # sobredensidade linear crítica de colapso esférico (EdS);
                                # Tinker et al. 2008 usam "delta_c ≈ 1,69"

PASTA = Path(__file__).resolve().parent
PASTA_FIG = PASTA / "figuras"


@dataclass(frozen=True)
class Cosmologia:
    """Parâmetros cosmológicos do conjunto CV (fiducial) do CAMELS."""

    omega_m: float = 0.3
    omega_b: float = 0.049
    h: float = 0.6711
    n_s: float = 0.9624
    sigma_8: float = 0.8

    @property
    def omega_l(self) -> float:
        """Densidade de energia escura (universo plano, sem radiação)."""
        return 1.0 - self.omega_m


@dataclass(frozen=True)
class Simulacao:
    """Resolução da simulação CAMELS L25n256 (só matéria escura)."""

    caixa_mpc_h: float = 25.0
    n_lado: int = 256
    # SofteningHalo = 0.5 kpc/h comóvel, lido em G3.param-usedvalues desta rodada
    # (só matéria escura). O artigo (Villaescusa-Navarro+2021, §2) cita "~2 kpc"
    # para as rodadas hidrodinâmicas do modelo TNG; não vale para esta.
    softening_kpc: float = 0.5

    @property
    def n_particulas(self) -> int:
        return self.n_lado ** 3

    @property
    def volume(self) -> float:
        return self.caixa_mpc_h ** 3


COSMO = Cosmologia()
SIM = Simulacao()


# ---------------------------------------------------------------------------
# 1. Expansão do universo (equação de Friedmann, ΛCDM plano)
# ---------------------------------------------------------------------------
def E(a: np.ndarray | float, c: Cosmologia = COSMO) -> np.ndarray | float:
    """H(a)/H0 = sqrt(Ωm a^-3 + ΩΛ). Radiação desprezada (irrelevante para z < 127
    no nível de precisão deste projeto; o próprio código Gadget também a omite)."""
    return np.sqrt(c.omega_m * a ** -3 + c.omega_l)


def densidade_critica_h2() -> float:
    """ρ_crit,0 = 3 H0^2 / (8 π G) em (Msun/h) / (Mpc/h)^3."""
    return 3.0 * 100.0 ** 2 / (8.0 * np.pi * G_MPC_KMS2_MSUN)


def idade_universo_gyr(a: float = 1.0, c: Cosmologia = COSMO) -> dict:
    """Idade em a: forma analítica do ΛCDM plano e conferência por integral numérica.

    t(a) = 2 / (3 H0 sqrt(ΩΛ)) · asinh( sqrt(ΩΛ/Ωm) · a^{3/2} )
    """
    hubble_time = HUBBLE_TIME_GYR_H / c.h
    analitica = (2.0 / (3.0 * np.sqrt(c.omega_l))) * np.arcsinh(
        np.sqrt(c.omega_l / c.omega_m) * a ** 1.5) * hubble_time
    numerica = integrate.quad(lambda x: 1.0 / (x * E(x, c)), 0.0, a)[0] * hubble_time
    return {"analitica_gyr": analitica, "numerica_gyr": numerica}


# ---------------------------------------------------------------------------
# 2. Crescimento linear das estruturas
# ---------------------------------------------------------------------------
def fator_crescimento(a: float, c: Cosmologia = COSMO) -> float:
    """D(a) não normalizado (integral de Heath 1977, válida para matéria + Λ):

        D(a) = (5 Ωm / 2) · E(a) · ∫_0^a da' / (a' E(a'))^3

    Em um universo só de matéria (Einstein–de Sitter) D(a) = a.
    """
    integral = integrate.quad(lambda x: 1.0 / (x * E(x, c)) ** 3, 0.0, a)[0]
    return 2.5 * c.omega_m * E(a, c) * integral


def taxa_crescimento(a: float, c: Cosmologia = COSMO) -> float:
    """f = d ln D / d ln a (derivada numérica centrada)."""
    eps = 1e-4
    return (np.log(fator_crescimento(a * (1 + eps), c)) - np.log(fator_crescimento(a * (1 - eps), c))) / (
        np.log(1 + eps) - np.log(1 - eps))


# ---------------------------------------------------------------------------
# 3. Espectro de potência linear (Eisenstein & Hu 1998, forma sem oscilações)
# ---------------------------------------------------------------------------
def transferencia_eh98_sem_wiggles(k_h: np.ndarray, c: Cosmologia = COSMO) -> np.ndarray:
    """Função de transferência T(k) de Eisenstein & Hu (1998), eqs. (26), (28)–(31).

    Ignora as oscilações acústicas dos bárions (BAO). Os autores declaram que as
    oscilações modulam a potência em ≲ 20 % quando Ωb/Ω0 ≲ Ω0h² + 0,2 (nosso caso:
    0,163 < 0,335). Para a escala da caixa (k ≥ 0,25 h/Mpc) as BAO já são quase
    irrelevantes. Para precisão de ~1 %, trocar por CAMB ou pelo espectro de
    entrada da própria simulação (pasta ICs/ do CAMELS).

    k_h: número de onda em h/Mpc.
    """
    om_h2 = c.omega_m * c.h ** 2
    ob_h2 = c.omega_b * c.h ** 2
    fb = c.omega_b / c.omega_m
    theta = T_CMB_K / 2.7

    s = 44.5 * np.log(9.83 / om_h2) / np.sqrt(1.0 + 10.0 * ob_h2 ** 0.75)            # eq. 26 [Mpc]
    alpha_g = 1.0 - 0.328 * np.log(431.0 * om_h2) * fb + 0.38 * np.log(22.3 * om_h2) * fb ** 2  # eq. 31
    k_mpc = k_h * c.h                                                                   # eq. 30 usa k em 1/Mpc
    gamma_eff = c.omega_m * c.h * (alpha_g + (1.0 - alpha_g) / (1.0 + (0.43 * k_mpc * s) ** 4))  # eq. 30
    q = k_h * theta ** 2 / gamma_eff                                                    # eq. 28
    L0 = np.log(2.0 * np.e + 1.8 * q)                                                   # eq. 29
    C0 = 14.2 + 731.0 / (1.0 + 62.5 * q)
    return L0 / (L0 + C0 * q ** 2)


def janela_tophat(x: np.ndarray) -> np.ndarray:
    """Transformada de Fourier da esfera sólida: W(x) = 3 (sin x − x cos x) / x³."""
    x = np.asarray(x, dtype=float)
    out = np.ones_like(x)
    m = x > 1e-4
    out[m] = 3.0 * (np.sin(x[m]) - x[m] * np.cos(x[m])) / x[m] ** 3
    return out


K_GRADE = np.logspace(-5, 3, 20000)  # h/Mpc, grade de integração


def _sigma2_bruto(R: float, P_sem_norm: np.ndarray, k_min: float = 0.0) -> float:
    """σ²(R) = 1/(2π²) ∫ P(k) W²(kR) k² dk  (integral em ln k)."""
    k = K_GRADE
    integrando = P_sem_norm * janela_tophat(k * R) ** 2 * k ** 3 / (2 * np.pi ** 2)
    integrando = np.where(k >= k_min, integrando, 0.0)
    return integrate.simpson(integrando, x=np.log(k))


def espectro_linear(c: Cosmologia = COSMO) -> tuple[np.ndarray, float]:
    """P(k, z=0) = A · k^{n_s} · T(k)², com A fixado para que σ(8 Mpc/h) = σ8."""
    P_sem_norm = K_GRADE ** c.n_s * transferencia_eh98_sem_wiggles(K_GRADE, c) ** 2
    A = c.sigma_8 ** 2 / _sigma2_bruto(8.0, P_sem_norm)
    return A * P_sem_norm, A


P_LIN, AMPLITUDE = espectro_linear()

# Espectro linear EXATO usado nas condições iniciais da simulação (CAMB, z = 0),
# baixado de ICs/Pk_m_z=0.000.txt. Unidades: k em h/Mpc, P em (Mpc/h)³
# (2LPT.param: InputSpectrum_UnitLength_in_cm = 3.085678e24 = 1 Mpc/h).
ARQ_PK_CAMB = PASTA.parent / "dados" / "CAMELS_IllustrisTNG_DM_CV_0" / "parametros" / "Pk_m_z=0.000.txt"


def sigma8_do_espectro_camb() -> dict | None:
    """σ8 do espectro tabelado da simulação e diferença para a forma de Eisenstein & Hu.
    O gerador de condições iniciais (2LPT, Sigma8 = 0.8) renormaliza para σ8 = 0,8;
    este cálculo confere a forma e a normalização do arquivo."""
    if not ARQ_PK_CAMB.exists():
        return None
    k_c, p_c = np.loadtxt(ARQ_PK_CAMB, unpack=True)
    lnk = np.log(k_c)
    s8 = np.sqrt(integrate.simpson(p_c * janela_tophat(k_c * 8.0) ** 2 * k_c ** 3 / (2 * np.pi ** 2), x=lnk))
    p_eh = np.interp(lnk, np.log(K_GRADE), P_LIN) * (s8 / COSMO.sigma_8) ** 2  # mesma normalização
    razao = p_eh / p_c
    faixa = (k_c >= 2 * np.pi / SIM.caixa_mpc_h) & (k_c <= np.pi * SIM.n_lado / SIM.caixa_mpc_h)
    return {
        "k_min_max_arquivo": [float(k_c.min()), float(k_c.max())],
        "sigma8_do_arquivo": float(s8),
        "razao_EH_sobre_CAMB_na_faixa_da_caixa_min_max": [float(razao[faixa].min()), float(razao[faixa].max())],
        "_k": k_c, "_p": p_c,
    }


def sigma_R(R: float, k_min: float = 0.0) -> float:
    return np.sqrt(_sigma2_bruto(R, P_LIN, k_min))


def raio_da_massa(M: float, c: Cosmologia = COSMO) -> float:
    """R tal que a esfera de densidade média contém M: R = (3M / 4π ρ̄m)^{1/3}."""
    rho_m = c.omega_m * densidade_critica_h2()
    return (3.0 * M / (4.0 * np.pi * rho_m)) ** (1.0 / 3.0)


# ---------------------------------------------------------------------------
# 4. Quantos halos (aglomerados de matéria escura) a caixa deve ter
# ---------------------------------------------------------------------------
def f_tinker08_200m(sig: np.ndarray, z: float = 0.0) -> np.ndarray:
    """Tinker et al. (2008), eq. (3) e Tabela 2 (Δ = 200 em relação à densidade MÉDIA),
    com a evolução em z das eqs. (5)–(8). Ajuste calibrado em simulações, precisão
    declarada de ~5 % para z = 0."""
    A0, a0, b0, c0 = 0.186, 1.47, 2.57, 1.19
    delta = 200.0
    alpha = 10 ** (-(0.75 / np.log10(delta / 75.0)) ** 1.2)
    A = A0 * (1 + z) ** -0.14
    a = a0 * (1 + z) ** -0.06
    b = b0 * (1 + z) ** -alpha
    return A * ((sig / b) ** -a + 1.0) * np.exp(-c0 / sig ** 2)


def _f_st_sem_norm(sig: np.ndarray, a: float = 0.707, p: float = 0.3) -> np.ndarray:
    nu = DELTA_C_COLAPSO / sig
    return np.sqrt(2 * a / np.pi) * (1 + (a * nu ** 2) ** -p) * nu * np.exp(-a * nu ** 2 / 2)


def normalizacao_sheth_tormen() -> float:
    """Sheth & Tormen (1999), eq. (10): A é fixado exigindo que a integral sobre todo ν
    dê 1 (toda a massa está em algum halo). Calculado aqui numericamente."""
    lnnu = np.linspace(np.log(1e-6), np.log(50), 200000)
    sig = DELTA_C_COLAPSO / np.exp(lnnu)
    return 1.0 / integrate.simpson(_f_st_sem_norm(sig), x=lnnu)


A_ST = normalizacao_sheth_tormen()


def f_sheth_tormen(sig: np.ndarray) -> np.ndarray:
    """Função de multiplicidade de Sheth & Tormen (1999) com a = 0,707, p = 0,3.
    Corresponde aproximadamente a halos de friends-of-friends (b = 0,2)."""
    return A_ST * _f_st_sem_norm(sig)


def funcao_de_massa(massas: np.ndarray, f_sigma, k_min: float = 0.0) -> np.ndarray:
    """dn/dlnM = f(σ) · ρ̄m / M · |d ln σ / d ln M|   [halos por (Mpc/h)^3 por ln M]."""
    rho_m = COSMO.omega_m * densidade_critica_h2()
    sig = np.array([sigma_R(raio_da_massa(m), k_min) for m in massas])
    dlnsig_dlnm = np.gradient(np.log(sig), np.log(massas))
    return f_sigma(sig) * rho_m / massas * np.abs(dlnsig_dlnm), sig


def contagem_acumulada(massas: np.ndarray, dndlnm: np.ndarray, volume: float) -> np.ndarray:
    """N(>M) na caixa = V · ∫_M^∞ dn/dlnM dlnM."""
    lnm = np.log(massas)
    acumulada = np.array([integrate.simpson(dndlnm[i:], x=lnm[i:]) if i < len(lnm) - 1 else 0.0
                          for i in range(len(lnm))])
    return acumulada * volume


# ---------------------------------------------------------------------------
# 5. Estrutura de um halo: perfil NFW + concentração de Duffy et al. (2008)
# ---------------------------------------------------------------------------
def delta_virial_bryan_norman(z: float = 0.0, c: Cosmologia = COSMO) -> float:
    """Bryan & Norman (1998), eq. (6), caso ΩR = 0 (com Λ):
    Δc = 18π² + 82x − 39x²,  x = Ωm(z) − 1.  Relativo à densidade CRÍTICA."""
    a = 1.0 / (1.0 + z)
    om_z = c.omega_m * a ** -3 / E(a, c) ** 2
    x = om_z - 1.0
    return 18 * np.pi ** 2 + 82 * x - 39 * x ** 2


def concentracao_duffy08_200c(M200c: float, z: float = 0.0, linha: str = "auto") -> float:
    """Duffy et al. (2008), eq. (4) e Tabela 1, perfil NFW, Δ = 200 (crítica), amostra
    completa (F), Mpivot = 2e12 Msun/h. A Tabela 1 tem duas linhas:
      "z0"   (ajuste só em z = 0):  A = 5,74, B = −0,097, C = 0
      "z0-2" (ajuste em z = 0–2):   A = 5,71, B = −0,084, C = −0,47  ← a que o Colossus usa
    linha="auto" usa "z0" quando z == 0 e "z0-2" caso contrário.
    Calibrada na cosmologia WMAP5 (Ωm = 0,258, σ8 = 0,796): para Ωm = 0,3 é aproximação."""
    if linha == "auto":
        linha = "z0" if z == 0.0 else "z0-2"
    if linha == "z0":
        A, B, C = 5.74, -0.097, 0.0
    else:
        A, B, C = 5.71, -0.084, -0.47
    return A * (M200c / 2e12) ** B * (1 + z) ** C


# ---------------------------------------------------------------------------
# Modelo de concentração (decisão do Victor em 14/10/2026: trocar Duffy por modelo moderno)
# ---------------------------------------------------------------------------
# Padrão: Diemer & Joyce (2019), ApJ 871, 168 — modelo físico calibrado em várias
# cosmologias. Critério da escolha (independente do nosso resultado): é o modelo-padrão
# da biblioteca Colossus. Implementação: a do próprio Colossus, escrita pelo autor do
# modelo (B. Diemer). Estatística: mediana — a mesma que medimos no Rockstar.
# Alternativa: Ludlow et al. (2016), MNRAS 460, 1214. Duffy+08 fica disponível para
# comparação (calibrado em WMAP5; ficou 30–41 % abaixo dos halos da simulação, F1.4).
# Escolha pela linha de comando:  python teoria_lcdm.py --concentracao ludlow16
MODELOS_CONCENTRACAO = ("diemer19", "ludlow16", "duffy08_z0", "duffy08_z0-2")
CONCENTRACAO_PADRAO = "diemer19"
_COLOSSUS_PRONTO = False


def _colossus_cosmologia() -> None:
    """Configura o Colossus com a cosmologia do CAMELS (uma vez só)."""
    global _COLOSSUS_PRONTO
    if _COLOSSUS_PRONTO:
        return
    from colossus.cosmology import cosmology

    cosmology.setCosmology("camels_cv", params={
        "flat": True, "H0": 100 * COSMO.h, "Om0": COSMO.omega_m, "Ob0": COSMO.omega_b,
        "sigma8": COSMO.sigma_8, "ns": COSMO.n_s, "relspecies": False, "Tcmb0": T_CMB_K})
    _COLOSSUS_PRONTO = True


def concentracao_200c(M200c: float, modelo: str | None = None, z: float = 0.0) -> float:
    """Concentração mediana c200c para a massa M200c [Msun/h], pelo modelo escolhido."""
    modelo = modelo or CONCENTRACAO_PADRAO
    if modelo.startswith("duffy08"):
        return concentracao_duffy08_200c(M200c, z, linha=modelo.split("_", 1)[1])
    import warnings

    from colossus.halo import concentration

    _colossus_cosmologia()
    with warnings.catch_warnings():  # aviso de "fora da faixa calibrada" é tratado na documentação
        warnings.simplefilter("ignore")
        return float(concentration.concentration(M200c, "200c", z, model=modelo))


def halo_nfw(M200c: float, modelo: str | None = None) -> dict:
    """Propriedades de um halo de massa M200c (Msun/h) em z = 0.

    NFW (1997), eq. (1): ρ(r) = ρcrit δc / [(r/rs)(1 + r/rs)²]
    com δc = (200/3) c³ / [ln(1+c) − c/(1+c)]  e  rs = R200 / c.
    modelo: um de MODELOS_CONCENTRACAO (None = CONCENTRACAO_PADRAO).
    """
    rho_c = densidade_critica_h2()
    R200 = (3 * M200c / (4 * np.pi * 200 * rho_c)) ** (1 / 3)            # Mpc/h
    conc = concentracao_200c(M200c, modelo)
    rs = R200 / conc
    mu = np.log(1 + conc) - conc / (1 + conc)
    delta_c = (200.0 / 3.0) * conc ** 3 / mu
    V200 = np.sqrt(G_MPC_KMS2_MSUN * M200c / R200)                         # km/s (h se cancela)
    m_p = massa_particula()
    return {
        "M200c_msun_h": M200c,
        "M200c_msun": M200c / COSMO.h,
        "R200c_kpc_h": R200 * 1e3,
        "concentracao_c200": conc,
        "raio_de_escala_rs_kpc_h": rs * 1e3,
        "delta_c_nfw": delta_c,
        "V200_km_s": V200,
        "particulas_no_halo": M200c / m_p,
        "rs_sobre_softening": rs * 1e3 / SIM.softening_kpc,
    }


def perfil_nfw(r_kpc_h: np.ndarray, info: dict) -> np.ndarray:
    """ρ(r)/ρ̄m para desenhar o perfil."""
    x = r_kpc_h / info["raio_de_escala_rs_kpc_h"]
    return info["delta_c_nfw"] / (x * (1 + x) ** 2) / COSMO.omega_m


# ---------------------------------------------------------------------------
# 6. Resolução da simulação e orçamento dos splats
# ---------------------------------------------------------------------------
def massa_particula() -> float:
    """m_p = Ωm ρcrit L³ / N  [Msun/h]. Em simulação só de matéria escura cada partícula
    carrega TODA a matéria (Ωm), não só Ωm − Ωb. Conferência: Villaescusa-Navarro+2021
    dão 6,49e7·(Ωm−Ωb)/0,251 para a parte escura dos runs hidrodinâmicos; com Ωm no
    lugar de (Ωm−Ωb) o resultado é o mesmo número."""
    return COSMO.omega_m * densidade_critica_h2() * SIM.volume / SIM.n_particulas


def escala_nao_linear() -> float:
    """k_nl onde Δ²(k) = k³ P(k) / 2π² = 1 em z = 0. Acima disso a teoria linear
    deixa de valer e só a simulação N-corpos descreve a teia."""
    delta2 = K_GRADE ** 3 * P_LIN / (2 * np.pi ** 2)
    i = np.argmax(delta2 >= 1.0)
    return float(np.interp(1.0, delta2[i - 1:i + 1], K_GRADE[i - 1:i + 1]))


def orcamento_splats() -> list[dict]:
    """Quantos splats e quantos bytes para diferentes frações da simulação.

    Bytes por splat (formato .ply do 3D Gaussian Splatting, Kerbl et al. 2023):
      - completo com harmônicos esféricos grau 3: 62 floats = 248 bytes
      - só cor base (grau 0), sem normais: 14 floats = 56 bytes
    Formatos comprimidos (SPZ) são bem menores; estes números são o teto, em estimativa.
    Subamostra aleatória de fração f: massa por splat vira m_p / f e a distância típica
    entre splats cresce por f^(−1/3).
    """
    m_p = massa_particula()
    sep = SIM.caixa_mpc_h * 1e3 / SIM.n_lado
    linhas = []
    for nome, f in [("completa (256³)", 1.0), ("1/8 (128³ equiv.)", 1 / 8), ("1/64 (64³ equiv.)", 1 / 64)]:
        n = int(SIM.n_particulas * f)
        linhas.append({
            "fracao": nome,
            "n_splats": n,
            "massa_por_splat_msun_h": m_p / f,
            "separacao_media_kpc_h": sep * f ** (-1 / 3),
            "mb_ply_grau3": n * 248 / 1e6,
            "mb_ply_grau0": n * 56 / 1e6,
        })
    return linhas


# ---------------------------------------------------------------------------
# Execução
# ---------------------------------------------------------------------------
def main() -> None:
    PASTA_FIG.mkdir(exist_ok=True)
    res: dict = {"cosmologia": asdict(COSMO) | {"omega_l": COSMO.omega_l}, "simulacao": asdict(SIM)}

    # 1. Fundo cosmológico
    caixa_mpc = SIM.caixa_mpc_h / COSMO.h
    res["fundo"] = {
        "rho_crit_0_msun_h_por_mpc_h3": densidade_critica_h2(),
        "rho_media_materia_msun_h_por_mpc_h3": COSMO.omega_m * densidade_critica_h2(),
        "idade_universo": idade_universo_gyr(),
        "idade_em_z127_milhoes_anos": idade_universo_gyr(1 / 128)["analitica_gyr"] * 1e3,
        "caixa_mpc_sem_h": caixa_mpc,
        "caixa_milhoes_anos_luz": caixa_mpc * MPC_EM_MILHOES_ANOS_LUZ,
        "z_igualdade_materia_lambda": (COSMO.omega_l / COSMO.omega_m) ** (1 / 3) - 1,
    }

    # 2. Crescimento
    D1 = fator_crescimento(1.0)
    res["crescimento"] = {
        "D_z0_sem_normalizar": D1,
        "supressao_vs_einstein_de_sitter": D1,
        "D_z127_normalizado": fator_crescimento(1 / 128) / D1,
        "f_z0": taxa_crescimento(1.0),
        "f_z0_aprox_linder_om055": COSMO.omega_m ** 0.55,
    }

    # 3. Espectro e escalas
    k_f = 2 * np.pi / SIM.caixa_mpc_h
    k_ny = np.pi * SIM.n_lado / SIM.caixa_mpc_h
    res["espectro"] = {
        "amplitude_A": AMPLITUDE,
        "sigma8_conferencia": sigma_R(8.0),
        "k_fundamental_caixa_h_mpc": k_f,
        "k_nyquist_particulas_h_mpc": k_ny,
        "k_nao_linear_z0_h_mpc": escala_nao_linear(),
        "sigma8_so_com_modos_da_caixa": sigma_R(8.0, k_min=k_f),
    }
    camb = sigma8_do_espectro_camb()
    if camb is not None:
        res["espectro"]["conferencia_com_CAMB_da_simulacao"] = {k: v for k, v in camb.items() if not k.startswith("_")}

    # 4. Funções de massa
    massas = np.logspace(9, 15, 241)
    dn_t, sig = funcao_de_massa(massas, f_tinker08_200m)
    dn_st, _ = funcao_de_massa(massas, f_sheth_tormen)
    dn_t_cx, _ = funcao_de_massa(massas, f_tinker08_200m, k_min=k_f)
    N_t = contagem_acumulada(massas, dn_t, SIM.volume)
    N_st = contagem_acumulada(massas, dn_st, SIM.volume)
    N_t_cx = contagem_acumulada(massas, dn_t_cx, SIM.volume)
    alvo = [1e10, 1e11, 1e12, 1e13, 1e14]
    res["halos_esperados_na_caixa"] = {
        "normalizacao_sheth_tormen_A": A_ST,
        "tabela": [{
            "M_min_msun_h": m,
            "particulas_por_halo": m / massa_particula(),
            "N_maior_que_M_tinker08_200m": float(np.interp(np.log(m), np.log(massas), N_t)),
            "N_maior_que_M_sheth_tormen_fof": float(np.interp(np.log(m), np.log(massas), N_st)),
            "N_maior_que_M_tinker_so_modos_da_caixa": float(np.interp(np.log(m), np.log(massas), N_t_cx)),
        } for m in alvo],
    }

    # 5. Halos típicos
    res["virial"] = {
        "Delta_c_bryan_norman_z0_vs_critica": delta_virial_bryan_norman(0.0),
        "Delta_vir_z0_vs_media": delta_virial_bryan_norman(0.0) / COSMO.omega_m,
    }
    halos = {"anao_1e10": 1e10, "via_lactea_1e12_msun": 1e12 * COSMO.h, "grupo_1e13": 1e13}
    res["modelo_concentracao_usado"] = CONCENTRACAO_PADRAO
    res["halos_nfw"] = {k: halo_nfw(v) for k, v in halos.items()}
    res["halos_nfw_comparacao_modelos"] = {
        k: {mod: {"c200": (h := halo_nfw(v, mod))["concentracao_c200"], "rs_kpc_h": h["raio_de_escala_rs_kpc_h"]}
            for mod in MODELOS_CONCENTRACAO} for k, v in halos.items()}

    # 6. Resolução e splats
    res["resolucao"] = {
        "massa_particula_msun_h": massa_particula(),
        "separacao_media_entre_particulas_kpc_h": SIM.caixa_mpc_h * 1e3 / SIM.n_lado,
        "n_particulas": SIM.n_particulas,
    }
    res["orcamento_splats"] = orcamento_splats()

    (PASTA / "resultados_teoria.json").write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")

    # ---- Figuras -----------------------------------------------------------
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.loglog(K_GRADE, P_LIN, color="#4b3b8f", label="Eisenstein & Hu 1998 (sem BAO)")
    if camb is not None:
        ax.loglog(camb["_k"], camb["_p"], color="#e76f51", lw=1, ls="--", label="CAMB usado na simulação")
        ax.legend(fontsize=8, loc="lower left")
    ax.axvline(k_f, ls="--", color="gray"); ax.text(k_f * 1.1, 1e-1, "maior onda\nda caixa", fontsize=8)
    ax.axvline(k_ny, ls="--", color="gray"); ax.text(k_ny * 1.1, 1e-1, "Nyquist\npartículas", fontsize=8)
    ax.axvline(res["espectro"]["k_nao_linear_z0_h_mpc"], ls=":", color="#2a9d8f")
    ax.set_xlim(1e-4, 1e2); ax.set_ylim(1e-2, 1e5)
    ax.set_xlabel("k [h/Mpc]"); ax.set_ylabel("P(k) [(Mpc/h)³]")
    ax.set_title("Espectro de potência linear, z = 0 (Eisenstein & Hu 1998)")
    fig.tight_layout(); fig.savefig(PASTA_FIG / "01_espectro_linear.png", dpi=130); plt.close(fig)

    zs = np.linspace(0, 10, 200)
    Ds = [fator_crescimento(1 / (1 + z)) / D1 for z in zs]
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.plot(zs, Ds, color="#4b3b8f", label="ΛCDM (CAMELS)")
    ax.plot(zs, 1 / (1 + zs), ls="--", color="gray", label="só matéria, D = a")
    ax.set_xlabel("redshift z"); ax.set_ylabel("D(z) / D(0)"); ax.legend()
    ax.set_title("Crescimento linear das estruturas")
    fig.tight_layout(); fig.savefig(PASTA_FIG / "02_fator_crescimento.png", dpi=130); plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.loglog(massas, N_t, label="Tinker+08 (Δ=200 média)", color="#4b3b8f")
    ax.loglog(massas, N_st, label="Sheth & Tormen 99 (≈FoF)", color="#2a9d8f")
    ax.loglog(massas, N_t_cx, ls="--", label="Tinker, só modos que cabem na caixa", color="#e76f51")
    ax.axvline(100 * massa_particula(), ls=":", color="gray"); ax.text(100 * massa_particula() * 1.1, 2, "100 partículas", fontsize=8)
    ax.set_ylim(0.5, 1e5); ax.set_xlabel("M [Msun/h]"); ax.set_ylabel("N(>M) na caixa de (25 Mpc/h)³")
    ax.set_title("Quantos halos a simulação deve ter"); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(PASTA_FIG / "03_halos_esperados.png", dpi=130); plt.close(fig)

    info = res["halos_nfw"]["via_lactea_1e12_msun"]
    r = np.logspace(np.log10(SIM.softening_kpc), np.log10(info["R200c_kpc_h"]), 200)
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.loglog(r, perfil_nfw(r, info), color="#4b3b8f")
    ax.axvline(info["raio_de_escala_rs_kpc_h"], ls="--", color="gray"); ax.text(info["raio_de_escala_rs_kpc_h"] * 1.05, 1e5, "rs", fontsize=9)
    ax.set_xlabel("r [kpc/h]"); ax.set_ylabel("ρ / ρ̄m")
    ax.set_title("Perfil NFW de um halo tipo Via Láctea (1e12 Msun)")
    fig.tight_layout(); fig.savefig(PASTA_FIG / "04_perfil_nfw_via_lactea.png", dpi=130); plt.close(fig)

    # 07: modelos de concentração lado a lado
    Ms = np.logspace(10, 14, 60)
    estilos = {"diemer19": ("#4b3b8f", "-", "Diemer & Joyce 2019 (padrão)"),
               "ludlow16": ("#2a9d8f", "-", "Ludlow et al. 2016"),
               "duffy08_z0": ("#e76f51", "--", "Duffy+08 linha 'z = 0'"),
               "duffy08_z0-2": ("#f4a261", ":", "Duffy+08 linha 'z = 0–2'")}
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.5))
    for mod, (cor, ls, rot) in estilos.items():
        a1.semilogx(Ms, [concentracao_200c(m, mod) for m in Ms], color=cor, ls=ls, label=rot)
        inf = halo_nfw(1e12 * COSMO.h, mod)
        rr = np.logspace(np.log10(SIM.softening_kpc), np.log10(inf["R200c_kpc_h"]), 200)
        a2.loglog(rr, perfil_nfw(rr, inf), color=cor, ls=ls, label=f"{rot}: c = {inf['concentracao_c200']:.2f}")
    a1.axvspan(1e10, 1e11, color="gray", alpha=0.15); a1.text(1.2e10, 4.2, "fora da faixa\ncalibrada (Duffy)", fontsize=8)
    a1.set_xlabel("M200c [Msun/h]"); a1.set_ylabel("concentração c200 (mediana)"); a1.legend(fontsize=8)
    a1.set_title("Concentração × massa")
    a2.set_xlabel("r [kpc/h]"); a2.set_ylabel("ρ / ρ̄m"); a2.legend(fontsize=7)
    a2.set_title("Perfil do halo tipo Via Láctea")
    fig.tight_layout(); fig.savefig(PASTA_FIG / "07_modelos_concentracao.png", dpi=130); plt.close(fig)

    print(json.dumps(res, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Cálculos teóricos do projeto Dentro da Teia")
    ap.add_argument("--concentracao", choices=MODELOS_CONCENTRACAO, default=CONCENTRACAO_PADRAO,
                    help="modelo de concentração dos halos (padrão: diemer19)")
    CONCENTRACAO_PADRAO = ap.parse_args().concentracao
    main()
