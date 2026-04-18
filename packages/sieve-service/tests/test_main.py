"""Unit tests for sieve-service classifier — Phase 0 + Phase 1."""
import sys
import types
import pytest
from fastapi.testclient import TestClient


def _load_app():
    if "transformers" not in sys.modules:
        stub = types.ModuleType("transformers")
        stub.pipeline = None  # type: ignore
        sys.modules["transformers"] = stub
    if "main" in sys.modules:
        del sys.modules["main"]
    import main as m
    return m.app


@pytest.fixture(scope="module")
def client():
    return TestClient(_load_app())


# ── /health ───────────────────────────────────────────────────────────────────

def test_health(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


# ── Base: urgent ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("subject", [
    "URGENT: server is down",
    "IMPORTANT: please review",
    "ACTION REQUIRED: renew your subscription",
    "ASAP - need your sign off",
])
def test_classify_urgent(client: TestClient, subject: str):
    resp = client.post("/classify", json={
        "subject": subject,
        "sender_domain": "corp.com",
        "sender_local": "cto",
        "spf_pass": True,
        "dkim_pass": True,
        "dmarc_pass": True,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["label"] == "urgent"
    assert body["priority"] is True


# ── Base: newsletter ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("sender_local", [
    "newsletter", "noreply", "no-reply", "mailer", "digest",
    "updates", "notifications", "marketing", "promotions",
    "info", "hello", "support", "news", "weekly", "monthly",
])
def test_classify_newsletter_local(client: TestClient, sender_local: str):
    resp = client.post("/classify", json={
        "subject": "Latest from us",
        "sender_domain": "company.com",
        "sender_local": sender_local,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["label"] in ("newsletter", "spam")
    assert body["priority"] is False


# ── Base: normal ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("subject,sender_local", [
    ("Meeting tomorrow at 10am", "john"),
    ("Re: project proposal", "alice"),
])
def test_classify_normal(client: TestClient, subject: str, sender_local: str):
    resp = client.post("/classify", json={
        "subject": subject,
        "sender_domain": "example.com",
        "sender_local": sender_local,
    })
    assert resp.status_code == 200
    assert resp.json()["label"] == "normal"


# ── Base: urgent beats newsletter sender ─────────────────────────────────────

def test_urgent_beats_newsletter_sender(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "URGENT: account suspended",
        "sender_domain": "corp.com",
        "sender_local": "noreply",
        "spf_pass": True,
        "dkim_pass": True,
        "dmarc_pass": True,
    })
    assert resp.status_code == 200
    # With clean auth, urgent should win over newsletter-local heuristic
    assert resp.json()["label"] == "urgent"


# ── Base: response schema ─────────────────────────────────────────────────────

def test_response_schema_fields(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Hi", "sender_domain": "x.com", "sender_local": "bob"
    })
    assert resp.status_code == 200
    body = resp.json()
    assert {"label", "score", "priority", "security_flags", "threat_level"}.issubset(body.keys())
    assert isinstance(body["security_flags"], list)
    assert body["threat_level"] in ("none", "low", "medium", "high")


def test_score_in_valid_range(client: TestClient):
    for subject, local in [("URGENT: act now", "cto"), ("Hello", "john")]:
        resp = client.post("/classify", json={
            "subject": subject, "sender_domain": "x.com", "sender_local": local
        })
        assert 0.0 <= resp.json()["score"] <= 1.0


# ── Phase 0A: Malware attachment detection ────────────────────────────────────

def test_dangerous_exe_attachment(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Please review",
        "sender_domain": "example.com",
        "sender_local": "contact",
        "attachments": [{"filename": "invoice.exe", "sha256": "abc123"}],
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["label"] == "malware_attachment"
    assert body["threat_level"] == "high"
    assert any("dangerous_extension:" in f for f in body["security_flags"])


def test_double_extension_attack(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Document attached",
        "sender_domain": "example.com",
        "sender_local": "sender",
        "attachments": [{"filename": "document.pdf.exe"}],
    })
    body = resp.json()
    assert body["label"] == "malware_attachment"
    assert any("double_extension:" in f for f in body["security_flags"])


@pytest.mark.parametrize("filename", ["report.bat", "setup.msi", "script.vbs", "run.cmd"])
def test_other_dangerous_extensions(client: TestClient, filename: str):
    resp = client.post("/classify", json={
        "subject": "FYI",
        "sender_domain": "example.com",
        "sender_local": "user",
        "attachments": [{"filename": filename}],
    })
    assert resp.json()["label"] == "malware_attachment"


