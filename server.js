const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const url = require("url");

const PORT = Number(process.env.PORT || 8766);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const JOBS_PATH = path.join(DATA_DIR, "jobs.json");
const ACTIVITY_PATH = path.join(DATA_DIR, "activity.json");
const CONFIG_PATH = path.join(ROOT, "config.local.json");
const APP_SETTINGS_PATH = path.join(ROOT, "config.json");
const LAST_FINDER_REFRESH_PATH = path.join(ROOT, "logs", "last_refresh.txt");
const LAST_AUTO_REFRESH_PATH = path.join(ROOT, "logs", "last_auto_refresh.txt");

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
const BASE_RESUME_DIR = path.join(APP_ROOT, "resume", "base resume");
const PYTHON_EXE = process.env.PYTHON_EXE || CONFIG.pythonExe || (process.platform === "win32" ? "python" : "python3");

const RESUME_MATCH_SKILLS = [
 "Python", "Java", "JavaScript", "TypeScript", "C#", ".NET", "ASP.NET Core",
 "Node.js", "React", "Angular", "HTML", "CSS", "SQL", "SQL Server",
 "PostgreSQL", "MySQL", "MongoDB", "Redis", "REST API", "GraphQL",
 "FastAPI", "Django", "Flask", "Spring Boot", "Express", "OOP",
 "Data Structures", "System Design", "Microservices", "Machine Learning",
 "Deep Learning", "NLP", "LLM", "RAG", "Prompt Engineering", "OpenAI",
 "LangChain", "Vector Databases", "Embeddings", "Pandas", "NumPy",
 "Scikit-learn", "PyTorch", "TensorFlow", "MLflow", "Statistics",
 "Data Analysis", "Data Modeling", "ETL", "Spark", "Airflow", "dbt",
 "Snowflake", "BigQuery", "Databricks", "Power BI", "Tableau", "Excel",
 "AWS", "Azure", "GCP", "Cloud", "Docker", "Kubernetes", "Terraform",
 "CI/CD", "Azure DevOps", "GitHub Actions", "Linux", "Bash", "Monitoring",
 "Selenium", "Playwright", "Cypress", "Testing", "API Testing",
 "Security", "OWASP", "SIEM", "Cloud Security", "Networking",
 "Salesforce", "CRM", "Apex", "SOQL", "Lightning", "Figma", "UX Design",
 "User Research", "Wireframing", "Prototyping", "Agile", "Scrum", "Jira",
 "Stakeholder Management", "Communication", "Documentation",
];

const SKILL_ALIASES = {
 "C#": ["c#", "c sharp", "csharp"],
 ".NET": [".net", "dotnet"],
 "ASP.NET Core": ["asp.net core", "asp.net", "aspnet"],
 "Node.js": ["node.js", "nodejs", "node js"],
 "REST API": ["rest api", "restful api", "rest apis", "api development"],
 "CI/CD": ["ci/cd", "cicd", "continuous integration", "continuous deployment"],
 "GitHub Actions": ["github actions"],
 "Azure DevOps": ["azure devops"],
 "Power BI": ["power bi", "powerbi"],
 "Scikit-learn": ["scikit-learn", "sklearn"],
 "Vector Databases": ["vector database", "vector databases", "vector db"],
};

