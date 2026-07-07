const CHAT_MODE_KEY = "jobDashboardChatMode";

const state = {
 jobs: [],
 selectedId: null,
 folders: {},
 query: "",
 status: "all",
  type: "all",
 priority: "all",
 source: "all",
 date: todayString(),
 lastRefreshAt: null,
 view: "daily",
 chatMode: localStorage.getItem(CHAT_MODE_KEY) || "open",
 chatMessages: [newChatMessage("assistant", "Ready for portal search.")],
 chatBusy: false,
 bulkSelected: new Set(),
 autoRefreshAt: null,
 autoRefreshNextAt: null,
 autoRefreshRunning: false,
};

let homeGraphRange = "14d"; // "7d" | "14d" | "30d"

let DAILY_TARGET = 50;
let appConfig = {};

async function loadAppConfig() {
 try {
 appConfig = await api("/api/app-config");
 DAILY_TARGET = Number(appConfig.dailyTarget) || 50;
 } catch {
 // use defaults
 }
}

const SOURCE_GROUPS = {
  startup: ["Y Combinator", "Otta", "Wellfound"],
 direct: ["Dice", "LinkedIn", "BuiltIn", "Remotive", "Jobicy", "The Muse", "Infosys Careers", "SimplyHired", "ZipRecruiter", "Glassdoor", "Hugging Face", "Remote OK", "We Work Remotely", "FlexJobs", "TechCareers", "Relocate.me", "Levels.fyi"],
 ats: ["Greenhouse", "Lever", "SmartRecruiters", "Ashby", "Workday", "Handshake"],
 staffing: ["Adecco", "ManpowerGroup", "Allegis Group", "Kforce", "TEKsystems", "Robert Half", "Insight Global",
 "Vaco", "Akkodis", "Kelly Services", "Mondo", "Randstad", "Apex Systems", "Collabera",
 "Motion Recruitment", "The Judge Group", "Experis", "Staffmark", "HireQuest", "Beacon Hill", "iCIMS", "Indeed"],
};
const ALL_SOURCES = [...SOURCE_GROUPS.startup, ...SOURCE_GROUPS.direct, ...SOURCE_GROUPS.ats, ...SOURCE_GROUPS.staffing];

function renderSourceCheckboxes(enabledSet) {
 const groupMap = { direct: "boardsGroupDirect", ats: "boardsGroupAts", staffing: "boardsGroupStaffing" };
 for (const [group, ids] of Object.entries(SOURCE_GROUPS)) {
 const container = $("#" + groupMap[group]);
 if (!container) continue;
 container.innerHTML = SOURCE_GROUPS[group].map((src) => `
 <label class="board-check-label" title="${src}">
 <input type="checkbox" name="source_${src}" ${enabledSet.has(src) ? "checked" : ""} />
 ${src}
 </label>
 `).join("");
 }
}

function getCheckedSources() {
 return ALL_SOURCES.filter((src) => {
 const el = document.querySelector(`input[name="source_${src}"]`);
 return el && el.checked;
 });
}

async function openSettings() {
 await loadAppConfig();
 const cfg = appConfig;
 $("#settingsTitles").value = (cfg.jobTitles || []).join("\n");
 $("#settingsMustHave").value = (cfg.mustHaveSkills || []).join(", ");
 $("#settingsNiceToHave").value = (cfg.niceToHaveSkills || []).join(", ");
 $("#settingsDailyTarget").value = cfg.dailyTarget || 50;
 $("#settingsMinScore").value = cfg.minFitScore || 62;
 $("#settingsHighThresh").value = cfg.priorityThresholds?.high || 80;
 $("#settingsMediumThresh").value = cfg.priorityThresholds?.medium || 68;
 $("#settingsMaxExperience").value = cfg.maxRequiredExperienceYears || 0;
 $("#settingsMinHourlyPay").value = cfg.minimumHourlyPay || 0;
 $("#settingsMinAnnualPay").value = cfg.minimumAnnualPay || 0;
 $("#settingsBaseResumePath").value = cfg.baseResumePath || "";
 $("#settingsBaseResumeFile").value = "";
 $("#settingsBaseResumeStatus").textContent = cfg.baseResumePath
 ? `Current base resume: ${fileName(cfg.baseResumePath)}`
 : "Resume match scores will be calculated from the uploaded file.";
 $("#settingsSearchDepth").value = cfg.searchDepth || 2;
 $("#settingsSearchConcurrency").value = cfg.searchConcurrency || 64;
 $("#settingsSearchTimeout").value = cfg.searchTimeoutSeconds || 7;
 $("#settingsRemoteBoost").checked = cfg.remoteBoost !== false;
 const enabledSet = new Set(cfg.enabledSources || ALL_SOURCES);
 renderSourceCheckboxes(enabledSet);
 $("#settingsDialog").showModal();
}

async function saveSettings() {
 const splitLines = (val) => val.split("\n").map((s) => s.trim()).filter(Boolean);
 const splitCommas = (val) => val.split(",").map((s) => s.trim()).filter(Boolean);
 const fileInput = $("#settingsBaseResumeFile");
 let baseResumePath = $("#settingsBaseResumePath").value.trim();
 const payload = {
 jobTitles: splitLines($("#settingsTitles").value),
 mustHaveSkills: splitCommas($("#settingsMustHave").value),
 niceToHaveSkills: splitCommas($("#settingsNiceToHave").value),
 dailyTarget: Number($("#settingsDailyTarget").value) || 50,
 minFitScore: Number($("#settingsMinScore").value) || 62,
 priorityThresholds: {
 high: Number($("#settingsHighThresh").value) || 80,
 medium: Number($("#settingsMediumThresh").value) || 68,
 },
 remoteBoost: $("#settingsRemoteBoost").checked,
 maxRequiredExperienceYears: Number($("#settingsMaxExperience").value) || 0,
 minimumHourlyPay: Number($("#settingsMinHourlyPay").value) || 0,
 minimumAnnualPay: Number($("#settingsMinAnnualPay").value) || 0,
 baseResumePath,
 searchDepth: Number($("#settingsSearchDepth").value) || 2,
 searchConcurrency: Number($("#settingsSearchConcurrency").value) || 64,
 searchTimeoutSeconds: Number($("#settingsSearchTimeout").value) || 7,
 excludedTitlePatterns: appConfig.excludedTitlePatterns || ["manager", "principal engineer"],
 enabledSources: getCheckedSources(),
 };
 try {
 if (fileInput?.files?.length) {
 $("#settingsBaseResumeStatus").textContent = "Uploading base resume...";
 const upload = await uploadBaseResume(fileInput.files[0]);
 payload.baseResumePath = upload.baseResumePath;
 $("#settingsBaseResumePath").value = upload.baseResumePath;
 }
 const saved = await api("/api/app-config", { method: "POST", body: JSON.stringify(payload) });
 appConfig = saved.config || payload;
 DAILY_TARGET = appConfig.dailyTarget;
 $("#settingsDialog").close();
 toast("OK Settings saved - roadmap updated");
 renderAll();
 // Always refresh roadmap panel so skill changes are visible immediately
 const _rmPanel = document.getElementById("roadmapPanel");
 if (_rmPanel) renderRoadmap();
 } catch (err) {
 toast(`Failed to save settings: ${err.message}`);
 }
}

async function uploadBaseResume(file) {
 if (!file.name.toLowerCase().endsWith(".docx")) {
 throw new Error("Please upload a .docx resume file.");
 }
 const form = new FormData();
 form.append("baseResume", file);
 const response = await fetch("/api/base-resume", { method: "POST", body: form });
 const body = await response.json();
 if (!response.ok) throw new Error(body.error || "Upload failed");
 return body;
}

const $ = (selector) => document.querySelector(selector);
const jobRows = $("#jobRows");
const detailPanel = $("#detailPanel");
const metrics = $("#metrics");
const chatLog = $("#chatLog");
const toastEl = $("#toast");

function todayString() {
 const now = new Date();
 const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
 return local.toISOString().slice(0, 10);
}

function toast(message) {
 toastEl.textContent = message;
 toastEl.classList.add("show");
 setTimeout(() => toastEl.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
 const response = await fetch(path, {
 headers: { "Content-Type": "application/json" },
 ...options,
 });
 const body = await response.json();
 if (!response.ok) throw new Error(body.error || "Request failed");
 return body;
}

function escapeHtml(value) {
 return String(value || "")
 .replaceAll("&", "&amp;")
 .replaceAll("<", "&lt;")
 .replaceAll(">", "&gt;")
 .replaceAll('"', "&quot;");
}

function statusClass(status, priority) {
 const text = `${status} ${priority}`.toLowerCase();
 if (text.includes("blocked") || text.includes("do not")) return "blocked";
 if (text.includes("high") || text.includes("apply-ready") || text.includes("applied")) return "high";
 if (text.includes("medium") || text.includes("review")) return "medium";
 return "";
}

function normalizeDate(value) {
 return String(value || "").slice(0, 10);
}

function isApplied(job) {
 return /^(applied|application submitted|submitted)$/i.test(String(job.status || "").trim());
}

function dailyJobs() {
 return state.jobs.filter((job) => normalizeDate(job.dateFound) === state.date);
}

function activeDailyJobs() {
 return dailyJobs().filter((job) => !isApplied(job));
}

function baseJobsForView() {
 if (state.view === "applied") return state.jobs.filter(isApplied);
 if (state.view === "all" || state.view === "analytics") return state.jobs;
 return activeDailyJobs();
}

function viewLabel() {
 if (state.view === "applied") return "all applied jobs";
 if (state.view === "all") return "all saved jobs";
 if (state.view === "analytics") return "analytics";
 return `active jobs for ${formatDate(state.date)}`;
}

function formatDate(value) {
 if (!value) return "";
 const [year, month, day] = value.split("-").map(Number);
 return new Date(year, month - 1, day).toLocaleDateString(undefined, {
 weekday: "short",
 month: "short",
 day: "numeric",
 year: "numeric",
 });
}

function formatTime(value) {
 if (!value) return "Not searched yet";
 return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function chatTime(value) {
 return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function newChatMessage(role, text, extra = {}) {
 return {
 id: `CHAT-${Date.now()}-${Math.random().toString(16).slice(2)}`,
 role,
 text,
 at: new Date().toISOString(),
 ...extra,
 };
}

function fileName(value) {
 const text = String(value || "");
 return text.split(/[\\/]/).filter(Boolean).pop() || text || "Not generated";
}

function resumeForJob(job) {
 return job.resumeUsedPath || job.generatedResumePath || job.selectedResume || "";
}

function resumeMatchDisplay(job) {
 const score = job.resumeMatchScore;
 const total = Number(job.resumeJobSkillCount || 0);
 const matched = Number(job.resumeMatchedSkillCount || 0);
 if (score === null || score === undefined || !total) {
 return `<span class="pill medium" title="Upload a base resume and make sure this job has skill text or JD details">N/A</span>`;
 }
 const cls = Number(score) >= 75 ? "high" : Number(score) >= 45 ? "medium" : "";
 const matchedSkills = (job.resumeMatchedSkills || []).join(", ");
 const jobSkills = (job.resumeJobSkills || []).join(", ");
 const title = `${matched}/${total} job skills found in base resume${matchedSkills ? `: ${matchedSkills}` : ""}${jobSkills ? ` | Job skills: ${jobSkills}` : ""}`;
 return `<div class="resume-match-cell" title="${escapeHtml(title)}">
 <span class="pill ${cls}">${escapeHtml(score)}%</span>
 <div class="tiny">${escapeHtml(matched)}/${escapeHtml(total)} skills</div>
 </div>`;
}

function skillChipList(skills, tone = "neutral") {
 const list = (skills || []).filter(Boolean);
 if (!list.length) return `<span class="rm-empty">None detected</span>`;
 return `<div class="rm-skill-chips">${list.map((skill) => `<span class="rm-skill-chip ${tone}">${escapeHtml(skill)}</span>`).join("")}</div>`;
}

function resumeLabelForJob(job) {
 if (job.resumeUsedPath) return "Uploaded/applied resume";
 if (job.generatedResumePath) return "Generated tailored resume";
 if (job.selectedResume) return "Selected standard resume";
 return "No resume selected";
}

function jdLabelForJob(job) {
 if (job.jdPath) return `JD saved: ${fileName(job.jdPath)}`;
 if (job.jd) return "JD text saved";
 if (job.notes) return "Notes saved";
 return "JD not saved";
}

// -€-€ Stock-style graphs -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function localDateStr(d) {
 const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
 return local.toISOString().slice(0, 10);
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// -€-€ Daily target ring helpers -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function weeklyAppliedStats() {
 const now = new Date();
 const day = now.getDay(); // 0=Sun
 const diffToMon = day === 0 ? -6 : 1 - day;
 const monday = new Date(now);
 monday.setDate(now.getDate() + diffToMon);
 monday.setHours(0, 0, 0, 0);

 const appliedJobs = state.jobs.filter(isApplied);

 // Weekly total (Mon-today)
 const weeklyApplied = appliedJobs.filter((job) => {
 const d = normalizeDate(job.dateApplied || job.dateFound);
 if (!d) return false;
 return new Date(d + "T00:00:00") >= monday;
 }).length;

 // Applied-per-date map
 const byDate = {};
 appliedJobs.forEach((job) => {
 const d = normalizeDate(job.dateApplied || job.dateFound);
 if (d) byDate[d] = (byDate[d] || 0) + 1;
 });

 // Streak: consecutive days going back from today
 // If today's target isn't met yet, start streak check from yesterday (today is "in progress")
 let streak = 0;
 const cursor = new Date(now);
 cursor.setHours(0, 0, 0, 0);
 const todayStr = localDateStr(cursor);
 const todayMet = (byDate[todayStr] || 0) >= DAILY_TARGET;
 if (!todayMet) cursor.setDate(cursor.getDate() - 1); // start from yesterday
 for (let i = 0; i < 365; i++) {
 const dow = cursor.getDay(); // 0=Sun, 6=Sat
 if (dow === 0 || dow === 6) { cursor.setDate(cursor.getDate() - 1); continue; }
 const ds = localDateStr(cursor);
 if ((byDate[ds] || 0) < DAILY_TARGET) break;
 streak++;
 cursor.setDate(cursor.getDate() - 1);
 }

 return { weeklyApplied, streak };
}

function buildRingSvg(applied, target) {
 const R = 34, cx = 44, cy = 44;
 const circ = 2 * Math.PI * R;
 const pct = Math.min(applied / target, 1);
 const dash = `${(pct * circ).toFixed(1)} ${circ.toFixed(1)}`;
 const color = pct >= 1 ? "#6366f1" : pct >= 0.67 ? "#10b981" : pct >= 0.34 ? "#f59e0b" : "#ef4444";
 const label = pct >= 1 ? "" : `${Math.round(pct * 100)}%`;
 return `<svg viewBox="0 0 88 88" width="88" height="88" style="display:block">
 <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#e2e8f0" stroke-width="9"/>
 <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="9"
 stroke-dasharray="${dash}" stroke-linecap="round"
 transform="rotate(-90 ${cx} ${cy})"/>
 <text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="20" font-weight="700"
 fill="${color}" font-family="inherit">${applied}</text>
 <text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="10" fill="#94a3b8"
 font-family="inherit">/ ${target}</text>
 <text x="${cx}" y="${cy + 24}" text-anchor="middle" font-size="9" fill="${color}"
 font-family="inherit">${label}</text>
 </svg>`;
}

function renderDailyTargetWidget() {
 const widget = $("#dailyTargetWidget");
 if (!widget) return;
 const applied = dailyJobs().filter(isApplied).length;
 const { streak } = weeklyAppliedStats();
 const remaining = Math.max(DAILY_TARGET - applied, 0);
 widget.innerHTML = `
 <div class="target-ring-wrap">
 ${buildRingSvg(applied, DAILY_TARGET)}
 <div class="target-ring-stats">
 <div class="ring-label">Daily Target</div>
 <div class="ring-stat-row">
 <span class="ring-stat-ico" aria-hidden="true">&#128293;</span>
 <span class="ring-stat-val">${streak}</span>
 <span class="ring-stat-lbl">day streak</span>
 </div>
 <div class="ring-stat-row">
 <span class="ring-stat-ico" aria-hidden="true">&#127919;</span>
 <span class="ring-stat-val">${remaining}</span>
 <span class="ring-stat-lbl">to go today</span>
 </div>
 </div>
 </div>`;
}

// opts: { days: 14, monthly: false }
// monthly=true -> aggregate last 12 calendar months; days -> last N days (daily)
function buildGraphSvg(heightPx = 150, { days = 14, monthly = false } = {}) {
 const today = todayString();
 let data; // array of [label, count]

 if (monthly) {
 const now = new Date();
 const entries = [];
 for (let i = 11; i >= 0; i--) {
 const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
 const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
 entries.push({ key, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`, count: 0 });
 }
 state.jobs.filter(isApplied).forEach((job) => {
 const d = normalizeDate(job.dateApplied || job.dateFound);
 if (d) { const e = entries.find((x) => x.key === d.slice(0, 7)); if (e) e.count++; }
 });
 data = entries.map((e) => [e.label, e.count]);
 } else {
 const dayMap = {};
 for (let i = days - 1; i >= 0; i--) {
 const d = new Date();
 d.setDate(d.getDate() - i);
 const key = localDateStr(d);
 if (key <= today) dayMap[key] = 0;
 }
 state.jobs.filter(isApplied).forEach((job) => {
 const d = normalizeDate(job.dateApplied || job.dateFound);
 if (d in dayMap) dayMap[d]++;
 });
 // For daily, label = MM-DD; keep raw key as data-date for tooltip
 data = Object.entries(dayMap).map(([k, v]) => [k.slice(5), v, k]);
 }

 const n = data.length;
 if (n < 2) return `<div style="color:#667085;font-size:12px;padding:20px;text-align:center">No data yet</div>`;

 const W = 800; const H = heightPx;
 const pL = 36, pR = 12, pT = 18, pB = 36;
 const cW = W - pL - pR; const cH = H - pT - pB;
 const maxVal = Math.max(...data.map(([, v]) => v), 1);

 const xPos = (i) => pL + (i / (n - 1)) * cW;
 const yPos = (v) => pT + cH - (v / maxVal) * cH;

 const pts = data.map(([, v], i) => ({ x: xPos(i), y: yPos(v) }));
 let linePath = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
 for (let i = 0; i < pts.length - 1; i++) {
 const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
 const cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6;
 const cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6;
 linePath += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
 }
 const areaPath = `${linePath} L ${pts[n-1].x.toFixed(1)},${(pT+cH).toFixed(1)} L ${pts[0].x.toFixed(1)},${(pT+cH).toFixed(1)} Z`;

 const gradId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`;
 const yTicks = [0, Math.round(maxVal / 2), maxVal].filter((v, i, a) => a.indexOf(v) === i);

 // X label density
 const step = monthly ? 1 : (days <= 7 ? 1 : days <= 14 ? 2 : 5);
 const xLabelIdx = [...new Set([0, n - 1, ...data.map((_, i) => i).filter((i) => i % step === 0)])].sort((a, b) => a - b);

 // For tooltips: use data[2] (raw key) when available, else data[0] (label)
 const tipLabel = (i) => data[i][2] || data[i][0];

 return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:${H}px;display:block">
 <defs>
 <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stop-color="#1f5eff" stop-opacity="0.22"/>
 <stop offset="100%" stop-color="#1f5eff" stop-opacity="0.01"/>
 </linearGradient>
 </defs>
 ${yTicks.map((v) => `<line x1="${pL}" y1="${yPos(v).toFixed(1)}" x2="${pL+cW}" y2="${yPos(v).toFixed(1)}" stroke="#edf0f5" stroke-width="1" stroke-dasharray="3,3"/>`).join("")}
 ${yTicks.map((v) => `<text x="${pL-5}" y="${(yPos(v)+4).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-size="10" font-family="Segoe UI,Arial,sans-serif">${v}</text>`).join("")}
 <path d="${areaPath}" fill="url(#${gradId})"/>
 <path d="${linePath}" fill="none" stroke="#1f5eff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
 <circle cx="${pts[n-1].x.toFixed(1)}" cy="${pts[n-1].y.toFixed(1)}" r="4.5" fill="#1f5eff" stroke="white" stroke-width="2"/>
 ${xLabelIdx.map((i) => `<text x="${xPos(i).toFixed(1)}" y="${(pT+cH+16).toFixed(1)}" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="Segoe UI,Arial,sans-serif">${data[i][0]}</text>`).join("")}
 ${data.map(([, v], i) => `<circle cx="${xPos(i).toFixed(1)}" cy="${yPos(v).toFixed(1)}" r="8" fill="transparent" data-gid="${gradId}" data-date="${tipLabel(i)}" data-v="${v}"></circle>`).join("")}
 <g id="svgTip_${gradId}" style="display:none;pointer-events:none">
 <rect id="svgTipBg_${gradId}" rx="5" ry="5" fill="#1e293b"/>
 <text id="svgTipTxt_${gradId}" fill="white" font-size="11" font-family="Segoe UI,Arial,sans-serif" text-anchor="middle" dominant-baseline="middle"></text>
 </g>
 </svg>`;
}

// Backwards-compatible alias used by home graph
function buildLineGraphSvg(heightPx = 150, opts = {}) { return buildGraphSvg(heightPx, opts); }

function attachGraphTooltips(container) {
 container.querySelectorAll("circle[data-gid]").forEach((c) => {
 c.style.cursor = "crosshair";
 c.addEventListener("mouseover", () => {
 const gid = c.dataset.gid;
 const tip = container.querySelector(`#svgTip_${gid}`);
 const bg = container.querySelector(`#svgTipBg_${gid}`);
 const txt = container.querySelector(`#svgTipTxt_${gid}`);
 if (!tip) return;
 const label = `${c.dataset.date} - ${c.dataset.v} applied`;
 const cx = parseFloat(c.getAttribute("cx"));
 const cy = parseFloat(c.getAttribute("cy"));
 txt.textContent = label;
 const tw = label.length * 6.3 + 16;
 const th = 20;
 const tx = Math.max(tw / 2 + 4, Math.min(cx, 788 - tw / 2)); // clamp inside SVG
 // Flip below the point if too close to the top edge
 const above = cy - th - 10 >= 2;
 const bgY = above ? cy - th - 10 : cy + 10;
 bg.setAttribute("x", (tx - tw / 2).toFixed(1));
 bg.setAttribute("y", bgY.toFixed(1));
 bg.setAttribute("width", tw.toFixed(1));
 bg.setAttribute("height", th);
 txt.setAttribute("x", tx.toFixed(1));
 txt.setAttribute("y", (bgY + th / 2).toFixed(1));
 tip.style.display = "";
 });
 c.addEventListener("mouseout", () => {
 const tip = container.querySelector(`#svgTip_${c.dataset.gid}`);
 if (tip) tip.style.display = "none";
 });
 });
}

function renderHomeLineGraph() {
 const el = $("#lineGraphSection");
 if (!el) return;
 if (state.view === "analytics" || state.view === "roadmap" || state.view === "prep") { el.style.display = "none"; return; }
 el.style.display = "block";

 const ranges = [{ key: "7d", label: "Week", days: 7 }, { key: "14d", label: "2 Weeks", days: 14 }, { key: "30d", label: "Month", days: 30 }];
 const cur = ranges.find((r) => r.key === homeGraphRange) || ranges[1];

 el.innerHTML = `<div class="line-graph-card">
 <div class="line-graph-title">
 Applications per Day
 <div class="graph-range-btns">
 ${ranges.map((r) => `<button class="graph-range-btn${r.key === homeGraphRange ? " active" : ""}" data-range="${r.key}">${r.label}</button>`).join("")}
 </div>
 </div>
 ${buildGraphSvg(108, { days: cur.days })}
 </div>`;

 attachGraphTooltips(el);
 el.querySelectorAll(".graph-range-btn").forEach((btn) => {
 btn.addEventListener("click", () => { homeGraphRange = btn.dataset.range; renderHomeLineGraph(); });
 });
}


// -€-€ Filtering & sorting -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function filteredJobs() {
 const q = state.query.trim().toLowerCase();
 const jobs = baseJobsForView().filter((job) => {
 const blob = [
 job.company, job.role, job.source, job.location, job.pay,
 job.notes, job.jd, job.status, job.priority, job.workAuthRisk,
 job.selectedResume, job.generatedResumePath, job.resumeUsedPath,
 ].join(" ").toLowerCase();
 const matchesQuery = !q || blob.includes(q);
 const matchesStatus =
 state.status === "all" ||
 (state.status === "not-applied" ? !isApplied(job) : (job.status || "").toLowerCase().includes(state.status.toLowerCase()));
 const matchesPriority = state.priority === "all" || job.priority === state.priority;
 const matchesSource = state.source === "all" || job.source === state.source;
  const matchesType = state.type === "all" || (job.employmentType || job.type || "").toLowerCase().includes(state.type.replace("-", "").toLowerCase()) || (state.type === "fulltime" && (job.employmentType || "").toLowerCase().includes("full-time"));
 return matchesQuery && matchesStatus && matchesPriority && matchesSource && matchesType;
 });
 return jobs.sort((a, b) => {
 if (state.view === "applied") {
 return String(b.dateApplied || b.dateFound || "").localeCompare(String(a.dateApplied || a.dateFound || ""));
 }
 return Number(b.fitScore || 0) - Number(a.fitScore || 0);
 });
}

function jobsForBoardCounts() {
 const q = state.query.trim().toLowerCase();
 return baseJobsForView().filter((job) => {
 const blob = [
 job.company, job.role, job.source, job.location, job.pay,
 job.notes, job.jd, job.status, job.priority, job.workAuthRisk,
 job.selectedResume, job.generatedResumePath, job.resumeUsedPath,
 ].join(" ").toLowerCase();
 const matchesQuery = !q || blob.includes(q);
 const matchesStatus =
 state.status === "all" ||
 (state.status === "not-applied" ? !isApplied(job) : (job.status || "").toLowerCase().includes(state.status.toLowerCase()));
 const matchesPriority = state.priority === "all" || job.priority === state.priority;
 return matchesQuery && matchesStatus && matchesPriority;
 });
}

// -€-€ View controls -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function renderViewControls() {
 const buttons = {
 daily: $("#dailyViewBtn"),
 applied: $("#appliedViewBtn"),
 all: $("#allJobsViewBtn"),
 analytics: $("#analyticsViewBtn"),
 roadmap: $("#roadmapViewBtn"),
 prep: $("#prepViewBtn"),
 };
 Object.entries(buttons).forEach(([view, button]) => {
 if (button) button.classList.toggle("active", state.view === view);
 });
 const appliedCount = state.jobs.filter(isApplied).length;
 const totalCount = state.jobs.length;
 const dailyTotal = dailyJobs().length;
 const dailyActive = activeDailyJobs().length;
 const dailyApplied = dailyJobs().filter(isApplied).length;
 const notes = {
 daily: `Showing ${dailyActive} active jobs for ${formatDate(state.date)}. ${dailyApplied} applied out of ${dailyTotal} found.`,
 applied: `Showing ${appliedCount} applied jobs across all dates, with resume and JD details for screening prep.`,
 all: `Showing all ${totalCount} saved jobs across every date.`,
 analytics: `Visual breakdown of your job search activity.`,
 prep: `DSA practice problems, System Design patterns, and CS fundamentals.`,
 };
 $("#viewNote").textContent = notes[state.view] || "";
}

