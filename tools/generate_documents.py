import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor


APP_DIR = Path(__file__).resolve().parents[1]
DATA_PATH = APP_DIR / "data" / "jobs.json"
SOURCE_DIR = Path(r"C:\Users\16605\Documents\Codex\2026-05-13\if-i-upload-resume-will-you")
JOB_ROOT = Path(r"C:\Users\16605\Desktop\job application")
TAILORED_DIR = JOB_ROOT / "resume" / "tailored resume"
COVER_DIR = JOB_ROOT / "cover letters"
JD_DIR = JOB_ROOT / "job descriptions"

sys.path.insert(0, str(SOURCE_DIR))
import build_resume_versions as base  # noqa: E402


def safe_name(value, limit=70):
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", value or "").strip("_")
    return cleaned[:limit] or "Job"


def load_job(job_id):
    jobs = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    for job in jobs:
        if job["id"] == job_id:
            return job
    raise SystemExit(f"Job not found: {job_id}")


def text_blob(job):
    return " ".join(
        str(job.get(key, ""))
        for key in ["company", "role", "source", "location", "employmentType", "notes", "jd", "workAuthRisk"]
    ).lower()


def choose_base(job):
    selected = job.get("selectedResume", "")
    if "AI_Cloud" in selected:
        return base.VERSIONS[2].copy()
    if "Cloud_AI" in selected:
        return base.VERSIONS[1].copy()
    if "FullStack_NET_Cloud" in selected:
        return base.VERSIONS[0].copy()

    blob = text_blob(job)
    if re.search(r"\b(ai|genai|openai|rag|agent|machine learning|azure ai|copilot)\b", blob):
        return base.VERSIONS[1].copy()
    return base.VERSIONS[0].copy()


def keyword_hits(job):
    blob = text_blob(job)
    terms = [
        ("C#", ["c#", "csharp"]),
        (".NET Core", [".net core", "dotnet core", ".net"]),
        ("ASP.NET Web API", ["web api", "asp.net", "api developer"]),
        ("REST APIs", ["rest", "api"]),
        ("Angular", ["angular"]),
        ("Azure", ["azure"]),
        ("Azure OpenAI", ["azure openai", "openai", "genai"]),
        ("RAG", ["rag", "retrieval"]),
        ("SQL Server", ["sql server", "t-sql", "database"]),
        ("CI/CD", ["ci/cd", "devops", "azure devops", "jenkins"]),
        ("Microservices", ["microservice"]),
        ("OAuth2/JWT/RBAC", ["oauth", "jwt", "rbac", "authentication", "authorization"]),
        ("Agile/Scrum", ["agile", "scrum"]),
        ("Python", ["python"]),
        ("React-adjacent frontend", ["react"]),
        ("Cloud deployment", ["cloud", "app services", "functions"]),
    ]
    hits = []
    for label, needles in terms:
        if any(needle in blob for needle in needles):
            hits.append(label)
    return hits[:12]


def tailor_version(job):
    version = choose_base(job)
    company = job.get("company", "Company")
    role = job.get("role", "Role")
    keywords = keyword_hits(job)
    ai_heavy = any(item in keywords for item in ["Azure OpenAI", "RAG", "Python"])
    cloud_heavy = any(item in keywords for item in ["Azure", "Cloud deployment", "CI/CD"])

    role_focus = " | ".join(keywords[:4]) if keywords else ".NET | Azure | API Delivery"
    version["filename"] = f"{job['id']}_{safe_name(company, 32)}_{safe_name(role, 40)}_Venkatesh_Dorolla.docx"
    version["title"] = f"Senior Full Stack .NET Developer | {role_focus}"
    version["summary"] = (
        f"Senior Full Stack .NET Developer with 6+ years of experience delivering enterprise applications, secure APIs, "
        f"Angular front ends, SQL Server data layers, Azure cloud services, and CI/CD automation. Targeted for {company}'s "
        f"{role} role with emphasis on {', '.join(keywords[:8]) if keywords else 'C#, .NET, Angular, Azure, SQL Server, APIs, Agile delivery, and production support'}. "
        "Experienced across public sector, healthcare, insurance, and higher education workflows with strong focus on reliable delivery, "
        "performance tuning, clean architecture, security, and stakeholder-facing systems."
    )

    if ai_heavy:
        version["experience_order"] = ["dotnet", "ai", "cloud", "integration", "bi"]
        version["projects"] = ["rag", "cloud_task", "stock"]
    elif cloud_heavy:
        version["experience_order"] = ["dotnet", "cloud", "integration", "bi", "ai"]
        version["projects"] = ["cloud_task", "stock", "rag"]
    else:
        version["experience_order"] = ["dotnet", "integration", "cloud", "bi", "ai"]
        version["projects"] = ["stock", "cloud_task", "rag"]

    return version


