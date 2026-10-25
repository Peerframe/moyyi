# Change the persisted format

Anything under `src/contracts/persisted/` is on users' disks. Old data must stay readable.

The owner-authorized ADR 0003 amendment on 2026-10-25 used the single pre-storage exception
and replaced `fixtures/v1.ts` before a store existed. That amended fixture is now the baseline;
the exception is consumed, not a standing permission to edit it again. The rules below apply
to subsequent changes, including changes discovered while implementing storage.

Adding an optional field that old records simply lack is usually compatible: old fixtures still
type-check. Anything else is a format change: renaming or removing a field, making a field
required, changing a type, adding an entry kind or effect state.

When `fixtures/v<N>.ts` stops type-checking, or `format.test.ts` fails:

1. Do not edit existing fixtures to make them pass. They are what is already on disk.
2. Increase `PERSISTED_FORMAT_VERSION` in `persisted/index.ts`.
3. Add a store migration from the previous version, with a test that reads the previous
   fixtures and writes the new shape.
4. Add `fixtures/v<N+1>.ts` covering the new shape.
5. Keep the previous fixture file. It may stop type-checking against the new types; in that
   case retype it with a frozen copy of the old types in the migration folder rather than
   deleting it.
6. Mention the change in the pull request description.

Changing `effectTransitions` is a format change as well: existing records may be in any state.
