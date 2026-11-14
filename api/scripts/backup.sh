#!/usr/bin/env bash
# Backup do banco (formato custom do pg_dump, compactado) com retenção.
# Uso: DATABASE_URL=postgresql://... ./scripts/backup.sh [pasta] [dias_de_retencao]
# Restaurar: pg_restore --clean --if-exists -d "$DATABASE_URL" backups/financeiro-AAAAMMDD-HHMMSS.dump
# Agende no cron, ex.: 0 3 * * * cd /caminho/api && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL}"
DIR="${1:-backups}"
KEEP_DAYS="${2:-30}"
mkdir -p "$DIR"
FILE="$DIR/financeiro-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$FILE"
echo "Backup salvo em $FILE ($(du -h "$FILE" | cut -f1))"
find "$DIR" -name 'financeiro-*.dump' -mtime +"$KEEP_DAYS" -delete
