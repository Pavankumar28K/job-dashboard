import argparse
import csv
import html
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote_plus, unquote, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET


APP_DIR = Path(__file__).resolve().parents[1]


def configured_path(env_name, fallback):
    return Path(os.environ.get(env_name, fallback)).expanduser().resolve()


JOB_ROOT = configured_path("JOB_APP_ROOT", Path.home() / "Desktop" / "job application")
CSV_PATH = configured_path("JOB_TRACKER_CSV", JOB_ROOT / "tracker" / "job_tracker.csv")
DASHBOARD_JOBS = configured_path("DASHBOARD_JOBS", APP_DIR / "data" / "jobs.json")
LOG_DIR = APP_DIR / "logs"
LOG_PATH = LOG_DIR / "job_finder.log"
LOCK_PATH = LOG_DIR / "job_finder.lock"

HEADERS = [
    "ID",
    "DateFound",
    "DatePosted",
    "Company",
    "Role",
    "Source",
    "URL",
    "Location",
    "WorkMode",
    "EmploymentType",
    "Pay",
    "FitScore",
    "SelectedResume",
    "Status",
    "Priority",
    "WorkAuthRisk",
    "Notes",
]

QUERIES = [
    ".NET Full Stack Developer Azure Angular",
    "C# .NET Azure Developer",
    "ASP.NET Core Angular Azure",
    "Senior .NET Developer Remote",
    "Full Stack .NET React Azure",
    ".NET Azure OpenAI Developer",
]

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)
RECENT_DAYS = 14
MAX_SOURCE_WORKERS = 8
USER_EXPERIENCE_YEARS = 6
MAX_ACCEPTABLE_REQUIRED_YEARS = 7
INFOSYS_CAREER_API = "https://intapgateway.infosysapps.com/careersci/search/intapjbsrch/getCareerSearchJobs"
MAX_COMPANY_PAGES = 12
JOB_LINK_WORDS = (
    "job",
    "jobs",
    "career",
    "careers",
    "position",
    "positions",
    "opening",
    "openings",
    "opportunity",
    "opportunities",
    "greenhouse",
    "lever",
    "workday",
    "smartrecruiters",
    "ashby",
    "icims",
)
US_LOCATION_TERMS = {
    "united states",
    "usa",
    "u.s.",
    "u.s.a.",
    "us",
}
US_STATE_NAMES = {
    "alabama",
    "alaska",
    "arizona",
    "arkansas",
    "california",
    "colorado",
    "connecticut",
    "delaware",
    "florida",
    "georgia",
    "hawaii",
    "idaho",
    "illinois",
    "indiana",
    "iowa",
    "kansas",
    "kentucky",
    "louisiana",
    "maine",
    "maryland",
    "massachusetts",
    "michigan",
    "minnesota",
    "mississippi",
    "missouri",
    "montana",
    "nebraska",
    "nevada",
    "new hampshire",
    "new jersey",
    "new mexico",
    "new york",
    "north carolina",
    "north dakota",
    "ohio",
    "oklahoma",
    "oregon",
    "pennsylvania",
    "rhode island",
    "south carolina",
    "south dakota",
    "tennessee",
    "texas",
    "utah",
    "vermont",
    "virginia",
    "washington",
    "west virginia",
    "wisconsin",
    "wyoming",
    "district of columbia",
}
US_STATE_ABBRS = {
    "al",
    "ak",
    "az",
    "ar",
    "ca",
    "co",
    "ct",
    "de",
    "fl",
    "ga",
    "hi",
    "id",
    "il",
    "in",
    "ia",
    "ks",
    "ky",
    "la",
    "me",
    "md",
    "ma",
    "mi",
    "mn",
    "ms",
    "mo",
    "mt",
    "ne",
    "nv",
    "nh",
    "nj",
    "nm",
    "ny",
    "nc",
    "nd",
    "oh",
    "ok",
    "or",
    "pa",
    "ri",
    "sc",
    "sd",
    "tn",
    "tx",
    "ut",
    "vt",
    "va",
    "wa",
    "wv",
    "wi",
    "wy",
    "dc",
}
NON_US_LOCATION_TERMS = {
    "argentina",
    "australia",
    "austria",
    "bangalore",
    "belgium",
    "bengaluru",
    "brazil",
    "canada",
    "chile",
    "china",
    "costa rica",
    "denmark",
    "europe",
    "france",
    "germany",
    "global",
    "hyderabad",
    "india",
    "ireland",
    "israel",
    "italy",
    "japan",
    "mexico",
    "netherlands",
    "poland",
    "portugal",
    "romania",
    "singapore",
    "spain",
    "sweden",
    "switzerland",
    "ukraine",
    "united kingdom",
    "worldwide",
}

