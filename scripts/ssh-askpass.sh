#!/usr/bin/env bash

set -euo pipefail

printf '%s\n' "${SSH_PASSWORD:?SSH_PASSWORD is required}"
