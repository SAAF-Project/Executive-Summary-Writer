"""The Four Eyes gate.

The four-eyes principle: nothing final goes out without a person's sign-off.
This module makes that sign-off something code can check:

- An approval is a signed record: which step, who, when, and the SHA-256 of
  exactly the content that was approved. It is signed with a key the model never
  sees (HMAC), so a model, a document or a request body cannot produce one.
- The approver comes from the app's own login (the `identity` callback), never
  from the request or the model. `approve()` has no approver argument on purpose.
- The person must type a confirmation that names the content (APPROVE + the first
  8 characters of its fingerprint). "yes", "approve all" or "skip" do not count.
- `require()` is called right before the final output is released. It refuses
  when the approval is missing, forged, for other content, expired or reused.
- Every approval, release and block is written to an append-only log in which
  each line is chained to the previous one and signed, so an auditor can
  re-perform the check later with `verify_log()`.

Standard library only. Fails closed: without a key, nothing can be released.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Union

MIN_KEY_BYTES = 16
SIGNED_FIELDS = ("step", "artefact_sha256", "approver", "approved_at", "nonce")
GENESIS = "0" * 64


class FourEyesError(RuntimeError):
    """The final output must not be released."""


class GateMisconfigured(FourEyesError):
    """No usable signing key: the gate fails closed."""


class ApprovalMissing(FourEyesError):
    """Nobody approved this content."""


class ApprovalRejected(FourEyesError):
    """The person's confirmation was not a valid approval."""


class ApprovalInvalid(FourEyesError):
    """Forged, altered, for other content, expired or already used."""


def fingerprint(artefact: Union[str, bytes]) -> str:
    """SHA-256 of the content, as hex. Text is encoded as UTF-8."""
    data = artefact.encode("utf-8") if isinstance(artefact, str) else bytes(artefact)
    return hashlib.sha256(data).hexdigest()


def short_code(artefact: Union[str, bytes]) -> str:
    """First 8 characters of the fingerprint: what the person types to approve."""
    return fingerprint(artefact)[:8]


