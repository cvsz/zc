"""Application service adapting the legacy AI engine to enterprise API use cases."""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable
from datetime import datetime, timezone
from functools import partial
from uuid import uuid4

from app.models.ai import AICapabilities, AIResponse, AIResponseRequest

from .ai_provider import AnthropicCoderAdapter
from .capabilities import PERSONALITIES, SKILLS


AGENT_SYSTEM_PROMPTS: dict[str, str] = {
    "code_generator": (
        "You are a full-project code generation agent. Produce complete, runnable code."
    ),
    "code_reviewer": (
        "You are a code review agent. Focus on correctness, readability, and maintainability."
    ),
    "testing_agent": (
        "You are a testing agent. Cover edge cases and failure modes."
    ),
    "documentation_agent": (
        "You are a documentation agent. Write clear documentation for new readers."
    ),
    "optimizer": (
        "You are a performance optimization agent. Propose measurable improvements."
    ),
    "security_auditor": (
        "You are a security audit agent. Identify vulnerabilities and rate their severity."
    ),
    "full_stack": (
        "You are a full-stack engineering agent. Consider frontend, backend, and data layers."
    ),
}


class AIServiceError(RuntimeError):
    """Operational failure safe to map to a stable API error code."""


class UnknownCapabilityError(ValueError):
    """A requested agent, personality, or skill does not exist."""


class AIService:
    """Own AI use-case orchestration independently of HTTP and argparse."""

    def __init__(self, coder_factory: Callable[..., object] | None = None) -> None:
        self._coder_factory = coder_factory

    @staticmethod
    def capabilities() -> AICapabilities:
        """Return capabilities owned by the server boundary."""
        return AICapabilities(
            agents=sorted(AGENT_SYSTEM_PROMPTS),
            personalities=sorted(PERSONALITIES),
            skills=sorted(SKILLS),
        )

    @staticmethod
    def _system_prompt(request: AIResponseRequest) -> str | None:
        parts = [request.system] if request.system else []

        if request.personality:
            personality_prompt = PERSONALITIES.get(request.personality)
            if personality_prompt is None:
                raise UnknownCapabilityError(
                    f"Unknown personality: {request.personality}"
                )
            parts.append(personality_prompt)

        if request.agent:
            prompt = AGENT_SYSTEM_PROMPTS.get(request.agent)
            if prompt is None:
                raise UnknownCapabilityError(f"Unknown agent: {request.agent}")
            parts.append(prompt)

        if request.skill:
            skill_description = SKILLS.get(request.skill)
            if skill_description is None:
                raise UnknownCapabilityError(f"Unknown skill: {request.skill}")
            parts.append(
                f"Skill focus — {request.skill}: {skill_description}"
            )

        return "\n\n".join(parts) or None

    def _create_coder(self, request: AIResponseRequest) -> object:
        if self._coder_factory is None:
            factory: Callable[..., object] = AnthropicCoderAdapter
        else:
            factory = self._coder_factory

        return factory(
            model=request.model,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            personality_style=request.personality,
            service_tier=request.service_tier,
            inference_geo=request.inference_geo,
            fast_mode=request.fast_mode,
        )

    async def create_response(self, request: AIResponseRequest) -> AIResponse:
        """Execute blocking legacy inference outside the event loop."""
        system = self._system_prompt(request)
        coder = self._create_coder(request)
        generate = getattr(coder, "generate", None)
        if not callable(generate):
            raise AIServiceError("AI provider adapter is unavailable")

        call = partial(
            generate,
            request.prompt,
            system=system,
            file_content=request.file_content,
            history=[message.model_dump() for message in request.history],
        )
        output = call()
        if inspect.isawaitable(output):
            output = await output
        if not isinstance(output, str):
            raise AIServiceError("AI provider returned an invalid response")
        if output.startswith("[ERROR]") or output.startswith("[API ERROR"):
            raise AIServiceError("AI provider request failed")

        model = str(getattr(coder, "model", request.model or "unknown"))
        return AIResponse(
            id=f"air_{uuid4().hex}",
            created_at=datetime.now(timezone.utc),
            model=model,
            output_text=output,
        )


_service: AIService | None = None


def get_ai_service_instance() -> AIService:
    """Return the process-local stateless AI application service."""
    global _service
    if _service is None:
        _service = AIService()
    return _service


async def get_ai_service() -> AIService:
    """FastAPI dependency that avoids the synchronous dependency threadpool."""
    return get_ai_service_instance()


__all__ = [
    "AGENT_SYSTEM_PROMPTS",
    "AIService",
    "AIServiceError",
    "UnknownCapabilityError",
    "get_ai_service",
    "get_ai_service_instance",
]