let resumeSkillCache = { key: "", skills: [] };

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
 { value: "indeed", label: "Indeed", tokens: ["indeed", "indeed.com"] },
 { value: "builtin", label: "BuiltIn", tokens: ["builtin", "built in"] },
 { value: "remotive", label: "Remotive", tokens: ["remotive"] },
 { value: "jobicy", label: "Jobicy", tokens: ["jobicy"] },
 { value: "the muse", label: "The Muse", tokens: ["the muse", "muse"] },
 { value: "wellfound", label: "Wellfound", tokens: ["wellfound", "wellfound.com"] },
 { value: "college recruiter", label: "College Recruiter", tokens: ["college recruiter", "collegerecruiter", "collegerecruiter.com"] },
 { value: "the forage", label: "The Forage", tokens: ["the forage", "forage", "theforage", "theforage.com"] },
 { value: "wayup", label: "WayUp", tokens: ["wayup", "wayup.com"] },
 { value: "handshake", label: "Handshake", tokens: ["handshake", "joinhandshake", "joinhandshake.com"] },
 { value: "adecco", label: "Adecco", tokens: ["adecco", "adecco usa", "adeccousa"] },
 { value: "manpowergroup", label: "ManpowerGroup", tokens: ["manpowergroup", "manpower group", "manpower"] },
 { value: "allegis group", label: "Allegis Group", tokens: ["allegis", "allegis group"] },
 { value: "kforce", label: "Kforce", tokens: ["kforce"] },
 { value: "vaco", label: "Vaco", tokens: ["vaco", "vaco.com"] },
 { value: "insight global", label: "Insight Global", tokens: ["insight global"] },
 { value: "tcs", label: "TCS Careers", tokens: ["tcs", "tcs careers"] },
 { value: "wipro", label: "Wipro Careers", tokens: ["wipro"] },
 { value: "capgemini", label: "Capgemini Careers", tokens: ["capgemini"] },
 { value: "teksystems", label: "TEKsystems", tokens: ["teksystems"] },
 { value: "akkodis", label: "Akkodis", tokens: ["akkodis"] },
 { value: "kelly services", label: "Kelly Services", tokens: ["kelly", "kelly services"] },
 { value: "robert half", label: "Robert Half", tokens: ["robert half"] },
 { value: "randstad", label: "Randstad", tokens: ["randstad"] },
 { value: "mondo", label: "Mondo", tokens: ["mondo", "mondo.com"] },
 { value: "apex systems", label: "Apex Systems", tokens: ["apex", "apex systems"] },
 { value: "collabera", label: "Collabera", tokens: ["collabera"] },
 { value: "motion recruitment", label: "Motion Recruitment", tokens: ["motion recruitment"] },
 { value: "judge group", label: "The Judge Group", tokens: ["judge", "judge group"] },
 { value: "experis", label: "Experis", tokens: ["experis"] },
 { value: "staffmark", label: "Staffmark", tokens: ["staffmark"] },
 { value: "hirequest", label: "HireQuest", tokens: ["hirequest", "hire quest"] },
 { value: "beacon hill", label: "Beacon Hill", tokens: ["beacon hill", "becon hill", "beaconhill", "bhsg"] },
 { value: "greenhouse", label: "Greenhouse", tokens: ["greenhouse"] },
 { value: "lever", label: "Lever", tokens: ["lever"] },
 { value: "workday", label: "Workday", tokens: ["workday"] },
 { value: "smartrecruiters", label: "SmartRecruiters", tokens: ["smartrecruiters", "smart recruiters"] },
 { value: "ashby", label: "Ashby", tokens: ["ashby"] },
 { value: "icims", label: "iCIMS", tokens: ["icims"] },
];

let autoRefreshAt = null;
let autoRefreshAdded = 0;
let autoRefreshNextAt = null;
let autoRefreshRunning = false;
let autoRefreshError = "";
let autoRefreshTimer = null;
const AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

function readIsoTimestamp(filePath) {
 try {
 const value = fs.readFileSync(filePath, "utf8").trim();
 return Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString();
 } catch {
 return null;
 }
}

async function saveAutoRefreshTimestamp(value) {
 await fsp.mkdir(path.dirname(LAST_AUTO_REFRESH_PATH), { recursive: true });
 await fsp.writeFile(LAST_AUTO_REFRESH_PATH, value, "utf8");
}


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