@dataclass(frozen=True)
class Approval:
    step: str
    artefact_sha256: str
    approver: str
    approved_at: float
    nonce: str
    signature: str

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Any) -> "Approval":
        """Parse an approval that travelled through state, JSON or a request."""
        try:
            return cls(
                step=str(data["step"]),
                artefact_sha256=str(data["artefact_sha256"]),
                approver=str(data["approver"]),
                approved_at=float(data["approved_at"]),
                nonce=str(data["nonce"]),
                signature=str(data["signature"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ApprovalInvalid(f"not a well-formed approval ({exc.__class__.__name__})") from None


def _load_key(key: Union[str, bytes, None], key_env: str) -> bytes:
    raw = key if key is not None else os.environ.get(key_env, "")
    raw_bytes = raw.encode("utf-8") if isinstance(raw, str) else bytes(raw)
    if len(raw_bytes) < MIN_KEY_BYTES:
        raise GateMisconfigured(
            f"Set {key_env} to a secret of at least {MIN_KEY_BYTES} characters, kept outside "
            "the model's reach. Without it nothing can be released."
        )
    return raw_bytes


def _canonical(data: dict) -> bytes:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


class Gate:
    """Signs approvals and checks them before anything final is released.

    identity: returns the logged-in person (the app's session user, or the OS
        user for a command-line tool). Never take this from the request body.
    key / key_env: the signing secret. Kept on the server, never in a prompt.
    log_path: optional append-only, chained and signed JSONL log.
    max_age_seconds: how long an approval stays valid (default 8 hours).
    """

    def __init__(
        self,
        identity: Callable[[], str],
        *,
        key: Union[str, bytes, None] = None,
        key_env: str = "FOUR_EYES_KEY",
        log_path: Union[str, Path, None] = None,
        max_age_seconds: float = 8 * 3600,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._key = _load_key(key, key_env)
        self._identity = identity
        self._clock = clock
        self.max_age_seconds = max_age_seconds
        self._used: set[str] = set()
        self._log = Path(log_path) if log_path else None
        self._prev = GENESIS
        if self._log and self._log.exists():
            # Continue the chain and remember which approvals were already used.
            for number, line in enumerate(self._log.read_text(encoding="utf-8").splitlines(), start=1):
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                    if not isinstance(entry, dict):
                        raise ValueError("not a log entry")
                except ValueError:
                    # Fail closed: a damaged log blocks releases until someone checks it.
                    raise GateMisconfigured(
                        f"Approval log line {number} is unreadable. Nothing can be released "
                        "until the log is checked with verify-log."
                    ) from None
                self._prev = entry.get("mac", self._prev)
                if entry.get("event") == "released" and entry.get("nonce"):
                    self._used.add(entry["nonce"])

    # -- the person approves ---------------------------------------------------

    def confirmation_phrase(self, artefact: Union[str, bytes]) -> str:
        """What the person must type to approve this exact content."""
        return f"APPROVE {short_code(artefact)}"

    def approve(
        self,
        step: str,
        artefact: Union[str, bytes],
        confirmation: str,
        *,
        prepared_by: str | None = None,
    ) -> Approval:
        """Turn a person's typed confirmation into a signed approval.

        prepared_by: who prepared the content. When given, the approver must be a
        different person (strict four eyes).
        """
        approver = (self._identity() or "").strip()
        if not approver:
            self._record("rejected", {"step": step, "reason": "no logged-in approver"})
            raise ApprovalRejected("No logged-in approver. Approvals come from the app's login, not from input.")
        if prepared_by and approver.casefold() == prepared_by.strip().casefold():
            self._record("rejected", {"step": step, "approver": approver, "reason": "approver prepared it"})
            raise ApprovalRejected("Four eyes: the approver must be a different person from whoever prepared it.")
        expected = self.confirmation_phrase(artefact)
        if str(confirmation).strip() != expected:
            self._record("rejected", {"step": step, "approver": approver, "reason": "confirmation did not match"})
            raise ApprovalRejected(f"Not approved. To approve this exact content, type: {expected}")

        fields = {
            "step": step,
            "artefact_sha256": fingerprint(artefact),
            "approver": approver,
            "approved_at": round(self._clock(), 3),
            "nonce": secrets.token_hex(8),
        }
        approval = Approval(**fields, signature=self._sign(fields))
        self._record("approved", fields)
        return approval

    # -- the code releases -------------------------------------------------------

    def require(
        self, step: str, artefact: Union[str, bytes], approval: Union[Approval, dict, None]
    ) -> Approval:
        """Call right before releasing the final output. Raises unless approved.

        A valid approval is used up: the same approval cannot release twice.
        """
        return self._check(step, artefact, approval, consume=True)

    def verify(
        self, step: str, artefact: Union[str, bytes], approval: Union[Approval, dict, None]
    ) -> Approval:
        """Same checks as require(), but does not use the approval up or log a release.

        For status pages and for checking a whole batch before releasing it.
        """
        return self._check(step, artefact, approval, consume=False)

    def _check(
        self,
        step: str,
        artefact: Union[str, bytes],
        approval: Union[Approval, dict, None],
        *,
        consume: bool,
    ) -> Approval:
        sha = fingerprint(artefact)
        if approval is None:
            self._record("blocked", {"step": step, "artefact_sha256": sha, "reason": "no approval"})
            raise ApprovalMissing(f"'{step}' has not been approved by a person. Nothing released.")
        try:
            if not isinstance(approval, Approval):
                approval = Approval.from_dict(approval)
        except ApprovalInvalid as exc:
            self._record("blocked", {"step": step, "artefact_sha256": sha, "reason": str(exc)})
            raise

        fields = {name: getattr(approval, name) for name in SIGNED_FIELDS}
        if not hmac.compare_digest(self._sign(fields), approval.signature):
            problem = "signature does not match: forged or altered"
        elif approval.step != step:
            problem = f"approval is for '{approval.step}', not '{step}'"
        elif approval.artefact_sha256 != sha:
            problem = "content changed after it was approved"
        elif self._clock() - approval.approved_at > self.max_age_seconds:
            problem = "approval expired"
        elif approval.nonce in self._used:
            problem = "approval already used"
        else:
            problem = None

        if problem:
            self._record("blocked", {"step": step, "artefact_sha256": sha, "reason": problem})
            raise ApprovalInvalid(f"'{step}' not released: {problem}.")

        if consume:
            self._used.add(approval.nonce)
            self._record("released", fields)
        return approval

    # -- internals ---------------------------------------------------------------

    def _sign(self, fields: dict) -> str:
        payload = _canonical({name: fields[name] for name in SIGNED_FIELDS})
        return hmac.new(self._key, b"approval|" + payload, hashlib.sha256).hexdigest()

    def _record(self, event: str, data: dict) -> None:
        if not self._log:
            return
        entry = {"event": event, "at": round(self._clock(), 3), **data, "prev": self._prev}
        mac = hmac.new(self._key, b"log|" + _canonical(entry), hashlib.sha256).hexdigest()
        self._log.parent.mkdir(parents=True, exist_ok=True)
        with self._log.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({**entry, "mac": mac}, sort_keys=True, ensure_ascii=False) + "\n")
        self._prev = mac


def verify_log(
    path: Union[str, Path], *, key: Union[str, bytes, None] = None, key_env: str = "FOUR_EYES_KEY"
) -> tuple[bool, list[str]]:
    """Re-perform the log: every line signed, chained, nothing removed or edited.

    Returns (ok, notes). Notes list each problem, or a summary when all is well.
    """
    secret = _load_key(key, key_env)
    problems: list[str] = []
    counts: dict[str, int] = {}
    prev = GENESIS
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    for number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            problems.append(f"line {number}: not valid JSON")
            continue
        if not isinstance(entry, dict):
            problems.append(f"line {number}: not a log entry")
            continue
        mac = entry.pop("mac", "")
        if not isinstance(mac, str) or not mac.isascii():
            problems.append(f"line {number}: missing or malformed signature")
            continue
        expected = hmac.new(secret, b"log|" + _canonical(entry), hashlib.sha256).hexdigest()
        if entry.get("prev") != prev:
            problems.append(f"line {number}: chain broken (a line before it was removed, added or reordered)")
        if not hmac.compare_digest(expected, mac):
            problems.append(f"line {number}: signature does not match (line edited or wrong key)")
        counts[entry.get("event", "?")] = counts.get(entry.get("event", "?"), 0) + 1
        prev = mac
    if problems:
        return False, problems
    summary = ", ".join(f"{n} {event}" for event, n in sorted(counts.items())) or "empty log"
    # Lines cut off at the very end leave a valid shorter chain. Keep this value
    # somewhere else (in the report, a ticket) and compare it to detect that.
    head = prev[:12] if prev != GENESIS else "none"
    return True, [
        f"{len(lines)} lines verified: {summary}",
        f"last line signature {head}: compare with the copy kept elsewhere to detect lines cut off at the end",
    ]
