from __future__ import annotations

import re
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

# ── Optional ML imports ───────────────────────────────────────────────────────
try:
    from transformers import pipeline as hf_pipeline  # type: ignore

    _classifier = hf_pipeline(
        "zero-shot-classification",
        model="typeform/distilbert-base-uncased-mnli",
    )
    _use_model = True
except Exception:
    _classifier = None
    _use_model = False

# ── Heuristic patterns ────────────────────────────────────────────────────────
_URGENT_SUBJECT = re.compile(
    r"\b(URGENT|IMPORTANT|ACTION REQUIRED|ASAP)\b", re.IGNORECASE
)
_NEWSLETTER_LOCAL = re.compile(
    r"^(newsletter|noreply|no-reply|mailer|digest|updates?|notifications?|marketing|promotions?|info|hello|support|news|weekly|monthly)$",
    re.IGNORECASE,
)

Label = Literal["urgent", "newsletter", "spam", "normal"]

_CANDIDATE_LABELS: list[str] = ["urgent", "newsletter", "spam", "normal"]


# ── Request / Response models ─────────────────────────────────────────────────
class ClassifyRequest(BaseModel):
    subject: str
    sender_domain: str
    sender_local: str


class ClassifyResponse(BaseModel):
    label: Label
    score: float
    priority: bool


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Sieve L2 Classifier")


def _heuristic(req: ClassifyRequest) -> ClassifyResponse:
    """Simple rule-based fallback when the ML model is unavailable."""
    if _URGENT_SUBJECT.search(req.subject):
        return ClassifyResponse(label="urgent", score=0.9, priority=True)
    if _NEWSLETTER_LOCAL.match(req.sender_local):
        return ClassifyResponse(label="newsletter", score=0.85, priority=False)
    return ClassifyResponse(label="normal", score=0.7, priority=False)


@app.post("/classify", response_model=ClassifyResponse)
def classify(req: ClassifyRequest) -> ClassifyResponse:
    if _use_model and _classifier is not None:
        try:
            text = f"{req.subject} from {req.sender_local}@{req.sender_domain}"
            result = _classifier(text, _CANDIDATE_LABELS)
            best_label: str = result["labels"][0]
            best_score: float = float(result["scores"][0])
            label = best_label if best_label in ("urgent", "newsletter", "spam", "normal") else "normal"
            priority = label == "urgent" and best_score >= 0.6
            return ClassifyResponse(label=label, score=best_score, priority=priority)  # type: ignore[arg-type]
        except Exception:
            pass  # fall through to heuristic

    return _heuristic(req)


@app.get("/health")
def health() -> dict:
    return {"ok": True}
