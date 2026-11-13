"""
fase1_conferencia.py
====================

Fase 1 do backlog: transformar as pendências 🟡/🔴 em conferência contra fontes
externas, usando arquivos publicados pelos próprios autores do CAMELS.

Itens
-----
F1.1  Nosso P(k) medido  ×  P(k) oficial do CAMELS (z = 0)
F1.3  Contagem de halos do catálogo Rockstar  ×  Tinker08
F1.4  Concentração medida (Rockstar)  ×  as duas linhas da Tabela 1 de Duffy+08
F1.5  P(k) oficial  ×  halofit (Takahashi et al. 2012), calculado com o CAMB
F1.6  Déficit na maior escala: P(k) oficial em z = 127 (condições iniciais)  ×  teoria

Critérios de aprovação (registrados ANTES de ver os resultados, 14/10/2026)
--------------------------------------------------------------------------
F1.1  |nosso/oficial − 1| < 2 % para 0,5 ≤ k ≤ 10 h/Mpc
F1.3  em cada faixa de massa com ≥ 10 halos, a contagem (± 2σ de Poisson) cruza a banda
      [min(Tinker cheio, Tinker só modos da caixa) × 0,9 ; max(...) × 1,1]
F1.4  a linha de Duffy mais próxima da mediana medida vira o padrão; se a diferença entre
      as linhas for menor que o erro da mediana → "indistinguível", mantém "z0"
F1.5  |oficial/halofit − 1| ≤ 5 % para 0,5 ≤ k ≤ 1 e ≤ 10 % para 1 < k ≤ 10 h/Mpc
      (precisão declarada no resumo de Takahashi et al. 2012 para z ≤ 3)
F1.6  se P_oficial(z=127) / [D(127)² P_linear] no primeiro ponto de k for < 0,75, o
      déficit vem da semente aleatória das condições iniciais (variância cósmica)

Fontes dos arquivos (baixados em 14/10/2026 de users.flatironinstitute.org/~camels/):
    Pk/IllustrisTNG_DM/L25n256/CV/CV_0/Pk_m_z=*.txt
    Rockstar/IllustrisTNG_DM/L25n256/CV/CV_0/hlists/hlist_1.00000.list (+ rockstar_params.cfg)
Método do P(k) oficial (Villaescusa-Navarro+2023 §3.5.1): CIC em grade 512³, correção
da janela, média dos modos por casca. O nosso usa grade 256³ (limite de memória da
máquina: 2 GB livres), por isso as escalas pequenas podem diferir por método.

Uso:  python fase1_conferencia.py
Gera: fase1_resultados.json e figuras/08_* a 12_*
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import teoria_lcdm as teo

PASTA = Path(__file__).resolve().parent
DADOS = PASTA.parent / "dados" / "CAMELS_IllustrisTNG_DM_CV_0"
PASTA_PK = DADOS / "Pk_oficial"
ARQ_ROCKSTAR = DADOS / "rockstar" / "hlist_1.00000.list"
CACHE = PASTA / "cache"
FIG = PASTA / "figuras"


# ---------------------------------------------------------------------------
# Leitura
# ---------------------------------------------------------------------------
def pk_oficial(z: str) -> tuple[np.ndarray, np.ndarray]:
    """P(k) publicado pelo CAMELS. Colunas: k [h/Mpc], P [(Mpc/h)³]."""
    k, p = np.loadtxt(PASTA_PK / f"Pk_m_z={z}.txt", unpack=True)
    return k, p


def pk_nosso_z0() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Nosso P(k) do snapshot z = 0 (grade 256³), guardado em cache porque leva ~25 s.
    Devolvemos SEM subtrair o shot noise, igual ao procedimento descrito pelo CAMELS."""
    CACHE.mkdir(exist_ok=True)
    arq = CACHE / "pk_nosso_z0_256.npz"
    if arq.exists():
        d = np.load(arq)
        return d["k"], d["P"], d["n"]
    import conferencia_snapshot as cs

    _, pos = cs.ler_snapshot()
    L = teo.SIM.caixa_mpc_h
    k, P, n = cs.espectro_medido(cs.cic(np.mod(pos, L), L, 256), L, len(pos))
    P = P + L ** 3 / len(pos)  # devolve o shot noise que espectro_medido subtrai
    np.savez(arq, k=k, P=P, n=n)
    return k, P, n


