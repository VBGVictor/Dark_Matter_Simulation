"""
servidor.py — servidor local do projeto Dentro da Teia
======================================================

Igual ao `python -m http.server`, com UMA diferença: manda o navegador nunca guardar
cópias antigas dos arquivos (Cache-Control: no-store). Sem isso, depois de uma atualização
do código o navegador pode continuar rodando a versão velha — foi o que invalidou uma
medição de velocidade em 15/10/2026.

Uso (na pasta do projeto):
    python servidor.py              → só este computador: http://127.0.0.1:8765/visualizador/
    python servidor.py --rede       → também aparelhos do mesmo Wi-Fi (celular). ATENÇÃO:
                                      qualquer aparelho na rede consegue abrir os arquivos da
                                      pasta enquanto estiver rodando. Só em rede de casa.
    python servidor.py --porta 9000 → outra porta
Parar: Ctrl + C
"""

from __future__ import annotations

import argparse
import functools
import http.server
from pathlib import Path

PASTA = Path(__file__).resolve().parent


class SemCache(http.server.SimpleHTTPRequestHandler):
    """Servidor de arquivos estático que proíbe o cache do navegador."""

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".spz": "application/octet-stream",
                      ".ply": "application/octet-stream"}

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


def main() -> None:
    ap = argparse.ArgumentParser(description="Servidor local sem cache do Dentro da Teia")
    ap.add_argument("--porta", type=int, default=8765)
    ap.add_argument("--rede", action="store_true", help="aceitar conexões do Wi-Fi (celular)")
    a = ap.parse_args()
    endereco = "0.0.0.0" if a.rede else "127.0.0.1"
    manipulador = functools.partial(SemCache, directory=str(PASTA))
    with http.server.ThreadingHTTPServer((endereco, a.porta), manipulador) as srv:
        print(f"Dentro da Teia: http://127.0.0.1:{a.porta}/visualizador/index.html  (Ctrl + C para parar)")
        if a.rede:
            print("ATENÇÃO: aberto para a rede local. Use só em rede de casa.")
        srv.serve_forever()


if __name__ == "__main__":
    main()
