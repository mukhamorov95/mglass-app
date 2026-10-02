# Собирает страницу стратегии GLASMEN для владельца из docs/avito-b2b/LISTINGS.md,
# чтобы тексты объявлений на странице и в репозитории не расходились.
# Запуск из корня mglass-app: python3 scripts/avito-b2b/page.py <выходной.html>
import html
import re
import sys

src = open('docs/avito-b2b/LISTINGS.md', encoding='utf-8').read()


def unwrap(block: str) -> str:
    # В markdown строки перенесены для чтения; в Авито абзац — одна строка.
    # Склеиваем, когда следующая строка продолжает фразу: начинается со строчной буквы или «(».
    out: list[str] = []
    for line in block.split('\n'):
        if out and out[-1] and line and (line[0].islower() or line[0] == '('):
            out[-1] = out[-1] + ' ' + line
        else:
            out.append(line)
    return '\n'.join(out).strip()


tail = unwrap(re.search(r'## Общий хвост описания.*?```\n(.*?)```', src, re.S).group(1))
rows = re.findall(r'^\| (\d) \| ([^|]+)\| ([^|]+)\| ([^|]+)\|$', src, re.M)
bodies = dict(re.findall(r'^### (\d)\. .*?\n\n```\n(.*?)```', src, re.M | re.S))
if not rows or len(rows) != len(bodies) or {r[0] for r in rows} != set(bodies):
    sys.exit(f'Сетка и тексты не совпадают: строк сетки {len(rows)}, текстов {len(bodies)} — LISTINGS.md изменился')

cards = []
for num, rubric, title, price in rows:
    title, rubric, price = title.strip(), rubric.strip(), price.strip()
    text = unwrap(bodies[num]) + '\n\n' + tail
    cards.append(f'''
    <article class="ad" id="ad{num}">
      <div class="ad-head">
        <span class="ad-num">№ {num}</span>
        <span class="ad-rubric">{html.escape(rubric)}</span>
      </div>
      <h3>{html.escape(title)}</h3>
      <div class="ad-meta"><span class="mono">{len(title)} / 50 знаков</span><span class="price mono">{html.escape(price)}</span></div>
      <details>
        <summary>Текст объявления</summary>
        <pre class="ad-text" id="t{num}">{html.escape(text)}</pre>
      </details>
      <button class="copy" type="button" data-target="t{num}">Скопировать текст</button>
    </article>''')

page = open('scripts/avito-b2b/page.template.html', encoding='utf-8').read()
open(sys.argv[1], 'w', encoding='utf-8').write(page.replace('<!--CARDS-->', '\n'.join(cards)))
print(f'ok: {len(cards)} объявлений → {sys.argv[1]}')