def ler_rockstar() -> dict[str, np.ndarray]:
    """Colunas do hlist (cabeçalho do arquivo): pid(5), Mvir(10), Rvir(11), rs(12),
    x/y/z(17–19) [Mpc/h], M200b(39), M200c(40) [Msun/h]. Raios em kpc/h comóvel.
    Massa 'vir' = definição de Bryan & Norman (rockstar_params.cfg: MASS_DEFINITION = "vir").
    O Rockstar só guarda halos com ≥ 100 partículas (MIN_HALO_OUTPUT_SIZE = 100)."""
    cols = {"pid": 5, "Mvir": 10, "Rvir": 11, "rs": 12, "x": 17, "y": 18, "z": 19, "M200b": 39, "M200c": 40}
    d = np.loadtxt(ARQ_ROCKSTAR, comments="#", usecols=list(cols.values()))
    return {nome: d[:, i] for i, nome in enumerate(cols)}


def pk_linear_camb_arquivo(k: np.ndarray) -> np.ndarray:
    """Espectro linear z = 0 exato das condições iniciais (Pk_m_z=0.000.txt do CAMB)."""
    c = teo.sigma8_do_espectro_camb()
    return np.exp(np.interp(np.log(k), np.log(c["_k"]), np.log(c["_p"])))


# ---------------------------------------------------------------------------
# F1.1  nosso × oficial
# ---------------------------------------------------------------------------
def f1_1() -> dict:
    """Comparação casca a casca (mesmas cascas e mesma contagem de ondas do CAMELS).

    Histórico: a 1ª versão (14/10) interpolava entre cascas definidas de outro jeito e
    contava ondas duplicadas → falhou (24 %). Não era diferença nos dados: com o método
    igual ao dos autores (hoje em conferencia_snapshot.espectro_medido) a diferença cai
    para 0,05 %. Registrado em ARTIGOS §6c."""
    ko, po = pk_oficial("0.00")
    kn, pn, _ = pk_nosso_z0()
    m = min(len(ko), len(kn))
    ko, po, kn, pn = ko[:m], po[:m], kn[:m], pn[:m]
    sel = (ko >= 0.5) & (ko <= 10)
    razao = pn[sel] / po[sel]
    return {"k": ko[sel].tolist(), "razao_nosso_sobre_oficial": razao.tolist(),
            "desvio_max_centro_das_cascas": float(np.max(np.abs(kn[sel] / ko[sel] - 1))),
            "max_desvio": float(np.max(np.abs(razao - 1))), "criterio": 0.02,
            "passou": bool(np.max(np.abs(razao - 1)) < 0.02)}


# ---------------------------------------------------------------------------
# F1.5  oficial × halofit (CAMB)
# ---------------------------------------------------------------------------
def camb_halofit() -> dict:
    """CAMB com os MESMOS parâmetros do CAMB.params da simulação; As ajustado para σ8 = 0,8.
    Devolve interpoladores linear e não linear (halofit Takahashi 2012), em unidades h."""
    import camb

    c = teo.COSMO

    def montar(As: float):
        p = camb.CAMBparams()
        p.set_cosmology(H0=100 * c.h, ombh2=c.omega_b * c.h ** 2, omch2=(c.omega_m - c.omega_b) * c.h ** 2,
                        mnu=0.0, num_massive_neutrinos=0, nnu=3.046, omk=0.0, TCMB=teo.T_CMB_K,
                        YHe=0.245254733391)
        p.InitPower.set_params(As=As, ns=c.n_s)
        p.set_matter_power(redshifts=[0.0], kmax=60.0)
        p.NonLinear = camb.model.NonLinear_both
        p.NonLinearModel.set_params(halofit_version="takahashi")
        return p

    As0 = 2.13e-9  # valor do CAMB.params da simulação
    s8 = camb.get_results(montar(As0)).get_sigma8_0()
    As = As0 * (c.sigma_8 / s8) ** 2
    pars = montar(As)
    lin = camb.get_matter_power_interpolator(pars, nonlinear=False, hubble_units=True, k_hunit=True, kmax=60, zmax=1)
    nl = camb.get_matter_power_interpolator(pars, nonlinear=True, hubble_units=True, k_hunit=True, kmax=60, zmax=1)
    return {"lin": lin, "nl": nl, "As": As, "sigma8_antes": s8,
            "sigma8_depois": camb.get_results(pars).get_sigma8_0()}


