# Stratton Candidate Engine 🚀

> An AI-powered recruitment automation system built for modern staffing agencies. Seamlessly integrates with ATS platforms (Bullhorn, Avionté) to automate candidate outreach, qualification, and interview scheduling using Twilio and Retell AI.

## 🌟 Core Architecture

The Stratton Engine is designed with a scalable, multi-tenant architecture to process high-volume candidate pipelines idempotently.

- **Node.js REST API**: Core backend handling ATS webhooks, state management, and routing.
- **n8n Visual Automation**: Modular workflow engine for SMS and AI Voice sequencing.
- **PostgreSQL**: Centralized operational database tracking candidate state and campaign metrics.
- **Redis**: High-performance locking layer ensuring 100% deduplication (no candidate is contacted twice).
- **Docker**: Fully containerized environment for rapid deployment and scaling.

## ⚙️ Automated Workflow

1. **Data Ingestion**: System detects new Job Orders in the client's ATS.
2. **Candidate Matching**: Pulls matching candidates and normalizes data across systems.
3. **Deduplication Check**: Redis layer verifies candidate contact history to prevent duplicate outreach.
4. **Outreach Sequence**:
   - **Twilio SMS**: Sends initial qualifying text messages.
   - **Retell AI**: Conducts human-like voice screening for engaged candidates.
5. **State Management**: Tracks responses, handles instant opt-outs, and manages retries for failed API calls.
6. **ATS Write-back**: Syncs interview notes, qualification status, and scheduled appointments (Google Calendar/M365) directly back to the client's ATS.

## 🛡️ Security & Reliability

- **Idempotency**: All webhook handlers and automation nodes are idempotent.
- **Secrets Management**: Environment-based configuration with strict `.gitignore` rules ensuring zero credential leakage.
- **Rate Limiting**: Built-in delays and retry mechanisms to respect ATS and third-party API limits.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express, Prisma ORM
- **Database**: PostgreSQL, Redis
- **Automation**: n8n, Twilio, Retell AI
- **Infrastructure**: Docker, Docker Compose

---
*Developed by **Soufian T.** - Lead Backend & Automation Architect*