BING_RSS_SOURCES = [
    ("Wellfound", 'site:wellfound.com/jobs ".NET" developer United States', ("wellfound.com",)),
    ("Glassdoor", 'site:glassdoor.com/job ".NET" developer United States', ("glassdoor.com",)),
    ("College Recruiter", 'site:collegerecruiter.com/job ".NET" developer United States', ("collegerecruiter.com",)),
    ("The Forage", 'site:theforage.com/jobs ".NET" developer United States', ("theforage.com",)),
    ("WayUp", 'site:wayup.com/jobs ".NET" developer United States', ("wayup.com",)),
    ("Kforce", 'site:kforce.com/jobs ".NET" Azure developer United States', ("kforce.com",)),
    ("Vaco", 'site:vaco.com/jobs ".NET" developer United States', ("vaco.com",)),
    ("Insight Global", 'site:insightglobal.com/jobs ".NET" Azure developer United States', ("insightglobal.com",)),
    ("TCS Careers", 'site:tcs.com/careers ".NET" Azure developer United States', ("tcs.com",)),
    ("Infosys Careers", 'site:career.infosys.com ".NET" Azure developer', ("infosys.com", "infosysapps.com")),
    ("Wipro Careers", 'site:wipro.com/careers ".NET" Azure developer United States', ("wipro.com",)),
    ("Capgemini Careers", 'site:capgemini.com/careers ".NET" Azure developer United States', ("capgemini.com",)),
    ("TEKsystems", 'site:teksystems.com ".NET" Azure developer jobs', ("teksystems.com",)),
    ("Akkodis", 'site:akkodis.com ".NET" Azure developer jobs', ("akkodis.com",)),
    ("Robert Half", 'site:roberthalf.com/us/en/jobs ".NET" Azure developer', ("roberthalf.com",)),
    ("Randstad", 'site:randstadusa.com/jobs ".NET" Azure developer', ("randstadusa.com",)),
    ("Apex Systems", 'site:apexsystems.com/job ".NET" Azure developer', ("apexsystems.com",)),
    ("Collabera", 'site:collabera.com ".NET" Azure developer jobs', ("collabera.com",)),
    ("Motion Recruitment", 'site:motionrecruitment.com/tech-jobs ".NET" Azure developer', ("motionrecruitment.com",)),
    ("The Judge Group", 'site:judge.com/jobs ".NET" Azure developer', ("judge.com",)),
    ("Experis", 'site:experis.com ".NET" Azure developer jobs', ("experis.com",)),
    ("Greenhouse", 'site:boards.greenhouse.io ".NET" Azure developer United States', ("boards.greenhouse.io",)),
    ("Lever", 'site:jobs.lever.co ".NET" Azure developer United States', ("jobs.lever.co",)),
    ("Workday", 'site:myworkdayjobs.com ".NET" Azure developer United States', ("myworkdayjobs.com",)),
    ("SmartRecruiters", 'site:careers.smartrecruiters.com ".NET" Azure developer United States', ("smartrecruiters.com",)),
    ("Ashby", 'site:jobs.ashbyhq.com ".NET" Azure developer United States', ("jobs.ashbyhq.com",)),
    ("iCIMS", 'site:icims.com/jobs ".NET" Azure developer United States', ("icims.com",)),
]

PORTAL_ALIASES = {
    "dice": ("Dice",),
    "linkedin": ("LinkedIn",),
    "linked in": ("LinkedIn",),
    "builtin": ("BuiltIn",),
    "built in": ("BuiltIn",),
    "remotive": ("Remotive",),
    "jobicy": ("Jobicy",),
    "himalayas": ("Himalayas",),
    "the muse": ("The Muse",),
    "muse": ("The Muse",),
    "infosys": ("Infosys Careers",),
    "infosys careers": ("Infosys Careers",),
    "career.infosys": ("Infosys Careers",),
    "kforce": ("Kforce",),
    "insight global": ("Insight Global",),
    "insightglobal": ("Insight Global",),
    "insightglobal.com": ("Insight Global",),
    "tcs": ("TCS Careers",),
    "tcs careers": ("TCS Careers",),
    "wipro": ("Wipro Careers",),
    "capgemini": ("Capgemini Careers",),
    "teksystems": ("TEKsystems",),
    "akkodis": ("Akkodis",),
    "robert half": ("Robert Half",),
    "randstad": ("Randstad",),
    "apex": ("Apex Systems",),
    "apex systems": ("Apex Systems",),
    "collabera": ("Collabera",),
    "motion recruitment": ("Motion Recruitment",),
    "judge": ("The Judge Group",),
    "judge group": ("The Judge Group",),
    "experis": ("Experis",),
    "greenhouse": ("Greenhouse",),
    "lever": ("Lever",),
    "workday": ("Workday",),
    "smartrecruiters": ("SmartRecruiters",),
    "smart recruiters": ("SmartRecruiters",),
    "ashby": ("Ashby",),
    "icims": ("iCIMS",),
}


def today():
    return datetime.now().strftime("%Y-%m-%d")


def log(message):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    line = f"{datetime.now().isoformat(timespec='seconds')} {message}"
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def fetch(url, timeout=12):
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Referer": "https://career.infosys.com/joblist",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="ignore")


def clean_text(value):
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalized_source_key(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def source_catalog():
    direct = ["Dice", "LinkedIn", "BuiltIn", "Remotive", "Jobicy", "Himalayas", "The Muse", "Infosys Careers"]
    return direct + [source for source, _query, _domains in BING_RSS_SOURCES]


def selected_sources_for_portal(portal):
    portal = clean_text(portal)
    if not portal:
        return None
    portal_key = normalized_source_key(portal)
    for alias, sources in PORTAL_ALIASES.items():
        alias_key = normalized_source_key(alias)
        if portal_key == alias_key or alias_key in portal_key or portal_key in alias_key:
            return set(sources)
    matches = {
        source
        for source in source_catalog()
        if portal_key in normalized_source_key(source) or normalized_source_key(source) in portal_key
    }
    return matches


def int_value(value):
    try:
        return int(value)
    except Exception:
        return 0


def date_from_epoch_ms(value):
    try:
        return datetime.fromtimestamp(int(value) / 1000).strftime("%Y-%m-%d")
    except Exception:
        return ""


def is_recent_posted(value):
    text = clean_text(value)
    if not text or not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return True
    try:
        posted = datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return True
    return posted >= (datetime.now().date() - timedelta(days=RECENT_DAYS))


def required_experience_years(text):
    clean = clean_text(text).lower()
    clean = re.sub(r"\$[\d,]+(?:\.\d+)?", " ", clean)
    clean = re.sub(r"\b20\d{2}\b", " ", clean)
    years = []
    range_patterns = [
        r"(?<!\d)(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*(?:years?|yrs?)\s+(?:of\s+)?(?:professional\s+)?(?:experience|exp)\b",
        r"(?:experience|exp)\s*[:\-]?\s*(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b",
    ]
    for pattern in range_patterns:
        for match in re.finditer(pattern, clean):
            years.append(int(match.group(1)))

    patterns = [
        r"(?:experience|exp)\s*[:\-]?\s*(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)\b",
        r"(?:at least|minimum(?: of)?|requires?|required|must have|need(?:ed)?|looking for)\D{0,45}(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)\b",
        r"(?<![-\d])(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:professional\s+)?(?:experience|exp)\b",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, clean):
            years.append(int(match.group(1)))
    return max(years) if years else 0


def pretty_company(value):
    text = clean_text(unquote(str(value or "")))
    text = re.sub(r"[_\-]+", " ", text)
    text = re.sub(r"\b(careers?|jobs?|job|us|usa|en)\b", " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" .-/")
    if not text:
        return ""
    known = {
        "tcs": "TCS",
        "wipro": "Wipro",
        "infosys": "Infosys",
        "capgemini": "Capgemini",
        "kforce": "Kforce",
    }
    lowered = text.lower()
    return known.get(lowered, text.title())


def infer_company_from_url(url, source):
    source_company = pretty_company(source.replace("Careers", ""))
    if source not in {"Greenhouse", "Lever", "Workday", "SmartRecruiters", "Ashby", "iCIMS"}:
        return source_company
    try:
        parts = urlsplit(url)
    except Exception:
        return source_company
    host = parts.netloc.lower()
    path_parts = [part for part in parts.path.split("/") if part]
    if ("lever.co" in host or "greenhouse.io" in host or "ashbyhq.com" in host) and path_parts:
        return pretty_company(path_parts[0]) or source_company
    if "smartrecruiters.com" in host and path_parts:
        return pretty_company(path_parts[0]) or source_company
    if "myworkdayjobs.com" in host:
        subdomain = host.split(".")[0]
        return pretty_company(subdomain) or source_company
    return source_company


def json_unescape(value):
    try:
        return json.loads(f'"{value}"')
    except Exception:
        return html.unescape(value.replace(r"\/", "/"))


def canonical_url(value):
    value = str(value or "").strip()
    if not value:
        return ""
    parts = urlsplit(value)
    if "career.infosys.com" in parts.netloc.lower() and parts.query:
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), parts.query, "")).lower()
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), "", "")).lower()


