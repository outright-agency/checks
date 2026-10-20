#!/usr/bin/env bash
# The commit a CI job compares the change with, written to the job's environment as
# <NAME>_RATCHET_BASE_SHA (NAME: the app's config name, upper-cased, "-" as "_"). The ratchets'
# baselines, a pull request's related app tests and a docs-only reader all read it.
#
#   pull_request  the test merge commit's first parent: the base it was merged onto
#   merge_group   the commit the queue entry is built on: the branch plus every entry ahead of it
#
# The job's checkout is two commits deep: the commit and its parents. A base outside it is fetched
# alone, without its history. A base that cannot be named or fetched stops the job: it is never
# read as "no baseline".
#
# Reads CHECKS_NAME, GITHUB_EVENT_NAME, PULL_REQUEST_BASE, MERGE_GROUP_BASE and GITHUB_ENV.
set -euo pipefail

if [ -z "${CHECKS_NAME:-}" ]; then
  echo "::error::ci-base needs the app's name (the name in its checks.config.mjs)"
  exit 1
fi
variable="$(printf '%s' "$CHECKS_NAME" | tr 'a-z-' 'A-Z_')_RATCHET_BASE_SHA"

case "$GITHUB_EVENT_NAME" in
  pull_request)
    if [ "$(git rev-list --parents -n 1 HEAD | wc -w)" -ne 3 ]; then
      echo "::error::the pull request's checkout is not its test merge commit"
      exit 1
    fi
    base=$(git rev-parse HEAD^1)
    if [ "$base" != "${PULL_REQUEST_BASE:-}" ]; then
      echo "::notice::the test merge was built on ${base}, not the event's base ${PULL_REQUEST_BASE:-}"
    fi
    ;;
  merge_group) base=${MERGE_GROUP_BASE:-} ;;
  *)
    echo "::error::no ratchet base for a ${GITHUB_EVENT_NAME} event"
    exit 1
    ;;
esac
if [ -z "$base" ] || [ "$base" = 0000000000000000000000000000000000000000 ]; then
  echo "::error::the ${GITHUB_EVENT_NAME} event names no base commit"
  exit 1
fi
if git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "Ratchet base ${base}: in the checkout"
else
  git fetch --no-tags --depth=1 origin "$base"
  echo "Ratchet base ${base}: fetched alone"
fi
echo "${variable}=${base}" >> "$GITHUB_ENV"
