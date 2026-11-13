"""
paletas.py — F2.3 (opções de cor para o Victor escolher)
=========================================================

Aviso honesto: matéria escura não emite nem reflete luz. Um olho humano veria PRETO.
Toda paleta é convenção. As quatro opções abaixo partem de como o olho funciona:

1. "Visão noturna" — em luz muito fraca o olho usa só os bastonetes, que não distinguem
   cor (visão escotópica): algo tênue seria visto em tons de cinza. Opção mais próxima
   do olho real.
2. "Corpo negro" — as cores que um corpo quente realmente emite, calculadas com a lei de
   Planck e as curvas de sensibilidade do olho (CIE 1931, aproximação analítica de
   Wyman, Sloan & Shirley 2013, Listing 1), convertidas para sRGB (IEC 61966-2-1).
   Física real; a convenção é ligar densidade → temperatura (1.500 K a 12.000 K).
3. "Magma" — paleta científica perceptualmente uniforme (matplotlib), legível por daltônicos.
4. "Artística" — azul profundo → branco → dourado. Estética, rotulada como tal.

Imagem: a luz de cada splat se SOMA (como luz de verdade). O brilho de cada pixel é a massa
projetada (soma das gaussianas de cada splat, com o σ calculado na F2.1/F2.2); a cor vem do
log dessa densidade projetada. Fundo preto. Fatia z ∈ [10, 15) Mpc/h da versão 1/8.

Uso:   python paletas.py
Saída: calculos/figuras/15_paletas.png (as 4 lado a lado) e 15a–15d (cada uma em alta resolução)
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap
from scipy.ndimage import gaussian_filter

PASTA = Path(__file__).resolve().parent
FIG = PASTA.parent / "calculos" / "figuras"
L, PIX = 25.0, 1400
FATIA = (10.0, 15.0)


# ---------------------------------------------------------------------------
# Cor do corpo negro como o olho a vê
# ---------------------------------------------------------------------------
def _cmf_cie1931(lam: np.ndarray) -> np.ndarray:
    """x̄, ȳ, z̄ (CIE 1931) — Wyman, Sloan & Shirley 2013, JCGT 2(2), Listing 1. λ em nm."""
    def g(mu, a, b):
        t = (lam - mu) * np.where(lam < mu, a, b)
        return np.exp(-0.5 * t * t)
    x = 0.362 * g(442.0, 0.0624, 0.0374) + 1.056 * g(599.8, 0.0264, 0.0323) - 0.065 * g(501.1, 0.0490, 0.0382)
    y = 0.821 * g(568.8, 0.0213, 0.0247) + 0.286 * g(530.9, 0.0613, 0.0322)
    z = 1.217 * g(437.0, 0.0845, 0.0278) + 0.681 * g(459.0, 0.0385, 0.0725)
    return np.stack([x, y, z])


def cor_corpo_negro(T: float) -> np.ndarray:
    """Cromaticidade sRGB (0–1, máximo = 1) de um corpo negro a T kelvin."""
    lam = np.linspace(380, 780, 401)
    h, c, k = 6.62607015e-34, 2.99792458e8, 1.380649e-23
    l = lam * 1e-9
    B = 1.0 / (l ** 5 * (np.exp(h * c / (l * k * T)) - 1.0))  # lei de Planck (constante omitida)
    XYZ = np.trapezoid(_cmf_cie1931(lam) * B, lam, axis=1)
    M = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
    rgb = np.clip(M @ XYZ, 0, None)
    rgb = rgb / rgb.max()
    return np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * rgb ** (1 / 2.4) - 0.055)  # gama sRGB


def mapa_corpo_negro() -> LinearSegmentedColormap:
    """Do preto ao corpo negro de 1.500 K → 12.000 K, com o brilho subindo junto."""
    Ts = np.geomspace(1500, 12000, 64)
    cores = [cor_corpo_negro(T) * b for T, b in zip(Ts, np.linspace(0.05, 1.0, 64))]
    return LinearSegmentedColormap.from_list("corpo_negro", [(0, 0, 0)] + cores)


PALETAS = {
    "a_visao_noturna": ("1. Visão noturna (bastonetes: sem cor)",
                        LinearSegmentedColormap.from_list("noturna", ["#000000", "#5a5a5a", "#d9d9d9", "#ffffff"])),
    "b_corpo_negro": ("2. Corpo negro (Planck + olho CIE 1931)", mapa_corpo_negro()),
    "c_magma": ("3. Magma (científica, perceptual)", plt.get_cmap("magma")),
    "d_artistica": ("4. Artística (estética)",
                    LinearSegmentedColormap.from_list("artistica", ["#000000", "#0b1a4a", "#2f5bd3", "#9cc3ff",
                                                                    "#ffffff", "#ffd36e"])),
}


# Decisão do Victor (14/10/2026): três paletas viram FILTRO no visualizador, quem quiser
# escolhe. "Visão noturna" fica só como referência (a mais fiel ao olho real), fora do filtro.
# Padrão: magma (padrão científico).
PALETAS_FILTRO = ("c_magma", "b_corpo_negro", "d_artistica")
PALETA_PADRAO = "c_magma"


# ---------------------------------------------------------------------------
def imagem_massa_projetada() -> np.ndarray:
    """Soma das gaussianas de cada splat projetadas no plano xy (em bandas de σ)."""
    d = np.load(PASTA / "dados" / "sub_1_8.npz")
    pos, sig, m = d["pos"], d["sigma"], float(d["massa_por_splat"])
    s = (pos[:, 2] >= FATIA[0]) & (pos[:, 2] < FATIA[1])
    pos, sig = pos[s], sig[s]
    px = L / PIX
    img = np.zeros((PIX, PIX))
    bandas = np.geomspace(max(sig.min(), 1e-4), sig.max() * 1.0001, 13)
    for a, b in zip(bandas[:-1], bandas[1:]):
        sel = (sig >= a) & (sig < b)
        if not sel.any():
            continue
        H, _, _ = np.histogram2d(pos[sel, 1], pos[sel, 0], bins=PIX, range=[[0, L], [0, L]])
        img += gaussian_filter(H * m, sigma=np.sqrt(a * b) / px, mode="wrap")
    return img / px ** 2  # massa projetada por área [Msun/h / (Mpc/h)²]


def colorir(img: np.ndarray) -> np.ndarray:
    """log da densidade projetada, normalizado entre o percentil 5 e o máximo."""
    v = np.log10(img + img[img > 0].min())
    lo, hi = np.percentile(v, 5), v.max()
    return np.clip((v - lo) / (hi - lo), 0, 1)


def main() -> None:
    norm = colorir(imagem_massa_projetada())
    fig, eixos = plt.subplots(2, 2, figsize=(14, 14), facecolor="black")
    for ax, (chave, (titulo, cmap)) in zip(eixos.ravel(), PALETAS.items()):
        ax.imshow(norm, origin="lower", cmap=cmap, extent=[0, L, 0, L], interpolation="bilinear")
        ax.set_title(titulo, color="white", fontsize=13)
        ax.axis("off")
        plt.imsave(FIG / f"15{chave}.png", norm, cmap=cmap, origin="lower")
    fig.suptitle("Mesma fatia, mesmos dados, quatro convenções de cor (fundo preto)", color="white", fontsize=15)
    fig.tight_layout()
    fig.savefig(FIG / "15_paletas.png", dpi=100, facecolor="black")
    plt.close(fig)
    print("ok")


if __name__ == "__main__":
    main()
