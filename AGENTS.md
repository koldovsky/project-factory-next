# Working on Project Factory Next

Read README.md and docs/architecture.md before changing the control loop. Read the relevant decision in docs/decisions.md. The executable schemas and tests are authoritative for data formats.

- Keep candidate code, control bundles and run storage in separate directories. Directory separation alone is not an OS security boundary.
- Never weaken an evaluator or refresh a baseline to make a candidate pass. Policy changes need a separately reviewed digest.
- Never translate missing, skipped, malformed or conflicting evidence into success.
- Use executable/argument arrays with shell:false. Do not pass findings or prompts through a shell.
- Preserve exact dependency pins and the lockfile. Source CI provisions browsers; required visual tests cannot silently skip.
- Run npm test and npm run check after substantive changes. Run npm run demo and npm run demo:visual for orchestration changes.
- Add regressions that demonstrate a real incorrect acceptance or meaningful behavior, not tests that merely mirror implementation.
- A passing delivery run is an acceptance result, not permission to merge or deploy. Factory improvement reports propose promotion; they cannot authorize themselves.
- Keep docs clear about implemented behavior, operator responsibilities and future extensions. Do not claim a local hash manifest authenticates its own author.

Task customization belongs in sealed control bundles and profiles. Keep product-specific instructions out of the core controller.
