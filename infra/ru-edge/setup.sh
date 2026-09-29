#!/usr/bin/env bash
# Разворачивает российскую точку входа на чистом Ubuntu 24.04 (маршрут Э2–Э4).
# Идемпотентен: повторный запуск обновляет конфиги и перезапускает службы.
#
#   scp -r infra/ru-edge root@<IP>:/opt/ && ssh root@<IP> 'bash /opt/ru-edge/setup.sh app.mglass.pro'
#
# Перед запуском: DNS A-запись DOMAIN → IP сервера, и /etc/mglass/ru-edge.env
# (образец — ru-edge.env.example, права 600).
set -euo pipefail

DOMAIN=${1:?укажи домен, например app.mglass.pro}
UPSTREAM_HOST=${UPSTREAM_HOST:-$DOMAIN}
HERE=$(cd "$(dirname "$0")" && pwd)
EMAIL=${LE_EMAIL:-admin@${DOMAIN#*.}}

[[ -f /etc/mglass/ru-edge.env ]] || { echo "нет /etc/mglass/ru-edge.env — скопируй ru-edge.env.example и заполни"; exit 1; }
chmod 600 /etc/mglass/ru-edge.env

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq nginx certbot curl ca-certificates gnupg ufw dnsutils
# pg_dump должен быть не старше сервера Supabase (Postgres 17) — ставим из репозитория PGDG.
if ! command -v pg_dump >/dev/null || [[ "$(pg_dump --version | grep -oE '[0-9]+' | head -1)" -lt 17 ]]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release; echo "$VERSION_CODENAME")-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -q
  apt-get install -yq postgresql-17 postgresql-client-17
fi

ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# Адреса Vercel, которые открываются из России (замер 28.09: 76.76.21.x и 66.33.60.x — да,
# 64.29.17.x и 216.198.79.x — нет). Берём ответы cname.vercel-dns.com плюс 76.76.21.21.
SERVERS=$(mktemp)
for ip in $( { dig +short cname.vercel-dns.com A; echo 76.76.21.21; } | grep -E '^[0-9.]+$' | sort -u); do
  echo "    server ${ip}:443 max_fails=2 fail_timeout=10s;" >> "$SERVERS"
done
[[ -s "$SERVERS" ]] || { echo "не удалось получить адреса Vercel"; exit 1; }
SERVERS_HTTP=$(mktemp); sed 's/:443 /:80 /' "$SERVERS" > "$SERVERS_HTTP"

render() {   # $1 = with_tls (0/1)
  local out=/etc/nginx/sites-available/mglass.conf
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__UPSTREAM_HOST__|$UPSTREAM_HOST|g" \
      "$HERE/nginx/app.conf.template" \
    | awk 'FILENAME == ARGV[1] { a = a $0 "\n"; next }
           FILENAME == ARGV[2] { h = h $0 "\n"; next }
           $0 == "__UPSTREAM_SERVERS__" { printf "%s", a; next }
           $0 == "__UPSTREAM_SERVERS_HTTP__" { printf "%s", h; next }
           { print }' "$SERVERS" "$SERVERS_HTTP" - > "$out"
  if [[ "$1" == 0 ]]; then
    # До выпуска сертификата — только HTTP-блок (для проверки Let's Encrypt).
    awk '/^server \{/{n++} n<2' "$out" > "$out.tmp" && mv "$out.tmp" "$out"
  fi
  ln -sf "$out" /etc/nginx/sites-enabled/mglass.conf
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
}

mkdir -p /var/www/acme
if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  render 0
  certbot certonly --webroot -w /var/www/acme -d "$DOMAIN" --email "$EMAIL" --agree-tos -n
fi
render 1
# Продление сертификата перезагружает nginx.
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx

install -m 755 "$HERE/probe.sh"  /usr/local/bin/mglass-probe
install -m 755 "$HERE/backup.sh" /usr/local/bin/mglass-backup
install -m 644 "$HERE"/systemd/*.service "$HERE"/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mglass-probe.timer mglass-backup.timer

echo "Готово: https://$DOMAIN → Vercel ($UPSTREAM_HOST). Проба: tail -f /var/log/mglass-probe.csv"
