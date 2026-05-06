"""LLM-driven connector spec generator.

Why LLM-driven: hand-written specs go stale (vendor portals reorganize,
scopes change, deprecations land). Letting Claude write each spec
keeps the docs honest with current vendor reality, and lets us add
~50 connectors in one batch without writing each by hand.

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...    # or ANTON_ANTHROPIC_API_KEY
    python3 server/connectors/_build.py            # generate missing only
    python3 server/connectors/_build.py --force    # overwrite everything
    python3 server/connectors/_build.py --only slack,stripe   # subset

Each TARGET below is a tuple of (id, label, hint, suggested_logo).
The LLM uses gmail.json as a few-shot example and produces a full
DataVaultForm spec following the same shape.

Protected files (gmail, google_drive, google_calendar, hubspot,
posthog, salesforce) are NEVER touched — those were hand-iterated
with the user and should stay editable.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx


OUT_DIR = Path(__file__).resolve().parent
PROTECTED = {"gmail", "google_drive", "google_calendar", "hubspot", "posthog", "salesforce"}

# Defaults — overridable via env. Sonnet is plenty for structured JSON.
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5"
MAX_TOKENS = 8192

# Available icons in the renderer's Ico palette. The LLM MUST pick
# from this list — anything else falls back to `database`.
LOGOS = [
    "search", "chats", "list", "grid", "image", "sidebar", "menu",
    "sun", "moon", "power", "copy", "refresh", "code", "plus",
    "folder", "phone", "clock", "sparkle", "slider", "settings",
    "pin", "mic", "send", "stop", "attach", "download", "check",
    "more", "edit", "trash", "schedule", "doc", "globe", "brain",
    "database", "mail", "upload", "wifi", "key", "mindsdb", "link",
    "cube",
]


# ─── TARGETS ──────────────────────────────────────────────────────────
# (id, label, one-line hint, suggested logo)
# The LLM fills in everything else — aliases, keywords, methods,
# fields, how_to, oauth blocks, help_url. Hints are the minimum the
# LLM needs to disambiguate (e.g. "paste API key, no OAuth needed").

TARGETS: list[tuple[str, str, str, str]] = [
    # ── CRM ──
    ("pipedrive", "Pipedrive",
     "Sales-focused CRM. Auth: paste personal API token + company subdomain.",
     "link"),
    ("close", "Close",
     "Sales-focused CRM with calling/email built in. Auth: paste API key from Settings → API Keys.",
     "link"),
    ("copper", "Copper",
     "CRM tightly integrated with Google Workspace. Auth: paste API key + login email (both required on every request).",
     "link"),
    ("attio", "Attio",
     "Modern flexible CRM with custom objects. Auth: paste Access Token from Settings → Apps & Integrations → Developer.",
     "link"),
    ("folk", "Folk",
     "Relationship-focused CRM. Auth: paste API key from Settings → Developers.",
     "link"),

    # ── Sales engagement ──
    ("outreach", "Outreach",
     "Sales engagement / sequences platform. NO API key path — OAuth 2.0 only (BYOK Outreach app). PKCE-compatible.",
     "send"),
    ("salesloft", "Salesloft",
     "Sales engagement / cadences platform. NO API key path — OAuth 2.0 only (BYOK Salesloft app).",
     "send"),
    ("apollo", "Apollo.io",
     "Outbound prospecting + sequences. Auth: paste API key from Settings → Integrations → API.",
     "send"),
    ("lemlist", "Lemlist",
     "Cold email / outbound platform. Auth: paste API key from team settings.",
     "send"),
    ("reply_io", "Reply.io",
     "Multi-channel sales engagement. Auth: paste API key from Settings → API & Integrations.",
     "send"),
    ("smartlead", "Smartlead",
     "Cold email + deliverability platform. Auth: paste API key from Settings → API.",
     "send"),
    ("instantly", "Instantly",
     "Cold email platform. Auth: paste API key from Integrations → API.",
     "send"),

    # ── Lead enrichment ──
    ("clay", "Clay",
     "Data enrichment + waterfalls platform for outbound. Auth: paste API key from Workspace settings → API keys.",
     "search"),
    ("clearbit", "Clearbit",
     "Person/company enrichment (now HubSpot Breeze Intelligence). Auth: paste secret API key (sk_…) from dashboard.",
     "search"),
    ("zoominfo", "ZoomInfo",
     "B2B contact + intent data. Auth: PKI client credentials (username + password/key) issued by your account admin — NOT self-serve.",
     "search"),
    ("lusha", "Lusha",
     "Contact enrichment for emails + phone numbers. Auth: paste API key from Profile → API Access.",
     "search"),

    # ── Marketing automation / email ──
    ("mailchimp", "Mailchimp",
     "Email marketing / audiences. Auth: paste API key (ends in -usXX datacenter suffix).",
     "mail"),
    ("customer_io", "Customer.io",
     "Lifecycle messaging. Auth: paste Track site ID + Track API key, optionally App API key. Region selector (us|eu).",
     "mail"),
    ("marketo", "Marketo",
     "Adobe Marketo Engage. Auth: Custom Service in LaunchPoint — paste client ID, client secret, REST endpoint URL.",
     "mail"),
    ("iterable", "Iterable",
     "Cross-channel messaging. Auth: paste server-side API key from Integrations → API Keys.",
     "mail"),
    ("braze", "Braze",
     "Customer engagement / messaging platform. Auth: paste REST API key + REST endpoint URL (per-instance).",
     "mail"),
    ("klaviyo", "Klaviyo",
     "Ecommerce email + SMS marketing. Auth: paste Private API key (pk_…). Site ID is for client-side ingestion only — don't use that.",
     "mail"),

    # ── Product analytics ──
    ("amplitude", "Amplitude",
     "Product analytics — events, funnels, retention. Auth: paste project API key + secret key. Region selector (us|eu).",
     "sparkle"),
    ("mixpanel", "Mixpanel",
     "Product analytics. Auth: paste service-account username + secret + project ID. Region selector (us|eu).",
     "sparkle"),
    ("heap", "Heap",
     "Product analytics with autocapture. Auth: paste app ID + server-side API key.",
     "sparkle"),
    ("google_analytics_4", "Google Analytics 4",
     "Web/app analytics from Google. Auth: OAuth 2.0 (BYOK Google Cloud client). Same Google OAuth block as Drive/Calendar — auth_url=https://accounts.google.com/o/oauth2/v2/auth, token_url=https://oauth2.googleapis.com/token, extra_auth_params={access_type:offline, prompt:consent}. Scopes: analytics.readonly + userinfo.email.",
     "sparkle"),
    ("google_search_console", "Google Search Console",
     "SEO performance data from Google. Auth: OAuth 2.0 (BYOK Google Cloud client). Same Google OAuth block as Drive. Scopes: webmasters.readonly + userinfo.email.",
     "search"),
    ("plausible", "Plausible",
     "Privacy-friendly web analytics. Auth: paste API key from User Settings → API Keys + site ID (the domain).",
     "sparkle"),
    ("fathom", "Fathom",
     "Privacy-friendly web analytics. Auth: paste API key + 8-char site ID (from the dashboard URL).",
     "sparkle"),

    # ── Ads ──
    ("google_ads", "Google Ads",
     "Search/display ad campaigns. Auth: OAuth 2.0 (BYOK Google Cloud client) PLUS a developer token from Google Ads MCC. Both required. Scopes: adwords + userinfo.email. Optional login_customer_id for MCC manager accounts.",
     "sparkle"),
    ("linkedin_ads", "LinkedIn Ads",
     "B2B ads (Campaign Manager). Auth: OAuth 2.0, BYOK app from LinkedIn Developer Portal — requires Marketing Developer Platform approval. auth_url=https://www.linkedin.com/oauth/v2/authorization, token_url=https://www.linkedin.com/oauth/v2/accessToken. Scopes: r_ads, r_ads_reporting, rw_ads.",
     "sparkle"),
    ("meta_ads", "Meta Ads",
     "Facebook + Instagram ads. Auth: OAuth 2.0, BYOK app from Meta for Developers (Marketing API). auth_url=https://www.facebook.com/v19.0/dialog/oauth, token_url=https://graph.facebook.com/v19.0/oauth/access_token. Scopes: ads_read, ads_management, business_management.",
     "sparkle"),

    # ── Customer support ──
    ("intercom", "Intercom",
     "Messaging / customer support / help center. Auth: paste Access Token from Developer Hub → app → Authentication. Region selector (us|eu|au).",
     "chats"),
    ("zendesk", "Zendesk",
     "Tickets / help desk. Auth: paste API token + login email + subdomain. Token from Admin Center → Apps and integrations → APIs → Zendesk API.",
     "chats"),
    ("freshdesk", "Freshdesk",
     "Tickets / help desk. Auth: paste API key + subdomain (uses HTTP basic with key as username).",
     "chats"),
    ("helpscout", "Help Scout",
     "Shared inbox / help desk. Auth: OAuth2 client credentials — paste App ID + App Secret (no browser flow needed for client_credentials grant).",
     "chats"),
    ("front", "Front",
     "Shared inbox / customer comms. Auth: paste API token from Settings → Developers → API tokens.",
     "chats"),

    # ── Customer success ──
    ("gainsight", "Gainsight",
     "Customer success / health scoring. Auth: paste Access Key from Administration → Connectors 2.0 → Auth → Access Keys, plus your tenant URL.",
     "check"),
    ("vitally", "Vitally",
     "Customer success / playbooks. Auth: paste API key + subdomain.",
     "check"),
    ("churnzero", "ChurnZero",
     "Customer success / engagement scoring. Auth: paste two paired keys — API key + AppKey (different panels in admin).",
     "check"),

    # ── Revenue intelligence ──
    ("gong", "Gong",
     "Call recording + revenue intel. Auth: paste Access Key + Access Key Secret from Company Settings → Ecosystem → API. Secret shown once.",
     "mic"),
    ("chorus_ai", "Chorus.ai",
     "Call recording + revenue intel (now ZoomInfo Chorus). Auth: paste API key from Settings → Integrations → API.",
     "mic"),
    ("clari", "Clari",
     "Forecasting + pipeline intel. Auth: paste API key from Settings → Integrations → API + tenant slug. Often admin/CSM-gated.",
     "sparkle"),

    # ── Communication ──
    ("slack", "Slack",
     "Workspace messaging. Auth: paste Bot User OAuth Token (xoxb-…) from a Slack app installed in your workspace. Recommend bot-token over OAuth flow for desktop simplicity.",
     "chats"),
    ("microsoft_teams", "Microsoft Teams",
     "Microsoft messaging / collab. Auth: OAuth 2.0 against Microsoft Identity (BYOK app from Azure AD / Entra ID). auth_url=https://login.microsoftonline.com/common/oauth2/v2.0/authorize, token_url=https://login.microsoftonline.com/common/oauth2/v2.0/token. Scopes: Chat.ReadWrite, ChannelMessage.Send, Team.ReadBasic.All, User.Read, offline_access.",
     "chats"),
    ("discord", "Discord",
     "Community / server messaging. Auth: paste Bot Token from Discord Developer Portal → app → Bot. Bot must be invited to server via OAuth2 URL Generator.",
     "chats"),

    # ── Data warehouse ──
    ("snowflake", "Snowflake",
     "Cloud data warehouse. Auth: paste user + password + account identifier (looks like abc12345.us-east-1). Optional default warehouse / database / schema / role. Note: key-pair auth not yet supported — request if needed.",
     "database"),
    ("bigquery", "BigQuery",
     "Google Cloud data warehouse. Auth: paste service-account JSON key (textarea, secret) + project ID. Same shape as Drive/Calendar service-account method.",
     "database"),
    ("redshift", "Redshift",
     "AWS data warehouse. Auth: paste host (cluster endpoint), port (default 5439), database, user, password. IAM auth not yet supported.",
     "database"),
    ("databricks", "Databricks",
     "Lakehouse / SQL warehouses. Auth: paste workspace URL + personal access token (dapi…) + SQL warehouse HTTP path.",
     "database"),

    # ── Reverse ETL / CDP ──
    ("segment", "Segment",
     "Customer data platform / event ingestion. Auth: paste source Write Key (required) + workspace access token (optional, for Public API).",
     "database"),
    ("hightouch", "Hightouch",
     "Reverse ETL / data activation. Auth: paste API token from Workspace settings → API tokens.",
     "database"),
    ("census", "Census",
     "Reverse ETL. Auth: paste API key from Settings → API.",
     "database"),
    ("rudderstack", "RudderStack",
     "Open-source CDP / event ingestion. Auth: paste source Write Key + Data Plane URL.",
     "database"),

    # ── Scheduling ──
    ("calendly", "Calendly",
     "Meeting scheduling. Auth: paste Personal Access Token from Integrations → API & Webhooks.",
     "schedule"),
    ("chili_piper", "Chili Piper",
     "Inbound meeting routing + booking. Auth: paste API key from Admin → API.",
     "schedule"),

    # ── Forms ──
    ("typeform", "Typeform",
     "Forms + surveys. Auth: paste personal access token (tfp_…) from Settings → Personal tokens.",
     "doc"),

    # ── Documents / contracts ──
    ("docusign", "DocuSign",
     "E-signature. Auth: OAuth 2.0 BYOK (Integration Key from DocuSign Admin → Apps and Keys). auth_url=https://account.docusign.com/oauth/auth, token_url=https://account.docusign.com/oauth/token. Scopes: signature, extended. Note demo vs production hostnames differ.",
     "doc"),
    ("pandadoc", "PandaDoc",
     "Document workflow + e-signature. Auth: paste API key from Settings → API and integrations. Simpler than OAuth flow, recommend that.",
     "doc"),

    # ── Billing ──
    ("stripe", "Stripe",
     "Payments + subscriptions. Auth: paste a RESTRICTED key (rk_live_… or rk_test_…) — NOT a secret key. Restricted keys can be scoped to specific resources/permissions.",
     "key"),
    ("chargebee", "Chargebee",
     "Subscription billing. Auth: paste API key (live_…) + site name (subdomain).",
     "key"),
    ("recurly", "Recurly",
     "Subscription billing. Auth: paste private API key from Integrations → API Credentials.",
     "key"),
    ("quickbooks", "QuickBooks Online",
     "Accounting. Auth: OAuth 2.0 BYOK (app from Intuit Developer). auth_url=https://appcenter.intuit.com/connect/oauth2, token_url=https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer. Scope: com.intuit.quickbooks.accounting.",
     "key"),
]


# ─── Prompt assembly ──────────────────────────────────────────────────


def build_prompt(target_id: str, label: str, hint: str, suggested_logo: str, example: str) -> tuple[str, str]:
    """Returns (system_prompt, user_message)."""
    system = f"""You are generating connector spec JSON files for an Electron desktop app called Anton.

