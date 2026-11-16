#!/bin/bash
# ---------------------------------------------------------------------------
# 统一配置：容器名 / 库名 / 用户均可用环境变量覆盖，脚本内不含任何凭据。
# 配置方式同其他脚本：把 automation.env.example 复制为 automation.env（600）。
# 说明见 deploy/automation/README.md
#
# 备份恢复演练：导出 → 恢复到临时库 → 逐表校验 → 清理临时库。
# 源库仍在写入，因此按「导出前 / 恢复后」两次源库快照做区间校验：
#   - 恢复后的行数必须落在两次快照之间（说明备份没有丢数据）；
#   - 三次行数完全一致的表，再做内容摘要比对（发现行数相同但内容被截断/损坏）。
# ---------------------------------------------------------------------------
VH_ENV_FILE=${VH_AUTOMATION_ENV:-/etc/voicehub/automation.env}
[ -r "$VH_ENV_FILE" ] && . "$VH_ENV_FILE"
set -uo pipefail

PG=${VH_PG_CONTAINER:-voicehub-postgres}
DB=${VH_DB_NAME:-voicehub}
DB_USER=${VH_DB_USER:-voicehub}
DRILL_DB=${VH_DRILL_DB:-voicehub_drill}
DUMP=/tmp/vh-drill-$$.dump
SNAP_DIR=$(mktemp -d)

cleanup() {
  docker exec "$PG" rm -f "$DUMP" >/dev/null 2>&1
  docker exec "$PG" psql -U "$DB_USER" -d postgres -c "set client_min_messages=warning" \
    -c "drop database if exists \"$DRILL_DB\"" >/dev/null 2>&1
  rm -rf "$SNAP_DIR"
}
trap cleanup EXIT

# 逐表「行数 + 内容摘要」：sum(hashtext) 与行顺序无关，可发现行数相同但内容不同
snapshot() {
  local sql
  sql=$(docker exec "$PG" psql -U "$DB_USER" -d "$1" -tAc "
    select string_agg(format('select %L t, count(*) c, coalesce(sum(hashtext(x::text)),0) h from %I x', table_name, table_name), ' union all ' order by table_name)
    from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" 2>/dev/null) || return 1
  [ -n "$sql" ] || return 1
  docker exec "$PG" psql -U "$DB_USER" -d "$1" -tAc "$sql" 2>/dev/null | sort
}

# 1) 导出前快照 + 导出并校验备份文件可读（与 01-db-backup.sh 相同口径）
snapshot "$DB" > "$SNAP_DIR/before" || { echo "FAIL 无法读取源库快照"; exit 1; }
if ! docker exec "$PG" sh -c "pg_dump -U '$DB_USER' -d '$DB' -Fc -Z 9 -f '$DUMP' && pg_restore -l '$DUMP' >/dev/null"; then
  echo "FAIL pg_dump 失败或备份文件未通过完整性校验"
  exit 1
fi
SIZE=$(docker exec "$PG" stat -c%s "$DUMP" 2>/dev/null || echo 0)
if [ "${SIZE:-0}" -lt 50000 ]; then
  echo "FAIL 备份文件过小（${SIZE} 字节），拒绝用于演练"
  exit 1
fi

# 2) 恢复到临时库（与业务库隔离，演练结束即删除）
if ! docker exec "$PG" psql -U "$DB_USER" -d postgres -c "set client_min_messages=warning" \
  -c "drop database if exists \"$DRILL_DB\"" -c "create database \"$DRILL_DB\"" >/dev/null 2>&1; then
  echo "FAIL 临时库创建失败（$DRILL_DB）"
  exit 1
fi
if ! docker exec "$PG" pg_restore -U "$DB_USER" -d "$DRILL_DB" --no-owner --no-privileges --exit-on-error "$DUMP" >/dev/null 2>&1; then
  echo "FAIL pg_restore 恢复失败"
  exit 1
fi

# 3) 恢复后源库快照 + 临时库快照，逐表校验
snapshot "$DB" > "$SNAP_DIR/after" || { echo "FAIL 无法读取源库快照"; exit 1; }
snapshot "$DRILL_DB" > "$SNAP_DIR/drill" || { echo "FAIL 无法读取临时库快照"; exit 1; }

REPORT=$(awk -F'|' '
  FILENAME==ARGV[1] { a[$1]=$2; ha[$1]=$3; next }
  FILENAME==ARGV[2] { b[$1]=$2; next }
  FILENAME==ARGV[3] { r[$1]=$2; hr[$1]=$3; next }
  END {
    bad=0; tables=0; rows=0
    for (t in r) if (!(t in a)) { print "多余表：" t; bad=1 }
    for (t in a) {
      tables++; rows += r[t]
      if (!(t in r)) { print "缺失表：" t; bad=1; continue }
      if (r[t] + 0 < a[t] + 0 || r[t] + 0 > b[t] + 0) {
        printf "行数越界：%s 导出前=%s 恢复后=%s 当前=%s\n", t, a[t], r[t], b[t]; bad=1
      } else if (a[t] == b[t] && b[t] == r[t] && ha[t] != hr[t]) {
        printf "内容摘要不一致：%s（%s 行）\n", t, r[t]; bad=1
      }
    }
    printf "TABLES=%d ROWS=%d BAD=%d\n", tables, rows, bad
  }' "$SNAP_DIR/before" "$SNAP_DIR/after" "$SNAP_DIR/drill")

SUMMARY=$(printf '%s\n' "$REPORT" | tail -1)
DETAIL=$(printf '%s\n' "$REPORT" | sed '$d')
if ! printf '%s' "$SUMMARY" | grep -q 'BAD=0'; then
  echo "FAIL 恢复结果与源库不一致："
  printf '%s\n' "$DETAIL" | head -20
  exit 1
fi

TABLES=$(printf '%s' "$SUMMARY" | sed -n 's/.*TABLES=\([0-9]*\).*/\1/p')
ROWS=$(printf '%s' "$SUMMARY" | sed -n 's/.*ROWS=\([0-9]*\).*/\1/p')
echo "PASS 备份恢复演练通过：$TABLES 张表 / $ROWS 行，行数与内容摘要校验一致（$(numfmt --to=iec "${SIZE:-0}")）"
