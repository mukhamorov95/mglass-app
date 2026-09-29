#!/usr/bin/env bash
# Полная резервная копия базы в России (маршрут Э4). Таймер — каждую ночь.
# Крон приложения /api/cron/backup копирует 6 таблиц из 196 в ту же Supabase — это не копия.
# Здесь: pg_dump всей базы (схема + данные + auth + storage-метаданные) на российский диск.
set -euo pipefail

source /etc/mglass/ru-edge.env          # SUPABASE_DB_URL (session pooler, порт 5432), TG_TOKEN, TG_CHAT
DIR=/var/backups/mglass
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p "$DIR"; chmod 700 "$DIR"

stamp=$(date +%F)
file="$DIR/db-$stamp.dump"
tmp="$file.part"

notify() {
  [[ -n "${TG_TOKEN:-}" && -n "${TG_CHAT:-}" ]] || return 0
  curl -s --max-time 15 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
       --data-urlencode "chat_id=${TG_CHAT}" --data-urlencode "text=$1" >/dev/null || true
}

if ! pg_dump "$SUPABASE_DB_URL" -Fc --no-owner --no-privileges \
       --schema=public --schema=auth --schema=storage -f "$tmp"; then
  rm -f "$tmp"
  notify "🔴 Резервная копия базы $stamp НЕ сделана — pg_dump упал. Смотри journalctl -u mglass-backup"
  exit 1
fi
mv "$tmp" "$file"

# Копия читается: оглавление архива должно содержать таблицы.
tables=$(pg_restore -l "$file" | grep -c ' TABLE DATA ' || true)
size=$(du -h "$file" | cut -f1)
if [[ "$tables" -lt 100 ]]; then
  notify "🟠 Копия базы $stamp подозрительно мала: $tables таблиц с данными, $size"
fi

find "$DIR" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete

# Раз в неделю (воскресенье) — пробное восстановление в пустую локальную базу.
if [[ "$(date +%u)" == 7 ]] && command -v createdb >/dev/null; then
  sudo -u postgres dropdb --if-exists mglass_restore_test
  sudo -u postgres createdb mglass_restore_test
  if sudo -u postgres pg_restore --no-owner --no-privileges -d mglass_restore_test "$file" >/dev/null 2>&1 || true; then
    rows=$(sudo -u postgres psql -tAc "select count(*) from public.b2b_orders" mglass_restore_test 2>/dev/null || echo "?")
    notify "🗄 Пробное восстановление $stamp: $tables таблиц, заказов B2B в копии — $rows. Размер $size"
  fi
  sudo -u postgres dropdb --if-exists mglass_restore_test
fi