The app shows a connector picker; clicking a connector opens a form. The form spec is a JSON
object the renderer (DataVaultForm.jsx) consumes directly. Your job: produce one such JSON
object for a given connector.

# Schema

```
{{
  "id": "<slug>",                         // matches the filename
  "label": "<Display Name>",
  "aliases": ["<alt name>", ...],         // for fuzzy matching
  "keywords": ["<word>", ...],            // for token-overlap scoring
  "description": "<one sentence>",
  "category": "<one of: crm | sales-engagement | enrichment | marketing | analytics | ads | support | customer-success | revenue-intel | communication | data-warehouse | data | scheduling | forms | documents | billing | productivity | files | other>",
  "logo": "<one of the icon names from LOGOS list below>",
  "logo_color": "<hex like #FF7A59>",
  "form": {{
    "form_id": "<slug>-connector",
    "title": "Connect <Label>",
    "subtitle": "<one sentence>",
    "logo": "<same as top-level logo>",
    "logo_color": "<same hex>",
    "methods": [
      {{
        "id": "<method-id-kebab>",
        "label": "<Method Display Name>",
        "description": "<1-2 sentences shown on the picker card>",
        "recommended": <true|false>,       // exactly one method should be recommended
        "how_to": "<markdown setup walkthrough — multi-line, ## headings ok>",
        "help_url": "<external help URL>",

        // For OAuth methods only:
        "submit_action": "oauth_launch",
        "oauth": {{
          "auth_url": "<authorization URL>",
          "token_url": "<token endpoint>",
          "scopes": ["..."],
          "extra_auth_params": {{...}}      // optional
        }},

        // Always:
        "fields": [
          {{
            "name": "<field-name-snake>",
            "label": "<Field Label>",
            "type": "text" | "password" | "url" | "select" | "textarea" | "boolean",
            "required": true | false,
            "secret": true,                  // for password/textarea fields holding credentials
            "placeholder": "<hint>",
            "default": "<default value>",
            "description": "<helper text under the input>",
            "options": [{{"value": "...", "label": "..."}}]   // for select only
          }}
        ]
      }}
    ]
  }}
}}
```

