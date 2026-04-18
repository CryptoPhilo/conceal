from __future__ import annotations

import re
from typing import Literal, Optional

from fastapi import FastAPI
from pydantic import BaseModel

# ── Dangerous file extension sets ─────────────────────────────────────────────
_DANGEROUS_EXTS = {
    ".exe", ".bat", ".cmd", ".scr", ".vbs", ".js", ".jar", ".msi",
    ".com", ".pif", ".reg", ".wsf", ".hta", ".cpl", ".dll", ".ps1",
}
_MACRO_CAPABLE_EXTS = {".doc", ".docm", ".xls", ".xlsm", ".ppt", ".pptm"}

# ── Regex patterns ────────────────────────────────────────────────────────────
_URGENT_SUBJECT = re.compile(
    r"\b(URGENT|IMPORTANT|ACTION REQUIRED|ASAP)\b", re.IGNORECASE
)
_NEWSLETTER_LOCAL = re.compile(
    r"^(newsletter|noreply|no-reply|mailer|digest|updates?|notifications?|"
    r"marketing|promotions?|info|hello|support|news|weekly|monthly)$",
    re.IGNORECASE,
)
_NEWSLETTER_BODY = re.compile(
    r"unsubscribe|list-unsubscribe|view in browser|email preferences",
    re.IGNORECASE,
)
_INFORMATIONAL_LOCAL = re.compile(
    r"^(no-?reply|noreply|notifications?|alerts?|receipts?|invoice|billing|"
    r"orders?|confirm|verify|mailer|newsletter|updates?)$",
    re.IGNORECASE,
)
_NOREPLY_CONTAINS = re.compile(r"(no.?reply|noreply|donotreply)", re.IGNORECASE)

_PHISHING_KEYWORDS = re.compile(
    r"\b(verify your account|account suspended|click here immediately|"
    r"your account will be (closed|terminated|suspended)|"
    r"confirm your (password|identity|details)|unusual (activity|sign.?in)|"
    r"security alert|update your (payment|billing|account)|"
    r"prize|winner|congratulations|claim your)\b",
    re.IGNORECASE,
)

_KNOWN_BRANDS = [
    "paypal", "apple", "amazon", "google", "microsoft", "netflix",
    "facebook", "instagram", "twitter", "linkedin", "dropbox", "stripe",
]

# ── Local-part helpers ────────────────────────────────────────────────────────

def _base_local(sender_local: str) -> str:
    """Strip RFC 5321 plus-addressing: 'invoice+tag' → 'invoice'."""
    return sender_local.split("+")[0]

def _is_newsletter_local(sender_local: str) -> bool:
    return bool(_NEWSLETTER_LOCAL.match(_base_local(sender_local)))

def _is_informational_local(sender_local: str) -> bool:
    base = _base_local(sender_local)
    return bool(_INFORMATIONAL_LOCAL.match(base) or _NOREPLY_CONTAINS.search(base))

# ── Types ─────────────────────────────────────────────────────────────────────
Label = Literal[
    "urgent", "newsletter", "spam", "normal", "informational",
    "malware_attachment", "phishing_suspect", "fraud_suspect",
]
ThreatLevel = Literal["none", "low", "medium", "high"]


# ── Request / Response models ─────────────────────────────────────────────────
class AttachmentInfo(BaseModel):
    filename: str
    sha256: Optional[str] = None
    size_bytes: Optional[int] = None


class ClassifyRequest(BaseModel):
    subject: str
    sender_domain: str
    sender_local: str
    # Phase 0 — security signals
    sender_display_name: Optional[str] = None
    spf_pass: Optional[bool] = None
    dkim_pass: Optional[bool] = None
    dmarc_pass: Optional[bool] = None
    attachments: Optional[list[AttachmentInfo]] = None
    body_preview: Optional[str] = None
    # Phase 1 — routing hints
    to_addresses: Optional[list[str]] = None
    cc_addresses: Optional[list[str]] = None


class ClassifyResponse(BaseModel):
    label: Label
    score: float
    priority: bool
    security_flags: list[str] = []
    threat_level: ThreatLevel = "none"


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Sieve L2 Classifier")


# ── Phase 0 helpers ───────────────────────────────────────────────────────────

def _scan_attachments(attachments: list[AttachmentInfo]) -> tuple[bool, list[str]]:
    """Return (is_malware_threat, flags). Checks file extensions only (no VirusTotal in heuristic path)."""
    flags: list[str] = []
    for att in attachments:
        name = att.filename.lower()
        parts = name.rsplit(".", 2)
        outer_ext = f".{parts[-1]}" if len(parts) >= 2 else ""
        inner_ext = f".{parts[-2]}" if len(parts) >= 3 else ""

        # Double-extension attack: document.pdf.exe
        if inner_ext in {".pdf", ".docx", ".xlsx", ".zip", ".txt"} and outer_ext in _DANGEROUS_EXTS:
            flags.append(f"double_extension:{att.filename}")
        elif outer_ext in _DANGEROUS_EXTS:
            flags.append(f"dangerous_extension:{att.filename}")
        elif outer_ext in _MACRO_CAPABLE_EXTS:
            flags.append(f"macro_capable:{att.filename}")

    is_threat = any(
        f.startswith("dangerous_extension:") or f.startswith("double_extension:") for f in flags
    )
    return is_threat, flags