def normalize_input_url(value):
    text = clean_text(value)
    if not text:
        return ""
    if not re.match(r"^https?://", text, flags=re.I):
        text = f"https://{text}"
    return text


def text_key(row):
    return "|".join(clean_text(row.get(key, "")).lower() for key in ("Company", "Role", "Location"))


def load_csv():
    if not CSV_PATH.exists():
        return []
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def save_csv(rows):
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=HEADERS)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in HEADERS})


def next_id(rows, date_value):
    prefix = f"JOB-{date_value.replace('-', '')}-"
    current = 0
    for row in rows:
        job_id = str(row.get("ID", ""))
        if job_id.startswith(prefix):
            try:
                current = max(current, int(job_id.rsplit("-", 1)[1]))
            except ValueError:
                pass
    while True:
        current += 1
        yield f"{prefix}{current:03d}"


def has_hard_block(text):
    lowered = text.lower()
    blocks = [
        "top secret",
        "active secret",
        "secret clearance",
        "ts/sci",
        "u.s. citizen only",
        "us citizen only",
        "citizenship required",
        "must be a us citizen",
        "must be a u.s. citizen",
    ]
    return any(block in lowered for block in blocks)


def is_us_location(location, summary=""):
    location_text = clean_text(location).lower()
    if not location_text:
        return True
    normalized = re.sub(r"[^a-z0-9.]+", " ", location_text)
    tokens = set(re.findall(r"\b[a-z]{2}\b", normalized))
    if any(re.search(rf"\b{re.escape(term)}\b", normalized) for term in US_LOCATION_TERMS):
        return True
    if any(re.search(rf"\b{re.escape(state)}\b", normalized) for state in US_STATE_NAMES):
        return True
    if tokens & US_STATE_ABBRS:
        return True
    if any(re.search(rf"\b{re.escape(term)}\b", normalized) for term in NON_US_LOCATION_TERMS):
        return False

    summary_text = clean_text(summary).lower()
    if re.search(r"\b(united states|usa|u\.s\.|us only|within the us|within u\.s\.)\b", summary_text):
        return True
    return False


def pay_too_low(pay):
    lowered = str(pay or "").lower()
    numbers = [float(match) for match in re.findall(r"(?<!\d)(\d{2,3})(?:\.\d+)?", lowered)]
    if not numbers:
        return False
    high = max(numbers)
    if "hour" in lowered or "/hr" in lowered or "per hour" in lowered:
        return high < 55
    if "year" in lowered or "annual" in lowered:
        return high < 100
    return False


def score_job(title, summary, company="", pay="", work_mode=""):
    text = f"{title} {summary} {company} {work_mode}".lower()
    score = 42
    if re.search(r"\b(\.net|dotnet|c#|asp\.net|net core)\b", text):
        score += 24
    if "full stack" in text or "full-stack" in text or "fullstack" in text:
        score += 12
    if "azure" in text:
        score += 10
    if "angular" in text:
        score += 8
    if "react" in text:
        score += 5
    if "api" in text or "rest" in text or "microservice" in text:
        score += 6
    if "sql" in text:
        score += 5
    if "devops" in text or "ci/cd" in text:
        score += 4
    if re.search(r"\b(ai|openai|genai|rag|machine learning|ml)\b", text):
        score += 7
    if "remote" in text or "remote" in work_mode.lower():
        score += 4
    if pay and not pay_too_low(pay):
        score += 2
    if not re.search(r"\b(\.net|dotnet|c#|asp\.net|net core)\b", text):
        score -= 18
    return max(0, min(95, score))


def selected_resume(title, summary):
    text = f"{title} {summary}".lower()
    if re.search(r"\b(ai|openai|genai|rag|machine learning|ml|copilot)\b", text):
        return "Candidate_FullStack_NET_Cloud_AI.docx"
    if "azure" in text or "cloud" in text:
        return "Candidate_FullStack_NET_Cloud.docx"
    return "Candidate_FullStack_NET_Cloud.docx"


def priority(score, status):
    if "Blocked" in status:
        return "Low"
    if score >= 80:
        return "High"
    if score >= 68:
        return "Medium"
    return "Low"