# Available logo names (pick the closest semantic match)

{', '.join(LOGOS)}

# Recommended-method rule (CRITICAL)

Exactly one method has `"recommended": true`. The recommended method MUST be the SIMPLEST
copy-paste path the user can take. OAuth is recommended ONLY when there's no simpler path
(no API key, no personal access token, no app password). Paste-an-API-key always beats OAuth
when both exist.

# how_to writing rules

- Markdown. Use `## Section` headings.
- Numbered steps for the setup walkthrough.
- Tell the user EXACTLY where in the vendor UI to click (Settings → X → Y).
- Mention any gotchas (token shown once, region differences, scopes that matter, prereqs).
- Keep it tight: 5-15 lines per method. Not an essay.
- Don't include code blocks unless absolutely necessary.

# OAuth flow notes

- All OAuth methods include `"submit_action": "oauth_launch"` and an `"oauth"` block.
- Pattern A (hosted client) means the spec ships a `client_id` baked in — don't do that here, we don't ship hosted clients yet.
- Pattern B (BYOK) means the user fills in `client_id` + `client_secret` fields. Always include those two fields for OAuth methods (text + password types).
- For Google services: extra_auth_params={{"access_type": "offline", "prompt": "consent"}} so refresh tokens issue.

# Field shape quick reference

