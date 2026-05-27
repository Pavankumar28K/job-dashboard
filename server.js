const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const url = require("url");

const PORT = Number(process.env.PORT || 8765);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const JOBS_PATH = path.join(DATA_DIR, "jobs.json");
const ACTIVITY_PATH = path.join(DATA_DIR, "activity.json");
const CONFIG_PATH = path.join(ROOT, "config.local.json");

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    console.warn(`Could not read config.local.json: ${error.message}`);
    return {};
  }
}

function resolvePath(value, fallback) {
  const selected = value || fallback;
  return path.resolve(String(selected).replace(/^~(?=$|[\\/])/, os.homedir()));
}

const CONFIG = readConfig();
const APP_ROOT = resolvePath(process.env.JOB_APP_ROOT || CONFIG.appRoot, path.join(os.homedir(), "Desktop", "job application"));
const CSV_SOURCE = resolvePath(
  process.env.JOB_TRACKER_CSV || CONFIG.trackerCsv,
  path.join(APP_ROOT, "tracker", "job_tracker.csv")
);
const PYTHON_EXE = process.env.PYTHON_EXE || CONFIG.pythonExe || (process.platform === "win32" ? "python" : "python3");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const PORTAL_OPTIONS = [
  { value: "infosys", label: "Infosys Careers", tokens: ["infosys", "infosys careers", "career.infosys"] },
  { value: "dice", label: "Dice", tokens: ["dice"] },
  { value: "linkedin", label: "LinkedIn", tokens: ["linkedin", "linked in"] },
  { value: "simplyhired", label: "SimplyHired", tokens: ["simplyhired", "simply hired"] },
  { value: "builtin", label: "BuiltIn", tokens: ["builtin", "built in"] },
  { value: "remotive", label: "Remotive", tokens: ["remotive"] },
  { value: "jobicy", label: "Jobicy", tokens: ["jobicy"] },
  { value: "himalayas", label: "Himalayas", tokens: ["himalayas"] },
  { value: "the muse", label: "The Muse", tokens: ["the muse", "muse"] },
  { value: "kforce", label: "Kforce", tokens: ["kforce"] },
  { value: "insight global", label: "Insight Global", tokens: ["insight global"] },
  { value: "tcs", label: "TCS Careers", tokens: ["tcs", "tcs careers"] },
  { value: "wipro", label: "Wipro Careers", tokens: ["wipro"] },
  { value: "capgemini", label: "Capgemini Careers", tokens: ["capgemini"] },
  { value: "teksystems", label: "TEKsystems", tokens: ["teksystems"] },
  { value: "akkodis", label: "Akkodis", tokens: ["akkodis"] },
  { value: "robert half", label: "Robert Half", tokens: ["robert half"] },
  { value: "randstad", label: "Randstad", tokens: ["randstad"] },
  { value: "apex systems", label: "Apex Systems", tokens: ["apex", "apex systems"] },
  { value: "collabera", label: "Collabera", tokens: ["collabera"] },
  { value: "motion recruitment", label: "Motion Recruitment", tokens: ["motion recruitment"] },
  { value: "judge group", label: "The Judge Group", tokens: ["judge", "judge group"] },
  { value: "experis", label: "Experis", tokens: ["experis"] },
  { value: "greenhouse", label: "Greenhouse", tokens: ["greenhouse"] },
  { value: "lever", label: "Lever", tokens: ["lever"] },
  { value: "workday", label: "Workday", tokens: ["workday"] },
  { value: "smartrecruiters", label: "SmartRecruiters", tokens: ["smartrecruiters", "smart recruiters"] },
  { value: "ashby", label: "Ashby", tokens: ["ashby"] },
  { value: "icims", label: "iCIMS", tokens: ["icims"] },
];

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function compactText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function inferPortal(message) {
  const compact = compactText(message);
  if (!compact) return null;
  return PORTAL_OPTIONS.find((portal) => portal.tokens.some((token) => compact.includes(compactText(token)))) || null;
}

function wantsFullSearch(message) {
  const compact = compactText(message);
  return ["allportals", "alljobs", "fullmarket", "entireweb", "searchweb", "webportals"].some((token) => compact.includes(token));
}

