# Validation record

Initial local validation on **20 September 2026**, Windows, Node **24.18.0**, with the exact package-lock dependencies.

- `npm run check`: syntax, local documentation links, all schemas and profiles passed.
- `npm test`: **102 tests passed, zero failed, zero skipped**. This includes actual headless Chromium tests.
- `npm run demo`: correct implementation accepted; deliberately incorrect whitespace/punctuation behavior rejected; failure intake linked to the evidence.
- `npm run demo:visual`: separately captured reference accepted by the matching candidate, deliberately changed layout rejected across four desktop/mobile signup cases.
- The experiment CLI produced an independent-review proposal for the explicitly fictional synthetic fixture. This exercises the assessor; it is not evidence of real factory improvement.
- Git staging whitespace check passed. Dependencies installed without lifecycle scripts; the installation audit reported zero known vulnerabilities at that time.

Adversarial tests cover malformed/empty/contradictory reports, incomplete case sets, policy drift, artifact changes, symlink inputs, unusual filenames, stale exports, failed/timed-out preparation, worker failures, altered resume settings, missing references, invalid visual tolerances, resource allowlists, split leakage, incomplete pairs and unsupported self-approval/waiver fields.

The source workflow repeats tests and demos on **Windows and Linux, Node 22 and 24**. Its actual run status is available in [GitHub Actions](https://github.com/koldovsky/project-factory-next/actions). A configured matrix is not itself proof that every remote run succeeded; inspect the relevant commit's checks.

No paid model calls were made during validation. Native Codex/Claude flags were checked against documentation and local help; adapters were exercised with controlled local processes. Real-model task performance, production isolation, authenticated experiment collection and deployment outcomes must be measured in the intended operating environment.