def build_row(source, url, title, company, location, posted, employment, pay, summary, work_mode):
    title = clean_text(title)
    company = clean_text(company) or "Company not listed"
    location = clean_text(location) or "United States"
    summary = clean_text(summary)
    employment = clean_text(employment)
    pay = clean_text(pay) or "Not listed"
    work_mode = clean_text(work_mode)
    if not is_us_location(location, summary):
        return None, "non_us_location"
    blob = f"{title} {company} {location} {employment} {pay} {summary}"
    required_years = required_experience_years(blob)
    if required_years > MAX_ACCEPTABLE_REQUIRED_YEARS:
        return None, f"requires_{required_years}_years"
    score = score_job(title, summary, company, pay, work_mode)
    if score < 62:
        return None, "low_fit"
    if has_hard_block(blob):
        return None, "hard_block"
    if pay_too_low(pay):
        return None, "low_pay"

    status = "Ready to review"
    risk = "Verify OPT EAD and future sponsorship/support"
    lowered = blob.lower()
    if "no sponsorship" in lowered or "unable to sponsor" in lowered or "cannot sponsor" in lowered:
        risk = "No/limited sponsorship mentioned; OPT EAD now may be ok, future sponsorship risk"
    if "w2" in lowered:
        risk = "W2 mentioned; verify OPT EAD acceptance and future sponsorship/support"

    notes = summary[:420]
    return {
        "DateFound": today(),
        "DatePosted": posted,
        "Company": company,
        "Role": title,
        "Source": source,
        "URL": canonical_url(url) or url,
        "Location": location,
        "WorkMode": work_mode or ("Remote" if "remote" in blob.lower() else "Unknown"),
        "EmploymentType": employment,
        "Pay": pay,
        "FitScore": str(score),
        "SelectedResume": selected_resume(title, summary),
        "Status": status,
        "Priority": priority(score, status),
        "WorkAuthRisk": risk,
        "Notes": notes,
    }, "ok"


def dice_search_urls():
    for query in QUERIES[:5]:
        encoded = quote_plus(query)
        for page in range(1, 3):
            yield (
                "https://www.dice.com/jobs"
                f"?q={encoded}&location=United%20States&filters.postedDate=ONE"
                f"&radius=30&radiusUnit=mi&page={page}&pageSize=20&language=en"
            )


def parse_dice(text):
    jobs = []
    object_pattern = re.compile(
        r'\{\\\"id\\\":\\\"(?P<id>[^\\]+).*?(?=\},\{\\\"id\\\":\\\"|\}\],\\\"meta\\\")',
        re.S,
    )
    for match in object_pattern.finditer(text):
        chunk = match.group(0)

        def get(key):
            field = re.search(r'\\\"' + re.escape(key) + r'\\\":\\\"((?:\\\\.|[^\\])*)\\\"', chunk)
            return json_unescape(field.group(1)) if field else ""

        def get_bool(key):
            field = re.search(r'\\\"' + re.escape(key) + r'\\\":(true|false)', chunk)
            return field.group(1) == "true" if field else False

        workplace = ", ".join(re.findall(r'\\\"workplaceTypes\\\":\[(.*?)\]', chunk)[:1]).replace(r"\"", "")
        location = get("displayName")
        work_mode = "Remote" if get_bool("isRemote") else clean_text(workplace)
        posted = get("postedDate")[:10] or "Today"
        row, reason = build_row(
            "Dice",
            get("detailsPageUrl"),
            get("title"),
            get("companyName"),
            location,
            posted,
            get("employmentType"),
            get("salary"),
            get("summary"),
            work_mode,
        )
        if row:
            jobs.append(row)
    return jobs


def linkedin_search_urls():
    for query in QUERIES[:5]:
        encoded = quote_plus(query)
        for start in (0,):
            yield (
                "https://www.linkedin.com/jobs/search/"
                f"?keywords={encoded}&location=United%20States&f_TPR=r86400&sortBy=DD&start={start}"
            )


def parse_linkedin_detail(text):
    match = re.search(r'<div class="show-more-less-html__markup[^>]*>(.*?)</div>', text, flags=re.S)
    if not match:
        match = re.search(r'<section class="show-more-less-html"[^>]*>(.*?)</section>', text, flags=re.S)
    if not match:
        return ""
    return clean_text(match.group(1))


def parse_linkedin(text):
    jobs = []
    chunks = re.findall(r"<li>(.*?)</li>", text, flags=re.S)
    detail_fetches = 0
    for chunk in chunks:
        if "base-search-card" not in chunk or "/jobs/view/" not in chunk:
            continue

        def find(pattern):
            match = re.search(pattern, chunk, flags=re.S)
            return clean_text(match.group(1)) if match else ""

        url_match = re.search(r'href="(https://www\.linkedin\.com/jobs/view/[^"?]+)', chunk)
        url = url_match.group(1) if url_match else ""
        title = find(r'base-search-card__title[^>]*>(.*?)</h3>')
        company = find(r'base-search-card__subtitle[^>]*>.*?<a[^>]*>(.*?)</a>') or find(
            r'base-search-card__subtitle[^>]*>(.*?)</h4>'
        )
        location = find(r'job-search-card__location[^>]*>(.*?)</span>')
        date_match = re.search(r'<time[^>]*datetime="([^"]+)"', chunk)
        posted = date_match.group(1) if date_match else "LinkedIn recent"
        summary = f"{title} at {company}. Public LinkedIn search result."
        preliminary, reason = build_row(
            "LinkedIn",
            url,
            title,
            company,
            location,
            posted,
            "Not listed",
            "Not listed",
            summary,
            "Remote/Hybrid/Onsite not listed",
        )
        if not preliminary:
            continue
        detail = ""
        if url and detail_fetches < 4:
            detail_fetches += 1
            try:
                detail = parse_linkedin_detail(fetch(url, timeout=5))
                if detail:
                    summary = detail
            except Exception:
                pass
        if not detail:
            continue
        row, reason = build_row(
            "LinkedIn",
            url,
            title,
            company,
            location,
            posted,
            "Not listed",
            "Not listed",
            summary,
            "Remote/Hybrid/Onsite not listed",
        )
        if row:
            jobs.append(row)
    return jobs


def simplyhired_search_urls():
    for query in QUERIES[:4]:
        encoded = quote_plus(query)
        yield f"https://www.simplyhired.com/search?q={encoded}&l=United+States"


