"""Security contract tests for locally encrypted vault material."""

from __future__ import annotations

import base64

import pytest

from app.core.encryption import EndToEndEncryptor


def _key(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def test_encrypt_string_round_trip_uses_a_fresh_nonce() -> None:
    encryptor = EndToEndEncryptor(_key(b"a" * 32))

    first = encryptor.encrypt_string("local secret")
    second = encryptor.encrypt_string("local secret")

    assert first != second
    assert "local secret" not in first
    assert encryptor.decrypt_string(first) == "local secret"
    assert encryptor.decrypt_string(second) == "local secret"


def test_ciphertext_tampering_and_wrong_keys_fail_closed() -> None:
    encryptor = EndToEndEncryptor(_key(b"a" * 32))
    other = EndToEndEncryptor(_key(b"b" * 32))
    token = encryptor.encrypt_string("local secret")
    nonce, ciphertext = token.split(":", 1)
    decoded = bytearray(base64.b64decode(ciphertext))
    decoded[-1] ^= 1
    tampered = f"{nonce}:{base64.b64encode(decoded).decode('ascii')}"

    with pytest.raises(ValueError, match="Failed to decrypt credential"):
        encryptor.decrypt_string(tampered)
    with pytest.raises(ValueError, match="Failed to decrypt credential"):
        other.decrypt_string(token)


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("not-base64", "valid base64"),
        (_key(b"short"), "32-byte"),
    ],
)
def test_invalid_key_material_is_rejected(value: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        EndToEndEncryptor(value)


def test_missing_key_material_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("E2E_SECRET_KEY", raising=False)

    with pytest.raises(RuntimeError, match="E2E_SECRET_KEY is required"):
        EndToEndEncryptor()
