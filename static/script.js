let isRunning = false;

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdownLite(text) {
  const parts = text.split(/(```[\w]*\n[\s\S]*?```)/g);
  let html = "";
  for (const part of parts) {
    const codeMatch = part.match(/```([\w]*)\n([\s\S]*?)```/);
    if (codeMatch) {
      const code = escapeHtml(codeMatch[2].trimEnd());
      html += `<pre><code>${code}</code></pre>`;
    } else {

      let p = escapeHtml(part)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, `<code style="font-family:var(--font-mono);background:var(--bg-code);padding:1px 5px;">$1</code>`);
      html += p;
    }
  }
  return html;
}

function setDot(agent, state) {
  const dot = document.getElementById(`dot-${agent}`);
  if (!dot) return;
  dot.className = "step-dot " + state;
}

function createCard(agent) {
  const labels = {
    detector:  { label: "DETECTOR AGENT",  badge: "badge-detector",  title: "Error Detection" },
    explainer: { label: "EXPLAINER AGENT", badge: "badge-explainer", title: "Error Explanation" },
    fixer:     { label: "FIXER AGENT",     badge: "badge-fixer",     title: "Fixed Code" },
  };
  const meta = labels[agent];

  const card = document.createElement("div");
  card.className = "chat-card";
  card.id = `card-${agent}`;

  card.innerHTML = `
    <div class="chat-card-header">
      <span class="agent-badge ${meta.badge}">${meta.label}</span>
      <span class="card-title" style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);">${meta.title}</span>
      ${agent === "fixer" ? `<button class="copy-btn" id="copy-btn" onclick="copyFixed()" style="margin-left:auto;">Copy Code</button>` : `<span class="card-status running" id="status-${agent}">RUNNING...</span>`}
    </div>
    <div class="chat-card-body" id="body-${agent}">
      <span class="thinking">Processing&hellip;</span>
    </div>
  `;
  return card;
}

function setCardDone(agent, content) {
  const body   = document.getElementById(`body-${agent}`);
  const status = document.getElementById(`status-${agent}`);

  if (body)   body.innerHTML = renderMarkdownLite(content);
  if (status) { status.textContent = "DONE"; status.className = "card-status done"; }
}

async function analyzeCode() {
  const code = document.getElementById("code-input").value.trim();
  if (!code) { alert("Please paste some code first."); return; }
  if (isRunning) return;

  isRunning = true;
  const btn = document.getElementById("analyze-btn");
  btn.disabled = true;
  btn.textContent = "Analyzing…";


  const feed = document.getElementById("chat-feed");
  feed.innerHTML = "";

  const strip = document.getElementById("pipeline-strip");
  strip.style.display = "flex";
  setDot("detector",  "");
  setDot("explainer", "");
  setDot("fixer",     "");

  document.getElementById("output-hint").textContent = "Analysis running…";

  const language = document.getElementById("lang-select").value;

  const detectorCard  = createCard("detector");
  const explainerCard = createCard("explainer");
  const fixerCard     = createCard("fixer");

  feed.appendChild(detectorCard);


  try {
    const resp = await fetch("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language }),
    });

    if (!resp.ok) {
      throw new Error(`Server error: ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") break;

        let event;
        try { event = JSON.parse(raw); } catch { continue; }

        const { stage, status, content } = event;

        if (status === "running") {
          setDot(stage, "running");

          if (stage === "explainer" && !document.getElementById("card-explainer")) {
            feed.appendChild(explainerCard);
          }
          if (stage === "fixer" && !document.getElementById("card-fixer")) {
            feed.appendChild(fixerCard);
          }
          feed.scrollTop = feed.scrollHeight;
        }

        if (status === "done") {
          setDot(stage, "done");
          setCardDone(stage, content);

          if (stage === "fixer") {
            window._fixedCode = content;
          }
          feed.scrollTop = feed.scrollHeight;
        }
      }
    }

    document.getElementById("output-hint").textContent = "Analysis complete";

  } catch (err) {
    feed.innerHTML += `<div class="chat-card" style="border-color:var(--red)">
      <div class="chat-card-body" style="color:var(--red)">Error: ${escapeHtml(err.message)}</div>
    </div>`;
  } finally {
    isRunning = false;
    btn.disabled = false;
    btn.textContent = "▶ Analyze Code";
  }
}

function copyFixed() {
  if (!window._fixedCode) return;
  const clean = window._fixedCode.replace(/```[\w]*\n?/g, "").trim();
  navigator.clipboard.writeText(clean).then(() => {
    const btn = document.getElementById("copy-btn");
    if (btn) { btn.textContent = "Copied!"; setTimeout(() => btn.textContent = "Copy Code", 2000); }
  });
}

function clearAll() {
  document.getElementById("code-input").value = "";
  document.getElementById("chat-feed").innerHTML = `
    <div class="welcome-msg">
      <p>Submit your code on the left to begin analysis.</p>
      <p>The pipeline will run three agents sequentially:</p>
      <ol>
        <li><strong>Detector</strong> — identifies all errors and bugs</li>
        <li><strong>Explainer</strong> — explains why each error occurs</li>
        <li><strong>Fixer</strong> — returns corrected code</li>
      </ol>
    </div>`;
  document.getElementById("pipeline-strip").style.display = "none";
  document.getElementById("output-hint").textContent = "Results will appear here";
  window._fixedCode = null;
}

document.addEventListener("DOMContentLoaded", () => {
  const ta = document.getElementById("code-input");
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.substring(0, s) + "    " + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = s + 4;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      analyzeCode();
    }
  });
});