function extractUrl(message) {
 const match = String(message || "").match(/https?:\/\/[^\s"'<>]+|(?:www\.)[^\s"'<>]+/i);
 if (!match) return "";
 return match[0].replace(/[),.;]+$/, "");
}

function looksLikeJobDescription(message) {
 const text = String(message || "").toLowerCase();
 const jdSignals = [
 "job description",
 "responsibilities",
 "requirements",
 "qualifications",
 "experience in",
 "preferred qualifications",
 "minimum qualifications",
 "about the role",
 "what you will do",
 "what you'll do",
 "skills",
 ];
 return text.length > 120 && jdSignals.filter((signal) => text.includes(signal)).length >= 2;
}

function firstMatch(text, patterns) {
 for (const pattern of patterns) {
 const match = text.match(pattern);
 if (match?.[1]) return match[1].trim();
 }
 return "";
}

function inferRoleFromJd(message) {
 const text = String(message || "");
 const explicit = firstMatch(text, [
 /(?:job\s*title|title|role|position)\s*[:\-]\s*([^\n\r]+)/i,
 /re\s*:\s*([^\n\r]+)/i,
 ]);
 if (explicit) return explicit.slice(0, 90);
 const lines = text
 .split(/\r?\n/)
 .map((line) => line.replace(/^[\s\-**\d.]+/, "").trim())
 .filter(Boolean);
 const configuredTitles = readAppSettings().jobTitles || [];
 const configuredRole = configuredTitles.find((title) => text.toLowerCase().includes(String(title).toLowerCase()));
 if (configuredRole) return configuredRole;
 const roleLine = lines.find((line) =>
 /\b(accountant|administrator|analyst|architect|assistant|chef|consultant|coordinator|designer|developer|director|driver|engineer|manager|mechanic|nurse|operator|pharmacist|recruiter|scientist|specialist|technician|therapist|writer)\b/i.test(line)
 && line.length < 100
 );
 if (roleLine) return roleLine;
 return configuredTitles[0] || "Job";
}

function inferCompanyFromJd(message) {
 const company = firstMatch(String(message || ""), [
 /(?:company|client|organization)\s*[:\-]\s*([^\n\r]+)/i,
 /(?:at|with)\s+([A-Z][A-Za-z0-9&.,' -]{2,60})\s+(?:is|for|as|seeks|looking)/,
 ]);
 return (company || "Hiring Team").replace(/[.;,]+$/, "").slice(0, 80);
}

function inferLocationFromJd(message) {
 const location = firstMatch(String(message || ""), [
 /(?:location|work location)\s*[:\-]\s*([^\n\r]+)/i,
 ]);
 return (location || "United States").slice(0, 80);
}

function jdNotes(message) {
 return String(message || "")
 .replace(/\s+/g, " ")
 .trim()
 .slice(0, 420);
}

async function createAppliedJobFromJd(message) {
 const jobs = await loadJobs();
 const job = normalizeJob({
 id: `JOB-CHAT-${Date.now()}`,
 company: inferCompanyFromJd(message),
 role: inferRoleFromJd(message),
 source: "Chat JD",
 url: extractUrl(message),
 location: inferLocationFromJd(message),
 workMode: /remote/i.test(message) ? "Remote" : "Remote/Hybrid/Onsite not listed",
 employmentType: firstMatch(message, [/(?:employment type|job type)\s*[:\-]\s*([^\n\r]+)/i]) || "Not listed",
 pay: firstMatch(message, [/(?:pay|salary|rate)\s*[:\-]\s*([^\n\r]+)/i]) || "Not listed",
 fitScore: 95,
 status: "Ready to review",
 priority: "High",
 workAuthRisk: "Verify OPT EAD and future sponsorship/support",
 notes: jdNotes(message),
 jd: message,
 });
 jobs.unshift(job);
 await saveJobs(jobs);

 const result = await runGenerator(job, "resume");
 const patch = {
 status: "Applied",
 dateApplied: today(),
 generatedResumePath: result.resumePath || "",
 jdPath: result.jdPath || "",
 resumeUsedPath: result.resumePath || job.selectedResume || "",
 };
 const updated = await updateJob(job.id, patch);
 return { job: updated, result };
}

function sourceSummary(result) {
 const sourcesSearched = Number(result.sourcesSearched || Object.keys(result.sourceBreakdown || {}).length);
 const sourcesWithMatches = Number(
 result.sourcesWithMatches ||
 Object.values(result.sourceBreakdown || {}).filter((count) => Number(count) > 0).length
 );
 const activeSources = Object.entries(result.sourceBreakdown || {})
 .filter(([, count]) => Number(count) > 0)
 .sort((a, b) => Number(b[1]) - Number(a[1]))
 .slice(0, 5)
 .map(([source, count]) => `${source}: ${count}`)
 .join(", ");
 const coverage = `${sourcesSearched} portal${sourcesSearched === 1 ? "" : "s"} searched; ${sourcesWithMatches} returned matching jobs`;
 return activeSources ? `${coverage}. Top results: ${activeSources}` : coverage;
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

function companyUrlReply(companyUrl, result) {
 const added = Number(result.added || 0);
 const duplicates = Number(result.duplicatesSkipped || 0);
 const failures = (result.failures || []).length ? ` Failures: ${(result.failures || []).slice(0, 2).join("; ")}` : "";
 if (added > 0) {
 return `Scanned ${companyUrl}. Added ${added} U.S. matching jobs and skipped ${duplicates} duplicates.${failures}`;
 }
 return `Scanned ${companyUrl}. No new U.S. matching jobs were added; ${duplicates} duplicates were skipped.${failures}`;
}

async function readBody(req) {
 const chunks = [];
 for await (const chunk of req) chunks.push(chunk);
 const raw = Buffer.concat(chunks).toString("utf8");
 return raw ? JSON.parse(raw) : {};
}

async function readRawBody(req, maxBytes = 12 * 1024 * 1024) {
 const chunks = [];
 let total = 0;
 for await (const chunk of req) {
 total += chunk.length;
 if (total > maxBytes) throw new Error("Upload is too large. Please use a resume under 12 MB.");
 chunks.push(chunk);
 }
 return Buffer.concat(chunks);
}

function sanitizeUploadName(name) {
 const base = path.basename(String(name || "base_resume.docx"));
 const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
 return cleaned || "base_resume.docx";
}

function parseMultipartFile(buffer, contentType, fieldName) {
 const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
 if (!match) throw new Error("Invalid upload request");
 const boundary = Buffer.from(`--${match[1] || match[2]}`, "utf8");
 let cursor = 0;
 while (cursor < buffer.length) {
 const start = buffer.indexOf(boundary, cursor);
 if (start < 0) break;
 const next = buffer.indexOf(boundary, start + boundary.length);
 if (next < 0) break;
 let part = buffer.slice(start + boundary.length, next);
 if (part.slice(0, 2).equals(Buffer.from("\r\n"))) part = part.slice(2);
 if (part.slice(-2).equals(Buffer.from("\r\n"))) part = part.slice(0, -2);
 const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
 if (headerEnd > 0) {
 const header = part.slice(0, headerEnd).toString("utf8");
 const data = part.slice(headerEnd + 4);
 const disposition = /content-disposition:[^\r\n]+/i.exec(header)?.[0] || "";
 const name = /name="([^"]+)"/i.exec(disposition)?.[1] || "";
 const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] || "";
 if (name === fieldName && filename) return { filename, data };
 }
 cursor = next;
 }
 throw new Error("Choose a .docx file to upload.");
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
 const serialized = JSON.stringify(jobs, null, 2);
 // Atomic write: write to temp file first, then rename - prevents corruption
 const tmp = JOBS_PATH + ".tmp";
 await fsp.writeFile(tmp, serialized, "utf8");
 // Verify the temp file is valid before replacing
 const verify = await fsp.readFile(tmp, "utf8");
 JSON.parse(verify); // throws if corrupted - keeps old file intact
 // Backup (keep last 5)
 if (fs.existsSync(JOBS_PATH)) {
 const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
 await fsp.copyFile(JOBS_PATH, path.join(DATA_DIR, `jobs.bak.${stamp}.json`));
 const backups = (await fsp.readdir(DATA_DIR))
 .filter(n => n.startsWith("jobs.bak.") && n.endsWith(".json"))
 .sort();
 for (const old of backups.slice(0, -5))
 await fsp.unlink(path.join(DATA_DIR, old)).catch(() => {});
 }
 // Write verified content directly with explicit truncation (avoids null-byte padding from rename)
 await fsp.writeFile(JOBS_PATH, verify, { encoding: "utf8", flag: "w" });
 await fsp.unlink(tmp).catch(() => {});
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
 recruiterName: job.recruiterName || "",
 recruiterEmail: job.recruiterEmail || "",
 recruiterPhone: job.recruiterPhone || "",
 interviewDate: job.interviewDate || "",
 followUpDate: job.followUpDate || "",
 pipelineStage: job.pipelineStage || "",
 };
}