def parse_simplyhired(text):
    jobs = []
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', text, re.S)
    if not match:
        return jobs
    data = json.loads(match.group(1))
    for item in data.get("props", {}).get("pageProps", {}).get("jobs", []):
        title = item.get("title", "")
        company = item.get("company", "")
        location = item.get("location", "United States")
        posted = date_from_epoch_ms(item.get("dateOnIndeed")) or "SimplyHired recent"
        if not is_recent_posted(posted):
            continue
        work_mode = ", ".join(item.get("remoteAttributes") or []) or "Remote/Hybrid/Onsite not listed"
        employment = ", ".join(item.get("jobTypes") or []) or "Not listed"
        pay = item.get("salaryInfo", "") or "Not listed"
        skills = (item.get("requirements") or [])[:12] + (item.get("uncategorized") or [])[:18]
        summary = " ".join([item.get("snippet", ""), ", ".join(skills)])
        raw_url = item.get("botUrl") or unquote(item.get("encodedUrl", ""))
        url = urljoin("https://www.simplyhired.com", raw_url)
        row, reason = build_row(
            "SimplyHired",
            url,
            title,
            company,
            location,
            posted,
            employment,
            pay,
            summary,
            work_mode,
        )
        if row:
            jobs.append(row)
    return jobs


def builtin_search_urls():
    queries = [".NET Azure", "C# Azure", ".NET Full Stack", "Azure AI .NET"]
    for query in queries:
        encoded = quote_plus(query)
        yield (
            "https://builtin.com/jobs/dev-engineering"
            f"?search={encoded}&location=United%20States&days_since_posted={RECENT_DAYS}"
        )


