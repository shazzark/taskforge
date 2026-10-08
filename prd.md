# TaskForge - Product Requirements

## Document status
Planning baseline v0.1, 8 October 2026. Owner: Nnam Daniel Chidozie. No implementation or model evaluation has been completed. Confirmed owner choices are requirements; recommendations below are labelled provisional. Target: a verified first release before 25 October 2026, meaning 24 October or earlier. This is a target, not a completion promise.

## Purpose
TaskForge helps developers complete repeatable, multi-step workflows from the terminal using their chosen AI model, real tools, and verifiable outputs. It is an open-source general-purpose agent with an expanding task collection. It uses existing models; training a new foundation model is not part of this project.

## Confirmed decisions
Developers first. Windows launch, Linux later; macOS has no committed launch date. Natural-language commands, interactive chat, and named workflows. Local and online models; user-supplied API keys; at least one setup without paid model requests. Free online tier for development. Node.js and TypeScript; MongoDB selected by owner. MIT licence, public GitHub repository, owner creates repository. Development on owner's Windows laptop through local Codex. Use relevant skills and agents/subagents in verified implementation phases. Clone-based installation first; npm distribution after release checks.

## Release scope
All four capability groups belong to the requested first-release ambition. They must be built in phases; no group is silently removed to meet the date. The following bounded workflow definitions are provisional until the owner reviews them.

1. Files and data: inventory a selected folder; read supported documents; analyse CSVs using deterministic calculations; preview and approve document moves; produce reports and exports.
2. Software: inspect a selected repository; investigate an error; propose and approve targeted edits; run approved tests/builds; prepare a local diff with verification evidence. Git publication is deferred.
3. Browser and research: inspect explicitly supplied websites; test specified journeys; record browser network failures, HTTP errors, console errors, broken links, accessibility checks, responsive observations and passive security observations; infer design tokens and components; retrieve public sources and compare evidence.
4. Connected workflows: read approved GitHub repository/issue data, produce local issue/change drafts; run local schedules; draft email without sending; delegate bounded investigations to specialist agents sharing controlled tools.

## Website testing contract
The owner requests broad testing including network, security and design-system study. No finite scanner can check everything or certify security. TaskForge must publish exactly which checks ran, coverage, failures, skips and limitations. Network checks concern browser-observed requests and timing, not arbitrary infrastructure access. Security defaults to passive observations such as response headers, mixed content and visible exposure; active tests need explicit target-owner authorization and a separately scoped workflow. Design inference is labelled observed/inferred and cannot claim access to original design tokens. Unknown login credentials or missing journeys are blockers, not passing checks.

## Deferred actions
Sending email/messages, publishing content, purchases and deployment are deferred by the owner. Reading GitHub and preparing drafts can exist without write access. Community marketplace and arbitrary third-party executable extensions are deferred; reviewed contributions and local task definitions are supported. Linux support follows Windows acceptance.

## Outputs and supported formats
Owner requests all outputs. Recommendation: terminal summary plus Markdown report, structured JSON evidence, relevant CSV exports, screenshots and PDF reports. Input-format recommendation: TXT, Markdown, CSV, text-based PDF, DOCX and XLSX, with documented size limits. Scanned PDF OCR, legacy DOC/XLS, macros and encrypted documents require separate adapters and are not assumed supported. Output adapters are phased; unsupported formats fail clearly. These format boundaries remain provisional.

## User stories
As a developer I can ask 'test website' and be asked for the URL and intended journeys before testing. I can run a named workflow repeatedly with explicit inputs. I can see a plan and tool activity, preview changes, approve a related batch, cancel work, and resume from a checkpoint after state revalidation. I can choose a model and know whether my content will leave the computer. I can add local task definitions and contribute reviewed tasks through GitHub.

## First-release acceptance
Every declared release workflow passes its fixture-based end-to-end checks. Real Windows setup succeeds on a clean clone. At least one local tool-capable model and one free-tier online adapter are evaluated; availability is verified at setup rather than promised indefinitely. Reports distinguish pass, fail, skipped and blocked. File and command permissions, redaction, cancellation, resume, provider failure and database failure checks pass. Documentation allows another developer to install and run the tool. Public package publication is a separate release gate.

## Open review items
Exact workflow examples/journeys, document-format limits, retention defaults, numeric budgets, GitHub authentication method, email drafting inputs and scheduling semantics need owner review or implementation evaluation. Missing decisions do not authorize invented integrations. If all required scope cannot pass by 24 October, report an incomplete preview or move the date; do not label it a completed MVP.
