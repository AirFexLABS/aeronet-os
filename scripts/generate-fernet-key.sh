#!/usr/bin/env bash
# Generates a Fernet encryption key for CREDENTIALS_ENCRYPTION_KEY.
# Requires: python3 with cryptography package installed.
set -euo pipefail

if ! python3 -c "from cryptography.fernet import Fernet" 2>/dev/null; then
  echo "Installing cryptography package..."
  pip3 install cryptography --quiet
fi

KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
echo ""
echo "Generated Fernet key:"
echo "$KEY"
echo ""
echo "Add to .env.secret:"
echo "  CREDENTIALS_ENCRYPTION_KEY=$KEY"
echo ""
echo "Back this key up securely. Losing it makes stored device credentials unrecoverable."