function renderDateSummary() {
 const jobs = baseJobsForView();
 const allDailyJobs = dailyJobs();
 const dailyApplied = allDailyJobs.filter(isApplied).length;
 const applied = state.view === "daily" ? dailyApplied : jobs.filter(isApplied).length;
 const notApplied = state.view === "daily" ? jobs.length : jobs.length - applied;
 const remaining = Math.max(DAILY_TARGET - applied, 0);

 $("#dateFilter").value = state.date;
 $("#dateFilter").disabled = state.view !== "daily";
 $("#todayBtn").disabled = state.view !== "daily";
 renderDailyTargetWidget();

 let statusText = "";
 if (state.view === "applied") {
 const dates = new Set(jobs.map((job) => normalizeDate(job.dateApplied || job.dateFound)).filter(Boolean));
 statusText = `All applied jobs: ${jobs.length} applications across ${dates.size || 0} dates.`;
 } else if (state.view === "all") {
 statusText = `All saved jobs: ${jobs.length} jobs, ${applied} applied, ${notApplied} not applied.`;
 } else if (state.view === "analytics") {
 statusText = `${state.jobs.length} total jobs tracked.`;
 } else {
 const targetNote =
 allDailyJobs.length >= DAILY_TARGET
 ? "daily target list ready"
 : `${remaining} more applied jobs to reach 50`;
 statusText = `${formatDate(state.date)}: ${allDailyJobs.length} jobs found, ${applied} applied, ${notApplied} active, ${targetNote}.`;
 }
 $("#dayStatus").textContent = statusText;

 const autoNote = state.autoRefreshRunning
 ? "Auto-refresh: running"
 : state.autoRefreshNextAt
 ? `Next auto-refresh: ${formatTime(state.autoRefreshNextAt)}`
 : state.autoRefreshAt
 ? `Last auto-refresh: ${formatTime(state.autoRefreshAt)}`
 : "Auto-refresh: hourly";
 $("#refreshStatus").textContent = `Last manual search: ${formatTime(state.lastRefreshAt)} - ${autoNote}`;
}

function renderMetrics() {
 if (state.view === "analytics" || state.view === "roadmap") {
 metrics.innerHTML = "";
 return;
 }
 const jobs = baseJobsForView();
 let metricItems;
 if (state.view === "daily") {
 const allDailyJobs = dailyJobs();
 const appliedToday = allDailyJobs.filter(isApplied).length;
 const active = activeDailyJobs();
 metricItems = [
 ["Daily Found", allDailyJobs.length],
 ["Active", active.length],
 ["Applied Today", appliedToday],
 ["High Priority", active.filter((job) => job.priority === "High").length],
 ["Ready", active.filter((job) => /apply-ready|ready/i.test(job.status || "")).length],
 ["Generated", allDailyJobs.filter((job) => job.generatedResumePath || job.generatedCoverPath).length],
 ];
 } else {
 const applied = jobs.filter(isApplied).length;
 const notApplied = jobs.length - applied;
 metricItems = [
 ["Jobs in View", jobs.length],
 ["Ready", jobs.filter((job) => /apply-ready|ready/i.test(job.status || "")).length],
 ["High Priority", jobs.filter((job) => job.priority === "High").length],
 ["Applied", applied],
 ["Not Applied", notApplied],
 ["Generated", jobs.filter((job) => job.generatedResumePath || job.generatedCoverPath).length],
 ];
 }
 metrics.innerHTML = metricItems
 .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
 .join("");
}

function renderSourceFilter() {
 const current = state.source;
 const counts = new Map();
 jobsForBoardCounts().forEach((job) => {
 const source = job.source || "Unknown";
 counts.set(source, (counts.get(source) || 0) + 1);
 });
 const sources = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
 const total = sources.reduce((sum, [, count]) => sum + count, 0);
 $("#sourceFilter").innerHTML = `<option value="all">All job boards (${escapeHtml(total)} active)</option>${sources
 .map(([source, count]) => `<option value="${escapeHtml(source)}">${escapeHtml(source)} (${escapeHtml(count)} active)</option>`)
 .join("")}`;
 if (current !== "all" && !counts.has(current)) state.source = "all";
 $("#sourceFilter").value = state.source;
}

// -€-€ Bulk action bar -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function renderBulkBar() {
 const bar = $("#bulkBar");
 const count = state.bulkSelected.size;
 if (count === 0) {
 bar.classList.remove("visible");
 return;
 }
 bar.classList.add("visible");
 $("#bulkCount").textContent = `${count} job${count === 1 ? "" : "s"} selected`;
}

// -€-€ Row rendering -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function renderRows() {
 if (state.view === "roadmap") { renderRoadmap(); return; }
 if (state.view === "prep") { renderPrep(); return; }
 if (state.view === "analytics") {
 renderAnalytics();
 return;
 }

 const layout = document.querySelector(".layout");
 const analyticsPanel = $("#analyticsPanel");
 layout.style.display = "";
 metrics.style.display = "";
 analyticsPanel.style.display = "none";
 const rp = $("#roadmapPanel"); if (rp) rp.style.display = "none";
 const pp = $("#prepPanel"); if (pp) pp.style.display = "none";

 const jobs = filteredJobs();
 if (!jobs.some((job) => job.id === state.selectedId)) state.selectedId = jobs[0]?.id || null;
 if (!jobs.length) {
 jobRows.innerHTML = `<tr><td colspan="9"><div class="empty-state">No ${escapeHtml(viewLabel())} with the current filters.</div></td></tr>`;
 renderDetail();
 renderBulkBar();
 return;
 }
 jobRows.innerHTML = jobs
 .map((job) => {
 const selected = job.id === state.selectedId ? "selected" : "";
 const pillClass = statusClass(job.status, job.priority);
 const resume = resumeForJob(job);
 const hasJd = Boolean(job.jd || job.jdPath || job.notes);
 const checked = state.bulkSelected.has(job.id) ? "checked" : "";
 const resumeMatch = resumeMatchDisplay(job);
 return `<tr class="${selected}" data-id="${escapeHtml(job.id)}">
 <td class="checkbox-cell" onclick="event.stopPropagation()">
 <input type="checkbox" class="row-check" data-check="${escapeHtml(job.id)}" ${checked} />
 </td>
 <td>
 <div class="job-title">${escapeHtml(job.role)}</div>
 <div class="job-meta">${escapeHtml(job.company)} - ${escapeHtml(job.location || "Location not listed")}</div>
 <div class="tiny">${escapeHtml(job.datePosted || job.dateFound || "")}${job.dateApplied ? ` - Applied ${escapeHtml(job.dateApplied)}` : ""}</div>
 </td>
 <td>${escapeHtml(job.employmentType || job.type || "-")}</td>
  <td><span class="pill">${escapeHtml(job.source || "Portal")}</span></td>
 <td>${escapeHtml(job.pay || "Not listed")}</td>
 <td><span class="pill ${Number(job.fitScore) >= 80 ? "high" : Number(job.fitScore) >= 65 ? "medium" : ""}">${escapeHtml(job.fitScore || "-")}</span></td>
 <td>${resumeMatch}</td>
 <td><span class="pill ${pillClass}">${escapeHtml(job.status || "Ready")}</span></td>
 <td>
 <div class="resume-cell">
 <div class="resume-name">${escapeHtml(fileName(resume))}</div>
 <div class="resume-subline">${escapeHtml(resumeLabelForJob(job))}</div>
 <span class="pill ${hasJd ? "high" : "medium"}">${hasJd ? "JD saved" : "No JD"}</span>
 </div>
 </td>
 <td>
 <div class="row-actions">
 <button class="button secondary small" data-open="${escapeHtml(job.id)}">Open</button>
 <button class="button warning small" data-generate-resume="${escapeHtml(job.id)}">Resume</button>
 <button class="button warning small" data-generate-cover="${escapeHtml(job.id)}">Cover</button>
 <button class="button success small" data-applied="${escapeHtml(job.id)}">Applied</button>
 </div>
 </td>
 </tr>`;
 })
 .join("");

 const allChecked = jobs.length > 0 && jobs.every((job) => state.bulkSelected.has(job.id));
 const selectAllEl = $("#selectAll");
 if (selectAllEl) selectAllEl.checked = allChecked;

 renderDetail();
 renderBulkBar();
}

// -€-€ Detail panel -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function selectedJob() {
 return state.jobs.find((job) => job.id === state.selectedId);
}

function renderDetail() {
 const job = selectedJob();
 if (!job) {
 detailPanel.innerHTML = `<div class="empty-state">Select a job to view details.</div>`;
 return;
 }
 const resume = resumeForJob(job);
 const appliedDate = job.dateApplied || (isApplied(job) ? "Marked applied" : "Not applied yet");
 const jdStatus = jdLabelForJob(job);
 const sourceLink = job.url || "No link saved";
 const pipeline = job.pipelineStage || "";

 detailPanel.innerHTML = `<div class="detail-head">
 <div class="pill ${statusClass(job.status, job.priority)}">${escapeHtml(job.status || "Ready")}</div>
 <h2>${escapeHtml(job.role)}</h2>
 <div class="job-meta">${escapeHtml(job.company)} - ${escapeHtml(job.source)} - ${escapeHtml(job.location)}</div>
 </div>
 <div class="detail-actions">
 <button class="button primary" id="openJobLink">Open Job Link</button>
 <button class="button warning" id="generateResumeTop">Tailored Resume</button>
 <button class="button warning" id="generateCoverTop">Cover Letter</button>
 <button class="button success" id="markApplied">Mark Applied</button>
 <button class="button danger" id="deleteJobBtn">Delete</button>
 </div>

 ${resumeMatchCard(job)}

 <div class="prep-card">
 <h3>Screening Prep</h3>
 <div class="prep-grid">
 <div class="prep-item"><strong>Applied</strong><span>${escapeHtml(appliedDate)}</span></div>
 <div class="prep-item"><strong>Resume Used</strong><span>${escapeHtml(fileName(resume))}</span></div>
 <div class="prep-item"><strong>Resume Match</strong><span>${job.resumeMatchScore === null || job.resumeMatchScore === undefined ? "N/A" : `${escapeHtml(job.resumeMatchScore)}% (${escapeHtml(job.resumeMatchedSkillCount || 0)}/${escapeHtml(job.resumeJobSkillCount || 0)} skills)`}</span></div>
 <div class="prep-item"><strong>Resume Path</strong><span>${escapeHtml(resume || "Generate or select resume before applying")}</span></div>
 <div class="prep-item"><strong>JD</strong><span>${escapeHtml(jdStatus)}</span></div>
 <div class="prep-item"><strong>Job Link</strong><span>${escapeHtml(sourceLink)}</span></div>
 </div>
 </div>

 <div class="detail-grid">
 <div class="field"><label>Pay</label><input id="payInput" class="input" value="${escapeHtml(job.pay)}" /></div>
 <div class="field"><label>Status</label><input id="statusInput" class="input" value="${escapeHtml(job.status)}" /></div>
 <div class="field"><label>Priority</label><select id="priorityInput" class="select">
 ${["High", "Medium", "Low", "Blocked"].map((v) => `<option ${job.priority === v ? "selected" : ""}>${v}</option>`).join("")}
 </select></div>
 <div class="field"><label>Pipeline Stage</label><select id="pipelineInput" class="select">
 ${["", "Applied", "Phone Screen", "Interview", "Final Round", "Offer", "Rejected", "Withdrawn"].map((v) => `<option value="${escapeHtml(v)}" ${pipeline === v ? "selected" : ""}>${escapeHtml(v) || "- none -"}</option>`).join("")}
 </select></div>
 <div class="field"><label>Resume Version</label><select id="resumeInput" class="select">
 ${[job.selectedResume, appConfig.defaultResume].filter(Boolean).filter((v, i, all) => all.indexOf(v) === i)
 .map((v) => `<option ${job.selectedResume === v ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")}
 <option value="" ${job.selectedResume ? "" : "selected"}>Generate a tailored resume</option>
 </select></div>
 <div class="field"><label>Interview Date</label><input id="interviewDateInput" class="input" type="date" value="${escapeHtml(job.interviewDate || "")}" /></div>
 <div class="field"><label>Follow-up Date</label><input id="followUpDateInput" class="input" type="date" value="${escapeHtml(job.followUpDate || "")}" /></div>
 </div>

 <div class="recruiter-card">
  <div style="display: flex; justify-content: space-between; align-items: center;">
    <h3 style="margin: 0;">Recruiter</h3>
    <button class="button" style="padding: 4px 8px; font-size: 12px; background: #0a66c2; color: white; border: none; cursor: pointer; border-radius: 4px;" title="Search Google for recruiters at ${escapeHtml(job.company)}" onclick="window.open('https://www.google.com/search?q=site:linkedin.com/in/+%28%22recruiter%22+OR+%22talent+acquisition%22+OR+%22hiring%22%29+%22' + encodeURIComponent('${escapeHtml(job.company)}') + '%22', '_blank')">🔍 Find Recruiter</button>
  </div>
</div>

 <div class="field"><label>Work Auth / Risk</label><textarea id="riskInput" class="textarea" rows="3">${escapeHtml(job.workAuthRisk)}</textarea></div>
 <div class="field"><label>Notes</label><textarea id="notesInput" class="textarea" rows="4">${escapeHtml(job.notes)}</textarea></div>
 <div class="field"><label>JD Text</label><textarea id="jdInput" class="textarea" rows="8">${escapeHtml(job.jd)}</textarea></div>

 <div class="detail-actions">
 <button class="button secondary" id="saveJob">Save Changes</button>
 <label class="doc-choice">
 <span>Application docs</span>
 <select id="documentChoice" class="select">
 <option value="resume" selected>Resume only</option>
 <option value="all">Resume + cover letter</option>
 <option value="cover">Cover letter only</option>
 </select>
 </label>
 <button class="button primary" id="generateSelected">Generate Selected</button>
 </div>

 ${job.generatedResumePath ? `<div class="path-box"><strong>Resume:</strong><br>${escapeHtml(job.generatedResumePath)}</div>` : ""}
 ${job.resumeUsedPath ? `<div class="path-box"><strong>Resume used when marked applied:</strong><br>${escapeHtml(job.resumeUsedPath)}</div>` : ""}
 ${job.jdPath ? `<div class="path-box"><strong>JD file:</strong><br>${escapeHtml(job.jdPath)}</div>` : ""}
 ${job.generatedCoverPath ? `<div class="path-box"><strong>Cover letter:</strong><br>${escapeHtml(job.generatedCoverPath)}</div>` : ""}
 `;

 $("#openJobLink").onclick = () => job.url && window.open(job.url, "_blank", "noopener");
 $("#markApplied").onclick = () => markApplied(job.id);
 $("#saveJob").onclick = () => saveDetail(job.id);
 $("#deleteJobBtn").onclick = () => deleteJob(job.id);
 $("#generateResumeTop").onclick = () => generate(job.id, "resume");
 $("#generateCoverTop").onclick = () => generate(job.id, "cover");
 $("#generateSelected").onclick = () => generate(job.id, $("#documentChoice")?.value || "resume");

 // Resume match card - "Use This" sets the dropdown & saves; "Generate Tailored" generates
 detailPanel.querySelectorAll(".rm-use-btn").forEach((btn) => {
 btn.addEventListener("click", () => {
 const sel = $("#resumeInput");
 if (sel) { sel.value = btn.dataset.file; }
 saveDetail(job.id);
 btn.textContent = "OK Set";
 setTimeout(() => { btn.textContent = "Use This"; }, 1800);
 });
 });
 detailPanel.querySelectorAll(".rm-gen-btn").forEach((btn) => {
 btn.addEventListener("click", () => generate(btn.dataset.jobid, "resume"));
 });
}

function currentDetailPatch() {
 return {
 employmentType: $("#typeInput")?.value || "",
  pay: $("#payInput")?.value || "",
 status: $("#statusInput")?.value || "",
 priority: $("#priorityInput")?.value || "Medium",
 pipelineStage: $("#pipelineInput")?.value || "",
 selectedResume: $("#resumeInput")?.value || "",
 interviewDate: $("#interviewDateInput")?.value || "",
 followUpDate: $("#followUpDateInput")?.value || "",
 workAuthRisk: $("#riskInput")?.value || "",
 notes: $("#notesInput")?.value || "",
 jd: $("#jdInput")?.value || "",
 };
}

// -€-€ Resume match scoring -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
const RESUME_VERSIONS = [
];

function computeResumeMatch(job) {
 const hasScore = job.resumeMatchScore !== null && job.resumeMatchScore !== undefined;
 return [{
 key: "base",
 label: hasScore ? "Uploaded Base Resume" : "Base Resume Not Uploaded",
 file: job.resumeUsedPath || "",
 color: "#2563eb",
 hits: job.resumeMatchedSkillCount || 0,
 pct: hasScore ? Number(job.resumeMatchScore) : 0,
 }];
}

function computeMissingSkills(topN = 30) {
 const resumeSkillSet = new Set();
 state.jobs.forEach((job) => {
 (job.resumeMatchedSkills || []).forEach((skill) => resumeSkillSet.add(String(skill).toLowerCase()));
 });
 const skillsData = computeSkillsGap().slice(0, topN);
 return skillsData
 .filter(({ skill }) => {
 const sl = skill.toLowerCase();
 return ![...resumeSkillSet].some((kw) => kw === sl || kw.includes(sl) || sl.includes(kw));
 })
 .slice(0, 20);
}

function hasBaseResumeConfigured() {
 return Boolean(appConfig.baseResumePath);
}

function resumeMatchCard(job) {
 const match = computeResumeMatch(job)[0];
 const hasScore = job.resumeMatchScore !== null && job.resumeMatchScore !== undefined;
 const barW = Math.max(hasScore ? match.pct : 4, 4);
 const matched = job.resumeMatchedSkillCount || 0;
 const total = job.resumeJobSkillCount || 0;
 const matchedSkills = job.resumeMatchedSkills || [];
 const matchedSkillSet = new Set(matchedSkills.map((skill) => String(skill).toLowerCase()));
 const missingSkills = job.resumeMissingSkills || (job.resumeJobSkills || []).filter((skill) => !matchedSkillSet.has(String(skill).toLowerCase()));
 return `
 <div class="rm-card">
 <h3>Resume Match</h3>
 <p class="rm-hint">Match score based on the uploaded base resume and this job's detected skills.</p>
 <div class="rm-row rm-best">
 <div class="rm-label">
 <span class="rm-name">${hasScore ? `${escapeHtml(match.pct)}% match` : "Upload a base resume to calculate match"}</span>
 </div>
 <div class="rm-bar-wrap">
 <div class="rm-bar-fill" style="width:${barW}%;background:${match.color}"></div>
 <span class="rm-pct">${hasScore ? `${escapeHtml(match.pct)}%` : "N/A"}</span>
 </div>
 </div>
 <p class="rm-hint">${escapeHtml(matched)}/${escapeHtml(total)} job skills matched.</p>
 <div class="rm-skill-grid">
 <div class="rm-skill-section">
 <div class="rm-skill-title">Available in Resume</div>
 ${skillChipList(matchedSkills, "available")}
 </div>
 <div class="rm-skill-section">
 <div class="rm-skill-title">Missing from Resume</div>
 ${skillChipList(missingSkills, "missing")}
 </div>
 </div>
 </div>`;
 const matches = computeResumeMatch(job);
 const best = matches.reduce((a, b) => (b.pct > a.pct ? b : a));
 const rows = matches.map((m) => {
 const isBest = m.key === best.key;
 const barW = Math.max(4, m.pct);
 return `
 <div class="rm-row${isBest ? " rm-best" : ""}">
 <div class="rm-label">
 ${isBest ? '<span class="rm-badge"> Recommended</span>' : ""}
 <span class="rm-name">${escapeHtml(m.label)}</span>
 </div>
 <div class="rm-bar-wrap">
 <div class="rm-bar-fill" style="width:${barW}%;background:${m.color}"></div>
 <span class="rm-pct">${m.pct}%</span>
 </div>
 <div class="rm-actions">
 <button class="button secondary small rm-use-btn" data-file="${escapeHtml(m.file)}"
 title="Set as selected resume version">Use This</button>
 <button class="button warning small rm-gen-btn" data-jobid="${escapeHtml(job.id)}"
 title="Generate a tailored version of this resume for the job">Generate Tailored</button>
 </div>
 </div>`;
 }).join("");
 return `
 <div class="rm-card">
 <h3>Resume Match</h3>
 <p class="rm-hint">Match score based on keywords in this job's role, notes, and JD against each base resume.</p>
 ${rows}
 </div>`;
}

// -€-€ Skills gap analysis -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
const SKILLS_DICT = {
 "Languages": ["Python","JavaScript","TypeScript","Java","Kotlin","Swift","C++","C#","Go","Rust","Ruby","PHP","Scala","Bash","Shell","Dart","Groovy","R","MATLAB","Perl","Haskell","Elixir","Clojure"],
 "Web / Frontend":["React","Angular","Vue","Next.js","Svelte","HTML","CSS","Tailwind","Bootstrap","jQuery","GraphQL","Redux","Webpack","Vite","Gatsby","Remix","Astro","Three.js","WebSocket","WebAssembly"],
 "Backend": ["Node.js","Express","Django","Flask","FastAPI","Spring Boot","Spring","Laravel","Rails","ASP.NET",".NET","gRPC","Kafka","RabbitMQ","Celery","NestJS","Fiber","Gin","Actix"],
 "Cloud / DevOps":["AWS","Azure","GCP","Docker","Kubernetes","Terraform","Ansible","Jenkins","GitHub Actions","CI/CD","Nginx","Prometheus","Grafana","Helm","ArgoCD","CloudFormation","Pulumi","Linux","Bash"],
 "Databases": ["SQL","PostgreSQL","MySQL","SQLite","MongoDB","Redis","Elasticsearch","Cassandra","DynamoDB","Snowflake","BigQuery","Oracle","Neo4j","ClickHouse","CockroachDB","Supabase","Prisma","Sequelize"],
 "Data / ML": ["TensorFlow","PyTorch","Keras","Scikit-learn","Pandas","NumPy","Matplotlib","Jupyter","Hadoop","Spark","Airflow","dbt","Tableau","Power BI","LLM","NLP","Machine Learning","Deep Learning","Computer Vision","OpenAI","LangChain","Hugging Face"],
 "Tools": ["Git","Agile","Scrum","Jira","Confluence","Figma","Postman","Swagger","OpenAPI","Microservices","REST","API","TDD","OOP","System Design","Unit Testing","Selenium","Playwright","Cypress"],
};

const CAT_COLORS = {
 "Languages": "#1f5eff",
 "Web / Frontend": "#0ea5e9",
 "Backend": "#f59e0b",
 "Cloud / DevOps": "#8b5cf6",
 "Databases": "#14b8a6",
 "Data / ML": "#ef4444",
 "Tools": "#6b7280",
};

const SKILL_GAP_ALIASES = {
 "C#": ["c#", "c sharp", "csharp"],
 ".NET": [".net", "dotnet"],
 "ASP.NET": ["asp.net", "asp.net core", "aspnet"],
 "Node.js": ["node.js", "nodejs", "node js"],
 "REST": ["rest", "rest api", "restful"],
 "API": ["api", "apis"],
 "CI/CD": ["ci/cd", "cicd", "continuous integration", "continuous deployment"],
 "GitHub Actions": ["github actions"],
 "Power BI": ["power bi", "powerbi"],
 "Scikit-learn": ["scikit-learn", "sklearn"],
};

function skillGapRegex(term) {
 const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
 return new RegExp(`(^|[^a-z0-9+#.])${escaped}($|[^a-z0-9+#.])`, "i");
}

function hasSkillInText(text, skill) {
 const aliases = SKILL_GAP_ALIASES[skill] || [skill];
 return aliases.some((term) => skillGapRegex(term).test(text));
}

function computeSkillsGap() {
 const jobs = state.jobs.filter((j) => j.jd || j.role || j.notes);
 const total = jobs.length || 1;
 const results = [];
 for (const [cat, skills] of Object.entries(SKILLS_DICT)) {
 for (const skill of skills) {
 const count = jobs.filter((j) => hasSkillInText((j.jd || "") + " " + (j.role || "") + " " + (j.notes || ""), skill)).length;
 if (count > 0) results.push({ skill, cat, count, pct: Math.round((count / total) * 100) });
 }
 }
 return results.sort((a, b) => b.count - a.count);
}

function attachSkillsCatFilter(container) {
 container.querySelectorAll(".skills-cat-btn").forEach((btn) => {
 btn.addEventListener("click", () => {
 container.querySelectorAll(".skills-cat-btn").forEach((b) => b.classList.remove("active"));
 btn.classList.add("active");
 const cat = btn.dataset.cat;
 container.querySelectorAll(".skill-row").forEach((row) => {
 row.style.display = (cat === "all" || row.dataset.cat === cat) ? "" : "none";
 });
 });
 });
}

// -€-€ Analytics view -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function renderAnalytics() {
 const layout = document.querySelector(".layout");
 const analyticsPanel = $("#analyticsPanel");
 const rp2 = $("#roadmapPanel"); if (rp2) rp2.style.display = "none";
 const pp2 = $("#prepPanel"); if (pp2) pp2.style.display = "none";
 layout.style.display = "none";
 metrics.style.display = "none";
 analyticsPanel.style.display = "grid";

 const jobs = state.jobs;

 // Applications per day (last 14 days)
 const dayMap = {};
 for (let i = 13; i >= 0; i--) {
 const d = new Date();
 d.setDate(d.getDate() - i);
 dayMap[d.toISOString().slice(0, 10)] = 0;
 }
 jobs.filter(isApplied).forEach((job) => {
 const d = normalizeDate(job.dateApplied || job.dateFound);
 if (d in dayMap) dayMap[d]++;
 });
 const dayEntries = Object.entries(dayMap);
 const maxDay = Math.max(...dayEntries.map(([, v]) => v), 1);

 // Top sources
 const sourceMap = {};
 jobs.forEach((job) => { sourceMap[job.source] = (sourceMap[job.source] || 0) + 1; });
 const topSources = Object.entries(sourceMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
 const maxSource = Math.max(...topSources.map(([, v]) => v), 1);

 // Status breakdown
 const statusMap = {};
 jobs.forEach((job) => { const s = job.status || "Unknown"; statusMap[s] = (statusMap[s] || 0) + 1; });
 const statusEntries = Object.entries(statusMap).sort((a, b) => b[1] - a[1]).slice(0, 7);
 const maxStatus = Math.max(...statusEntries.map(([, v]) => v), 1);

 const totalApplied = jobs.filter(isApplied).length;
 const totalHigh = jobs.filter((j) => j.priority === "High").length;
 const totalGenerated = jobs.filter((j) => j.generatedResumePath).length;
 const avgScore = jobs.length ? Math.round(jobs.reduce((s, j) => s + Number(j.fitScore || 0), 0) / jobs.length) : 0;

 analyticsPanel.innerHTML = /* html */`
 <div class="analytics-summary">
 <div class="metric"><strong>${jobs.length}</strong><span>Total Tracked</span></div>
 <div class="metric"><strong>${totalApplied}</strong><span>Applied</span></div>
 <div class="metric"><strong>${totalHigh}</strong><span>High Priority</span></div>
 <div class="metric"><strong>${totalGenerated}</strong><span>Resumes Generated</span></div>
 <div class="metric"><strong>${avgScore}</strong><span>Avg Fit Score</span></div>
 </div>

 <div class="analytics-grid">
 <div class="analytics-card" style="grid-column:1/-1" id="analyticsGraphCard">
 <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
 <h3 style="margin:0" id="analyticsGraphTitle">Weekly - Last 7 Days</h3>
 <select id="analyticsGraphRange" style="font:inherit;font-size:13px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);cursor:pointer">
 <option value="7d">Last 7 Days</option>
 <option value="30d">Last 30 Days</option>
 <option value="1y">Last 12 Months</option>
 </select>
 </div>
 <div id="analyticsGraphBody">${buildGraphSvg(140, { days: 7 })}</div>
 </div>

 <div class="analytics-card">
 <h3>Top Portals by Jobs Found</h3>
 <div class="bar-chart horizontal">
 ${topSources.map(([source, count]) => `
 <div class="bar-row">
 <div class="bar-label" title="${escapeHtml(source)}">${escapeHtml(source)}</div>
 <div class="bar-track"><div class="bar-fill" style="width:${Math.round((count / maxSource) * 100)}%"></div></div>
 <div class="bar-value">${count}</div>
 </div>
 `).join("")}
 </div>
 </div>

 <div class="analytics-card" id="missingSkillsCard">
 <h3>Skills to Add to Your Resume</h3>
 <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px">Top demanded skills from your job pipeline that were not found in your uploaded base resume.</p>
 ${(() => {
 if (!hasBaseResumeConfigured()) {
 return `<div class="empty-state" style="padding:10px 0">Upload a base resume in Settings to see resume skill gaps.</div>`;
 }
 const missing = computeMissingSkills();
 if (!missing.length) return `<div class="empty-state" style="padding:10px 0">Your base resume covers all top demanded skills.</div>`;
 const maxC = missing[0].count;
 return missing.map(({ skill, cat, count }) => {
 const pct = Math.round((count / maxC) * 100);
 return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px">
 <div style="min-width:110px;font-size:13px;font-weight:500">${escapeHtml(skill)}</div>
 <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
 <div style="width:${pct}%;height:100%;background:${CAT_COLORS[cat]};border-radius:4px"></div>
 </div>
 <span style="font-size:11px;color:var(--text-muted);min-width:24px;text-align:right">${count}x</span>
 <span style="background:${CAT_COLORS[cat]}22;color:${CAT_COLORS[cat]};border:1px solid ${CAT_COLORS[cat]}55;font-size:10px;padding:1px 7px;border-radius:10px;white-space:nowrap">${escapeHtml(cat)}</span>
 </div>`;
 }).join("");
 })()}
 </div>

 </div>

 ${(() => {
 const skillsData = computeSkillsGap();
 const totalWithJD = state.jobs.filter((j) => j.jd || j.role).length;
 if (!skillsData.length) return `<div class="analytics-card" style="grid-column:1/-1"><h3>Skills Gap Analysis</h3><div class="empty-state" style="padding:20px">Add job descriptions to jobs to see skill demand.</div></div>`;
 const cats = Object.keys(SKILLS_DICT);
 const maxCount = skillsData[0].count;
 return `
 <div class="analytics-card skills-gap-card">
 <div class="skills-gap-header">
 <h3>Skills Gap Analysis</h3>
 <span class="skills-gap-meta">${skillsData.length} skills detected across ${totalWithJD} jobs</span>
 </div>
 <div class="skills-legend">
 ${cats.map((c) => `<span class="skills-legend-dot" style="--dot:${CAT_COLORS[c]}">${c}</span>`).join("")}
 </div>
 <div class="skills-cat-tabs">
 <button class="skills-cat-btn active" data-cat="all">All</button>
 ${cats.map((c) => `<button class="skills-cat-btn" data-cat="${c}" style="--cc:${CAT_COLORS[c]}">${c}</button>`).join("")}
 </div>
 <div class="skills-bars">
 ${skillsData.map(({ skill, cat, count, pct }) => `
 <div class="skill-row" data-cat="${cat}">
 <div class="skill-name">${escapeHtml(skill)}</div>
 <div class="skill-bar-track">
 <div class="skill-bar-fill" style="width:${Math.round((count / maxCount) * 100)}%;background:${CAT_COLORS[cat]}"></div>
 </div>
 <div class="skill-stat">${count} <span class="skill-pct">${pct}%</span></div>
 </div>
 `).join("")}
 </div>
 </div>`;
 })()}
 `;
 attachGraphTooltips(analyticsPanel);
 attachSkillsCatFilter(analyticsPanel);

 // Graph range dropdown
 const graphRangeSel = document.getElementById("analyticsGraphRange");
 const graphBody = document.getElementById("analyticsGraphBody");
 const graphTitle = document.getElementById("analyticsGraphTitle");
 const GRAPH_OPTIONS = {
 "7d": { label: "Weekly - Last 7 Days", opts: { days: 7 } },
 "30d": { label: "Monthly - Last 30 Days", opts: { days: 30 } },
 "1y": { label: "Yearly - Last 12 Months", opts: { monthly: true } },
 };
 if (graphRangeSel) {
 graphRangeSel.addEventListener("change", () => {
 const sel = GRAPH_OPTIONS[graphRangeSel.value];
 if (!sel) return;
 graphTitle.textContent = sel.label;
 graphBody.innerHTML = buildGraphSvg(140, sel.opts);
 attachGraphTooltips(document.getElementById("analyticsGraphCard"));
 });
 }
}

// -€-€ Actions -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
async function saveDetail(id) {
 const { job } = await api(`/api/jobs/${encodeURIComponent(id)}`, {
 method: "PATCH",
 body: JSON.stringify(currentDetailPatch()),
 });
 replaceJob(job);
 toast("Saved");
}

async function markApplied(id) {
 const { job } = await api(`/api/jobs/${encodeURIComponent(id)}/mark-applied`, { method: "POST" });
 if (state.view === "daily") state.selectedId = null;
 replaceJob(job);
 toast("Moved to Applied");
}

async function deleteJob(id) {
 if (!confirm("Delete this job? This cannot be undone.")) return;
 await api(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
 state.jobs = state.jobs.filter((job) => job.id !== id);
 state.selectedId = null;
 state.bulkSelected.delete(id);
 renderAll();
 toast("Job deleted");
}

async function bulkAction(action) {
 const ids = [...state.bulkSelected];
 if (!ids.length) return;
 const label = action === "delete" ? "Delete" : "Mark as Applied";
 if (!confirm(`${label} ${ids.length} job${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
 await api("/api/jobs/bulk", { method: "POST", body: JSON.stringify({ action, ids }) });
 state.bulkSelected.clear();
 await load();
 toast(`Done: ${ids.length} job${ids.length === 1 ? "" : "s"} ${action === "delete" ? "deleted" : "marked applied"}`);
}

