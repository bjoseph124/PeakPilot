# Public repository readiness audit

Audit date: October 8, 2026. **No repository was published, no remote was created, and no commit or push was made.** The workspace remains an uninitialized Git directory. A disposable Git metadata directory was used only to verify ignore rules and enumerate the proposed publication files.

## Findings and fixes

| Area | Finding | Action |
|---|---|---|
| Secrets and personal data | No credential-like secrets, personal home paths, real customer data, or proprietary markers detected in authored files and exports | Reviewed source/configuration text, exported JSON, and screenshot/PDF metadata; no redaction required |
| Generated files | Local environments, caches, and exports are unnecessary publication payloads; environment/build caches can contain machine paths | Expanded `.gitignore` and verified it with Git's actual ignore engine |
| Runtime dependency advisories | Original Starlette/AnyIO versions produced nine advisory findings | Updated FastAPI to 0.143.0, Starlette to 1.3.1, and AnyIO to 4.14.2, then verified on Python 3.11 |
| Test dependency advisory | The installed pytest version produced one additional advisory | Updated development requirements to pytest 9.0.3 |
| Production dependencies | pytest and HTTPX were included in runtime requirements | Moved them into `backend/requirements-dev.txt`; runtime Docker installation uses only runtime requirements |
| Node/Next.js setup | Type checks referenced generated route types from previous builds | Recorded Node 22 and made `typecheck` generate route types before running TypeScript |
| Reset control | Resetting an already-default scenario could clear the day without triggering calculation, making the daily chart match the whole month | Reset now creates a fresh scenario object; a real-browser regression test verifies the selected day |
| Negative outcomes | Increased peaks and negative savings retained positive language/styling | Increased peaks are identified explicitly; losses use a distinct color and “cost increase” wording |
| Chart claims | “Real dispatch” could imply live hardware; grid import appeared twice in tooltips | Labeled dispatch as simulated and excluded the duplicate fill series from tooltips |
| Forecast input assumptions | Public domain function did not reject gaps or non-midnight splits; automatic early stopping could introduce random validation on larger inputs | Added explicit input checks, disabled automatic early stopping, and added regressions |
| Cost input validation | Mismatched or partially specified throughput arrays could fail unclearly or broadcast | Added shape, pair, sign, and finite-value checks with regression tests |
| Documentation | Verification record said servers were still running; setup used the older Python runtime | Updated installation, verification, methodology, architecture diagram syntax, and publishing instructions |
| README image | Dashboard image already existed | Retained the relative image link and refreshed the curated PNG from the clean production build |

No major feature was removed or rewritten. Forecasting, MILP dispatch, economic analysis, all dashboard views, and interactive controls remain available. The numerical defaults reproduce the previous benchmark.

## Clean-environment verification

The clean copy included only files selected by the repository's `.gitignore`, without `.venv`, `node_modules`, `.next`, local environment files, exported artifacts, or generated `next-env.d.ts`. It used a separately downloaded Python runtime, a fresh virtual environment, a new npm install/cache, and Playwright's downloaded Chromium rather than a local Chrome installation.

| Check | Observed result |
|---|---|
| Python 3.11.17 install from `requirements-dev.txt` | Passed |
| `python -m pip check` | No broken requirements |
| `python -m pytest -q` using pytest 9.0.3 | **35 passed**, no pytest warnings; latest run 4.65 seconds |
| `npm ci` from the committed lockfile | Passed |
| `npm run format:check` | Passed |
| `npm run typecheck` before the first build | Passed, including generated Next.js types |
| `npm run build` | Passed |
| FastAPI + Next.js production startup | Passed |
| `npm run dev` and proxied `/api/health` | Passed: dashboard HTTP 200 and healthy API response |
| `npm run screenshot` using downloaded Chromium | **12 checks passed**, no browser errors or warnings |
| 1920×1080, 1600×1000, and 390px layouts | Passed overflow checks |
| Benchmark regeneration | Default costs and forecast metrics match the previous recorded outputs |
| Final npm advisory query | **0 reported vulnerabilities** across its 150-entry dependency inventory |
| Final pip-audit query on all 33 resolved application/development packages | **0 reported vulnerabilities** |

The final Python scan used the complete installed `pip freeze` list, including transitive and development packages, with resolution disabled so the audit could not silently select different versions. The scanner itself ran outside the project. Packaging/bootstrap tools and the audit tool are not application dependencies. Advisory checks are a point-in-time database lookup, not proof that the code is vulnerability-free.

The browser report is [`browser-verification.json`](browser-verification.json). Reproducible numerical results and scientific-library versions are in [`benchmark.json`](benchmark.json). Updated direct web/test versions are pinned in the requirements files. No API key or private dataset was used.

Both temporary servers were stopped after verification; ports 3000 and 8000 were confirmed to have no listeners. Final source-parity checks confirmed that all executable project files match those tested in the clean copy.

## Files and privacy scope

All first-party source, configuration, documentation, and local exported artifacts were checked for credential-shaped strings, credential assignments, personal home paths, email addresses, and proprietary/confidential markers. The publication candidate list was inspected for symlinks, hidden credential files, and oversized files. No matching secrets or personal identifiers were detected. No Git history exists to scan.

Installed third-party dependency trees were assessed through their manifests and vulnerability inventories, not treated as authored source. Virtual environments, build caches, and temporary browser outputs remain excluded. The largest intended publication asset is the approximately 0.3 MB README screenshot; no Git LFS or large generated dataset is needed. The synthetic generator's building names and areas are fictional and explicitly labeled.

The optional Chrome path in the README is a generic application-installation example, not a personal path or runtime requirement. Loopback API addresses and `/app` in Dockerfiles are intentional defaults. No machine-specific absolute path is required by application code.

The final proposed publication contains 35 files, approximately 0.6 MB total. The curated PNG has no embedded metadata; the checked PDF has no author field or personal path. Those checks do not substitute for reviewing the visible contents of future screenshots or uploaded data.

## Remaining decisions and limits

- **Human review before publishing:** choose your public author identity and confirm that the MIT license and screenshot are what you want to submit. The current attribution is generic, not personal information.
- **Use Python 3.11:** the older local Python 3.9 environment is not the audited runtime. It was left untouched and is ignored by Git. Start a new environment for the updated dependencies.
- **Docker and remote CI are unverified:** Docker is unavailable here, and no GitHub repository exists yet. Their configuration is included, but no successful image build or remote Actions run is claimed.
- **No hosted deployment was performed.** Rate limiting and a bounded job queue are still needed before exposing the expensive simulation endpoint as a public service. Cancelling a browser request does not cancel an already-running solve.
- **Python transitive versions are not fully locked:** direct scientific/web/test dependencies and security-sensitive transitive dependencies are pinned; the audit records the tested environment. A future fully hashed cross-platform lock is a useful reproducibility improvement, not a completed feature.
- **Synthetic development benchmark only:** no claim of real-world model accuracy, savings, annual performance, or investment suitability. Current-interval control feedback is idealized; the README lists the other modeling exclusions.
- **Existing Downloads ZIP is stale:** it predates this audit and was not silently overwritten. Publish the updated source directory, not that earlier archive.

The exact local review, Git initialization, and later GitHub publishing commands are in [`PUBLISHING.md`](PUBLISHING.md). Publication remains your explicit next decision.
