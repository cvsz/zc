"""Default server-side AI provider adapter."""

from __future__ import annotations

import json
import os
from typing import Any

import aiohttp

ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"


class AnthropicCoderAdapter:
    """Small synchronous adapter executed by ``AIService`` in a worker thread."""

    def __init__(
        self,
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int = 4096,
        personality_style: str | None = None,
        service_tier: str | None = None,
        inference_geo: str | None = None,
        fast_mode: bool = False,
    ) -> None:
        self.api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.model = model or os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.service_tier = service_tier
        self.inference_geo = inference_geo
        self.fast_mode = fast_mode

    async def generate(
        self,
        prompt: str,
        *,
        system: str | None = None,
        file_content: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> str:
        if not self.api_key:
            return "[ERROR] AI provider credential is not configured"

        user_content = prompt
        if file_content:
            user_content = f"File content:\n```\n{file_content}\n```\n\n{prompt}"

        messages: list[dict[str, Any]] = list(history or [])
        messages.append({"role": "user", "content": user_content})
        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": messages,
        }
        if system:
            payload["system"] = system
        if self.temperature is not None:
            payload["temperature"] = self.temperature
        if self.service_tier:
            payload["service_tier"] = self.service_tier
        if self.inference_geo:
            payload["inference_geo"] = self.inference_geo
        if self.fast_mode:
            payload["speed"] = "fast"

        try:
            timeout = aiohttp.ClientTimeout(total=120)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    ANTHROPIC_MESSAGES_URL,
                    json=payload,
                    headers={
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                        "x-api-key": self.api_key,
                    },
                ) as response:
                    if response.status >= 400:
                        return (
                            f"[API ERROR {response.status}] "
                            "AI provider request failed"
                        )
                    body = json.loads(await response.text())
        except (aiohttp.ClientError, TimeoutError, ValueError):
            return "[ERROR] AI provider request failed"

        content = body.get("content", [])
        text = "".join(
            str(block.get("text", ""))
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
        return text or "[ERROR] AI provider returned no text"


__all__ = ["ANTHROPIC_MESSAGES_URL", "AnthropicCoderAdapter"]
