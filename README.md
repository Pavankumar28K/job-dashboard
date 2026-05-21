# Job Application Dashboard

Local dashboard for Venkatesh Dorolla's job application workflow.

## Start

```powershell
cd "C:\Users\16605\Desktop\job application\job dashboard"
& "C:\Users\16605\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\server.js
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
- Generate a tailored resume into:
  `C:\Users\16605\Desktop\job application\resume\tailored resume`
- Generate a cover letter into:
  `C:\Users\16605\Desktop\job application\cover letters`
- Mark a job as applied.

The app imports the daily CSV at:

`C:\Users\16605\Documents\Codex\2026-05-13\if-i-upload-resume-will-you\tracker\Venkatesh_Dorolla_Job_Tracker.csv`

## Privacy

Runtime job data, activity logs, and local server files are ignored by git. Keep generated resumes, cover letters, and job tracker exports out of public repositories unless you intentionally want to share them.
