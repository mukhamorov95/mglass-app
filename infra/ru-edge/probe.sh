#!/usr/bin/env bash
# Проба доступности из России (маршрут Э3). Запускается таймером раз в минуту.
# Меряет ПОЛНУЮ загрузку: код ответа приходит в первом килобайте, а обрывы у российских
# провайдеров случаются после (~16 КБ) — поэтому сравниваем полученные байты с порогом.
set -uo pipefail

source /etc/mglass/ru-edge.env          # DOMAIN, ANON_KEY, TG_TOKEN, TG_CHAT (права 600)
STATE=/var/lib/mglass-probe
LOG=/var/log/mglass-probe.csv
mkdir -p "$STATE"

MIN_LOGIN_BYTES=${MIN_LOGIN_BYTES:-15000}   # страница входа ~19,7 КБ; обрыв на 16 КБ даёт меньше

probe() {   # name url min_bytes [header]
  local name=$1 url=$2 min=$3 hdr=${4:-}
  local out code size t
  out=$(curl -s -o /dev/null --max-time 25 ${hdr:+-H "$hdr"} \
        -w '%{http_code} %{size_download} %{time_total}' "$url" 2>/dev/null || echo "000 0 25")
  read -r code size t <<<"$out"
  local ok=0
  [[ "$code" == 200 && "$size" -ge "$min" ]] && ok=1
  printf '%s,%s,%s,%s,%s,%s\n' "$(date -Is)" "$name" "$code" "$size" "$t" "$ok" >> "$LOG"
  echo "$ok"
}

alert() {
  [[ -n "${TG_TOKEN:-}" && -n "${TG_CHAT:-}" ]] || return 0
  curl -s --max-time 15 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
       --data-urlencode "chat_id=${TG_CHAT}" --data-urlencode "text=$1" >/dev/null || true
}

check() {   # name ok
  local name=$1 ok=$2 f="$STATE/$1.fails"
  local fails; fails=$(cat "$f" 2>/dev/null || echo 0)
  if [[ "$ok" == 1 ]]; then
    [[ "$fails" -ge 3 ]] && alert "✅ ${name}: снова работает (было ${fails} сбоев подряд)"
    echo 0 > "$f"
  else
    fails=$((fails + 1)); echo "$fails" > "$f"
    [[ "$fails" -eq 3 ]] && alert "🔴 ${name}: 3 минуты подряд не загружается из России. Лог: ${LOG}"
  fi
}

# Путь людей: наш российский вход → Vercel.
check "Приложение (${DOMAIN})"  "$(probe app      "https://${DOMAIN}/login" "$MIN_LOGIN_BYTES")"
# База через тот же вход (как ходит браузер).
check "База через ${DOMAIN}"   "$(probe db       "https://${DOMAIN}/supabase/auth/v1/health" 2 "apikey: ${ANON_KEY}")"
# Контроль: прямой путь из РЦОД на vercel.app — показывает, режут ли зарубежный отрезок.
probe direct "https://mglass-app.vercel.app/login" "$MIN_LOGIN_BYTES" >/dev/null