def f1_5(cb: dict) -> dict:
    ko, po = pk_oficial("0.00")
    sel = (ko >= 0.5) & (ko <= 10)
    hf = cb["nl"].P(0.0, ko[sel])
    razao = po[sel] / hf
    faixa1 = ko[sel] <= 1.0
    d1 = float(np.max(np.abs(razao[faixa1] - 1))) if faixa1.any() else 0.0
    d2 = float(np.max(np.abs(razao[~faixa1] - 1)))
    # conferência extra: o linear do nosso CAMB × o arquivo linear da simulação
    kk = np.logspace(-2, 1, 50)
    lin_ratio = cb["lin"].P(0.0, kk) / pk_linear_camb_arquivo(kk)
    return {"k": ko[sel].tolist(), "razao_oficial_sobre_halofit": razao.tolist(),
            "max_desvio_k_ate_1": d1, "max_desvio_k_1_a_10": d2,
            "passou": bool(d1 <= 0.05 and d2 <= 0.10),
            "linear_camb_nosso_vs_arquivo_max_desvio": float(np.max(np.abs(lin_ratio - 1))),
            "As_ajustado": cb["As"], "sigma8_camb": cb["sigma8_depois"]}


# ---------------------------------------------------------------------------
# F1.6  semente: z = 127 × teoria
# ---------------------------------------------------------------------------
def f1_6() -> dict:
    D127 = teo.fator_crescimento(1 / 128) / teo.fator_crescimento(1.0)
    k127, p127 = pk_oficial("127.00")
    k0, p0 = pk_oficial("0.00")
    r127 = p127 / (pk_linear_camb_arquivo(k127) * D127 ** 2)
    r0 = p0 / pk_linear_camb_arquivo(k0)
    return {"k_primeiros": k127[:4].tolist(), "razao_z127": r127[:4].tolist(), "razao_z0": r0[:4].tolist(),
            "primeiro_ponto_z127": float(r127[0]), "criterio": 0.75, "passou": bool(r127[0] < 0.75)}


# ---------------------------------------------------------------------------
# F1.3  função de massa
# ---------------------------------------------------------------------------
def f1_3(rk: dict) -> dict:
    distintos = rk["pid"] == -1
    M = rk["M200b"][distintos]
    bordas = 10 ** np.arange(10.25, 13.76, 0.25)  # começa em 10^10,25 ≈ 230 partículas (longe do corte de 100)
    N_obs, _ = np.histogram(M, bins=bordas)
    massas = np.logspace(9, 15, 481)
    dn_cheio, _ = teo.funcao_de_massa(massas, teo.f_tinker08_200m)
    dn_caixa, _ = teo.funcao_de_massa(massas, teo.f_tinker08_200m, k_min=2 * np.pi / teo.SIM.caixa_mpc_h)
    V, lnm = teo.SIM.volume, np.log(massas)

    def no_bin(dn, a, b):
        m = (massas >= a) & (massas <= b)
        return V * np.trapezoid(dn[m], lnm[m])

    linhas, ok_todos = [], True
    for a, b, n in zip(bordas[:-1], bordas[1:], N_obs):
        t1, t2 = no_bin(dn_cheio, a, b), no_bin(dn_caixa, a, b)
        lo, hi = min(t1, t2) * 0.9, max(t1, t2) * 1.1
        avaliado = n >= 10
        ok = bool((n + 2 * np.sqrt(n) >= lo) and (n - 2 * np.sqrt(n) <= hi)) if avaliado else None
        if avaliado and not ok:
            ok_todos = False
        linhas.append({"M_de": a, "M_ate": b, "N_rockstar": int(n), "N_tinker_cheio": t1,
                       "N_tinker_so_caixa": t2, "avaliado": bool(avaliado), "passou": ok})
    return {"faixas": linhas, "passou": ok_todos, "n_halos_distintos": int(distintos.sum()),
            "n_subhalos": int((~distintos).sum())}