def make_resume(job):
    TAILORED_DIR.mkdir(parents=True, exist_ok=True)
    for temp_file in TAILORED_DIR.glob("~$*.docx"):
        try:
            temp_file.unlink()
        except OSError:
            pass
    base.OUT_DIR = str(TAILORED_DIR)
    original = Path(base.build(tailor_version(job)))
    upload_copy = TAILORED_DIR / f"UPLOAD_{safe_name(job['id'], 28)}_Venkatesh_Dorolla.docx"
    latest_copy = TAILORED_DIR / "UPLOAD_LATEST_TAILORED_RESUME_Venkatesh_Dorolla.docx"
    shutil.copy2(original, upload_copy)
    shutil.copy2(original, latest_copy)
    return upload_copy


def paragraph(doc, text, size=10.5, bold=False, color=None, align=None, after=7):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(after)
    run = p.add_run(text)
    run.bold = bold
    run.font.name = "Calibri"
    run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = color
    return p


def make_cover(job):
    COVER_DIR.mkdir(parents=True, exist_ok=True)
    company = job.get("company", "Hiring Team")
    role = job.get("role", "the role")
    keywords = keyword_hits(job)
    doc = Document()
    section = doc.sections[0]
    section.top_margin = Inches(0.7)
    section.bottom_margin = Inches(0.7)
    section.left_margin = Inches(0.8)
    section.right_margin = Inches(0.8)
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = Pt(10.5)

    paragraph(doc, "Venkatesh Dorolla", size=16, bold=True, color=RGBColor(31, 78, 121), align=WD_ALIGN_PARAGRAPH.CENTER, after=1)
    paragraph(
        doc,
        "+1 (660) 580-5592 | dvenkatesh0081@gmail.com | linkedin.com/in/venkatesh-d369 | Iselin, NJ",
        size=9.5,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        after=12,
    )

    lines = [
        date.today().strftime("%B %d, %Y"),
        f"Hiring Team\n{company}",
        f"Re: {role}",
        (
            f"Dear Hiring Team, I am interested in the {role} opportunity with {company}. "
            f"The role aligns closely with my background in {', '.join(keywords[:7]) if keywords else 'full-stack .NET development, Azure cloud delivery, APIs, Angular, SQL Server, and CI/CD'}."
        ),
        (
            "Across CUNY, NYC Department of Education, Tata Consultancy Services, and Zensar Technologies, I have delivered enterprise "
            "applications using C#, .NET Core, ASP.NET MVC/Web API, Angular, SQL Server, Entity Framework Core, OAuth2/JWT, Azure services, "
            "Azure DevOps, Terraform, Docker, Splunk, and App Insights. My work includes secure API design, responsive UI development, "
            "data integration, SQL optimization, cloud deployment, monitoring, and Agile collaboration."
        ),
        (
            "I am currently authorized to work in the United States on F-1 OPT EAD and am open to remote, hybrid, or onsite work depending "
            "on the role and contract terms."
        ),
        "Sincerely,\nVenkatesh Dorolla",
    ]
    for line in lines:
        paragraph(doc, line)

    out = COVER_DIR / f"{job['id']}_{safe_name(company, 32)}_{safe_name(role, 40)}_Cover_Letter_Venkatesh_Dorolla.docx"
    doc.save(out)
    return out


def save_jd(job):
    JD_DIR.mkdir(parents=True, exist_ok=True)
    out = JD_DIR / f"{job['id']}_{safe_name(job.get('company'), 32)}_{safe_name(job.get('role'), 40)}_JD.txt"
    content = "\n".join(
        [
            f"Job ID: {job.get('id', '')}",
            f"Company: {job.get('company', '')}",
            f"Role: {job.get('role', '')}",
            f"Source: {job.get('source', '')}",
            f"URL: {job.get('url', '')}",
            f"Location: {job.get('location', '')}",
            f"Pay: {job.get('pay', '')}",
            f"Work auth risk: {job.get('workAuthRisk', '')}",
            "",
            "Notes:",
            job.get("notes", ""),
            "",
            "Job description:",
            job.get("jd", ""),
        ]
    )
    out.write_text(content, encoding="utf-8")
    return out


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: generate_documents.py <resume|cover|all> <job_id>")
    kind = sys.argv[1]
    job = load_job(sys.argv[2])
    result = {"jobId": job["id"]}
    if kind in ("resume", "all"):
        result["resumePath"] = str(make_resume(job))
    if kind in ("cover", "all"):
        result["coverPath"] = str(make_cover(job))
    result["jdPath"] = str(save_jd(job))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
