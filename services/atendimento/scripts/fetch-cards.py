"""Baixa as 78 cartas do Rider-Waite-Smith (1909, domínio público) da Wikimedia Commons,
reduz para 600 px de largura e salva em assets/cards/NN.jpg, onde NN é o índice da carta em
CARDS (src/tarot.ts). Uso: python scripts/fetch-cards.py  (precisa de Pillow)."""
import io
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

MAJOR = ['RWS_Tarot_00_Fool', 'RWS_Tarot_01_Magician', 'RWS_Tarot_02_High_Priestess',
         'RWS_Tarot_03_Empress', 'RWS_Tarot_04_Emperor', 'RWS_Tarot_05_Hierophant',
         'RWS_Tarot_06_Lovers', 'RWS_Tarot_07_Chariot', 'RWS_Tarot_08_Strength',
         'RWS_Tarot_09_Hermit', 'RWS_Tarot_10_Wheel_of_Fortune', 'RWS_Tarot_11_Justice',
         'RWS_Tarot_12_Hanged_Man', 'RWS_Tarot_13_Death', 'RWS_Tarot_14_Temperance',
         'RWS_Tarot_15_Devil', 'RWS_Tarot_16_Tower', 'RWS_Tarot_17_Star', 'RWS_Tarot_18_Moon',
         'RWS_Tarot_19_Sun', 'RWS_Tarot_20_Judgement', 'RWS_Tarot_21_World']
# Mesma ordem de naipes de tarot.ts: Copas, Ouros, Espadas, Paus.
SUITS = ['Cups', 'Pents', 'Swords', 'Wands']

names = MAJOR + [f'{suit}{n:02d}' for suit in SUITS for n in range(1, 15)]
assert len(names) == 78

# Política da Wikimedia: User-Agent descritivo (ferramenta/versão, finalidade, biblioteca).
USER_AGENT = ('escritorio-tarot-card-fetcher/1.1 (personal non-commercial tarot project; '
              'downloads public-domain RWS card scans; Python-urllib)')
MAX_RETRY_WAIT = 900  # respeita Retry-After até 15 min

out = Path(__file__).resolve().parent.parent / 'assets' / 'cards'
out.mkdir(parents=True, exist_ok=True)

for index, name in enumerate(names):
    target = out / f'{index:02d}.jpg'
    if target.exists():
        continue
    url = f'https://commons.wikimedia.org/wiki/Special:FilePath/{name}.jpg'
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    image = None
    for attempt in range(5):
        try:
            data = urllib.request.urlopen(request, timeout=60).read()
            image = Image.open(io.BytesIO(data)).convert('RGB')
            break
        except urllib.error.HTTPError as error:
            # 429 = limite de requisições: espera (respeitando Retry-After) e tenta de novo.
            wait = int(error.headers.get('Retry-After') or 0) or 10 * (attempt + 1)
            if error.code not in (429, 503):
                print(f'FALHOU {index:02d} {name}: HTTP {error.code}', file=sys.stderr)
                break
            print(f'HTTP {error.code} em {name}, esperando {min(wait, MAX_RETRY_WAIT)}s', file=sys.stderr, flush=True)
            time.sleep(min(wait, MAX_RETRY_WAIT))
        except Exception as error:  # noqa: BLE001 - relatório simples, segue para as outras
            print(f'FALHOU {index:02d} {name}: {type(error).__name__}', file=sys.stderr)
            break
    if image is None:
        continue
    image.thumbnail((600, 1100))
    image.save(target, 'JPEG', quality=82, optimize=True)
    print(f'ok {index:02d} {name} {image.size} {target.stat().st_size // 1024} KB')
    time.sleep(4)
