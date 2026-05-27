const CHAT_MODE_KEY = "jobDashboardChatMode";

const state = {
  jobs: [],
  selectedId: null,
  folders: {},
  query: "",
  status: "all",
  source: "all",
  date: todayString(),
  lastRefreshAt: null,
  view: "daily",
  chatMode: localStorage.getItem(CHAT_MODE_KEY) || "open",
  chatMessages: [newChatMessage("assistant", "Ready for portal search.")],
  chatBusy: false,
};

const DAILY_TARGET = 50;

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
  return String(value ?? "")
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
  return /\bapplied\b/i.test(job.status || "");
}

function dailyJobs() {
  return state.jobs.filter((job) => normalizeDate(job.dateFound) === state.date);
}

function baseJobsForView() {
  if (state.view === "applied") return state.jobs.filter(isApplied);
  if (state.view === "all") return state.jobs;
  return dailyJobs();
}

function viewLabel() {
  if (state.view === "applied") return "all applied jobs";
  if (state.view === "all") return "all saved jobs";
  return `jobs for ${formatDate(state.date)}`;
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

function filteredJobs() {
  const q = state.query.trim().toLowerCase();
  const jobs = baseJobsForView().filter((job) => {
    const blob = [
      job.company,
      job.role,
      job.source,
      job.location,
      job.pay,
      job.notes,
      job.jd,
      job.status,
      job.priority,
      job.workAuthRisk,
      job.selectedResume,
      job.generatedResumePath,
      job.resumeUsedPath,
    ]
      .join(" ")
      .toLowerCase();
    const matchesQuery = !q || blob.includes(q);
    const matchesStatus =
      state.status === "all" ||
      (state.status === "not-applied" ? !isApplied(job) : (job.status || "").toLowerCase().includes(state.status.toLowerCase()));
    const matchesSource = state.source === "all" || job.source === state.source;
    return matchesQuery && matchesStatus && matchesSource;
  });
  return jobs.sort((a, b) => {
    if (state.view === "applied") {
      return String(b.dateApplied || b.dateFound || "").localeCompare(String(a.dateApplied || a.dateFound || ""));
    }
    return Number(b.fitScore || 0) - Number(a.fitScore || 0);
  });
}

function renderViewControls() {
  const buttons = {
    daily: $("#dailyViewBtn"),
    applied: $("#appliedViewBtn"),
    all: $("#allJobsViewBtn"),
  };
  Object.entries(buttons).forEach(([view, button]) => {
    button.classList.toggle("active", state.view === view);
  });
  const appliedCount = state.jobs.filter(isApplied).length;
  const totalCount = state.jobs.length;
  const dailyCount = dailyJobs().length;
  const notes = {
    daily: `Showing ${dailyCount} jobs found for ${formatDate(state.date)}.`,
    applied: `Showing ${appliedCount} applied jobs across all dates, with resume and JD details for screening prep.`,
    all: `Showing all ${totalCount} saved jobs across every date.`,
  };
  $("#viewNote").textContent = notes[state.view];
}

function renderDateSummary() {
  const jobs = baseJobsForView();
  const applied = jobs.filter(isApplied).length;
  const notApplied = jobs.length - applied;
  const remaining = Math.max(DAILY_TARGET - applied, 0);
  const progress = Math.min((applied / DAILY_TARGET) * 100, 100);
  const targetCopy = jobs.length > DAILY_TARGET ? `${applied} applied` : `${applied} / ${DAILY_TARGET}`;

  $("#dateFilter").value = state.date;
  $("#dateFilter").disabled = state.view !== "daily";
  $("#todayBtn").disabled = state.view !== "daily";
  $("#targetText").textContent = targetCopy;
  $("#targetFill").style.width = `${progress}%`;
  let statusText = "";
  if (state.view === "applied") {
    const dates = new Set(jobs.map((job) => normalizeDate(job.dateApplied || job.dateFound)).filter(Boolean));
    statusText = `All applied jobs: ${jobs.length} applications across ${dates.size || 0} dates.`;
  } else if (state.view === "all") {
    statusText = `All saved jobs: ${jobs.length} jobs, ${applied} applied, ${notApplied} not applied.`;
  } else {
    const targetNote =
      jobs.length >= DAILY_TARGET
        ? "daily target list ready"
        : `${remaining} more applied jobs to reach 50`;
    statusText = `${formatDate(state.date)}: ${jobs.length} jobs listed, ${applied} applied, ${notApplied} not applied, ${targetNote}.`;
  }
  $("#dayStatus").textContent = statusText;
  $("#refreshStatus").textContent = `Manual web + portal search. Last search: ${formatTime(state.lastRefreshAt)}`;
}

function renderMetrics() {
  const jobs = baseJobsForView();
  const applied = jobs.filter(isApplied).length;
  const notApplied = jobs.length - applied;
  const ready = jobs.filter((job) => /apply-ready|ready/i.test(job.status || "")).length;
  const high = jobs.filter((job) => job.priority === "High").length;
  const generated = jobs.filter((job) => job.generatedResumePath || job.generatedCoverPath).length;
  metrics.innerHTML = [
    [state.view === "daily" ? "Daily Jobs" : "Jobs in View", jobs.length],
    ["Ready", ready],
    ["High Priority", high],
    ["Applied", applied],
    ["Not Applied", notApplied],
    ["Generated", generated],
  ]
    .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderSourceFilter() {
  const current = state.source;
  const sources = [...new Set(baseJobsForView().map((job) => job.source).filter(Boolean))].sort();
  $("#sourceFilter").innerHTML = `<option value="all">All portals</option>${sources
    .map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`)
    .join("")}`;
  $("#sourceFilter").value = sources.includes(current) ? current : "all";
}

function renderRows() {
  const jobs = filteredJobs();
  if (!jobs.some((job) => job.id === state.selectedId)) state.selectedId = jobs[0]?.id || null;
  if (!jobs.length) {
    jobRows.innerHTML = `<tr><td colspan="7"><div class="empty-state">No ${escapeHtml(viewLabel())} with the current filters.</div></td></tr>`;
    renderDetail();
    return;
  }
  jobRows.innerHTML = jobs
    .map((job) => {
      const selected = job.id === state.selectedId ? "selected" : "";
      const pillClass = statusClass(job.status, job.priority);
      const resume = resumeForJob(job);
      const hasJd = Boolean(job.jd || job.jdPath || job.notes);
      return `<tr class="${selected}" data-id="${escapeHtml(job.id)}">
        <td>
          <div class="job-title">${escapeHtml(job.role)}</div>
          <div class="job-meta">${escapeHtml(job.company)} · ${escapeHtml(job.location || "Location not listed")}</div>
          <div class="tiny">${escapeHtml(job.datePosted || job.dateFound || "")}${job.dateApplied ? ` - Applied ${escapeHtml(job.dateApplied)}` : ""}</div>
        </td>
        <td><span class="pill">${escapeHtml(job.source || "Portal")}</span></td>
        <td>${escapeHtml(job.pay || "Not listed")}</td>
        <td><span class="pill ${Number(job.fitScore) >= 80 ? "high" : Number(job.fitScore) >= 65 ? "medium" : ""}">${escapeHtml(job.fitScore || "-")}</span></td>
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
  renderDetail();
}

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

  detailPanel.innerHTML = `<div class="detail-head">
      <div class="pill ${statusClass(job.status, job.priority)}">${escapeHtml(job.status || "Ready")}</div>
      <h2>${escapeHtml(job.role)}</h2>
      <div class="job-meta">${escapeHtml(job.company)} · ${escapeHtml(job.source)} · ${escapeHtml(job.location)}</div>
    </div>
    <div class="detail-actions">
      <button class="button primary" id="openJobLink">Open Job Link</button>
      <button class="button warning" id="generateResumeTop">Generate Tailored Resume</button>
      <button class="button warning" id="generateCoverTop">Generate Cover Letter</button>
      <button class="button success" id="markApplied">Mark Applied</button>
    </div>

    <div class="prep-card">
      <h3>Screening Prep</h3>
      <div class="prep-grid">
        <div class="prep-item"><strong>Applied</strong><span>${escapeHtml(appliedDate)}</span></div>
        <div class="prep-item"><strong>Resume Used</strong><span>${escapeHtml(fileName(resume))}</span></div>
        <div class="prep-item"><strong>Resume Path</strong><span>${escapeHtml(resume || "Generate or select resume before applying")}</span></div>
        <div class="prep-item"><strong>JD</strong><span>${escapeHtml(jdStatus)}</span></div>
        <div class="prep-item"><strong>Job Link</strong><span>${escapeHtml(sourceLink)}</span></div>
      </div>
    </div>

    <div class="detail-grid">
      <div class="field"><label>Pay</label><input id="payInput" class="input" value="${escapeHtml(job.pay)}" /></div>
      <div class="field"><label>Status</label><input id="statusInput" class="input" value="${escapeHtml(job.status)}" /></div>
      <div class="field"><label>Priority</label><select id="priorityInput" class="select">
        ${["High", "Medium", "Low", "Blocked"].map((value) => `<option ${job.priority === value ? "selected" : ""}>${value}</option>`).join("")}
      </select></div>
      <div class="field"><label>Resume Version</label><select id="resumeInput" class="select">
        ${[
          "Candidate_FullStack_NET_Cloud.docx",
          "Candidate_FullStack_NET_Cloud_AI.docx",
          "Candidate_AI_Cloud_Engineer.docx",
        ]
          .map((value) => `<option ${job.selectedResume === value ? "selected" : ""}>${value}</option>`)
          .join("")}
      </select></div>
    </div>

    <div class="field"><label>Work Auth / Risk</label><textarea id="riskInput" class="textarea" rows="3">${escapeHtml(job.workAuthRisk)}</textarea></div>
    <div class="field"><label>Notes</label><textarea id="notesInput" class="textarea" rows="4">${escapeHtml(job.notes)}</textarea></div>
    <div class="field"><label>JD Text</label><textarea id="jdInput" class="textarea" rows="8">${escapeHtml(job.jd)}</textarea></div>

    <div class="detail-actions">
      <button class="button secondary" id="saveJob">Save Changes</button>
      <button class="button warning" id="generateResume">Generate Tailored Resume</button>
      <button class="button warning" id="generateCover">Generate Cover Letter</button>
      <button class="button primary" id="generateBoth">Generate Both</button>
    </div>

    ${job.generatedResumePath ? `<div class="path-box"><strong>Resume:</strong><br>${escapeHtml(job.generatedResumePath)}</div>` : ""}
    ${job.resumeUsedPath ? `<div class="path-box"><strong>Resume used when marked applied:</strong><br>${escapeHtml(job.resumeUsedPath)}</div>` : ""}
    ${job.jdPath ? `<div class="path-box"><strong>JD file:</strong><br>${escapeHtml(job.jdPath)}</div>` : ""}
    ${job.generatedCoverPath ? `<div class="path-box"><strong>Cover letter:</strong><br>${escapeHtml(job.generatedCoverPath)}</div>` : ""}
  `;

  $("#openJobLink").onclick = () => job.url && window.open(job.url, "_blank", "noopener");
  $("#markApplied").onclick = () => markApplied(job.id);
  $("#saveJob").onclick = () => saveDetail(job.id);
  $("#generateResumeTop").onclick = () => generate(job.id, "resume");
  $("#generateCoverTop").onclick = () => generate(job.id, "cover");
  $("#generateResume").onclick = () => generate(job.id, "resume");
  $("#generateCover").onclick = () => generate(job.id, "cover");
  $("#generateBoth").onclick = () => generate(job.id, "all");
}

