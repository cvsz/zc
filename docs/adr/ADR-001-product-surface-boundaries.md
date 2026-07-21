# ADR-001: Define Product Surface Boundaries

- **Status**: accepted
- **Date**: 2026-07-20
- **Deciders**: repository maintainers
- **Tags**: architecture, packaging, compatibility

## Context

The repository contains four overlapping trees: `app/`, `src/wire/`,
`webapp/`, and agent configuration under `.agents/` and `.zc/`. They evolved
at different times and previously had no enforceable ownership or dependency
direction. This made living documentation, packaging, security gates, and
release claims ambiguous.

The public-local deployment contract requires a supported FastAPI origin on
loopback. The `zc` and `zcoder` commands now start that canonical server. The
historical CLI remains available only through the explicit `zc-legacy`
compatibility command. The bundled React console calls the supported `/v1`
API; the separate `webapp/backend/` adapter remains compatibility-only.

## Decision

The product surfaces are classified as follows:

| Surface | Classification | Runtime role | Support contract |
|---|---|---|---|
| `app/` | supported core | FastAPI, local gRPC, storage, authorization | Primary public-local runtime |
| `src/wire/` | compatibility | Installed `zc-legacy` CLI and historical modules | Maintenance support; new server behavior belongs in `app/` |
| `webapp/frontend-src/` and `webapp/frontend-dist/` | supported UI | Same-origin React control panel over `/v1` | Bundled with the primary runtime |
| `webapp/backend/` | compatibility adapter | Historical local web adapter | Not part of the canonical deployment |
| `.agents/`, `.zc/` | development tooling | Agent instructions, skills, and local automation | Excluded from runtime packaging |

Dependencies flow in one direction:

```text
webapp/backend (compatibility adapter) -> wire (compatibility)

webapp/frontend -> app /v1 API over HTTP
app (supported core)      independent
wire (compatibility)      independent
agent tooling             build/development only
```

The following rules are enforced:

1. `app/` must not import `wire` or `webapp`.
2. `src/wire/` must not import `app` or `webapp`.
3. `webapp/backend/` may import `wire` while it remains a compatibility
   adapter. The supported frontend communicates with `app/` only through HTTP,
   and `app/` never imports either web surface.
4. Runtime packages are enumerated explicitly in `setup.cfg`; agent tooling is
   never included.
5. `zc`, `zcoder`, and `zc-api` are aliases for the supported API server.
   `zc-legacy` is the only installed compatibility CLI command.
6. New public endpoints, authentication, storage, and network behavior belong
   in `app/`. New CLI behavior should call the API rather than duplicate server
   state.

## Consequences

### Positive

- Security and quality claims have a precise supported boundary.
- The API can evolve without importing the legacy CLI implementation.
- Compatibility remains available without treating every historical module as
  part of the public server.
- Packaging and CI can detect accidental cross-surface coupling.

### Negative

- The distribution still ships more than one product surface during the
  compatibility period.
- The historical `webapp/backend/` adapter retains a dependency on `wire`
  until that compatibility surface is removed.
- Changes shared by the API and CLI may require a neutral package in a future
  ADR rather than a direct cross-import.

### Neutral

- Historical documents keep their point-in-time meaning.
- Existing `/v1/wire` HTTP routes remain for backward compatibility.
- This decision classifies current surfaces; it does not remove compatibility
  commands.

## Migration gates

The compatibility period ends only after:

1. every specialized CLI operation has an authorized API equivalent;
2. users of `webapp/backend/` have migrated to the bundled API-driven frontend;
3. deprecation is documented for at least one release;
4. package-install, API, CLI, and migration tests pass; and
5. a follow-up ADR approves removal or separate distribution of `wire`.

## Links

- [Repository audit](../REPOSITORY_AUDIT_2026-07-20.md)
- [Architecture](../../ARCHITECTURE.md)
- [Repository instructions](../../AGENTS.md)
