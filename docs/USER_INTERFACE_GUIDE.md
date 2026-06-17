# 🎨 FortenLog Enterprise User Interface & Experience Guide

This document provides a comprehensive, production-grade review of the **FortenLog Telemetry Portal User Interface (UI) and User Experience (UX)**. It details our design language, interactive panels, data-rich explorer screens, administrative controls, and system workflows.

---

## 🖤 1. Core Design Language & Theme

FortenLog implements a premium **Glassmorphism Dark Theme** designed to offer maximum visual comfort for engineers, site reliability managers, and administrators during long debugging sessions.

### A. Color Palette Design System
* **Slate Background (`#0d1117`)**: Deep, low-fatigue dark slate background, minimizing eye strain under low-light environments.
* **Muted Card Surfaces (`#161b22`)**: Semi-transparent, container surfaces with thin `#30363d` borders to establish clean structural depth.
* **Toxic Red Alert (`#f85149`)**: High-visibility warning accents indicating active errors, crash states, and unresolved issue counts.
* **Emerald Success (`#2ea44f`)**: Cool green accents highlighting resolved issues, optimal latencies, and healthy monitor states.
* **Electric Cyan (`#58a6ff`)**: Focus borders and dynamic interactive elements, guiding user actions across the screen.

### B. Typography & Micro-Animations
* **Local Typography**: Uses locally compiled, highly readable sans-serif Google Fonts (*Outfit* and *Inter*) rather than basic system fallback typography, ensuring consistent layout render engines.
* **Interactive Hover States**: All buttons, links, tables, and selectors implement smooth hover transitions (`transition: all 0.2s ease`) and glowing border drops to elevate tactile user interaction.

---

## 📊 2. Main Executive Dashboard

The central dashboard serves as the primary platform control center, organizing real-time aggregated metrics into an intuitive grid layout for quick assessment of system health.

### Dashboard Grid Layout:
1. **System Metric Banners (Top Row)**: A row of card-style indicators showing live absolute values: Total Ingested Events, Unresolved Issues, Resolved Issues, and Active Uptime Monitors.
2. **Release Stability Stream (Left Column)**: A real-time timeline visualizing software stability ratios per release version. Renders dynamic health indexes to highlight performance degradations across active versions.
3. **Aggregated Client Profiles (Right Column)**: Contextual widget panels showing distribution charts of client devices, operating systems, browser engines, and regional origins.
4. **Administrative Quick Actions (Header/Control Bar)**: Action triggers enabling one-click database backups and automated system vacuums directly from the primary navigation bar.
* **Release Stability Analytics**: Visualizes the stability percentage of software releases by comparing error-free sessions against total logs, helping teams identify faulty rollouts immediately.
* **Aggregated Client Profiles**: Beautiful, local distribution charts representing client contexts (Operating System shares, Browser ratios, and Regional locations).
* **Database Quick Actions**: Prompts one-click global maintenance triggers, allowing administrators to initiate database vacuums or secure backup archives without leaving the dashboard.

---

## 🔎 3. Event Explorer & Custom Query Panel

An advanced, flexible telemetry inspector enabling engineers to slice and search massive log streams.

* **Advanced Search Filters**: Filters log lists by Release Version, Browser Type, Operating System, Severity Level, and Custom Environments (e.g., `production`, `staging`, `local-dev`).
* **Interactive Raw SQL execution**: A secure, read-only console enabling administrators to run custom raw SQL statements directly against database indexes for deep analytical reports (e.g., `SELECT COUNT(*), hwid FROM events GROUP BY hwid`).
* **Unified CSV Export**: Allows instant extraction of filtered explorer views into highly structured CSV files for downstream processing or compliance audits.

---

## 🐛 4. Issue Triage & normalized Stack Trace Inspector

The primary debugging screen designed to minimize **Mean Time To Resolution (MTTR)**.

* **Detailed Issue Metadata**: Lists total occurrences, chronological timeline (First Seen vs Last Seen timestamps), and unique affected users (based on hardware UID - HWID logs).
* **Normalized Stack Trace Highlighting**: Displays beautiful, formatted traceback loops. Automatically highlights the specific code lines and source files where execution panicked.
* **Exception Suppress & Resolution Rules**:
  * **Mark as Resolved**: Declares an issue resolved in a future version (e.g., `v3.1.0`), preventing the issue from re-opening if it occurs in an older build.
  * **Suppress**: Temporarily suppresses issue alerts. The background worker will continue incrementing stats but won't clutter the triage streams.
  * **Delete**: Completely purges the exception and all dependent logs from SQLite storage blocks.

---

## ⚙️ 5. Project Registry & Database Management

Enables administrators to create and manage independent tenants and audit storage footprints.

* **Tenant Registry**: Add new applications with custom names, and instantly acquire integration keys (e.g., PostHog tokens or Sentry DSN URLs).
* **Storage Footprint Tracker**: Visualizes exact file sizes on disk (in megabytes) for each project database file (`data/projects/*.db`).
* **Disk Reclaim Actions**:
  * **Run Database Vacuum**: Reclaims unused storage pages and shrinks database file footprints.
  * **Create Project Backup**: Triggers an isolated database snapshot, archiving historical logs into compressed files.
  * **Clear All Project Data**: Purges database logs while keeping project structures and API keys intact.

---

## 🔒 6. Security & Access Control Panel

A hardened administration module containing access rules and audit mechanisms.

* **TOTP Two-Factor Authentication (2FA)**:
  * **Local QR Engine**: Generates high-contrast QR setup blocks locally on a canvas element, keeping authentication setup details 100% offline.
  * **Recovery Codes**: Generates encrypted single-use codes to guarantee administrative restoration during device loss.
* **WebAuthn / Passkey registration**: Allows users to bind biometric keys (Windows Hello, TouchID, YubiKeys) for secure, passwordless authentication.
* **Master Password Overhaul**: Argon2id complexity validator ensuring administrators only input highly secure access keys.
* **Global System Audit Logs**: A read-only audit log viewer exposing every critical system event (e.g., `admin_user reset TOTP 2FA`, `created_project_backup default`, `resolved_issue exception_hash`).

---

## 🟢 7. Uptime Monitoring Control Room

Allows administrators to configure active service checking targets and inspect real-time reliability.

* **Service Creation Wizard**: Setup new polling endpoints, configuring target URL, HTTP verification codes, ping frequencies (in seconds), and connection timeout thresholds.
* **Latency History Charts**: Renders interactive RTT (Round Trip Time) graph charts showing real-time latency variations and target stability history.
* **Quick Status Badges**: Instantly highlights failed targets using toxic red pulses, while healthy targets display stable green indicators.