# ---------------------------------------------------------------------------
# F1.4  concentração
# ---------------------------------------------------------------------------
def f1_4(rk: dict) -> dict:
    """Mesmo corte de Duffy+08: halos com ≥ 10⁴ partículas dentro de Rvir; distintos.
    c200c = R200c / rs, com R200c calculado de M200c (rs vem do ajuste NFW do Rockstar)."""
    m_p = teo.massa_particula()
    sel = (rk["pid"] == -1) & (rk["Mvir"] / m_p >= 1e4)
    M200c, rs = rk["M200c"][sel], rk["rs"][sel]
    R200c = (3 * M200c / (4 * np.pi * 200 * teo.densidade_critica_h2())) ** (1 / 3) * 1e3  # kpc/h
    c = R200c / rs
    logc = np.log10(c)
    bordas = np.quantile(M200c, [0, 0.5, 1.0])  # 2 faixas com o mesmo número de halos
    faixas = []
    for a, b in zip(bordas[:-1], bordas[1:]):
        m = (M200c >= a) & (M200c <= b)
        Mmed = float(np.median(M200c[m]))
        med = float(np.median(c[m]))
        erro_log = 1.2533 * np.std(logc[m]) / np.sqrt(m.sum())  # erro da mediana
        cz0 = teo.concentracao_duffy08_200c(Mmed, 0.0, "z0")
        cz02 = teo.concentracao_duffy08_200c(Mmed, 0.0, "z0-2")
        faixas.append({"M_mediana": Mmed, "n_halos": int(m.sum()), "c_mediana_medida": med,
                       "erro_mediana_relativo": float(10 ** erro_log - 1),
                       "dispersao_log10c": float(np.std(logc[m])),
                       "duffy_z0": cz0, "duffy_z0_2": cz02,
                       "desvio_z0": med / cz0 - 1, "desvio_z0_2": med / cz02 - 1})
    d_z0 = np.mean([abs(f["desvio_z0"]) for f in faixas])
    d_z02 = np.mean([abs(f["desvio_z0_2"]) for f in faixas])
    dif_linhas = np.mean([abs(f["duffy_z0"] / f["duffy_z0_2"] - 1) for f in faixas])
    erro = np.mean([f["erro_mediana_relativo"] for f in faixas])
    if dif_linhas < erro:
        decisao = "indistinguível com estes dados → mantém 'z0'"
    else:
        decisao = "z0" if d_z0 < d_z02 else "z0-2"
    return {"n_halos": int(sel.sum()), "faixas": faixas, "desvio_medio_z0": d_z0, "desvio_medio_z0_2": d_z02,
            "diferenca_entre_linhas": dif_linhas, "erro_medio_mediana": erro, "decisao": decisao,
            "_M": M200c.tolist(), "_c": c.tolist()}


# ---------------------------------------------------------------------------
# Análises EXPLORATÓRIAS (feitas depois de ver os resultados; critérios não pré-registrados)
# ---------------------------------------------------------------------------
def f1_6_evolucao() -> dict:
    """Em que momento o primeiro ponto de k (a maior onda da caixa) se afasta da teoria
    linear? Usa os P(k) oficiais já baixados (z = 127, 6, 4, 3, 2, 1,05, 0)."""
    linhas = []
    D0 = teo.fator_crescimento(1.0)
    for z in ("127.00", "6.00", "4.00", "3.00", "2.00", "1.05", "0.00"):
        k, p = pk_oficial(z)
        D = teo.fator_crescimento(1 / (1 + float(z))) / D0
        lin = pk_linear_camb_arquivo(k[:2]) * D ** 2
        linhas.append({"z": float(z), "razao_k1": float(p[0] / lin[0]), "razao_k2": float(p[1] / lin[1]),
                       "Delta2_linear_no_k1": float(k[0] ** 3 * lin[0] / (2 * np.pi ** 2))})
    return {"k1": float(pk_oficial("0.00")[0][0]), "evolucao": linhas}


