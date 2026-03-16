"""
Vault encryption/decryption using Fernet symmetric encryption.
CREDENTIALS_ENCRYPTION_KEY must be a valid Fernet key (base64url, 32 bytes).
All encrypt/decrypt operations are logged to vault_audit.
"""
import os
from cryptography.fernet import Fernet, InvalidToken

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = os.environ.get("CREDENTIALS_ENCRYPTION_KEY")
        if not key:
            raise EnvironmentError("CREDENTIALS_ENCRYPTION_KEY not set")
        _fernet = Fernet(key.encode())
    return _fernet


def encrypt(plaintext: str) -> str:
    """Encrypt a plaintext string. Returns base64 ciphertext."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """Decrypt a Fernet ciphertext. Raises InvalidToken if tampered."""
    return _get_fernet().decrypt(ciphertext.encode()).decode()


def rotate_encryption(old_ciphertext: str, new_key: str) -> str:
    """
    Re-encrypt a value with a new key.
    Used during key rotation without exposing plaintext.
    """
    plaintext = decrypt(old_ciphertext)
    new_fernet = Fernet(new_key.encode())
    return new_fernet.encrypt(plaintext.encode()).decode()
