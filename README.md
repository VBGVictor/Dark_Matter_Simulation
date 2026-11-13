# Dentro da Teia

Explorador 3D, no navegador, da teia cósmica de matéria escura de uma simulação real e
pública (CAMELS, Flatiron Institute). Cada partícula vira um *gaussian splat* desenhado com
o Spark (World Labs, código aberto).

Projeto pessoal de Victor Goveia, de divulgação científica. Código aberto (licença MIT), dados
públicos e todas as fontes citadas: veja a seção [Créditos e referências](#créditos-e-referências).

> **É simulação, não foto.** Medido de verdade: as ondulações do universo jovem (satélite
> Planck) e os parâmetros do universo. O resto é a gravidade calculada no computador por
> 14 bilhões de anos. O cubo é **um pedaço típico** do universo (121 milhões de anos-luz),
> não um lugar real do céu.

Outros documentos:
- `RESUMO_PARA_ENTENDER.md` — 5 páginas em linguagem simples (o que é, como sabemos que está certo)
- `REFERENCIAS.xlsx` — todos os artigos usados (autores, título, revista, DOI, link e para que serviu)
  e as fontes de dados, código e instituições

---

## 1. Ver a teia agora (o mais rápido)

Os arquivos prontos já estão em `splats/dados/`. Só precisa de um servidor local, porque o
navegador não deixa uma página ler arquivos do disco diretamente.

**Passo 1.** Abra um terminal **na pasta do projeto** (`dark_matter_3D`) e rode:

```bash
python servidor.py
```

Deixe esse terminal aberto. Para parar o servidor: `Ctrl + C`.

> Use o `servidor.py` (e não `python -m http.server`): ele proíbe o navegador de guardar
> cópias antigas dos arquivos. Com o servidor comum, depois de uma atualização o navegador
> pode continuar rodando o código velho — isso invalidou uma medição em 15/10/2026.

**Passo 2.** No navegador (Chrome ou Edge), abra:

```
http://127.0.0.1:8765/visualizador/index.html
```

**Controles:**
| Ação | Mouse | Botão (canto inferior direito) | Teclado | Celular |
|---|---|---|---|---|
| Girar | arrastar com o botão esquerdo | — | — | 1 dedo |
| Aproximar / afastar | roda do mouse | **+** / **−** | `+` / `−` (também no teclado numérico) | pinça com 2 dedos |
| Mover a vista | arrastar com o botão direito | — | — | 2 dedos |
| **Voltar à caixa inteira** | — | **⟲** | `Home` ou `H` | — |
| Mostrar/esconder o contorno da caixa | — | **▢** | `C` | — |

Se se perder lá dentro: **⟲** ou `H` volta à vista inicial. A distância tem limites
(0,05 a 120 Mpc/h), então não dá para se perder no vazio. Quando você chega tão perto que vê as
partículas uma a uma, aparece um aviso de **limite de detalhe** (com link para a versão mais fina, se houver). A vista inicial
se ajusta ao formato da tela (no celular em pé, a câmera se afasta para a caixa caber).

**Medir a velocidade (quadros por segundo):** abra e **não mexa por ~25 s**, com a página
visível na tela (janela escondida não desenha e a medição sai inválida):

| Versão | Endereço |
|---|---|
| **padrão** (1/8 + detalhe 0,15 + névoa) | `http://127.0.0.1:8765/visualizador/index.html?medir=1` |
| 1/64 sem névoa (padrão até 19/10) | `http://127.0.0.1:8765/visualizador/index.html?medir=1&arquivo=teia_1_64_magma.spz` |
| diagnóstico da névoa (5 variantes, só girando) | `http://127.0.0.1:8765/visualizador/index.html?medir=nevoa` |

Ela passa por 3 vistas (de frente, de perto, girada) e, em cada uma, mede **parada** e
**girando devagar** (~45 s no total). A coluna **girando** decide (é a experiência real de
explorar): 🟢 ≥ 30 fluido · 🟡 20–30 aceitável · 🔴 < 20 travando. Só o contador: `?fps=1`.

**Ajustes de desenho** (combinam com os outros parâmetros usando `&`):
| Parâmetro | O que faz | Padrão |
|---|---|---|
| `desvio=2` | até quantos desvios-padrão cada mancha é pintada (Spark aceita 2 a 3) | 2 |
| `alfamin=0.05` | pula as manchas quase transparentes (a névoa dos vazios): mais rápido e mais nítido, mas os vazios ficam mais vazios na tela. **Por padrão a névoa fica** (é massa que existe) — opção só para comparar | desligado |
| `lod=1` / `lod=0` | nível de detalhe automático: longe usa manchas-resumo, perto abre o detalhe | ligado na 1/8 e na completa |
| `lodescala=0.15` | quantas manchas por quadro com detalhe automático (0,15 ≈ 375 mil; 0,25 ≈ 625 mil) | 0,15 (desde 19/10) |
| `nevoa=0` / `nevoa=1` | névoa em volume (F3.17) | ligada só na 1/8 |
| `passo=2` | passo do raio da névoa, em células (1 = exato; 2 = erro médio 0,03 %; 3 não: 20 % num pixel) | 2 |
| `nevoaescala=0.25` | resolução da névoa (fora da tela, esticada); `0.5`, `1` ou `0` (na tela, 1ª versão) | 0,25 |
| `ext=0` | desliga as posições em precisão total (float32). **Não recomendado**: a codificação compacta arredonda as posições em até ~8 kpc/h | ligado |
| `resolucao=auto` | desenha em metade da resolução enquanto a câmera se mexe e volta à total quando para; `1`, `0.75` ou `0.5` fixam a escala | auto |
| `raio=512` | raio máximo de uma mancha na tela, em pixels | 512 |

Exemplo: `http://127.0.0.1:8765/visualizador/index.html?medir=1&alfamin=0.05`

**No celular** (mesmo Wi-Fi do computador): o servidor precisa aceitar conexões da rede.
⚠️ Enquanto ele estiver assim, **qualquer aparelho no mesmo Wi-Fi consegue abrir os arquivos
da pasta do projeto**. Use só em rede de casa e pare (`Ctrl + C`) ao terminar.
1. No computador, na pasta do projeto: `python servidor.py --rede`
   (se o Windows perguntar sobre o firewall, permitir só em **rede privada**)
2. Descubra o IP do computador: `ipconfig` → "Endereço IPv4" (algo como `192.168.0.15`)
3. No celular: `http://192.168.0.15:8765/visualizador/index.html?medir=1` (troque pelo seu IP)

**Testar a navegação:** abra com `?testes=1` no fim do endereço
(`http://127.0.0.1:8765/visualizador/index.html?testes=1`). A página testa a si mesma e mostra
o resultado no canto superior direito. Esperado: **19/19**.

**Legenda "o que é cada mancha"**: botão ℹ ou tecla **L**. Mostra a massa da menor mancha da
versão aberta, que a cor é densidade (não tamanho) e a tabela de halos por classe (anão, de
galáxia, tipo Via Láctea, grupo, aglomerado), com números do catálogo oficial Rockstar —
gerada por `splats/classes_halos.py` → `splats/dados/classes_halos.json`.

**Outros arquivos** (troque o final do endereço):

| Endereço termina em | O que mostra | Tamanho |
|---|---|---|
| `index.html` (**padrão desde 19/10**) = `?arquivo=teia_1_8_magma.spz` + detalhe 0,15 + névoa | a caixa inteira, 2,1 milhões de partículas, halos em manchas e filamentos/vazios em névoa | 19,1 MB |
| `?arquivo=teia_1_64_magma.spz` | a caixa inteira, 262 mil splats, sem névoa (padrão até 19/10) | 2,6 MB |
| `?arquivo=teia_1_64_magma_alongada.spz` | a caixa inteira com **manchas alongadas** ao longo dos filamentos (F3.16) | 3,7 MB |
| `?arquivo=teste_orientacao.spz` | teste: 3 manchas de direção conhecida (vermelha deitada, verde em pé, azul na diagonal) | — |
| `?arquivo=teia_completa_magma.spz&lod=1` | **todas as 16,8 milhões de partículas** (resolução completa; demora para abrir: o Spark monta o detalhe ao carregar) | 136 MB |
| `?arquivo=teia_completa_magma_alongada.spz&lod=1` | completa com manchas alongadas (~1 min para abrir) | 202 MB |
| `?arquivo=teia_1_8_magma_alongada.spz&lod=1` | 1/8 com manchas alongadas | 27,6 MB |
| `?arquivo=fatia_1_8_magma.spz` | uma fatia de 5 Mpc/h, 319 mil splats (mais nítida) | 3,0 MB |
| `?arquivo=teia_1_64_magma.ply` / `fatia_1_8_magma.ply` | os mesmos, no formato sem compressão | 17,8 / 21,7 MB |

**Névoa em volume** (F3.17): **ligada no padrão** (versão 1/8); `&nevoa=0` desliga, `&nevoa=1` liga
em qualquer outra versão (ex.: `?arquivo=teia_1_64_magma.spz&nevoa=1`). As manchas maiores que uma
célula de 98 kpc/h viram uma névoa contínua (mesma regra de opacidade, sem arquivo novo); os halos
continuam manchas. A montagem leva alguns segundos (a página para enquanto isso). A linha de estado
mostra quantas manchas viraram névoa e o erro máximo da ordem de desenho longe do foco.
Opções: `&nevoa=192` ou `&nevoa=128` (grade mais leve), `&passo=0.5` (raio mais fino, mais lento).
Desenho da névoa no padrão: passo 2 células e ¼ de resolução (ver tabela de ajustes acima).

**Filtros** (F3.7): botão ⚗ ou tecla **F**. Troca o **estimador de densidade** que dá a cor (A padrão,
C, B, D — cada um com o artigo de origem, onde acerta, onde erra e aviso quando superestima) e a **paleta**
(magma, corpo negro, artística). Só a cor muda; a teia é remontada sem recarregar a página.
**Incerteza do método** (F3.8), no mesmo painel: "O que a cor mostra" → a cor passa a ser a razão entre dois
estimadores (C ÷ A, B ÷ A ou D ÷ A): cinza = concordam, vermelho = maior que A, azul = menor; escala ÷3 a ×3.
Endereço: `&camada=discordancia&par=B/C` (pares: C/A, B/A, D/A, B/C, D/C, D/B). Dados: `splats/discordancia_web.py`.
**Laboratório** (F3.9), no mesmo painel: mistura dois estimadores com peso (média em log, ρ = ρ_X^(1−p)·ρ_Y^p).
Rotulado "criação do usuário — não publicada, não conferida". Endereço: `&camada=lab&x=A&y=B&peso=30`.
**Resolução da cor** (F3.10), no mesmo painel: densidade da simulação completa (padrão) ou da própria versão
leve (sem os halos pequenos). Endereço: `&resolucao_cor=versao`. Dados: `estimadores_web.py --resolucao-versao`. Também pelo
endereço: `&estimador=B&paleta=corpo_negro`. Disponível nas versões 1/64 e 1/8. Dados:
`splats/estimadores_web.py` → `estimadores_1_64.bin`, `estimadores_1_8.bin`, `paletas_lut.json`.

**Universos** (F3.11): botão **Ω** ou tecla **U** — 9 simulações reais do CAMELS 1P (Ωm 0,1–0,5 ou σ8 0,6–1,0, uma por vez),
com o S8 e a tensão do S8 (Planck × lentes). Também pelo endereço: `?universo=1P_p2_n1`. Dados: `splats/universos_1p.py --temp <pasta fora do projeto>`.

**Névoa pré-calculada** (F3.21): `splats/nevoa_pre.py --base teia_1_8_magma` grava a névoa pronta; o navegador usa sozinho quando a cor é a padrão
(`&nevoa_pre=0` força o cálculo no navegador; `&conferir_nevoa=1` compara os dois).

**Tela**: só um painel lateral aberto por vez; o quadro de informação começa minimizado (clique no título ou tecla **I**);
**Limpar tudo**: botão ⊘ ou tecla **X** (volta ao Universo 1, cor padrão e caixa inteira).

**Tempo** (F4): botão ⏱ ou tecla **T** — a teia se formando, de ~1 bilhão de anos até hoje (12 momentos gravados,
posição entre eles estimada pela velocidade real). Dados: `splats/tempo_f4.py --temp <pasta fora do projeto>`.

**Exportar** (F3.12): botão ⤓ ou tecla **E** — salvar a configuração em CSV (abre no Excel), reabrir um CSV salvo,
e gerar um PDF (imagem + configuração explicada + fontes; na janela de impressão, "Salvar como PDF").

**Esqueleto da teia e passeio** (F3.20): botão 〰 ou tecla **V** — liga os aglomerados pela árvore mínima (linhas azuis,
filtro) e faz um passeio "montanha-russa" sentado em cima da espinha da teia (~610 milhões de anos-luz, passa pelo maior
aglomerado, atravessa as paredes do cubo periódico), olhando para o centro do cubo (panorâmico; opção "a frente do
trilho" no painel). Arrastar olha em volta; espaço pausa; Esc sai. Só no Universo 1.
Dados: `splats/esqueleto_mst.py`.

**Introdução** (F3.5): tela curta por cima enquanto a teia carrega (com a supernova); "Entrar na teia" quando fica pronta.
`?intro=0` pula; também há "não mostrar na próxima vez".

**Voo livre** (F3.2): botão ✈ ou tecla **N** — W A S D ou setas para andar, Espaço/Shift para subir/descer, arrastar
para olhar, roda do mouse para a velocidade, Esc ou N para sair. As paredes do cubo dão a volta (simulação periódica).

**Escala** (F3.4): régua no canto inferior esquerdo, em anos-luz, que muda com o zoom (vale no plano do foco; no
modo tempo diz também quanto media naquele momento). No cartão do aglomerado: "≈ X Vias Lácteas" (halo da Via Láctea
= 1,3 trilhão de sóis, Bland-Hawthorn & Gerhard 2016).

**Giro automático** (F3.19): tecla **G** ou botão ▶ — a câmera gira sozinha em volta do foco (9°/s, 40 s por volta);
qualquer gesto devolve o controle.

**Ir até um aglomerado** (F3.15): botão ◎ ou tecla **M** (desligado por padrão). Marca os 10
maiores halos da região que você está olhando (anel = raio virial do catálogo); aproximando,
aparecem os seguintes dali. Clique num anel: a câmera vai até o halo e abre o cartão com massa,
partículas, raio e sub-halos, e o link para vê-lo na versão completa. Dados: `splats/halos_marcadores.py`
→ `splats/dados/halos_marcadores.json`. Abrir olhando para um ponto: `&alvo=x,y,z&dist=d` (Mpc/h).

Precisa de internet: o three.js e o Spark são carregados de CDN (versões fixas: three.js
0.180.0 e Spark 2.3.1).

---

## 2. Conferir que as contas estão certas

Um comando roda todos os testes (~1 min) e responde ✅ ou ❌ para cada um:

```bash
cd calculos
python verificar_tudo.py
```

Cada teste compara um número do projeto com uma fonte que não depende do nosso código: o
próprio arquivo da simulação, a biblioteca Colossus, números publicados nos artigos, arquivos
oficiais dos autores do CAMELS e casos fabricados com resposta conhecida. Os testes que
precisam dos dados brutos (que não vêm no repositório) aparecem como **⏭️ pulado**, com o
comando para baixar ou recriar o arquivo. O registro fica em `calculos/verificacao.json`.

---

## 3. Instalar (só para rodar os scripts; para ver a teia basta o item 1)

Python 3.11 e as bibliotecas:

```bash
python -m pip install numpy scipy matplotlib h5py hdf5plugin colossus camb psutil
```

| Biblioteca | Para quê |
|---|---|
| numpy, scipy, matplotlib | contas e gráficos |
| h5py + **hdf5plugin** | ler o snapshot (vem comprimido com Blosc; sem o hdf5plugin dá erro "can't open directory") |
| colossus | conferência independente das teorias |
| camb | espectro linear e halofit |
| psutil | medir memória |

---

## 4. Refazer tudo do zero (ordem dos scripts)

Os dados brutos **não vêm no repositório**: são públicos e baixados direto da fonte oficial do
CAMELS, sem cadastro (`https://users.flatironinstitute.org/~camels/`). Grave-os em
`dados/CAMELS_IllustrisTNG_DM_CV_0/`, com esta estrutura:

| Arquivo local | Endereço no servidor do CAMELS | Tamanho |
|---|---|---|
| `snapshot_090.hdf5` | `Sims/IllustrisTNG_DM/CV/CV_0/snapshot_090.hdf5` | 197,6 MB |
| `parametros/2LPT.param`, `CAMB.params`, `logIC`, `inputspec_ics.txt`, `Pk_m_z=0.000.txt` | `Sims/IllustrisTNG_DM/CV/CV_0/ICs/` | ~35 KB |
| `parametros/G3.param-usedvalues` | `Sims/IllustrisTNG_DM/CV/CV_0/extra_files/` | 2,7 KB |
| `Pk_oficial/Pk_m_z=*.txt` | `Pk/IllustrisTNG_DM/L25n256/CV/CV_0/` | ~170 KB |
| `rockstar/hlist_1.00000.list` e `rockstar_params.cfg` | `Rockstar/IllustrisTNG_DM/L25n256/CV/CV_0/hlists/` e `.../CV_0/` | 5 MB |

Exemplo (terminal, na pasta do projeto):
```bash
curl -L -o dados/CAMELS_IllustrisTNG_DM_CV_0/snapshot_090.hdf5 --create-dirs https://users.flatironinstitute.org/~camels/Sims/IllustrisTNG_DM/CV/CV_0/snapshot_090.hdf5
```

Os universos alternativos e os 12 momentos do modo tempo são baixados pelos próprios scripts
(`splats/universos_1p.py` e `splats/tempo_f4.py`). Para regenerar os resultados, na ordem:

| # | Comando | O que faz | Tempo |
|---|---|---|---|
| 1 | `cd calculos` → `python teoria_lcdm.py` | teoria: expansão, crescimento, P(k), halos esperados, NFW (`--concentracao diemer19\|ludlow16\|duffy08_z0\|duffy08_z0-2`) | ~10 s |
| 2 | `python conferencia_snapshot.py` | lê o snapshot e compara com a teoria; figuras 05 e 06 | ~30 s |
| 3 | `python fase1_conferencia.py` | compara com os arquivos oficiais dos autores (P(k), Rockstar, halofit, z = 127) | ~30 s |
| 4 | `cd ../splats` → `python gerar_splats.py` | tamanho e 4 densidades de cada uma das 16,8 mi partículas | ~70 s, 0,9 GB de RAM |
| 5 | `python subamostrar.py` | versões leves 1/8 e 1/64 | ~30 s |
| 6 | `python paletas.py` | as paletas de cor (figura 15) | ~5 s |
| 7 | `python exportar_ply.py` | grava os `.ply` (formato do 3D Gaussian Splatting) | ~5 s |
| 8 | `python exportar_spz.py` | comprime para `.spz` (formato do Spark) | ~3 s |
| 9 | `cd ../calculos` → `python verificar_tudo.py` | confere tudo | ~1 min |

`gerar_splats.py --testes` roda só os testes de resposta conhecida dos estimadores (segundos).

---

## Arquivos que não vêm no repositório

| Arquivo | Por quê | Como obter |
|---|---|---|
| `dados/` (snapshot, P(k), Rockstar) | dados brutos de terceiros: baixar da fonte oficial | tabela do item 4 |
| `teia_completa_magma.spz` (136 MB) e `teia_completa_magma_alongada.spz` (202 MB) | acima do limite de 100 MB por arquivo do GitHub | `cd splats` → `python versao_completa.py` (e `--alongada`) |
| `splats/dados/sub_1_8.npz` (117 MB) | idem; intermediário da versão 1/8 (verificação e scripts de cor) | `python subamostrar.py` |
| `splats/dados/densidade_z0.npz` (384 MB) | intermediário do `subamostrar.py` | `python gerar_splats.py` (~2 min) |
| PDFs dos artigos | direitos autorais das revistas | links em `REFERENCIAS.xlsx` |

---

## 5. Onde está cada coisa

```
dark_matter_3D/
├── README.md                    ← este arquivo
├── LICENSE                      ← licença MIT (código)
├── REFERENCIAS.xlsx             ← artigos, dados, código e instituições citados
├── index.html                   ← entrada do site (leva ao visualizador)
├── servidor.py                  ← servidor local sem cache (python servidor.py)
├── RESUMO_PARA_ENTENDER.md      ← linguagem simples
├── dados/                       ← (não vem no repositório) dados brutos do CAMELS, ver item 4
├── calculos/                    ← teoria, conferências, verificador, figuras/
├── splats/                      ← gerar_splats, subamostrar, paletas, exportar_ply, exportar_spz
│   └── dados/                   ← densidades, versões leves, .ply e .spz
└── visualizador/
    ├── index.html               ← a página 3D
    ├── app.js                   ← lógica (carregar splats, navegação)
    ├── estilo.css               ← aparência
    ├── testes_navegacao.js      ← testes automáticos (?testes=1)
    └── medir_fps.js             ← roteiro de medição de velocidade (?medir=1)
```

---

## 6. Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| Página preta escrito "carregando…" | servidor não está rodando, ou a página foi aberta direto do disco (`file://`) | fazer o item 1 e abrir pelo endereço `http://127.0.0.1:8765/...` |
| "erro: …" no canto | nome de arquivo errado no `?arquivo=` | conferir os nomes da tabela do item 1 |
| `can't open directory` ao ler o snapshot | falta o `hdf5plugin` | `python -m pip install hdf5plugin` |
| Porta 8765 ocupada | outro servidor aberto | fechar o outro terminal, ou `python servidor.py --porta 9000` (e trocar 8765 por 9000 no endereço) |
| Embaçado de perto | limite da versão aberta (1/8 = 1 partícula a cada 8) | esperado; o aviso de limite de detalhe leva à versão mais fina, quando existe |
| Mudei o código e a página não mudou | o navegador guardou a versão antiga | `Ctrl + Shift + R` (recarregar sem cache) |

---

## Créditos e referências

**Dados.** Simulação CAMELS `IllustrisTNG_DM/CV/CV_0` (só matéria escura, 256³ partículas, caixa de
25 Mpc/h), os 9 universos do conjunto `1P` e o catálogo de aglomerados Rockstar, do **Projeto CAMELS**
(Flatiron Institute, Simons Foundation). Dados públicos, sem cadastro:
https://users.flatironinstitute.org/~camels/ · documentação: https://camels.readthedocs.io.
Os arquivos de `splats/dados/` são **derivados** desses dados (manchas, cores, catálogos resumidos).
Como pede a equipe do CAMELS, quem usar os dados deve citar:

- Villaescusa-Navarro, F. et al. 2021, *The CAMELS project: Cosmology and Astrophysics with MachinE
  Learning Simulations*, ApJ 915, 71. doi:[10.3847/1538-4357/abf7ba](https://doi.org/10.3847/1538-4357/abf7ba)
- Villaescusa-Navarro, F. et al. 2023, *The CAMELS project: public data release*, ApJS 265, 54.
  doi:[10.3847/1538-4365/acbf47](https://doi.org/10.3847/1538-4365/acbf47)

**Códigos científicos por trás dos dados** (não executados aqui; geraram os dados do CAMELS):
- Gadget (simulação): Springel 2005, MNRAS 364, 1105. doi:[10.1111/j.1365-2966.2005.09655.x](https://doi.org/10.1111/j.1365-2966.2005.09655.x)
- CAMB (espectro inicial): Lewis, Challinor & Lasenby 2000, ApJ 538, 473. doi:[10.1086/309179](https://doi.org/10.1086/309179)
- Rockstar (catálogo de aglomerados): Behroozi, Wechsler & Wu 2013, ApJ 762, 109. doi:[10.1088/0004-637X/762/2/109](https://doi.org/10.1088/0004-637X/762/2/109)

**Visualização.**
- [Spark](https://sparkjs.dev) 2.3.1 — World Labs Technologies, Inc., licença MIT (carregado de CDN).
- [three.js](https://threejs.org) 0.180.0 — three.js authors, licença MIT (carregado de CDN).
- Técnica dos splats: Kerbl et al. 2023, *3D Gaussian Splatting for Real-Time Radiance Field Rendering*,
  ACM Trans. Graphics 42(4). doi:[10.1145/3592433](https://doi.org/10.1145/3592433)

**Conferência das contas.** [Colossus](https://bdiemer.bitbucket.io/colossus/) (Diemer 2018, ApJS 239, 35,
doi:[10.3847/1538-4365/aaee8c](https://doi.org/10.3847/1538-4365/aaee8c)) e [CAMB](https://camb.info).
Bibliotecas Python: NumPy, SciPy, Matplotlib, h5py, hdf5plugin e psutil.

**Todos os 42 artigos** usados (método, conferência, visualização e contexto), com autores, título,
revista, DOI, link e para que serviu cada um: [`REFERENCIAS.xlsx`](REFERENCIAS.xlsx). Os PDFs não são
distribuídos aqui, por direitos autorais; use os links.

**Aviso.** É uma visualização de divulgação feita a partir de dados científicos públicos, não um trabalho
revisado por especialistas. Os autores das fontes acima não têm relação com este projeto nem o endossam.
Correções são bem-vindas (abra uma *issue*).

## Licença

O código e a documentação deste projeto estão sob a [licença MIT](LICENSE): qualquer pessoa pode usar,
copiar, modificar e distribuir, de graça, desde que mantenha o aviso de autoria. Os dados de simulação
seguem as condições do Projeto CAMELS (citação acima); three.js e Spark seguem as próprias licenças MIT.
