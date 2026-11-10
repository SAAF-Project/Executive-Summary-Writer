"""Four Eyes: nothing final leaves an agent without a signed human approval of exactly that content."""

from .gate import (
    Approval,
    ApprovalInvalid,
    ApprovalMissing,
    ApprovalRejected,
    FourEyesError,
    Gate,
    GateMisconfigured,
    fingerprint,
    short_code,
    verify_log,
)

__version__ = "0.1.0"

__all__ = [
    "Approval",
    "ApprovalInvalid",
    "ApprovalMissing",
    "ApprovalRejected",
    "FourEyesError",
    "Gate",
    "GateMisconfigured",
    "fingerprint",
    "short_code",
    "verify_log",
]
