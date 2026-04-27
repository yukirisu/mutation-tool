/* =============================================
   transcript-extractor / app.js
   ============================================= */
"use strict";

// ---- Prompt ----
const SYSTEM_PROMPT =
  "You are an AI that extracts data from academic transcripts.\n" +
  "Extract: subject/course names, grades (keep EXACTLY as written: A+, 優, 87, 3.7, Pass, 合格, HD, etc.), " +
  "credits (number only, no unit word), semester, student name, institution.\n" +
  "Respond ONLY with valid JSON, no markdown fences, no extra text:\n" +
  '{"institution":null,"student_name":null,"academic_year":null,"subjects":[{"name":"","grade":"","credits":null,"semester":null}]}';

// ---- State ----
let currentFile   = null;
let currentResult = null;

// ---- DOM refs ----
const dropZone      = document.getElementById("drop-zone");
const fileInput     = document.getElementById("file-input");
const previewWrap   = document.getElementById("preview-wrap");
const previewImg    = document.getElementById("preview-img");
const optGrades     = document.getElementById("opt-grades");
const optCredits    = document.getElementById("opt-credits");
const optSemester   = document.getElementById("opt-semester");
const btnExtract    = document.getElementById("btn-extract");
const errorBox      = document.getElementById("error-box");
const resultsEl     = document.getElementById("results");
const metaGrid      = document.getElementById("meta-grid");
const bulkCopyBar   = document.getElementById("bulk-copy-bar");
const tblHead       = document.getElementById("tbl-head");
const tblBody       = document.getElementById("tbl-body");
const subjectCount  = document.getElementById("subject-count");
const modalOverlay  = document.getElementById("copy-modal-overlay");
const modalTextarea = document.getElementById("modal-textarea");
const btnModalClose = document.getElementById("btn-modal-close");
const apiKeyWarning = document.getElementById("api-key-warning");

// ---- APIキー確認 ----
// config.js が読み込まれ ANTHROPIC_API_KEY が設定されているか確認
function getApiKey() {
  if (typeof ANTHROPIC_API_KEY === "undefined" ||
      !ANTHROPIC_API_KEY ||
      ANTHROPIC_API_KEY.startsWith("sk-ant-ここに")) {
    return null;
  }
  return ANTHROPIC_API_KEY;
}

window.addEventListener("DOMContentLoaded", () => {
  if (!getApiKey()) {
    apiKeyWarning.classList.remove("hidden");
    apiKeyWarning.style.display = "block";
  }
});