def f1_4_modelos_modernos(r4: dict) -> dict:
    """Compara a mediana medida com relações c(M) calibradas depois de Duffy e
    implementadas no Colossus, na NOSSA cosmologia (Duffy foi calibrado em WMAP5)."""
    from colossus.cosmology import cosmology
    from colossus.halo import concentration

    c = teo.COSMO
    cosmology.setCosmology("camels_cv", params={
        "flat": True, "H0": 100 * c.h, "Om0": c.omega_m, "Ob0": c.omega_b,
        "sigma8": c.sigma_8, "ns": c.n_s, "relspecies": False, "Tcmb0": teo.T_CMB_K})
    out = []
    for f in r4["faixas"]:
        M = f["M_mediana"]
        linha = {"M_mediana": M, "c_medida": f["c_mediana_medida"], "erro_mediana_relativo": f["erro_mediana_relativo"]}
        for mod in ("duffy08", "ludlow16", "diemer19", "child18"):
            try:
                cm = float(concentration.concentration(M, "200c", 0.0, model=mod))
                linha[mod] = cm
                linha[f"desvio_{mod}"] = f["c_mediana_medida"] / cm - 1
            except Exception as e:  # modelo indisponível nesta versão
                linha[mod] = f"erro: {e}"
        out.append(linha)
    return {"faixas": out}


