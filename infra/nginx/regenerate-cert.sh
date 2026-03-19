#!/usr/bin/env bash
# Regenerate self-signed TLS certificate for AeroNet OS
# Run on the server: cd /opt/aeronet-os && bash infra/nginx/certs/regenerate-cert.sh
set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Generating new self-signed certificate..."
openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout "$CERT_DIR/aeronet.key" \
  -out    "$CERT_DIR/aeronet.crt" \
  -subj   "/C=US/O=AeroNet OS/CN=aeronet.local" \
  -addext "subjectAltName=DNS:aeronet.local,DNS:*.aeronet.local,DNS:api.aeronet.local,DNS:grafana.aeronet.local,IP:216.152.167.28" \
  -addext "basicConstraints=CA:TRUE" \
  -addext "keyUsage=digitalSignature,keyCertSign,cRLSign" \
  -addext "extendedKeyUsage=serverAuth"

chmod 644 "$CERT_DIR/aeronet.key"
chmod 644 "$CERT_DIR/aeronet.crt"

echo ""
echo "Certificate generated. Verifying..."
openssl x509 -in "$CERT_DIR/aeronet.crt" -text -noout | grep -A2 "Subject:\|Issuer:\|Validity\|Basic Constraints\|Subject Alternative"

echo ""
echo "Cert modulus hash:"
openssl x509 -noout -modulus -in "$CERT_DIR/aeronet.crt" | md5sum
echo "Key modulus hash:"
openssl rsa -noout -modulus -in "$CERT_DIR/aeronet.key" | md5sum

echo ""
echo "Done. Now reload nginx:"
echo "  docker exec aeronet-nginx nginx -t && docker restart aeronet-nginx"