// ---- Upload ----
dropZone.addEventListener("click",     () => fileInput.click());
dropZone.addEventListener("keydown",   e => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
dropZone.addEventListener("dragover",  e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const f = e.dataTransfer.files[0];
  if (f) setFile(f);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

function setFile(f) {
  currentFile   = f;
  currentResult = null;

  dropZone.querySelector(".drop-main").textContent = f.name;
  dropZone.querySelector(".drop-sub").textContent  = "クリックして変更";

  if (f.type.startsWith("image/")) {
    previewImg.src = URL.createObjectURL(f);
    previewWrap.classList.remove("hidden");
    previewWrap.style.display = "block";
  } else {
    previewImg.src = "";
    previewWrap.classList.add("hidden");
    previewWrap.style.display = "none";
  }

  hideError();
  resultsEl.classList.add("hidden");
  resultsEl.style.display = "none";
  btnExtract.disabled = false;
}

// ---- Options → 再レンダリング ----
[optGrades, optCredits, optSemester].forEach(el =>
  el.addEventListener("change", () => { if (currentResult) renderResults(currentResult); })
);

// ---- Extract ----
btnExtract.addEventListener("click", extractData);

async function extractData() {
  if (!currentFile) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    showError("APIキーが設定されていません。config.js を確認してください。");
    return;
  }

  btnExtract.disabled     = true;
  btnExtract.textContent  = "解析中…";
  hideError();
  resultsEl.classList.add("hidden");
  resultsEl.style.display = "none";

  try {
    const base64  = await fileToBase64(currentFile);
    const isImage = currentFile.type.startsWith("image/");

    const contentBlock = isImage
      ? { type: "image",    source: { type: "base64", media_type: currentFile.type,  data: base64 } }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":            "application/json",
        "x-api-key":               apiKey,
        "anthropic-version":       "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: "user", content: [contentBlock, { type: "text", text: "Extract all subjects and grades." }] }],
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.error?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const data  = await res.json();
    const raw   = (data.content || []).map(b => b.text || "").join("");
    const clean = raw.replace(/^```[a-z]*\n?|\n?```$/g, "").trim();

    currentResult = JSON.parse(clean);
    renderResults(currentResult);

  } catch (err) {
    showError("解析に失敗しました: " + (err.message || "不明なエラー"));
  } finally {
    btnExtract.disabled    = false;
    btnExtract.textContent = "科目を抽出する";
  }
}

// ---- Render ----
function renderResults(data) {
  const showGrades   = optGrades.checked;
  const showCredits  = optCredits.checked;
  const showSemester = optSemester.checked;

  // Meta cards
  metaGrid.innerHTML = "";
  const metas = [
    { label: "学校名", value: data.institution   },
    { label: "氏名",   value: data.student_name  },
    { label: "年度",   value: data.academic_year },
  ].filter(m => m.value);

  if (metas.length) {
    metas.forEach(m => {
      const card = document.createElement("div");
      card.className = "meta-card";
      card.innerHTML = `<p class="meta-label">${esc(m.label)}</p><div class="meta-row"><span class="meta-value">${esc(m.value)}</span></div>`;
      card.querySelector(".meta-row").appendChild(makeCopyBtn(m.value));
      metaGrid.appendChild(card);
    });
    metaGrid.style.display = "grid";
  } else {
    metaGrid.style.display = "none";
  }

  // Bulk copy
  bulkCopyBar.innerHTML = "";
  const nameText = data.subjects.map(s => s.name).join("\n");
  const allText  = data.subjects.map(s => {
    const parts = [s.name];
    if (showGrades   && s.grade)    parts.push(s.grade);
    if (showCredits  && s.credits)  parts.push(s.credits + "単位");
    if (showSemester && s.semester) parts.push(s.semester);
    return parts.join("\t");
  }).join("\n");
  bulkCopyBar.appendChild(makeCopyBtn(nameText, "科目名のみ 全コピー"));
  bulkCopyBar.appendChild(makeCopyBtn(allText,  "全項目 タブ区切りコピー"));

  // Column template: name | [grade] | [cnum][cunit] | [semester] | copy
  const cols = ["1fr"];
  if (showGrades)   cols.push("80px");
  if (showCredits) { cols.push("52px"); cols.push("36px"); }
  if (showSemester) cols.push("80px");
  cols.push("90px");
  const colTemplate = cols.join(" ");

  // Table header
  tblHead.style.gridTemplateColumns = colTemplate;
  tblHead.innerHTML = "<span>科目名</span>";
  if (showGrades)   tblHead.innerHTML += `<span style="text-align:center">成績</span>`;
  if (showCredits)  tblHead.innerHTML += `<span style="text-align:right">単位数</span><span></span>`;
  if (showSemester) tblHead.innerHTML += `<span>学期</span>`;
  tblHead.innerHTML += `<span style="text-align:right">コピー</span>`;

  // Table rows
  tblBody.innerHTML = "";
  data.subjects.forEach(s => {
    const row = document.createElement("div");
    row.className = "tbl-row";
    row.style.gridTemplateColumns = colTemplate;

    const nameSpan = document.createElement("span");
    nameSpan.className   = "col-name";
    nameSpan.textContent = s.name;
    row.appendChild(nameSpan);

    if (showGrades) {
      const gradeDiv = document.createElement("div");
      gradeDiv.className = "col-grade";
      gradeDiv.appendChild(makeGradeTag(s.grade));
      row.appendChild(gradeDiv);
    }

    if (showCredits) {
      const cnumSpan = document.createElement("span");
      cnumSpan.className   = "col-cnum";
      cnumSpan.textContent = s.credits != null ? s.credits : "—";
      row.appendChild(cnumSpan);

      const cunitSpan = document.createElement("span");
      cunitSpan.className   = "col-cunit";
      cunitSpan.textContent = s.credits != null ? "単位" : "";
      row.appendChild(cunitSpan);
    }

    if (showSemester) {
      const semSpan = document.createElement("span");
      semSpan.className   = "col-sem";
      semSpan.textContent = s.semester || "—";
      row.appendChild(semSpan);
    }

    const copyDiv = document.createElement("div");
    copyDiv.className = "col-copy";
    copyDiv.appendChild(makeCopyBtn(s.name));
    row.appendChild(copyDiv);

    tblBody.appendChild(row);
  });

  subjectCount.textContent = `${data.subjects.length} 科目を抽出しました`;

  resultsEl.classList.remove("hidden");
  resultsEl.style.display = "block";
}

// ---- Grade tag ----
function makeGradeTag(raw) {
  const span = document.createElement("span");
  span.className   = "grade-tag " + gradeClass(raw);
  span.textContent = raw || "—";
  return span;
}

function gradeClass(raw) {
  if (!raw || raw === "—") return "grade-na";
  const g = raw.toString().trim().toUpperCase();

  if (/^(S\+?|A\+|AA|EXCELLENT?|秀|特優|HD|HIGH DISTINCTION|DISTINCTION|4\.3|4\.0)$/.test(g)) return "grade-s";
  if (/^(A-?|B\+|VERY GOOD|優|CREDIT|3\.[5-9])$/.test(g) || g === "A")  return "grade-a";
  if (g === "合格") return "grade-a";
  if (/^(B-?|C\+|GOOD|良|MERIT|3\.[0-4])$/.test(g) || g === "B")        return "grade-b";
  if (/^(C-?|D\+|SATISFACTORY|可|PASS|^P$|2\.[0-9])$/.test(g) || g === "C") return "grade-c";
  if (/^(D-?|F\+?|^E$|FAIL(ING)?|不可|不合格|NG|^0$|1\.[0-9]|0\.[0-9])$/.test(g) || g === "D" || g === "F") return "grade-f";

  const num = parseFloat(raw);
  if (!isNaN(num)) {
    if (num <= 4.3 && /\./.test(raw)) {
      if (num >= 3.7) return "grade-s";
      if (num >= 3.0) return "grade-b";
      if (num >= 2.0) return "grade-c";
      return "grade-f";
    }
    const pct = num > 4.3 ? num : num * 100;
    if (pct >= 90) return "grade-s";
    if (pct >= 75) return "grade-b";
    if (pct >= 60) return "grade-c";
    return "grade-f";
  }
  return "grade-na";
}

// ---- Copy utility ----
function makeCopyBtn(text, label) {
  const btn = document.createElement("button");
  btn.className   = "btn-copy";
  btn.textContent = label || "コピー";
  btn.addEventListener("click", () => {
    copyText(text).then(ok => {
      if (ok) {
        btn.textContent = "✓ コピー完了";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = label || "コピー"; btn.classList.remove("copied"); }, 2000);
      } else {
        openModal(text);
      }
    });
  });
  return btn;
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => execCopy(text));
  }
  return Promise.resolve(execCopy(text));
}

function execCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
  return Promise.resolve(ok);
}

// ---- Fallback modal ----
function openModal(text) {
  modalTextarea.value = text;
  modalOverlay.classList.add("open");
  modalOverlay.style.display = "flex";
  setTimeout(() => { modalTextarea.focus(); modalTextarea.select(); }, 50);
}
modalOverlay.addEventListener("click", e => {
  if (e.target === modalOverlay) closeModal();
});
btnModalClose.addEventListener("click", closeModal);
function closeModal() {
  modalOverlay.classList.remove("open");
  modalOverlay.style.display = "none";
}

// ---- Helpers ----
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = () => res(reader.result.split(",")[1]);
    reader.onerror = () => rej(new Error("ファイルの読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

function showError(msg) {
  errorBox.textContent    = msg;
  errorBox.style.display  = "block";
  errorBox.classList.remove("hidden");
}
function hideError() {
  errorBox.style.display = "none";
  errorBox.classList.add("hidden");
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