function isAppliedStatus(status) {
 return /\bapplied\b/i.test(status || "");
}

function pickResume(job) {
 return readAppSettings().defaultResume || "";
}

function readAppSettings() {
 try {
 return fs.existsSync(APP_SETTINGS_PATH) ? JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, "utf8")) : {};
 } catch {
 return {};
 }
}

function normalizeAppSettings(settings) {
 const next = { ...(settings || {}) };
 const baseResumePath = String(next.baseResumePath || "").trim();
 if (baseResumePath) {
 const resolved = path.resolve(baseResumePath);
 if (!fs.existsSync(resolved)) {
 throw new Error(`Base resume file not found: ${resolved}`);
 }
 const stat = fs.statSync(resolved);
 if (!stat.isFile() || path.extname(resolved).toLowerCase() !== ".docx") {
 throw new Error("Base resume must be an existing .docx file");
 }
 next.baseResumePath = resolved;
 next.defaultResume = path.basename(resolved);
 } else {
 next.baseResumePath = "";
 next.defaultResume = String(next.defaultResume || "");
 }
 return next;
}

function skillRegex(term) {
 const escaped = String(term).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
 return new RegExp(`(^|[^a-z0-9+#.])${escaped}($|[^a-z0-9+#.])`, "i");
}

function textHasSkill(text, skill) {
 const aliases = SKILL_ALIASES[skill] || [skill];
 return aliases.some((term) => skillRegex(term).test(text));
}

