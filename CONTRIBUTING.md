# Contributing to Vatix Protocol

Thanks for contributing — including Stellar Wave contributors. Please read this
guide before opening a PR.

## Changelog discipline

Every PR that changes behavior, APIs, configuration, or security posture **must**
update [`CHANGELOG.md`](CHANGELOG.md). This keeps the changelog an accurate,
reviewable record of the `vatix-backend` package (indexer/api) and the rest of
the monorepo.

### What to log

- **Added** — new features, endpoints, events, parsers, or metrics.
- **Changed** — changes to existing behavior, contracts, or defaults.
- **Fixed** — bug fixes, including fail-closed / correctness fixes.
- **Security** — authz, rate-limiting, secret-handling, or deny-by-default
  changes. Never include secrets, tokens, or credentials in an entry.

### When to log

- Add entries under the `## [Unreleased]` section in the same PR as the change.
- Do **not** create a new version heading yourself; maintainers cut releases and
  move `Unreleased` entries into a dated version section.
- Documentation-only PRs (like this one) still update the changelog when they
  change contributor-facing guidance.

### Format

- Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
  [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
- One bullet per change, written in the imperative mood, referencing the
  affected file or package where useful (e.g. `apps/indexer/src/metrics.ts`).
- Keep entries concise and free of internal hostnames, addresses, or secrets.

## Pull requests

- Keep changes scoped to the linked issue; avoid unrelated refactors.
- Ensure CI stays green and add tests for new behavior on the critical path.
- For money-path or mainnet-affecting changes, land behind a feature flag or
  kill-switch and document the rollback strategy in the PR description.

## Security

See [`SECURITY.md`](SECURITY.md) for the deny-by-default policy, rate-limit
governance, and probe safety invariants.