# ---------------------------------------------------------------------------
def figuras(r: dict, cb: dict, rk: dict) -> None:
    FIG.mkdir(exist_ok=True)
    ko, po = pk_oficial("0.00")
    kn, pn, _ = pk_nosso_z0()
    kk = np.logspace(np.log10(0.25), 1.3, 200)

    fig, (a1, a2) = plt.subplots(2, 1, figsize=(7, 6.5), sharex=True, gridspec_kw={"height_ratios": [3, 1.3]})
    a1.loglog(ko, po, "o", ms=3, color="#e76f51", label="oficial CAMELS (grade 512³)")
    a1.loglog(kn, pn, "-", color="#4b3b8f", lw=1, label="nosso (grade 256³)")
    a1.loglog(kk, cb["nl"].P(0.0, kk), "--", color="#2a9d8f", label="halofit Takahashi 2012 (CAMB)")
    a1.loglog(kk, pk_linear_camb_arquivo(kk), ":", color="gray", label="linear (CAMB da simulação)")
    a1.set_ylabel("P(k) [(Mpc/h)³]"); a1.legend(fontsize=8); a1.set_xlim(0.25, 20)
    a1.set_title("z = 0: nosso × oficial × halofit")
    a2.semilogx(r["F1.1"]["k"], r["F1.1"]["razao_nosso_sobre_oficial"], color="#4b3b8f", label="nosso / oficial")
    a2.semilogx(r["F1.5"]["k"], r["F1.5"]["razao_oficial_sobre_halofit"], color="#2a9d8f", label="oficial / halofit")
    for y in (0.9, 0.95, 1.05, 1.1):
        a2.axhline(y, ls=":", color="gray", lw=0.8)
    a2.axhline(1, color="k", lw=0.8); a2.set_ylim(0.8, 1.2); a2.set_xlabel("k [h/Mpc]"); a2.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(FIG / "08_pk_nosso_oficial_halofit.png", dpi=130); plt.close(fig)

    D127 = teo.fator_crescimento(1 / 128) / teo.fator_crescimento(1.0)
    fig, ax = plt.subplots(figsize=(7, 4.2))
    for z, cor, esc in (("127.00", "#e76f51", D127 ** 2), ("0.00", "#4b3b8f", 1.0)):
        k, p = pk_oficial(z)
        m = k < 1.5
        ax.plot(k[m], p[m] / (pk_linear_camb_arquivo(k[m]) * esc), "o-", color=cor, label=f"z = {float(z):g}")
    ax.axhline(1, color="k", lw=0.8); ax.axhline(0.75, ls=":", color="gray")
    ax.set_xlabel("k [h/Mpc]"); ax.set_ylabel("P oficial / P linear")
    ax.set_title("Maior escala: o déficit já estava na semente?"); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(FIG / "10_semente_z127.png", dpi=130); plt.close(fig)

    f = r["F1.3"]["faixas"]
    cent = np.sqrt([x["M_de"] * x["M_ate"] for x in f])
    fig, ax = plt.subplots(figsize=(7, 4.5))
    n = np.array([x["N_rockstar"] for x in f])
    ax.errorbar(cent, n, yerr=2 * np.sqrt(np.maximum(n, 1)), fmt="o", color="#4b3b8f", label="Rockstar (±2σ Poisson)")
    ax.plot(cent, [x["N_tinker_cheio"] for x in f], "-", color="#2a9d8f", label="Tinker08")
    ax.plot(cent, [x["N_tinker_so_caixa"] for x in f], "--", color="#e76f51", label="Tinker08, só modos da caixa")
    ax.set_xscale("log"); ax.set_yscale("log"); ax.set_xlabel("M200b [Msun/h]"); ax.set_ylabel("halos por faixa de 0,25 dex")
    ax.set_title("Quantos halos: simulação × teoria"); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(FIG / "11_funcao_de_massa_rockstar.png", dpi=130); plt.close(fig)

    c4 = r["F1.4"]
    Ms = np.logspace(11.5, 14, 100)
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.scatter(c4["_M"], c4["_c"], s=8, color="#9b8fd1", alpha=0.6, label=f"halos Rockstar (≥10⁴ partículas, {c4['n_halos']})")
    for x in c4["faixas"]:
        ax.errorbar(x["M_mediana"], x["c_mediana_medida"], yerr=x["c_mediana_medida"] * x["erro_mediana_relativo"],
                    fmt="s", ms=8, color="#2d1f6e", capsize=4)
    ax.plot(Ms, [teo.concentracao_duffy08_200c(m, 0.0, "z0") for m in Ms], color="#4b3b8f", label="Duffy linha 'z = 0'")
    ax.plot(Ms, [teo.concentracao_duffy08_200c(m, 0.0, "z0-2") for m in Ms], color="#e76f51", label="Duffy linha 'z = 0–2'")
    ax.set_xscale("log"); ax.set_yscale("log"); ax.set_xlabel("M200c [Msun/h]"); ax.set_ylabel("c200c")
    ax.set_title("Concentração medida × Duffy (quadrados = mediana)"); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(FIG / "12_concentracao_rockstar.png", dpi=130); plt.close(fig)


def rodar() -> dict:
    rk = ler_rockstar()
    cb = camb_halofit()
    r = {"F1.1": f1_1(), "F1.5": f1_5(cb), "F1.6": f1_6(), "F1.3": f1_3(rk), "F1.4": f1_4(rk)}
    r["EXPLORATORIO_F1.6_evolucao"] = f1_6_evolucao()
    r["EXPLORATORIO_F1.4_modelos_modernos"] = f1_4_modelos_modernos(r["F1.4"])
    figuras(r, cb, rk)
    limpo = {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")} for k, v in r.items()}
    (PASTA / "fase1_resultados.json").write_text(json.dumps(limpo, indent=2, ensure_ascii=False, default=float),
                                                 encoding="utf-8")
    return limpo


if __name__ == "__main__":
    res = rodar()
    for item, v in res.items():
        print(f"\n=== {item} ===")
        print(json.dumps({k: x for k, x in v.items() if k not in ("k", "razao_nosso_sobre_oficial",
                                                                   "razao_oficial_sobre_halofit")},
                         indent=1, ensure_ascii=False, default=float))