async function generate(id, kind) {
 await saveDetail(id);
 setBusy(true);
 try {
 const { job, result } = await api(`/api/jobs/${encodeURIComponent(id)}/generate`, {
 method: "POST",
 body: JSON.stringify({ kind, ...currentDetailPatch() }),
 });
 replaceJob(job);
 const parts = [result.resumePath && "resume", result.coverPath && "cover letter"].filter(Boolean).join(" + ");
 toast(`Generated ${parts}`);
 } finally {
 setBusy(false);
 }
}

function exportCsv() {
 const jobs = filteredJobs();
 const headers = [
 "ID", "DateFound", "DateApplied", "Company", "Role", "Source", "URL",
 "Location", "WorkMode", "Pay", "FitScore", "ResumeMatchScore",
 "ResumeMatchedSkillCount", "ResumeJobSkillCount", "ResumeMatchedSkills",
 "Status", "Priority",
 "PipelineStage", "InterviewDate", "FollowUpDate",
 "RecruiterName", "RecruiterEmail", "RecruiterPhone", "RecruiterLinkedIn",
 "WorkAuthRisk", "Notes",
 ];
 const esc = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
 const rows = [
 headers.join(","),
 ...jobs.map((job) => [
 job.id, job.dateFound, job.dateApplied, job.company, job.role, job.source, job.url,
 job.location, job.workMode, job.pay, job.fitScore, job.resumeMatchScore,
 job.resumeMatchedSkillCount, job.resumeJobSkillCount, (job.resumeMatchedSkills || []).join("; "),
 job.status, job.priority,
 job.pipelineStage, job.interviewDate, job.followUpDate,
 job.recruiterName, job.recruiterEmail, job.recruiterPhone, job.recruiterLinkedIn,
 job.workAuthRisk, job.notes,
 ].map(esc).join(",")),
 ];
 const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `jobs-${todayString()}.csv`;
 a.click();
 URL.revokeObjectURL(url);
 toast(`Exported ${jobs.length} jobs`);
}

// -€-€ Helpers -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function setBusy(isBusy) {
 document.querySelectorAll("button").forEach((button) => {
 if (!["closeDialogBtn", "cancelDialogBtn", "chatMinimizeBtn", "chatCloseBtn", "chatLauncher"].includes(button.id)) {
 button.disabled = isBusy;
 }
 });
}

function replaceJob(job) {
 const index = state.jobs.findIndex((item) => item.id === job.id);
 if (index >= 0) state.jobs[index] = job;
 renderAll();
}

// -€-€ Chat -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function renderChat() {
 chatLog.innerHTML = state.chatMessages
 .map(
 (message) =>
 `<div class="chat-message-wrap ${escapeHtml(message.role)}">
 <div class="chat-message ${message.loading ? "loading" : ""}">${escapeHtml(message.text)}</div>
 <div class="chat-meta">${escapeHtml(chatTime(message.at))}</div>
 </div>`
 )
 .join("");
 chatLog.scrollTop = chatLog.scrollHeight;
}

function renderChatWidget() {
 const widget = $("#chatWidget");
 widget.classList.toggle("closed", state.chatMode === "closed");
 widget.classList.toggle("minimized", state.chatMode === "minimized");
 $("#chatMinimizeBtn").textContent = state.chatMode === "minimized" ? "+" : "-";
}

function setChatMode(mode) {
 state.chatMode = mode;
 localStorage.setItem(CHAT_MODE_KEY, mode);
 renderChatWidget();
}

function addChatMessage(role, text) {
 const message = newChatMessage(role, text);
 state.chatMessages.push(message);
 renderChat();
 return message;
}

function removeChatMessage(id) {
 state.chatMessages = state.chatMessages.filter((message) => message.id !== id);
 renderChat();
}

function setChatBusy(isBusy) {
 state.chatBusy = isBusy;
 $("#chatStatus").textContent = isBusy ? "Searching" : "Ready";
 $("#chatInput").disabled = isBusy;
 $("#chatSubmitBtn").disabled = isBusy;
}

// -€-€ Render all -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function renderAll() {
 renderViewControls();
 renderDateSummary();
 renderMetrics();
 renderSourceFilter();
 renderHomeLineGraph();
 renderRows();
 renderChat();
 renderChatWidget();
}

// -€-€ Data loading -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
async function load() {
 const [{ jobs }, { appRoot }] = await Promise.all([api("/api/jobs"), api("/api/folders"), loadAppConfig()]);
 state.jobs = jobs.sort((a, b) => Number(b.fitScore || 0) - Number(a.fitScore || 0));
 $("#folderLine").textContent = appRoot;
 renderAll();
}

async function pollAutoRefresh() {
 try {
 const { at, added, nextAt, running } = await api("/api/auto-refresh-status");
 state.autoRefreshNextAt = nextAt || null;
 state.autoRefreshRunning = Boolean(running);
 if (at && at !== state.autoRefreshAt) {
 state.autoRefreshAt = at;
 await load();
 if (added > 0) toast(`Auto-refresh: ${added} new job${added === 1 ? "" : "s"} added`);
 }
 renderDateSummary();
 } catch (_) {}
}

async function refreshCsv() {
 const btn = $("#refreshCsvBtn");
 const originalLabel = btn ? btn.textContent : "";
 if (btn) { btn.textContent = "Searching..."; btn.disabled = true; }
 setBusy(true);
 try {
 const result = await api("/api/find-jobs", { method: "POST" });
 state.lastRefreshAt = new Date().toISOString();
 const activeSources = Object.values(result.sourceBreakdown || {}).filter((count) => count > 0).length;
 const searchedSources = Number(result.sourcesSearched || Object.keys(result.sourceBreakdown || {}).length);
 const added = Number(result.added || 0);
 const dupes = Number(result.duplicatesSkipped || 0);
 if (added > 0) {
 toast(`Searched ${searchedSources} portals; added ${added} new job${added === 1 ? "" : "s"} from ${activeSources}`);
 } else {
 toast(`Searched ${searchedSources} portals; ${dupes} duplicate${dupes === 1 ? "" : "s"} skipped, no new jobs`);
 }
 await load();
 } catch (error) {
 toast(`Search failed: ${error.message}`);
 console.error("refreshCsv error:", error);
 } finally {
 setBusy(false);
 if (btn) { btn.textContent = originalLabel; btn.disabled = false; }
 }
}

async function submitChatMessage(message) {
 if (!message) return;
 setChatMode("open");
 addChatMessage("user", message);
 const pending = newChatMessage("assistant", "Searching", { loading: true });
 state.chatMessages.push(pending);
 renderChat();
 setChatBusy(true);
 setBusy(true);
 try {
 const response = await api("/api/chat", { method: "POST", body: JSON.stringify({ message }) });
 removeChatMessage(pending.id);
 addChatMessage("assistant", response.reply || "Done.");
 if (["portal_search", "full_search", "company_url_search", "jd_applied"].includes(response.action)) {
 state.lastRefreshAt = new Date().toISOString();
 await load();
 }
 } catch (error) {
 removeChatMessage(pending.id);
 addChatMessage("assistant", error.message);
 } finally {
 setBusy(false);
 setChatBusy(false);
 }
}

async function sendChat(event) {
 event.preventDefault();
 const input = $("#chatInput");
 const message = input.value.trim();
 input.value = "";
 await submitChatMessage(message);
}

// -€-€ Skill suggestions from job titles -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
const TITLE_SKILL_KB = {
 // .NET / C# roles
 "dotnet": { must: ["C#",".NET","ASP.NET Core","REST API","SQL Server"], nice: ["Azure","Docker","TypeScript","Angular","React","Redis","Microservices"] },
 ".net": { must: ["C#",".NET","ASP.NET Core","REST API","SQL Server"], nice: ["Azure","Docker","TypeScript","Angular","React","Redis","Microservices"] },
 "c#": { must: ["C#",".NET","OOP","SQL","Git"], nice: ["Azure","ASP.NET","Docker","TypeScript","Entity Framework"] },
 // Full stack
 "full stack": { must: ["JavaScript","HTML","CSS","REST API","SQL","Git"], nice: ["React","Angular","TypeScript","Node.js","Docker","Azure"] },
 "fullstack": { must: ["JavaScript","HTML","CSS","REST API","SQL","Git"], nice: ["React","Angular","TypeScript","Node.js","Docker","Azure"] },
 // Frontend
 "frontend": { must: ["HTML","CSS","JavaScript","TypeScript","Git"], nice: ["React","Angular","CSS Grid","Accessibility","Testing","Webpack"] },
 "front end": { must: ["HTML","CSS","JavaScript","TypeScript","Git"], nice: ["React","Angular","CSS Grid","Accessibility","Testing","Webpack"] },
 "react": { must: ["React","JavaScript","TypeScript","HTML","CSS","Git"], nice: ["Redux","React Query","Node.js","REST API","Jest","Storybook"] },
 "angular": { must: ["Angular","TypeScript","RxJS","HTML","CSS","Git"], nice: ["REST API","NgRx","Jest","Azure DevOps","Testing"] },
 // Backend
 "backend": { must: ["REST API","SQL","Git","OOP"], nice: ["Node.js","Python","Java","Docker","Redis","Microservices","Cloud"] },
 "back end": { must: ["REST API","SQL","Git","OOP"], nice: ["Node.js","Python","Java","Docker","Redis","Microservices","Cloud"] },
 "node": { must: ["Node.js","JavaScript","REST API","SQL","Git"], nice: ["TypeScript","Docker","Redis","React","AWS","MongoDB"] },
 // Cloud / DevOps
 "cloud": { must: ["Azure","Docker","CI/CD","Git","Linux"], nice: ["Kubernetes","Terraform","Azure DevOps","TypeScript","Python"] },
 "devops": { must: ["Docker","CI/CD","Azure DevOps","Git","Linux"], nice: ["Kubernetes","Terraform","Azure","Bash","Python","Helm"] },
 "azure": { must: ["Azure","CI/CD","Docker","Git"], nice: ["Kubernetes","Azure DevOps","TypeScript","Terraform","Monitoring"] },
 // Software engineer / developer (generic)
 "software engineer": { must: ["OOP","Git","SQL","REST API","Data Structures"], nice: ["Python","JavaScript","Java","Docker","Cloud","TypeScript"] },
 "software developer":{ must: ["OOP","Git","SQL","REST API","Data Structures"], nice: ["Python","JavaScript","Java","Docker","Cloud","TypeScript"] },
 "developer": { must: ["OOP","Git","SQL","REST API"], nice: ["JavaScript","Python","Java","Docker","Cloud","TypeScript"] },
 "engineer": { must: ["OOP","Git","SQL","REST API"], nice: ["JavaScript","Python","Java","Docker","Cloud","TypeScript"] },
 // Microservices / architecture
 "microservices":{ must: ["Microservices","REST API","Docker","SQL","Git"], nice: ["Kubernetes","Cloud","Redis","RabbitMQ","CQRS"] },
 "architect": { must: ["OOP","REST API","SQL","Microservices","Cloud"], nice: ["Docker","Kubernetes","TypeScript","CI/CD","Security"] },
 // Data
 "data": { must: ["SQL","Python","Data Analysis","Statistics","Git"], nice: ["Power BI","Tableau","ETL","Spark","Machine Learning","Cloud"] },
 "analyst": { must: ["SQL","Excel","Data Analysis","Statistics"], nice: ["Python","Power BI","Tableau","Data Modeling","Communication"] },
 "data scientist": { must: ["Python","Statistics","Machine Learning","SQL","Data Analysis"], nice: ["Pandas","NumPy","Scikit-learn","Experiment Design","MLOps"] },
 "machine learning": { must: ["Python","Machine Learning","Statistics","Scikit-learn","Data Analysis"], nice: ["PyTorch","TensorFlow","MLflow","Feature Engineering","MLOps"] },
 "ai/ml": { must: ["Python","Machine Learning","Statistics","SQL","Data Analysis"], nice: ["PyTorch","TensorFlow","MLflow","FastAPI","Cloud"] },
 "mlops": { must: ["Python","Docker","CI/CD","MLflow","Cloud"], nice: ["Kubernetes","Terraform","Monitoring","Feature Stores","Airflow"] },
 "gen ai": { must: ["Python","LLM","Prompt Engineering","REST API","Git"], nice: ["RAG","OpenAI","LangChain","Vector Databases","FastAPI"] },
 "generative ai":{ must: ["Python","LLM","Prompt Engineering","REST API","Git"], nice: ["RAG","OpenAI","LangChain","Vector Databases","FastAPI"] },
 "ai engineer": { must: ["Python","Machine Learning","LLM","REST API","Git"], nice: ["RAG","OpenAI","LangChain","Vector Databases","Docker"] },
 "python": { must: ["Python","OOP","SQL","Git","REST API"], nice: ["FastAPI","Django","Flask","Pandas","Docker"] },
 "java": { must: ["Java","OOP","Spring Boot","REST API","SQL"], nice: ["Microservices","Docker","Kafka","AWS","JUnit"] },
 "qa": { must: ["Testing","API Testing","Git","SQL"], nice: ["Selenium","Playwright","Cypress","CI/CD","JavaScript"] },
 "test": { must: ["Testing","API Testing","Git","SQL"], nice: ["Selenium","Playwright","Cypress","CI/CD","JavaScript"] },
 "security": { must: ["Security","Networking","Linux","OWASP"], nice: ["Cloud Security","SIEM","Python","Incident Response","Threat Modeling"] },
 "salesforce": { must: ["Salesforce","Apex","SOQL","CRM"], nice: ["Lightning","REST API","Data Modeling","Agile","Communication"] },
 "designer": { must: ["UX Design","Figma","User Research","Wireframing"], nice: ["Prototyping","Accessibility","HTML","CSS","Stakeholder Management"] },
 "product": { must: ["Stakeholder Management","Communication","Agile","Data Analysis"], nice: ["SQL","Roadmapping","User Research","Experiment Design","Documentation"] },
 "business analyst": { must: ["Communication","Documentation","SQL","Data Analysis"], nice: ["Agile","Jira","Power BI","Stakeholder Management","Process Mapping"] },
};

function normalizeTitleKeyword(value) {
 return String(value || "").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
}

function genericSkillsForTitle(title) {
 const normalized = normalizeTitleKeyword(title);
 const must = new Set(["Communication", "Documentation"]);
 const nice = new Set(["Agile", "Jira"]);
 if (/\b(engineer|developer|programmer|architect)\b/.test(normalized)) {
 ["OOP", "Git", "REST API"].forEach((s) => must.add(s));
 ["Docker", "CI/CD", "Cloud"].forEach((s) => nice.add(s));
 }
 if (/\b(analyst|scientist|data|bi|report)\b/.test(normalized)) {
 ["SQL", "Data Analysis", "Statistics"].forEach((s) => must.add(s));
 ["Python", "Power BI", "Tableau"].forEach((s) => nice.add(s));
 }
 if (/\b(manager|lead|director|coordinator|specialist|consultant)\b/.test(normalized)) {
 ["Stakeholder Management", "Communication", "Documentation"].forEach((s) => must.add(s));
 ["Agile", "Process Improvement", "Data Analysis"].forEach((s) => nice.add(s));
 }
 return { must: [...must], nice: [...nice] };
}

const BROAD_TITLE_SKILL_KEYS = new Set(["developer", "engineer", "software engineer", "software developer"]);

function suggestSkillsFromTitles() {
 const rawTitles = ($("#settingsTitles").value || "")
 .split(/\r?\n|,/)
 .map((title) => title.trim())
 .filter(Boolean);
 const titlesText = rawTitles.join(" ").toLowerCase();
 if (!titlesText.trim()) { toast("Enter at least one job title first"); return; }

 const mustSet = new Set();
 const niceSet = new Set();

 for (const title of rawTitles) {
 const generic = genericSkillsForTitle(title);
 generic.must.forEach(s => mustSet.add(s));
 generic.nice.forEach(s => niceSet.add(s));
 const normalizedTitle = normalizeTitleKeyword(title);
 const matchedSpecific = Object.keys(TITLE_SKILL_KB)
 .filter((keyword) => !BROAD_TITLE_SKILL_KEYS.has(keyword))
 .some((keyword) => normalizedTitle.includes(keyword));
 for (const [keyword, skills] of Object.entries(TITLE_SKILL_KB)) {
 if (matchedSpecific && BROAD_TITLE_SKILL_KEYS.has(keyword)) continue;
 if (normalizedTitle.includes(keyword)) {
 skills.must.forEach(s => mustSet.add(s));
 skills.nice.forEach(s => niceSet.add(s));
 }
 }
 }

 // Remove must-haves from nice list to avoid overlap
 mustSet.forEach(s => niceSet.delete(s));

 if (!mustSet.size && !niceSet.size) {
 toast("No skill suggestions found for these titles - try more specific titles");
 return;
 }

 const box = $("#skillSuggestionsBox");
 const renderTags = (set, containerId) => {
 const el = document.getElementById(containerId);
 el.innerHTML = [...set].map(s =>
 `<span style="background:#e0e7ff;color:#3730a3;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:600;">${s}</span>`
 ).join("");
 };

 renderTags(mustSet, "suggestMustTags");
 renderTags(niceSet, "suggestNiceTags");
 box.dataset.must = [...mustSet].join(", ");
 box.dataset.nice = [...niceSet].join(", ");
 box.style.display = "block";
}

function applySkillSuggestions(type) {
 const box = $("#skillSuggestionsBox");
 if (type === "must") {
 const existing = ($("#settingsMustHave").value || "").split(",").map(s => s.trim()).filter(Boolean);
 const suggested = (box.dataset.must || "").split(",").map(s => s.trim()).filter(Boolean);
 const merged = [...new Set([...existing, ...suggested])];
 $("#settingsMustHave").value = merged.join(", ");
 toast("Must-have skills applied OK");
 } else {
 const existing = ($("#settingsNiceToHave").value || "").split(",").map(s => s.trim()).filter(Boolean);
 const suggested = (box.dataset.nice || "").split(",").map(s => s.trim()).filter(Boolean);
 const merged = [...new Set([...existing, ...suggested])];
 $("#settingsNiceToHave").value = merged.join(", ");
 toast("Nice-to-have skills applied OK");
 }
}

// -€-€ Event setup -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
function setupEvents() {
 $("#searchInput").addEventListener("input", (event) => {
 state.query = event.target.value;
 renderSourceFilter();
 renderRows();
 });
 $("#statusFilter").addEventListener("change", (event) => {
 state.status = event.target.value;
 renderSourceFilter();
 renderRows();
 });
 $("#priorityFilter").addEventListener("change", (event) => {
 state.priority = event.target.value;
 renderSourceFilter();
 renderRows();
 });
 $("#sourceFilter").addEventListener("change", (event) => {
 state.source = event.target.value;
 renderRows();
 });

const tf = $("#typeFilter");
if (tf) {
  tf.addEventListener("change", (e) => {
    state.type = e.target.value;
    renderRows();
  });
}

 $("#dateFilter").addEventListener("change", (event) => {
 state.date = event.target.value || todayString();
 state.source = "all";
 state.priority = "all";
 state.selectedId = null;
 $("#priorityFilter").value = "all";
 renderAll();
 });
 $("#todayBtn").onclick = () => {
 state.date = todayString();
 state.source = "all";
 state.priority = "all";
 state.selectedId = null;
 $("#priorityFilter").value = "all";
 renderAll();
 };

 function switchView(view) {
 state.view = view;
 state.source = "all";
 state.status = "all";
 state.priority = "all";
 state.selectedId = null;
 state.bulkSelected.clear();
 const sf = $("#statusFilter");
 const pf = $("#priorityFilter");
  const tfil = $("#typeFilter");
  if (tfil) tfil.value = "all";
  state.type = "all";
 if (sf) sf.value = "all";
 if (pf) pf.value = "all";
 renderAll();
 }
 $("#dailyViewBtn").onclick = () => switchView("daily");
 $("#appliedViewBtn").onclick = () => switchView("applied");
 $("#allJobsViewBtn").onclick = () => switchView("all");
 $("#analyticsViewBtn").onclick = () => switchView("analytics");
 $("#roadmapViewBtn").onclick = () => switchView("roadmap");
 const _prepBtn = $("#prepViewBtn"); if (_prepBtn) _prepBtn.onclick = () => switchView("prep");


 // Bulk actions
 $("#selectAll").addEventListener("change", (event) => {
 const jobs = filteredJobs();
 if (event.target.checked) {
 jobs.forEach((job) => state.bulkSelected.add(job.id));
 } else {
 state.bulkSelected.clear();
 }
 renderRows();
 });
 jobRows.addEventListener("change", (event) => {
 const id = event.target.dataset.check;
 if (!id) return;
 if (event.target.checked) {
 state.bulkSelected.add(id);
 } else {
 state.bulkSelected.delete(id);
 }
 renderBulkBar();
 const jobs = filteredJobs();
 const selectAllEl = $("#selectAll");
 if (selectAllEl) selectAllEl.checked = jobs.length > 0 && jobs.every((j) => state.bulkSelected.has(j.id));
 });
 $("#bulkAppliedBtn").onclick = () => bulkAction("mark-applied");
 $("#bulkDeleteBtn").onclick = () => bulkAction("delete");
 $("#bulkClearBtn").onclick = () => {
 state.bulkSelected.clear();
 renderRows();
 };

 jobRows.addEventListener("click", (event) => {
 const openId = event.target.dataset.open;
 const appliedId = event.target.dataset.applied;
 const generateResumeId = event.target.dataset.generateResume;
 const generateCoverId = event.target.dataset.generateCover;
 if (openId) {
 const job = state.jobs.find((item) => item.id === openId);
 if (job?.url) window.open(job.url, "_blank", "noopener");
 event.stopPropagation();
 return;
 }
 if (generateResumeId) {
 state.selectedId = generateResumeId;
 renderRows();
 generate(generateResumeId, "resume");
 event.stopPropagation();
 return;
 }
 if (generateCoverId) {
 state.selectedId = generateCoverId;
 renderRows();
 generate(generateCoverId, "cover");
 event.stopPropagation();
 return;
 }
 if (appliedId) {
 markApplied(appliedId);
 event.stopPropagation();
 return;
 }
 const row = event.target.closest("tr[data-id]");
 if (row) {
 state.selectedId = row.dataset.id;
 renderRows();
 }
 });

 $("#refreshCsvBtn").onclick = refreshCsv;
 $("#exportCsvBtn").onclick = exportCsv;
 $("#settingsBtn").onclick = openSettings;
 $("#closeSettingsBtn").onclick = () => $("#settingsDialog").close();
 $("#cancelSettingsBtn").onclick = () => $("#settingsDialog").close();
 $("#saveSettingsBtn").onclick = saveSettings;
 $("#suggestSkillsBtn").onclick = suggestSkillsFromTitles;
 $("#applyMustSuggestBtn").onclick = () => applySkillSuggestions("must");
 $("#applyNiceSuggestBtn").onclick = () => applySkillSuggestions("nice");
 $("#applyAllSuggestBtn").onclick = () => { applySkillSuggestions("must"); applySkillSuggestions("nice"); };
 $("#selectAllSourcesBtn").onclick = () => {
 document.querySelectorAll("[name^='source_']").forEach((cb) => { cb.checked = true; });
 };
 $("#deselectAllSourcesBtn").onclick = () => {
 document.querySelectorAll("[name^='source_']").forEach((cb) => { cb.checked = false; });
 };
 $("#chatForm").addEventListener("submit", sendChat);
 $("#chatMinimizeBtn").onclick = () => setChatMode(state.chatMode === "minimized" ? "open" : "minimized");
 $("#chatCloseBtn").onclick = () => setChatMode("closed");
 $("#chatLauncher").onclick = () => setChatMode("open");
 document.querySelectorAll("[data-chat-prompt]").forEach((button) => {
 button.addEventListener("click", () => submitChatMessage(button.dataset.chatPrompt || ""));
 });
 $("#addJobBtn").onclick = () => {
 $("#dialogDateFound").value = state.date;
 $("#jobDialog").showModal();
 };
 $("#closeDialogBtn").onclick = () => $("#jobDialog").close();
 $("#cancelDialogBtn").onclick = () => $("#jobDialog").close();
 $("#jobForm").addEventListener("submit", async (event) => {
 event.preventDefault();
 const form = new FormData(event.currentTarget);
 const payload = Object.fromEntries(form.entries());
 const { job } = await api("/api/jobs", { method: "POST", body: JSON.stringify(payload) });
 state.jobs.unshift(job);
 state.selectedId = job.id;
 $("#jobDialog").close();
 event.currentTarget.reset();
 renderAll();
 toast("Job added");
 });
}