- `text`: single-line text input
- `password`: masked, always set `"secret": true`
- `url`: validated URL input
- `select`: dropdown — must include `options[]`
- `textarea`: multi-line (e.g. JSON keys); set `"secret": true` for credential pastes
- `boolean`: checkbox

# Output requirements

- Output ONE JSON object. NO markdown code fence, NO surrounding prose. Just `{{` to `}}`.
- All required-field values present. No null/undefined.
- Field names in `snake_case`, method ids in `kebab-case`.
- Help URLs must be plausible canonical vendor docs URLs.

# Example: Gmail connector

{example}
"""

    user = f"""Generate the connector JSON for:

- **id**: {target_id}
- **label**: {label}
- **suggested logo**: {suggested_logo}
- **hint**: {hint}

Use the hint to drive the methods + auth fields. Apply the recommended-method rule
strictly. Output JSON only.
"""
    return system, user


# ─── LLM client (Anthropic or OpenAI-compatible) ─────────────────────


def _load_dotenv_once():
    """Pull values from ~/.anton/.env if env vars aren't already set —
    that's where the desktop app stores them, so the generator inherits
    the same provider config Anton itself uses."""
    candidates = [
        Path.home() / ".anton" / ".env",
        OUT_DIR.parents[2] / ".env",
    ]
    for p in candidates:
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


def make_client():
    """Returns a callable `(system, user) -> str` that hits whichever
    provider is configured. Prefers Anthropic if an API key is present;
    falls back to the OpenAI-compatible endpoint Anton uses (which on
    this machine is a MindsDB proxy)."""
    _load_dotenv_once()

    # ── Anthropic native ──
    a_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTON_ANTHROPIC_API_KEY")
    if a_key:
        model = os.environ.get("ANTON_PLANNING_MODEL", DEFAULT_ANTHROPIC_MODEL)
        # Sanity: only forward to Anthropic if the model name looks like a Claude model.
        if not model.startswith("claude"):
            model = DEFAULT_ANTHROPIC_MODEL
        print(f"[provider] Anthropic ({model})")
        return _anthropic_caller(a_key, model)

    # ── OpenAI-compatible (Anton's existing config — likely MindsDB) ──
    o_key = os.environ.get("ANTON_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    o_base = os.environ.get("ANTON_OPENAI_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
    o_model = os.environ.get("ANTON_PLANNING_MODEL") or os.environ.get("OPENAI_MODEL")
    if o_key and o_base and o_model:
        print(f"[provider] OpenAI-compatible ({o_model} @ {o_base})")
        return _openai_caller(o_key, o_base.rstrip("/"), o_model)

    raise SystemExit(
        "No provider configured. Either set ANTHROPIC_API_KEY, or set "
        "ANTON_OPENAI_API_KEY + ANTON_OPENAI_BASE_URL + ANTON_PLANNING_MODEL "
        "in your environment or ~/.anton/.env."
    )


def _anthropic_caller(api_key: str, model: str):
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    def call(system: str, user: str, retries: int = 2) -> str:
        body = {
            "model": model,
            "max_tokens": MAX_TOKENS,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        last_err = None
        for attempt in range(retries + 1):
            try:
                with httpx.Client(timeout=180.0) as client:
                    r = client.post("https://api.anthropic.com/v1/messages",
                                    headers=headers, json=body)
                if r.status_code == 200:
                    payload = r.json()
                    parts = [b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text"]
                    return "".join(parts).strip()
                if r.status_code in (429, 529, 500, 502, 503, 504):
                    last_err = f"HTTP {r.status_code}: {r.text[:200]}"
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"Anthropic API error {r.status_code}: {r.text[:500]}")
            except httpx.RequestError as e:
                last_err = str(e)
                time.sleep(2 ** attempt)
        raise RuntimeError(f"Anthropic call failed: {last_err}")

    return call


def _openai_caller(api_key: str, base_url: str, model: str):
    """Hits the OpenAI Chat Completions API (or any compatible proxy
    like MindsDB)."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "content-type": "application/json",
    }

    def call(system: str, user: str, retries: int = 2) -> str:
        body = {
            "model": model,
            "max_tokens": MAX_TOKENS,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            # `response_format: json_object` is supported by OpenAI and
            # most compatibles. If a proxy ignores it, the system
            # prompt's "JSON only" instruction still steers the output.
            "response_format": {"type": "json_object"},
        }
        last_err = None
        for attempt in range(retries + 1):
            try:
                with httpx.Client(timeout=180.0) as client:
                    r = client.post(f"{base_url}/chat/completions",
                                    headers=headers, json=body)
                if r.status_code == 200:
                    payload = r.json()
                    choices = payload.get("choices") or []
                    if not choices:
                        raise RuntimeError(f"No choices in OpenAI response: {payload}")
                    return (choices[0].get("message") or {}).get("content", "").strip()
                if r.status_code in (429, 500, 502, 503, 504):
                    last_err = f"HTTP {r.status_code}: {r.text[:200]}"
                    time.sleep(2 ** attempt)
                    continue
                # Some proxies reject response_format — drop it and retry once.
                if r.status_code == 400 and "response_format" in r.text and "response_format" in body:
                    body.pop("response_format", None)
                    continue
                raise RuntimeError(f"OpenAI API error {r.status_code}: {r.text[:500]}")
            except httpx.RequestError as e:
                last_err = str(e)
                time.sleep(2 ** attempt)
        raise RuntimeError(f"OpenAI call failed: {last_err}")

    return call


