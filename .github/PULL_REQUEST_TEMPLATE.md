## Summary

What does this change, and why?

## Related issue(s)

Closes #

## Checklist

- [ ] `npm run lint` passes
- [ ] `npx tsc -b` passes
- [ ] `npm test` passes
- [ ] `npm run format:check` passes (or `npm run format` was run)
- [ ] Rust changes: `cargo fmt --check`, `cargo clippy`, and `cargo test` pass under
      `src-tauri/`
- [ ] Added/updated tests for domain (`src/domain/`) or store (`src/store/`) logic, if
      applicable
- [ ] Updated relevant docs (`STATUS.md`, `CLAUDE.md`/`AGENTS.md`, `HANDOFF.md`, or the
      MASTERPLAN family) if this changes architecture or implementation status
- [ ] No changes to `LICENSE` terms without maintainer sign-off

## Test plan

How did you verify this works? (manual run, `tauri:dev`, screenshots, specific test files)

## Notes for reviewers

Anything non-obvious, known limitations, or follow-up work intentionally left out of scope.
