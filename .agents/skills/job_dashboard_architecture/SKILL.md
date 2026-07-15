---
name: job-dashboard-architecture
description: Activates when working on the Job Dashboard project. Provides the agent with the complete architectural map, workflows, and starting instructions so the agent does not need to explore the codebase from scratch, saving significant tokens.
---

# Job Dashboard Architecture & Workflow

You are working on the **Job Dashboard** project located at `C:\Users\konat\job-dashboard`. 
Do NOT spend tokens exploring the codebase to understand the architecture. Read this document instead.

## 1. Project Structure
- **Frontend**: Vanilla HTML/CSS/JS.
  - `public/index.html`: The main user interface.
  - `public/app.js`: The frontend logic, including API calls to the local Node backend, modal management, and UI rendering.
  - `public/index.css`: Styling.
- **Backend**: Vanilla Node.js (NO Express).
  - `server.js`: Starts an HTTP server on port `8765`. Handles API endpoints (`/api/jobs`, `/api/suggest-skills`, `/api/generate-documents`, etc.).
  - Reads/Writes JSON files to the `data/` directory.
- **Data Store**:
  - `data/activity.json`: Tracks applied jobs, dates, and metrics.
  - `data/ai_skills_cache.json`: Caches AI skill suggestions to save OpenAI tokens.
  - `config.json`: Saves user settings (e.g., OpenAI API Key).
- **Python Scripts (Tools)**:
  - `tools/generate_documents.py`: A Python script invoked by `server.js` using `child_process.spawn`. It uses the `python-docx` and `openai` libraries to generate AI-tailored resumes based on the Job Description. It uses Single-Pass Batch Prompting to send the JD and resume structure to `gpt-4o-mini` in one go.

## 2. Core Workflows
- **Suggest Skills**: User inputs job titles -> `public/app.js` calls `/api/suggest-skills` -> `server.js` checks `data/ai_skills_cache.json` -> if cache miss, queries `gpt-4o-mini` -> returns JSON skills (Must-Have, Nice-To-Have, Soft Skills).
- **Generate Resume**: User pastes a Job Description -> `public/app.js` calls `/api/generate-documents` -> `server.js` spawns `python tools/generate_documents.py` -> Python script reads the base resume, asks OpenAI to rewrite it to match the JD, and saves a new `.docx` file in the `out/` directory.

## 3. How to Run the App
- Run `node server.js` in the `job-dashboard` root directory.
- The app runs locally at `http://127.0.0.1:8765`.
- Do NOT use `npm start` or any other framework commands. This is a Vanilla Node.js app.

## 4. Agent Instructions for this Workspace
- When the user asks you to modify the UI, look in `public/app.js` or `public/index.html`.
- When the user asks you to modify an API endpoint, look in `server.js`.
- When the user asks you to modify resume generation logic, look in `tools/generate_documents.py`.
- **Always** verify changes by testing against the running Node server (or restarting it if you modified backend code).
