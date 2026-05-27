# Job Dashboard Setup

This app is a local job-search dashboard for tracking job leads, generating tailored resumes, saving cover letters/JDs, and asking the built-in Search Assistant to search specific portals.

The app is designed to run locally on each person's laptop. Private files such as job data, generated resumes, logs, local config, and personal resume profiles are ignored by git.

## What Each User Must Customize

Each user should create their own:

- `config.local.json`
- `tools/build_resume_versions.py`
- generated resume/cover-letter folders
- optional tracker CSV

Do not commit those private files to a public repository.

## Requirements

- Git
- Node.js 18 or newer
- Python 3.10 or newer
- Codex desktop app, if you want Codex to help run searches or modify the app

The server uses only built-in Node modules. Python is used for job search scripts and `.docx` generation.

## Windows Setup

Open PowerShell.

```powershell
cd "$HOME\Desktop"
git clone https://github.com/YOUR-USER/YOUR-REPO.git job-dashboard
cd job-dashboard

py -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Create local config:

```powershell
Copy-Item .\config.example.json .\config.local.json
notepad .\config.local.json
```

Suggested Windows `config.local.json`:

```json
{
  "appRoot": "C:/Users/YOUR-NAME/Desktop/job application",
  "trackerCsv": "C:/Users/YOUR-NAME/Desktop/job application/tracker/job_tracker.csv",
  "pythonExe": "C:/Users/YOUR-NAME/Desktop/job-dashboard/.venv/Scripts/python.exe"
}
```

Create folders:

```powershell
New-Item -ItemType Directory -Force `
  "$HOME\Desktop\job application\resume\standard resume", `
  "$HOME\Desktop\job application\resume\tailored resume", `
  "$HOME\Desktop\job application\cover letters", `
  "$HOME\Desktop\job application\job descriptions", `
  "$HOME\Desktop\job application\tracker"
```

Create your resume profile:

```powershell
Copy-Item .\tools\build_resume_versions.example.py .\tools\build_resume_versions.py
notepad .\tools\build_resume_versions.py
```

Edit `CONTACT`, `BASE_EXPERIENCE`, `PROJECTS`, and `VERSIONS` for your own profile.

Start the app:

```powershell
node .\server.js
```

Open:

```text
http://127.0.0.1:8765
```

## macOS Setup

Open Terminal.

```bash
cd ~/Desktop
git clone https://github.com/YOUR-USER/YOUR-REPO.git job-dashboard
cd job-dashboard

python3 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install -r requirements.txt
```

Create local config:

```bash
cp config.example.json config.local.json
open -e config.local.json
```

Suggested macOS `config.local.json`:

```json
{
  "appRoot": "~/Desktop/job application",
  "trackerCsv": "~/Desktop/job application/tracker/job_tracker.csv",
  "pythonExe": "./.venv/bin/python"
}
```

Create folders:

```bash
mkdir -p \
  "$HOME/Desktop/job application/resume/standard resume" \
  "$HOME/Desktop/job application/resume/tailored resume" \
  "$HOME/Desktop/job application/cover letters" \
  "$HOME/Desktop/job application/job descriptions" \
  "$HOME/Desktop/job application/tracker"
```

Create your resume profile:

```bash
cp tools/build_resume_versions.example.py tools/build_resume_versions.py
open -e tools/build_resume_versions.py
```

Edit `CONTACT`, `BASE_EXPERIENCE`, `PROJECTS`, and `VERSIONS` for your own profile.

Start the app:

```bash
node server.js
```

Open:

```text
http://127.0.0.1:8765
```

## Using With Codex

Open the cloned project folder in Codex and ask for tasks such as:

- Run the dashboard locally.
- Search Dice portal.
- Search Infosys portal.
- Add another job portal parser.
- Improve my resume profile.
- Tailor the resume generator for my background.

Codex can edit `tools/build_resume_versions.py` locally for each user's resume. That file is ignored by git, so personal details stay private.

## Search Assistant

The bottom-right Search Assistant supports prompts like:

```text
search all portals
search Dice portal
search LinkedIn portal
search Infosys portal
search Kforce portal
search Capgemini portal
```

Some portals block automated requests or hide data behind login pages. When that happens, the app keeps existing jobs and reports that no new matching jobs were added.

## Resume Generation

When you click **Generate Tailored Resume**, the app writes upload-ready `.docx` files to:

```text
<appRoot>/resume/tailored resume
```

It also writes:

```text
UPLOAD_LATEST_TAILORED_RESUME_<Name>.docx
```

Use that shorter file name if a browser upload dialog does not show long file names cleanly.

## Azure DevOps Push For The Owner

Azure student accounts can use Azure DevOps repos. Azure subscription and Azure DevOps are related Microsoft services, but the repo lives in Azure DevOps at:

```text
https://dev.azure.com
```

Create the remote repo:

1. Go to `https://dev.azure.com`.
2. Sign in with your Microsoft student account.
3. Create an organization if Azure DevOps asks for one.
4. Create a project, for example `job-dashboard`.
5. Choose **Private** visibility unless you intentionally want the code public.
6. Open **Repos**.
7. Create a repository named `job-dashboard`.
8. Copy the HTTPS clone URL. It looks like:

```text
https://dev.azure.com/<organization>/<project>/_git/<repo-name>
```

Push this local repo:

```bash
git remote add origin https://dev.azure.com/<organization>/<project>/_git/<repo-name>
git push -u origin main
```

If `origin` already exists:

```bash
git remote set-url origin https://dev.azure.com/<organization>/<project>/_git/<repo-name>
git push -u origin main
```

On the first push, Git Credential Manager may open a Microsoft login window. Sign in with the same Azure DevOps account.

## GitHub Push For The Owner

After creating an empty GitHub repository, add the remote and push:

```bash
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

If the remote already exists:

```bash
git remote set-url origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

## Privacy Checklist Before Pushing

Run:

```bash
git status --short --ignored
```

These should be ignored:

- `config.local.json`
- `data/`
- `logs/`
- `server.pid`
- `tools/build_resume_versions.py`
- `tools/__pycache__/`

Do not push generated resumes, cover letters, or personal job data unless you intentionally want to share them.