# ─── Validation ───────────────────────────────────────────────────────


def parse_and_validate(text: str, expected_id: str) -> dict:
    """Parse JSON. Strip any accidental markdown fences. Validate the
    minimum shape the registry expects. Raise on failure with a
    description the LLM can use to retry."""
    cleaned = text.strip()
    # Defensive — sometimes models still emit a fence despite instructions.
    if cleaned.startswith("```"):
        # Drop first line and last fence.
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    try:
        spec = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"Output is not valid JSON: {e}") from e

    # Required top-level keys
    for key in ("id", "label", "category", "logo", "logo_color", "form"):
        if key not in spec:
            raise ValueError(f"Missing top-level key: `{key}`")
    if spec["id"] != expected_id:
        raise ValueError(f"id mismatch: expected `{expected_id}`, got `{spec['id']}`")
    if spec["logo"] not in LOGOS:
        raise ValueError(f"logo `{spec['logo']}` is not in the allowed palette ({len(LOGOS)} options)")

    form = spec["form"]
    for key in ("form_id", "title", "methods"):
        if key not in form:
            raise ValueError(f"form missing key: `{key}`")
    methods = form["methods"]
    if not isinstance(methods, list) or not methods:
        raise ValueError("form.methods must be a non-empty list")

    recommended_count = 0
    for m in methods:
        if not isinstance(m, dict):
            raise ValueError("each method must be an object")
        for key in ("id", "label", "fields"):
            if key not in m:
                raise ValueError(f"method `{m.get('id', '?')}` missing key: `{key}`")
        if m.get("recommended"):
            recommended_count += 1
        if m.get("submit_action") == "oauth_launch":
            o = m.get("oauth")
            if not isinstance(o, dict):
                raise ValueError(f"method `{m['id']}` has submit_action=oauth_launch but no oauth block")
            for ok in ("auth_url", "token_url", "scopes"):
                if ok not in o:
                    raise ValueError(f"method `{m['id']}` oauth block missing `{ok}`")
    if recommended_count != 1:
        raise ValueError(f"exactly one method must have recommended:true (found {recommended_count})")

    return spec