setupEvents();
load().catch((error) => toast(error.message));
pollAutoRefresh();

// -€-€ Panel resize -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
(function initPanelResize() {
 const divider = document.getElementById("panelDivider");
 const layout = divider?.closest(".layout");
 const listPanel = layout?.querySelector(".job-list-panel");
 const detPanel = layout?.querySelector(".detail-panel");
 if (!divider || !listPanel || !detPanel) return;
 const DEFAULT_DETAIL_WIDTH = 320;
 const MIN_DETAIL_WIDTH = 220;

 const minListWidthFor = (layoutW) => {
 return Math.min(620, Math.max(420, Math.round(layoutW * 0.52)));
 };

 const clampDetailWidth = (width) => {
 const layoutW = layout.getBoundingClientRect().width;
 const maxDetailW = Math.max(layoutW - minListWidthFor(layoutW), MIN_DETAIL_WIDTH);
 return Math.min(Math.max(Number(width) || DEFAULT_DETAIL_WIDTH, MIN_DETAIL_WIDTH), maxDetailW);
 };

 // Restore saved widths
 const saved = localStorage.getItem("panelDetailWidth");
 if (saved) {
 const restoredW = clampDetailWidth(saved);
 detPanel.style.flex = `0 0 ${restoredW}px`;
 localStorage.setItem("panelDetailWidth", restoredW);
 }

 let startX, startW;

 divider.addEventListener("mousedown", (e) => {
 e.preventDefault();
 startX = e.clientX;
 startW = detPanel.getBoundingClientRect().width;
 divider.classList.add("dragging");
 document.body.style.cursor = "col-resize";
 document.body.style.userSelect = "none";
 });

 document.addEventListener("mousemove", (e) => {
 if (!divider.classList.contains("dragging")) return;
 const delta = startX - e.clientX; // moving left -> detail grows
 const newW = clampDetailWidth(startW + delta);
 detPanel.style.flex = `0 0 ${newW}px`;
 localStorage.setItem("panelDetailWidth", newW);
 });

 document.addEventListener("mouseup", () => {
 if (!divider.classList.contains("dragging")) return;
 divider.classList.remove("dragging");
 document.body.style.cursor = "";
 document.body.style.userSelect = "";
 });

 // Double-click resets to default
 divider.addEventListener("dblclick", () => {
 detPanel.style.flex = `0 0 ${clampDetailWidth(DEFAULT_DETAIL_WIDTH)}px`;
 localStorage.removeItem("panelDetailWidth");
 });
})();

// Poll for server-side auto-refresh every 5 minutes
setInterval(pollAutoRefresh, 5 * 60 * 1000);


// -------------------------------------------------------------------------------
// ROADMAP - fully isolated, appended after all existing code
// -------------------------------------------------------------------------------

const SKILL_META_RM = {
 "OOP": { phase:1, label:"OOP", icon:"", desc:"Classes, inheritance, polymorphism, encapsulation" },
 "Git": { phase:1, label:"Git", icon:"", desc:"Branching, merging, pull requests, rebasing" },
 "HTML": { phase:1, label:"HTML", icon:"", desc:"Semantic markup, forms, accessibility" },
 "CSS": { phase:1, label:"CSS", icon:"", desc:"Flexbox, Grid, responsive design" },
 "JavaScript": { phase:1, label:"JavaScript", icon:"Active", desc:"ES6+, async/await, DOM, fetch API" },
 "SQL": { phase:1, label:"SQL", icon:"", desc:"SELECT, JOINs, indexes, transactions" },
 "C#": { phase:2, label:"C#", icon:"", desc:"LINQ, async, generics, delegates" },
 ".NET": { phase:2, label:".NET", icon:"", desc:".NET 6/8, DI, NuGet, CLR" },
 "ASP.NET": { phase:2, label:"ASP.NET Core", icon:"", desc:"Web API, middleware, filters, routing" },
 "REST API": { phase:2, label:"REST API", icon:"", desc:"HTTP verbs, status codes, JWT, versioning" },
 "SQL Server": { phase:2, label:"SQL Server", icon:"", desc:"T-SQL, EF Core, stored procs, indexes" },
 "Node.js": { phase:2, label:"Node.js", icon:"", desc:"Express, async I/O, npm, streams" },
 "Azure": { phase:3, label:"Azure", icon:"", desc:"App Service, Azure SQL, Key Vault, Blob" },
 "Docker": { phase:3, label:"Docker", icon:"", desc:"Images, Dockerfile, Compose, networking" },
 "Azure DevOps": { phase:3, label:"Azure DevOps", icon:"", desc:"Pipelines, boards, environments, gates" },
 "TypeScript": { phase:3, label:"TypeScript", icon:"", desc:"Types, interfaces, generics, strict mode" },
 "CI/CD": { phase:3, label:"CI/CD", icon:"", desc:"Build pipelines, automated deploys" },
 "Angular": { phase:4, label:"Angular", icon:"", desc:"Components, RxJS, routing, lazy load" },
 "React": { phase:4, label:"React", icon:"", desc:"Hooks, context, React Query, patterns" },
 "Microservices": { phase:4, label:"Microservices", icon:"", desc:"Service mesh, messaging, Saga, CQRS" },
 "Kubernetes": { phase:4, label:"Kubernetes", icon:"", desc:"Pods, services, Helm, AKS deployments" },
 "Redis": { phase:4, label:"Redis", icon:"", desc:"Caching, pub/sub, data structures" },
 "CS Fundamentals": { phase:1, label:"CS Fundamentals", icon:"", desc:"OS, networking, memory, processes, compilers" },
 "DSA": { phase:2, label:"DSA Preparation", icon:"", desc:"Arrays, trees, graphs, sorting, dynamic programming" },
 "System Design": { phase:4, label:"System Design", icon:"", desc:"Scalability, load balancing, databases, caching, queues" },
};

const PHASE_META_RM = [
 { num:1, label:"Foundation", icon:"", color:"#4caf50", desc:"Core concepts every developer needs" },
 { num:2, label:"Core Stack", icon:"", color:"#2196f3", desc:"Primary tech stack for your target roles" },
 { num:3, label:"Cloud & Tooling", icon:"", color:"#9c27b0", desc:"Cloud platforms, DevOps, modern tooling" },
 { num:4, label:"Specialisation", icon:"", color:"#ff5722", desc:"Advanced skills that set you apart" },
];

const SKILL_CONCEPTS_RM = {
 "OOP": { sections:[
 { title:"Core Pillars", items:["Encapsulation - bundling data + methods, access modifiers (public/private/protected)","Inheritance - base/derived classes, method overriding, abstract classes","Polymorphism - method overloading vs overriding, interface-based polymorphism","Abstraction - abstract classes vs interfaces, hiding implementation details"] },
 { title:"SOLID Principles", items:["Single Responsibility - one reason to change per class","Open/Closed - open for extension, closed for modification","Liskov Substitution - subtypes must be substitutable for base types","Interface Segregation - many specific interfaces over one general","Dependency Inversion - depend on abstractions, not concretions"] },
 { title:"Design Patterns", items:["Creational - Singleton, Factory, Builder, Prototype","Structural - Adapter, Decorator, Facade, Proxy","Behavioural - Observer, Strategy, Command, Repository, Iterator"] },
 ]},
 "Git": { sections:[
 { title:"Core Commands", items:["init, clone, status, add, commit, push, pull, fetch","branch, checkout, switch, merge, rebase","stash / stash pop, log, diff, blame"] },
 { title:"Branching Strategies", items:["Git Flow - feature, develop, release, hotfix branches","Trunk-based development - short-lived feature branches","Conventional commits - feat:, fix:, chore:, breaking changes","Pull requests - code review, squash vs merge vs rebase"] },
 { title:"Advanced", items:["Interactive rebase - squash, fixup, reorder commits","Cherry-pick, reset (soft/hard/mixed), revert","Git hooks, .gitignore, submodules"] },
 ]},
 "C#": { sections:[
 { title:"Language Core", items:["Value vs reference types, nullable types (T?), records, structs","Classes - constructors, properties, indexers, static members","Generics - generic classes/methods, constraints (where T : class, new())","Delegates, Func<>, Action<>, events, multicast delegates"] },
 { title:"LINQ & Collections", items:["LINQ - Where, Select, OrderBy, GroupBy, Join, Aggregate","Method syntax vs query syntax, deferred vs immediate execution","List<T>, Dictionary<K,V>, HashSet<T>, Queue<T>, Stack<T>"] },
 { title:"Async & Concurrency", items:["async/await, Task, Task<T>, ValueTask","CancellationToken, Task.WhenAll / Task.WhenAny","lock, Monitor, SemaphoreSlim for thread safety"] },
 { title:"Modern C# (.NET 6-8)", items:["Pattern matching - switch expressions, property patterns","Top-level statements, global usings, file-scoped namespaces","Required members, primary constructors (C# 12), collection expressions"] },
 ]},
 ".NET": { sections:[
 { title:"Runtime & SDK", items:["CLR - JIT compilation, GC (gen 0/1/2), finalizers","dotnet CLI - new, build, run, test, publish, pack",".csproj, TargetFramework, PackageReference, SDK-style projects","NuGet - packages, versioning, private feeds, lock files"] },
 { title:"Dependency Injection", items:["IServiceCollection - AddSingleton, AddScoped, AddTransient","Constructor injection, IServiceProvider","Options pattern - IOptions<T>, IOptionsMonitor<T>","Keyed services (.NET 8), decorator pattern with DI"] },
 { title:"Testing", items:["xUnit / NUnit / MSTest - attributes, setup/teardown, test data","Moq / NSubstitute - mocking, verify calls, setup returns","FluentAssertions - readable assertions","Integration tests - WebApplicationFactory<T>, TestServer"] },
 ]},
 "ASP.NET": { sections:[
 { title:"Web API", items:["[ApiController], [Route], [HttpGet/Post/Put/Delete/Patch]","Action results - Ok(), NotFound(), BadRequest(), Created()","Model binding - [FromBody], [FromQuery], [FromRoute]","Filters - IActionFilter, IExceptionFilter"] },
 { title:"Middleware", items:["Pipeline - Use, Run, Map, MapWhen","Built-in - Authentication, Authorization, CORS, StaticFiles","Custom middleware - IMiddleware, RequestDelegate, HttpContext","Minimal APIs - app.MapGet/Post, endpoint filters, route groups"] },
 { title:"Security & Patterns", items:["JWT Bearer, cookie auth, OAuth2/OIDC","[Authorize], policies, roles, claims-based authorization","CORS - AllowSpecificOrigins, credentials","Repository pattern, CQRS with MediatR, clean architecture"] },
 ]},
 "REST API": { sections:[
 { title:"HTTP Fundamentals", items:["Methods - GET, POST, PUT, PATCH, DELETE + idempotency rules","Status codes - 200, 201, 204, 400, 401, 403, 404, 409, 422, 500","Headers - Content-Type, Authorization, Cache-Control, ETag","Request/Response - JSON, content negotiation"] },
 { title:"Design Best Practices", items:["Resource naming - nouns not verbs, plural (/users not /getUser)","Versioning - /api/v1 or Accept-Version header","Pagination - limit/offset, cursor-based, Link headers","Error responses - RFC 7807 Problem Details format"] },
 { title:"Security", items:["JWT - header.payload.signature, claims, expiry, refresh tokens","OAuth 2.0 - Authorization Code, Client Credentials, PKCE","Rate limiting, throttling, retry-after header","HTTPS only, input validation, CORS policy"] },
 ]},
 "Azure": { sections:[
 { title:"Compute", items:["Azure App Service - plans, deployment slots, scaling, custom domains","Azure Functions - triggers (HTTP, Timer, Queue, Blob), bindings","Azure Container Apps - serverless containers, KEDA scaling","Virtual Machines - sizes, availability sets, managed disks"] },
 { title:"Data & Storage", items:["Azure SQL Database - DTU vs vCore, geo-replication, backups","Cosmos DB - NoSQL, partitioning, consistency levels, RU/s","Azure Blob Storage - containers, access tiers, SAS tokens","Azure Cache for Redis - tiers, eviction policies"] },
 { title:"Identity & DevOps", items:["Entra ID - app registrations, managed identity, RBAC","Azure Key Vault - secrets, keys, certificates","Application Insights - traces, metrics, distributed tracing","Azure Monitor - alerts, dashboards, Log Analytics KQL"] },
 ]},
 "Docker": { sections:[
 { title:"Core Concepts", items:["Images vs containers - layers, copy-on-write, registries","Dockerfile - FROM, WORKDIR, COPY, RUN, ENV, EXPOSE, ENTRYPOINT","Multi-stage builds - separate build/runtime for smaller images","docker CLI - build, run, ps, exec, logs, stop, rm"] },
 { title:"Docker Compose", items:["docker-compose.yml - services, volumes, networks, depends_on","Environment variables - .env files, env_file key","Volume mounts - named volumes vs bind mounts","docker compose up/down/logs/exec"] },
 { title:"Best Practices", items:["Use specific image tags, not :latest",".dockerignore - exclude node_modules, .git","Run as non-root user (USER directive)","HEALTHCHECK instruction, keep images minimal"] },
 ]},
 "Angular": { sections:[
 { title:"Core Architecture", items:["Standalone Components (Angular 17+) vs NgModules","Components - @Component, template, styles, changeDetection","Services & DI - @Injectable, providedIn: root","Lifecycle hooks - ngOnInit, ngOnDestroy, ngOnChanges"] },
 { title:"Templates & Binding", items:["Interpolation {{ }}, property [], event (), two-way [()]","Control flow - @if, @for, @switch (Angular 17+)","Pipes - date, currency, async, uppercase; custom pipes","Template refs (#ref), ViewChild, ContentChild"] },
 { title:"RxJS & Routing", items:["Observable, Subject, BehaviorSubject","Operators - map, filter, switchMap, catchError, takeUntil","RouterModule, routerLink, lazy loading with loadComponent","Route guards - CanActivate, CanDeactivate, Resolve","HttpClient - interceptors, error handling"] },
 ]},
 "React": { sections:[
 { title:"Core Concepts", items:["JSX, fragments, conditional rendering, lists with keys","Function components, props, children","useState, batched updates, functional updates","Virtual DOM, reconciliation, why keys matter"] },
 { title:"Hooks", items:["useEffect - dependencies, cleanup","useRef, useMemo, useCallback for performance","useContext - Context API, createContext, Provider","Custom hooks - extracting reusable stateful logic"] },
 { title:"Ecosystem", items:["React Query / TanStack - useQuery, useMutation, caching","Zustand / Redux Toolkit for global state","React Router v6 - Routes, useNavigate, useParams","Next.js - App Router, Server Components, SSR/SSG"] },
 ]},
 "Microservices": { sections:[
 { title:"Architecture", items:["Single Responsibility - each service owns one bounded context","Service autonomy - independent deployment, own database","API Gateway - routing, auth, rate limiting (YARP, Ocelot)","Service discovery - Kubernetes DNS, Consul, health checks"] },
 { title:"Communication", items:["Synchronous - REST/HTTP, gRPC with Protobuf","Asynchronous - RabbitMQ, Azure Service Bus, Kafka","Event-driven - pub/sub, event sourcing, outbox pattern","Saga - choreography vs orchestration for distributed transactions"] },
 { title:"Resilience & Data", items:["Circuit breaker - Polly (Retry, CircuitBreaker, Timeout)","Distributed tracing - OpenTelemetry, correlation IDs","CQRS - separate read/write models, eventual consistency","Database per service, polyglot persistence"] },
 ]},
 "CS Fundamentals": { sections:[
 { title:"Operating Systems", items:[
 "Processes vs threads - creation, lifecycle, context switching",
 "Memory management - stack vs heap, virtual memory, paging, segmentation",
 "Deadlocks - conditions, prevention, detection, Banker's algorithm",
 "CPU scheduling - FCFS, SJF, Round Robin, Priority scheduling",
 "File systems - inodes, directories, FAT vs ext4, permissions",
 "Inter-process communication - pipes, sockets, shared memory, message queues",
 ]},
 { title:"Computer Networking", items:[
 "OSI & TCP/IP models - all 7 layers with examples",
 "HTTP/HTTPS - request/response cycle, headers, status codes, TLS",
 "TCP vs UDP - handshake, reliability, flow control, use cases",
 "DNS - resolution process, A/CNAME/MX records, TTL",
 "Sockets - how servers accept connections, blocking vs non-blocking I/O",
 "REST vs WebSockets vs gRPC - when to use each",
 ]},
 { title:"Memory & Data Representation", items:[
 "Binary, hex, two's complement - number representation",
 "Stack frames - function calls, local variables, return addresses",
 "Heap allocation - malloc/free, garbage collection basics",
 "Pointers & references - how they work under the hood",
 ]},
 { title:"Compilers & Runtimes", items:[
 "Compilation pipeline - lexing, parsing, AST, code generation",
 "Interpreted vs compiled vs JIT - Python vs C vs Java/.NET CLR",
 "Garbage collection - mark-and-sweep, reference counting, generational GC",
 "Concurrency primitives - mutex, semaphore, monitor, condition variable",
 ]},
 ]},
 "DSA": { sections:[
 { title:"Arrays & Strings", items:[
 "Two pointers technique - sliding window, left/right pointers",
 "Prefix sums - range queries in O(1) after O(n) preprocessing",
 "Sorting algorithms - bubble, merge, quick, heap sort with trade-offs",
 "Binary search - standard, rotated arrays, search on answer",
 "String manipulation - anagrams, palindromes, KMP pattern matching",
 ]},
 { title:"Linked Lists, Stacks & Queues", items:[
 "Singly & doubly linked lists - insert, delete, reverse, detect cycle",
 "Stack applications - balanced parentheses, monotonic stack",
 "Queue & deque - BFS traversal, sliding window maximum",
 "Priority Queue / Min-Max Heap - top-K problems, median of stream",
 ]},
 { title:"Trees & Graphs", items:[
 "Binary trees - inorder/preorder/postorder, height, diameter, LCA",
 "Binary Search Tree - insert, delete, validate, kth smallest",
 "Tries - prefix search, autocomplete, word dictionary",
 "BFS & DFS - traversal, cycle detection, topological sort",
 "Shortest paths - Dijkstra, Bellman-Ford, Floyd-Warshall",
 "Union-Find - connected components, Kruskal's MST",
 ]},
 { title:"Dynamic Programming", items:[
 "Memoization vs tabulation - top-down vs bottom-up approaches",
 "Classic DP - Fibonacci, climbing stairs, coin change",
 "Knapsack family - 0/1 knapsack, unbounded, subset sum",
 "Subsequence problems - LCS, LIS, edit distance",
 "Grid DP - unique paths, minimum path sum",
 ]},
 { title:"Complexity Analysis", items:[
 "Time complexity - O(1), O(log n), O(n), O(n log n), O(n^2)",
 "Space complexity - in-place vs auxiliary space analysis",
 "Amortized analysis - dynamic arrays, hash tables",
 "Recognising patterns - when to use which data structure",
 ]},
 ]},
 "System Design": { sections:[
 { title:"Scalability Fundamentals", items:[
 "Vertical vs horizontal scaling - scale-up vs scale-out trade-offs",
 "Load balancers - round robin, least connections, consistent hashing",
 "CAP theorem - consistency, availability, partition tolerance",
 "ACID vs BASE - when to trade consistency for availability",
 ]},
 { title:"Databases at Scale", items:[
 "SQL vs NoSQL - when to choose each, polyglot persistence",
 "Database sharding - horizontal partitioning strategies",
 "Read replicas - eventual consistency, replication lag",
 "CQRS & Event Sourcing - separating reads and writes",
 "Connection pooling - why it matters at scale",
 ]},
 { title:"Caching & Messaging", items:[
 "Cache patterns - cache-aside, write-through, write-behind, read-through",
 "Cache eviction - LRU, LFU, TTL-based expiry",
 "CDN - static asset delivery, edge caching, cache invalidation",
 "Message queues - RabbitMQ, Azure Service Bus, Kafka basics",
 "Event-driven architecture - producers, consumers, topics, partitions",
 ]},
 { title:"Common Design Problems", items:[
 "Design a URL shortener - hashing, redirects, analytics",
 "Design a rate limiter - token bucket, sliding window counter",
 "Design a notification system - fan-out, push vs pull",
 "Design a search autocomplete - trie, top-k, distributed cache",
 "Design a job queue / task scheduler - priorities, retries, dead-letter",
 ]},
 { title:"APIs & Communication", items:[
 "REST API design - versioning, pagination, idempotency, error codes",
 "WebSockets - real-time bidirectional communication",
 "gRPC - protocol buffers, streaming, service mesh",
 "API Gateway - authentication, rate limiting, routing, aggregation",
 ]},
 ]},
};

function _rmGetChecked() {
 try { return JSON.parse(localStorage.getItem("rm_checked") || "{}"); } catch { return {}; }
}
function _rmSetChecked(key, val) {
 const c = _rmGetChecked(); if (val) c[key] = true; else delete c[key];
 localStorage.setItem("rm_checked", JSON.stringify(c));
}
function _rmEsc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

// Skills always shown in the roadmap regardless of config
const RM_ALWAYS_SHOW = []; // kept only in Prep tab
const RM_PREP_ONLY = new Set(["DSA","System Design","CS Fundamentals"]); // shown in Prep, not Roadmap

function _rmBuildPhases(cfg) {
 const must = (cfg.mustHaveSkills||[]).map(s=>s.trim());
 const nice = (cfg.niceToHaveSkills||[]).map(s=>s.trim());
 const phases = {1:[],2:[],3:[],4:[]};
 const done = new Set();
 [...must,...nice].forEach(skill => {
 if (done.has(skill.toLowerCase())) return;
 done.add(skill.toLowerCase());
 const key = Object.keys(SKILL_META_RM).find(k=>k.toLowerCase()===skill.toLowerCase());
 if (key && RM_PREP_ONLY.has(key)) return; // keep DSA/System Design/CS in Prep only
 const meta = key ? SKILL_META_RM[key] : {phase: must.includes(skill)?2:3, label:skill, icon:"", desc:""};
 const p = Math.min(Math.max(meta.phase,1),4);
 phases[p].push({...meta, key: key||skill, isMust: must.some(m=>m.toLowerCase()===skill.toLowerCase())});
 });
 return phases;
}

const PHASE_PROJECTS_RM = [
 { // Phase 1 - Foundation
 label: "Foundation Projects",
 projects: [
 {
 title: "Personal Portfolio Website",
 difficulty: "Beginner",
 skills: ["HTML","CSS","JavaScript","Git"],
 desc: "Build a responsive portfolio showcasing your work. Includes contact form, dark/light toggle, and project gallery.",
 highlights: ["Semantic HTML5 layout","CSS Grid + Flexbox responsive design","Vanilla JS interactivity & localStorage theme","Deploy free via GitHub Pages"],
 github: "https://github.com/topics/portfolio-website",
 },
 {
 title: "To-Do App with Local Storage",
 difficulty: "Beginner",
 skills: ["JavaScript","HTML","CSS","OOP"],
 desc: "Full CRUD task manager with OOP class-based design, DOM manipulation, and filter/sort functionality.",
 highlights: ["OOP class-based task model","localStorage persistence","Filter by status (all / active / done)","Drag-and-drop reordering (bonus)"],
 github: "https://github.com/topics/todo-app-javascript",
 },
 {
 title: "SQL Student Grade Tracker",
 difficulty: "Beginner",
 skills: ["SQL","HTML","CSS","JavaScript"],
 desc: "Web app backed by SQLite. Manage students, subjects and grades with aggregate reporting - perfect SQL practice.",
 highlights: ["SELECT with JOINs and GROUP BY","Calculated averages and rankings","Git-tracked with clean commit history","Export results to CSV"],
 github: "https://github.com/topics/sql-project",
 },
 ],
 },
 { // Phase 2 - Core Stack
 label: "Core Stack Projects",
 projects: [
 {
 title: "RESTful Task API (ASP.NET Core)",
 difficulty: "Intermediate",
 skills: ["ASP.NET","C#",".NET","REST API","SQL Server"],
 desc: "Production-style REST API with JWT auth, role-based access, EF Core migrations, and Swagger docs.",
 highlights: ["JWT authentication & refresh tokens","EF Core + SQL Server migrations","Swagger / OpenAPI documentation","Unit tests with xUnit"],
 github: "https://github.com/topics/aspnet-core-web-api",
 },
 {
 title: "Expense Tracker Full-Stack App",
 difficulty: "Intermediate",
 skills: ["C#",".NET","SQL Server","HTML","CSS","JavaScript"],
 desc: "End-to-end web app: .NET MVC frontend + SQL Server backend. Track income, expenses, generate monthly reports.",
 highlights: [".NET MVC with Razor views","EF Core with seeded test data","Chart.js for spending visualisation","Full CRUD with server-side validation"],
 github: "https://github.com/topics/expense-tracker-dotnet",
 },
 {
 title: "Node.js Blog API",
 difficulty: "Intermediate",
 skills: ["Node.js","REST API","SQL","JavaScript"],
 desc: "Express + SQLite blog API - posts, comments, user auth. Demonstrates async I/O, middleware, and RESTful design.",
 highlights: ["Express middleware chain","JWT auth with bcrypt passwords","Pagination & search endpoints","Jest integration tests"],
 github: "https://github.com/topics/nodejs-blog-api",
 },
 ],
 },
 { // Phase 3 - Cloud & Tooling
 label: "Cloud & DevOps Projects",
 projects: [
 {
 title: "Containerised .NET App on Azure",
 difficulty: "Intermediate",
 skills: ["Docker","Azure","CI/CD","TypeScript","ASP.NET"],
 desc: "Dockerise your Phase 2 API and deploy to Azure App Service via a full CI/CD pipeline - push to main = auto-deploy.",
 highlights: ["Multi-stage Dockerfile for small images","GitHub Actions CI/CD pipeline","Azure App Service + Azure SQL","Secrets via Azure Key Vault"],
 github: "https://github.com/topics/docker-azure-deploy",
 },
 {
 title: "Azure Functions URL Shortener",
 difficulty: "Intermediate",
 skills: ["Azure","TypeScript","CI/CD"],
 desc: "Serverless URL shortener with Azure Functions + Table Storage. Fully typed TypeScript, deployed via Azure DevOps.",
 highlights: ["Azure HTTP trigger function","Azure Table Storage CRUD","TypeScript strict mode throughout","Unit tests + automated pipeline"],
 github: "https://github.com/topics/azure-functions-typescript",
 },
 {
 title: "DevOps CI/CD Monitor Dashboard",
 difficulty: "Intermediate",
 skills: ["Azure DevOps","CI/CD","Docker","TypeScript"],
 desc: "TypeScript web app that polls Azure DevOps API to display pipeline status, test results, and deployment history in real-time.",
 highlights: ["Azure DevOps REST API integration","TypeScript interfaces & strict types","Docker Compose local dev environment","Auto-refresh on pipeline change"],
 github: "https://github.com/topics/azure-devops-dashboard",
 },
 ],
 },
 { // Phase 4 - Specialisation
 label: "Capstone Projects",
 projects: [

 {
 title: "E-Commerce Microservices Platform",
 difficulty: "Advanced",
 skills: ["Microservices","Docker","Kubernetes","Redis","ASP.NET"],
 desc: "Catalogue, Cart, Order & Payment services communicating via message bus. Kubernetes orchestrated, Redis distributed cache.",
 highlights: ["4 independent ASP.NET Core services","RabbitMQ event-driven messaging","Redis distributed caching layer","Kubernetes + Helm chart deployment"],
 github: "https://github.com/topics/microservices-dotnet",
 },
 {
 title: "Real-Time Chat with Redis Pub/Sub",
 difficulty: "Advanced",
 skills: ["Redis","Node.js","Angular","Docker","Kubernetes"],
 desc: "Scalable chat app - Angular frontend, Node.js WebSocket backend, Redis pub/sub for multi-instance message broadcast.",
 highlights: ["Redis pub/sub across Node instances","Angular real-time WebSocket client","Docker Compose full local stack","Kubernetes horizontal scaling demo"],
 github: "https://github.com/topics/redis-pubsub-chat",
 },
 ],
 },
];