function jobSkillText(job) {
 return [
 job.role,
 job.company,
 job.source,
 job.location,
 job.employmentType,
 job.workMode,
 job.notes,
 job.jd,
 job.workAuthRisk,
 ].filter(Boolean).join(" ").toLowerCase();
}

function configuredSkills() {
 const settings = readAppSettings();
 return [
 ...(settings.mustHaveSkills || []),
 ...(settings.niceToHaveSkills || []),
 ].map((item) => String(item || "").trim()).filter(Boolean);
}

function allMatchSkills() {
 const seen = new Set();
 return [...RESUME_MATCH_SKILLS, ...configuredSkills()].filter((skill) => {
 const key = skill.toLowerCase();
 if (!skill || seen.has(key)) return false;
 seen.add(key);
 return true;
 });
}

function extractJobSkills(job) {
 const blob = jobSkillText(job);
 return allMatchSkills().filter((skill) => textHasSkill(blob, skill));
}

function runResumeSkillExtractor(baseResumePath) {
 return new Promise((resolve, reject) => {
 const extras = JSON.stringify(configuredSkills());
 const child = spawn(PYTHON_EXE, [path.join(ROOT, "tools", "extract_resume_skills.py"), baseResumePath, extras], {
 cwd: ROOT,
 stdio: ["ignore", "pipe", "pipe"],
 windowsHide: true,
 });
 let stdout = "";
 let stderr = "";
 child.stdout.on("data", (chunk) => (stdout += chunk));
 child.stderr.on("data", (chunk) => (stderr += chunk));
 child.on("close", (code) => {
 if (code !== 0) {
 reject(new Error(stderr || stdout || `Resume skill extractor exited with ${code}`));
 } else {
 try {
 resolve(JSON.parse(stdout).skills || []);
 } catch {
 reject(new Error(`Resume skill extractor returned invalid JSON: ${stdout}`));
 }
 }
 });
 });
}

async function getResumeSkills() {
 const settings = readAppSettings();
 const baseResumePath = settings.baseResumePath || "";
 if (!baseResumePath || !fs.existsSync(baseResumePath)) return [];
 const stat = await fsp.stat(baseResumePath);
 const key = `${baseResumePath}:${stat.mtimeMs}:${configuredSkills().join("|")}`;
 if (resumeSkillCache.key === key) return resumeSkillCache.skills;
 const skills = await runResumeSkillExtractor(baseResumePath);
 resumeSkillCache = { key, skills };
 return skills;
}

