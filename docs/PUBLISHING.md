# Publication checklist

**Nothing has been published. Run the publication steps only after you explicitly decide to publish.** No remote repository or Git commit was created during preparation.

## Review before publishing

1. Read `docs/PUBLICATION_AUDIT.md`, including the remaining limitations and dependency changes. Use Python 3.11 and Node 22.
2. Review the MIT license and decide how you want to identify yourself as the author. The generic “PeakPilot contributors” attribution contains no personal information.
3. Inspect the README screenshot and synthetic benchmark. Keep their synthetic-data labels. Do not present the results as measured building performance.
4. Follow the README installation and test commands. Keep secrets out of examples, screenshots, configuration, and commit messages. No API keys are needed.
5. Choose a repository name and your Git identity. For privacy, use the GitHub-provided no-reply email from your account settings if desired.

The existing `PeakPilot.zip` in Downloads is an older export, not the audited source. Do not publish that ZIP as a substitute for this updated project directory. Generated files in `artifacts/` remain local; the curated image in `docs/` is intentionally included.

## Local Git preparation — when you are ready

From the project directory (replace the identity placeholders before running):

```bash
git init -b main
git config --local user.name "YOUR_PUBLIC_NAME"
git config --local user.email "YOUR_VERIFIED_OR_NOREPLY_EMAIL"
git add .
git status --short
git diff --cached --stat
git diff --cached --check
git diff --cached
```

Confirm that `.venv`, `node_modules`, `.next`, `.env` files, caches, and `artifacts/` are absent from the staged list. Confirm that `README.md`, `LICENSE`, `frontend/package-lock.json`, both Python requirements files, source, tests, workflow, and `docs/peakpilot-dashboard.png` are present. Git cannot display the PNG diff as text, so open that image separately.

Then create the local commit:

```bash
git commit -m "Initial release of PeakPilot storage intelligence demo"
```

## Create and push the public repository — only after approval

In GitHub, create an **empty** public repository named `PeakPilot`. Do not initialize it with another README, license, or `.gitignore`. Replace `YOUR_GITHUB_USERNAME` below:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/PeakPilot.git
git remote -v
git push -u origin main
```

Authenticate using your normal GitHub credential manager or SSH workflow. Never put an access token in a remote URL or commit it to a file. These commands are instructions only; they have not been executed.

After pushing, check that the README image and architecture diagram render, inspect the Actions run, and add a concise description such as “Commercial battery dispatch, load forecasting, and transparent storage economics on reproducible synthetic data.” Only add a live demo URL after separately deploying and testing both services.

Remote CI, Docker, and hosted deployment are separate checks. A public source repository does not require making the simulation API publicly accessible.
