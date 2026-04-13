# CLAUDE.md

This file provides context and conventions for AI assistants (Claude and others) working in this repository.

---

## Project Overview

**Repository:** `asimsid12/Asim`
**Owner:** Asim
**Status:** New — stack and purpose to be defined as development begins.

> Update this section once the project purpose, tech stack, and architecture are established.

---

## Repository Structure

```
Asim/
├── CLAUDE.md         # This file — AI assistant guide
└── (to be populated)
```

Update this tree as directories and files are added.

---

## Tech Stack

> To be documented once the first code is committed. Add language, framework, database, and tooling versions here.

---

## Development Setup

```bash
# Clone the repo
git clone <repo-url>
cd Asim

# Install dependencies (update once stack is decided)
# e.g. npm install / pip install -r requirements.txt / etc.

# Run the project locally
# (to be documented)

# Run tests
# (to be documented)
```

---

## Branch & Commit Conventions

### Branches
- `main` — stable, production-ready code. Never commit directly.
- `claude/<description>-<id>` — branches created by AI assistants.
- `feature/<description>` — human-created feature branches.
- `fix/<description>` — bug fix branches.

### Commit Messages
- Use the imperative mood: `Add feature X`, not `Added feature X`.
- Keep the subject line under 72 characters.
- Reference issue numbers where relevant: `Fix order parsing bug (#12)`.
- Do not include AI session URLs in commit messages unless instructed.

### Workflow
1. Branch off `main` for every change.
2. Open a pull request for review before merging.
3. Squash-merge feature branches to keep history clean.

---

## Code Style & Conventions

- Prefer clarity over cleverness — write code that reads like prose.
- No dead code, commented-out blocks, or unused imports.
- Keep functions small and single-purpose.
- Validate only at system boundaries (user input, external APIs); trust internal contracts.
- Do not add docstrings, type annotations, or comments to code you did not write.
- Three similar lines of code is better than a premature abstraction.

> Add language-specific linting and formatting rules here once the stack is decided (e.g. ESLint config, Black/Ruff for Python, etc.).

---

## Testing

> Document test framework, how to run tests, and coverage expectations here.

```bash
# Run all tests
# (to be documented)

# Run a single test file
# (to be documented)
```

---

## AI Assistant Guidelines

These rules apply to any AI assistant (Claude, Copilot, etc.) working in this repo.

### Do
- Read files before editing them.
- Make the smallest change that satisfies the requirement.
- Commit and push to the designated feature branch.
- Ask before taking irreversible or wide-impact actions (deleting files, force-pushing, dropping data).
- Use existing utilities and patterns before creating new abstractions.

### Do Not
- Push directly to `main`.
- Add speculative features, future-proofing, or unasked-for refactors.
- Add error handling for scenarios that cannot happen.
- Create new files when editing an existing one is sufficient.
- Skip pre-commit hooks (`--no-verify`).
- Amend published commits — create a new commit instead.

### Sensitive Files
Never commit files containing secrets, credentials, or API keys:
- `.env`, `.env.*`
- Any file with `secret`, `credential`, `key`, or `token` in the name.

---

## Business Context

This repository belongs to Asim, whose wife runs **Baro Studio** — a Karachi-based limited-edition clothing brand. The brand operates on Instagram (`@barostudio___`) and uses **Splendid Accounts** (`splendidaccounts.pk`) for invoicing and inventory management. Orders currently arrive via WhatsApp and Instagram DMs.

Future code in this repo may include automation tools for order capture, invoice generation, and inventory tracking to support this business.

---

## Key Links

- Splendid Accounts: https://splendidaccounts.pk
- Baro Studio Instagram: https://www.instagram.com/barostudio___/

---

*Last updated: 2026-04-13*