function withResumeMatch(job, resumeSkills) {
 const resumeSet = new Set((resumeSkills || []).map((skill) => String(skill).toLowerCase()));
 const jobSkills = extractJobSkills(job);
 const matched = jobSkills.filter((skill) => resumeSet.has(skill.toLowerCase()));
 const missing = jobSkills.filter((skill) => !resumeSet.has(skill.toLowerCase()));
 const score = jobSkills.length ? Math.round((matched.length / jobSkills.length) * 100) : null;
 return {
 ...job,
 resumeMatchScore: score,
 resumeMatchedSkills: matched,
 resumeMissingSkills: missing,
 resumeJobSkills: jobSkills,
 resumeMatchedSkillCount: matched.length,
 resumeMissingSkillCount: missing.length,
 resumeJobSkillCount: jobSkills.length,
 };
}

async function loadJobsWithResumeMatch() {
 const jobs = await loadJobs();
 try {
 const resumeSkills = await getResumeSkills();
 return jobs.map((job) => withResumeMatch(job, resumeSkills));
 } catch (error) {
 console.warn(`Could not compute resume match scores: ${error.message}`);
 return jobs.map((job) => ({
 ...job,
 resumeMatchScore: null,
 resumeMatchedSkills: [],
 resumeMissingSkills: extractJobSkills(job),
 resumeJobSkills: extractJobSkills(job),
 resumeMatchedSkillCount: 0,
 resumeMissingSkillCount: extractJobSkills(job).length,
 resumeJobSkillCount: extractJobSkills(job).length,
 }));
 }
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
 if (isAppliedStatus(existing.status) || existing.dateApplied) {
 continue;
 }
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
 const settings = readAppSettings();
 const child = spawn(PYTHON_EXE, [path.join(ROOT, "tools", "generate_documents.py"), kind, job.id], {
 cwd: ROOT,
 env: {
 ...process.env,
 JOB_APP_ROOT: APP_ROOT,
 JOB_TRACKER_CSV: CSV_SOURCE,
 DASHBOARD_JOBS: JOBS_PATH,
 BASE_RESUME_PATH: settings.baseResumePath || "",
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
 // Kill the process if it runs longer than 3 minutes
 const timeout = setTimeout(() => {
 child.kill("SIGKILL");
 reject(new Error("Job finder timed out after 3 minutes"));
 }, 3 * 60 * 1000);
 child.stdout.on("data", (chunk) => (stdout += chunk));
 child.stderr.on("data", (chunk) => (stderr += chunk));
 child.on("close", (code) => {
 clearTimeout(timeout);
 if (code !== 0) {
 reject(new Error(stderr || stdout || `Finder exited with ${code}`));
 } else {
 try {
 // Script may print multiple JSON objects if called twice; use the last one
 const trimmed = stdout.trim();
 const lastBrace = trimmed.lastIndexOf("\n{");
 const jsonStr = lastBrace >= 0 ? trimmed.slice(lastBrace + 1) : trimmed;
 resolve(JSON.parse(jsonStr));
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
 return sendJson(res, 200, { jobs: await loadJobsWithResumeMatch() });
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
 if (looksLikeJobDescription(message)) {
 const { job, result } = await createAppliedJobFromJd(message);
 await logActivity({
 type: "chat-jd-apply",
 jobId: job.id,
 message: `Generated tailored resume and marked applied: ${job.company} - ${job.role}`,
 });
 return sendJson(res, 200, {
 reply: `Created ${job.company} - ${job.role}, generated a tailored resume, and moved it to Applied.`,
 action: "jd_applied",
 job,
 result,
 });
 }
 const companyUrl = extractUrl(message);
 if (companyUrl) {
 const result = await runJobFinder(["--company-url", companyUrl]);
 await logActivity({
 type: "chat-company-url-search",
 message: `Chat scanned company URL ${companyUrl}: ${result.added || 0} added`,
 companyUrl,
 added: result.added || 0,
 duplicatesSkipped: result.duplicatesSkipped || 0,
 });
 return sendJson(res, 200, {
 reply: companyUrlReply(companyUrl, result),
 action: "company_url_search",
 companyUrl,
 result,
 });
 }
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
 reply: "Pick a portal or use a quick search chip. I can search Infosys, Dice, LinkedIn, Wellfound, Kforce, Vaco, Insight Global, Capgemini, Workday, Greenhouse, and more.",
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

 if (req.method === "GET" && pathname === "/api/auto-refresh-status") {
 const cutoffAt = autoRefreshAt || readIsoTimestamp(LAST_FINDER_REFRESH_PATH);
 return sendJson(res, 200, {
 at: autoRefreshAt,
 added: autoRefreshAdded,
 nextAt: autoRefreshNextAt,
 cutoffAt,
 running: autoRefreshRunning,
 error: autoRefreshError,
 intervalMinutes: AUTO_REFRESH_INTERVAL_MS / 60000,
 });
 }

 if (req.method === "GET" && pathname === "/api/app-config") {
 const ALL_SOURCES = [
 "Dice", "LinkedIn", "BuiltIn", "Remotive", "Jobicy", "The Muse", "Infosys Careers",
 "Greenhouse", "Lever", "SmartRecruiters", "Ashby", "Workday", "Wellfound", "Handshake",
 "Adecco", "ManpowerGroup", "Allegis Group", "Kforce", "TEKsystems", "Robert Half", "Insight Global",
 "Vaco", "Akkodis", "Kelly Services", "Mondo", "Randstad", "Apex Systems", "Collabera",
 "Motion Recruitment", "The Judge Group", "Experis", "Staffmark", "HireQuest", "Beacon Hill",
 "iCIMS", "Indeed",
 ];
 const defaults = {
 jobTitles: ["Software Engineer"],
 mustHaveSkills: [],
 niceToHaveSkills: [],
 remoteBoost: true,
 dailyTarget: 50,
 priorityThresholds: { high: 80, medium: 68 },
 minFitScore: 62,
 maxRequiredExperienceYears: 0,
 minimumHourlyPay: 0,
 minimumAnnualPay: 0,
 baseResumePath: "",
 defaultResume: "",
 searchDepth: 2,
 searchConcurrency: 64,
 searchTimeoutSeconds: 7,
 excludedTitlePatterns: ["manager", "principal engineer"],
 enabledSources: ALL_SOURCES,
 };
 try {
 const raw = fs.existsSync(APP_SETTINGS_PATH) ? JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, "utf8")) : {};
 return sendJson(res, 200, { ...defaults, ...raw });
 } catch {
 return sendJson(res, 200, defaults);
 }
 }

 if (req.method === "POST" && pathname === "/api/base-resume") {
 try {
 const raw = await readRawBody(req);
 const uploaded = parseMultipartFile(raw, req.headers["content-type"], "baseResume");
 const originalName = sanitizeUploadName(uploaded.filename);
 if (path.extname(originalName).toLowerCase() !== ".docx") {
 return sendJson(res, 400, { error: "Base resume upload must be a .docx file." });
 }
 if (!uploaded.data.slice(0, 2).equals(Buffer.from("PK"))) {
 return sendJson(res, 400, { error: "Uploaded file does not look like a valid .docx file." });
 }
 await fsp.mkdir(BASE_RESUME_DIR, { recursive: true });
 const stampedName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${originalName}`;
 const outPath = path.join(BASE_RESUME_DIR, stampedName);
 await fsp.writeFile(outPath, uploaded.data);
 const merged = normalizeAppSettings({ ...readAppSettings(), baseResumePath: outPath });
 const serialised = JSON.stringify(merged, null, 2);
 await fsp.writeFile(APP_SETTINGS_PATH, serialised, { encoding: "utf8", flag: "w" });
 resumeSkillCache = { key: "", skills: [] };
 return sendJson(res, 200, {
 ok: true,
 baseResumePath: merged.baseResumePath,
 defaultResume: merged.defaultResume,
 config: merged,
 });
 } catch (error) {
 return sendJson(res, 400, { error: error.message || String(error) });
 }
 }

 if (req.method === "POST" && pathname === "/api/app-config") {
 const body = await readBody(req);
 let normalized;
 try {
 normalized = normalizeAppSettings(body);
 } catch (error) {
 return sendJson(res, 400, { error: error.message || String(error) });
 }
 const serialised = JSON.stringify(normalized, null, 2);
 // Verify before writing (prevents corrupt config on bad payloads)
 JSON.parse(serialised);
 const tmp = APP_SETTINGS_PATH + ".tmp";
 await fsp.writeFile(tmp, serialised, { encoding: "utf8" });
 await fsp.writeFile(APP_SETTINGS_PATH, serialised, { encoding: "utf8", flag: "w" });
 await fsp.unlink(tmp).catch(() => {});
 return sendJson(res, 200, { ok: true, config: normalized });
 }

 if (req.method === "POST" && pathname === "/api/jobs/bulk") {
 const body = await readBody(req);
 const { action, ids } = body;
 if (!Array.isArray(ids) || !ids.length) return sendJson(res, 400, { error: "ids required" });
 const jobs = await loadJobs();
 let count = 0;
 if (action === "delete") {
 const idSet = new Set(ids);
 const before = jobs.length;
 const remaining = jobs.filter((j) => !idSet.has(j.id));
 count = before - remaining.length;
 await saveJobs(remaining);
 } else if (action === "mark-applied") {
 for (const job of jobs) {
 if (ids.includes(job.id) && !isAppliedStatus(job.status)) {
 Object.assign(job, normalizeJob({ ...job, status: "Applied", dateApplied: job.dateApplied || today() }));
 count++;
 }
 }
 await saveJobs(jobs);
 }
 await logActivity({ type: `bulk-${action}`, message: `Bulk ${action}: ${count} jobs` });
 return sendJson(res, 200, { ok: true, count });
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
 if (req.method === "DELETE" && !action) {
 const jobs = await loadJobs();
 const index = jobs.findIndex((item) => item.id === id);
 if (index < 0) return notFound(res);
 const [removed] = jobs.splice(index, 1);
 await saveJobs(jobs);
 await logActivity({ type: "delete", jobId: id, message: `Deleted ${removed.company} - ${removed.role}` });
 return sendJson(res, 200, { ok: true });
 }

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
 if (result.baseResumePath) {
 patch.selectedResume = path.basename(result.baseResumePath);
 patch.resumeUsedPath = result.resumePath || result.baseResumePath;
 }
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

function scheduleNextAutoRefresh(delay = AUTO_REFRESH_INTERVAL_MS) {
 if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
 autoRefreshNextAt = new Date(Date.now() + delay).toISOString();
 autoRefreshTimer = setTimeout(runAutoRefresh, delay);
}

async function runAutoRefresh() {
 if (autoRefreshRunning) {
 scheduleNextAutoRefresh();
 return;
 }
 autoRefreshRunning = true;
 autoRefreshError = "";
 try {
 const cutoff = autoRefreshAt || readIsoTimestamp(LAST_FINDER_REFRESH_PATH) || new Date(Date.now() - AUTO_REFRESH_INTERVAL_MS).toISOString();
 const result = await runJobFinder(["--posted-after", cutoff]);
 const skipped = (result.failures || []).some((message) => /previous job finder run is still active/i.test(message));
 if (skipped) {
 autoRefreshError = "Skipped because another search was running";
 console.log(`Auto-refresh skipped: ${autoRefreshError}`);
 } else {
 autoRefreshAt = new Date().toISOString();
 await saveAutoRefreshTimestamp(autoRefreshAt);
 autoRefreshAdded = Number(result.added || 0);
 await logActivity({
 type: "auto-refresh",
 message: `Hourly auto-refresh added ${autoRefreshAdded} jobs`,
 added: autoRefreshAdded,
 duplicatesSkipped: Number(result.duplicatesSkipped || 0),
 });
 console.log(`Auto-refresh: ${autoRefreshAdded} new jobs added`);
 }
 } catch (error) {
 autoRefreshError = error.message || String(error);
 console.error("Auto-refresh failed:", autoRefreshError);
 } finally {
 autoRefreshRunning = false;
 scheduleNextAutoRefresh();
 }
}

function scheduleAutoRefresh() {
 autoRefreshAt = readIsoTimestamp(LAST_AUTO_REFRESH_PATH);
 scheduleNextAutoRefresh();
}

ensureData()
 .then(() => {
 server.listen(PORT, "127.0.0.1", () => console.log(`Job dashboard running at http://127.0.0.1:${PORT}`));
 scheduleAutoRefresh();
 })
 .catch((error) => {
 console.error(error);
 process.exit(1);
 });


