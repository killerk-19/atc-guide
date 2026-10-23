"use strict";

// Single-file vanilla app: hash router, one JSON data file, inputs kept only in
// this browser (localStorage). No network calls besides fetching our own files.
// CSP forbids inline handlers, so every interaction goes through the delegated
// listeners at the bottom (data-action / data-field attributes).

const VERSION = "1.1.1";
const STORE_KEY = "atcg.profile.v1";
const CHECK_KEY = "atcg.checklist.v1";

const state = { data: null, profile: null, checks: {} };

// ---- helpers ---------------------------------------------------------------

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function shekel(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Number(n).toLocaleString("he-IL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `<span class="num">₪${v}</span>`;
}

function num(n, digits = 1) {
  return `<span class="num">${Number(n).toLocaleString("he-IL", { maximumFractionDigits: digits })}</span>`;
}

function storage(key) {
  return {
    load() { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } },
    save(v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } },
    clear() { try { localStorage.removeItem(key); } catch { /* storage blocked */ } },
  };
}
const profileStore = storage(STORE_KEY);
const checkStore = storage(CHECK_KEY);

// ---- dates -----------------------------------------------------------------

function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addYears(d, years) {
  const r = new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
  if (r.getMonth() !== d.getMonth()) r.setDate(0); // 29 Feb → 28 Feb
  return r;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function yearsBetween(a, b) {
  let y = b.getFullYear() - a.getFullYear();
  if (addYears(a, y) > b) y -= 1;
  const anchor = addYears(a, y);
  const next = addYears(a, y + 1);
  return y + (b - anchor) / (next - anchor);
}

function fmtDate(d) {
  return `<span class="num">${d.toLocaleDateString("he-IL")}</span>`;
}

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function until(d) {
  const days = daysBetween(today(), d);
  if (days < 0) return "עבר";
  if (days === 0) return "היום";
  if (days === 1) return "מחר";
  if (days < 60) return `בעוד ${days} ימים`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `בעוד ${months} חודשים`;
  const y = Math.floor(months / 12), m = months % 12;
  return m ? `בעוד ${y} שנים ו-${m} חודשים` : `בעוד ${y} שנים`;
}

function nextCorrectionDeadline() {
  const t = today();
  return t.getDate() <= 10
    ? new Date(t.getFullYear(), t.getMonth(), 10)
    : new Date(t.getFullYear(), t.getMonth() + 1, 10);
}

// ---- model -----------------------------------------------------------------

const STATUSES = {
  auto: "לפי הוותק (אמ2 עד קביעות)",
  amach: "אמ\"ח",
  kavua: "קבוע",
};

function model() {
  const p = state.profile;
  if (!p) return null;
  const start = parseDate(p.startDate);
  if (!start) return null;
  const t = today();
  const tenure = Math.max(0, yearsBetween(start, t));
  const stages = state.data.stages;
  let stage = tenure >= 5 ? 2 : tenure >= 2 ? 1 : 0;
  if (p.status === "kavua") stage = 2;
  const grade = Number(p.grade) || null;
  const idf = Number(p.idfYears) || 0;
  const recognized = Number(p.recognizedYears) || 0;
  return {
    p, start, tenure, stage, grade, idf, recognized,
    stageDate: (i) => addYears(start, stages[i].from_years),
    nextGrade: parseDate(p.nextGradeDate),
    nights: Math.max(0, Number(p.nightShifts) || 0),
    kids: !!p.hasChildren,
    status: p.status || "auto",
  };
}

// Index of the first stage where the benefit applies, or -1.
function firstStage(b) {
  return b.stages.indexOf(true);
}

function benefitStatus(b, m) {
  if (b.requires === "children" && m && !m.kids) return { cls: "no", text: "להורים בלבד" };
  const first = firstStage(b);
  if (first < 0) return { cls: "no", text: "לידיעה" };
  if (!m) return { cls: "ok", text: first === 0 ? "מההתחלה" : state.data.stages[first].name };
  const amachNow = b.key === "hityaalut" && m.status === "amach";
  if (b.stages[m.stage] || amachNow) return { cls: "ok", text: "מגיע לך" };
  const when = m.stageDate(first);
  return { cls: "warn", text: `${until(when)} (${when.toLocaleDateString("he-IL")})` };
}

function rechevLevel(grade) {
  if (!grade) return null;
  return state.data.rechev_levels.levels.find((l) => grade >= l.grades[0] && grade <= l.grades[1]) || null;
}

function rechevMonthly(l) {
  return l.kavuot_service + l.kavuot_net + (l.km * state.data.rechev_levels.km_rate) / 12;
}

function havraaDays(years) {
  const y = Math.floor(years);
  const row = state.data.havraa_days.table.find(([lo, hi]) => y >= lo && y <= hi);
  return row ? row[2] : state.data.havraa_days.table[0][2];
}

function shiftBonusDays(nights) {
  const b = state.data.havraa_days.shift_bonus;
  return Math.min(b.max_days, Math.floor(nights / b.per_nights));
}

// Next date a periodic payment lands (money on the 1st after the slip month),
// and whether the colleague will have the tenure by then.
function nextPayment(pm, m) {
  const t = today();
  let d = new Date(t.getFullYear(), pm.slip_month, 1); // month index = slip month + 1
  if (d < t) d = new Date(t.getFullYear() + 1, pm.slip_month, 1);
  if (m) {
    const eligibleFrom = addYears(m.start, pm.min_years);
    while (d < eligibleFrom) d = new Date(d.getFullYear() + 1, pm.slip_month, 1);
  }
  return d;
}

// ---- shared fragments --------------------------------------------------------

function disputedBlock(key) {
  const d = state.data.disputed[key];
  if (!d) return "";
  return `<details class="disputed">
      <summary><span class="badge warn">לא מאושר</span> ${esc(d.title)}</summary>
      <ul>${d.readings.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      <p class="muted">${esc(d.advice)}</p>
    </details>`;
}

function needProfile(what) {
  return `<div class="card hint"><p>כדי לראות ${esc(what)} — <a href="#/">הזינו את הפרטים שלכם בדף הבית</a>.</p></div>`;
}

// ---- pages -----------------------------------------------------------------

function profileForm() {
  const p = state.profile || {};
  const opt = (v, label) => `<option value="${v}"${(p.status || "auto") === v ? " selected" : ""}>${esc(label)}</option>`;
  return `<form class="card form" id="profile-form" data-action="save-profile" novalidate>
      <h2>הפרטים שלי</h2>
      <p class="muted">נשמרים רק בדפדפן הזה. אפשר למחוק בכל רגע.</p>
      <label>תאריך תחילת עבודה ברש"ת
        <input type="date" name="startDate" required value="${esc(p.startDate || "")}">
        <small>קובע את שלב הזכאויות ואת הקביעות.</small>
      </label>
      <div class="row">
        <label>דרגה נוכחית
          <input type="number" name="grade" min="15" max="30" inputmode="numeric" value="${esc(p.grade || "")}">
        </label>
        <label>מעמד
          <select name="status">${Object.entries(STATUSES).map(([v, l]) => opt(v, l)).join("")}</select>
        </label>
      </div>
      <label>תאריך צפוי לדרגה הבאה <span class="muted">(לא חובה)</span>
        <input type="date" name="nextGradeDate" value="${esc(p.nextGradeDate || "")}">
      </label>
      <div class="row">
        <label>שנות שירות חובה
          <input type="number" name="idfYears" min="0" max="10" step="0.5" inputmode="decimal" value="${esc(p.idfYears ?? "")}">
        </label>
        <label>שנות ותק מוכר
          <input type="number" name="recognizedYears" min="0" max="40" step="0.5" inputmode="decimal" value="${esc(p.recognizedYears ?? "")}">
        </label>
      </div>
      <label>משמרות לילה בשנה הקודמת <span class="muted">(לימי הבראה נוספים)</span>
        <input type="number" name="nightShifts" min="0" max="366" inputmode="numeric" value="${esc(p.nightShifts ?? "")}">
      </label>
      <label class="check"><input type="checkbox" name="hasChildren"${p.hasChildren ? " checked" : ""}> יש לי ילדים (מעונות, קייטנות)</label>
      <p class="error" id="form-error" hidden>צריך תאריך תחילת עבודה תקין.</p>
      <div class="actions">
        <button type="submit" class="primary">שמירה</button>
        ${state.profile ? `<button type="button" class="ghost" data-action="clear-profile">מחיקת הפרטים</button>` : ""}
      </div>
    </form>`;
}

function countdownTiles(m) {
  const tiles = [];
  const dl = nextCorrectionDeadline();
  tiles.push({ label: "תיקון טיוטת נוכחות", date: dl, note: "עד ה-10 לחודש" });
  if (m) {
    if (m.stage < 1) tiles.push({ label: "שנתיים ותק", date: m.stageDate(1), note: "רוב ההטבות נפתחות" });
    if (m.stage < 2) tiles.push({ label: "קביעות", date: m.stageDate(2), note: "5 שנות ותק" });
    if (m.nextGrade && m.nextGrade >= today()) tiles.push({ label: `דרגה ${m.grade ? m.grade + 1 : "הבאה"}`, date: m.nextGrade, note: "לפי מה שהזנת" });
    const pays = state.data.periodic
      .filter((pm) => pm.min_years < 25)
      .map((pm) => ({ pm, d: nextPayment(pm, m) }))
      .sort((a, b) => a.d - b.d);
    if (pays.length) tiles.push({ label: pays[0].pm.name, date: pays[0].d, note: "התשלום השנתי הבא" });
  }
  return `<div class="tiles">${tiles.map((t) => `
      <div class="tile">
        <div class="tile-label">${esc(t.label)}</div>
        <div class="tile-big">${esc(until(t.date))}</div>
        <div class="tile-note">${fmtDate(t.date)} · ${esc(t.note)}</div>
      </div>`).join("")}</div>`;
}

const pages = {
  home() {
    const m = model();
    const d = state.data;
    const intro = `<div class="card">
        <p>${esc(d.meta.audience)}.</p>
        <p>כאן תמצאו מתי מגיעים לכל שלב, אילו זכויות מגיעות בכל שלב, לוח התשלומים השנתיים,
           הקרנות, וכללי המשמרות והשעות הנוספות.</p>
      </div>`;
    if (!m) {
      return `<h1>ברוכים הבאים</h1>${intro}${profileForm()}${countdownTiles(null)}`;
    }
    const st = d.stages[m.stage];
    return `<h1>שלום 👋</h1>
      <div class="card summary">
        <div><span class="muted">ותק אצל המעסיק</span><strong>${num(m.tenure)} שנים</strong></div>
        <div><span class="muted">שלב זכאויות</span><strong>${esc(st.name)}</strong></div>
        ${m.grade ? `<div><span class="muted">דרגה</span><strong>${num(m.grade, 0)}</strong></div>` : ""}
      </div>
      ${countdownTiles(m)}
      <div class="card links">
        <a href="#/milestones">אבני הדרך שלי ←</a>
        <a href="#/benefits">מה מגיע לי ←</a>
        <a href="#/payments">תשלומים וקרנות ←</a>
        <button type="button" class="ghost" data-action="ics">📅 הוספה ליומן</button>
      </div>
      <details class="card"><summary>עריכת הפרטים שלי</summary>${profileForm()}</details>`;
  },

  milestones() {
    const m = model();
    const d = state.data;
    if (!m) {
      return `<h1>אבני דרך</h1>
        <div class="card"><p>${esc(d.stage_note)}</p></div>
        ${stageList(null)}${needProfile("את התאריכים שלכם")}`;
    }
    const items = [
      { date: m.start, title: "תחילת עבודה ברש\"ת", text: d.stages[0].name },
      { date: m.stageDate(1), title: "שנתיים ותק", text: "נפתחים: הסכם 91/92, משכורת י\"ג, ביגוד, הבראה, פריון, גמול השתלמות תעופתי, קרן השתלמות, קופת גמל, ביטוחי שיניים ובריאות." },
      { date: m.stageDate(2), title: "קביעות — 5 שנות ותק", text: "מעמד קבוע; נכנסת תוספת התייעלות 3%." },
    ];
    if (m.nextGrade) {
      const g = m.grade ? m.grade + 1 : null;
      const notes = [];
      const cur = rechevLevel(m.grade), nxt = rechevLevel(g);
      if (g && cur && nxt && cur.level !== nxt.level) notes.push(`אחזקת רכב עולה מרמה ${cur.level} לרמה ${nxt.level}.`);
      if (g === 23) notes.push("הטמעת פריון 95 עוברת לאחוזים (8% משכר היסוד).");
      notes.push("שכר היסוד עולה לפי טבלת הדרגות.");
      items.push({ date: m.nextGrade, title: g ? `דרגה ${g}` : "הדרגה הבאה", text: notes.join(" ") });
    }
    items.push({ date: addYears(m.start, Math.max(0, Math.ceil(25 - m.idf))), title: "מענק יובל (משוער)", text: "25 שנות עבודה בארגון מזכה, כולל שירות חובה. משוער לפי שנות השירות שהזנת." });
    items.sort((a, b) => a.date - b.date);
    const t = today();
    return `<h1>אבני דרך</h1>
      <div class="card"><p>${esc(d.stage_note)}</p></div>
      <ol class="timeline">${items.map((it) => `
        <li class="${it.date <= t ? "past" : ""}">
          <div class="tl-date">${fmtDate(it.date)} <span class="muted">· ${esc(until(it.date))}</span></div>
          <div class="tl-title">${esc(it.title)}</div>
          <div class="tl-text">${esc(it.text)}</div>
        </li>`).join("")}
      </ol>
      ${m.nextGrade ? "" : `<div class="card hint"><p>הזינו בדף הבית את התאריך הצפוי לדרגה הבאה כדי לראות אותו כאן.</p></div>`}
      <button type="button" class="primary wide" data-action="ics">📅 הוספת אבני הדרך והתשלומים ליומן</button>
      ${stageList(m)}`;
  },

  benefits() {
    const m = model();
    const d = state.data;
    const groups = Object.entries(d.benefit_groups).map(([g, title]) => {
      const rows = d.benefits.filter((b) => b.group === g).map((b) => {
        const s = benefitStatus(b, m);
        const extra = b.grade_rule && m && m.grade >= b.grade_rule.from_grade ? `<p class="muted">${esc(b.grade_rule.text)}</p>` : "";
        return `<div class="benefit">
            <div class="benefit-head"><strong>${esc(b.name)}</strong><span class="badge ${s.cls}">${esc(s.text)}</span></div>
            <div class="dots" aria-label="לפי שלב">${b.stages.map((on, i) => `<span class="${on ? "on" : ""}" title="${esc(d.stages[i].name)}">${on ? "✓" : "–"}</span>`).join("")}</div>
            <p>${esc(b.text)}</p>${extra}
            ${b.details ? `<ul class="details">${b.details.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
            ${b.link && /^https:\/\//.test(b.link.href) ? `<p><a href="${esc(b.link.href)}" target="_blank" rel="noopener noreferrer">${esc(b.link.label)}</a></p>` : ""}
            ${b.disputed ? disputedBlock(b.disputed) : ""}
          </div>`;
      }).join("");
      return `<section class="card"><h2>${esc(title)}</h2>${rows}</section>`;
    }).join("");
    return `<h1>זכויות לפי שלב</h1>
      ${m ? "" : needProfile("מה מגיע לכם עכשיו")}
      <div class="card legend">
        <p>שלושת הסימנים בכל הטבה: ${d.stages.map((s) => esc(s.name)).join(" · ")}.</p>
        <p class="muted">${esc(d.not_for_shift_workers_note)} (${d.not_for_shift_workers.map(esc).join(", ")})</p>
      </div>
      ${groups}`;
  },

  payments() {
    const m = model();
    const d = state.data;
    const t = today();
    const rows = d.periodic.map((pm) => {
      const next = nextPayment(pm, m);
      const amount = pm.amount != null ? shekel(pm.amount) : pm.day_rate ? `${shekel(pm.day_rate)} ליום` : "משתנה";
      return `<tr>
          <td>${esc(MONTHS[pm.slip_month - 1])}</td>
          <td>${esc(pm.name)}${pm.min_years >= 25 ? ` <span class="muted">(25 שנה)</span>` : pm.min_years ? ` <span class="muted">(משנתיים)</span>` : ""}</td>
          <td>${amount}</td>
          <td>${m && pm.min_years < 25 ? fmtDate(next) : esc(pm.paid)}</td>
        </tr>`;
    }).join("");

    // הבראה — both readings, side by side.
    let havraa = "";
    const hd = d.havraa_days;
    const rate = d.periodic.find((p) => p.key === "havraa").day_rate;
    if (m) {
      const site = m.tenure + m.idf + m.recognized;
      const slips = m.tenure + m.recognized;
      const bonus = shiftBonusDays(m.nights);
      const daysA = havraaDays(site), daysB = havraaDays(slips);
      const eligible = m.stage >= 1;
      havraa = `<div class="compare">
          <div><span class="muted">לפי האתר (כולל צבא): ${num(site)} שנים</span><strong>${daysA}+${bonus} ימים</strong>${shekel((daysA + bonus) * rate)}</div>
          <div><span class="muted">לפי התלושים (בלי צבא): ${num(slips)} שנים</span><strong>${daysB}+${bonus} ימים</strong>${shekel((daysB + bonus) * rate)}</div>
        </div>
        ${eligible ? "" : `<p class="muted">עדיין לפני שנתיים ותק — ההבראה תתחיל ב-${m.stageDate(1).toLocaleDateString("he-IL")}.</p>`}`;
    }
    const counter = `<label class="inline">משמרות לילה בשנה הקודמת
        <input type="number" min="0" max="366" inputmode="numeric" data-field="nightShifts" value="${esc(state.profile?.nightShifts ?? "")}">
      </label>
      <p>${esc(hd.shift_bonus.text)} ${m ? `<strong>לך: ${shiftBonusDays(m.nights)} ימים נוספים.</strong>` : ""}</p>`;

    const myLevel = m ? rechevLevel(m.grade) : null;
    const rechev = d.rechev_levels.levels.map((l) => `<tr class="${myLevel === l ? "mine" : ""}">
        <td>${esc(l.level)}</td>
        <td class="num">${l.grades[1] >= 99 ? `${l.grades[0]}+` : l.grades[0] === l.grades[1] ? l.grades[0] : `${l.grades[0]}–${l.grades[1]}`}</td>
        <td>${shekel(l.kavuot_service)}</td><td>${shekel(l.kavuot_net)}</td>
        <td class="num">${l.km.toLocaleString("he-IL")}</td><td>${shekel(rechevMonthly(l))}</td>
      </tr>`).join("");

    const funds = d.benefits.filter((b) => b.group === "funds").map((b) => {
      const s = benefitStatus(b, m);
      return `<div class="benefit">
          <div class="benefit-head"><strong>${esc(b.name)}</strong><span class="badge ${s.cls}">${esc(s.text)}</span></div>
          <p>${esc(b.text)}</p>${b.disputed ? disputedBlock(b.disputed) : ""}
        </div>`;
    }).join("");

    return `<h1>תשלומים שנתיים וקרנות</h1>
      <section class="card">
        <h2>לוח שנתי</h2>
        <div class="scroll"><table>
          <thead><tr><th>תלוש</th><th>מה</th><th>סכום ${esc(d.meta.tariff_year)}</th><th>${m ? "הבא אצלך" : "משולם"}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="muted">${esc(d.periodic_note)}</p>
      </section>
      <section class="card">
        <h2>כמה הבראה מגיעה לי?</h2>
        ${counter}
        ${m ? havraa : `<p class="muted">הזינו פרטים בדף הבית לחישוב אישי.</p>`}
        ${disputedBlock("havraa_days")}
        <details><summary>טבלת ימי הבראה לפי ותק</summary>
          <table class="small"><thead><tr><th>שנות ותק</th><th>ימים</th></tr></thead><tbody>
          ${hd.table.map(([lo, hi, days]) => `<tr><td class="num">${hi >= 99 ? `${lo}+` : `${lo}–${hi}`}</td><td class="num">${days}</td></tr>`).join("")}
          </tbody></table>
          <p class="muted">תעריף ליום: ${Object.entries(d.periodic.find((p) => p.key === "havraa").day_rate_history).map(([y, v]) => `${y}: ${shekel(v)}`).join(" · ")}</p>
        </details>
      </section>
      <section class="card">
        <h2>אחזקת רכב לפי דרגה</h2>
        <div class="scroll"><table class="small">
          <thead><tr><th>רמה</th><th>דרגות</th><th>קבועות שירות</th><th>קבועות נטו</th><th>ק"מ בשנה</th><th>סה"כ לחודש</th></tr></thead>
          <tbody>${rechev}</tbody>
        </table></div>
        <p class="muted">משתנות = ${d.rechev_levels.km_rate} ₪ × ק"מ ÷ 12. ${esc(d.rechev_levels.note)}</p>
      </section>
      <section class="card"><h2>פנסיה וקרנות</h2>${funds}</section>`;
  },

  shifts() {
    const s = state.data.shifts;
    const q = (state.glossaryQuery || "").trim();
    const terms = state.data.glossary.filter((g) => !q || g.term.includes(q) || g.text.includes(q));
    return `<h1>משמרות ושעות נוספות</h1>
      <section class="card">
        <h2>דוחות נוכחות</h2>
        <p>${esc(s.reports)}</p>
        <p class="deadline">התיקון הבא: עד ${fmtDate(nextCorrectionDeadline())} (${esc(until(nextCorrectionDeadline()))})</p>
      </section>
      <section class="card">
        <h2>תוספות משמרת</h2>
        <table><thead><tr><th>מתי</th><th>תוספת</th></tr></thead><tbody>
          ${s.supplements.map((r) => `<tr><td>${esc(r.window)}</td><td class="num">${r.pct}%</td></tr>`).join("")}
        </tbody></table>
        <p class="muted">${esc(s.supplements_note)}</p>
      </section>
      <section class="card">
        <h2>שעות נוספות</h2>
        <table><thead><tr><th></th>${s.ot_table.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
          ${s.ot_table.rows.map((r) => `<tr><td>${esc(r.bucket)}</td>${r.pct.map((p) => `<td class="num">${p}%</td>`).join("")}</tr>`).join("")}
        </tbody></table>
        <p>${esc(s.ot_table.shabbat)}</p>
        <p class="muted">${esc(s.ot_table.note)}</p>
        <p>${esc(s.daily_norm)}</p>
        <p>${esc(s.eighth_hour)}</p>
      </section>
      <section class="card"><h2>כוננות</h2><p>${esc(s.konenut)}</p></section>
      <section class="card">
        <h2>מילון מונחים</h2>
        <input type="search" class="search" placeholder="חיפוש מונח…" data-field="glossary" value="${esc(q)}" aria-label="חיפוש מונח">
        <dl class="glossary" id="glossary-list">${glossaryItems(terms)}</dl>
      </section>`;
  },

  checklist() {
    const m = model();
    const relevant = m ? relevantChecklist(m) : new Set(["start", "monthly"]);
    return `<h1>צ'קליסט לעובד/ת חדש/ה</h1>
      <p class="muted">הסימונים נשמרים בדפדפן הזה בלבד.</p>
      ${state.data.checklist.map((g) => `
        <details class="card checklist"${relevant.has(g.when) ? " open" : ""}>
          <summary>${esc(g.title)} <span class="muted">(${g.items.filter((_, i) => state.checks[`${g.when}.${i}`]).length}/${g.items.length})</span></summary>
          <ul>${g.items.map((it, i) => {
            const id = `${g.when}.${i}`;
            return `<li><label class="check"><input type="checkbox" data-check="${esc(id)}"${state.checks[id] ? " checked" : ""}> <span>${esc(it)}</span></label></li>`;
          }).join("")}</ul>
        </details>`).join("")}
      <button type="button" class="ghost" data-action="clear-checks">איפוס הסימונים</button>`;
  },
};

function stageList(m) {
  const d = state.data;
  return `<section class="card"><h2>שלושת השלבים</h2><ol class="stages">${d.stages.map((s, i) => `
      <li class="${m && m.stage === i ? "current" : ""}">
        <strong>${esc(s.name)}</strong>${m && m.stage === i ? ` <span class="badge ok">את/ה כאן</span>` : ""}
        ${m ? `<div class="muted">מ-${fmtDate(m.stageDate(i))}</div>` : ""}
      </li>`).join("")}</ol></section>`;
}

function glossaryItems(terms) {
  return terms.length
    ? terms.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.text)}</dd>`).join("")
    : `<p class="muted">לא נמצא מונח.</p>`;
}

function relevantChecklist(m) {
  const r = new Set(["monthly"]);
  if (m.tenure < 0.5) r.add("start");
  if (m.stage === 0 && daysBetween(today(), m.stageDate(1)) < 120) r.add("2y");
  if (m.stage === 1 && m.tenure < 2.5) r.add("2y");
  if (m.stage === 1 && daysBetween(today(), m.stageDate(2)) < 120) r.add("5y");
  if (m.nextGrade && daysBetween(today(), m.nextGrade) < 90 && daysBetween(today(), m.nextGrade) > -60) r.add("grade");
  return r;
}

// ---- calendar (.ics) ---------------------------------------------------------

function icsDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function icsText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// RFC 5545 lines are at most 75 octets; fold on UTF-8 byte length.
function icsFold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function buildIcs(m) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const events = [];
  const ev = (uid, date, summary, desc, rrule) => {
    const end = new Date(date); end.setDate(end.getDate() + 1);
    events.push([
      "BEGIN:VEVENT",
      `UID:${uid}@atc-guide`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(date)}`,
      `DTEND;VALUE=DATE:${icsDate(end)}`,
      `SUMMARY:${icsText(summary)}`,
      desc ? `DESCRIPTION:${icsText(desc)}` : null,
      rrule ? `RRULE:${rrule}` : null,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(summary)}`, "TRIGGER:-PT15H", "END:VALARM",
      "END:VEVENT",
    ].filter(Boolean));
  };
  const t = today();
  if (m.stageDate(1) > t) ev("stage-2y", m.stageDate(1), "שנתיים ותק — לבדוק שההטבות נכנסו לתלוש", "הסכם 91/92, משכורת י\"ג, קרן השתלמות, קופת גמל, ביטוחים. ראו את הצ'קליסט במדריך.");
  if (m.stageDate(2) > t) ev("stage-kavua", m.stageDate(2), "קביעות — 5 שנות ותק", "לוודא עדכון מעמד ותוספת התייעלות 3%.");
  if (m.nextGrade && m.nextGrade > t) ev("next-grade", m.nextGrade, `עליית דרגה${m.grade ? ` ל-${m.grade + 1}` : ""}`, "לבדוק את התלוש הראשון אחרי העלייה: שכר יסוד, אחזקת רכב.");
  state.data.periodic.filter((pm) => pm.min_years < 25).forEach((pm) => {
    ev(`pay-${pm.key}`, nextPayment(pm, m), `${pm.name} — לבדוק בתלוש`, `בתלוש ${MONTHS[pm.slip_month - 1]}.`, "FREQ=YEARLY");
  });
  const firstDraft = new Date(t.getFullYear(), t.getMonth() + (t.getDate() > 8 ? 1 : 0), 8);
  ev("pzl-draft", firstDraft, "בדיקת טיוטת נוכחות — תיקונים עד ה-10", "תיקון שלא הוגש עד ה-10 לחודש — השעות אובדות.", "FREQ=MONTHLY;BYMONTHDAY=8");
  const jan = new Date(t.getFullYear() + (t.getMonth() > 0 ? 1 : 0), 0, 5);
  ev("form-101", jan, "טופס 101 לשנה החדשה", "לעדכן פרטים ונקודות זיכוי.", "FREQ=YEARLY");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//atc-guide//HE", "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:מדריך פקח טיסה",
    ...events.flat(),
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

function downloadIcs() {
  const m = model();
  if (!m) { location.hash = "#/"; return; }
  const blob = new Blob([buildIcs(m)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "atc-guide.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- router + events ---------------------------------------------------------

function currentRoute() {
  const name = (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0]) || "home";
  return pages[name] ? name : "home";
}

function render(keepScroll) {
  const name = currentRoute();
  const y = window.scrollY;
  document.getElementById("view").innerHTML = pages[name]();
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
  window.scrollTo(0, keepScroll ? y : 0);
}

function readForm(form) {
  const f = new FormData(form);
  return {
    startDate: f.get("startDate") || "",
    grade: f.get("grade") || "",
    status: f.get("status") || "auto",
    nextGradeDate: f.get("nextGradeDate") || "",
    idfYears: f.get("idfYears") || "",
    recognizedYears: f.get("recognizedYears") || "",
    nightShifts: f.get("nightShifts") || "",
    hasChildren: f.get("hasChildren") === "on",
  };
}

function wireEvents() {
  const view = document.getElementById("view");

  view.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-action='save-profile']");
    if (!form) return;
    e.preventDefault();
    const p = readForm(form);
    const start = parseDate(p.startDate);
    if (!start || start > today()) {
      form.querySelector("#form-error").hidden = false;
      return;
    }
    state.profile = p;
    profileStore.save(p);
    render(false);
  });

  view.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.tagName === "FORM") return;
    const action = btn.dataset.action;
    if (action === "clear-profile") {
      if (!confirm("למחוק את הפרטים השמורים בדפדפן הזה?")) return;
      profileStore.clear();
      state.profile = null;
      render(false);
    } else if (action === "clear-checks") {
      if (!confirm("לאפס את כל הסימונים?")) return;
      state.checks = {};
      checkStore.clear();
      render(true);
    } else if (action === "ics") {
      downloadIcs();
    }
  });

  view.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.check) {
      state.checks[el.dataset.check] = el.checked;
      checkStore.save(state.checks);
      const summary = el.closest("details")?.querySelector("summary .muted");
      if (summary) {
        const boxes = el.closest("ul").querySelectorAll("input[type=checkbox]");
        summary.textContent = `(${[...boxes].filter((b) => b.checked).length}/${boxes.length})`;
      }
    } else if (el.dataset.field === "nightShifts") {
      state.profile = { ...(state.profile || {}), nightShifts: el.value };
      if (state.profile.startDate) profileStore.save(state.profile);
      render(true);
    }
  });

  view.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.field === "glossary") {
      state.glossaryQuery = el.value;
      const q = el.value.trim();
      const terms = state.data.glossary.filter((g) => !q || g.term.includes(q) || g.text.includes(q));
      document.getElementById("glossary-list").innerHTML = glossaryItems(terms);
    }
  });

  window.addEventListener("hashchange", () => render(false));
}

function renderFooter() {
  const m = state.data.meta;
  document.getElementById("footer").innerHTML =
    `<p>נכתב על ידי ${esc(m.author)}. ${esc(m.disclaimer)}</p>
     <p>מקור: ${esc(m.source)}. הנתונים עודכנו: <span class="num">${esc(m.data_updated)}</span>.</p>`;
}

async function boot() {
  document.getElementById("version-chip").textContent = "v" + VERSION;
  try {
    const res = await fetch("data/guide.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
  } catch {
    document.getElementById("view").innerHTML =
      `<div class="card"><p>לא הצלחתי לטעון את הנתונים. נסו לרענן.</p></div>`;
    return;
  }
  state.profile = profileStore.load();
  state.checks = checkStore.load() || {};
  renderFooter();
  wireEvents();
  render(false);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline mode is optional */ });
  }
}

boot();