def test_safe_attachment_not_flagged(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Contract attached",
        "sender_domain": "partner.com",
        "sender_local": "legal",
        "attachments": [{"filename": "contract.pdf"}],
    })
    assert resp.json()["label"] not in ("malware_attachment", "phishing_suspect")


def test_macro_capable_flagged_not_malware(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Report Q1",
        "sender_domain": "partner.com",
        "sender_local": "reports",
        "attachments": [{"filename": "report.docm"}],
    })
    body = resp.json()
    # macro_capable is a warning flag but not a hard block
    assert body["label"] != "malware_attachment"
    assert any("macro_capable:" in f for f in body["security_flags"])


# ── Phase 0B: Phishing detection ─────────────────────────────────────────────

def test_phishing_multiple_auth_failures(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Verify your account",
        "sender_domain": "evil-domain.net",
        "sender_local": "security",
        "spf_pass": False,
        "dkim_pass": False,
        "dmarc_pass": False,
    })
    body = resp.json()
    assert body["label"] == "phishing_suspect"
    assert body["threat_level"] in ("medium", "high")
    assert "auth_failure_multiple" in body["security_flags"]


def test_phishing_brand_spoofing(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Your PayPal account is limited",
        "sender_domain": "random-domain.com",
        "sender_local": "paypal-security",
        "sender_display_name": "PayPal Security Team",
        "spf_pass": False,
        "dkim_pass": False,
    })
    body = resp.json()
    assert body["label"] in ("phishing_suspect", "fraud_suspect")
    assert any("brand_spoofing:" in f for f in body["security_flags"])


def test_phishing_keywords_plus_auth_failure(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Security Alert: Confirm your identity immediately",
        "sender_domain": "spoofed.net",
        "sender_local": "support",
        "spf_pass": False,
        "dkim_pass": True,
        "dmarc_pass": False,
    })
    body = resp.json()
    assert body["label"] in ("phishing_suspect", "fraud_suspect", "spam")


def test_legitimate_urgent_clean_auth(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "URGENT: Production outage",
        "sender_domain": "mycompany.com",
        "sender_local": "devops",
        "spf_pass": True,
        "dkim_pass": True,
        "dmarc_pass": True,
    })
    body = resp.json()
    assert body["label"] == "urgent"
    assert body["priority"] is True
    assert body["threat_level"] == "none"


# ── Phase 1: Spam with auth signals ──────────────────────────────────────────

def test_newsletter_with_unsubscribe_body(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Weekly digest",
        "sender_domain": "news.com",
        "sender_local": "newsletter",
        "body_preview": "Top stories this week... click here to unsubscribe",
    })
    assert resp.json()["label"] == "newsletter"


# ── Phase 2: Informational classification ────────────────────────────────────

def test_informational_noreply_sender(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Your order has shipped",
        "sender_domain": "shop.com",
        "sender_local": "noreply",
        "spf_pass": True,
        "dkim_pass": True,
    })
    # noreply with clean auth → newsletter or informational, not normal
    assert resp.json()["label"] in ("newsletter", "informational")


def test_informational_receipts_sender(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Your receipt #12345",
        "sender_domain": "stripe.com",
        "sender_local": "receipts",
        "spf_pass": True,
        "dkim_pass": True,
    })
    assert resp.json()["label"] == "informational"


# ── Edge cases ────────────────────────────────────────────────────────────────

def test_missing_subject_field(client: TestClient):
    resp = client.post("/classify", json={"sender_domain": "x.com", "sender_local": "bob"})
    assert resp.status_code == 422


def test_empty_attachments_list(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Hello",
        "sender_domain": "x.com",
        "sender_local": "friend",
        "attachments": [],
    })
    assert resp.status_code == 200
    assert resp.json()["label"] == "normal"


def test_no_security_flags_for_clean_email(client: TestClient):
    resp = client.post("/classify", json={
        "subject": "Let's sync tomorrow",
        "sender_domain": "colleague.com",
        "sender_local": "jane",
        "spf_pass": True,
        "dkim_pass": True,
        "dmarc_pass": True,
    })
    body = resp.json()
    assert body["security_flags"] == []
    assert body["threat_level"] == "none"