def parse_builtin(text):
    jobs = []
    posted_by_id = {
        job_id: posted[:10]
        for job_id, posted in re.findall(r"\{'id':(\d+),'published_date':'([^']+)'", text)
    }
    card_pattern = re.compile(r'<div id="job-card-(?P<id>\d+)".*?(?=<div id="job-card-\d+"|<script|\Z)', re.S)
    for match in card_pattern.finditer(text):
        job_id = match.group("id")
        chunk = match.group(0)
        title_match = re.search(r'<a(?=[^>]*data-id="job-card-title")(?=[^>]*href="(?P<url>[^"]+)")[^>]*>(?P<title>.*?)</a>', chunk, re.S)
        if not title_match:
            continue
        posted = posted_by_id.get(job_id, "BuiltIn recent")
        if not is_recent_posted(posted):
            continue
        company_match = re.search(r'data-id="company-title"[^>]*>.*?<span>(.*?)</span>', chunk, re.S)
        mode_match = re.search(r'<span class="font-barlow text-gray-04">(In-Office or Remote|Remote or Hybrid|In-Office|Hybrid|Remote)</span>', chunk)
        location_match = re.search(r'aria-label="Job locations"[^>]*data-bs-title="([^"]+)"', chunk, re.S)
        if not location_match:
            location_match = re.search(r'fa-location-dot.*?<span[^>]*>(.*?)</span>', chunk, re.S)
        description_match = re.search(r'<div class="fs-sm fw-regular mb-md text-gray-04">(.*?)</div>', chunk, re.S)
        row, reason = build_row(
            "BuiltIn",
            urljoin("https://builtin.com", title_match.group("url")),
            title_match.group("title"),
            company_match.group(1) if company_match else "Company not listed",
            location_match.group(1) if location_match else "United States",
            posted,
            "Not listed",
            "Not listed",
            description_match.group(1) if description_match else title_match.group("title"),
            mode_match.group(1) if mode_match else "Remote/Hybrid/Onsite not listed",
        )
        if row:
            jobs.append(row)
    if jobs:
        return jobs

    for script in re.findall(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', text, re.S):
        try:
            data = json.loads(script)
        except Exception:
            continue
        graph = data.get("@graph", []) if isinstance(data, dict) else []
        for node in graph:
            if not isinstance(node, dict) or node.get("@type") != "ItemList":
                continue
            for item in node.get("itemListElement", []):
                row, reason = build_row(
                    "BuiltIn",
                    item.get("url", ""),
                    item.get("name", ""),
                    "Company not listed",
                    "United States",
                    "BuiltIn recent",
                    "Not listed",
                    "Not listed",
                    item.get("description", ""),
                    "Remote/Hybrid/Onsite not listed",
                )
                if row:
                    jobs.append(row)
    return jobs


def bing_rss_url(query):
    return f"https://www.bing.com/search?format=rss&q={quote_plus(query)}"


def parse_bing_rss(text, source, allowed_domains):
    jobs = []
    root = ET.fromstring(text)
    for item in root.findall(".//item"):
        title = clean_text(item.findtext("title", ""))
        link = clean_text(item.findtext("link", ""))
        description = clean_text(item.findtext("description", ""))
        host = urlsplit(link).netloc.lower()
        if not link or "bing.com" in host or not any(domain in host for domain in allowed_domains):
            continue
        summary = f"{description} Career portal search result; verify posted date before applying."
        row, reason = build_row(
            source,
            link,
            title,
            infer_company_from_url(link, source),
            "United States",
            "Verify on portal",
            "Not listed",
            "Not listed",
            summary,
            "Remote/Hybrid/Onsite not listed",
        )
        if row:
            jobs.append(row)
    return jobs


def infosys_search_urls():
    yield f"{INFOSYS_CAREER_API}?sourceId={quote_plus('1,21')}&searchText=ALL"


def parse_infosys(text):
    jobs = []
    data = json.loads(text)
    if isinstance(data, dict):
        items = data.get("jobs") or data.get("jobList") or data.get("data") or []
    else:
        items = data
    if not isinstance(items, list):
        return jobs

    for item in items:
        if not isinstance(item, dict):
            continue
        min_exp = int_value(item.get("minExperienceLevel"))
        if min_exp > MAX_ACCEPTABLE_REQUIRED_YEARS:
            continue
        max_exp = int_value(item.get("maxExperienceLevel"))
        reference = clean_text(item.get("referenceCode") or item.get("jobReferenceCode") or item.get("requisitionId"))
        source_id = clean_text(item.get("sourceId") or "1")
        if reference:
            job_url = f"https://career.infosys.com/jobdesc?jobReferenceCode={quote_plus(reference)}&sourceId={quote_plus(source_id)}"
        else:
            job_url = "https://career.infosys.com/joblist"
        posted = clean_text(item.get("createdOn") or item.get("postingDate") or "")[:10] or "Infosys recent"
        if not is_recent_posted(posted):
            continue
        location = clean_text(item.get("location") or item.get("city") or "Global")
        title = clean_text(item.get("postingTitle") or item.get("jobTitle") or item.get("roleDesignation"))
        summary_parts = [
            item.get("postingDescription", ""),
            item.get("technicalRequirement", ""),
            item.get("rolesResponsibilities", ""),
            item.get("additionalResponsibility", ""),
            f"Experience: {min_exp}-{max_exp} years" if min_exp or max_exp else "",
        ]
        summary = " ".join(clean_text(part) for part in summary_parts if clean_text(part))
        work_mode = "Remote" if "remote" in f"{location} {summary}".lower() else "Remote/Hybrid/Onsite not listed"
        row, reason = build_row(
            "Infosys Careers",
            job_url,
            title,
            "Infosys",
            location,
            posted,
            clean_text(item.get("roleDesignation") or "Not listed"),
            "Not listed",
            summary,
            work_mode,
        )
        if row:
            jobs.append(row)
    return jobs


def remotive_search_urls():
    for query in (".net azure", "c# azure", ".net full stack"):
        yield f"https://remotive.com/api/remote-jobs?search={quote_plus(query)}"


def parse_remotive(text):
    jobs = []
    data = json.loads(text)
    for item in data.get("jobs", []):
        posted = clean_text(item.get("publication_date", ""))[:10] or "Remotive recent"
        if not is_recent_posted(posted):
            continue
        row, reason = build_row(
            "Remotive",
            item.get("url", ""),
            item.get("title", ""),
            item.get("company_name", ""),
            item.get("candidate_required_location", "Remote"),
            posted,
            item.get("job_type", "Remote"),
            item.get("salary", ""),
            item.get("description", ""),
            "Remote",
        )
        if row:
            jobs.append(row)
    return jobs


def jobicy_search_urls():
    for tag in ("software", "developer", "full-stack"):
        yield f"https://jobicy.com/api/v2/remote-jobs?count=50&tag={quote_plus(tag)}"


def parse_jobicy(text):
    jobs = []
    data = json.loads(text)
    for item in data.get("jobs", []):
        posted = clean_text(item.get("pubDate", ""))[:10] or "Jobicy recent"
        if not is_recent_posted(posted):
            continue
        salary = ""
        if item.get("salaryMin") or item.get("salaryMax"):
            salary = f"{item.get('salaryMin') or ''}-{item.get('salaryMax') or ''}"
        row, reason = build_row(
            "Jobicy",
            item.get("url", ""),
            item.get("jobTitle", ""),
            item.get("companyName", ""),
            item.get("jobGeo", "Remote"),
            posted,
            ", ".join(item.get("jobType") or []),
            salary,
            " ".join([item.get("jobExcerpt", ""), item.get("jobDescription", "")]),
            "Remote",
        )
        if row:
            jobs.append(row)
    return jobs


def himalayas_search_urls():
    for query in (".net azure", "c# azure", ".net full stack"):
        yield f"https://himalayas.app/jobs/api?search={quote_plus(query)}&limit=50"


def parse_himalayas(text):
    jobs = []
    data = json.loads(text)
    for item in data.get("jobs", []):
        posted = clean_text(item.get("pubDate", ""))[:10] or "Himalayas recent"
        if not is_recent_posted(posted):
            continue
        locations = item.get("locationRestrictions") or ["Remote"]
        salary = ""
        if item.get("minSalary") or item.get("maxSalary"):
            salary = f"{item.get('minSalary') or ''}-{item.get('maxSalary') or ''} {item.get('currency') or ''}"
        row, reason = build_row(
            "Himalayas",
            item.get("applicationLink") or item.get("guid", ""),
            item.get("title", ""),
            item.get("companyName", ""),
            ", ".join(locations),
            posted,
            item.get("employmentType", ""),
            salary,
            " ".join([item.get("excerpt", ""), item.get("description", "")]),
            "Remote",
        )
        if row:
            jobs.append(row)
    return jobs


def themuse_search_urls():
    for page in (1, 2):
        yield f"https://www.themuse.com/api/public/jobs?query={quote_plus('.NET Azure')}&page={page}"


def parse_themuse(text):
    jobs = []
    data = json.loads(text)
    for item in data.get("results", []):
        company = (item.get("company") or {}).get("name", "") if isinstance(item.get("company"), dict) else ""
        locations = ", ".join(location.get("name", "") for location in item.get("locations", []) if isinstance(location, dict))
        levels = ", ".join(level.get("name", "") for level in item.get("levels", []) if isinstance(level, dict))
        posted = clean_text(item.get("publication_date", ""))[:10] or "The Muse recent"
        if not is_recent_posted(posted):
            continue
        row, reason = build_row(
            "The Muse",
            item.get("refs", {}).get("landing_page", "") if isinstance(item.get("refs"), dict) else "",
            item.get("name", ""),
            company,
            locations or "United States",
            posted,
            levels,
            "Not listed",
            item.get("contents", ""),
            "Remote/Hybrid/Onsite not listed",
        )
        if row:
            jobs.append(row)
    return jobs


def extract_links(base_url, text):
    links = []
    for raw in re.findall(r'href=["\']([^"\']+)["\']', text, flags=re.I):
        if raw.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        absolute = urljoin(base_url, html.unescape(raw))
        try:
            parts = urlsplit(absolute)
        except Exception:
            continue
        if parts.scheme not in {"http", "https"} or not parts.netloc:
            continue
        links.append(urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, "")))
    return links


def is_job_related_url(url):
    lowered = unquote(url).lower()
    return any(word in lowered for word in JOB_LINK_WORDS)


def is_same_or_ats_domain(url, root_host):
    host = urlsplit(url).netloc.lower()
    root = root_host.lower().removeprefix("www.")
    host_root = host.removeprefix("www.")
    ats_domains = (
        "greenhouse.io",
        "lever.co",
        "myworkdayjobs.com",
        "smartrecruiters.com",
        "ashbyhq.com",
        "icims.com",
        "bamboohr.com",
        "jobvite.com",
        "recruitee.com",
        "workable.com",
    )
    return host_root == root or host_root.endswith(f".{root}") or any(domain in host_root for domain in ats_domains)