function sourceSummary(result) {
  const activeSources = Object.entries(result.sourceBreakdown || {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 5)
    .map(([source, count]) => `${source}: ${count}`)
    .join(", ");
  const searched = Number(result.requestsSearched || 0);
  return activeSources || `${searched} source request${searched === 1 ? "" : "s"} searched`;
}

function chatReply(label, result) {
  const added = Number(result.added || 0);
  const duplicates = Number(result.duplicatesSkipped || 0);
  const summary = sourceSummary(result);
  if (added > 0) {
    return `Searched ${label}. Added ${added} new matching jobs and skipped ${duplicates} already saved jobs. ${summary}.`;
  }
  return `Searched ${label}. No new matching jobs were added; ${duplicates} jobs were already saved or duplicates. ${summary}.`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function ensureData() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (!fs.existsSync(JOBS_PATH)) {
    const imported = fs.existsSync(CSV_SOURCE) ? parseJobsCsv(await fsp.readFile(CSV_SOURCE, "utf8")) : [];
    await saveJobs(imported);
  }
  if (!fs.existsSync(ACTIVITY_PATH)) {
    await fsp.writeFile(ACTIVITY_PATH, "[]", "utf8");
  }
}

async function loadJobs() {
  await ensureData();
  return JSON.parse(await fsp.readFile(JOBS_PATH, "utf8")).map(normalizeJob);
}

async function saveJobs(jobs) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(JOBS_PATH, JSON.stringify(jobs, null, 2), "utf8");
}

async function logActivity(event) {
  await ensureData();
  const activity = JSON.parse(await fsp.readFile(ACTIVITY_PATH, "utf8"));
  activity.unshift({ at: new Date().toISOString(), ...event });
  await fsp.writeFile(ACTIVITY_PATH, JSON.stringify(activity.slice(0, 200), null, 2), "utf8");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseJobsCsv(text) {
  const rows = parseCsv(text);
  const headers = (rows.shift() || []).map((header) => header.replace(/^\uFEFF/, "").trim());
  const get = (obj, name) => obj[name] || "";
  return rows.map((row) => {
    const obj = Object.fromEntries(headers.map((header, index) => [header, (row[index] || "").trim()]));
    return normalizeJob({
      id: get(obj, "ID"),
      dateFound: get(obj, "DateFound"),
      datePosted: get(obj, "DatePosted"),
      company: get(obj, "Company"),
      role: get(obj, "Role"),
      source: get(obj, "Source"),
      url: get(obj, "URL"),
      location: get(obj, "Location"),
      workMode: get(obj, "WorkMode"),
      employmentType: get(obj, "EmploymentType"),
      pay: get(obj, "Pay"),
      fitScore: Number(get(obj, "FitScore") || 0),
      selectedResume: get(obj, "SelectedResume"),
      status: get(obj, "Status") || "Ready to review",
      priority: get(obj, "Priority") || "Medium",
      workAuthRisk: get(obj, "WorkAuthRisk"),
      notes: get(obj, "Notes"),
      jd: "",
      jdPath: "",
      generatedResumePath: "",
      generatedCoverPath: "",
      resumeUsedPath: "",
      dateApplied: "",
    });
  });
}

function normalizeJob(job) {
  const id = job.id || `JOB-${Date.now()}`;
  const status = job.status || "Ready to review";
  const generatedResumePath = job.generatedResumePath || "";
  const selectedResume = job.selectedResume || pickResume(job);
  return {
    id,
    dateFound: job.dateFound || today(),
    datePosted: job.datePosted || "",
    company: job.company || "",
    role: job.role || "",
    source: job.source || "",
    url: job.url || "",
    location: job.location || "",
    workMode: job.workMode || "",
    employmentType: job.employmentType || "",
    pay: job.pay || "",
    fitScore: Number(job.fitScore || 0),
    selectedResume,
    status,
    priority: job.priority || "Medium",
    workAuthRisk: job.workAuthRisk || "",
    notes: job.notes || "",
    jd: job.jd || "",
    jdPath: job.jdPath || "",
    generatedResumePath,
    generatedCoverPath: job.generatedCoverPath || "",
    resumeUsedPath: job.resumeUsedPath || (isAppliedStatus(status) ? generatedResumePath || selectedResume : ""),
    dateApplied: job.dateApplied || "",
  };
}

function isAppliedStatus(status) {
  return /\bapplied\b/i.test(status || "");
}

function pickResume(job) {
  const haystack = `${job.role || ""} ${job.notes || ""} ${job.jd || ""}`.toLowerCase();
  if (/(azure openai|ai|rag|genai|agent|machine learning|ml)/.test(haystack)) {
    return "Candidate_FullStack_NET_Cloud_AI.docx";
  }
  return "Candidate_FullStack_NET_Cloud.docx";
}

function cleanTextKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    if (!parsed.hostname.toLowerCase().includes("career.infosys.com")) {
      parsed.search = "";
    }
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return cleanTextKey(value);
  }
}

