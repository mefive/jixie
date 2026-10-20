#!/usr/bin/env bash
# 兼容旧调用名；维护 CLI 自行取得并验证系统锁，环境布尔值不授予所有权。
# Compatibility entry: the maintenance CLI acquires real OS locks; booleans grant no ownership.
set -Eeuo pipefail
[[ "$#" -gt 0 ]] || { printf 'Usage: with-maintenance-lock.sh COMMAND [ARG...]\n' >&2; exit 2; }
exec "$@"
