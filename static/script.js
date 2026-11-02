(() => {
  "use strict";

  const EMOJI = {
    sadness: "😢",
    joy: "😄",
    love: "❤️",
    anger: "😠",
    fear: "😨",
    surprise: "😲",
  };

  const el = {
    statusDot: document.getElementById("statusDot"),
    serverStatusText: document.getElementById("serverStatusText"),
    textInput: document.getElementById("textInput"),
    charCount: document.getElementById("charCount"),
    analyzeBtn: document.getElementById("analyzeBtn"),
    errorMsg: document.getElementById("errorMsg"),
    orb: document.getElementById("orb"),
    orbEmoji: document.getElementById("orbEmoji"),
    resultSection: document.getElementById("resultSection"),
    emotionWord: document.getElementById("emotionWord"),
    emotionEmoji: document.getElementById("emotionEmoji"),
    confidenceText: document.getElementById("confidenceText"),
    echoedText: document.getElementById("echoedText"),
    barsContainer: document.getElementById("barsContainer"),
    startExamplesBtn: document.getElementById("startExamplesBtn"),
    exampleList: document.getElementById("exampleList"),
  };

  let modelReady = false;

  /* ---------------------------------------------------------------
     Health check — poll until the model is loaded
  --------------------------------------------------------------- */
  async function checkHealth() {
    try {
      const res = await fetch("/health");
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();

      modelReady = !!data.model_loaded;
      if (modelReady) {
        setStatus("live", "model ready — say something");
      } else {
        setStatus("warming", "waking the model up…");
        setTimeout(checkHealth, 3000);
      }
    } catch (e) {
      setStatus("down", "can't reach the server");
      setTimeout(checkHealth, 5000);
    }
    syncButtonState();
  }

  function setStatus(kind, text) {
    el.statusDot.className = "brand-mark " + kind;
    el.serverStatusText.textContent = text;
  }

  /* ---------------------------------------------------------------
     Input handling
  --------------------------------------------------------------- */
  el.textInput.addEventListener("input", () => {
    el.charCount.textContent = el.textInput.value.length;
    syncButtonState();
  });

  el.textInput.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runAnalysis();
    }
  });

  function syncButtonState() {
    const hasText = el.textInput.value.trim().length > 0;
    el.analyzeBtn.disabled = !hasText || !modelReady;
  }

  el.analyzeBtn.addEventListener("click", runAnalysis);

  // Reveal sample sentences when the user chooses to start testing.
  el.startExamplesBtn.addEventListener("click", () => {
    const isOpen = !el.exampleList.hidden;
    el.exampleList.hidden = isOpen;
    el.startExamplesBtn.setAttribute("aria-expanded", String(!isOpen));
    el.startExamplesBtn.innerHTML = isOpen
      ? 'Start testing <span aria-hidden="true">→</span>'
      : 'Hide examples <span aria-hidden="true">↑</span>';
    if (!isOpen) {
      el.exampleList.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  // Choosing a sample fills the input; the user still presses Read the mood.
  el.exampleList.addEventListener("click", (event) => {
    const card = event.target.closest(".example-card");
    if (!card) return;
    el.textInput.value = card.dataset.sentence || "";
    el.charCount.textContent = el.textInput.value.length;
    syncButtonState();
    el.textInput.focus();
    el.textInput.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  /* ---------------------------------------------------------------
     Analysis flow
  --------------------------------------------------------------- */
  async function runAnalysis() {
    const text = el.textInput.value.trim();
    if (!text || !modelReady) return;

    hideError();
    enterThinking();

    try {
      const res = await fetch("/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail =
          body && body.detail
            ? typeof body.detail === "string"
              ? body.detail
              : "The model couldn't process that sentence."
            : `Request failed (${res.status}).`;
        throw new Error(detail);
      }

      const data = await res.json();
      renderResult(data, text);
    } catch (err) {
      exitThinking(false);
      showError(err.message || "Something went wrong. Try again.");
    }
  }

  function enterThinking() {
    el.analyzeBtn.classList.add("loading");
    el.analyzeBtn.querySelector(".btn-label").textContent = "Reading…";
    el.analyzeBtn.disabled = true;
    el.orb.classList.remove("settled");
    el.orb.classList.add("thinking");
    el.orbEmoji.style.opacity = "0";
  }

  function exitThinking(success) {
    el.analyzeBtn.classList.remove("loading");
    el.analyzeBtn.querySelector(".btn-label").textContent = "Read the mood";
    syncButtonState();
    el.orb.classList.remove("thinking");
    if (!success) {
      el.orbEmoji.textContent = "✎";
      el.orbEmoji.style.opacity = "1";
    }
  }

  function renderResult(data, originalText) {
    const emotion = data.predicted_emotion;
    const emoji = EMOJI[emotion] || "🙂";

    document.body.setAttribute("data-emotion", emotion);

    el.orb.classList.add("settled");
    el.orbEmoji.textContent = emoji;
    el.orbEmoji.style.opacity = "1";
    exitThinking(true);

    el.emotionWord.textContent = capitalize(emotion);
    el.emotionEmoji.textContent = emoji;
    el.confidenceText.textContent = "0.0% confidence";
    el.echoedText.textContent = `“${originalText}”`;

    renderBars(data.all_probabilites);

    el.resultSection.hidden = false;
    el.resultSection.classList.remove("entering");
    void el.resultSection.offsetWidth; // restart animation on every prediction
    el.resultSection.classList.add("entering");
    el.resultSection.setAttribute("aria-label", `Detected emotion: ${capitalize(emotion)}`);

    animateNumber(0, data.confidence * 100, 850, (value) => {
      el.confidenceText.textContent = `${value.toFixed(1)}% confidence`;
    }, 160);

    el.resultSection.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
  }

  function renderBars(probs) {
    const entries = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    el.barsContainer.innerHTML = "";

    entries.forEach(([label, value], i) => {
      const pct = value * 100;
      const row = document.createElement("div");
      row.className = `bar-row bar-${label}`;
      row.style.setProperty("--row-index", i);
      row.innerHTML = `
        <span class="bar-label">${EMOJI[label] || ""} ${label}</span>
        <span class="bar-track" role="progressbar" aria-label="${label} probability" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(1)}"><span class="bar-fill"></span></span>
        <span class="bar-pct">0.0%</span>
      `;
      el.barsContainer.appendChild(row);

      const fill = row.querySelector(".bar-fill");
      const pctLabel = row.querySelector(".bar-pct");
      const delay = prefersReducedMotion() ? 0 : 240 + i * 95;
      setTimeout(() => {
        fill.style.width = pct + "%";
        animateNumber(0, pct, 760, (number) => {
          pctLabel.textContent = `${number.toFixed(1)}%`;
        });
      }, delay);
    });
  }

  function animateNumber(from, to, duration, onUpdate, delay = 0) {
    if (prefersReducedMotion()) {
      onUpdate(to);
      return;
    }
    const start = performance.now() + delay;
    const tick = (now) => {
      if (now < start) {
        requestAnimationFrame(tick);
        return;
      }
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      onUpdate(from + (to - from) * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function showError(msg) {
    el.errorMsg.textContent = msg;
    el.errorMsg.hidden = false;
  }
  function hideError() {
    el.errorMsg.hidden = true;
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ---------------------------------------------------------------
     Boot
  --------------------------------------------------------------- */
  checkHealth();
})();
