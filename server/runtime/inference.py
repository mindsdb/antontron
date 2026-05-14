"""Cowork-owned inference profile resolution."""

from __future__ import annotations

from typing import Any

from .schemas import ResolvedInferenceProfile


def _provider_capabilities(provider_type: str) -> dict[str, bool]:
    base = {
        "streaming": True,
        "tool_calling": True,
        "json_schema": False,
        "vision": False,
        "long_context": False,
    }
    if provider_type in {"minds-cloud", "openai", "openai-compatible", "gemini"}:
        base.update({"json_schema": True, "vision": provider_type in {"openai", "gemini"}})
    if provider_type == "anthropic":
        base.update({"vision": True, "long_context": True})
    return base


def _api_key_ref_for(provider_type: str) -> str:
    if provider_type == "anthropic":
        return "ANTON_ANTHROPIC_API_KEY"
    if provider_type == "minds-cloud":
        return "ANTON_MINDS_API_KEY"
    if provider_type in {"openai", "gemini", "openai-compatible"}:
        return "ANTON_OPENAI_API_KEY"
    return ""


def _provider_label(settings_route: Any, provider_type: str) -> str:
    return settings_route.PROVIDER_TYPE_LABELS.get(provider_type, provider_type or "Unknown")


def resolve_inference_profile() -> ResolvedInferenceProfile:
    """Resolve the active Cowork inference profile from Settings state.

    This intentionally centralizes provider/model choice in Cowork. Harness
    adapters receive this object and translate it into their native config.
    """
    from routes import settings as settings_route

    providers = settings_route._load_providers()
    model_cfg = settings_route._load_model_config()
    default_provider = settings_route._default_provider(providers)
    planning_provider, planning_model = settings_route._resolve_role(
        providers,
        model_cfg["modelMode"],
        model_cfg["modelOverrides"],
        "planning",
        default_provider,
    )
    coding_provider, coding_model = settings_route._resolve_role(
        providers,
        model_cfg["modelMode"],
        model_cfg["modelOverrides"],
        "coding",
        default_provider,
    )
    planning_provider = planning_provider or default_provider or {}
    coding_provider = coding_provider or planning_provider
    provider_type = str(planning_provider.get("type") or "unknown")
    coding_provider_type = str(coding_provider.get("type") or provider_type)
    label = _provider_label(settings_route, provider_type)
    coding_label = _provider_label(settings_route, coding_provider_type)
    base_url = settings_route._base_url_for(planning_provider) if planning_provider else ""
    coding_base_url = settings_route._base_url_for(coding_provider) if coding_provider else base_url
    api_key_ref = _api_key_ref_for(provider_type)
    coding_api_key_ref = _api_key_ref_for(coding_provider_type)

    return ResolvedInferenceProfile(
        id=f"{provider_type}:{planning_model}:{coding_model}",
        provider_type=provider_type,
        provider_label=label,
        base_url=base_url,
        api_key_ref=api_key_ref,
        planning_provider_type=provider_type,
        planning_provider_label=label,
        planning_base_url=base_url,
        planning_api_key_ref=api_key_ref,
        coding_provider_type=coding_provider_type,
        coding_provider_label=coding_label,
        coding_base_url=coding_base_url,
        coding_api_key_ref=coding_api_key_ref,
        planning_model=planning_model or "",
        coding_model=coding_model or "",
        capabilities={
            **_provider_capabilities(provider_type),
            **{
                f"coding_{key}": value
                for key, value in _provider_capabilities(coding_provider_type).items()
            },
        },
    )


def profile_for_storage(profile: ResolvedInferenceProfile) -> dict[str, Any]:
    return profile.safe_dump()


def validate_inference_profile(profile: ResolvedInferenceProfile) -> tuple[bool, str]:
    if profile.provider_type in {"", "unknown"}:
        return False, "No inference provider is configured."
    if not profile.planning_model:
        return False, "No planning model is configured."
    if profile.provider_type == "openai-compatible" and not profile.base_url:
        return False, "OpenAI-compatible inference requires a base URL."
    if profile.coding_model and profile.coding_provider_type == "openai-compatible" and not profile.coding_base_url:
        return False, "OpenAI-compatible coding inference requires a base URL."
    return True, ""