def company_name_from_site(url):
    host = urlsplit(url).netloc.lower().removeprefix("www.")
    label = host.split(".")[0]
    return pretty_company(label) or "Company not listed"


def parse_json_ld_jobs(text, page_url, fallback_company):
    jobs = []
    for script in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', text, flags=re.I | re.S):
        try:
            data = json.loads(html.unescape(script).strip())
        except Exception:
            continue
        nodes = data if isinstance(data, list) else [data]
        expanded = []
        for node in nodes:
            if isinstance(node, dict) and isinstance(node.get("@graph"), list):
                expanded.extend(node["@graph"])
            else:
                expanded.append(node)
        for node in expanded:
            if not isinstance(node, dict):
                continue
            node_type = node.get("@type", "")
            if isinstance(node_type, list):
                is_job = any(str(item).lower() == "jobposting" for item in node_type)
            else:
                is_job = str(node_type).lower() == "jobposting"
            if not is_job:
                continue
            organization = node.get("hiringOrganization") or {}
            if isinstance(organization, dict):
                company = organization.get("name") or fallback_company
            else:
                company = fallback_company
            location_values = []
            raw_locations = node.get("jobLocation") or node.get("applicantLocationRequirements") or []
            if isinstance(raw_locations, dict):
                raw_locations = [raw_locations]
            for location in raw_locations if isinstance(raw_locations, list) else []:
                if not isinstance(location, dict):
                    continue
                address = location.get("address") or location
                if isinstance(address, dict):
                    location_values.append(
                        clean_text(
                            ", ".join(
                                str(address.get(key, ""))
                                for key in ("addressLocality", "addressRegion", "addressCountry")
                                if address.get(key)
                            )
                        )
                    )
            location_text = ", ".join(value for value in location_values if value) or "United States"
            row, reason = build_row(
                fallback_company,
                node.get("url") or page_url,
                node.get("title", ""),
                company,
                location_text,
                clean_text(node.get("datePosted", ""))[:10] or "Company site recent",
                node.get("employmentType", "Not listed"),
                clean_text(node.get("baseSalary", "")) or "Not listed",
                node.get("description", ""),
                "Remote/Hybrid/Onsite not listed",
            )
            if row:
                jobs.append(row)
    return jobs


def parse_company_page_jobs(text, page_url, fallback_company):
    jobs = parse_json_ld_jobs(text, page_url, fallback_company)
    if jobs:
        return jobs
    page_title = ""
    title_match = re.search(r"<title[^>]*>(.*?)</title>", text, flags=re.I | re.S)
    if title_match:
        page_title = clean_text(title_match.group(1))
    if not re.search(r"\b(developer|engineer|architect|\.net|software|full.?stack|angular|c#)\b", page_title, flags=re.I):
        heading = re.search(r"<h1[^>]*>(.*?)</h1>", text, flags=re.I | re.S)
        page_title = clean_text(heading.group(1)) if heading else page_title
    if not re.search(r"\b(developer|engineer|architect|\.net|software|full.?stack|angular|c#)\b", page_title, flags=re.I):
        return jobs
    page_text = clean_text(text)
    row, reason = build_row(
        fallback_company,
        page_url,
        page_title,
        fallback_company,
        "United States" if is_us_location("United States", page_text) else "",
        "Verify on company site",
        "Not listed",
        "Not listed",
        page_text[:2000],
        "Remote/Hybrid/Onsite not listed",
    )
    if row:
        jobs.append(row)
    return jobs


def collect_company_site(company_url):
    start_url = normalize_input_url(company_url)
    root_host = urlsplit(start_url).netloc
    company = company_name_from_site(start_url)
    candidates = []
    failures = []
    seen_pages = set()
    queue = [start_url]
    requests = 0
    while queue and requests < MAX_COMPANY_PAGES:
        current = queue.pop(0)
        key = canonical_url(current)
        if key in seen_pages:
            continue
        seen_pages.add(key)
        try:
            page = fetch(current, timeout=12)
            requests += 1
        except Exception as error:
            failures.append(f"{current} failed: {str(error)[:120]}")
            continue
        candidates.extend(parse_company_page_jobs(page, current, company))
        for link in extract_links(current, page):
            link_key = canonical_url(link)
            if link_key in seen_pages or link in queue:
                continue
            if is_same_or_ats_domain(link, root_host) and is_job_related_url(link):
                queue.append(link)
        queue = queue[:MAX_COMPANY_PAGES]
    return candidates, failures, {company: len(candidates)}, requests


def source_requests(selected_sources=None):
    def allowed(source):
        return selected_sources is None or source in selected_sources

    if allowed("Dice"):
        for url in dice_search_urls():
            yield "Dice", url, parse_dice
    if allowed("LinkedIn"):
        for url in linkedin_search_urls():
            yield "LinkedIn", url, parse_linkedin
    if allowed("BuiltIn"):
        for url in builtin_search_urls():
            yield "BuiltIn", url, parse_builtin
    if allowed("Remotive"):
        for url in remotive_search_urls():
            yield "Remotive", url, parse_remotive
    if allowed("Jobicy"):
        for url in jobicy_search_urls():
            yield "Jobicy", url, parse_jobicy
    if allowed("Himalayas"):
        for url in himalayas_search_urls():
            yield "Himalayas", url, parse_himalayas
    if allowed("The Muse"):
        for url in themuse_search_urls():
            yield "The Muse", url, parse_themuse
    if allowed("Infosys Careers"):
        for url in infosys_search_urls():
            yield "Infosys Careers", url, parse_infosys
    for source, query, allowed_domains in BING_RSS_SOURCES:
        if allowed(source):
            yield source, bing_rss_url(query), lambda text, source=source, allowed_domains=allowed_domains: parse_bing_rss(text, source, allowed_domains)


