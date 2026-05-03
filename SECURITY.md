# Security Policy

## Supported Versions

Only the `main` branch is actively supported. Tagged releases (when they start shipping) will follow the standard "latest minor receives fixes" model — older minors are best-effort.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security reports.** Public reports give attackers a head start before a fix is available.

Instead, use one of:

1. **GitHub Security Advisories** (preferred): open a private advisory at  
   https://github.com/&lt;your-username&gt;/comfyui-ai-studio/security/advisories/new  
   This stays private until the maintainers and you agree to disclose.
2. **Email**: `&lt;maintainer-email&gt;` *(replace with the project maintainer's email before going public)*. Encrypt with the maintainer's PGP key if one is published.

Please include:
- A description of the issue and its impact
- Steps to reproduce (a minimal proof-of-concept is ideal)
- Any known mitigations
- Whether you'd like credit in the disclosure

## Response Expectations

- **Acknowledgement**: within 5 business days of receipt
- **Triage + severity**: within 10 business days
- **Fix or mitigation timeline**: depends on severity; communicated as part of triage
- **Disclosure**: coordinated — typically when a fix ships, or 90 days after acknowledgement, whichever is sooner

## Scope

The studio is a local-first tool. The trust boundary is **the operating system the user runs it on** — credentials in workflows, API keys for ComfyUI environments and LLM providers, and the contents of `STUDIO_DATA_DIR` are protected by OS file permissions, not by application-level access control.

In-scope vulnerabilities include (but aren't limited to):
- Path traversal or arbitrary file read/write through any API route
- Server-side request forgery via the ComfyUI environment URL or LLM `baseUrl`
- Injection in workflow execution (prompt JSON tampering, executor inputs)
- Credential leakage in logs, error messages, or persisted run records
- XSS or unsafe rendering of model output / asset metadata in the UI

Out of scope:
- Vulnerabilities that require attacker-controlled access to the user's local machine — that's already the trust boundary
- Issues in upstream ComfyUI or LLM provider APIs (please report those upstream)
- Denial of service through legitimate but expensive workflows (configure your own ComfyUI rate limits)

## Hall of Fame

Security researchers who responsibly disclose issues will be credited here (with their permission).
