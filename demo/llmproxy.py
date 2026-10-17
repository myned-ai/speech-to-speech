"""
LLM passthrough that bills the signed-in visitor.

Single-container deploys point the pipeline's OpenAI-compatible base URL at
this route (LLM_BASE_URL=http://127.0.0.1:7860/llmproxy/v1). Requests are
forwarded verbatim to the real provider (LLM_UPSTREAM_URL, default the HF
router) with the Authorization header swapped to the active visitor's OAuth
token (scope `inference-api`) — so LLM usage bills the visitor's own HF
credits, not the Space owner. s2sproxy registers/clears the active token as
the visitor's realtime socket connects/disconnects; the pool serves one
conversation at a time, so one active token suffices. Without a visitor
token (local dev, warmup at boot) the HF_TOKEN fallback is used.

Other providers: point LLM_UPSTREAM_URL at any OpenAI-compatible server and
set LLM_MODEL; LLM_API_KEY, when set, replaces both tokens above. With no
token at all the request goes out unauthenticated (Ollama, a local vLLM).
"""

import logging
import os

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

logger = logging.getLogger("s2s.llmproxy")

router = APIRouter()

UPSTREAM = os.environ.get("LLM_UPSTREAM_URL", "https://router.huggingface.co/v1").rstrip("/")
# The key for a provider other than HF (OpenAI, a university server, ...).
# When set it's always used, so visitors' HF tokens never reach that provider.
API_KEY = os.environ.get("LLM_API_KEY", "").strip()
FALLBACK_TOKEN = os.environ.get("HF_TOKEN", "").strip()

_active_token: str | None = None


def set_active_token(token: str | None) -> None:
    global _active_token
    _active_token = token or None
    logger.info("active visitor token %s", "set" if _active_token else "cleared")


def clear_active_token() -> None:
    set_active_token(None)


@router.post("/llmproxy/v1/chat/completions")
async def chat_completions(request: Request):
    token = API_KEY or _active_token or FALLBACK_TOKEN
    headers = {"Content-Type": "application/json", "Accept": request.headers.get("accept", "*/*")}
    if token:  # keyless servers (Ollama, a local vLLM) get none
        headers["Authorization"] = f"Bearer {token}"
    body = await request.body()
    client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=15.0))
    upstream_request = client.build_request("POST", f"{UPSTREAM}/chat/completions", content=body, headers=headers)
    upstream = await client.send(upstream_request, stream=True)

    async def relay():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        relay(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type"),
    )
