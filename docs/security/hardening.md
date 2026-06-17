# Security & Infrastructure Hardening

FortenLog is built with a security-first mindset.

## Authentication
- **Argon2id**: Industry-standard password hashing with configurable cost parameters.
- **Session Binding**: Sessions are tied to IP and User-Agent. Any change triggers immediate session invalidation.
- **2FA (TOTP)**: Built-in support for Google Authenticator/Authy.
- **Hardware Keys**: WebAuthn support for Yubikeys and Titan keys.

## Network Security
- **Stealth Mode**: All authentication errors are generic to prevent username enumeration.
- **XSS Protection**: Automatic HTML escaping in the UI and server-side filtering of ingestion data.
- **CSRF Defense**: Custom header validation (`X-FortenLog-Request`) for all administrative state-changing API calls (ingestion endpoints are exempt for SDK compatibility).
- **Rate Limiting**: Built-in exponential backoff for failed login attempts.

## Audit Logging
Every sensitive action (project creation, password change, user deletion) is recorded in the Global Audit Log with:
- Timestamp
- Performing User
- Action Type
- IP & Metadata

- **GDPR IP Anonymization**: Client IPs are stored in full for the first 14 days (configurable) to support active troubleshooting. Afterward, the background worker automatically masks them (e.g., `1.2.3.0`) for GDPR/FZ-152 compliance.
- **Persistent HWID**: Client SDKs are encouraged to generate and send a robust, persistent hardware/session identifier (`hwid`/`distinct_id`) to track unique affected users instead of dynamic IP addresses.
- **Encryption at Rest**: Databases should be stored on encrypted volumes (LUKS/Bitlocker).
