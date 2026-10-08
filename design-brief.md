# Terminal Design Brief

## Interface goal
A legible, predictable terminal interface for developers. This is not a website UI project. Show concise progress by default; --verbose exposes bounded diagnostics. Never show private model chain-of-thought; display plans, actions and results instead.

## Run presentation
Header: task and run ID, workflow, provider/model, selected roots and online disclosure. Plan: a short ordered list. Progress: current action and status. Approval: visible target, effect, batch contents and accept/deny choice. Completion: verified checks, failures/skips, artifacts, limitations and next actions.

## States
Ready, missing input, planning, awaiting approval, executing, validating, complete, partial, failed, cancelled, checkpointed and blocked. Color supplements text, never replaces it. Support monochrome, no-color mode, narrow terminal widths, keyboard-only interaction and redirected output without animated noise.

## Evidence reports
Markdown/HTML-safe PDF sections: request, scope, environment, checks with pass/fail/skipped/blocked labels, evidence references, observed findings, inferred findings, changes and limitations. Screenshots and URLs support claims. Network errors should identify request and failure without exposing authorization headers or tokens. Design-system report separates observed colors/fonts/layouts from inferred reusable components and unknown source tokens.

## Branding
Working name: TaskForge, selected by owner. Author: Nnam Daniel Chidozie. Availability/trademark and npm-name checks have not been performed. Prefer clear text branding first; no logo is required for MVP. MIT licence. Public README honestly labels development and verified capabilities.
