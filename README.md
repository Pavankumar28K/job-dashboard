# Job Application Dashboard

Local job-search dashboard for tracking applications, searching portals, and generating tailored resume/cover-letter documents.

For full Windows and macOS instructions, see [SETUP.md](SETUP.md).

## Start

```powershell
cd "path\to\job-dashboard"
node .\server.js
```

Open:

```text
http://127.0.0.1:8765
```

## Workflow

- Review jobs from LinkedIn, Dice, Indeed, staffing portals, and company portals in one table.
- Use the bottom-right Search Assistant for targeted portal searches such as Infosys, Dice, LinkedIn, Kforce, Capgemini, Workday, Greenhouse, or all portals.
- Open the original job link.
- Paste JD text when available.
- Generate a tailored resume into `<appRoot>/resume/tailored resume`.
- Generate a cover letter into `<appRoot>/cover letters`.
- Mark a job as applied.

## Local Config

Copy `config.example.json` to `config.local.json` and update the paths for your laptop.

Copy `tools/build_resume_versions.example.py` to `tools/build_resume_versions.py` and replace the sample profile with your own resume details.

## Privacy

Runtime job data, activity logs, local config, and personal resume profiles are ignored by git. Keep generated resumes, cover letters, and job tracker exports out of public repositories unless you intentionally want to share them.
