"""Unit tests for sieve-service L2 classifier.

These tests always use the heuristic path (_use_model=False) so no ML model
download is needed. The heuristic fallback covers 100% of production cases
when transformers is unavailable.
"""
import sys
import types
import importlib
import pytest
from fastapi.testclient import TestClient


def _load_app_without_model():
    """Load main.py with _use_model forced to False (no transformers needed)."""
    # Create a stub transformers module so the import doesn't fail
    if "transformers" not in sys.modules:
        stub = types.ModuleType("transformers")
        stub.pipeline = None  # type: ignore
        sys.modules["transformers"] = stub

    # Force reload so module-level _use_model is re-evaluated as False
    if "main" in sys.modules:
        del sys.modules["main"]

    import main as m

    m._use_model = False
    m._classifier = None
    return m.app


@pytest.fixture(scope="module")
def client():
    app = _load_app_without_model()
    return TestClient(app)


# ── /health ───────────────────────────────────────────────────────────────────

def test_health(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


# ── /classify — urgent heuristic ─────────────────────────────────────────────

@pytest.mark.parametrize("subject", [
    "URGENT: server is down",
    "IMPORTANT: please review",
    "ACTION REQUIRED: renew your subscription",
    "ASAP - need your sign off",
])
def test_classify_urgent(client: TestClient, subject: str):
    resp = client.post("/classify", json={"subject": subject, "sender_domain": "corp.com", "sender_local": "cto"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["label"] == "urgent"
    assert body["priority"] is True
    assert body["score"] > 0.0


# ── /classify — newsletter heuristic ─────────────────────────────────────────

@pytest.mark.parametrize("sender_local", [
    "newsletter",
    "noreply",
    "no-reply",
    "mailer",
    "digest",
    "updates",
    "notifications",
    "marketing",
    "promotions",
    "info",
    "hello",
    "support",
    "news",
    "weekly",
    "monthly",
])
def test_classify_newsletter_local(client: TestClient, sender_local: str):
    resp = client.post("/classify", json={
        "subject": "Latest from us",
        "sender_domain": "company.com",
        "sender_local": sender_local,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["label"] == "newsletter"
    assert body["priority"] is False


# ── /classify — normal emails ─────────────────────────────────────────────────

@pytest.mark.parametrize("subject,sender_local", [
    ("Meeting tomorrow at 10am", "john"),
    ("Your order has shipped", "orders"),
    ("Re: project proposal", "alice"),
    ("Invoice #12345 attached", "billing"),
])
def test_classify_normal(client: TestClient, subject: str, sender_local: str):
    resp = client.post("/classify", json={
        "subject": subject,
        "sender_domain": "example.com",
        "sender_local": sender_local,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["label"] == "normal"
    assert body["priority"] is False


# ── /classify — urgent takes precedence over newsletter sender ────────────────

def test_urgent_beats_newsletter_sender(client: TestClient):
    """URGENT subject should win even if sender looks like a newsletter."""
    resp = client.post("/classify", json={
        "subject": "URGENT: account suspended",
        "sender_domain": "corp.com",
        "sender_local": "noreply",
    })
    assert resp.status_code == 200
    assert resp.json()["label"] == "urgent"


# ── /classify — response schema ───────────────────────────────────────────────

def test_response_schema_fields(client: TestClient):
    resp = client.post("/classify", json={"subject": "Hi", "sender_domain": "x.com", "sender_local": "bob"})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"label", "score", "priority"}
    assert body["label"] in ("urgent", "newsletter", "spam", "normal")
    assert isinstance(body["score"], float)
    assert isinstance(body["priority"], bool)


# ── /classify — score ranges ──────────────────────────────────────────────────

def test_score_in_valid_range(client: TestClient):
    for subject, local in [("URGENT: act now", "cto"), ("newsletter", "news"), ("Hello", "john")]:
        resp = client.post("/classify", json={"subject": subject, "sender_domain": "x.com", "sender_local": local})
        body = resp.json()
        assert 0.0 <= body["score"] <= 1.0, f"score out of range for subject={subject!r}"


# ── /classify — missing fields → 422 ─────────────────────────────────────────

def test_missing_subject_field(client: TestClient):
    resp = client.post("/classify", json={"sender_domain": "x.com", "sender_local": "bob"})
    assert resp.status_code == 422


def test_empty_body(client: TestClient):
    resp = client.post("/classify", json={})
    assert resp.status_code == 422