function _rmList(values) {
 return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function _rmPrimaryRole(cfg) {
 return _rmList(cfg.jobTitles)[0] || "Target Role";
}

function _rmSkillPool(cfg) {
 return _rmList([...(cfg.mustHaveSkills || []), ...(cfg.niceToHaveSkills || [])]);
}

function _rmHasAny(text, words) {
 const normalized = normalizeTitleKeyword(text);
 return words.some((word) => normalized.includes(word));
}

function _rmPickSkills(pool, preferred, fallback, max = 5) {
 const lowerPool = new Map(pool.map((skill) => [skill.toLowerCase(), skill]));
 const picked = [];
 for (const skill of preferred) {
 const match = lowerPool.get(String(skill).toLowerCase());
 if (match && !picked.some((item) => item.toLowerCase() === match.toLowerCase())) picked.push(match);
 }
 for (const skill of [...pool, ...fallback]) {
 if (picked.length >= max) break;
 if (skill && !picked.some((item) => item.toLowerCase() === String(skill).toLowerCase())) picked.push(skill);
 }
 return picked.slice(0, max);
}

function _rmRoleTrack(role) {
 if (_rmHasAny(role, ["gen ai", "generative ai", "ai engineer", "llm"])) return "ai";
 if (_rmHasAny(role, ["machine learning", "ai/ml", "mlops"])) return "ml";
 if (_rmHasAny(role, ["data scientist", "data analyst", "analyst", "data"])) return "data";
 if (_rmHasAny(role, ["frontend", "front end", "react", "angular", "ui"])) return "frontend";
 if (_rmHasAny(role, ["devops", "cloud", "platform", "sre"])) return "devops";
 if (_rmHasAny(role, ["qa", "test", "automation"])) return "qa";
 if (_rmHasAny(role, ["security", "cyber"])) return "security";
 if (_rmHasAny(role, ["salesforce", "crm"])) return "salesforce";
 if (_rmHasAny(role, ["designer", "ux", "product designer"])) return "design";
 if (_rmHasAny(role, ["product manager", "business analyst", "project manager"])) return "business";
 if (_rmHasAny(role, ["backend", "back end", "api"])) return "backend";
 if (_rmHasAny(role, ["full stack", "fullstack"])) return "fullstack";
 return "software";
}

function _rmProjectTemplates(track, role, skillPool) {
 const base = {
 foundation: {
 title: `${role} Portfolio & Case Study Site`,
 difficulty: "Beginner",
 preferred: ["HTML", "CSS", "JavaScript", "Git", "Documentation"],
 desc: `Create a portfolio for ${role} roles with project writeups, measurable outcomes, and a clean skills matrix.`,
 highlights: ["Role-specific case studies", "Responsive layout", "GitHub Pages deployment", "Clear problem-solution-impact sections"],
 github: "https://github.com/topics/portfolio",
 },
 core: {
 title: `${role} Work Sample App`,
 difficulty: "Intermediate",
 preferred: ["REST API", "SQL", "Git", "Testing", "Documentation"],
 desc: `Build a realistic work sample that mirrors day-to-day ${role} responsibilities using your highest-priority skills.`,
 highlights: ["End-to-end workflow", "Clean README and architecture notes", "Tests for the main path", "Deployable demo"],
 github: `https://github.com/topics/${encodeURIComponent(role.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`,
 },
 tooling: {
 title: `${role} Production Readiness Pipeline`,
 difficulty: "Intermediate",
 preferred: ["Docker", "CI/CD", "Cloud", "GitHub Actions", "Monitoring"],
 desc: `Package, test, and deploy your ${role} project with automated checks and a repeatable release workflow.`,
 highlights: ["Automated quality checks", "Environment-based configuration", "Containerized local setup", "Deployment notes"],
 github: "https://github.com/topics/ci-cd",
 },
 capstone: {
 title: `${role} Capstone: Real-World Hiring Scenario`,
 difficulty: "Advanced",
 preferred: skillPool,
 desc: `Build a polished capstone around a real business problem for ${role} interviews and portfolio reviews.`,
 highlights: ["Realistic dataset or workflow", "Trade-off documentation", "Scalable architecture", "Demo-ready final presentation"],
 github: "https://github.com/topics/capstone-project",
 },
 };

 const overrides = {
 ai: {
 core: ["RAG Knowledge Assistant", ["Python", "LLM", "RAG", "Vector Databases", "FastAPI"], "Build a document Q&A assistant with chunking, embeddings, retrieval, answer citations, and an API."],
 capstone: ["AI Job Screening Copilot", ["Python", "LLM", "Prompt Engineering", "OpenAI", "LangChain"], "Create a copilot that scores jobs, extracts skills, and explains role fit with traceable prompts."],
 },
 ml: {
 core: ["Model Training & Evaluation Pipeline", ["Python", "Scikit-learn", "Pandas", "Statistics", "MLflow"], "Train, evaluate, and track a model with clear metrics, reproducible experiments, and model cards."],
 capstone: ["MLOps Prediction Service", ["Python", "Docker", "FastAPI", "MLflow", "CI/CD"], "Deploy a model as an API with automated tests, monitoring hooks, and rollback-ready versioning."],
 },
 data: {
 core: ["Analytics Dashboard from Raw Data", ["SQL", "Python", "Data Analysis", "Power BI", "Tableau"], "Clean raw data, model metrics, and publish a dashboard with business recommendations."],
 capstone: ["End-to-End Decision Intelligence Project", ["SQL", "Python", "ETL", "Data Modeling", "Statistics"], "Build a data pipeline, KPI model, insight narrative, and executive-ready dashboard."],
 },
 frontend: {
 core: ["Role-Based Interactive Frontend", ["React", "Angular", "TypeScript", "HTML", "CSS"], "Build a polished UI with routing, forms, state management, accessibility, and API integration."],
 capstone: ["Production Frontend System", ["React", "Angular", "TypeScript", "Testing", "CI/CD"], "Create a responsive app with component patterns, test coverage, performance checks, and deployment."],
 },
 backend: {
 core: ["Production REST API", ["REST API", "SQL", "Node.js", "Python", "Java"], "Build a secure API with authentication, validation, pagination, and database-backed workflows."],
 capstone: ["Scalable Backend Service", ["Microservices", "Docker", "Redis", "SQL", "CI/CD"], "Design a backend service with caching, queues or events, tests, and deployment documentation."],
 },
 fullstack: {
 core: ["Full-Stack Workflow App", ["JavaScript", "TypeScript", "REST API", "SQL", "React"], "Build a complete app with frontend, backend, database, auth, and a realistic user workflow."],
 capstone: ["Full-Stack SaaS Prototype", ["React", "Node.js", "REST API", "SQL", "Docker"], "Create a SaaS-style app with account flows, dashboards, APIs, and deployment-ready architecture."],
 },
 devops: {
 core: ["Cloud Deployment Blueprint", ["Docker", "CI/CD", "Cloud", "Terraform", "Linux"], "Deploy an app with infrastructure notes, pipeline automation, secrets handling, and monitoring."],
 capstone: ["Platform Reliability Project", ["Kubernetes", "Docker", "CI/CD", "Monitoring", "Terraform"], "Build a resilient deployment with health checks, rollbacks, alerts, and scaling documentation."],
 },
 qa: {
 core: ["Automated Test Suite", ["Testing", "API Testing", "Playwright", "Selenium", "Git"], "Create UI and API test coverage for a demo app with reports and CI integration."],
 capstone: ["Quality Engineering Dashboard", ["Testing", "CI/CD", "API Testing", "SQL", "JavaScript"], "Build a quality dashboard that tracks flaky tests, coverage, defects, and release readiness."],
 },
 };

 const roleOverrides = overrides[track] || {};
 return [base.foundation, base.core, base.tooling, base.capstone].map((project, idx) => {
 const key = ["foundation", "core", "tooling", "capstone"][idx];
 const override = roleOverrides[key];
 if (!override) return project;
 return { ...project, title: override[0], preferred: override[1], desc: override[2] };
 });
}

function _rmBuildRoleProjects(cfg, phaseNumber) {
 const role = _rmPrimaryRole(cfg);
 const pool = _rmSkillPool(cfg);
 const track = _rmRoleTrack(role);
 const fallback = ["Git", "Documentation", "Testing", "REST API", "SQL"];
 const templates = _rmProjectTemplates(track, role, pool);
 const project = templates[Math.max(0, Math.min(3, phaseNumber - 1))];
 const phaseLabels = ["Foundation Project", "Core Role Project", "Tooling Project", "Capstone Project"];
 return {
 label: phaseLabels[phaseNumber - 1] || "Recommended Project",
 projects: [{
 title: project.title,
 difficulty: project.difficulty,
 skills: _rmPickSkills(pool, project.preferred, fallback, 5),
 desc: project.desc,
 highlights: project.highlights,
 github: project.github,
 }],
 };
}

function _rmDomainTrack(role, skillPool) {
 const text = normalizeTitleKeyword([role, ...skillPool].join(" "));
 if (_rmHasAny(text, ["healthcare", "health care", "clinical", "patient", "claims", "ehr", "hipaa", "fhir", "hl7", "epic"])) return "healthcare";
 if (_rmHasAny(text, ["finance", "financial", "banking", "payments", "ledger", "trading", "risk", "audit", "kyc", "aml", "sox", "reconciliation"])) return "finance";
 return "";
}

function _rmBuildCrackTips(cfg, phaseNumber) {
 const role = _rmPrimaryRole(cfg);
 const pool = _rmSkillPool(cfg);
 const track = _rmRoleTrack(role);
 const domain = _rmDomainTrack(role, pool);
 const topSkills = _rmPickSkills(pool, pool, ["Git", "Testing", "Documentation", "SQL", "REST API"], 4);
 const skillText = topSkills.length ? topSkills.join(", ") : "your top role skills";

 const trackTips = {
  ai: [
   "Prepare one story where you turned AI requirements into a working model, API, or automation workflow.",
   "Be ready to explain evaluation, hallucination control, prompt strategy, and production monitoring in simple terms.",
  ],
  ml: [
   "Practice explaining model choice, feature engineering, metrics, error analysis, and deployment trade-offs.",
   "Keep one model project ready with a clear problem statement, baseline, results, and improvement plan.",
  ],
  data: [
   "Prepare a business-impact story that moves from raw data to KPI, insight, recommendation, and measurable outcome.",
   "Practice SQL, metrics definition, dashboard interpretation, and explaining assumptions to non-technical stakeholders.",
  ],
  frontend: [
   "Prepare to discuss component design, state management, accessibility, performance, and API integration decisions.",
   "Make your portfolio demo fast, responsive, and polished on mobile because hiring teams notice frontend quality quickly.",
  ],
  backend: [
   "Practice explaining API design, database schema, authentication, pagination, error handling, and production debugging.",
   "Prepare one system-design story showing scalability, reliability, monitoring, and trade-offs.",
  ],
  fullstack: [
   "Prepare one end-to-end story from UI to API to database, including authentication, validation, testing, and deployment.",
   "Show how you debug across the stack and communicate trade-offs between frontend, backend, and data layers.",
  ],
  devops: [
   "Prepare to explain CI/CD, rollback, secrets, logs, monitoring, incident response, and environment strategy.",
   "Have one deployment diagram ready with build, test, release, infrastructure, and alerting steps.",
  ],
  qa: [
   "Prepare examples of test strategy, automation coverage, flaky test handling, defect triage, and release readiness.",
   "Show how you decide what to automate first based on risk and user impact.",
  ],
  security: [
   "Prepare examples around authentication, authorization, audit logging, secure coding, risk reduction, and incident response.",
   "Be ready to explain threats and controls in business language, not only tool names.",
  ],
  business: [
   "Prepare stories showing requirements discovery, stakeholder alignment, prioritization, metrics, and delivery follow-through.",
   "Translate every project into business impact: cost, speed, risk, quality, revenue, or customer experience.",
  ],
  software: [
   "Prepare a strong debugging story, a delivery story, and a trade-off story that match the role requirements.",
   "Practice explaining your best project with problem, architecture, implementation, testing, deployment, and impact.",
  ],
 };

 const domainTips = {
  healthcare: "For healthcare roles, connect your examples to patient workflows, data privacy, HIPAA, claims, clinical systems, or reporting accuracy when relevant.",
  finance: "For finance roles, connect your examples to payments, ledger accuracy, reconciliation, audit readiness, risk controls, KYC, AML, or reporting reliability when relevant.",
 };

 const phaseTips = [
  [
   { title: "Position your profile", text: `Rewrite your resume summary and LinkedIn headline around ${role} using ${skillText}.` },
   { title: "Close the keyword gap", text: "Compare 5 target JDs and add only truthful missing keywords that already match your experience." },
  ],
  [
   { title: "Build interview stories", text: "Prepare 4 STAR stories: delivery, debugging, collaboration, and learning a missing skill quickly." },
   { title: "Practice role questions", text: (trackTips[track] || trackTips.software)[0] },
  ],
  [
   { title: "Show proof of work", text: "Deploy or record a 2-minute demo of your roadmap project and add a clear README with architecture and trade-offs." },
   { title: "Target applications better", text: "Prioritize jobs where your resume match score is highest, then tailor the top 3 bullets before applying." },
  ],
  [
   { title: "Mock the final round", text: (trackTips[track] || trackTips.software)[1] },
   { title: "Follow up with evidence", text: "After applying or interviewing, send a short note linking your most relevant project, demo, or case study." },
  ],
 ];

 const tips = phaseTips[Math.max(0, Math.min(3, phaseNumber - 1))] || [];
 if (domain && phaseNumber === 2) {
  tips.push({ title: `${domain[0].toUpperCase()}${domain.slice(1)} angle`, text: domainTips[domain] });
 }
 return tips;
}


function _rmUpdateProgress(panel) {
 const cfg = typeof appConfig !== "undefined" ? appConfig : {};
 const phases = _rmBuildPhases(cfg);
 const checked = _rmGetChecked();
 const allSkills = Object.values(phases).flat();
 const total = allSkills.length;
 const done = allSkills.filter(s => checked[s.key]).length;
 const pct = total ? Math.round(done / total * 100) : 0;

 // Update overall progress
 const ovrPct = panel.querySelector(".rmw-pct");
 const ovrFill = panel.querySelector(".rmw-ofill");
 const ovrLabel = panel.querySelector(".rmw-olabel");
 if (ovrPct) ovrPct.textContent = pct + "%";
 if (ovrFill) ovrFill.style.width = pct + "%";
 if (ovrLabel) ovrLabel.textContent = done + " / " + total + " skills";

 // Update each phase progress bar
 [1,2,3,4].forEach((p, idx) => {
 const phSkills = phases[p] || [];
 const phDone = phSkills.filter(s => checked[s.key]).length;
 const phPct = phSkills.length ? Math.round(phDone / phSkills.length * 100) : 0;
 const phBlocks = panel.querySelectorAll(".rmp");
 const phBlock = phBlocks[idx];
 if (!phBlock) return;
 const pctEl = phBlock.querySelector(".rmp-pct");
 const fillEl = phBlock.querySelector(".rmp-bar-fill");
 const ctEl = phBlock.querySelector(".rmp-ct");
 if (pctEl) pctEl.textContent = phPct + "%";
 if (fillEl) fillEl.style.width = phPct + "%";
 if (ctEl) ctEl.textContent = phDone + "/" + phSkills.length;
 });
}


// -------------------------------------------------------------------------------
// PREP SECTION - DSA / System Design / CS Fundamentals
// -------------------------------------------------------------------------------

// -€-€-€ Free resources + YouTube for System Design & CS Fundamentals -€-€-€-€-€-€-€-€-€-€-€-€-€
const PREP_RESOURCES = {

 // -€-€ SYSTEM DESIGN: Core Concepts -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
 "Scalability": [
 { label:"> Scalability - CS75 Harvard (David Malan)", url:"https://www.youtube.com/watch?v=-W9F__D3oY4" },
 { label:"> System Design Channel - ByteByteGo", url:"https://www.youtube.com/@ByteByteGo" },
 { label:" System Design Primer - Scalability", url:"https://github.com/donnemartin/system-design-primer#performance-vs-scalability" },
 ],
 "CAP Theorem": [
 { label:"> CAP Theorem Explained - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=CAP+theorem+bytebytego" },
 { label:"> CAP Theorem - Gaurav Sen (search)", url:"https://www.youtube.com/results?search_query=CAP+theorem+gaurav+sen+system+design" },
 { label:" System Design Primer - CAP Theorem", url:"https://github.com/donnemartin/system-design-primer#cap-theorem" },
 ],
 "Load Balancing": [
 { label:"> Load Balancer - Hussein Nasser (search)", url:"https://www.youtube.com/results?search_query=load+balancer+explained+hussein+nasser" },
 { label:"> Load Balancing - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=load+balancing+system+design+bytebytego" },
 { label:" System Design Primer - Load Balancer", url:"https://github.com/donnemartin/system-design-primer#load-balancer" },
 ],
 "Caching": [
 { label:"> Caching Strategies - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=caching+strategies+cache+aside+bytebytego" },
 { label:"> Redis in 100 Seconds - Fireship (search)", url:"https://www.youtube.com/results?search_query=redis+100+seconds+fireship" },
 { label:" System Design Primer - Cache", url:"https://github.com/donnemartin/system-design-primer#cache" },
 ],
 "Databases at Scale": [
 { label:"> Database Sharding - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=database+sharding+bytebytego" },
 { label:"> Sharding a Database - Gaurav Sen (search)", url:"https://www.youtube.com/results?search_query=sharding+database+gaurav+sen" },
 { label:" System Design Primer - Database", url:"https://github.com/donnemartin/system-design-primer#database" },
 ],
 "Message Queues": [
 { label:"> Kafka in 100 Seconds - Fireship (search)", url:"https://www.youtube.com/results?search_query=kafka+100+seconds+fireship" },
 { label:"> Message Queues - Gaurav Sen (search)", url:"https://www.youtube.com/results?search_query=message+queue+system+design+gaurav+sen" },
 { label:" System Design Primer - Message Queues", url:"https://github.com/donnemartin/system-design-primer#message-queues" },
 ],
 "Consistency Patterns": [
 { label:"> Eventual Consistency - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=eventual+consistency+strong+consistency+bytebytego" },
 { label:" System Design Primer - Consistency Patterns", url:"https://github.com/donnemartin/system-design-primer#consistency-patterns" },
 { label:" Designing Data-Intensive Applications (free preview)", url:"https://dataintensive.net/" },
 ],

 // -€-€ SYSTEM DESIGN: Classic Problems -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
 "URL Shortener": [
 { label:"> Design URL Shortener - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=design+url+shortener+bytebytego" },
 { label:"> Design URL Shortener - TechDummies (search)", url:"https://www.youtube.com/results?search_query=url+shortener+system+design+techdummies" },
 { label:" System Design Primer - Pastebin / TinyURL", url:"https://github.com/donnemartin/system-design-primer/tree/master/solutions/system_design/pastebin" },
 ],
 "Rate Limiter": [
 { label:"> Rate Limiting Algorithms - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=rate+limiter+token+bucket+sliding+window+bytebytego" },
 { label:"> Rate Limiter Design - Gaurav Sen (search)", url:"https://www.youtube.com/results?search_query=rate+limiter+system+design+gaurav+sen" },
 { label:" System Design Primer - Rate Limiting", url:"https://github.com/donnemartin/system-design-primer#rate-limiting" },
 ],
 "Notification System": [
 { label:"> Design Notification System - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=notification+system+design+bytebytego" },
 { label:"> Fan-out on Write vs Read (search)", url:"https://www.youtube.com/results?search_query=fan+out+write+read+system+design+interview" },
 { label:" roadmap.sh - System Design", url:"https://roadmap.sh/system-design" },
 ],
 "Search Autocomplete": [
 { label:"> Design Typeahead - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=typeahead+autocomplete+system+design+bytebytego" },
 { label:"> Autocomplete with Trie - Gaurav Sen (search)", url:"https://www.youtube.com/results?search_query=autocomplete+trie+system+design+gaurav+sen" },
 { label:" roadmap.sh - System Design", url:"https://roadmap.sh/system-design" },
 ],
 "Job Queue / Scheduler": [
 { label:"> Task Scheduler Design (search)", url:"https://www.youtube.com/results?search_query=task+scheduler+job+queue+system+design+interview" },
 { label:"> Background Jobs - Hussein Nasser (search)", url:"https://www.youtube.com/results?search_query=background+jobs+queue+design+hussein+nasser" },
 { label:" System Design Primer - Task Queues", url:"https://github.com/donnemartin/system-design-primer#task-queues" },
 ],
 "Distributed File Store": [
 { label:"> Design Google Drive - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=design+google+drive+dropbox+bytebytego" },
 { label:"> Distributed File System - TechDummies (search)", url:"https://www.youtube.com/results?search_query=distributed+file+system+GFS+techdummies" },
 { label:" Google File System Paper (free)", url:"https://static.googleusercontent.com/media/research.google.com/en//archive/gfs-sosp2003.pdf" },
 ],

 // -€-€ SYSTEM DESIGN: APIs & Communication -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
 "REST Best Practices": [
 { label:"> REST API Design - Traversy Media (search)", url:"https://www.youtube.com/results?search_query=REST+API+design+best+practices+traversy+media" },
 { label:"> HTTP Crash Course - Traversy Media (search)", url:"https://www.youtube.com/results?search_query=HTTP+crash+course+traversy+media" },
 { label:" restfulapi.net - REST Design Guide", url:"https://restfulapi.net/" },
 ],
 "WebSockets": [
 { label:"> WebSockets in 100 Seconds - Fireship (search)", url:"https://www.youtube.com/results?search_query=websockets+100+seconds+fireship" },
 { label:"> WebSockets Deep Dive - Hussein Nasser (search)", url:"https://www.youtube.com/results?search_query=websockets+explained+hussein+nasser" },
 { label:" MDN - WebSockets API", url:"https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API" },
 ],
 "gRPC": [
 { label:"> gRPC Crash Course - TechWorld with Nana (search)", url:"https://www.youtube.com/results?search_query=gRPC+crash+course+techworld+nana" },
 { label:"> gRPC vs REST - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=gRPC+vs+REST+bytebytego" },
 { label:" gRPC Official Docs (free)", url:"https://grpc.io/docs/what-is-grpc/introduction/" },
 ],

 // -€-€ CS FUNDAMENTALS: Operating Systems -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
 "Processes & Threads": [
 { label:"> Processes & Threads - Neso Academy (search)", url:"https://www.youtube.com/results?search_query=processes+threads+operating+system+neso+academy" },
 { label:"> OS Playlist - Jenny's Lectures (search)", url:"https://www.youtube.com/results?search_query=operating+system+processes+threads+jenny+lectures" },
 { label:" OS: Three Easy Pieces (free book)", url:"https://pages.cs.wisc.edu/~remzi/OSTEP/" },
 ],
 "Synchronization": [
 { label:"> Mutex & Semaphore - Neso Academy (search)", url:"https://www.youtube.com/results?search_query=mutex+semaphore+operating+system+neso+academy" },
 { label:"> Deadlock Explained - Gate Smashers (search)", url:"https://www.youtube.com/results?search_query=deadlock+conditions+prevention+gate+smashers" },
 { label:" OSTEP - Concurrency (free chapter)", url:"https://pages.cs.wisc.edu/~remzi/OSTEP/threads-intro.pdf" },
 ],
 "Memory Management": [
 { label:"> Virtual Memory - Neso Academy (search)", url:"https://www.youtube.com/results?search_query=virtual+memory+paging+segmentation+neso+academy" },
 { label:"> Memory Management - Gate Smashers (search)", url:"https://www.youtube.com/results?search_query=memory+management+paging+gate+smashers" },
 { label:" OSTEP - Memory Virtualization (free chapter)", url:"https://pages.cs.wisc.edu/~remzi/OSTEP/vm-intro.pdf" },
 ],
 "CPU Scheduling": [
 { label:"> CPU Scheduling Algorithms - Neso Academy (search)",url:"https://www.youtube.com/results?search_query=CPU+scheduling+FCFS+SJF+round+robin+neso+academy" },
 { label:"> CPU Scheduling - Jenny's Lectures (search)", url:"https://www.youtube.com/results?search_query=CPU+scheduling+algorithms+jenny+lectures" },
 { label:" OSTEP - CPU Scheduling (free chapter)", url:"https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf" },
 ],
 "File Systems": [
 { label:"> File Systems Explained - Neso Academy (search)", url:"https://www.youtube.com/results?search_query=file+system+inode+directory+neso+academy" },
 { label:"> How File Systems Work - Fireship (search)", url:"https://www.youtube.com/results?search_query=file+system+how+it+works+fireship" },
 { label:" OSTEP - File Systems (free chapter)", url:"https://pages.cs.wisc.edu/~remzi/OSTEP/file-intro.pdf" },
 ],

 // -€-€ CS FUNDAMENTALS: Networking -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
 "OSI & TCP/IP Models": [
 { label:"> OSI Model - PowerCert Animated (search)", url:"https://www.youtube.com/results?search_query=OSI+model+explained+powercert+animated" },
 { label:"> TCP/IP Model - NetworkChuck (search)", url:"https://www.youtube.com/results?search_query=TCP+IP+model+networkchuck" },
 { label:" Cloudflare - What is the OSI Model?", url:"https://www.cloudflare.com/learning/ddos/glossary/open-systems-interconnection-model-osi/" },
 ],
 "TCP vs UDP": [
 { label:"> TCP vs UDP - PowerCert Animated (search)", url:"https://www.youtube.com/results?search_query=TCP+vs+UDP+powercert+animated" },
 { label:"> TCP Three-Way Handshake - Computerphile (search)", url:"https://www.youtube.com/results?search_query=TCP+three+way+handshake+computerphile" },
 { label:" Cloudflare - TCP vs UDP", url:"https://www.cloudflare.com/learning/ddos/glossary/user-datagram-protocol-udp/" },
 ],
 "HTTP & HTTPS": [
 { label:"> HTTP Crash Course - Traversy Media (search)", url:"https://www.youtube.com/results?search_query=HTTP+crash+course+traversy+media" },
 { label:"> How HTTPS Works - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=how+HTTPS+TLS+works+bytebytego" },
 { label:"> HTTP/2 & HTTP/3 - Hussein Nasser (search)", url:"https://www.youtube.com/results?search_query=HTTP2+HTTP3+QUIC+hussein+nasser" },
 { label:" MDN - HTTP Overview", url:"https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview" },
 ],
 "DNS": [
 { label:"> DNS Explained - PowerCert Animated (search)", url:"https://www.youtube.com/results?search_query=DNS+explained+powercert+animated" },
 { label:"> How DNS Works - ByteByteGo (search)", url:"https://www.youtube.com/results?search_query=how+DNS+works+bytebytego" },
 { label:" Cloudflare - What is DNS?", url:"https://www.cloudflare.com/learning/dns/what-is-dns/" },
 ],

 // -€-€ CS FUNDAMENTALS: Compilers & Runtime -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
 "Compilation Pipeline": [
 { label:"> How Compilers Work - Fireship (search)", url:"https://www.youtube.com/results?search_query=how+compilers+work+fireship" },
 { label:"> Compiler Design - Neso Academy (search)", url:"https://www.youtube.com/results?search_query=compiler+design+lexing+parsing+AST+neso+academy" },
 { label:" Crafting Interpreters (free book)", url:"https://craftinginterpreters.com/" },
 ],
 "Garbage Collection": [
 { label:"> Garbage Collection - Computerphile (search)", url:"https://www.youtube.com/results?search_query=garbage+collection+mark+sweep+computerphile" },
 { label:"> GC Algorithms Explained - Fireship (search)", url:"https://www.youtube.com/results?search_query=garbage+collection+algorithms+explained+fireship" },
 { label:" MDN - Memory Management & GC", url:"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Memory_management" },
 ],
 // -€-€ DSA Topics -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
 "Array Basics & Traversal": [
 { label:"> Arrays - NeetCode (search)", url:"https://www.youtube.com/results?search_query=arrays+leetcode+patterns+neetcode" },
 { label:"> Array Algorithms - Abdul Bari (search)", url:"https://www.youtube.com/results?search_query=array+algorithms+abdul+bari" },
 { label:" Visualgo - Array Visualizer", url:"https://visualgo.net/en/array" },
 { label:" NeetCode.io - Free Roadmap", url:"https://neetcode.io/roadmap" },
 ],
 "Two Pointers": [
 { label:"> Two Pointers Pattern - NeetCode (search)", url:"https://www.youtube.com/results?search_query=two+pointers+pattern+neetcode" },
 { label:"> Two Pointers - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=two+pointers+back+to+back+SWE" },
 { label:" NeetCode.io - Two Pointers Section", url:"https://neetcode.io/roadmap" },
 ],
 "Sliding Window": [
 { label:"> Sliding Window - NeetCode (search)", url:"https://www.youtube.com/results?search_query=sliding+window+pattern+neetcode" },
 { label:"> Sliding Window Technique - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=sliding+window+technique+back+to+back+SWE" },
 { label:" NeetCode.io - Sliding Window Section", url:"https://neetcode.io/roadmap" },
 ],
 "Classic Binary Search": [
 { label:"> Binary Search - NeetCode (search)", url:"https://www.youtube.com/results?search_query=binary+search+neetcode" },
 { label:"> Binary Search - Abdul Bari (search)", url:"https://www.youtube.com/results?search_query=binary+search+algorithm+abdul+bari" },
 { label:" Visualgo - Binary Search", url:"https://visualgo.net/en/bst" },
 ],
 "Binary Search on Answer": [
 { label:"> Binary Search on Answer - NeetCode (search)", url:"https://www.youtube.com/results?search_query=binary+search+on+answer+neetcode" },
 { label:"> Advanced Binary Search - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=binary+search+advanced+back+to+back+SWE" },
 { label:" NeetCode.io - Binary Search Section", url:"https://neetcode.io/roadmap" },
 ],
 "Core Operations": [
 { label:"> Linked Lists - NeetCode (search)", url:"https://www.youtube.com/results?search_query=linked+list+neetcode" },
 { label:"> Linked Lists - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=linked+list+back+to+back+SWE" },
 { label:" Visualgo - Linked List", url:"https://visualgo.net/en/list" },
 ],
 "Advanced Linked List": [
 { label:"> Advanced Linked Lists - NeetCode (search)", url:"https://www.youtube.com/results?search_query=linked+list+reorder+merge+neetcode" },
 { label:"> Merge K Sorted Lists - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=merge+k+sorted+lists+back+to+back+SWE" },
 { label:" NeetCode.io - Linked List Section", url:"https://neetcode.io/roadmap" },
 ],
 "Stack Fundamentals": [
 { label:"> Stacks - NeetCode (search)", url:"https://www.youtube.com/results?search_query=stack+data+structure+neetcode" },
 { label:"> Stack Problems - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=stack+leetcode+problems+back+to+back+SWE" },
 { label:" Visualgo - Stack", url:"https://visualgo.net/en/list" },
 ],
 "Monotonic Stack": [
 { label:"> Monotonic Stack - NeetCode (search)", url:"https://www.youtube.com/results?search_query=monotonic+stack+neetcode" },
 { label:"> Monotonic Stack Explained - Errichto (search)", url:"https://www.youtube.com/results?search_query=monotonic+stack+explained+errichto" },
 { label:" NeetCode.io - Stack Section", url:"https://neetcode.io/roadmap" },
 ],
 "Binary Tree Basics": [
 { label:"> Binary Trees - NeetCode (search)", url:"https://www.youtube.com/results?search_query=binary+tree+traversal+neetcode" },
 { label:"> Trees - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=binary+tree+problems+back+to+back+SWE" },
 { label:" Visualgo - Binary Tree", url:"https://visualgo.net/en/bst" },
 ],
 "BFS / Level Order": [
 { label:"> BFS Tree Traversal - NeetCode (search)", url:"https://www.youtube.com/results?search_query=BFS+level+order+binary+tree+neetcode" },
 { label:"> BFS Explained - William Fiset (search)", url:"https://www.youtube.com/results?search_query=BFS+breadth+first+search+william+fiset" },
 { label:" Visualgo - BFS/DFS", url:"https://visualgo.net/en/dfsbfs" },
 ],
 "Binary Search Tree": [
 { label:"> BST - NeetCode (search)", url:"https://www.youtube.com/results?search_query=binary+search+tree+neetcode" },
 { label:"> BST Operations - Abdul Bari (search)", url:"https://www.youtube.com/results?search_query=binary+search+tree+insert+delete+abdul+bari" },
 { label:" Visualgo - BST", url:"https://visualgo.net/en/bst" },
 ],
 "Top-K Problems": [
 { label:"> Heap / Priority Queue - NeetCode (search)", url:"https://www.youtube.com/results?search_query=heap+priority+queue+neetcode" },
 { label:"> Heaps Explained - William Fiset (search)", url:"https://www.youtube.com/results?search_query=heap+data+structure+william+fiset" },
 { label:" Visualgo - Heap", url:"https://visualgo.net/en/heap" },
 ],
 "Graph Traversal (BFS/DFS)": [
 { label:"> Graphs - NeetCode (search)", url:"https://www.youtube.com/results?search_query=graph+BFS+DFS+neetcode" },
 { label:"> Graph Algorithms - William Fiset (search)", url:"https://www.youtube.com/results?search_query=graph+algorithms+william+fiset" },
 { label:" Visualgo - Graph Traversal", url:"https://visualgo.net/en/dfsbfs" },
 ],
 "Topological Sort / Cycle Detection": [
 { label:"> Topological Sort - NeetCode (search)", url:"https://www.youtube.com/results?search_query=topological+sort+neetcode" },
 { label:"> Topological Sort - William Fiset (search)", url:"https://www.youtube.com/results?search_query=topological+sort+william+fiset" },
 { label:" Visualgo - Topological Sort", url:"https://visualgo.net/en/toposort" },
 ],
 "Union-Find (Disjoint Set)": [
 { label:"> Union Find - NeetCode (search)", url:"https://www.youtube.com/results?search_query=union+find+disjoint+set+neetcode" },
 { label:"> Union Find - William Fiset (search)", url:"https://www.youtube.com/results?search_query=union+find+disjoint+set+union+william+fiset" },
 { label:" Visualgo - Union Find", url:"https://visualgo.net/en/ufds" },
 ],
 "Subsets & Combinations": [
 { label:"> Backtracking - NeetCode (search)", url:"https://www.youtube.com/results?search_query=backtracking+subsets+combinations+neetcode" },
 { label:"> Subsets Pattern - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=subsets+combination+backtracking+back+to+back+SWE" },
 { label:" NeetCode.io - Backtracking Section", url:"https://neetcode.io/roadmap" },
 ],
 "Permutations & Constraint Problems": [
 { label:"> Permutations Backtracking - NeetCode (search)", url:"https://www.youtube.com/results?search_query=permutations+backtracking+neetcode" },
 { label:"> N-Queens - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=N+queens+backtracking+back+to+back+SWE" },
 { label:" NeetCode.io - Backtracking Section", url:"https://neetcode.io/roadmap" },
 ],
 "1D DP - Basics": [
 { label:"> Dynamic Programming - NeetCode (search)", url:"https://www.youtube.com/results?search_query=dynamic+programming+1D+neetcode" },
 { label:"> DP Introduction - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=dynamic+programming+introduction+back+to+back+SWE" },
 { label:"> DP Patterns - Aditya Verma (search)", url:"https://www.youtube.com/results?search_query=dynamic+programming+patterns+aditya+verma" },
 { label:" NeetCode.io - DP Section", url:"https://neetcode.io/roadmap" },
 ],
 "2D DP - Grids & Sequences": [
 { label:"> 2D DP - NeetCode (search)", url:"https://www.youtube.com/results?search_query=2D+dynamic+programming+grid+neetcode" },
 { label:"> LCS / Edit Distance - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=LCS+edit+distance+dynamic+programming+back+to+back+SWE" },
 { label:"> Knapsack DP - Aditya Verma (search)", url:"https://www.youtube.com/results?search_query=knapsack+dynamic+programming+aditya+verma" },
 ],
 "DP on Intervals & Subsequences": [
 { label:"> LIS - NeetCode (search)", url:"https://www.youtube.com/results?search_query=longest+increasing+subsequence+neetcode" },
 { label:"> Interval DP - Errichto (search)", url:"https://www.youtube.com/results?search_query=interval+DP+burst+balloons+errichto" },
 { label:" NeetCode.io - Advanced Graphs + DP", url:"https://neetcode.io/roadmap" },
 ],
 "Trie Implementation & Usage": [
 { label:"> Tries - NeetCode (search)", url:"https://www.youtube.com/results?search_query=trie+prefix+tree+neetcode" },
 { label:"> Trie Data Structure - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=trie+data+structure+back+to+back+SWE" },
 { label:" Visualgo - Trie", url:"https://visualgo.net/en/suffixtree" },
 ],
 "Sorting Algorithms": [
 { label:"> Sorting Algorithms - Abdul Bari (search)", url:"https://www.youtube.com/results?search_query=merge+sort+quick+sort+algorithm+abdul+bari" },
 { label:"> Sorting - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=sorting+algorithms+merge+quick+back+to+back+SWE" },
 { label:" Visualgo - Sorting Visualizer", url:"https://visualgo.net/en/sorting" },
 ],
 "Interval Problems": [
 { label:"> Intervals - NeetCode (search)", url:"https://www.youtube.com/results?search_query=interval+merge+insert+neetcode" },
 { label:"> Meeting Rooms - Back To Back SWE (search)", url:"https://www.youtube.com/results?search_query=meeting+rooms+intervals+back+to+back+SWE" },
 { label:" NeetCode.io - Intervals Section", url:"https://neetcode.io/roadmap" },
 ],
 "Greedy Patterns": [
 { label:"> Greedy Algorithms - NeetCode (search)", url:"https://www.youtube.com/results?search_query=greedy+algorithms+neetcode" },
 { label:"> Greedy - Abdul Bari (search)", url:"https://www.youtube.com/results?search_query=greedy+algorithm+examples+abdul+bari" },
 { label:" NeetCode.io - Greedy Section", url:"https://neetcode.io/roadmap" },
 ],

 "Concurrency Primitives": [
 { label:"> Mutex vs Semaphore - Jacob Sorber (search)", url:"https://www.youtube.com/results?search_query=mutex+vs+semaphore+concurrency+jacob+sorber" },
 { label:"> Concurrency vs Parallelism - Computerphile (search)", url:"https://www.youtube.com/results?search_query=concurrency+parallelism+computerphile" },
 { label:" OSTEP - Locks (free chapter)", url:"https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks.pdf" },
 ],
};

const PREP_DATA = {
 dsa: {
 label: "DSA Preparation",
 icon: "",
 color: "#6366f1",
 sections: [
 {
 title: "Arrays & Strings", level: "Beginner", icon: "",
 summary: "Foundation of every interview. Master these before anything else.",
 topics: [
 {
 name: "Array Basics & Traversal",
 note: "Understand indexing, time complexity of operations, and when to use arrays vs other structures.",
 problems: [
 { id:217, title:"Contains Duplicate", diff:"Easy", url:"https://leetcode.com/problems/contains-duplicate/" },
 { id:121, title:"Best Time to Buy and Sell Stock", diff:"Easy", url:"https://leetcode.com/problems/best-time-to-buy-and-sell-stock/" },
 { id:1, title:"Two Sum", diff:"Easy", url:"https://leetcode.com/problems/two-sum/" },
 { id:53, title:"Maximum Subarray (Kadane's)", diff:"Medium", url:"https://leetcode.com/problems/maximum-subarray/" },
 { id:238, title:"Product of Array Except Self", diff:"Medium", url:"https://leetcode.com/problems/product-of-array-except-self/" },
 ]
 },
 {
 name: "Two Pointers",
 note: "Use left/right pointers for sorted arrays or palindrome checks. O(n) time, O(1) space.",
 problems: [
 { id:125, title:"Valid Palindrome", diff:"Easy", url:"https://leetcode.com/problems/valid-palindrome/" },
 { id:167, title:"Two Sum II (Sorted Array)", diff:"Medium", url:"https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/" },
 { id:15, title:"3Sum", diff:"Medium", url:"https://leetcode.com/problems/3sum/" },
 { id:11, title:"Container With Most Water", diff:"Medium", url:"https://leetcode.com/problems/container-with-most-water/" },
 { id:42, title:"Trapping Rain Water", diff:"Hard", url:"https://leetcode.com/problems/trapping-rain-water/" },
 ]
 },
 {
 name: "Sliding Window",
 note: "Expand/shrink a window over sequential data. Key for substring and subarray problems.",
 problems: [
 { id:3, title:"Longest Substring Without Repeating Chars", diff:"Medium", url:"https://leetcode.com/problems/longest-substring-without-repeating-characters/" },
 { id:424, title:"Longest Repeating Character Replacement", diff:"Medium", url:"https://leetcode.com/problems/longest-repeating-character-replacement/" },
 { id:567, title:"Permutation in String", diff:"Medium", url:"https://leetcode.com/problems/permutation-in-string/" },
 { id:76, title:"Minimum Window Substring", diff:"Hard", url:"https://leetcode.com/problems/minimum-window-substring/" },
 { id:239, title:"Sliding Window Maximum", diff:"Hard", url:"https://leetcode.com/problems/sliding-window-maximum/" },
 ]
 },
 ]
 },
 {
 title: "Binary Search", level: "Beginner->Intermediate", icon: "",
 summary: "Eliminates half the search space each step. Apply to any monotonic decision function.",
 topics: [
 {
 name: "Classic Binary Search",
 note: "Know the exact template: lo, hi, mid = lo+(hi-lo)//2. Decide which half to keep.",
 problems: [
 { id:704, title:"Binary Search", diff:"Easy", url:"https://leetcode.com/problems/binary-search/" },
 { id:35, title:"Search Insert Position", diff:"Easy", url:"https://leetcode.com/problems/search-insert-position/" },
 { id:374, title:"Guess Number Higher or Lower", diff:"Easy", url:"https://leetcode.com/problems/guess-number-higher-or-lower/" },
 { id:33, title:"Search in Rotated Sorted Array", diff:"Medium", url:"https://leetcode.com/problems/search-in-rotated-sorted-array/" },
 { id:153, title:"Find Minimum in Rotated Sorted Array", diff:"Medium", url:"https://leetcode.com/problems/find-minimum-in-rotated-sorted-array/" },
 ]
 },
 {
 name: "Binary Search on Answer",
 note: "When the answer itself is monotonic - 'find minimum X such that condition holds'.",
 problems: [
 { id:875, title:"Koko Eating Bananas", diff:"Medium", url:"https://leetcode.com/problems/koko-eating-bananas/" },
 { id:1011,title:"Capacity to Ship Packages Within D Days",diff:"Medium",url:"https://leetcode.com/problems/capacity-to-ship-packages-within-d-days/" },
 { id:74, title:"Search a 2D Matrix", diff:"Medium", url:"https://leetcode.com/problems/search-a-2d-matrix/" },
 { id:410, title:"Split Array Largest Sum", diff:"Hard", url:"https://leetcode.com/problems/split-array-largest-sum/" },
 ]
 },
 ]
 },
 {
 title: "Linked Lists", level: "Beginner->Intermediate", icon: "",
 summary: "Pointer manipulation. Draw diagrams. Know Floyd's cycle detection cold.",
 topics: [
 {
 name: "Core Operations",
 note: "Reverse, merge, find middle. These appear as sub-problems in harder questions.",
 problems: [
 { id:206, title:"Reverse Linked List", diff:"Easy", url:"https://leetcode.com/problems/reverse-linked-list/" },
 { id:21, title:"Merge Two Sorted Lists", diff:"Easy", url:"https://leetcode.com/problems/merge-two-sorted-lists/" },
 { id:141, title:"Linked List Cycle", diff:"Easy", url:"https://leetcode.com/problems/linked-list-cycle/" },
 { id:876, title:"Middle of the Linked List", diff:"Easy", url:"https://leetcode.com/problems/middle-of-the-linked-list/" },
 { id:19, title:"Remove Nth Node From End", diff:"Medium", url:"https://leetcode.com/problems/remove-nth-node-from-end-of-list/" },
 ]
 },
 {
 name: "Advanced Linked List",
 note: "Reordering and merging K lists. Break into smaller sub-problems.",
 problems: [
 { id:143, title:"Reorder List", diff:"Medium", url:"https://leetcode.com/problems/reorder-list/" },
 { id:142, title:"Linked List Cycle II", diff:"Medium", url:"https://leetcode.com/problems/linked-list-cycle-ii/" },
 { id:2, title:"Add Two Numbers", diff:"Medium", url:"https://leetcode.com/problems/add-two-numbers/" },
 { id:23, title:"Merge K Sorted Lists", diff:"Hard", url:"https://leetcode.com/problems/merge-k-sorted-lists/" },
 ]
 },
 ]
 },
 {
 title: "Stacks & Queues", level: "Intermediate", icon: "",
 summary: "Stacks for LIFO, queues for BFS. Monotonic stack solves 'next greater element' family.",
 topics: [
 {
 name: "Stack Fundamentals",
 note: "Balanced parentheses, min-stack, and expression evaluation are standard asks.",
 problems: [
 { id:20, title:"Valid Parentheses", diff:"Easy", url:"https://leetcode.com/problems/valid-parentheses/" },
 { id:155, title:"Min Stack", diff:"Medium", url:"https://leetcode.com/problems/min-stack/" },
 { id:150, title:"Evaluate Reverse Polish Notation", diff:"Medium", url:"https://leetcode.com/problems/evaluate-reverse-polish-notation/" },
 { id:22, title:"Generate Parentheses", diff:"Medium", url:"https://leetcode.com/problems/generate-parentheses/" },
 ]
 },
 {
 name: "Monotonic Stack",
 note: "Maintain a stack whose elements are always increasing or decreasing. O(n) for 'next greater' problems.",
 problems: [
 { id:739, title:"Daily Temperatures", diff:"Medium", url:"https://leetcode.com/problems/daily-temperatures/" },
 { id:853, title:"Car Fleet", diff:"Medium", url:"https://leetcode.com/problems/car-fleet/" },
 { id:496, title:"Next Greater Element I", diff:"Easy", url:"https://leetcode.com/problems/next-greater-element-i/" },
 { id:84, title:"Largest Rectangle in Histogram", diff:"Hard", url:"https://leetcode.com/problems/largest-rectangle-in-histogram/" },
 ]
 },
 ]
 },
 {
 title: "Trees", level: "Intermediate", icon: "",
 summary: "DFS (recursive) and BFS (queue). Know preorder, inorder, postorder traversals cold.",
 topics: [
 {
 name: "Binary Tree Basics",
 note: "Recursive DFS covers most tree problems. Base case: null node.",
 problems: [
 { id:226, title:"Invert Binary Tree", diff:"Easy", url:"https://leetcode.com/problems/invert-binary-tree/" },
 { id:104, title:"Maximum Depth of Binary Tree", diff:"Easy", url:"https://leetcode.com/problems/maximum-depth-of-binary-tree/" },
 { id:100, title:"Same Tree", diff:"Easy", url:"https://leetcode.com/problems/same-tree/" },
 { id:572, title:"Subtree of Another Tree", diff:"Easy", url:"https://leetcode.com/problems/subtree-of-another-tree/" },
 { id:543, title:"Diameter of Binary Tree", diff:"Easy", url:"https://leetcode.com/problems/diameter-of-binary-tree/" },
 ]
 },
 {
 name: "BFS / Level Order",
 note: "Use a queue. Process nodes level by level for shortest path or level-specific operations.",
 problems: [
 { id:102, title:"Binary Tree Level Order Traversal", diff:"Medium", url:"https://leetcode.com/problems/binary-tree-level-order-traversal/" },
 { id:199, title:"Binary Tree Right Side View", diff:"Medium", url:"https://leetcode.com/problems/binary-tree-right-side-view/" },
 { id:1448,title:"Count Good Nodes in Binary Tree", diff:"Medium", url:"https://leetcode.com/problems/count-good-nodes-in-binary-tree/" },
 ]
 },
 {
 name: "Binary Search Tree",
 note: "Left < root < right. In-order traversal yields sorted output.",
 problems: [
 { id:235, title:"Lowest Common Ancestor of BST", diff:"Medium", url:"https://leetcode.com/problems/lowest-common-ancestor-of-a-binary-search-tree/" },
 { id:230, title:"Kth Smallest in BST", diff:"Medium", url:"https://leetcode.com/problems/kth-smallest-element-in-a-bst/" },
 { id:98, title:"Validate Binary Search Tree", diff:"Medium", url:"https://leetcode.com/problems/validate-binary-search-tree/" },
 { id:105, title:"Construct Tree from Preorder+Inorder", diff:"Medium", url:"https://leetcode.com/problems/construct-binary-tree-from-preorder-and-inorder-traversal/" },
 { id:124, title:"Binary Tree Maximum Path Sum", diff:"Hard", url:"https://leetcode.com/problems/binary-tree-maximum-path-sum/" },
 ]
 },
 ]
 },
 {
 title: "Heaps / Priority Queue", level: "Intermediate", icon: "",
 summary: "Use a heap whenever you need fast access to the min or max of a dynamic set.",
 topics: [
 {
 name: "Top-K Problems",
 note: "Min-heap of size K gives the K largest elements in O(n log k).",
 problems: [
 { id:703, title:"Kth Largest in a Stream", diff:"Easy", url:"https://leetcode.com/problems/kth-largest-element-in-a-stream/" },
 { id:1046, title:"Last Stone Weight", diff:"Easy", url:"https://leetcode.com/problems/last-stone-weight/" },
 { id:215, title:"Kth Largest Element in Array", diff:"Medium", url:"https://leetcode.com/problems/kth-largest-element-in-an-array/" },
 { id:973, title:"K Closest Points to Origin", diff:"Medium", url:"https://leetcode.com/problems/k-closest-points-to-origin/" },
 { id:621, title:"Task Scheduler", diff:"Medium", url:"https://leetcode.com/problems/task-scheduler/" },
 { id:295, title:"Find Median from Data Stream", diff:"Hard", url:"https://leetcode.com/problems/find-median-from-data-stream/" },
 ]
 },
 ]
 },
 {
 title: "Graphs", level: "Intermediate", icon: "",
 summary: "BFS for shortest path, DFS for connectivity. Topological sort for dependency ordering.",
 topics: [
 {
 name: "Graph Traversal (BFS/DFS)",
 note: "Track visited nodes to avoid cycles. BFS uses a queue, DFS uses recursion or stack.",
 problems: [
 { id:200, title:"Number of Islands", diff:"Medium", url:"https://leetcode.com/problems/number-of-islands/" },
 { id:133, title:"Clone Graph", diff:"Medium", url:"https://leetcode.com/problems/clone-graph/" },
 { id:417, title:"Pacific Atlantic Water Flow", diff:"Medium", url:"https://leetcode.com/problems/pacific-atlantic-water-flow/" },
 { id:130, title:"Surrounded Regions", diff:"Medium", url:"https://leetcode.com/problems/surrounded-regions/" },
 ]
 },
 {
 name: "Topological Sort / Cycle Detection",
 note: "Directed graph with no cycles -> topological order. Use Kahn's (BFS) or DFS with state coloring.",
 problems: [
 { id:207, title:"Course Schedule", diff:"Medium", url:"https://leetcode.com/problems/course-schedule/" },
 { id:210, title:"Course Schedule II", diff:"Medium", url:"https://leetcode.com/problems/course-schedule-ii/" },
 { id:269, title:"Alien Dictionary", diff:"Hard", url:"https://leetcode.com/problems/alien-dictionary/" },
 ]
 },
 {
 name: "Union-Find (Disjoint Set)",
 note: "Efficient for connectivity queries. Path compression + union by rank -> near O(1) per op.",
 problems: [
 { id:684, title:"Redundant Connection", diff:"Medium", url:"https://leetcode.com/problems/redundant-connection/" },
 { id:323, title:"Number of Connected Components",diff:"Medium", url:"https://leetcode.com/problems/number-of-connected-components-in-an-undirected-graph/" },
 { id:127, title:"Word Ladder", diff:"Hard", url:"https://leetcode.com/problems/word-ladder/" },
 ]
 },
 ]
 },
 {
 title: "Backtracking", level: "Intermediate->Hard", icon: "",
 summary: "Explore all paths by making a choice, recursing, then undoing. Prune early when possible.",
 topics: [
 {
 name: "Subsets & Combinations",
 note: "Pick or skip each element. Sorted input avoids duplicates. Start index prevents re-use.",
 problems: [
 { id:78, title:"Subsets", diff:"Medium", url:"https://leetcode.com/problems/subsets/" },
 { id:90, title:"Subsets II (with duplicates)",diff:"Medium", url:"https://leetcode.com/problems/subsets-ii/" },
 { id:39, title:"Combination Sum", diff:"Medium", url:"https://leetcode.com/problems/combination-sum/" },
 { id:40, title:"Combination Sum II", diff:"Medium", url:"https://leetcode.com/problems/combination-sum-ii/" },
 ]
 },
 {
 name: "Permutations & Constraint Problems",
 note: "Swap elements or use a 'used' array. N-Queens uses row/col/diagonal conflict checks.",
 problems: [
 { id:46, title:"Permutations", diff:"Medium", url:"https://leetcode.com/problems/permutations/" },
 { id:47, title:"Permutations II", diff:"Medium", url:"https://leetcode.com/problems/permutations-ii/" },
 { id:79, title:"Word Search", diff:"Medium", url:"https://leetcode.com/problems/word-search/" },
 { id:51, title:"N-Queens", diff:"Hard", url:"https://leetcode.com/problems/n-queens/" },
 ]
 },
 ]
 },
 {
 title: "Dynamic Programming", level: "Intermediate->Hard", icon: "",
 summary: "Overlapping subproblems + optimal substructure. Start with recursion, add memoization, convert to tabulation.",
 topics: [
 {
 name: "1D DP - Basics",
 note: "dp[i] depends on dp[i-1] or dp[i-2]. Draw the recurrence before coding.",
 problems: [
 { id:70, title:"Climbing Stairs", diff:"Easy", url:"https://leetcode.com/problems/climbing-stairs/" },
 { id:746, title:"Min Cost Climbing Stairs", diff:"Easy", url:"https://leetcode.com/problems/min-cost-climbing-stairs/" },
 { id:198, title:"House Robber", diff:"Medium", url:"https://leetcode.com/problems/house-robber/" },
 { id:213, title:"House Robber II (circular)", diff:"Medium", url:"https://leetcode.com/problems/house-robber-ii/" },
 { id:322, title:"Coin Change", diff:"Medium", url:"https://leetcode.com/problems/coin-change/" },
 { id:139, title:"Word Break", diff:"Medium", url:"https://leetcode.com/problems/word-break/" },
 ]
 },
 {
 name: "2D DP - Grids & Sequences",
 note: "dp[i][j] typically depends on dp[i-1][j] and dp[i][j-1]. LCS is the canonical example.",
 problems: [
 { id:62, title:"Unique Paths", diff:"Medium", url:"https://leetcode.com/problems/unique-paths/" },
 { id:1143, title:"Longest Common Subsequence", diff:"Medium", url:"https://leetcode.com/problems/longest-common-subsequence/" },
 { id:309, title:"Best Time to Buy/Sell with Cooldown", diff:"Medium", url:"https://leetcode.com/problems/best-time-to-buy-and-sell-stock-with-cooldown/" },
 { id:518, title:"Coin Change II", diff:"Medium", url:"https://leetcode.com/problems/coin-change-ii/" },
 { id:72, title:"Edit Distance", diff:"Hard", url:"https://leetcode.com/problems/edit-distance/" },
 { id:10, title:"Regular Expression Matching", diff:"Hard", url:"https://leetcode.com/problems/regular-expression-matching/" },
 ]
 },
 {
 name: "DP on Intervals & Subsequences",
 note: "Longest Increasing Subsequence (LIS) is O(n log n) with patience sorting/binary search.",
 problems: [
 { id:300, title:"Longest Increasing Subsequence", diff:"Medium", url:"https://leetcode.com/problems/longest-increasing-subsequence/" },
 { id:5, title:"Longest Palindromic Substring", diff:"Medium", url:"https://leetcode.com/problems/longest-palindromic-substring/" },
 { id:416, title:"Partition Equal Subset Sum", diff:"Medium", url:"https://leetcode.com/problems/partition-equal-subset-sum/" },
 { id:312, title:"Burst Balloons", diff:"Hard", url:"https://leetcode.com/problems/burst-balloons/" },
 ]
 },
 ]
 },
 {
 title: "Tries", level: "Intermediate", icon: "",
 summary: "Prefix tree for fast string search, autocomplete, and word dictionaries.",
 topics: [
 {
 name: "Trie Implementation & Usage",
 note: "Each node has children[26] and isEnd flag. Insert and search are both O(m) where m = word length.",
 problems: [
 { id:208, title:"Implement Trie (Prefix Tree)", diff:"Medium", url:"https://leetcode.com/problems/implement-trie-prefix-tree/" },
 { id:211, title:"Design Add and Search Words Structure", diff:"Medium", url:"https://leetcode.com/problems/design-add-and-search-words-data-structure/" },
 { id:212, title:"Word Search II", diff:"Hard", url:"https://leetcode.com/problems/word-search-ii/" },
 ]
 },
 ]
 },
 {
 title: "Sorting & Intervals", level: "Intermediate", icon: "",
 summary: "Know merge sort and quick sort from scratch. Interval problems require sorting by start time.",
 topics: [
 {
 name: "Sorting Algorithms",
 note: "Merge Sort: O(n log n) stable. Quick Sort: O(n log n) average, O(n^2) worst. Know both.",
 problems: [
 { id:912, title:"Sort an Array (implement merge/quick)", diff:"Medium", url:"https://leetcode.com/problems/sort-an-array/" },
 { id:75, title:"Sort Colors (Dutch National Flag)", diff:"Medium", url:"https://leetcode.com/problems/sort-colors/" },
 { id:148, title:"Sort List (merge sort on linked list)", diff:"Medium", url:"https://leetcode.com/problems/sort-list/" },
 ]
 },
 {
 name: "Interval Problems",
 note: "Sort by start. Merge if current.start <= prev.end. Greedy works for most interval tasks.",
 problems: [
 { id:56, title:"Merge Intervals", diff:"Medium", url:"https://leetcode.com/problems/merge-intervals/" },
 { id:57, title:"Insert Interval", diff:"Medium", url:"https://leetcode.com/problems/insert-interval/" },
 { id:435, title:"Non-overlapping Intervals", diff:"Medium", url:"https://leetcode.com/problems/non-overlapping-intervals/" },
 { id:253, title:"Meeting Rooms II", diff:"Medium", url:"https://leetcode.com/problems/meeting-rooms-ii/" },
 ]
 },
 ]
 },
 {
 title: "Greedy", level: "Intermediate", icon: "",
 summary: "Make the locally optimal choice at each step. Prove correctness with an exchange argument.",
 topics: [
 {
 name: "Greedy Patterns",
 note: "Sort first, then greedy scan. Always verify the greedy choice is globally safe.",
 problems: [
 { id:55, title:"Jump Game", diff:"Medium", url:"https://leetcode.com/problems/jump-game/" },
 { id:45, title:"Jump Game II", diff:"Medium", url:"https://leetcode.com/problems/jump-game-ii/" },
 { id:134, title:"Gas Station", diff:"Medium", url:"https://leetcode.com/problems/gas-station/" },
 { id:846, title:"Hand of Straights", diff:"Medium", url:"https://leetcode.com/problems/hand-of-straights/" },
 { id:763, title:"Partition Labels", diff:"Medium", url:"https://leetcode.com/problems/partition-labels/" },
 ]
 },
 ]
 },
 ]
 },

 systemdesign: {
 label: "System Design",
 icon: "",
 color: "#0ea5e9",
 sections: [
 {
 title: "Core Concepts", icon: "",
 topics: [
 { name: "Scalability", points: ["Vertical vs horizontal scaling","Stateless services for easy scale-out","Database bottlenecks are the usual ceiling","Auto-scaling groups + load balancers"] },
 { name: "CAP Theorem", points: ["Pick 2 of: Consistency, Availability, Partition tolerance","CP systems: banks, booking (strong consistency)","AP systems: social feeds, DNS (eventual consistency)","Network partitions will happen - choose your trade-off"] },
 { name: "Load Balancing", points: ["Round-robin, least connections, IP hash","Layer 4 (TCP) vs Layer 7 (HTTP-aware)","Health checks + graceful draining","Sticky sessions when stateful (use sparingly)"] },
 { name: "Caching", points: ["Cache-aside: app reads cache first, populates on miss","Write-through: write to cache + DB together","TTL vs LRU eviction - know trade-offs","Redis for distributed cache; CDN for static assets","Cache invalidation is the hard problem"] },
 { name: "Databases at Scale", points: ["Sharding: horizontal partition by user ID / hash / range","Read replicas: scale reads, accept replication lag","CQRS: separate read and write models","Connection pooling prevents thundering herd"] },
 { name: "Message Queues", points: ["Decouples producers from consumers","RabbitMQ / Azure Service Bus - at-least-once delivery","Kafka - ordered, replayable, high throughput","Dead-letter queue for poison messages","Idempotent consumers essential"] },
 { name: "Consistency Patterns",points: ["Strong consistency: every read sees the latest write","Eventual consistency: replicas catch up over time","Read-your-own-writes: user sees their changes immediately","Monotonic reads: no going back in time per session"] },
 ]
 },
 {
 title: "Classic Design Problems", icon: "",
 topics: [
 { name: "URL Shortener", points: ["Hash long URL -> 6-7 char ID (base62)","Redis cache -> PostgreSQL persistent store","Counter-based or MD5-based ID generation","Redirect: 301 (permanent, cached) vs 302 (temporary, trackable)","Analytics: async write to queue, not in hot path"] },
 { name: "Rate Limiter", points: ["Token bucket: allows bursts, smooth long-term rate","Sliding window counter: accurate, more memory","Fixed window: simple, edge-of-window burst problem","Store counters in Redis with TTL","Return 429 Too Many Requests + Retry-After header"] },
 { name: "Notification System", points: ["Fan-out on write (push): pre-compute per follower (fast read, slow write)","Fan-out on read (pull): compute at query time (fast write, slow read)","Hybrid: fan-out for small follower counts, pull for celebrities","Push via APNs / FCM for mobile; email queue for bulk","Deduplication: track sent notification IDs"] },
 { name: "Search Autocomplete", points: ["Trie on each prefix; top-K stored at each node","Cache top searches in Redis by prefix","Periodic offline recomputation from query logs","Debounce client-side to reduce API calls","Spell correction: BK-tree or edit distance"] },
 { name: "Job Queue / Scheduler", points: ["Priority queue backed by Redis sorted set","At-least-once delivery + idempotency keys","Exponential backoff with jitter on retry","Dead-letter queue after max retries","Distributed lock (Redlock) for scheduled tasks"] },
 { name: "Distributed File Store", points: ["Chunk large files (e.g. 64 MB blocks like GFS/HDFS)","Metadata service tracks chunk locations","Replication factor >= 3 for durability","Consistent hashing to distribute chunks across nodes","Checksum per block for integrity"] },
 ]
 },
 {
 title: "APIs & Communication", icon: "",
 topics: [
 { name: "REST Best Practices", points: ["Nouns in URLs: /users/123/orders not /getOrdersByUser","Use correct HTTP verbs: GET=read, POST=create, PUT/PATCH=update, DELETE","Pagination: cursor-based > offset for large datasets","Versioning: /api/v2/ prefix or Accept header","Idempotency key header for safe retries on POST"] },
 { name: "WebSockets", points: ["Persistent bidirectional TCP connection","Use for chat, live scores, collaborative editing","Connection state on server - sticky sessions or pub/sub","Heartbeat/ping to detect dead connections","Fallback: long-polling if WebSocket unavailable"] },
 { name: "gRPC", points: ["Protocol Buffers: binary, typed, ~5-10x smaller than JSON","HTTP/2 multiplexing: many streams over one connection","Bi-directional streaming for real-time use cases","Strong typing from .proto schema - API contract enforced","Not browser-native; use gRPC-Web or envoy proxy"] },
 ]
 },
 ]
 },

 cs: {
 label: "CS Fundamentals",
 icon: "",
 color: "#10b981",
 sections: [
 {
 title: "Operating Systems", icon: "",
 topics: [
 { name: "Processes & Threads", points: ["Process = program in execution; has own memory space","Thread = lightweight process; shares memory with siblings","Context switch: save registers + PCB, load next process","User thread vs kernel thread - M:N, 1:1, M:1 models","Race condition: outcome depends on scheduling order"] },
 { name: "Synchronization", points: ["Mutex: only one thread at a time","Semaphore: signaling + counting (can be > 1)","Monitor: mutex + condition variables","Deadlock conditions: mutual exclusion, hold & wait, no preemption, circular wait","Banker's algorithm for deadlock avoidance"] },
 { name: "Memory Management", points: ["Stack: function frames, local vars - auto cleanup","Heap: dynamic allocation - manual or GC managed","Virtual memory: each process sees full address space","Paging: fixed-size pages mapped to physical frames","TLB caches virtual->physical translations for speed"] },
 { name: "CPU Scheduling", points: ["FCFS: simple, convoy effect","SJF: optimal for throughput, needs future knowledge","Round Robin: fair, good for interactive tasks","Priority: starvation risk - use aging to fix","MLFQ: multiple queues, demote CPU-heavy processes"] },
 { name: "File Systems", points: ["inode: metadata + pointers to data blocks","Hard link vs soft (symbolic) link","ext4: journaling prevents inconsistency on crash","FAT32: no permissions, 4 GB file limit","RAID: 0=speed, 1=mirror, 5=parity"] },
 ]
 },
 {
 title: "Computer Networking", icon: "",
 topics: [
 { name: "OSI & TCP/IP Models", points: ["OSI 7 layers: Physical, Data Link, Network, Transport, Session, Presentation, Application","TCP/IP 4 layers: Link, Internet, Transport, Application","Encapsulation: each layer wraps the payload with its header","PDUs: bit, frame, packet, segment, data"] },
 { name: "TCP vs UDP", points: ["TCP: 3-way handshake (SYN, SYN-ACK, ACK), reliable, ordered","Flow control (rwnd) + congestion control (cwnd, slow start)","UDP: no connection, no guarantee - lower latency","Use TCP for HTTP, SSH, databases; UDP for DNS, video, gaming","TIME_WAIT: ~2 MSL delay after TCP close - prevents stale packets"] },
 { name: "HTTP & HTTPS", points: ["HTTP/1.1: keep-alive, chunked transfer, host header required","HTTP/2: binary framing, header compression (HPACK), multiplexing","HTTP/3: runs over QUIC (UDP), reduces head-of-line blocking","TLS: record protocol encrypts, handshake authenticates","Status codes: 2xx success, 3xx redirect, 4xx client error, 5xx server error"] },
 { name: "DNS", points: ["Recursive resolver -> root -> TLD -> authoritative NS","A record: domain->IPv4; AAAA: domain->IPv6; CNAME: alias","MX: mail server; TXT: verification/SPF/DKIM","TTL: how long to cache - lower TTL = more flexible","Negative caching: cache NXDOMAIN responses"] },
 ]
 },
 {
 title: "Compilers & Runtime", icon: "",
 topics: [
 { name: "Compilation Pipeline", points: ["Lexing -> tokens, Parsing -> AST, Semantic analysis","Intermediate representation (IR) -> optimization passes","Code generation -> machine code or bytecode","JIT (Just-In-Time): compile hot paths at runtime (JVM, V8)","AOT (Ahead-Of-Time): compiled before execution (Go, C, Rust)"] },
 { name: "Garbage Collection", points: ["Reference counting: fast, but cycles leak - used in Python/Swift","Mark-and-sweep: traces live objects from roots, frees dead","Generational GC: most objects die young - nursery + old gen","Stop-the-world pause vs incremental/concurrent GC","Write barrier: track cross-generation references"] },
 { name: "Concurrency Primitives", points: ["Mutex: binary lock - one thread, one lock","Semaphore: N permits - producer/consumer","Condition variable: wait() releases lock, notify() wakes waiters","Spinlock: busy-wait - only use for very short critical sections","Lock-free: CAS (compare-and-swap) instructions - no kernel involvement"] },
 ]
 },
 ]
 }
};

// -€-€-€ Prep renderer -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€

// -€-€ Prep streak helpers -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
const PREP_STREAK_KEY = "prepActivityDates";

function prepRecordToday() {
 const today = localDateStr(new Date());
 try {
 const stored = JSON.parse(localStorage.getItem(PREP_STREAK_KEY) || "[]");
 if (!stored.includes(today)) {
 stored.push(today);
 // Keep last 400 days only
 const trimmed = stored.sort().slice(-400);
 localStorage.setItem(PREP_STREAK_KEY, JSON.stringify(trimmed));
 }
 } catch(e) {}
}

function prepGetStreak() {
 try {
 const stored = new Set(JSON.parse(localStorage.getItem(PREP_STREAK_KEY) || "[]"));
 const today = localDateStr(new Date());
 // If not active today, start from yesterday (in-progress day)
 const cursor = new Date();
 cursor.setHours(0,0,0,0);
 if (!stored.has(today)) cursor.setDate(cursor.getDate() - 1);
 let streak = 0;
 for (let i = 0; i < 365; i++) {
 const dow = cursor.getDay();
 if (dow === 0 || dow === 6) { cursor.setDate(cursor.getDate() - 1); continue; }
 const ds = localDateStr(cursor);
 if (!stored.has(ds)) break;
 streak++;
 cursor.setDate(cursor.getDate() - 1);
 }
 const activeDays = [...stored].filter(d => {
 const dt = new Date(d + "T00:00:00");
 return dt.getDay() !== 0 && dt.getDay() !== 6;
 }).length;
 const activeToday = stored.has(today);
 return { streak, activeDays, activeToday };
 } catch(e) { return { streak: 0, activeDays: 0, activeToday: false }; }
}

function prepStreakBanner() {
 const { streak, activeDays, activeToday } = prepGetStreak();
 const flame = streak >= 7 ? "" : streak >= 3 ? "Active" : "";
 const todayDot = activeToday
 ? `<span style="color:#10b981;font-size:12px;font-weight:600">OK Active today</span>`
 : `<span style="color:#f59e0b;font-size:12px">Practice today to keep the streak!</span>`;
 // Last 14 weekdays as dots
 const dots = [];
 const c = new Date(); c.setHours(0,0,0,0);
 const stored = (() => { try { return new Set(JSON.parse(localStorage.getItem(PREP_STREAK_KEY)||"[]")); } catch{return new Set();} })();
 let counted = 0;
 for (let i = 0; counted < 14 && i < 30; i++) {
 const dow = c.getDay();
 if (dow !== 0 && dow !== 6) {
 const ds = localDateStr(c);
 const isToday = i === 0;
 const active = stored.has(ds);
 dots.unshift(`<span style="width:18px;height:18px;border-radius:4px;display:inline-block;background:${active?"#6366f1":"#e2e8f0"};opacity:${isToday&&!active?0.5:1};border:${isToday?"2px solid #6366f1":"none"}" title="${ds}"></span>`);
 counted++;
 }
 c.setDate(c.getDate() - 1);
 }
 return `
 <div class="prep-streak-banner">
 <div class="prep-streak-left">
 <span class="prep-streak-flame">${flame}</span>
 <div>
 <div class="prep-streak-num">${streak} <span class="prep-streak-unit">day streak</span></div>
 ${todayDot}
 </div>
 </div>
 <div class="prep-streak-mid">
 <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Last 14 weekdays</div>
 <div style="display:flex;gap:3px;align-items:center">${dots.join("")}</div>
 </div>
 <div class="prep-streak-right">
 <span class="prep-streak-total">${activeDays}</span>
 <span style="font-size:11px;color:var(--text-muted)">total days practiced</span>
 </div>
 </div>`;
}

function renderPrep() {
 const panel = document.getElementById("prepPanel");
 document.getElementById("analyticsPanel").style.display = "none";
 document.getElementById("roadmapPanel").style.display = "none";
 document.querySelector(".layout").style.display = "none";
 metrics.style.display = "none";

 const savedTab = localStorage.getItem("prepTab") || "dsa";
 const activeTab = ["dsa","systemdesign","cs"].includes(savedTab) ? savedTab : "dsa";

 panel.style.display = "block";

 function renderTab(tab) {
 localStorage.setItem("prepTab", tab);
 const d = PREP_DATA[tab];
 const diffBadge = diff => {
 const cl = diff === "Easy" ? "diff-easy" : diff === "Medium" ? "diff-med" : "diff-hard";
 return `<span class="diff-badge ${cl}">${diff}</span>`;
 };

 let html = `
 <div class="prep-wrap">
 ${prepStreakBanner()}
 <div class="prep-tabs">
 ${Object.entries(PREP_DATA).map(([k,v])=>`
 <button class="prep-tab-btn ${k===tab?'active':''}" data-tab="${k}" style="--tab-color:${v.color}">
 <span>${v.icon}</span> ${v.label}
 </button>`).join("")}
 </div>`;

 if (tab === "dsa") {
 html += `<div class="prep-intro">
 <strong>How to use this section:</strong> Work through topics in order - each builds on the previous.
 Click a problem to open it on LeetCode. Aim for understanding the pattern, not just memorising the solution.
 </div>`;
 d.sections.forEach((sec, si) => {
 html += `<div class="prep-section">
 <div class="prep-section-head">
 <span class="prep-section-icon">${sec.icon}</span>
 <div>
 <div class="prep-section-title">${sec.title}</div>
 <div class="prep-section-level">${sec.level}</div>
 </div>
 </div>
 <p class="prep-section-summary">${sec.summary}</p>`;
 sec.topics.forEach((topic, ti) => {
 const uid = `dsa-${si}-${ti}`;
 html += `<div class="prep-topic" id="${uid}">
 <div class="prep-topic-head" onclick="document.getElementById('${uid}').classList.toggle('open')">
 <span class="prep-topic-arrow">></span>
 <span class="prep-topic-name">${topic.name}</span>
 <span class="prep-problem-count">${topic.problems.length} problems</span>
 </div>
 <div class="prep-topic-body">
 <div class="prep-topic-note"> ${topic.note}</div>
 <div class="prep-problems">
 ${topic.problems.map(p=>{
 const ck = "prep_solved_"+p.id;
 const solved = !!localStorage.getItem(ck);
 return `<div class="prep-problem-row${solved?" solved":""}">
 <label class="prep-prob-check" title="Mark as solved">
 <input type="checkbox" class="prep-cb" data-ck="${ck}" ${solved?"checked":""}>
 </label>
 <a href="${p.url}" target="_blank" class="prep-problem-chip">
 <span class="prob-id">#${p.id}</span>
 <span class="prob-title">${p.title}</span>
 ${diffBadge(p.diff)}
 </a>
 </div>`;
 }).join("")}
 </div>
 ${(PREP_RESOURCES[topic.name]||[]).length ? `<div class="prep-dsa-resources">
 <div class="prep-dsa-res-label"> Free Resources</div>
 ${(PREP_RESOURCES[topic.name]||[]).map(r=>`<a href="${r.url}" target="_blank" class="prep-res-link">${r.label}</a>`).join("")}
 </div>` : ""}
 </div>
 </div>`;
 });
 html += `</div>`;
 });
 } else {
 d.sections.forEach(sec => {
 html += `<div class="prep-section">
 <div class="prep-section-head">
 <span class="prep-section-icon">${sec.icon}</span>
 <div class="prep-section-title">${sec.title}</div>
 </div>
 <div class="prep-concepts-grid">`;
 sec.topics.forEach(topic => {
 const res = PREP_RESOURCES[topic.name] || [];
 const topicKey = tab+"_"+sec.title+"_"+topic.name;
 html += `<div class="prep-concept-card">
 <div class="prep-concept-title">${topic.name}</div>
 <ul class="prep-concept-points">
 ${topic.points.map((p,pi)=>{
 const ck="prep_concept_"+topicKey.replace(/[^a-z0-9]/gi,"_")+"_"+pi;
 const done=!!localStorage.getItem(ck);
 return `<li class="${done?"concept-done":""}">
 <label style="display:flex;gap:7px;align-items:flex-start;cursor:pointer">
 <input type="checkbox" class="prep-cb" data-ck="${ck}" ${done?"checked":""} style="margin-top:3px;flex-shrink:0;accent-color:#6366f1">
 <span>${p}</span>
 </label>
 </li>`;
 }).join("")}
 </ul>
 ${res.length ? `<div class="prep-card-resources">
 ${res.map(r=>`<a href="${r.url}" target="_blank" class="prep-res-link" ">${r.label}</a>`).join("")}
 </div>` : ""}
 </div>`;
 });
 html += `</div></div>`;
 });
 }

 html += `</div>`;
 panel.innerHTML = html;

 panel.querySelectorAll(".prep-tab-btn").forEach(btn => {
 btn.addEventListener("click", () => renderTab(btn.dataset.tab));
 });

 // Checkbox streak tracking
 panel.querySelectorAll(".prep-cb").forEach(cb => {
 cb.addEventListener("change", () => {
 if (cb.checked) {
 localStorage.setItem(cb.dataset.ck, "1");
 prepRecordToday();
 // Refresh streak banner only
 const banner = panel.querySelector(".prep-streak-banner");
 if (banner) banner.outerHTML = prepStreakBanner();
 } else {
 localStorage.removeItem(cb.dataset.ck);
 }
 // Visual feedback
 const row = cb.closest(".prep-problem-row") || cb.closest("li");
 if (row) row.classList.toggle("solved", cb.checked);
 if (row) row.classList.toggle("concept-done", cb.checked);
 });
 });
 }

 renderTab(activeTab);
}

function renderRoadmap() {
 const panel = document.getElementById("roadmapPanel");
 if (!panel) return;
 document.querySelector(".layout").style.display = "none";
 document.getElementById("analyticsPanel").style.display = "none";
 metrics.style.display = "none";
 panel.style.display = "block";

 const cfg = typeof appConfig !== "undefined" ? appConfig : {};
 const phases = _rmBuildPhases(cfg);
 const checked = _rmGetChecked();
 const allSkills = Object.values(phases).flat();
 const total = allSkills.length;
 const done = allSkills.filter(s=>checked[s.key]).length;
 const pct = total ? Math.round(done/total*100) : 0;
 const titles = (cfg.jobTitles||[]).join(", ") || "Your Target Roles";

 const phaseKeys = [1,2,3,4].filter(p=>phases[p].length>0);

 function _rmSkillPct(key) {
 try {
 const ck = "sdc_" + key.replace(/[^a-z0-9]/gi, "_");
 const stored = JSON.parse(localStorage.getItem(ck) || "{}");
 const concepts = SKILL_CONCEPTS_RM[key] ||
 SKILL_CONCEPTS_RM[Object.keys(SKILL_CONCEPTS_RM).find(k => k.toLowerCase() === key.toLowerCase())];
 const _eff = concepts || { sections:[
 {title:"Core",items:["Understand","Set up","Core syntax","Use cases"]},
 {title:"Intermediate",items:["Best practices","Integration","Testing","Performance"]},
 {title:"Interview",items:["Interview questions","Build project","Trade-offs","Coding problems"]},
 ]};
 const total = _eff.sections.flatMap(s=>s.items).length;
 const done = Object.values(stored).filter(Boolean).length;
 return total ? Math.round((done/total)*100) : 0;
 } catch { return 0; }
 }

 function skillCard(s) {
 const id = "rmc_"+s.key.replace(/[^a-z0-9]/gi,"_");
 const isDone = !!checked[s.key];
 return `<div class="rmc ${isDone?"rmc-done":""}" >
 <label class="rmc-left" for="${id}">
 <input type="checkbox" id="${id}" class="rmc-cb" data-key="${_rmEsc(s.key)}" ${isDone?"checked":""}>
 <span class="rmc-icon">${s.icon}</span>
 </label>
 <div class="rmc-body">
 <span class="rmc-name">${_rmEsc(s.label)}</span>
 ${s.desc?`<span class="rmc-desc">${_rmEsc(s.desc)}</span>`:""}
 ${(()=>{ const p=_rmSkillPct(s.key); return p>0?`<div class="rmc-skill-prog"><div class="rmc-skill-fill" style="width:${p}%"></div><span class="rmc-skill-pct">${p}%</span></div>`:""; })()}
 </div>
 <div class="rmc-right">
 <span class="rmc-badge ${s.isMust?"rmc-must":"rmc-nice"}">${s.isMust?"Must":"Nice"}</span>
 <button type="button" class="rmc-detail" data-key="${_rmEsc(s.key)}" title="View concepts to learn"></button>
 </div>
 </div>`;
 }

 function projectsBlock(idx) {
 const pd = _rmBuildRoleProjects(cfg, idx + 1);
 if (!pd) return "";
 const diffColor = { "Beginner":"#2e7d32","Intermediate":"#1565c0","Advanced":"#c62828" };
 const cards = pd.projects.map(pr => `
 <div class="prj-card">
 <div class="prj-top">
 <span class="prj-diff" style="background:${diffColor[pr.difficulty]||"#555"}">${_rmEsc(pr.difficulty)}</span>
 <div class="prj-skills">${pr.skills.map(s=>`<span class="prj-skill-tag">${_rmEsc(s)}</span>`).join("")}</div>
 </div>
 <div class="prj-title">${_rmEsc(pr.title)}</div>
 <div class="prj-desc">${_rmEsc(pr.desc)}</div>
 <ul class="prj-highlights">${pr.highlights.map(h=>`<li>${_rmEsc(h)}</li>`).join("")}</ul>
 <a class="prj-link" href="${pr.github}" target="_blank" rel="noopener">Browse examples on GitHub -></a>
 </div>`).join("");
 return `
 <div class="prj-section">
 <div class="prj-section-title"> ${pd.label} - put your skills to work</div>
 <div class="prj-grid">${cards}</div>
 </div>`;
 }

 function tipsBlock(idx) {
 const tips = _rmBuildCrackTips(cfg, idx + 1);
 if (!tips.length) return "";
 const cards = tips.map(tip => `
 <div class="tip-card">
 <div class="tip-title">${_rmEsc(tip.title)}</div>
 <div class="tip-text">${_rmEsc(tip.text)}</div>
 </div>`).join("");
 return `
 <div class="tip-section">
 <div class="tip-section-title">Tips to crack this role sooner</div>
 <div class="tip-grid">${cards}</div>
 </div>`;
 }

 function phaseBlock(p, idx) {
 const m = PHASE_META_RM[idx];
 const skills = phases[p];
 const pd = skills.filter(s=>checked[s.key]).length;
 const pp = skills.length ? Math.round(pd/skills.length*100) : 0;
 return `
 <div class="rmp" style="--pc:${m.color}">
 <div class="rmp-hd">
 <span class="rmp-icon">${m.icon}</span>
 <div class="rmp-titles">
 <span class="rmp-num">Phase ${p}</span>
 <span class="rmp-label">${m.label}</span>
 <span class="rmp-desc">${m.desc}</span>
 </div>
 <div class="rmp-prog">
 <span class="rmp-pct">${pp}%</span>
 <div class="rmp-bar"><div class="rmp-bar-fill" style="width:${pp}%;background:${m.color}"></div></div>
 <span class="rmp-ct">${pd}/${skills.length}</span>
 </div>
 </div>
 <div class="rmp-grid">${skills.map(skillCard).join("")}</div>
 </div>
 ${projectsBlock(idx)}
 ${tipsBlock(idx)}
 ${idx < phaseKeys.length-1 ? '<div class="rmp-arrow">v</div>' : ""}`;
 }

 panel.innerHTML = `
 <div class="rmw">
 <div class="rmw-hd">
 <div>
 <h2 class="rmw-title"> Career Roadmap</h2>
 <p class="rmw-sub">Based on: <strong>${_rmEsc(titles)}</strong></p>
 </div>
 <div class="rmw-ovr">
 <span class="rmw-pct">${pct}%</span>
 <div class="rmw-obar"><div class="rmw-ofill" style="width:${pct}%"></div></div>
 <span class="rmw-olabel">${done} / ${total} skills</span>
 </div>
 </div>
 <div class="rmw-legend">
 <span class="rmc-badge rmc-must">Must-Have</span> Required for your roles &nbsp;|&nbsp;
 <span class="rmc-badge rmc-nice">Nice</span> Improves your fit score
 </div>
 <div class="rmw-flow">${phaseKeys.map((p,i)=>phaseBlock(p,i)).join("")}</div>
 </div>`;

 panel.querySelectorAll(".rmc-detail").forEach(btn=>{
 btn.addEventListener("click", e=>{ e.stopPropagation(); _rmOpenSkillTab(btn.dataset.key); });
 });

 panel.querySelectorAll(".rmc-cb").forEach(cb=>{
 cb.addEventListener("change", e=>{
 e.stopPropagation();
 _rmSetChecked(cb.dataset.key, cb.checked);
 cb.closest(".rmc").classList.toggle("rmc-done", cb.checked);
 _rmUpdateProgress(panel);
 });
 });

}


// -€-€-€ Free Resources per skill -€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€-€
const SKILL_RESOURCES_RM = {
 "OOP": [
 { title:"Object-Oriented Programming - freeCodeCamp", url:"https://www.freecodecamp.org/news/object-oriented-programming-concepts-21bb035f7260/", tag:"Article" },
 { title:"SOLID Principles - Digital Ocean", url:"https://www.digitalocean.com/community/conceptual-articles/s-o-l-i-d-the-first-five-principles-of-object-oriented-design", tag:"Article" },
 { title:"Design Patterns - Refactoring.Guru", url:"https://refactoring.guru/design-patterns", tag:"Interactive" },
 { title:"OOP in C# - Microsoft Learn", url:"https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/tutorials/oop", tag:"Tutorial" },
 ],
 "Git": [
 { title:"Pro Git Book (free)", url:"https://git-scm.com/book/en/v2", tag:"Book" },
 { title:"Learn Git Branching - Interactive", url:"https://learngitbranching.js.org/", tag:"Interactive" },
 { title:"Git Tutorial - Atlassian", url:"https://www.atlassian.com/git/tutorials", tag:"Tutorial" },
 { title:"GitHub Skills (free)", url:"https://skills.github.com/", tag:"Course" },
 ],
 "HTML": [
 { title:"HTML - MDN Web Docs", url:"https://developer.mozilla.org/en-US/docs/Learn/HTML", tag:"Docs" },
 { title:"Responsive Web Design - freeCodeCamp", url:"https://www.freecodecamp.org/learn/2022/responsive-web-design/", tag:"Course" },
 { title:"HTML Full Course - Dave Gray (YouTube)", url:"https://www.youtube.com/watch?v=mJgBOIoGihA", tag:"Video" },
 ],
 "CSS": [
 { title:"CSS - MDN Web Docs", url:"https://developer.mozilla.org/en-US/docs/Learn/CSS", tag:"Docs" },
 { title:"Flexbox Froggy (Game)", url:"https://flexboxfroggy.com/", tag:"Interactive" },
 { title:"CSS Grid Garden (Game)", url:"https://cssgridgarden.com/", tag:"Interactive" },
 { title:"CSS-Tricks - Complete Guide to Flexbox", url:"https://css-tricks.com/snippets/css/a-guide-to-flexbox/", tag:"Article" },
 ],
 "JavaScript": [
 { title:"javascript.info - The Modern JavaScript Tutorial", url:"https://javascript.info/", tag:"Book" },
 { title:"JavaScript - MDN Web Docs", url:"https://developer.mozilla.org/en-US/docs/Learn/JavaScript", tag:"Docs" },
 { title:"JavaScript Algorithms & Data Structures - freeCodeCamp", url:"https://www.freecodecamp.org/learn/javascript-algorithms-and-data-structures/", tag:"Course" },
 { title:"Eloquent JavaScript (free online)", url:"https://eloquentjavascript.net/", tag:"Book" },
 ],
 "SQL": [
 { title:"SQLZoo - Interactive SQL Tutorial", url:"https://sqlzoo.net/", tag:"Interactive" },
 { title:"SQL Tutorial - Mode Analytics", url:"https://mode.com/sql-tutorial/", tag:"Tutorial" },
 { title:"SQL - W3Schools", url:"https://www.w3schools.com/sql/", tag:"Tutorial" },
 { title:"Database Design - freeCodeCamp (YouTube)", url:"https://www.youtube.com/watch?v=ztHopE5Wnpc", tag:"Video" },
 ],
 "C#": [
 { title:"C# Fundamentals - Microsoft Learn (free)", url:"https://learn.microsoft.com/en-us/dotnet/csharp/tour-of-csharp/", tag:"Docs" },
 { title:"C# Full Course - freeCodeCamp (YouTube)", url:"https://www.youtube.com/watch?v=GhQdlIFylQ8", tag:"Video" },
 { title:"C# Yellow Book - Rob Miles (free PDF)", url:"https://www.robmiles.com/c-yellow-book/", tag:"Book" },
 { title:"C# Player's Guide - free chapters", url:"https://csharpplayersguide.com/", tag:"Book" },
 ],
 ".NET": [
 { title:".NET Documentation - Microsoft", url:"https://learn.microsoft.com/en-us/dotnet/", tag:"Docs" },
 { title:".NET for Beginners - Microsoft Learn", url:"https://learn.microsoft.com/en-us/training/paths/build-dotnet-applications-csharp/", tag:"Course" },
 { title:"Dependency Injection in .NET - Microsoft", url:"https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection", tag:"Docs" },
 ],
 "ASP.NET": [
 { title:"ASP.NET Core - Microsoft Learn", url:"https://learn.microsoft.com/en-us/aspnet/core/?view=aspnetcore-8.0", tag:"Docs" },
 { title:"Build Web APIs with ASP.NET Core - Microsoft Learn", url:"https://learn.microsoft.com/en-us/training/modules/build-web-api-aspnet-core/", tag:"Course" },
 { title:"ASP.NET Core Tutorial - freeCodeCamp (YouTube)", url:"https://www.youtube.com/watch?v=hZ1DASYd9rk", tag:"Video" },
 ],
 "REST API": [
 { title:"RESTful Web Services - Roy Fielding's Dissertation", url:"https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm", tag:"Paper" },
 { title:"REST API Design Best Practices - freeCodeCamp", url:"https://www.freecodecamp.org/news/rest-api-best-practices-rest-endpoint-design-examples/", tag:"Article" },
 { title:"Postman Learning Center (free)", url:"https://learning.postman.com/", tag:"Interactive" },
 { title:"HTTP Status Codes - MDN", url:"https://developer.mozilla.org/en-US/docs/Web/HTTP/Status", tag:"Docs" },
 ],
 "SQL Server": [
 { title:"SQL Server - Microsoft Learn", url:"https://learn.microsoft.com/en-us/sql/sql-server/", tag:"Docs" },
 { title:"T-SQL Tutorial - sqlservertutorial.net", url:"https://www.sqlservertutorial.net/", tag:"Tutorial" },
 { title:"EF Core - Microsoft Learn", url:"https://learn.microsoft.com/en-us/ef/core/", tag:"Docs" },
 { title:"SQL Server for Beginners (YouTube)", url:"https://www.youtube.com/watch?v=7GVFYt6_ZFM", tag:"Video" },
 ],
 "Node.js": [
 { title:"Node.js Official Documentation", url:"https://nodejs.org/en/docs/", tag:"Docs" },
 { title:"The Odin Project - Node.js Path (free)", url:"https://www.theodinproject.com/paths/full-stack-javascript", tag:"Course" },
 { title:"Node.js & Express - freeCodeCamp (YouTube)", url:"https://www.youtube.com/watch?v=Oe421EPjeBE", tag:"Video" },
 { title:"Node.js Best Practices - GitHub", url:"https://github.com/goldbergyoni/nodebestpractices", tag:"Docs" },
 ],
 "Azure": [
 { title:"Azure Fundamentals - Microsoft Learn (free)", url:"https://learn.microsoft.com/en-us/training/paths/azure-fundamentals-describe-azure-architecture-services/", tag:"Course" },
 { title:"Azure for Students - free $100 credit", url:"https://azure.microsoft.com/en-us/free/students/", tag:"Free Tier" },
 { title:"AZ-900 Study Guide - freeCodeCamp (YouTube)", url:"https://www.youtube.com/watch?v=NKEFWyqJ5XA", tag:"Video" },
 { title:"Azure Architecture Center", url:"https://learn.microsoft.com/en-us/azure/architecture/", tag:"Docs" },
 ],
 "Docker": [
 { title:"Docker Official Docs - Get Started", url:"https://docs.docker.com/get-started/", tag:"Docs" },
 { title:"Play with Docker (free in-browser labs)", url:"https://labs.play-with-docker.com/", tag:"Interactive" },
 { title:"Docker Full Course - TechWorld with Nana (YouTube)", url:"https://www.youtube.com/watch?v=3c-iBn73dDE", tag:"Video" },
 { title:"Docker for Beginners - freeCodeCamp", url:"https://www.freecodecamp.org/news/the-docker-handbook/", tag:"Article" },
 ],
 "Azure DevOps": [
 { title:"Azure DevOps - Microsoft Learn", url:"https://learn.microsoft.com/en-us/training/paths/evolve-your-devops-practices/", tag:"Course" },
 { title:"CI/CD with Azure Pipelines - Microsoft Learn", url:"https://learn.microsoft.com/en-us/azure/devops/pipelines/", tag:"Docs" },
 { title:"Azure DevOps Tutorial - freeCodeCamp (YouTube)", url:"https://www.youtube.com/watch?v=4BibQ69MD8c", tag:"Video" },
 ],
 "TypeScript": [
 { title:"TypeScript Handbook (official, free)", url:"https://www.typescriptlang.org/docs/handbook/intro.html", tag:"Docs" },
 { title:"TypeScript Full Course - freeCodeCamp (YouTube)", url:"https://www.youtube.com/watch?v=30LWjhZzg50", tag:"Video" },
 { title:"TypeScript Exercises (interactive)", url:"https://typescript-exercises.github.io/", tag:"Interactive" },
 { title:"Total TypeScript Tips - Matt Pocock (free)", url:"https://www.totaltypescript.com/tips", tag:"Tutorial" },
 ],
 "CI/CD": [
 { title:"GitHub Actions Documentation (free)", url:"https://docs.github.com/en/actions", tag:"Docs" },
 { title:"CI/CD Explained - Atlassian", url:"https://www.atlassian.com/continuous-delivery/principles/continuous-integration-vs-delivery-vs-deployment", tag:"Article" },
 { title:"GitHub Actions Full Course - TechWorld with Nana (YouTube)", url:"https://www.youtube.com/watch?v=R8_veQiYBjI", tag:"Video" },
 ],
 "Angular": [
 { title:"Angular Tour of Heroes - Official Tutorial", url:"https://angular.io/tutorial", tag:"Tutorial" },
 { title:"Angular University (free articles)", url:"https://blog.angular-university.io/", tag:"Article" },
 { title:"Angular Full Course - freeCodeCamp (YouTube)", url:"https://www.youtube.com/watch?v=3qBXWUpoPHo", tag:"Video" },
 { title:"RxJS Documentation", url:"https://rxjs.dev/guide/overview", tag:"Docs" },
 ],
 "React": [
 { title:"React Official Docs (react.dev)", url:"https://react.dev/learn", tag:"Docs" },
 { title:"The Odin Project - React Path (free)", url:"https://www.theodinproject.com/paths/full-stack-javascript/courses/react", tag:"Course" },
 { title:"React Full Course - freeCodeCamp (YouTube)", url:"https://www.youtube.com/watch?v=bMknfKXIFA8", tag:"Video" },
 { title:"React Query Docs (TanStack Query)", url:"https://tanstack.com/query/latest/docs/framework/react/overview", tag:"Docs" },
 ],
 "Microservices": [
 { title:"Microservices - Martin Fowler", url:"https://martinfowler.com/articles/microservices.html", tag:"Article" },
 { title:".NET Microservices Architecture Guide (free PDF)", url:"https://learn.microsoft.com/en-us/dotnet/architecture/microservices/", tag:"Book" },
 { title:"Microservices with Node.js - freeCodeCamp (YouTube)", url:"https://www.youtube.com/watch?v=EkAiTVhRZdg", tag:"Video" },
 { title:"CQRS Pattern - Microsoft Azure Docs", url:"https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs", tag:"Docs" },
 ],
 "Kubernetes": [
 { title:"Kubernetes Official Documentation", url:"https://kubernetes.io/docs/home/", tag:"Docs" },
 { title:"Killercoda - Free Kubernetes Labs", url:"https://killercoda.com/kubernetes", tag:"Interactive" },
 { title:"Kubernetes Full Course - TechWorld with Nana (YouTube)", url:"https://www.youtube.com/watch?v=X48VuDVv0do", tag:"Video" },
 { title:"Play with Kubernetes (free in-browser)", url:"https://labs.play-with-k8s.com/", tag:"Interactive" },
 ],
 "CS Fundamentals": [
 { title:"CS50 - Harvard (free, best intro ever)", url:"https://cs50.harvard.edu/x/", tag:"Course" },
 { title:"Operating Systems - Three Easy Pieces (free PDF)", url:"https://pages.cs.wisc.edu/~remzi/OSTEP/", tag:"Book" },
 { title:"Computer Networking - Top-Down Approach (free slides)", url:"https://gaia.cs.umass.edu/kurose_ross/online_lectures.htm", tag:"Course" },
 { title:"Neso Academy - OS & Networking (YouTube)", url:"https://www.youtube.com/@nesoacademy", tag:"Video" },
 ],
 "DSA": [
 { title:"NeetCode 150 - Structured DSA roadmap (free)", url:"https://neetcode.io/roadmap", tag:"Interactive" },
 { title:"LeetCode - Practice problems (free tier)", url:"https://leetcode.com/problemset/", tag:"Interactive" },
 { title:"Algorithms - Abdul Bari (YouTube)", url:"https://www.youtube.com/watch?v=0IAPZzGSbME&list=PLDN4rrl48XKpZkf03iYFl-O29szjTrs_O", tag:"Video" },
 { title:"The Algorithm Design Manual - Skiena (free chapter samples)", url:"https://www.algorist.com/", tag:"Book" },
 ],
 "System Design": [
 { title:"System Design Primer - GitHub (free, 200k+ stars)", url:"https://github.com/donnemartin/system-design-primer", tag:"Docs" },
 { title:"ByteByteGo System Design (free articles)", url:"https://bytebytego.com/", tag:"Article" },
 { title:"Grokking System Design - key concepts (free intro)", url:"https://www.designgurus.io/blog/grokking-system-design-interview", tag:"Article" },
 { title:"System Design - TechDummies Narendra L (YouTube)", url:"https://www.youtube.com/@TechDummiesNarendraL", tag:"Video" },
 ],

 "Redis": [
 { title:"Redis University - Free Online Courses", url:"https://university.redis.com/", tag:"Course" },
 { title:"Redis Official Documentation", url:"https://redis.io/docs/", tag:"Docs" },
 { title:"Redis Crash Course - TechWorld with Nana (YouTube)", url:"https://www.youtube.com/watch?v=OqCK95AS-YE", tag:"Video" },
 ],
};

// Tag colors
const _RM_TAG_COLORS = {
 "Docs":"#1565c0","Tutorial":"#2e7d32","Course":"#6a1b9a","Interactive":"#e65100",
 "Video":"#c62828","Article":"#00695c","Book":"#4e342e","Free Tier":"#558b2f",
 "Paper":"#37474f"
};

function _rmOpenSkillTab(key) {
 const meta = SKILL_META_RM[key] || { label: key, icon: "", desc: "", phase: 1 };
 const concepts = SKILL_CONCEPTS_RM[key] ||
 SKILL_CONCEPTS_RM[Object.keys(SKILL_CONCEPTS_RM).find(k => k.toLowerCase() === key.toLowerCase())];
 const _foundRes = SKILL_RESOURCES_RM[key] ||
 SKILL_RESOURCES_RM[Object.keys(SKILL_RESOURCES_RM).find(k => k.toLowerCase() === key.toLowerCase())];
 const enc = encodeURIComponent(meta.label);
 const resources = _foundRes && _foundRes.length ? _foundRes : [
 { tag:"YouTube", title:`${meta.label} Full Course for Beginners`, url:`https://www.youtube.com/results?search_query=${enc}+full+course+beginners` },
 { tag:"YouTube", title:`${meta.label} Tutorial - Traversy Media / Fireship`, url:`https://www.youtube.com/results?search_query=${enc}+tutorial+traversy+fireship` },
 { tag:"YouTube", title:`${meta.label} Interview Questions & Answers`, url:`https://www.youtube.com/results?search_query=${enc}+interview+questions+answers` },
 { tag:"Free", title:`${meta.label} - freeCodeCamp Articles`, url:`https://www.freecodecamp.org/news/search/?query=${enc}` },
 { tag:"Docs", title:`${meta.label} - Official Documentation`, url:`https://www.google.com/search?q=${enc}+official+documentation+site` },
 ];
 const phase = PHASE_META_RM[(meta.phase || 1) - 1] || {};
 const color = phase.color || "#2196f3";
 const ck = "sdc_" + key.replace(/[^a-z0-9]/gi, "_");
 const _effectiveConcepts = concepts || { sections:[
 { title:"Core Fundamentals", items:[
 `Understand what ${meta.label} is and when to use it`,
 `Set up the ${meta.label} development environment`,
 `Core syntax, APIs, and basic patterns`,
 `Common use cases and real-world examples`,
 ]},
 { title:"Intermediate Topics", items:[
 `Best practices and design patterns in ${meta.label}`,
 `Integration with other tools and frameworks`,
 `Testing and debugging ${meta.label} code`,
 `Performance optimisation tips`,
 ]},
 { title:"Interview Preparation", items:[
 `Top interview questions on ${meta.label}`,
 `Build a small project using ${meta.label}`,
 `Explain ${meta.label} trade-offs vs alternatives`,
 `Review commonly asked coding problems`,
 ]},
 ]};
 const allItems = _effectiveConcepts.sections.flatMap(s => s.items);

 function getStored() {
 try { return JSON.parse(localStorage.getItem(ck) || "{}"); } catch { return {}; }
 }
 function renderModal() {
 const stored = getStored();
 const doneCt = Object.values(stored).filter(Boolean).length;
 const pct = allItems.length ? Math.round((doneCt / allItems.length) * 100) : 0;
 const tc = _RM_TAG_COLORS;

 const conceptsHTML = _effectiveConcepts.sections.map((sec, si) => `
 <div style="margin-bottom:20px">
 <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #eee">${sec.title}</div>
 <ul style="list-style:none;display:flex;flex-direction:column;gap:4px">
 ${sec.items.map((item, ii) => {
 const idx = si + "_" + ii;
 const isDone = !!stored[idx];
 return `<li class="skill-concept-item${isDone ? " done" : ""}" data-idx="${idx}">
 <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:13.5px;color:${isDone?"#bbb":"#333"};padding:6px 8px;border-radius:7px;transition:background .15s">
 <input type="checkbox" class="skill-cb" data-idx="${idx}" data-ck="${ck}" ${isDone ? "checked" : ""}
 style="margin-top:3px;flex-shrink:0;accent-color:${color};width:16px;height:16px;cursor:pointer">
 <span style="${isDone ? "text-decoration:line-through" : ""}">${item}</span>
 </label>
 </li>`;
 }).join("")}
 </ul>
 </div>`).join("");

 const resHTML = resources.map(r => {
 const bg = tc[r.tag] || "#555";
 return `<a href="${r.url}" target="_blank" rel="noopener"
 style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:10px;border:1.5px solid #e8eaf0;background:#fff;text-decoration:none;color:#1a1a2e;margin-bottom:10px;transition:border-color .15s"
 onmouseover="this.style.borderColor='${color}'" onmouseout="this.style.borderColor='#e8eaf0'">
 <span style="font-size:10px;font-weight:700;color:#fff;background:${bg};padding:2px 8px;border-radius:10px;flex-shrink:0;white-space:nowrap">${r.tag}</span>
 <span style="flex:1;font-size:13px;font-weight:500">${r.title}</span>
 <span style="color:${color};font-size:16px">-></span>
 </a>`;
 }).join("");

 document.getElementById("skillModalInner").innerHTML = `
 <div style="background:linear-gradient(135deg,${color}ee,${color}88);color:#fff;padding:28px 32px 20px">
 <button id="skillModalClose" style="float:right;background:rgba(255,255,255,.25);border:none;color:#fff;font-size:18px;width:32px;height:32px;border-radius:50%;cursor:pointer;line-height:1">x</button>
 <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
 <span style="font-size:42px">${meta.icon || ""}</span>
 <div>
 <div style="font-size:24px;font-weight:800">${meta.label}</div>
 <div style="font-size:13px;opacity:.85;margin-top:2px">${meta.desc || ""}</div>
 </div>
 </div>
 <div style="display:inline-block;background:rgba(255,255,255,.22);border-radius:20px;padding:3px 12px;font-size:12px;font-weight:600;margin-bottom:14px">${phase.icon || ""} Phase ${meta.phase || "?"}: ${phase.label || ""}</div>
 <div style="height:8px;background:rgba(255,255,255,.3);border-radius:4px;overflow:hidden">
 <div id="skillModalBar" style="height:100%;background:#fff;border-radius:4px;transition:width .4s;width:${pct}%"></div>
 </div>
 <div id="skillModalPct" style="font-size:12px;opacity:.8;margin-top:6px">${doneCt} / ${allItems.length} concepts completed (${pct}%)</div>
 </div>
 <div style="background:#f4f6f9;display:grid;grid-template-columns:1fr 1fr;gap:0">
 <div style="background:#fff;padding:24px;border-right:1px solid #eee;overflow-y:auto;max-height:60vh">
 <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${color};margin-bottom:16px"> Concepts to Learn</div>
 ${conceptsHTML}
 </div>
 <div style="padding:24px;overflow-y:auto;max-height:60vh">
 <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${color};margin-bottom:16px"> Free Resources</div>
 ${resHTML}
 </div>
 </div>`;

 document.getElementById("skillModalClose").onclick = () => {
 document.getElementById("skillModal").style.display = "none";
 };

 document.querySelectorAll(".skill-cb").forEach(cb => {
 cb.addEventListener("change", () => {
 const s = getStored();
 s[cb.dataset.idx] = cb.checked;
 localStorage.setItem(ck, JSON.stringify(s));
 // streak
 prepRecordToday();
 // update label style
 const li = cb.closest(".skill-concept-item");
 if (li) {
 li.classList.toggle("done", cb.checked);
 const span = li.querySelector("span");
 if (span) span.style.textDecoration = cb.checked ? "line-through" : "";
 const lbl = li.querySelector("label");
 if (lbl) lbl.style.color = cb.checked ? "#bbb" : "#333";
 }
 // update progress bar + label in modal
 const ns = getStored();
 const nd = Object.values(ns).filter(Boolean).length;
 const np = allItems.length ? Math.round((nd / allItems.length) * 100) : 0;
 document.getElementById("skillModalBar").style.width = np + "%";
 document.getElementById("skillModalPct").textContent = `${nd} / ${allItems.length} concepts completed (${np}%)`;
 // update roadmap card progress bar without full re-render
 const cardBody = document.querySelector(`.rmc-body [data-rmpkey="${key}"]`);
 const allCards = document.querySelectorAll(".rmc-skill-prog");
 document.querySelectorAll(".rmc").forEach(card => {
 const cb2 = card.querySelector(".rmc-cb");
 if (cb2 && cb2.dataset.key === key) {
 let prog = card.querySelector(".rmc-skill-prog");
 if (!prog && np > 0) {
 const body = card.querySelector(".rmc-body");
 const div = document.createElement("div");
 div.className = "rmc-skill-prog";
 div.innerHTML = `<div class="rmc-skill-fill" style="width:${np}%"></div><span class="rmc-skill-pct">${np}%</span>`;
 body.appendChild(div);
 } else if (prog) {
 const fill = prog.querySelector(".rmc-skill-fill");
 const pctEl = prog.querySelector(".rmc-skill-pct");
 if (fill) fill.style.width = np + "%";
 if (pctEl) pctEl.textContent = np + "%";
 }
 }
 });
 });
 });
 }

 document.getElementById("skillModal").style.display = "block";
 renderModal();
 // Close on backdrop click
 document.getElementById("skillModal").onclick = e => {
 if (e.target === document.getElementById("skillModal")) document.getElementById("skillModal").style.display = "none";
 };
}