function jobDedupeKey(job) {
  const urlKey = canonicalUrl(job.url);
  if (urlKey) return `url:${urlKey}`;
  return `text:${[job.company, job.role, job.location].map(cleanTextKey).join("|")}`;
}

async function mergeCsvJobs() {
  if (!fs.existsSync(CSV_SOURCE)) return { imported: 0, added: 0, updated: 0 };
  const incoming = parseJobsCsv(await fsp.readFile(CSV_SOURCE, "utf8"));
  const jobs = await loadJobs();
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const byKey = new Map(jobs.map((job) => [jobDedupeKey(job), job]));
  let added = 0;
  let updated = 0;
  for (const job of incoming) {
    const existing = byId.get(job.id) || byKey.get(jobDedupeKey(job));
    if (existing) {
      Object.assign(existing, {
        ...job,
        id: existing.id,
        dateFound: existing.dateFound || job.dateFound,
        status: existing.status || job.status,
        jd: existing.jd || job.jd,
        jdPath: existing.jdPath || job.jdPath,
        generatedResumePath: existing.generatedResumePath,
        generatedCoverPath: existing.generatedCoverPath,
        resumeUsedPath: existing.resumeUsedPath,
        dateApplied: existing.dateApplied,
      });
      updated++;
    } else {
      jobs.push(job);
      byId.set(job.id, job);
      byKey.set(jobDedupeKey(job), job);
      added++;
    }
  }
  await saveJobs(jobs);
  await logActivity({ type: "import", message: `Imported ${incoming.length} jobs from CSV`, added, updated });
  return { imported: incoming.length, added, updated };
}

function runGenerator(job, kind) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_EXE, [path.join(ROOT, "tools", "generate_documents.py"), kind, job.id], {
      cwd: ROOT,
      env: {
        ...process.env,
        JOB_APP_ROOT: APP_ROOT,
        JOB_TRACKER_CSV: CSV_SOURCE,
        DASHBOARD_JOBS: JOBS_PATH,
        RESUME_PROFILE_DIR: path.join(ROOT, "tools"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Generator exited with ${code}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Generator returned invalid JSON: ${stdout}`));
        }
      }
    });
  });
}

function runJobFinder(args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_EXE, [path.join(ROOT, "tools", "find_jobs.py"), ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        JOB_APP_ROOT: APP_ROOT,
        JOB_TRACKER_CSV: CSV_SOURCE,
        DASHBOARD_JOBS: JOBS_PATH,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Finder exited with ${code}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Finder returned invalid JSON: ${stdout}`));
        }
      }
    });
  });
}

