#!/usr/bin/env bash
# Generates a self-signed wildcard cert for *.aeronet.local
# For production, replace with certs from your CA or Let's Encrypt.
set -euo pipefail
mkdir -p "$(dirname "$0")/certs"
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$(dirname "$0")/certs/aeronet.key" \
  -out    "$(dirname "$0")/certs/aeronet.crt" \
  -subj   "/CN=*.aeronet.local/O=AeroNet OS/C=US" \
  -addext "subjectAltName=DNS:aeronet.local,DNS:*.aeronet.local"
echo "Self-signed cert written to infra/nginx/certs/"
echo "For production, replace with certs from your CA."