def _phishing_score(req: ClassifyRequest) -> tuple[float, list[str]]:
    """Return (confidence 0..1, flags) for phishing/fraud signals."""
    flags: list[str] = []
    score = 0.0

    # Auth failures — SPF/DKIM/DMARC
    auth_failures = sum([
        req.spf_pass is False,
        req.dkim_pass is False,
        req.dmarc_pass is False,
    ])
    if auth_failures >= 2:
        score += 0.45
        flags.append("auth_failure_multiple")
    elif auth_failures == 1:
        score += 0.20
        flags.append("auth_failure_single")

    # Sender display-name brand spoofing
    if req.sender_display_name:
        display = req.sender_display_name.lower()
        domain = req.sender_domain.lower()
        for brand in _KNOWN_BRANDS:
            if brand in display and brand not in domain:
                score += 0.35
                flags.append(f"brand_spoofing:{brand}")
                break

    # Phishing keywords in subject + body
    text = req.subject + (" " + req.body_preview if req.body_preview else "")
    if _PHISHING_KEYWORDS.search(text):
        score += 0.30
        flags.append("phishing_keywords")

    return min(score, 1.0), flags


# ── Main classification pipeline ─────────────────────────────────────────────

def _classify_heuristic(req: ClassifyRequest) -> ClassifyResponse:
    security_flags: list[str] = []

    # ── Phase 0 — Security: malware attachments ──────────────────────────────
    if req.attachments:
        is_threat, att_flags = _scan_attachments(req.attachments)
        security_flags.extend(att_flags)
        if is_threat:
            return ClassifyResponse(
                label="malware_attachment",
                score=0.95,
                priority=False,
                security_flags=security_flags,
                threat_level="high",
            )

    # ── Phase 0 — Security: phishing / fraud ─────────────────────────────────
    ph_score, ph_flags = _phishing_score(req)
    security_flags.extend(ph_flags)

    if ph_score >= 0.65:
        return ClassifyResponse(
            label="phishing_suspect",
            score=ph_score,
            priority=False,
            security_flags=security_flags,
            threat_level="high" if ph_score >= 0.80 else "medium",
        )

    # Urgent + actual auth failure → fraud suspect (not quite phishing but risky)
    _auth_failed = req.spf_pass is False or req.dkim_pass is False or req.dmarc_pass is False
    if _URGENT_SUBJECT.search(req.subject) and _auth_failed and ph_score >= 0.20:
        return ClassifyResponse(
            label="fraud_suspect",
            score=0.75,
            priority=False,
            security_flags=security_flags,
            threat_level="medium",
        )

    # ── Urgent (clean auth, checked before newsletter to preserve precedence) ──
    _auth_clean = req.spf_pass is not False and req.dkim_pass is not False
    if _URGENT_SUBJECT.search(req.subject) and _auth_clean:
        return ClassifyResponse(
            label="urgent",
            score=0.90,
            priority=True,
            security_flags=security_flags,
            threat_level="none",
        )

    # ── Phase 1 — Spam / newsletter filter ───────────────────────────────────
    spam_signal = (req.spf_pass is False or req.dkim_pass is False)
    body = req.body_preview or ""

    if _is_newsletter_local(req.sender_local):
        if _NEWSLETTER_BODY.search(body):
            return ClassifyResponse(
                label="newsletter",
                score=0.92,
                priority=False,
                security_flags=security_flags,
                threat_level="none",
            )
        if spam_signal:
            return ClassifyResponse(
                label="spam",
                score=0.75,
                priority=False,
                security_flags=security_flags,
                threat_level="none",
            )
        # CON-65: noreply-type senders without newsletter body → informational
        if _NOREPLY_CONTAINS.search(_base_local(req.sender_local)):
            return ClassifyResponse(
                label="informational",
                score=0.80,
                priority=False,
                security_flags=security_flags,
                threat_level="none",
            )
        return ClassifyResponse(
            label="newsletter",
            score=0.85,
            priority=False,
            security_flags=security_flags,
            threat_level="none",
        )

    # Auth failure alone is a spam signal
    if spam_signal and ph_score >= 0.10:
        return ClassifyResponse(
            label="spam",
            score=0.70,
            priority=False,
            security_flags=security_flags,
            threat_level="none",
        )

    # ── Informational (receipts, notifications, etc.) ────────────────────────
    if _is_informational_local(req.sender_local):
        return ClassifyResponse(
            label="informational",
            score=0.80,
            priority=False,
            security_flags=security_flags,
            threat_level="none",
        )

    return ClassifyResponse(
        label="normal",
        score=0.70,
        priority=False,
        security_flags=security_flags,
        threat_level="none",
    )


@app.post("/classify", response_model=ClassifyResponse)
def classify(req: ClassifyRequest) -> ClassifyResponse:
    return _classify_heuristic(req)


@app.get("/health")
def health() -> dict:
    return {"ok": True}