# ─── Main ─────────────────────────────────────────────────────────────


def load_example_gmail() -> str:
    return (OUT_DIR / "gmail.json").read_text(encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true",
                        help="Overwrite existing JSON files. Protected files are still skipped.")
    parser.add_argument("--only", default="",
                        help="Comma-separated list of connector IDs to generate (default: all).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Skip the LLM call; just print which targets would be processed.")
    args = parser.parse_args()

    only = {s.strip() for s in args.only.split(",") if s.strip()} if args.only else None

    targets = [t for t in TARGETS if (only is None or t[0] in only)]
    if not targets:
        print("No targets match.")
        return

    if args.dry_run:
        for tid, label, _, logo in targets:
            existing = (OUT_DIR / f"{tid}.json").exists()
            tag = "PROTECTED" if tid in PROTECTED else ("EXISTS" if existing else "NEW")
            print(f"  [{tag:9s}] {tid:24s} {label}  ({logo})")
        return

    call = make_client()
    example = load_example_gmail()

    written, skipped, failed = 0, 0, 0
    for tid, label, hint, logo in targets:
        path = OUT_DIR / f"{tid}.json"
        if tid in PROTECTED:
            print(f"  [protected]  skip {tid}")
            skipped += 1
            continue
        if path.exists() and not args.force:
            print(f"  [exists]     skip {tid} (use --force to overwrite)")
            skipped += 1
            continue

        system, user = build_prompt(tid, label, hint, logo, example)

        last_error = None
        spec = None
        for attempt in range(2):
            try:
                t0 = time.monotonic()
                raw = call(system, user)
                dt = time.monotonic() - t0
                spec = parse_and_validate(raw, tid)
                print(f"  [ok]         {tid:24s} {label}  ({dt:.1f}s)")
                break
            except ValueError as e:
                last_error = str(e)
                # Re-prompt with the validation error appended so the
                # LLM can self-correct on attempt 2.
                user = (
                    f"Generate the connector JSON for:\n\n"
                    f"- **id**: {tid}\n- **label**: {label}\n- **suggested logo**: {logo}\n- **hint**: {hint}\n\n"
                    f"Your previous attempt failed validation: {last_error}\n"
                    f"Output JSON only. Apply the recommended-method rule strictly."
                )
                continue

        if spec is None:
            print(f"  [FAIL]       {tid:24s} {last_error}", file=sys.stderr)
            failed += 1
            continue

        path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
        written += 1

    print()
    print(f"summary: {written} written, {skipped} skipped, {failed} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
