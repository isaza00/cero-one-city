"""AES-256-GCM encryption for provider API keys. The master key lives only in the
environment; decrypted keys exist only in worker memory while calling providers
and are never logged or returned by the API (only last4)."""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.settings import get_settings


def _key() -> bytes:
    raw = base64.b64decode(get_settings().master_key)
    if len(raw) != 32:
        raise RuntimeError("MASTER_KEY must be 32 bytes, base64-encoded")
    return raw


def encrypt(plaintext: str) -> tuple[bytes, bytes]:
    """Returns (nonce, ciphertext)."""
    nonce = os.urandom(12)
    ct = AESGCM(_key()).encrypt(nonce, plaintext.encode(), None)
    return nonce, ct


def decrypt(nonce: bytes, ciphertext: bytes) -> str:
    return AESGCM(_key()).decrypt(nonce, ciphertext, None).decode()