function currentDetailPatch() {
  return {
    pay: $("#payInput")?.value || "",
    status: $("#statusInput")?.value || "",
    priority: $("#priorityInput")?.value || "Medium",
    selectedResume: $("#resumeInput")?.value || "",
    workAuthRisk: $("#riskInput")?.value || "",
    notes: $("#notesInput")?.value || "",
    jd: $("#jdInput")?.value || "",
  };
}

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
  replaceJob(job);
  toast("Marked applied");
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

function renderAll() {
  renderViewControls();
  renderDateSummary();
  renderMetrics();
  renderSourceFilter();
  renderRows();
  renderChat();
  renderChatWidget();
}

async function load() {
  const [{ jobs }, { appRoot }] = await Promise.all([api("/api/jobs"), api("/api/folders")]);
  state.jobs = jobs.sort((a, b) => Number(b.fitScore || 0) - Number(a.fitScore || 0));
  $("#folderLine").textContent = appRoot;
  renderAll();
}

async function refreshCsv() {
  setBusy(true);
  try {
    const result = await api("/api/find-jobs", { method: "POST" });
    state.lastRefreshAt = new Date().toISOString();
    const activeSources = Object.values(result.sourceBreakdown || {}).filter((count) => count > 0).length;
    toast(`Search complete: ${result.added || 0} added from ${activeSources || 0} sources`);
    await load();
  } finally {
    setBusy(false);
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
    if (response.action === "portal_search" || response.action === "full_search") {
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

function setupEvents() {
  $("#searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderRows();
  });
  $("#statusFilter").addEventListener("change", (event) => {
    state.status = event.target.value;
    renderRows();
  });
  $("#sourceFilter").addEventListener("change", (event) => {
    state.source = event.target.value;
    renderRows();
  });
  $("#dateFilter").addEventListener("change", (event) => {
    state.date = event.target.value || todayString();
    state.source = "all";
    state.selectedId = null;
    renderAll();
  });
  $("#todayBtn").onclick = () => {
    state.date = todayString();
    state.source = "all";
    state.selectedId = null;
    renderAll();
  };
  $("#dailyViewBtn").onclick = () => {
    state.view = "daily";
    state.source = "all";
    state.status = "all";
    state.selectedId = null;
    $("#statusFilter").value = "all";
    renderAll();
  };
  $("#appliedViewBtn").onclick = () => {
    state.view = "applied";
    state.source = "all";
    state.status = "all";
    state.selectedId = null;
    $("#statusFilter").value = "all";
    renderAll();
  };
  $("#allJobsViewBtn").onclick = () => {
    state.view = "all";
    state.source = "all";
    state.status = "all";
    state.selectedId = null;
    $("#statusFilter").value = "all";
    renderAll();
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
load()
  .catch((error) => toast(error.message));