async function updateJob(id, patch) {
  const jobs = await loadJobs();
  const job = jobs.find((item) => item.id === id);
  if (!job) return null;
  Object.assign(job, normalizeJob({ ...job, ...patch, id }));
  if (isAppliedStatus(job.status) && !job.resumeUsedPath) {
    job.resumeUsedPath = job.generatedResumePath || job.selectedResume || "";
  }
  await saveJobs(jobs);
  return job;
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/jobs") {
    return sendJson(res, 200, { jobs: await loadJobs() });
  }

  if (req.method === "GET" && pathname === "/api/activity") {
    await ensureData();
    return sendJson(res, 200, { activity: JSON.parse(await fsp.readFile(ACTIVITY_PATH, "utf8")) });
  }

  if (req.method === "GET" && pathname === "/api/folders") {
    return sendJson(res, 200, {
      appRoot: APP_ROOT,
      tailoredResume: path.join(APP_ROOT, "resume", "tailored resume"),
      coverLetters: path.join(APP_ROOT, "cover letters"),
      jobDescriptions: path.join(APP_ROOT, "job descriptions"),
      standardResume: path.join(APP_ROOT, "resume", "standard resume"),
      csvSource: CSV_SOURCE,
    });
  }

  if (req.method === "POST" && pathname === "/api/import-csv") {
    return sendJson(res, 200, await mergeCsvJobs());
  }

  if (req.method === "POST" && pathname === "/api/find-jobs") {
    const result = await runJobFinder();
    await logActivity({
      type: "find-jobs",
      message: `Finder added ${result.added || 0} jobs; skipped ${result.duplicatesSkipped || 0} duplicates`,
      added: result.added || 0,
      duplicatesSkipped: result.duplicatesSkipped || 0,
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/chat") {
    const body = await readBody(req);
    const message = String(body.message || "").trim();
    if (wantsFullSearch(message)) {
      const result = await runJobFinder();
      await logActivity({
        type: "chat-full-search",
        message: `Chat searched all portals: ${result.added || 0} added`,
        added: result.added || 0,
        duplicatesSkipped: result.duplicatesSkipped || 0,
      });
      return sendJson(res, 200, {
        reply: chatReply("all portals", result),
        action: "full_search",
        portal: "All portals",
        result,
      });
    }
    const portal = inferPortal(message);
    if (!portal) {
      return sendJson(res, 200, {
        reply: "Pick a portal or use a quick search chip. I can search Infosys, Dice, LinkedIn, Kforce, Capgemini, Workday, Greenhouse, and more.",
        action: "need_portal",
      });
    }
    const result = await runJobFinder(["--portal", portal.value]);
    await logActivity({
      type: "chat-portal-search",
      message: `Chat searched ${portal.label}: ${result.added || 0} added`,
      portal: portal.label,
      added: result.added || 0,
      duplicatesSkipped: result.duplicatesSkipped || 0,
    });
    return sendJson(res, 200, {
      reply: chatReply(portal.label, result),
      action: "portal_search",
      portal: portal.label,
      result,
    });
  }

  if (req.method === "POST" && pathname === "/api/jobs") {
    const body = await readBody(req);
    const jobs = await loadJobs();
    const job = normalizeJob({ ...body, id: body.id || `JOB-MANUAL-${Date.now()}` });
    jobs.unshift(job);
    await saveJobs(jobs);
    await logActivity({ type: "add", jobId: job.id, message: `Added ${job.company} - ${job.role}` });
    return sendJson(res, 201, { job });
  }

  const match = pathname.match(/^\/api\/jobs\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return notFound(res);

  const id = decodeURIComponent(match[1]);
  const action = match[2];
  if (req.method === "PATCH" && !action) {
    const body = await readBody(req);
    const job = await updateJob(id, body);
    if (!job) return notFound(res);
    await logActivity({ type: "update", jobId: id, message: `Updated ${job.company} - ${job.role}` });
    return sendJson(res, 200, { job });
  }

  if (req.method === "POST" && action === "mark-applied") {
    const jobs = await loadJobs();
    const current = jobs.find((item) => item.id === id);
    if (!current) return notFound(res);
    const job = await updateJob(id, {
      status: "Applied",
      dateApplied: current.dateApplied || today(),
      resumeUsedPath: current.resumeUsedPath || current.generatedResumePath || current.selectedResume || "",
    });
    if (!job) return notFound(res);
    await logActivity({ type: "applied", jobId: id, message: `Marked applied: ${job.company} - ${job.role}` });
    return sendJson(res, 200, { job });
  }

  if (req.method === "POST" && action === "generate") {
    const body = await readBody(req);
    const jobs = await loadJobs();
    const job = jobs.find((item) => item.id === id);
    if (!job) return notFound(res);
    Object.assign(job, normalizeJob({ ...job, ...body, id }));
    await saveJobs(jobs);
    const result = await runGenerator(job, body.kind || "all");
    const patch = {};
    if (result.resumePath) patch.generatedResumePath = result.resumePath;
    if (result.coverPath) patch.generatedCoverPath = result.coverPath;
    if (result.jdPath) patch.jdPath = result.jdPath;
    const updated = await updateJob(id, patch);
    await logActivity({ type: "generate", jobId: id, message: `Generated ${body.kind || "documents"} for ${job.company}` });
    return sendJson(res, 200, { job: updated, result });
  }

  return notFound(res);
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) return notFound(res);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return notFound(res);
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url);
    const pathname = decodeURIComponent(parsed.pathname || "/");
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
    } else {
      await serveStatic(req, res, pathname);
    }
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || String(error) });
  }
});

ensureData()
  .then(() => server.listen(PORT, "127.0.0.1", () => console.log(`Job dashboard running at http://127.0.0.1:${PORT}`)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
