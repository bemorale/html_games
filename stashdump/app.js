(() => {
  const STORE_KEY = "voicedump.rows.v1";

  const CATEGORIES = {
    done: { label: "Already Done", icon: "✅", type: "log" },
    todo: { label: "Needs to Be Done", icon: "☐", type: "checklist" },
    find: { label: "Find My Place", icon: "📍", type: "location" },
  };

  const greetingEl = document.getElementById("greeting");
  const micBtn = document.getElementById("micBtn");
  const micLabel = document.getElementById("micLabel");
  const recordingActions = document.getElementById("recordingActions");
  const recordingHint = document.getElementById("recordingHint");
  const stopBtn = document.getElementById("stopBtn");
  const waveform = document.getElementById("waveform");
  const liveTranscriptEl = document.getElementById("liveTranscript");
  const fallbackForm = document.getElementById("fallbackForm");
  const fallbackInput = document.getElementById("fallbackInput");
  const waveBars = waveform.querySelectorAll("span");

  const calPrev = document.getElementById("calPrev");
  const calNext = document.getElementById("calNext");
  const calMonthLabel = document.getElementById("calMonthLabel");
  const calendarGrid = document.getElementById("calendarGrid");
  const calendarDetail = document.getElementById("calendarDetail");
  const calDetailDate = document.getElementById("calDetailDate");
  const calDetailClose = document.getElementById("calDetailClose");
  const moodPicker = document.getElementById("moodPicker");
  const calendarEventList = document.getElementById("calendarEventList");
  const calendarEventEmpty = document.getElementById("calendarEventEmpty");
  const calendarEventForm = document.getElementById("calendarEventForm");
  const calendarEventInput = document.getElementById("calendarEventInput");
  const calendarPastNote = document.getElementById("calendarPastNote");
  const langEnBtn = document.getElementById("langEn");
  const langZhBtn = document.getElementById("langZh");
  const mascotWrap = document.getElementById("mascotWrap");
  const mascotImg = document.getElementById("mascotImg");

  // ---------- Greeting ----------
  function setGreeting() {
    const hour = new Date().getHours();
    let text = "Good evening!";
    if (hour < 5) text = "Still up?";
    else if (hour < 12) text = "Good morning!";
    else if (hour < 17) text = "Good afternoon!";
    else if (hour < 22) text = "Good evening!";
    else text = "Winding down?";
    greetingEl.textContent = text;
  }
  setGreeting();

  // ---------- UI state machine: idle -> recording -> idle ----------
  let uiState = "idle";

  micBtn.addEventListener("click", () => {
    if (uiState === "idle") {
      if (speechSupported) startRecording();
      else showFallbackForm();
    } else if (uiState === "recording") {
      stopRecording();
    }
  });

  function showFallbackForm() {
    uiState = "idle";
    micLabel.textContent = "Tap to Speak";
    fallbackForm.classList.remove("hidden");
    fallbackInput.focus();
  }

  // ---------- Speech language ----------
  const LANG_KEY = "stashdump.lang";
  let speechLang = localStorage.getItem(LANG_KEY) || "en-US";

  function applyLangButtons() {
    langEnBtn.classList.toggle("active", speechLang === "en-US");
    langZhBtn.classList.toggle("active", speechLang === "zh-CN");
  }
  applyLangButtons();

  function setSpeechLang(lang) {
    speechLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    applyLangButtons();
    if (recognition) recognition.lang = lang;
  }

  langEnBtn.addEventListener("click", () => setSpeechLang("en-US"));
  langZhBtn.addEventListener("click", () => setSpeechLang("zh-CN"));

  // ---------- Speech recognition setup ----------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechSupported = !!SpeechRecognition;

  let recognition = null;
  let recognizing = false;
  let finalTranscript = "";

  // A pause longer than this between recognized words starts a new item.
  // This is deliberately a *secondary* signal now, not the primary one — a
  // fixed timer can't tell "thinking mid-sentence" apart from "done with
  // this item, starting the next," since both just look like silence. Set
  // too low (it used to be 1000ms), someone pausing to recall a word
  // ("I need to... attend class") gets wrongly cut into two items before
  // they finish the sentence. The real splitting work now happens content-
  // side, in insertImplicitBoundaries below (restart words like "I"/"my"),
  // which doesn't care about timing at all — this pause timer only exists to
  // still catch a genuine multi-second break between two items that happen
  // to have no restart-word cue between them at all (rare, but possible).
  const PAUSE_BREAK_MS = 2500;
  let lastEventTime = 0;
  let lastFullText = "";

  let audioCtx = null;
  let analyser = null;
  let micStream = null;
  let rafId = null;

  if (speechSupported) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = speechLang;

    recognition.onresult = (event) => {
      const now = Date.now();

      let fullText = "";
      for (let i = 0; i < event.results.length; i++) {
        fullText += event.results[i][0].transcript;
      }
      fullText = fullText.replace(/\s+/g, " ").trim();

      if (fullText.length > lastFullText.length && fullText.startsWith(lastFullText)) {
        const added = fullText.slice(lastFullText.length).trim();
        if (added) {
          // Gap since the last time NEW words actually appeared — a no-growth
          // re-fire of the same interim text must not reset this clock, or a
          // real pause right before the next word would go undetected.
          const gap = lastEventTime ? now - lastEventTime : 0;
          const separator = !finalTranscript ? "" : gap > PAUSE_BREAK_MS ? ". " : " ";
          finalTranscript += separator + added;
          lastEventTime = now;
        }
      } else if (fullText !== lastFullText) {
        // The engine rewrote earlier words (rare) — resync without guessing a break.
        finalTranscript = fullText;
        lastEventTime = now;
      }
      lastFullText = fullText;

      liveTranscriptEl.textContent = finalTranscript;
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      stopRecording(true);
      liveTranscriptEl.textContent = "Couldn't access the mic. You can type instead below.";
      showFallbackForm();
    };

    recognition.onend = () => {
      if (recognizing) {
        // Recognition can end on its own after silence; restart while user is still recording.
        // The new session's results start over from index 0, so reset the diff baseline
        // (finalTranscript itself is untouched — it holds everything recognized so far).
        lastFullText = "";
        try { recognition.start(); } catch (e) { /* already running */ }
      }
    };
  }

  // ---------- Waveform (real mic amplitude when available) ----------
  async function startWaveform() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const bars = Array.from(waveBars);
      const render = () => {
        analyser.getByteFrequencyData(data);
        bars.forEach((bar, i) => {
          const value = data[i % data.length] / 255;
          const height = 8 + value * 34;
          bar.style.height = `${height}px`;
        });
        rafId = requestAnimationFrame(render);
      };
      render();
    } catch (err) {
      // Mic access for waveform denied/unavailable — fall back to CSS animation only.
      // Guard against this async rejection landing after recording already stopped
      // (e.g. the speech recognizer's own mic error ended things first), which would
      // otherwise leave the waveform stuck active.
      if (uiState === "recording") waveform.classList.add("active");
    }
  }

  function stopWaveform() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    waveform.classList.remove("active");
    waveBars.forEach((bar) => (bar.style.height = "8px"));
  }

  // ---------- Recording controls ----------
  function startRecording() {
    uiState = "recording";
    finalTranscript = "";
    lastEventTime = 0;
    lastFullText = "";
    liveTranscriptEl.textContent = "Listening…";
    recognizing = true;
    micBtn.classList.add("recording");
    micLabel.textContent = "Listening…";
    recordingActions.classList.remove("hidden");
    recordingHint.classList.remove("hidden");
    waveform.classList.add("active");
    fallbackForm.classList.add("hidden");

    startWaveform();
    if (speechSupported) {
      try { recognition.start(); } catch (e) { /* no-op if already started */ }
    }
    mascotEnterThinking();
  }

  function stopRecording(skipProcessing) {
    uiState = "idle";
    recognizing = false;
    micBtn.classList.remove("recording");
    recordingActions.classList.add("hidden");
    recordingHint.classList.add("hidden");
    micLabel.textContent = "Tap to Speak";
    stopWaveform();

    if (speechSupported) {
      try { recognition.stop(); } catch (e) { /* no-op */ }
    }
    mascotEnterLicking();

    const transcript = finalTranscript.trim();
    liveTranscriptEl.textContent = "";

    if (skipProcessing) return;

    const added = transcript && handleTranscript(transcript);
    if (!added) {
      liveTranscriptEl.textContent = "Didn't catch anything — try again, or type below.";
      showFallbackForm();
    }
  }

  stopBtn.addEventListener("click", () => stopRecording());

  fallbackForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = fallbackInput.value.trim();
    if (!text) return;
    handleTranscript(text);
    fallbackInput.value = "";
    fallbackForm.classList.add("hidden");
  });

  // ---------- Mascot ----------
  // Lives in a fixed-position layer above everything, always pointer-events:
  // none so it never steals a tap meant for a real button. It parks right on
  // top of the mic button by default — thinking while you talk, licking its
  // paws for a moment after you stop — and only leaves that spot once the
  // mic button scrolls out of view, hopping down to the bottom corner so it
  // stays out of the way of whatever you scrolled down to see. Hopping back
  // up happens the same way once the mic is back in view.
  const MASCOT_SRC = { idle: "mascot/mascot-idle.png", thinking: "mascot/mascot-thinking.png", licking: "mascot/mascot-licking.png" };
  const MASCOT_MARGIN = 16;
  let mascotState = "idle"; // idle | thinking | licking
  let mascotAwayFromMic = false;
  let mascotLickTimer = null;

  function mascotSetImage(state) {
    if (mascotImg.getAttribute("src") !== MASCOT_SRC[state]) mascotImg.src = MASCOT_SRC[state];
  }

  function mascotMoveTo(x, y) {
    const w = mascotWrap.offsetWidth || 118;
    const h = mascotWrap.offsetHeight || 118;
    const maxX = window.innerWidth - w - MASCOT_MARGIN;
    const maxY = window.innerHeight - h - MASCOT_MARGIN;
    const clampedX = Math.max(MASCOT_MARGIN, Math.min(maxX, x));
    const clampedY = Math.max(MASCOT_MARGIN, Math.min(maxY, y));
    mascotWrap.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
  }

  function mascotParkByMic() {
    const rect = micBtn.getBoundingClientRect();
    const w = mascotWrap.offsetWidth || 118;
    const h = mascotWrap.offsetHeight || 118;
    mascotMoveTo(rect.left + rect.width / 2 - w / 2, rect.top - h * 0.75);
  }

  function mascotParkAtBottom() {
    const w = mascotWrap.offsetWidth || 118;
    const h = mascotWrap.offsetHeight || 118;
    mascotMoveTo(window.innerWidth - w - MASCOT_MARGIN, window.innerHeight - h - MASCOT_MARGIN);
  }

  function mascotSettle() {
    if (mascotAwayFromMic) mascotParkAtBottom();
    else mascotParkByMic();
  }

  function mascotEnterThinking() {
    if (mascotLickTimer) clearTimeout(mascotLickTimer);
    mascotState = "thinking";
    mascotAwayFromMic = false;
    mascotWrap.classList.remove("mascot-licking");
    mascotWrap.classList.add("mascot-thinking");
    mascotSetImage("thinking");
    mascotParkByMic();
  }

  function mascotEnterLicking() {
    mascotState = "licking";
    mascotWrap.classList.remove("mascot-thinking");
    mascotWrap.classList.add("mascot-licking");
    mascotSetImage("licking");
    mascotParkByMic();
    mascotLickTimer = setTimeout(mascotEnterIdle, 2600);
  }

  function mascotEnterIdle() {
    mascotState = "idle";
    mascotWrap.classList.remove("mascot-thinking", "mascot-licking");
    mascotSetImage("idle");
    mascotSettle();
  }

  function mascotHandleScroll() {
    const rect = micBtn.getBoundingClientRect();
    const micVisible = rect.bottom > 0 && rect.top < window.innerHeight;
    const away = !micVisible;
    if (away === mascotAwayFromMic) return;
    mascotAwayFromMic = away;
    if (mascotState === "idle") mascotSettle();
  }

  // Time-based throttle rather than requestAnimationFrame — an rAF callback
  // can go unfired for a while if the tab loses focus mid-scroll, which
  // would leave a ticking flag stuck forever and the mascot stranded.
  let mascotScrollLast = 0;
  window.addEventListener("scroll", () => {
    const now = Date.now();
    if (now - mascotScrollLast < 120) return;
    mascotScrollLast = now;
    mascotHandleScroll();
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (mascotState === "idle") mascotSettle();
  });

  mascotParkByMic();

  // ---------- "AI" processing pipeline (mocked LLM) ----------
  // Splits a raw transcript into individual items, auto-classifies each one
  // into a list, and formats it accordingly. Stands in for a real
  // speech-to-text + LLM call.
  const LOCATION_PATTERN = /^(.*?)\s+(?:is|are|was)\s+(?:on|in|at|near|under|by|inside|beside|next to)\s+(.*)$/i;
  // A location statement said without the linking verb — "jacket in closet"
  // instead of "my jacket is in the closet". Allows 1-3 words before the
  // preposition (not just one) so an ASR word-split fragment merged back in
  // by mergeOrphanFragments below, like "Wall et", still reads as one item
  // instead of needing to be a single clean word. Only matches when the
  // clause is ALREADY isolated to "[1-3 words] [preposition] [rest]" — by
  // the time this runs, splitting has already happened, so this is safe to
  // be fairly loose without risking false positives on longer sentences.
  const TELEGRAPHIC_LOCATION_PATTERN = /^((?:\w+\s+){0,2}\w+)\s+(?:on|in|at|near|under|by|inside|beside)\s+(?:the\s+|a\s+|my\s+|your\s+)?(.+)$/i;
  const LEADING_PRONOUN = /^(i|i've|i'll|i'd)\s+/i;
  const LEADING_ARTICLE = /^(the|my|your)\b/i;
  const FILLER_PATTERN = /^(that's it|that is it|done|nothing else)\.?$/i;

  // First-word signal that a clause describes something already completed
  // ("fed the cat", "locked the door") rather than a still-open task.
  const PAST_TENSE_VERBS = new Set([
    "fed", "bought", "ate", "drank", "took", "went", "did", "made", "said", "saw", "got",
    "gave", "found", "left", "met", "paid", "sent", "sold", "told", "brought", "caught",
    "taught", "kept", "slept", "spent", "built", "felt", "held", "heard", "lost", "woke",
    "wore", "won", "wrote", "drove", "flew", "grew", "knew", "threw", "chose", "broke",
    "spoke", "froze", "rose", "put", "ran", "hung", "drew", "forgot", "understood",
    "stood", "sat", "shut", "cut", "hit", "let", "rode", "dealt", "fled", "bent", "bit",
    "blew", "dug", "hid", "led", "lay", "lit", "meant", "quit", "rang", "sang", "shook",
    "shone", "shot", "slid", "spread", "stole", "struck", "swept", "swore", "swam",
    "swung", "tore", "wove", "already", "just", "finished",
  ]);

  // Words that end in a letter pair matching /ed$/ purely by coincidence of
  // spelling, not because they're past tense — "feed" is a task ("feed the
  // cat"), and "bed"/"shed" are just nouns that happen to end in those two
  // letters. Without this exception list, "feed my cat" would wrongly land in
  // Already Done right alongside "fed my cat" (genuinely past tense), and —
  // the bug that prompted this list to grow — a clause ending in "bed" (e.g.
  // "...is on my bed") would block the boundary-detection heuristic below
  // from ever splitting whatever came right after it.
  const PRESENT_TENSE_EXCEPTIONS = new Set([
    "feed", "need", "speed", "proceed", "succeed", "exceed", "seed", "breed", "wed", "embed", "indeed",
    "bed", "shed", "sled",
  ]);

  // Words/phrases that signal a clause is a scheduled event ("attend coding
  // class", "dentist appointment") rather than a plain checklist task — these
  // belong on the calendar, on their own date, not in any of the three lists.
  const EVENT_KEYWORDS = [
    "class", "meeting", "appointment", "interview", "exam", "test", "practice",
    "rehearsal", "flight", "conference", "checkup", "check-up", "doctor",
    "dentist", "lunch", "dinner", "party", "birthday", "anniversary", "wedding",
    "concert", "game", "session", "attend",
  ];
  const DATE_SIGNAL_PATTERN = /\b(tomorrow|tonight|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(:\d{2})?\s*(am|pm))\b/i;
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  function isCalendarEvent(clause) {
    const lower = clause.toLowerCase();
    if (EVENT_KEYWORDS.some((k) => lower.includes(k))) return true;
    return DATE_SIGNAL_PATTERN.test(lower);
  }

  // Defaults to today when no date is mentioned at all.
  function parseEventDate(clause) {
    const lower = clause.toLowerCase();
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    if (/\btomorrow\b/.test(lower)) {
      base.setDate(base.getDate() + 1);
      return base;
    }
    for (let i = 0; i < WEEKDAYS.length; i++) {
      if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(lower)) {
        const diff = (i - base.getDay() + 7) % 7;
        base.setDate(base.getDate() + diff);
        return base;
      }
    }
    return base;
  }

  function classifyCategory(clause) {
    if (LOCATION_PATTERN.test(clause)) return "find";
    const telegraphic = clause.match(TELEGRAPHIC_LOCATION_PATTERN);
    if (telegraphic) {
      const phraseWords = telegraphic[1].trim().split(/\s+/);
      const firstWord = phraseWords[0].toLowerCase();
      // A single word has to be long enough to plausibly be real ("jacket"),
      // not a leftover scrap ("et") — but two short words together (merged
      // back by mergeOrphanFragments, e.g. "Wall et") are trusted as-is,
      // since two consecutive fragments are themselves already a signal this
      // was one mis-split word, not noise.
      const looksReal = phraseWords.length > 1 || firstWord.length >= MIN_BARE_NOUN_LENGTH;
      if (looksReal && !isBoundaryBlocker(firstWord)) return "find";
    }
    if (isCalendarEvent(clause)) return "calendar";
    const firstWord = (clause.replace(LEADING_PRONOUN, "").trim().split(/\s+/)[0] || "").toLowerCase();
    if (PRESENT_TENSE_EXCEPTIONS.has(firstWord)) return "todo";
    if (PAST_TENSE_VERBS.has(firstWord) || /ed$/i.test(firstWord)) return "done";
    return "todo";
  }

  // Detects clause boundaries even when the speaker never paused and said no
  // "and"/comma — a true run-on like "my keys are on my laptop my water
  // bottle is on my bed" still needs splitting. "I" restarting mid-sentence
  // is almost never anything but a new clause, so it always counts. "my" is
  // far more ambiguous — it's often just the object of the CURRENT clause's
  // verb or preposition ("on my bed", "get my painting") — so it only counts
  // as a boundary when the word right before it couldn't plausibly still be
  // reaching for that "my X" (i.e. it isn't a preposition, particle, or verb
  // that takes a direct object).
  const RESTART_SAFE = new Set(["i", "i'm", "i've", "i'll", "i'd"]);
  const PREPOSITION_BLOCKERS = new Set([
    "on", "in", "at", "near", "under", "by", "inside", "beside", "next", "to",
    "off", "up", "down", "away", "out", "back", "over", "through", "across",
    "around", "past", "toward", "towards", "behind", "above", "below", "beneath", "between",
    "and", "of", "for", "with", "your", "the", "a", "an",
  ]);
  const PRESENT_VERB_BLOCKERS = new Set([
    "get", "got", "want", "need", "grab", "bring", "take", "find", "buy", "pack",
    "check", "fix", "wash", "water", "feed", "walk", "charge", "return", "pick",
    "drop", "close", "lock", "open", "turn", "attend", "clean", "call", "email",
    "text", "print", "sign", "finish", "start", "use", "borrow", "give", "see",
    "meet", "lose", "misplace", "fill",
  ]);
  // Single-word prepositions only (unlike LOCATION_PATTERN's list, which also
  // has "next to") — kept simple since this only feeds the word-index-based
  // boundary scan below, not a full regex match.
  const LOCATION_PREPOSITIONS = new Set(["on", "in", "at", "near", "under", "by", "inside", "beside"]);
  const ARTICLE_LIKE = new Set(["the", "a", "an", "my", "your"]);
  // Speech recognition occasionally mis-segments one spoken word into two
  // ("wallet" heard as "wall" + "et", "painting" as "paint" + "ing") — a mic
  // accuracy issue no amount of text processing can fully undo. But without
  // this guard, a 2-3 letter leftover fragment like "et" would get treated as
  // a real noun and turned into its own bogus "Et: Table" entry, actively
  // making the mis-hearing worse instead of just leaving it alone.
  const MIN_BARE_NOUN_LENGTH = 4;

  function isBoundaryBlocker(word) {
    if (PREPOSITION_BLOCKERS.has(word) || PRESENT_VERB_BLOCKERS.has(word)) return true;
    if (PAST_TENSE_VERBS.has(word)) return true;
    if (/ed$/i.test(word) && !PRESENT_TENSE_EXCEPTIONS.has(word)) return true;
    return false;
  }

  function insertImplicitBoundaries(text) {
    const words = text.split(/\s+/);
    const clean = words.map((w) => w.toLowerCase().replace(/[^a-z']/g, ""));
    const boundaryBefore = new Set();

    for (let i = 1; i < words.length; i++) {
      if (RESTART_SAFE.has(clean[i])) {
        boundaryBefore.add(i);
      } else if (clean[i] === "my" && !isBoundaryBlocker(clean[i - 1])) {
        boundaryBefore.add(i);
      }
    }

    // Telegraphic location fragments with no linking verb at all — "jacket in
    // closet" instead of "my jacket is in the closet" — have no "I"/"my" to
    // restart on, so they need their own detection: a bare noun sitting right
    // before a location preposition, where that noun isn't already the
    // object of the previous clause's verb ("go get the mail" already claims
    // "mail" — "jacket" right after it is a fresh, unclaimed noun).
    for (let i = 1; i < words.length; i++) {
      if (!LOCATION_PREPOSITIONS.has(clean[i])) continue;
      if (["is", "are", "was"].includes(clean[i - 1])) continue; // already a proper LOCATION_PATTERN match
      if (clean[i - 1].length < MIN_BARE_NOUN_LENGTH) continue;

      let phraseStart = i - 1;
      if (phraseStart < 0) continue;
      if (phraseStart - 1 >= 0 && ARTICLE_LIKE.has(clean[phraseStart - 1])) {
        phraseStart -= 1;
      }
      const verbCheckIdx = phraseStart - 1;
      if (verbCheckIdx >= 0 && isBoundaryBlocker(clean[verbCheckIdx])) continue;
      if (phraseStart > 0) boundaryBefore.add(phraseStart);
    }

    const out = [];
    for (let i = 0; i < words.length; i++) {
      if (boundaryBefore.has(i)) out.push(".");
      out.push(words[i]);
    }
    return out.join(" ");
  }

  // Speech recognition sometimes hears one word as two — "keys" as "key" +
  // "s", "wallet" as "wall" + "et", "counter" as "count" + "er". None of
  // these fragments are real standalone English words, so wherever one shows
  // up right after another word with nothing else between them, it almost
  // certainly belongs glued onto that word, not treated as its own token.
  // This runs first, before any clause-boundary detection, so "wall et is on
  // the table" becomes "wallet is on the table" before anything downstream
  // ever has to reason about it as two separate things.
  const SUFFIX_FRAGMENTS = new Set(["s", "es", "ed", "er", "et", "ing", "ly"]);

  function rejoinSplitWords(text) {
    const words = text.split(/\s+/);
    const out = [];
    for (let i = 0; i < words.length; i++) {
      const bare = words[i].toLowerCase().replace(/[^a-z]/g, "");
      if (i > 0 && SUFFIX_FRAGMENTS.has(bare) && out.length > 0) {
        // Drop any trailing punctuation on the previous word (e.g. a period
        // a long pause already inserted there) — the merge means that
        // boundary was wrong in the first place, so it shouldn't survive.
        const prev = out[out.length - 1].replace(/[^\w]+$/, "");
        out[out.length - 1] = prev + words[i];
      } else {
        out.push(words[i]);
      }
    }
    return out.join(" ");
  }

  // A clause that's just "[short word] [preposition] ..." — e.g. "et on
  // table" — is almost certainly the tail end of a word speech recognition
  // split in two, not a real standalone thought. rejoinSplitWords above
  // already catches the common suffix cases directly; this is a fallback for
  // shorter fragments it doesn't recognize, so it still doesn't become its
  // own (wrong) item — fold it back into the clause right before it instead.
  function looksLikeOrphanFragment(clause) {
    const match = clause.match(/^(\w+)\s+(?:on|in|at|near|under|by|inside|beside)\s+/i);
    return !!match && match[1].length < MIN_BARE_NOUN_LENGTH;
  }

  function mergeOrphanFragments(clauses) {
    const merged = [];
    clauses.forEach((clause) => {
      if (looksLikeOrphanFragment(clause) && merged.length > 0) {
        merged[merged.length - 1] += " " + clause;
      } else {
        merged.push(clause);
      }
    });
    return merged;
  }

  function splitClauses(transcript) {
    const rawClauses = insertImplicitBoundaries(rejoinSplitWords(transcript))
      .replace(/\band\b/gi, ",")
      .split(/[,.;]|(?:\bthen\b)/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((clause) => !FILLER_PATTERN.test(clause));
    return mergeOrphanFragments(rawClauses);
  }

  function toTitleCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function cleanFragment(clause) {
    let text = clause.replace(LEADING_PRONOUN, "").trim();
    text = text.replace(/^my\b/i, "the").replace(/\bmy\b/gi, "your");
    return toTitleCase(text);
  }

  function formatForCategory(clause, categoryId) {
    if (categoryId === "find") {
      const match = clause.match(LOCATION_PATTERN);
      if (match) {
        const item = match[1].replace(LEADING_PRONOUN, "").replace(LEADING_ARTICLE, "").trim();
        const place = match[2].trim().replace(/^my\b/i, "your");
        return `${toTitleCase(item)}: ${toTitleCase(place)}`;
      }
      const telegraphic = clause.match(TELEGRAPHIC_LOCATION_PATTERN);
      if (telegraphic) {
        const place = telegraphic[2].trim().replace(/^my\b/i, "your");
        return `${toTitleCase(telegraphic[1])}: ${toTitleCase(place)}`;
      }
    }
    return cleanFragment(clause);
  }

  // ---------- Chinese (Mandarin) pipeline ----------
  // Chinese needs its own rules end-to-end, not just a translation of the
  // English ones — there's no verb conjugation (no "locked" vs "lock" to
  // detect tense from), no spaces between words (so boundary-detection has
  // to work on character position instead of word position), and location
  // statements use 在 ("at/in/on") directly instead of an English-style
  // "is on/in/at" linking phrase. This is a first pass: less battle-tested
  // than the English rules above, which took many rounds of real bugs to get
  // right — expect some rough edges here the same way.
  const CJK_PATTERN = /[一-鿿]/;
  function isChineseText(text) {
    return CJK_PATTERN.test(text);
  }

  // "我的钱包在床上" = "my wallet is-at bed-on" — 在 does the job English
  // uses "is on/in/at" for, with no linking verb needed.
  const ZH_LOCATION_PATTERN = /^(.+?)在(.+)$/;

  // 了 (le) is the standard completion-aspect particle — "我锁了门" = "I
  // locked the door" — but it also shows up inside common words that have
  // nothing to do with completion: 为了 ("in order to"), 除了 ("except
  // for"). Those get stripped out before trusting a bare 了 as a signal,
  // the same way "feed" needed excluding from English's /ed$/ check.
  const ZH_LE_FALSE_POSITIVES = ["为了", "除了", "受不了", "少不了", "罢了"];
  function hasChineseCompletionMarker(clause) {
    // Chinglish speakers often keep the Chinese completion grammar but swap
    // in an English verb/noun ("我already洗了衣服") — or drop 了/已经
    // entirely and just say "already", the way English itself would.
    if (/\balready\b/i.test(clause)) return true;
    if (clause.includes("已经")) return true;
    let stripped = clause;
    ZH_LE_FALSE_POSITIVES.forEach((w) => { stripped = stripped.split(w).join(""); });
    return stripped.includes("了");
  }

  // Pulls the first run of Latin letters out of an otherwise-Chinese clause —
  // "我的wallet在桌子上" -> "wallet", "我bought牛奶" -> "bought". Lets the
  // Chinese pipeline reuse the English past-tense word lists for clauses that
  // swap in an English verb but keep Chinese sentence structure around it.
  function firstLatinWord(clause) {
    const match = clause.match(/[a-zA-Z']+/);
    return match ? match[0].toLowerCase() : "";
  }

  const ZH_EVENT_KEYWORDS = [
    "课", "会议", "预约", "生日", "聚会", "医生", "牙医", "考试", "面试",
    "婚礼", "演唱会", "比赛", "约会", "看病", "复诊",
  ];
  const ZH_WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const ZH_WEEKDAYS_ALT = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function isChineseCalendarEvent(clause) {
    if (ZH_EVENT_KEYWORDS.some((k) => clause.includes(k))) return true;
    if (clause.includes("明天") || clause.includes("今天") || clause.includes("今晚")) return true;
    return ZH_WEEKDAYS.some((w) => clause.includes(w)) || ZH_WEEKDAYS_ALT.some((w) => clause.includes(w));
  }

  // Chinese date signal first, then falls back to the English one ("我明天有
  // 个meeting" already works off 明天 alone, but "我有个meeting tomorrow"
  // has no Chinese date word at all) — parseEventDate itself already
  // defaults to today when nothing matches, so this fallback is always safe.
  function parseEventDateChinese(clause) {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    if (clause.includes("明天")) {
      base.setDate(base.getDate() + 1);
      return base;
    }
    for (let i = 0; i < 7; i++) {
      if (clause.includes(ZH_WEEKDAYS[i]) || clause.includes(ZH_WEEKDAYS_ALT[i])) {
        const diff = (i - base.getDay() + 7) % 7;
        base.setDate(base.getDate() + diff);
        return base;
      }
    }
    return parseEventDate(clause);
  }

  // \w in a JS regex never matches CJK characters, so an English pattern
  // anchored with ^ (like TELEGRAPHIC_LOCATION_PATTERN) can't match at all
  // while a leading 我/我的/的 is still attached — strip it first so "我的
  // purse on the table" tests the same as "purse on the table".
  function stripLeadingZhPronoun(clause) {
    return clause.trim().replace(/^(我的?|的)/, "").trim();
  }

  // Checks Chinese-language signals first, then falls back to the English
  // ones for clauses that keep Chinese grammar (在/了/我) but swap in an
  // English noun, verb, or date word — "我的wallet在table上", "我有个
  // meeting tomorrow", "我bought牛奶". The English patterns/word lists are
  // safe to reuse here since they only match Latin-letter content and simply
  // won't fire on a clause that's pure Chinese.
  function classifyCategoryChinese(clause) {
    if (ZH_LOCATION_PATTERN.test(clause)) return "find";
    const stripped = stripLeadingZhPronoun(clause);
    if (LOCATION_PATTERN.test(stripped) || TELEGRAPHIC_LOCATION_PATTERN.test(stripped)) return "find";
    if (isChineseCalendarEvent(clause) || isCalendarEvent(clause)) return "calendar";
    if (hasChineseCompletionMarker(clause)) return "done";
    const latinFirst = firstLatinWord(clause);
    if (PRESENT_TENSE_EXCEPTIONS.has(latinFirst)) return "todo";
    if (PAST_TENSE_VERBS.has(latinFirst) || /ed$/i.test(latinFirst)) return "done";
    return "todo";
  }

  function cleanChineseFragment(clause) {
    let text = clause.trim().replace(/^(我的?|的)/, "").trim();
    text = text.replace(LEADING_PRONOUN, "").trim();
    return text || clause.trim();
  }

  function formatChineseForCategory(clause, categoryId) {
    if (categoryId === "find") {
      const match = clause.match(ZH_LOCATION_PATTERN);
      if (match) {
        const item = match[1].trim().replace(/^(我的?|的)/, "").trim();
        const place = match[2].trim();
        return `${item}：${place}`;
      }
      // No 在 — the location word itself was probably said in English
      // ("我的wallet on the table") — fall back to the English patterns.
      const stripped = stripLeadingZhPronoun(clause);
      const enMatch = stripped.match(LOCATION_PATTERN) || stripped.match(TELEGRAPHIC_LOCATION_PATTERN);
      if (enMatch) {
        const item = enMatch[1].trim().replace(LEADING_PRONOUN, "").replace(LEADING_ARTICLE, "").trim();
        const place = enMatch[2].trim();
        return `${item}：${place}`;
      }
    }
    return cleanChineseFragment(clause);
  }

  // No spaces means boundary-detection has to work on character position
  // instead of word-array position. Repeating 我 (wǒ, "I") mid-sentence is
  // the Chinese equivalent of English "I" restarting a new clause — except
  // when it's the OBJECT of the current clause instead of a new subject:
  // "在我的包里" ("in my bag") — 我 right after 在/跟/和/etc. is still part
  // of what's already being said, not a fresh restart.
  const ZH_RESTART_CHAR = "我";
  const ZH_BLOCKERS_BEFORE_RESTART = ["在", "跟", "和", "给", "帮", "让", "陪", "把", "对"];

  function insertImplicitBoundariesChinese(text) {
    let result = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === ZH_RESTART_CHAR && i > 0 && !ZH_BLOCKERS_BEFORE_RESTART.includes(text[i - 1])) {
        result += "。";
      }
      result += ch;
    }
    return result;
  }

  const ZH_FILLER_PATTERN = /^(就这样|没了|好了|就这些|没有了)$/;

  // The pause-timer (PAUSE_BREAK_MS below) inserts breaks based on timing
  // alone, with no idea where a Chinese phrase can and can't be cut — so a
  // pause mid-phrase ("我....的手机在...") can slice a clause apart at a
  // meaningless spot. 的 (de) can never legitimately start a clause on its
  // own — it's always attached to what came right before it — so a clause
  // starting with 的 gets glued back onto the previous one. And a leftover
  // fragment that's ONLY "我"/"我的"/"的" with nothing else isn't a complete
  // thought either — glue it onto the next clause instead, since it's the
  // truncated lead-in to whatever follows.
  const ZH_BARE_LEADIN = /^(我的?|的)$/;

  function mergeChineseOrphanFragments(clauses) {
    const merged = [];
    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i];
      if (clause.startsWith("的") && merged.length > 0) {
        merged[merged.length - 1] += clause;
      } else if (ZH_BARE_LEADIN.test(clause) && i + 1 < clauses.length) {
        clauses[i + 1] = clause + clauses[i + 1];
      } else {
        merged.push(clause);
      }
    }
    return merged;
  }

  function splitClausesChinese(transcript) {
    const raw = insertImplicitBoundariesChinese(transcript)
      .split(/[,，。.;；]|然后/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((clause) => !ZH_FILLER_PATTERN.test(clause));
    return mergeChineseOrphanFragments(raw);
  }

  function handleTranscript(transcript) {
    const chinese = isChineseText(transcript);
    const clauses = chinese ? splitClausesChinese(transcript) : splitClauses(transcript);
    if (clauses.length === 0) return false;
    clauses.forEach((clause) => {
      if (isChineseText(clause)) {
        const categoryId = classifyCategoryChinese(clause);
        if (categoryId === "calendar") {
          addCalendarEvent(parseEventDateChinese(clause), cleanChineseFragment(clause));
        } else {
          addItem(categoryId, formatChineseForCategory(clause, categoryId));
        }
        return;
      }
      const categoryId = classifyCategory(clause);
      if (categoryId === "calendar") {
        addCalendarEvent(parseEventDate(clause), cleanFragment(clause));
      } else {
        addItem(categoryId, formatForCategory(clause, categoryId));
      }
    });
    return true;
  }

  // ---------- Celebration ----------
  // Fires once each time "Needs to Be Done" and "Find My Place" both become
  // empty — i.e. the moment an action *causes* the all-clear state, not every
  // time the page happens to load into it. The flag resets the instant either
  // list gains an item again, so clearing out re-triggers it next time too.
  let allClearCelebrated = false;

  function checkAllClear() {
    const store = loadStore();
    const allClear = store.todo.length === 0 && store.find.length === 0;
    if (allClear && !allClearCelebrated) {
      allClearCelebrated = true;
      launchConfetti();
    } else if (!allClear) {
      allClearCelebrated = false;
    }
  }

  function launchConfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "9999";
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const COLORS = ["#7c5cff", "#ff7ab8", "#ffd166", "#06d6a0", "#ef476f"];
    const GRAVITY = 0.28;
    const DRAG = 0.995;

    function makeBurst(originX, angleMinDeg, angleMaxDeg) {
      const particles = [];
      for (let i = 0; i < 55; i++) {
        const angle = (angleMinDeg + Math.random() * (angleMaxDeg - angleMinDeg)) * (Math.PI / 180);
        const speed = 9 + Math.random() * 9;
        particles.push({
          x: originX,
          y: H + 10,
          vx: Math.cos(angle) * speed,
          vy: -Math.sin(angle) * speed,
          size: 5 + Math.random() * 5,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          rotation: Math.random() * 360,
          spin: (Math.random() - 0.5) * 18,
          life: 1,
          decay: 0.006 + Math.random() * 0.004,
        });
      }
      return particles;
    }

    // Left cannon fans up-and-right, right cannon fans up-and-left, so the
    // two streams cross in the middle like a pair of party poppers.
    let particles = [...makeBurst(-10, 55, 85), ...makeBurst(W + 10, 95, 125)];

    let rafId;
    function tick() {
      ctx.clearRect(0, 0, W, H);
      particles.forEach((p) => {
        p.vx *= DRAG;
        p.vy = p.vy * DRAG + GRAVITY;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;
        p.life -= p.decay;

        if (p.life <= 0) return;
        ctx.save();
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
        ctx.restore();
      });

      particles = particles.filter((p) => p.life > 0 && p.y < H + 50);

      if (particles.length > 0) {
        rafId = requestAnimationFrame(tick);
      } else {
        canvas.remove();
      }
    }
    rafId = requestAnimationFrame(tick);

    // Safety net in case particles never fully clear (e.g. a backgrounded tab
    // stalls rAF) so a stray canvas doesn't linger over the page forever.
    setTimeout(() => {
      if (canvas.isConnected) {
        cancelAnimationFrame(rafId);
        canvas.remove();
      }
    }, 4000);
  }

  // ---------- Storage ----------
  function loadStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
      return {
        done: raw.done || [],
        todo: raw.todo || [],
        find: raw.find || [],
        calendar: {
          moods: (raw.calendar && raw.calendar.moods) || {},
          events: (raw.calendar && raw.calendar.events) || {},
        },
      };
    } catch (e) {
      return { done: [], todo: [], find: [], calendar: { moods: {}, events: {} } };
    }
  }

  function saveStore(store) {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }

  // "Wallet: Bed" said again later as "wallet is on the car" should update
  // the wallet, not create a second wallet entry — compares the part before
  // the colon, case-insensitively.
  function findExistingByItemName(list, text) {
    const colonIdx = text.indexOf(":");
    if (colonIdx === -1) return -1;
    const itemName = text.slice(0, colonIdx).trim().toLowerCase();
    return list.findIndex((it) => {
      const idx = it.text.indexOf(":");
      return idx !== -1 && it.text.slice(0, idx).trim().toLowerCase() === itemName;
    });
  }

  function addItem(categoryId, text) {
    const store = loadStore();

    if (categoryId === "find") {
      const existingIdx = findExistingByItemName(store.find, text);
      if (existingIdx !== -1) {
        // Update in place — same position, same day-group, same id. Only a
        // genuinely new item earns a new spot at the bottom; correcting
        // where something already-logged actually is isn't a new item.
        store.find[existingIdx].text = text;
        saveStore(store);
        renderList(categoryId);
        return;
      }
    }

    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, checked: false };
    store[categoryId].push(item);
    saveStore(store);
    renderList(categoryId);
  }

  function updateItemChecked(categoryId, itemId, checked) {
    const store = loadStore();
    const item = store[categoryId].find((it) => it.id === itemId);
    if (item) {
      item.checked = checked;
      saveStore(store);
    }
  }

  function deleteItem(categoryId, itemId) {
    const store = loadStore();
    store[categoryId] = store[categoryId].filter((it) => it.id !== itemId);
    saveStore(store);
  }

  // Checking off a "Needs to Be Done" item graduates it into the "Already
  // Done" log instead of just sitting there checked. A short delay leaves
  // time for the strikethrough to register (and for an accidental tap to be
  // undone by unchecking) before the item actually moves.
  const MOVE_DELAY_MS = 550;
  const pendingMoves = new Map();

  function moveToDone(categoryId, itemId) {
    moveItem(categoryId, itemId, "done");
  }

  // General-purpose move between lists — used both by the "graduate to Done"
  // flow above and by the manual move buttons on every item, which exist
  // because auto-categorization is a heuristic guess and will sometimes be
  // wrong (e.g. an ambiguous verb).
  function moveItem(fromCategoryId, itemId, toCategoryId) {
    if (fromCategoryId === toCategoryId) return;

    const pending = pendingMoves.get(itemId);
    if (pending) {
      clearTimeout(pending);
      pendingMoves.delete(itemId);
    }

    const store = loadStore();
    const idx = store[fromCategoryId].findIndex((it) => it.id === itemId);
    if (idx === -1) return;
    const [item] = store[fromCategoryId].splice(idx, 1);
    const movedItem = { id: item.id, text: item.text, checked: false };
    store[toCategoryId].push(movedItem);
    saveStore(store);

    renderList(fromCategoryId);
    renderList(toCategoryId);
  }

  function updateEmptyState(categoryId) {
    const list = document.getElementById(`list-${categoryId}`);
    const empty = document.getElementById(`empty-${categoryId}`);
    empty.classList.toggle("hidden", list.children.length > 0);
    checkAllClear();
  }

  // ---------- Rendering (three lists, grouped by day) ----------
  // Items carry no separate "created at" field — their id is
  // `${Date.now()}-${random}`, so the leading number IS the timestamp. A
  // moved item keeps its original id, so it's still grouped under the day it
  // was first said, not the day it was moved.
  function itemTimestamp(item) {
    const ts = parseInt(String(item.id).split("-")[0], 10);
    return Number.isFinite(ts) ? ts : Date.now();
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function formatDayHeading(dayStartTs) {
    const today = startOfDay(Date.now());
    const yesterday = today - 86400000;
    if (dayStartTs === today) return "Today";
    if (dayStartTs === yesterday) return "Yesterday";
    return new Date(dayStartTs).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function buildItemNode(categoryId, item) {
    const type = CATEGORIES[categoryId].type;
    const li = document.createElement("li");
    li.dataset.id = item.id;

    if (type === "checklist") {
      if (item.checked) li.classList.add("checked");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.checked;
      const span = document.createElement("span");
      span.className = "item-text";
      span.textContent = item.text;
      li.append(checkbox, span);
      li.addEventListener("click", (e) => {
        if (e.target.closest(".item-actions")) return;
        if (e.target !== checkbox) checkbox.checked = !checkbox.checked;
        const checked = checkbox.checked;
        li.classList.toggle("checked", checked);
        updateItemChecked(categoryId, item.id, checked);

        if (checked) {
          const timeoutId = setTimeout(() => {
            pendingMoves.delete(item.id);
            moveToDone(categoryId, item.id);
          }, MOVE_DELAY_MS);
          pendingMoves.set(item.id, timeoutId);
        } else {
          const pending = pendingMoves.get(item.id);
          if (pending) {
            clearTimeout(pending);
            pendingMoves.delete(item.id);
          }
        }
      });
    } else {
      const icon = document.createElement("span");
      icon.className = "item-icon";
      icon.textContent = CATEGORIES[categoryId].icon;
      const span = document.createElement("span");
      span.className = "item-text";
      span.textContent = item.text;
      li.append(icon, span);
    }

    const actions = document.createElement("div");
    actions.className = "item-actions";

    // Auto-categorization is a heuristic guess, not certainty — these let a
    // wrong guess be corrected in one tap instead of deleting and re-saying it.
    Object.keys(CATEGORIES)
      .filter((id) => id !== categoryId)
      .forEach((targetId) => {
        const moveBtn = document.createElement("button");
        moveBtn.type = "button";
        moveBtn.className = "item-move";
        moveBtn.title = `Move to ${CATEGORIES[targetId].label}`;
        moveBtn.setAttribute("aria-label", `Move to ${CATEGORIES[targetId].label}`);
        moveBtn.textContent = CATEGORIES[targetId].icon;
        moveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          moveItem(categoryId, item.id, targetId);
        });
        actions.appendChild(moveBtn);
      });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "item-delete";
    deleteBtn.title = "Delete";
    deleteBtn.setAttribute("aria-label", "Delete item");
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pending = pendingMoves.get(item.id);
      if (pending) {
        clearTimeout(pending);
        pendingMoves.delete(item.id);
      }
      deleteItem(categoryId, item.id);
      renderList(categoryId);
    });
    actions.appendChild(deleteBtn);
    li.appendChild(actions);

    return li;
  }

  // Rebuilds one list's whole DOM from the store, grouped by day. Days are
  // sorted newest-first regardless of array order, so a moved-in older item
  // can't drag its (old) day group to the top of the list.
  function renderList(categoryId) {
    const list = document.getElementById(`list-${categoryId}`);
    const store = loadStore();
    const items = store[categoryId];

    const groups = new Map();
    items.forEach((item) => {
      const day = startOfDay(itemTimestamp(item));
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(item);
    });

    list.innerHTML = "";
    [...groups.keys()].sort((a, b) => b - a).forEach((day) => {
      const header = document.createElement("li");
      header.className = "day-header";
      header.textContent = formatDayHeading(day);
      list.appendChild(header);
      groups.get(day).forEach((item) => list.appendChild(buildItemNode(categoryId, item)));
    });

    updateEmptyState(categoryId);
  }

  // ---------- Calendar ----------
  const MOODS = ["😄", "🙂", "😐", "😠", "🙁", "😢"];

  function isoDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function dateFromKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // ISO date strings sort lexicographically the same as chronologically, so
  // plain string comparison is enough — no need to go through Date objects.
  function isPastDay(key) {
    return key < isoDateKey(new Date());
  }

  let calendarViewDate = (() => {
    const d = new Date();
    d.setDate(1);
    return d;
  })();
  let selectedDayKey = isoDateKey(new Date());

  // A day that's already gone can still be looked at, but nothing new should
  // be addable to it — same reasoning as mood: you're not scheduling
  // something for a day that's already over.
  function addCalendarEvent(date, text) {
    const key = isoDateKey(date);
    if (isPastDay(key)) return;
    const store = loadStore();
    if (!store.calendar.events[key]) store.calendar.events[key] = [];
    store.calendar.events[key].push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
    });
    saveStore(store);
    renderCalendarGrid();
    if (selectedDayKey === key) renderDayDetail(key);
  }

  function deleteCalendarEvent(dayKey, eventId) {
    const store = loadStore();
    if (store.calendar.events[dayKey]) {
      store.calendar.events[dayKey] = store.calendar.events[dayKey].filter((e) => e.id !== eventId);
      if (store.calendar.events[dayKey].length === 0) delete store.calendar.events[dayKey];
    }
    saveStore(store);
    renderCalendarGrid();
    if (selectedDayKey === dayKey) renderDayDetail(dayKey);
  }

  // Mood is a "how do you feel right now" check-in, not a journal — like
  // Pillo, only today's mood can ever be set. You won't reliably remember how
  // you felt on a past day, and you can't know how you'll feel on a future
  // one, so backfilling or pre-filling either would just be noise.
  function setMood(dayKey, mood) {
    if (dayKey !== isoDateKey(new Date())) return;
    const store = loadStore();
    if (store.calendar.moods[dayKey] === mood) {
      delete store.calendar.moods[dayKey];
    } else {
      store.calendar.moods[dayKey] = mood;
    }
    saveStore(store);
    renderCalendarGrid();
    if (selectedDayKey === dayKey) renderDayDetail(dayKey);
  }

  function selectDay(key) {
    selectedDayKey = key;
    renderCalendarGrid();
    renderDayDetail(key);
    calendarDetail.classList.remove("hidden");
  }

  function renderCalendarGrid() {
    const store = loadStore();
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    calMonthLabel.textContent = calendarViewDate.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });

    const startOffset = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = isoDateKey(new Date());

    calendarGrid.innerHTML = "";

    for (let i = 0; i < startOffset; i++) {
      const pad = document.createElement("div");
      pad.className = "calendar-cell calendar-cell-pad";
      calendarGrid.appendChild(pad);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const key = isoDateKey(new Date(year, month, day));
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "calendar-cell";
      if (key === todayKey) cell.classList.add("is-today");
      if (key === selectedDayKey) cell.classList.add("is-selected");

      const num = document.createElement("span");
      num.className = "calendar-day-num";
      num.textContent = String(day);
      cell.appendChild(num);

      const mood = store.calendar.moods[key];
      if (mood) {
        const moodEl = document.createElement("span");
        moodEl.className = "calendar-day-mood";
        moodEl.textContent = mood;
        cell.appendChild(moodEl);
      }

      const events = store.calendar.events[key] || [];
      if (events.length > 0) {
        const dot = document.createElement("span");
        dot.className = "calendar-day-dot";
        dot.textContent = events.length > 1 ? String(events.length) : "";
        cell.appendChild(dot);
      }

      cell.addEventListener("click", () => selectDay(key));
      calendarGrid.appendChild(cell);
    }
  }

  function renderDayDetail(key) {
    const store = loadStore();
    calDetailDate.textContent = dateFromKey(key).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    moodPicker.innerHTML = "";
    const isToday = key === isoDateKey(new Date());
    if (isToday) {
      MOODS.forEach((mood) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mood-btn";
        btn.textContent = mood;
        btn.setAttribute("aria-label", `Mood: ${mood}`);
        if (store.calendar.moods[key] === mood) btn.classList.add("selected");
        btn.addEventListener("click", () => setMood(key, mood));
        moodPicker.appendChild(btn);
      });
    } else {
      const note = document.createElement("p");
      note.className = "mood-picker-note";
      note.textContent = store.calendar.moods[key]
        ? `Mood that day: ${store.calendar.moods[key]} (only today's mood can be changed)`
        : "Mood can only be set for today.";
      moodPicker.appendChild(note);
    }

    const events = store.calendar.events[key] || [];
    calendarEventList.innerHTML = "";
    events.forEach((ev) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.className = "item-text";
      span.textContent = ev.text;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "item-delete";
      del.textContent = "✕";
      del.setAttribute("aria-label", "Delete event");
      del.addEventListener("click", () => deleteCalendarEvent(key, ev.id));
      li.append(span, del);
      calendarEventList.appendChild(li);
    });
    calendarEventEmpty.classList.toggle("hidden", events.length > 0);

    const past = isPastDay(key);
    calendarEventForm.classList.toggle("hidden", past);
    calendarPastNote.classList.toggle("hidden", !past);
  }

  calPrev.addEventListener("click", () => {
    calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
    renderCalendarGrid();
  });
  calNext.addEventListener("click", () => {
    calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
    renderCalendarGrid();
  });
  calDetailClose.addEventListener("click", () => {
    calendarDetail.classList.add("hidden");
  });
  calendarEventForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = calendarEventInput.value.trim();
    if (!text) return;
    addCalendarEvent(dateFromKey(selectedDayKey), toTitleCase(text));
    calendarEventInput.value = "";
  });

  function renderAll() {
    const store = loadStore();
    // Seed the celebration flag from whatever's already on disk *before*
    // renderList's updateEmptyState calls below run, so loading the page into
    // an already-empty state doesn't itself count as the triggering action.
    allClearCelebrated = store.todo.length === 0 && store.find.length === 0;
    Object.keys(CATEGORIES).forEach((categoryId) => renderList(categoryId));
    renderCalendarGrid();
    renderDayDetail(selectedDayKey);
    calendarDetail.classList.remove("hidden");
  }

  renderAll();

  // ---------- App install / offline support ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is best-effort */ });
    });
  }
})();
