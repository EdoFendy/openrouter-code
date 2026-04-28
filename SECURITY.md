# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x (latest) | ✅ |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email **valatria14@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- (Optional) a suggested fix

You will receive an acknowledgement within 48 hours and a status update within 7 days.

## Scope

Things we care about most:

- **API key leakage** — `or-code` redacts secrets from JSONL transcripts. If you find a path that bypasses this, please report it.
- **Workspace escape** — tools validate that paths stay inside the configured workspace root. If you find a bypass, please report it.
- **Permission engine bypass** — shell commands must go through the allow/ask/deny engine. If there's a way to skip it, that's a critical issue.
- **Hook injection** — hooks run user-configured shell commands. If there's a way for an untrusted `SKILL.md` to execute arbitrary shell via hook manipulation, that's in scope.

Out of scope: model-output hallucinations, rate-limit abuse on the OpenRouter API, dependency vulnerabilities already reported upstream.

## Disclosure

Once a fix is released, we will:

1. Publish a GitHub Security Advisory.
2. Mention it in [CHANGELOG.md](CHANGELOG.md).
3. Credit the reporter by name or handle (with their permission).