def collect_candidates(selected_sources=None):
    candidates = []
    failures = []
    source_counts = {}
    requests = list(source_requests(selected_sources))
    with ThreadPoolExecutor(max_workers=MAX_SOURCE_WORKERS) as executor:
        futures = {
            executor.submit(fetch, url): (source, url, parser)
            for source, url, parser in requests
        }
        for future in as_completed(futures):
            source, url, parser = futures[future]
            try:
                page = future.result()
                parsed = parser(page)
                candidates.extend(parsed)
                source_counts[source] = source_counts.get(source, 0) + len(parsed)
            except Exception as error:
                failures.append(f"{source} failed: {str(error)[:160]}")
    return candidates, failures, source_counts, len(requests)


def merge_dashboard(rows):
    if not DASHBOARD_JOBS.exists():
        return 0, 0
    try:
        existing = json.loads(DASHBOARD_JOBS.read_text(encoding="utf-8-sig"))
    except Exception:
        return 0, 0
    by_id = {item.get("id"): item for item in existing}
    by_url = {canonical_url(item.get("url")): item for item in existing if item.get("url")}
    by_text = {
        "|".join(clean_text(item.get(key, "")).lower() for key in ("company", "role", "location")): item
        for item in existing
    }
    added = 0
    updated = 0
    for row in rows:
        key_url = canonical_url(row.get("URL"))
        key_text = text_key(row)
        item = by_id.get(row.get("ID")) or by_url.get(key_url) or by_text.get(key_text)
        patch = {
            "id": row.get("ID"),
            "dateFound": row.get("DateFound"),
            "datePosted": row.get("DatePosted"),
            "company": row.get("Company"),
            "role": row.get("Role"),
            "source": row.get("Source"),
            "url": row.get("URL"),
            "location": row.get("Location"),
            "workMode": row.get("WorkMode"),
            "employmentType": row.get("EmploymentType"),
            "pay": row.get("Pay"),
            "fitScore": int(row.get("FitScore") or 0),
            "selectedResume": row.get("SelectedResume"),
            "status": row.get("Status"),
            "priority": row.get("Priority"),
            "workAuthRisk": row.get("WorkAuthRisk"),
            "notes": row.get("Notes"),
        }
        if item:
            for preserve in ("jd", "jdPath", "generatedResumePath", "generatedCoverPath", "resumeUsedPath", "dateApplied"):
                patch[preserve] = item.get(preserve, "")
            patch["id"] = item.get("id") or patch["id"]
            item.update(patch)
            updated += 1
        else:
            patch.update({"jd": "", "jdPath": "", "generatedResumePath": "", "generatedCoverPath": "", "resumeUsedPath": "", "dateApplied": ""})
            existing.append(patch)
            by_id[patch["id"]] = patch
            if key_url:
                by_url[key_url] = patch
            by_text[key_text] = patch
            added += 1
    DASHBOARD_JOBS.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    return added, updated


def main():
    parser = argparse.ArgumentParser(description="Find jobs for the local dashboard")
    parser.add_argument("--portal", default="", help="Optional portal/source name to search, such as Infosys or Dice")
    parser.add_argument("--company-url", default="", help="Optional company careers or website URL to scan for jobs")
    args = parser.parse_args()
    selected_sources = selected_sources_for_portal(args.portal)
    started = time.time()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if args.portal and not selected_sources:
        summary = {
            "date": today(),
            "portal": args.portal,
            "selectedSources": [],
            "candidates": 0,
            "added": 0,
            "duplicatesSkipped": 0,
            "failures": [f"Unknown portal: {args.portal}"],
            "requestsSearched": 0,
            "sourceBreakdown": {},
            "dashboardAdded": 0,
            "dashboardUpdated": 0,
            "seconds": round(time.time() - started, 2),
            "csv": str(CSV_PATH),
        }
        print(json.dumps(summary, indent=2))
        return
    if LOCK_PATH.exists() and time.time() - LOCK_PATH.stat().st_mtime < 15 * 60:
      summary = {
          "date": today(),
          "portal": args.portal,
          "selectedSources": sorted(selected_sources or []),
          "candidates": 0,
          "added": 0,
          "duplicatesSkipped": 0,
          "failures": ["Skipped because a previous job finder run is still active"],
          "requestsSearched": 0,
          "sourceBreakdown": {},
          "dashboardAdded": 0,
          "dashboardUpdated": 0,
          "seconds": 0,
          "csv": str(CSV_PATH),
      }
      print(json.dumps(summary, indent=2))
      return
    LOCK_PATH.write_text(str(datetime.now().isoformat()), encoding="utf-8")
    try:
        date_value = today()
        rows = load_csv()
        id_gen = next_id(rows, date_value)
        seen_urls = {canonical_url(row.get("URL")) for row in rows if row.get("URL")}
        seen_text = {text_key(row) for row in rows if row.get("Company") or row.get("Role")}
        if args.company_url:
            candidates, failures, source_counts, requests_searched = collect_company_site(args.company_url)
        else:
            candidates, failures, source_counts, requests_searched = collect_candidates(selected_sources)

        added_rows = []
        duplicate_count = 0
        for row in candidates:
            key_url = canonical_url(row.get("URL"))
            key_text = text_key(row)
            if key_url in seen_urls or key_text in seen_text:
                duplicate_count += 1
                continue
            row["ID"] = next(id_gen)
            rows.append(row)
            added_rows.append(row)
            if key_url:
                seen_urls.add(key_url)
            if key_text:
                seen_text.add(key_text)

        save_csv(rows)
        dashboard_added, dashboard_updated = merge_dashboard(added_rows)
        summary = {
            "date": date_value,
            "portal": args.portal,
            "companyUrl": args.company_url,
            "selectedSources": sorted(selected_sources or []),
            "candidates": len(candidates),
            "added": len(added_rows),
            "duplicatesSkipped": duplicate_count,
            "failures": failures[:8],
            "requestsSearched": requests_searched,
            "sourceBreakdown": dict(sorted(source_counts.items())),
            "dashboardAdded": dashboard_added,
            "dashboardUpdated": dashboard_updated,
            "seconds": round(time.time() - started, 2),
            "csv": str(CSV_PATH),
        }
        log(json.dumps(summary))
        print(json.dumps(summary, indent=2))
    finally:
        try:
            LOCK_PATH.unlink(missing_ok=True)
        except Exception:
            pass


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log(f"ERROR {exc}")
        raise
