(() => {
  const STORE_KEY = "voicedump.rows.v1";

  const CATEGORIES = {
    done: { label: "Already Done", icon: "✅", type: "log" },
    todo: { label: "Needs to Be Done", icon: "☐", type: "checklist" },
    find: { label: "Find My Place", icon: "📍", type: "location" },
  };

  const appEl = document.querySelector(".app");
  const greetingEl = document.getElementById("greeting");
  const greetingWrap = document.querySelector(".greeting-wrap");
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
  const mascotHop = document.getElementById("mascotHop");
  const mascotImgA = document.getElementById("mascotImgA");
  const mascotImgB = document.getElementById("mascotImgB");
  const mascotWaitingCan = document.getElementById("mascotWaitingCan");
  const mascotLinePath = document.getElementById("mascotLinePath");

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
  // none so it never steals a tap meant for a real button.
  //
  // Y is a direct function of scroll progress across the WHOLE page
  // (scrollY / maxScrollY), recomputed on every scroll event with no
  // animation/easing of its own — so it can only reach the trash can once
  // the user has actually scrolled to the true bottom of the page, not just
  // past the mic. X is deliberately NOT tied to scroll progress: while in
  // transit it only ever hops between the two edges of the empty gutter to
  // the right of the content column (see mascotRightZone/mascotStartHop
  // below), one hop per scroll "burst", at its own fixed pace — so it's
  // never sitting on top of whatever the user scrolled to read, the way a
  // hop spanning the full width could. While it's between the two
  // ends it shows the jump-down/jump-up pose (whichever direction the
  // scroll is currently going); once it settles at either end it shows the
  // resting pose for that end — idle (or thinking/licking) at the mic, or
  // the trash-can idle show at the bottom.
  const MASCOT_SRC = {
    idle: "mascot/mascot-idle.png",
    thinking: "mascot/mascot-thinking.png",
    licking: "mascot/mascot-licking.png",
    licking2: "mascot/mascot-licking2.png",
    jumpDown: "mascot/mascot-jump-down.png",
    jumpUp: "mascot/mascot-jump-up.png",
    jumpIn: "mascot/mascot-jump-in.png",
    trashcan: "mascot/mascot-trashcan.png",
    trashcanDigging: "mascot/mascot-trashcan-digging.png",
    trashcanTipping: "mascot/mascot-trashcan-tipping.png",
    trashcanFallen: "mascot/mascot-trashcan-fallen.png",
    walkRight1: "mascot/mascot-walk-right-1.png",
    walkRight2: "mascot/mascot-walk-right-2.png",
    collectTrash: "mascot/mascot-collect-trash.png",
    walkTrash1: "mascot/mascot-walk-trash-1.png",
    walkTrash2: "mascot/mascot-walk-trash-2.png",
  };
  const MASCOT_MARGIN = 16;
  // Minimum gap kept between the bottom of the greeting text and the
  // mascot's resting spot above the mic — see mascotAnchors.
  const MASCOT_GREETING_GAP = 12;
  // How close scroll progress (0-1) has to be to the true top/bottom to
  // ENTER a resting state. Deliberately tight — the trash-can show
  // shouldn't start just because the mic is scrolled mostly out of view.
  const MASCOT_PROGRESS_ENTER_EPS = 0.01;
  // How far scroll progress has to move AWAY from the end to actually LEAVE
  // a resting state once already there. Deliberately much looser than the
  // enter threshold — real touch scrolling rubber-bands/bounces a few dozen
  // pixels past the true edge and back, and without this gap every one of
  // those bounces would toggle the resting state off and on, restarting the
  // whole trash-can show from step 0 each time (which is exactly what
  // looked like "images lasting less than a second" / the loop "not working
  // out" — the loop WAS working, it just kept getting restarted).
  const MASCOT_PROGRESS_EXIT_EPS = 0.06;
  // Duration of one side-to-side hop during transit — fixed, so the hop
  // cadence never speeds up or slows down with how fast the user scrolls.
  // Written into --mascot-hop-ms on mascotWrap below, which both the
  // .mascot-hop transition and the .mascot-hopping jump-arc animation in
  // style.css read from — so this one number is the only place hop speed
  // is ever tuned.
  const MASCOT_HOP_MS = 620;
  // The "go collect the trash, carry it to the can, walk back" performance
  // (see mascotStartFetchTrash) covers three very different distances — a
  // short hop left to the trash, then all the way over to the can's column
  // on the right, then back — so each leg's duration is derived from how
  // far it actually travels rather than a single fixed time, the same way
  // MASCOT_TRACE_SPEED_PX_MS paces the line-tracing easter egg. Clamped so
  // a short leg still reads as a walk (not a flicker) and a long one still
  // arrives promptly instead of taking forever on a wide viewport.
  const MASCOT_WALK_MS_PER_PX = 4;
  const MASCOT_WALK_MIN_LEG_MS = 450;
  const MASCOT_WALK_MAX_LEG_MS = 1400;
  // How far left of its resting spot (at the mic) the trash sits.
  const MASCOT_FETCH_DISTANCE_PX = 130;
  const MASCOT_FETCH_COLLECT_MS = 550;
  const MASCOT_FETCH_DROP_MS = 350; // how long it lingers over the can before heading back
  const MASCOT_WALK_STEP_MS = 200; // how often the walk-cycle pose alternates
  // A mouse press that never moves this far is a click on the page
  // background, not an attempt to draw a line — below this, nothing about
  // the drawing feature ever activates, so a stray pixel of jitter during
  // a normal click can't accidentally start it.
  const MASCOT_TRACE_MIN_DRAG_PX = 10;
  // How fast the mascot travels along a drawn line, in px of path per ms —
  // used to turn the line's length into a travel duration, clamped so a
  // tiny scribble doesn't finish instantly and a page-spanning line doesn't
  // take forever.
  const MASCOT_TRACE_SPEED_PX_MS = 0.9;
  const MASCOT_TRACE_MIN_MS = 220;
  const MASCOT_TRACE_MAX_MS = 2200;
  // How recently a scroll event has to have landed, at the moment a hop
  // finishes, for that to count as "still scrolling" and chain into
  // another hop. A single small scroll (one flick, a few wheel ticks) still
  // fires a handful of scroll events in a quick burst, so "did ANY scroll
  // event happen at some point during this hop" (the old check) was true
  // almost every time, even for a tiny nudge — that's what caused a barely-
  // there scroll to still bounce the mascot there and immediately back.
  // Requiring the LAST scroll event to be recent, rather than merely
  // having happened at some point mid-hop, is what actually distinguishes
  // "still scrolling right now" from "scrolled a little a while ago."
  const MASCOT_HOP_CHAIN_RECENCY_MS = 180;
  let mascotState = "idle"; // idle | thinking | licking | fetching
  let mascotRestingWhere = null; // "mic" | "bottom" | "mid" | null (null = actively scrolling)
  let mascotLickTimer = null;
  let mascotTravelTimer = null;
  let mascotLoopTimer = null;
  // The "walk over, collect the trash, walk back" performance — see
  // mascotStartFetchTrash. mascotFetching guards against a second utterance
  // starting a new walk while one is already in flight.
  let mascotFetching = false;
  let mascotFetchTimer = null;
  let mascotFetchStepTimer = null;
  let mascotFetchTransitionHandler = null;
  // Which margin the mascot is currently on/hopping toward during transit,
  // and whether a hop is in flight — see mascotStartHop.
  let mascotHopSide = "right"; // "left" | "right"
  let mascotHopping = false;
  let mascotHopTimer = null;
  // Freshest scroll direction/progress/timestamp seen, read by
  // mascotStartHop when it fires — including when chained from a completed
  // hop's own timeout, where the values that triggered the ORIGINAL hop
  // would otherwise be stale.
  let mascotLastScrollDir = "down"; // "up" | "down"
  let mascotLastProgressSeen = 0;
  let mascotLastScrollAt = 0;

  // Every assignment to mascotRestingWhere goes through here so the waiting
  // can (the empty-can prop that previews where the mascot is headed) stays
  // in sync automatically — visible any time the mascot ISN'T actually
  // resting in it yet, hidden once its own can-inclusive artwork takes over.
  function mascotSetRestingWhere(where) {
    mascotRestingWhere = where;
    mascotWaitingCan.classList.toggle("hidden", where === "bottom");
    // The trash-can poses need a bigger, taller box than everything else
    // (idle/thinking/licking/jump-up/jump-down) to show the can at a solid,
    // consistent size without cropping the raccoon — see .mascot-at-can in
    // style.css. Toggling it only for "bottom" keeps every OTHER pose in
    // the small square box those images were actually drawn for, which is
    // what keeps things like the mic-overlap math simple and correct: the
    // box height genuinely matches the visible content again, instead of
    // being inflated by can-sized padding no other pose needs.
    mascotWrap.classList.toggle("mascot-at-can", where === "bottom");
  }

  // Two stacked <img> layers (see .mascot-img in style.css) that swap which
  // one is on top every pose change, crossfading between them — at any
  // instant during the swap, at least one layer is opaque, so the mascot
  // never actually goes fully transparent. A single-<img> fade (set
  // opacity to 0, swap src, fade back to 1) was tried before this and
  // always had a moment of true invisibility in the middle — however
  // short, that reads as a flash/blink, not a smooth fade, no matter how
  // the timing is tuned. Two layers is what actually fixes it, not a
  // shorter or longer transition on one layer.
  let mascotImgFront = mascotImgA;
  let mascotImgBack = mascotImgB;
  let mascotCurrentTarget = mascotImgA.getAttribute("src");

  function mascotSetImage(state) {
    const src = MASCOT_SRC[state];
    if (mascotCurrentTarget === src) return; // already showing (or fading to) this pose
    mascotCurrentTarget = src;
    mascotImgBack.src = src; // preloaded already (see the warm-cache pass below), so this paints immediately
    mascotImgBack.classList.remove("mascot-img-hidden");
    mascotImgFront.classList.add("mascot-img-hidden");
    const swap = mascotImgFront;
    mascotImgFront = mascotImgBack;
    mascotImgBack = swap;
  }

  // Y is written to mascotWrap (instant, no transition) and X to the inner
  // mascotHop (which carries its own CSS transition) — see the comment on
  // .mascot-wrap in style.css for why they're split across two elements.
  function mascotMoveTo(x, y) {
    const w = mascotWrap.offsetWidth || 118;
    const h = mascotWrap.offsetHeight || 118;
    const maxX = window.innerWidth - w - MASCOT_MARGIN;
    const maxY = window.innerHeight - h - MASCOT_MARGIN;
    const clampedX = Math.max(MASCOT_MARGIN, Math.min(maxX, x));
    const clampedY = Math.max(MASCOT_MARGIN, Math.min(maxY, y));
    mascotWrap.style.transform = `translate3d(0, ${clampedY}px, 0)`;
    mascotHop.style.transform = `translate3d(${clampedX}px, 0, 0)`;
  }

  // The trash can lives in the empty gutter to the right of the content
  // column (.app), not centered in the viewport — so both the hop's
  // zigzag and the can's final resting spot stay inside that same real
  // empty space instead of ever crossing over actual content. On a wide
  // viewport that gutter is genuinely empty (nothing to block). On a
  // narrow/mobile one .app fills the width already, so there's no gutter
  // to speak of — leftEdge collapses down to meet rightEdge instead of
  // forcing a wide zigzag across content that isn't actually empty.
  function mascotRightZone() {
    const w = mascotWrap.offsetWidth || 118;
    const rightEdge = window.innerWidth - w - MASCOT_MARGIN;
    const appRight = appEl ? appEl.getBoundingClientRect().right : rightEdge;
    const leftEdge = Math.min(appRight + MASCOT_MARGIN, rightEdge);
    return { leftEdge, rightEdge };
  }

  // The X coordinate of whichever margin mascotHopSide currently points at.
  function mascotSideX(side) {
    const zone = mascotRightZone();
    return side === "left" ? zone.leftEdge : zone.rightEdge;
  }

  // Both anchors, freshly computed — cheap enough to call on every scroll
  // event. micY is expressed as "where the mic would put the mascot if
  // scrollY were 0" (i.e. corrected back to a scroll-invariant number) so it
  // can be blended against the scroll-invariant bottomY by progress alone.
  function mascotAnchors() {
    const micRect = micBtn.getBoundingClientRect();
    const w = mascotWrap.offsetWidth || 118;
    const h = mascotWrap.offsetHeight || 118;
    // Floating h*0.75 above the mic is normally enough clearance, but on a
    // short/narrow viewport (or if the greeting text wraps to an extra
    // line) that can still land on top of the greeting instead of above
    // it — so it's also never allowed higher than the greeting block's own
    // bottom edge, measured live rather than assumed from a fixed margin.
    const greetingBottom = greetingWrap.getBoundingClientRect().bottom + window.scrollY;
    return {
      micX: micRect.left + micRect.width / 2 - w / 2,
      micY: Math.max(
        micRect.top + window.scrollY - h * 0.75,
        greetingBottom + MASCOT_GREETING_GAP
      ),
      // Flush with the right edge of the hop zone — the same spot the
      // rightmost hop already lands on, so settling into the can never
      // needs a final horizontal jump of its own.
      bottomX: mascotRightZone().rightEdge,
      bottomY: window.innerHeight - h - MASCOT_MARGIN,
    };
  }

  function mascotMaxScrollY() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  function mascotClearTravel() {
    if (mascotTravelTimer) clearTimeout(mascotTravelTimer);
    mascotTravelTimer = null;
  }

  function mascotClearHop() {
    if (mascotHopTimer) clearTimeout(mascotHopTimer);
    mascotHopTimer = null;
    mascotHopping = false;
    mascotWrap.classList.remove("mascot-hopping");
  }

  // Flips to the other margin and animates there over the fixed
  // MASCOT_HOP_MS (the .mascot-hop CSS transition does the actual easing —
  // this just sets the new target). When this hop lands, it only chains
  // straight into another one if a scroll event has landed within the last
  // MASCOT_HOP_CHAIN_RECENCY_MS — i.e. the user is still actively
  // scrolling right now, not just "scrolled at some point during this
  // hop." Otherwise it hands off to the mid-idle show.
  function mascotStartHop() {
    mascotHopping = true;
    mascotHopSide = mascotHopSide === "left" ? "right" : "left";
    mascotSetImage(mascotLastScrollDir === "up" ? "jumpUp" : "jumpDown");
    // Remove-then-reflow-then-add so the CSS animation restarts from 0%
    // every hop, even back-to-back chained ones — just re-adding an
    // already-present class doesn't retrigger a CSS animation.
    mascotWrap.classList.remove("mascot-hopping");
    void mascotWrap.offsetWidth;
    mascotWrap.classList.add("mascot-hopping");
    const a = mascotAnchors();
    const y = a.micY + (a.bottomY - a.micY) * mascotLastProgressSeen;
    mascotMoveTo(mascotSideX(mascotHopSide), y);
    mascotHopTimer = setTimeout(() => {
      mascotHopping = false;
      if (performance.now() - mascotLastScrollAt < MASCOT_HOP_CHAIN_RECENCY_MS) {
        mascotStartHop();
      } else {
        mascotWrap.classList.remove("mascot-hopping");
        mascotScheduleMidIdle();
      }
    }, MASCOT_HOP_MS);
  }

  // Bumped every time the loop is cleared, and checked by each in-flight
  // step before it acts — a defensive guard against two overlapping loop
  // chains ever both being able to touch the DOM (which would show a step
  // from one chain's image next to a different step's class, or otherwise
  // desync image/class/timing), regardless of what causes the overlap.
  let mascotLoopToken = 0;

  function mascotClearBottomLoop() {
    if (mascotLoopTimer) clearTimeout(mascotLoopTimer);
    mascotLoopTimer = null;
    mascotLoopToken++;
    mascotWrap.classList.remove("mascot-wiggle", "mascot-toppled", "mascot-sideways");
  }

  // The idle show that plays once the mascot settles at the bottom, in two
  // parts that are deliberately NOT one big loop:
  //
  //   INTRO plays exactly once, beat per line:
  //     1. settled in the can, just its rear + tail sticking out
  //     2-4. rummaging around inside (paws flailing — real motion between
  //          two different poses, not a CSS shake of one static image)
  //     5. the can visibly shaking from all the commotion (CSS wiggle)
  //     6. rim gone askew, right on the verge (real art — trashcanTipping —
  //        not a CSS fake; a flat rotation can't reproduce how the rim
  //        ellipse and base actually foreshorten mid-tip, which is exactly
  //        what made the old CSS-only topple look like it span past a
  //        believable fall)
  //     7. it goes all the way over (CSS rotate, bridging the gap between
  //        the tipping art above and the fallen art below — direction
  //        matters here, see .mascot-toppled in style.css)
  //     8. climbing out into the mess it made — held long, since it's the
  //        busiest, most detail-rich frame and needs time to actually read
  //   It does NOT loop back around to beat 1. There's no artwork showing
  //   the raccoon climbing back INTO a can that's now lying tipped over on
  //   the ground, so the only way to repeat the intro would be to cut
  //   straight from "just climbed out" back to "resting inside, can
  //   upright again" — which is exactly the "in, out, in, out, doesn't
  //   connect" jump this used to make, once every ~10 seconds.
  //
  //   STEADY is what plays forever after the intro finishes: the raccoon
  //   sitting by the fallen can licking its paws clean. This one genuinely
  //   IS a loop, because licking and licking2 are two frames of the SAME
  //   continuous action, not two different scenes standing in for each
  //   other.
  //
  // Every frame is padded to the same 320x320 canvas (see pad_canvas.py) so
  // the mascot's on-screen size never jumps between beats. Each step only
  // schedules the next one if we're still resting at the bottom, so
  // scrolling away at any point cuts the show off cleanly instead of a
  // stray step firing later.
  const MASCOT_BOTTOM_INTRO = [
    { img: "trashcan", cls: [], hold: () => 2800 + Math.random() * 1200 },
    { img: "trashcanDigging", cls: [], hold: 550 },
    { img: "trashcan", cls: [], hold: 450 },
    { img: "trashcanDigging", cls: [], hold: 550 },
    { img: "trashcan", cls: ["mascot-wiggle"], hold: 900 },
    { img: "trashcanTipping", cls: [], hold: 550 },
    { img: "trashcan", cls: ["mascot-toppled"], hold: 450 },
    { img: "trashcanFallen", cls: [], hold: 2600 },
  ];

  const MASCOT_BOTTOM_STEADY = [
    { img: "licking", cls: [], hold: 500 },
    { img: "licking2", cls: [], hold: 500 },
  ];

  function mascotBottomLoopStep(i, token) {
    if (mascotRestingWhere !== "bottom" || token !== mascotLoopToken) return;
    const step = i < MASCOT_BOTTOM_INTRO.length
      ? MASCOT_BOTTOM_INTRO[i]
      : MASCOT_BOTTOM_STEADY[(i - MASCOT_BOTTOM_INTRO.length) % MASCOT_BOTTOM_STEADY.length];
    mascotWrap.classList.remove("mascot-wiggle", "mascot-toppled", "mascot-sideways");
    step.cls.forEach((c) => mascotWrap.classList.add(c));
    mascotSetImage(step.img);
    const hold = typeof step.hold === "function" ? step.hold() : step.hold;
    mascotLoopTimer = setTimeout(() => mascotBottomLoopStep(i + 1, token), hold);
  }

  // The initial dive in, upright — after this the repeating show above
  // takes over (which starts with the same settled "half in" pose).
  function mascotStartBottomShow() {
    mascotClearBottomLoop(); // bumps mascotLoopToken, invalidating any prior chain
    const token = mascotLoopToken;
    mascotSetImage("jumpIn");
    mascotTravelTimer = setTimeout(() => {
      if (mascotRestingWhere !== "bottom" || token !== mascotLoopToken) return;
      mascotBottomLoopStep(0, token);
    }, 550);
  }

  let mascotLickCycleTimer = null;

  function mascotEnterThinking() {
    if (mascotLickTimer) clearTimeout(mascotLickTimer);
    if (mascotLickCycleTimer) clearTimeout(mascotLickCycleTimer);
    mascotClearTravel();
    mascotClearBottomLoop();
    mascotClearMidIdle();
    mascotClearHop();
    if (mascotFetching) mascotCancelFetch();
    mascotState = "thinking";
    mascotSetRestingWhere("mic");
    mascotWrap.classList.remove("mascot-licking");
    mascotWrap.classList.add("mascot-thinking");
    mascotSetImage("thinking");
    const a = mascotAnchors();
    mascotMoveTo(a.micX, a.micY);
  }

  // Tongue actually goes back and forth between the two licking frames for
  // the whole hold, instead of sitting on one static illustration.
  function mascotEnterLicking() {
    mascotState = "licking";
    mascotWrap.classList.remove("mascot-thinking");
    mascotWrap.classList.add("mascot-licking");
    const a = mascotAnchors();
    mascotMoveTo(a.micX, a.micY);
    let frame = 0;
    const cycle = () => {
      mascotSetImage(frame % 2 === 0 ? "licking" : "licking2");
      frame++;
      mascotLickCycleTimer = setTimeout(cycle, 420);
    };
    cycle();
    mascotLickTimer = setTimeout(() => {
      clearTimeout(mascotLickCycleTimer);
      mascotEnterIdle();
    }, 2600);
  }

  function mascotEnterIdle() {
    mascotState = "idle";
    mascotWrap.classList.remove("mascot-thinking", "mascot-licking");
    mascotSetRestingWhere(null); // force mascotUpdateFromScroll to re-settle
    mascotUpdateFromScroll();
  }

  // ---------- Draw-a-line easter egg ----------
  // Press and drag anywhere on the page (except on top of a real control —
  // see mascotIsInteractiveTarget) to draw a freehand line; the mascot drops
  // whatever it was doing and hops along it, jumpDown pose, then the line
  // fades and it resumes normal scroll-driven behavior (see mascotEnterIdle).
  // On a mouse this is a plain drag (mousedown/mousemove/mouseup). On a
  // touchscreen, one finger always means "draw" and two fingers always mean
  // "scroll" (see the touchstart/touchmove/touchend handlers below) — since
  // a one-finger touch drag would otherwise be indistinguishable from a
  // scroll gesture, scrolling is deliberately moved onto its own two-finger
  // gesture so one finger is free for drawing, mirroring the mouse's drag.
  function mascotIsInteractiveTarget(el) {
    return !!(el && el.closest && el.closest("button, a, input, textarea, select, label"));
  }

  let mascotDrawStartX = 0;
  let mascotDrawStartY = 0;
  let mascotIsDrawing = false; // past the drag threshold — actually drawing, not just a click
  let mascotTracePoints = [];
  let mascotTraceToken = 0;
  let mascotTraceRaf = null;

  function mascotResetLine() {
    mascotLinePath.setAttribute("d", "");
    mascotLinePath.classList.remove("mascot-line-fading");
  }

  function mascotAppendLinePoint(x, y) {
    mascotTracePoints.push({ x, y });
    const d = mascotTracePoints
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
    mascotLinePath.setAttribute("d", d);
  }

  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || mascotIsInteractiveTarget(e.target)) return;
    // Prevented right here on mousedown, not reactively later on mousemove
    // — once the browser's native text-selection drag actually starts, a
    // few pixels in, calling preventDefault on subsequent mousemoves alone
    // doesn't reliably stop the selection highlight that already kicked
    // off, and that highlight sweeping over the page is exactly what made
    // the drawn line hard to even notice, let alone see clearly.
    e.preventDefault();
    document.body.classList.add("mascot-drawing-active");
    mascotDrawStartX = e.clientX;
    mascotDrawStartY = e.clientY;
    mascotIsDrawing = false;
    mascotTracePoints = [{ x: e.clientX, y: e.clientY }];
  });

  document.addEventListener("mousemove", (e) => {
    if (mascotTracePoints.length === 0) return; // no mousedown in flight
    if (!mascotIsDrawing) {
      const dx = e.clientX - mascotDrawStartX;
      const dy = e.clientY - mascotDrawStartY;
      if (Math.hypot(dx, dy) < MASCOT_TRACE_MIN_DRAG_PX) return;
      mascotIsDrawing = true; // committed — this is a drag, not a click
      mascotResetLine();
      mascotAppendLinePoint(mascotDrawStartX, mascotDrawStartY);
    }
    const last = mascotTracePoints[mascotTracePoints.length - 1];
    if (Math.hypot(e.clientX - last.x, e.clientY - last.y) >= 4) {
      mascotAppendLinePoint(e.clientX, e.clientY);
    }
  });

  document.addEventListener("mouseup", () => {
    document.body.classList.remove("mascot-drawing-active");
    if (mascotIsDrawing) mascotStartTrace(mascotTracePoints);
    mascotIsDrawing = false;
    mascotTracePoints = [];
  });

  // Touch is handled separately from mouse (not just fed through the same
  // listeners) because the finger count itself is the mode switch: 1 finger
  // draws, 2+ fingers scroll the page (see the comment above). null while no
  // gesture is in flight, so a fresh 1-finger touch can start a new draw.
  let mascotTouchMode = null; // null | "draw" | "scroll"
  let mascotScrollLastX = 0;
  let mascotScrollLastY = 0;

  function mascotAverageTouch(touches) {
    let x = 0, y = 0;
    for (let i = 0; i < touches.length; i++) {
      x += touches[i].clientX;
      y += touches[i].clientY;
    }
    return { x: x / touches.length, y: y / touches.length };
  }

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length >= 2) {
      mascotTouchMode = "scroll";
      mascotIsDrawing = false;
      mascotTracePoints = [];
      mascotResetLine();
      document.body.classList.remove("mascot-drawing-active");
      const avg = mascotAverageTouch(e.touches);
      mascotScrollLastX = avg.x;
      mascotScrollLastY = avg.y;
      return;
    }
    if (e.touches.length === 1 && mascotTouchMode === null) {
      if (mascotIsInteractiveTarget(e.target)) return;
      const t = e.touches[0];
      mascotTouchMode = "draw";
      e.preventDefault();
      document.body.classList.add("mascot-drawing-active");
      mascotDrawStartX = t.clientX;
      mascotDrawStartY = t.clientY;
      mascotIsDrawing = false;
      mascotTracePoints = [{ x: t.clientX, y: t.clientY }];
    }
  }, { passive: false });

  document.addEventListener("touchmove", (e) => {
    if (mascotTouchMode === "scroll" || e.touches.length >= 2) {
      if (mascotTouchMode !== "scroll") {
        // A second finger landed mid-draw — abandon the line and switch to
        // scrolling rather than trying to salvage a partial trace.
        mascotTouchMode = "scroll";
        mascotIsDrawing = false;
        mascotTracePoints = [];
        mascotResetLine();
        document.body.classList.remove("mascot-drawing-active");
      }
      const avg = mascotAverageTouch(e.touches);
      window.scrollBy(mascotScrollLastX - avg.x, mascotScrollLastY - avg.y);
      mascotScrollLastX = avg.x;
      mascotScrollLastY = avg.y;
      e.preventDefault();
      return;
    }
    if (mascotTouchMode !== "draw") return;
    e.preventDefault();
    const t = e.touches[0];
    if (!mascotIsDrawing) {
      const dx = t.clientX - mascotDrawStartX;
      const dy = t.clientY - mascotDrawStartY;
      if (Math.hypot(dx, dy) < MASCOT_TRACE_MIN_DRAG_PX) return;
      mascotIsDrawing = true;
      mascotResetLine();
      mascotAppendLinePoint(mascotDrawStartX, mascotDrawStartY);
    }
    const last = mascotTracePoints[mascotTracePoints.length - 1];
    if (Math.hypot(t.clientX - last.x, t.clientY - last.y) >= 4) {
      mascotAppendLinePoint(t.clientX, t.clientY);
    }
  }, { passive: false });

  document.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) {
      if (mascotTouchMode === "draw" && mascotIsDrawing) mascotStartTrace(mascotTracePoints);
      mascotTouchMode = null;
      mascotIsDrawing = false;
      mascotTracePoints = [];
      document.body.classList.remove("mascot-drawing-active");
    } else if (e.touches.length === 1 && mascotTouchMode === "scroll") {
      // One finger lifted after a 2-finger scroll — resync to the remaining
      // finger but stay in scroll mode until it lifts too, so the tail end
      // of a scroll gesture is never misread as the start of a draw.
      const avg = mascotAverageTouch(e.touches);
      mascotScrollLastX = avg.x;
      mascotScrollLastY = avg.y;
    }
  }, { passive: true });

  document.addEventListener("touchcancel", () => {
    mascotTouchMode = null;
    mascotIsDrawing = false;
    mascotTracePoints = [];
    mascotResetLine();
    document.body.classList.remove("mascot-drawing-active");
  }, { passive: true });

  // Cumulative distance at each recorded point, so a point can be found for
  // any given distance along the whole line without re-walking it each time.
  function mascotCumulativeDistances(points) {
    const dists = [0];
    for (let i = 1; i < points.length; i++) {
      dists.push(dists[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    }
    return dists;
  }

  function mascotPointAtDistance(points, dists, target) {
    let i = 1;
    while (i < dists.length && dists[i] < target) i++;
    if (i >= dists.length) return points[points.length - 1];
    const segStart = dists[i - 1];
    const segLen = dists[i] - segStart;
    const t = segLen === 0 ? 0 : (target - segStart) / segLen;
    return {
      x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
      y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
    };
  }

  // Position during tracing is driven directly every animation frame (no
  // CSS transition involved at all — see .mascot-tracing in style.css),
  // the same reasoning mascotUpdateFromScroll's Y already uses: something
  // that recomputes its target every ~16ms needs to just BE at that target
  // each frame, not ease toward it. Easing a target that's already moving
  // every frame means each new frame arrives before the previous ease
  // finished, which is what compounded into visible shaking when this
  // used the scroll-hop's bouncy transition at a fast, uninterrupted
  // cadence instead.
  function mascotStartTrace(rawPoints) {
    const dists = mascotCumulativeDistances(rawPoints);
    const totalLen = dists[dists.length - 1];
    if (totalLen < MASCOT_TRACE_MIN_DRAG_PX) {
      mascotResetLine();
      return;
    }

    // Interrupt whatever it was doing — a drawn line always wins.
    if (mascotLickTimer) clearTimeout(mascotLickTimer);
    if (mascotLickCycleTimer) clearTimeout(mascotLickCycleTimer);
    mascotClearTravel();
    mascotClearBottomLoop();
    mascotClearMidIdle();
    mascotClearHop();
    if (mascotFetching) mascotCancelFetch();
    mascotWrap.classList.remove("mascot-thinking", "mascot-licking");
    mascotState = "tracing";
    mascotSetRestingWhere(null);
    mascotWrap.classList.add("mascot-tracing");
    mascotSetImage("jumpDown");

    const token = ++mascotTraceToken;
    const w = mascotWrap.offsetWidth || 118;
    const h = mascotWrap.offsetHeight || 118;
    const duration = Math.min(MASCOT_TRACE_MAX_MS, Math.max(MASCOT_TRACE_MIN_MS, totalLen / MASCOT_TRACE_SPEED_PX_MS));
    const startTime = performance.now();

    function frame(now) {
      if (token !== mascotTraceToken) return;
      const fraction = Math.min(1, (now - startTime) / duration);
      const p = mascotPointAtDistance(rawPoints, dists, fraction * totalLen);
      mascotMoveTo(p.x - w / 2, p.y - h / 2);
      if (fraction < 1) {
        mascotTraceRaf = requestAnimationFrame(frame);
      } else {
        mascotFinishTrace(token);
      }
    }
    mascotTraceRaf = requestAnimationFrame(frame);
  }

  // Lands, then lingers right there — still holding its spot at the end of
  // the line — for as long as the line takes to fade, instead of snapping
  // back to wherever scroll position says it should be WHILE the line is
  // still visible fading out from under it. The two resolving together
  // (line gone, mascot back) reads as one finished beat; the mascot
  // teleporting away first and the line fading after would read as two
  // separate, contradictory ones.
  function mascotFinishTrace(token) {
    if (token !== mascotTraceToken) return;
    mascotLinePath.classList.add("mascot-line-fading");
    setTimeout(() => {
      if (token !== mascotTraceToken) return;
      mascotResetLine();
      mascotWrap.classList.remove("mascot-tracing");
      mascotEnterIdle();
    }, 550);
  }

  // Whenever scrolling pauses somewhere between the mic and the trash can
  // (neither all the way at the top nor the bottom), the mascot freezes
  // right where the zigzag left it and idles in place — rather than always
  // snapping back to one of the two fixed spots — so it settles wherever is
  // least likely to be sitting on top of whatever the user scrolled to see.
  // scheduleMidIdle is a debounce: it's rescheduled on every scroll event
  // during transit and only actually fires once ~220ms passes with no new
  // scroll, which is what "stopped scrolling" means here.
  let mascotMidIdleScheduleTimer = null;
  let mascotMidIdleStepTimer = null;
  let mascotMidIdleToken = 0;

  function mascotClearMidIdle() {
    if (mascotMidIdleScheduleTimer) clearTimeout(mascotMidIdleScheduleTimer);
    mascotMidIdleScheduleTimer = null;
    if (mascotMidIdleStepTimer) clearTimeout(mascotMidIdleStepTimer);
    mascotMidIdleStepTimer = null;
    mascotMidIdleToken++;
    mascotWrap.classList.remove("mascot-tailwag");
  }

  function mascotScheduleMidIdle() {
    if (mascotMidIdleScheduleTimer) clearTimeout(mascotMidIdleScheduleTimer);
    mascotMidIdleScheduleTimer = setTimeout(() => {
      if (mascotRestingWhere !== null || mascotState !== "idle") return;
      mascotStartMidIdle();
    }, 220);
  }

  // Idles for 4s, then licks its paws (alternating the two licking frames)
  // for ~5s, then back to idling — repeating for as long as it's settled
  // here mid-scroll.
  const MASCOT_MID_IDLE_LOOP = [
    { img: "idle", cls: [], hold: 4000 },
    { img: "licking", cls: [], hold: 500 },
    { img: "licking2", cls: [], hold: 500 },
    { img: "licking", cls: [], hold: 500 },
    { img: "licking2", cls: [], hold: 500 },
    { img: "licking", cls: [], hold: 500 },
    { img: "licking2", cls: [], hold: 500 },
    { img: "licking", cls: [], hold: 500 },
    { img: "licking2", cls: [], hold: 500 },
    { img: "licking", cls: [], hold: 500 },
    { img: "licking2", cls: [], hold: 500 },
  ];

  function mascotMidIdleStep(i, token) {
    if (mascotRestingWhere !== "mid" || token !== mascotMidIdleToken) return;
    const step = MASCOT_MID_IDLE_LOOP[i % MASCOT_MID_IDLE_LOOP.length];
    mascotWrap.classList.remove("mascot-tailwag");
    step.cls.forEach((c) => mascotWrap.classList.add(c));
    mascotSetImage(step.img);
    const hold = typeof step.hold === "function" ? step.hold() : step.hold;
    mascotMidIdleStepTimer = setTimeout(() => mascotMidIdleStep(i + 1, token), hold);
  }

  function mascotStartMidIdle() {
    mascotSetRestingWhere("mid");
    mascotMidIdleStep(0, mascotMidIdleToken);
  }

  // The single source of truth for where the mascot is and what pose it's
  // in, called on every scroll (and on resize/init). Y always maps directly
  // from the scroll position with no easing of its own. X does have its own
  // timeline once in transit — see mascotStartHop.
  let mascotLastScrollYSeen = window.scrollY;
  function mascotUpdateFromScroll() {
    if (mascotState !== "idle") return; // thinking/licking own their own position
    const maxScroll = mascotMaxScrollY();
    const scrollY = window.scrollY;
    const progress = maxScroll <= 0 ? 0 : Math.min(1, Math.max(0, scrollY / maxScroll));
    const scrollingDown = scrollY > mascotLastScrollYSeen;
    const scrollingUp = scrollY < mascotLastScrollYSeen;
    mascotLastScrollYSeen = scrollY;
    const a = mascotAnchors();

    // Hysteresis: the threshold to ENTER a resting state is tight, but once
    // resting there the threshold to LEAVE it is much looser — see
    // MASCOT_PROGRESS_EXIT_EPS above for why.
    const atTop = mascotRestingWhere === "mic"
      ? progress <= MASCOT_PROGRESS_EXIT_EPS
      : progress <= MASCOT_PROGRESS_ENTER_EPS;
    const atBottom = mascotRestingWhere === "bottom"
      ? progress >= 1 - MASCOT_PROGRESS_EXIT_EPS
      : progress >= 1 - MASCOT_PROGRESS_ENTER_EPS;

    if (atTop) {
      if (mascotRestingWhere !== "mic") {
        // mascotSetRestingWhere may SHRINK the box (.mascot-at-can comes
        // off if we were resting at the can) — `a` was computed above with
        // whatever size was current before that change, so it has to be
        // recomputed after, or the mic position lands off by the
        // leftover can-sized padding.
        mascotSetRestingWhere("mic");
        mascotClearTravel();
        mascotClearBottomLoop();
        mascotClearMidIdle();
        mascotClearHop();
        mascotSetImage("idle");
        const fresh = mascotAnchors();
        mascotMoveTo(fresh.micX, fresh.micY);
      } else {
        mascotMoveTo(a.micX, a.micY);
      }
      return;
    }

    if (atBottom) {
      if (mascotRestingWhere !== "bottom") {
        // mascotSetRestingWhere GROWS the box for the can here (see
        // .mascot-at-can in style.css) — same reasoning as above, just the
        // other direction: recompute anchors with the new, bigger size
        // before using them, so it actually lands centered on the bigger
        // box instead of where the small one would have gone.
        mascotSetRestingWhere("bottom");
        mascotClearTravel();
        mascotClearMidIdle();
        mascotClearHop();
        mascotStartBottomShow();
        const fresh = mascotAnchors();
        mascotMoveTo(fresh.bottomX, fresh.bottomY);
      } else {
        // Regardless of which margin a hop was in flight toward, reaching
        // the true bottom always wins — this is what guarantees the
        // mascot is actually sitting at the trash can once the user gets
        // there, not stranded mid-hop off to one side.
        mascotMoveTo(a.bottomX, a.bottomY);
      }
      return;
    }

    // Mid-transit: Y still tracks scroll progress in a straight line (so
    // it's always exactly on pace to land on the trash can at the true
    // bottom), but X is NOT — it only moves in discrete hops between the
    // two edges of the right-side gutter (mascotRightZone), one hop per
    // scroll "burst", at their own fixed pace (mascotStartHop /
    // MASCOT_HOP_MS) — so it never lingers over the middle of the screen
    // where it'd block whatever the user scrolled to read. The moment
    // scrolling actually stops, mascotScheduleMidIdle
    // (kicked off once the in-flight hop lands) freezes it at whichever
    // margin it's currently on and it idles in place there.
    if (mascotRestingWhere !== null) {
      mascotSetRestingWhere(null);
      mascotClearTravel();
      mascotClearBottomLoop();
    }
    mascotClearMidIdle();
    mascotLastScrollDir = scrollingUp ? "up" : "down";
    mascotLastProgressSeen = progress;
    mascotLastScrollAt = performance.now();
    if (mascotHopping) {
      // A hop is already in flight — let it finish rather than restarting
      // it, but keep Y flowing so it doesn't fall behind the scroll.
      // Whether to chain another hop once it lands is decided by
      // mascotLastScrollAt above, not here.
      const y = a.micY + (a.bottomY - a.micY) * progress;
      mascotMoveTo(mascotSideX(mascotHopSide), y);
    } else {
      mascotStartHop();
    }
  }

  window.addEventListener("scroll", mascotUpdateFromScroll, { passive: true });
  window.addEventListener("resize", mascotUpdateFromScroll);

  // Warms the browser's cache for every pose up front, so the FIRST time
  // any of them is actually needed (e.g. scrolling straight to the bottom
  // before the trash-can images have ever been requested) doesn't have to
  // wait on a network fetch + decode mid-animation — which is what was
  // showing up as a "flash" (the crossfade opacity was already transitioning
  // back in before the new image had actually finished loading, so it just
  // popped in abruptly once the data arrived instead of smoothly fading).
  Object.values(MASCOT_SRC).forEach((src) => {
    const img = new Image();
    img.src = src;
  });

  mascotWrap.style.setProperty("--mascot-hop-ms", `${MASCOT_HOP_MS}ms`);
  mascotSetImage("idle");
  mascotUpdateFromScroll();

  // A quick visual acknowledgment that something actually got stashed: a
  // little scrap flies from (startX, startY) — defaulting to the mic, since
  // that's usually exactly where the mascot is sitting — and lands in
  // whichever can is actually visible right now: the real can-shaped
  // artwork if the mascot is resting there, otherwise the fixed waiting-can
  // icon (always on screen whenever it isn't) — never a vague guess at
  // where the can might be. straightDown forces a purely vertical drop
  // (endX = startX) instead of arcing over toward the can horizontally —
  // used once the mascot has actually walked to stand right above the can
  // (see mascotStartFetchTrash), where anything but a straight-down fall
  // would look like it's flying off sideways instead of dropping in.
  function mascotTossIntoCan(startX, startY, straightDown) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (startX === undefined || startY === undefined) {
      const micRect = micBtn.getBoundingClientRect();
      startX = micRect.left + micRect.width / 2;
      startY = micRect.top + micRect.height / 2;
    }
    let endX, endY;
    if (mascotRestingWhere === "bottom") {
      // mascotWrap only ever owns Y (see the comment on .mascot-wrap in
      // style.css) — X lives entirely on the mascotHop CHILD's own
      // transform, which a parent's getBoundingClientRect never reflects,
      // so reading mascotWrap here would always report X as if the mascot
      // were still all the way over at the wrap's own left:0 origin.
      const hopRect = mascotHop.getBoundingClientRect();
      endX = hopRect.left + hopRect.width / 2;
      endY = hopRect.top + hopRect.height * 0.7;
    } else {
      const canRect = mascotWaitingCan.getBoundingClientRect();
      endX = canRect.left + canRect.width / 2;
      endY = canRect.top + canRect.height * 0.35; // the can's open top, not its full-height center
    }
    if (straightDown) endX = startX;
    const scrap = document.createElement("div");
    scrap.className = straightDown ? "mascot-toss-scrap mascot-toss-drop" : "mascot-toss-scrap";
    scrap.style.left = `${startX}px`;
    scrap.style.top = `${startY}px`;
    scrap.style.setProperty("--toss-dx", `${endX - startX}px`);
    scrap.style.setProperty("--toss-dy", `${endY - startY}px`);
    scrap.addEventListener("animationend", () => scrap.remove());
    document.body.appendChild(scrap);
  }

  // The X mascotHop needs so the mascot's own box ends up centered exactly
  // above the waiting-can icon — used for the fetch-trash walk's middle leg
  // (see mascotStartFetchTrash) so the drop afterward can fall straight
  // down onto it instead of needing any horizontal travel at all.
  function mascotCanColumnX() {
    const canRect = mascotWaitingCan.getBoundingClientRect();
    const w = mascotWrap.offsetWidth || 118;
    return canRect.left + canRect.width / 2 - w / 2;
  }

  // Sets mascotHop's translateX, optionally mirrored (the walk poses face
  // right natively, so a leg moving leftward needs a flip — see
  // mascotStartFetchTrash). animate=false jumps straight there with no
  // transition, used to snap the flip on/off in place before a leg starts;
  // interpolating scaleX itself (rather than just the translate) alongside a
  // change in flip is what would make that jump look like a weird 3D spin
  // instead of an instant mirror, so the two are never animated together.
  // durationMs only matters when animate is true — it's set fresh per leg
  // since the three legs of the fetch-trash walk cover very different
  // distances (see MASCOT_WALK_MS_PER_PX).
  function mascotSetHopX(x, flip, animate, durationMs) {
    mascotHop.style.transition = animate ? "" : "none";
    if (animate) mascotHop.style.transitionDuration = `${durationMs}ms`;
    mascotHop.style.transform = `translate3d(${x}px, 0, 0)${flip ? " scaleX(-1)" : ""}`;
    if (!animate) void mascotHop.offsetWidth; // force the "none" transition to commit before the next, animated set
  }

  function mascotClearFetch() {
    if (mascotFetchTimer) clearTimeout(mascotFetchTimer);
    if (mascotFetchStepTimer) clearInterval(mascotFetchStepTimer);
    if (mascotFetchTransitionHandler) mascotHop.removeEventListener("transitionend", mascotFetchTransitionHandler);
    mascotFetchTimer = null;
    mascotFetchStepTimer = null;
    mascotFetchTransitionHandler = null;
  }

  // Fully cancels an in-flight "go collect the trash" walk — needed both
  // when it finishes on its own and when something else (starting a new
  // recording, drawing a line) interrupts it partway through. Without this,
  // mascotFetching would stay stuck true (silently disabling the walk for
  // every future utterance) and the still-running step interval would keep
  // fighting whatever pose the interruption just set.
  function mascotCancelFetch() {
    mascotClearFetch();
    mascotFetching = false;
    mascotWrap.classList.remove("mascot-walking");
    // Whatever comes next (mascotEnterIdle's mascotMoveTo, or another mascot
    // state entirely) is about to animate mascotHop to its real resting X
    // using the normal hop transition — if the walk left it mirrored
    // (scaleX(-1), facing left), that transition would animate the scaleX
    // component too, which decomposes into a squish/spin instead of a clean
    // mirror (the same reason mascotSetHopX's animate=false path exists).
    // Dropping the flip here, instantly, means whatever runs next only ever
    // has to animate a plain translate.
    mascotHop.style.transition = "none";
    mascotHop.style.transform = mascotHop.style.transform.replace(/\s*scaleX\(-?1\)/, "");
    void mascotHop.offsetWidth; // force the "none" transition to commit
    // Each leg also leaves its own per-leg transitionDuration sitting in
    // mascotHop's inline style (see mascotSetHopX) — without clearing it,
    // it would silently keep overriding the normal scroll-driven hop's
    // duration (var(--mascot-hop-ms)) from here on.
    mascotHop.style.transitionDuration = "";
    mascotHop.style.transition = "";
  }

  // Walks mascotHop from fromX to toX, alternating the given two pose names
  // every MASCOT_WALK_STEP_MS to read as footsteps, then calls onDone once
  // it has ACTUALLY arrived. The leg's target duration scales with how far
  // it travels — see MASCOT_WALK_MS_PER_PX — so the short hop to the trash
  // and the much longer carry over to the can both feel like the same
  // walking pace instead of the same fixed time.
  //
  // "Arrived" is decided by the CSS transition's own transitionend event,
  // not just a setTimeout for durationMs — a callback further down this
  // chain reads mascotHop's live position (see mascotStartFetchTrash's drop
  // step) to know where to fall from, and a backgrounded/inactive tab can
  // let a CSS transition's actual visual progress fall behind wall-clock
  // time, so trusting "durationMs has elapsed" alone can read that position
  // before the transition has actually finished settling there. The
  // setTimeout is kept only as a fallback in case transitionend never fires
  // at all (e.g. the browser skips straight to the end state without
  // emitting it), so this can never hang forever.
  function mascotWalkLeg(fromX, toX, poses, flip, onDone) {
    const durationMs = Math.min(
      MASCOT_WALK_MAX_LEG_MS,
      Math.max(MASCOT_WALK_MIN_LEG_MS, Math.abs(toX - fromX) * MASCOT_WALK_MS_PER_PX)
    );
    let frame = 0;
    const stepImage = () => {
      mascotSetImage(poses[frame % 2]);
      frame++;
    };
    mascotSetHopX(fromX, flip, false); // face the right way in place before stepping off
    stepImage();
    mascotFetchStepTimer = setInterval(stepImage, MASCOT_WALK_STEP_MS);

    let arrived = false;
    const finish = () => {
      if (arrived) return; // transitionend and the fallback timer can both fire — only the first counts
      arrived = true;
      mascotClearFetch();
      onDone();
    };
    mascotFetchTransitionHandler = (e) => {
      if (e.target === mascotHop && e.propertyName === "transform") finish();
    };
    mascotHop.addEventListener("transitionend", mascotFetchTransitionHandler);
    // Committing the flip above with a "none" transition, then setting the
    // real target on the next frame, is what makes this transform (unlike
    // the flip snap) actually animate — mascotSetHopX(..., true) leaves
    // .mascot-walking's CSS transition in charge of the easing.
    requestAnimationFrame(() => mascotSetHopX(toX, flip, true, durationMs));
    mascotFetchTimer = setTimeout(finish, durationMs + 400);
  }

  // The mascot is always sitting right at the mic when this runs (stopping
  // a recording moves it there via mascotEnterLicking before handleTranscript
  // ever gets a chance to call this) — so "home" is the mic anchor, and the
  // whole performance is a flat walk at that Y, no vertical movement needed:
  // home -> trash (left of home, collect it) -> the can's column (right of
  // home — mascotRightZone's rightEdge, the same column the actual can sits
  // in once scrolled to the bottom — drop it in) -> back home. Ends the same
  // way licking's own timer would have: mascotEnterIdle hands position back
  // to the normal scroll-driven system.
  function mascotStartFetchTrash() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      mascotTossIntoCan();
      return;
    }
    if (mascotFetching) {
      // A walk is already in flight for a previous utterance — still show
      // the toss for this one rather than trying to overlap a second walk
      // onto the same in-flight transform.
      mascotTossIntoCan();
      return;
    }
    mascotFetching = true;
    if (mascotLickTimer) clearTimeout(mascotLickTimer);
    if (mascotLickCycleTimer) clearTimeout(mascotLickCycleTimer);
    mascotClearTravel();
    mascotClearBottomLoop();
    mascotClearMidIdle();
    mascotClearHop();
    mascotState = "fetching";
    mascotWrap.classList.remove("mascot-thinking", "mascot-licking");
    mascotWrap.classList.add("mascot-walking");
    // The voice path already sits the mascot at the mic before this can ever
    // run (mascotEnterLicking, from stopRecording) — but handleTranscript is
    // also reachable straight from the typed fallback form, where the
    // mascot could still be anywhere (mid-hop, resting at the bottom can in
    // its bigger box, etc.). Parking it at the mic explicitly, the same way
    // mascotEnterThinking/mascotEnterLicking do, keeps "home" actually
    // meaning the mic regardless of which path led here.
    mascotSetRestingWhere("mic");
    const a = mascotAnchors();
    mascotMoveTo(a.micX, a.micY);
    const homeX = a.micX;
    const trashX = Math.max(MASCOT_MARGIN, homeX - MASCOT_FETCH_DISTANCE_PX);
    const canX = mascotCanColumnX();

    const w = mascotWrap.offsetWidth || 118;
    const h = mascotWrap.offsetHeight || 118;

    mascotWalkLeg(homeX, trashX, ["walkRight1", "walkRight2"], true, () => {
      mascotSetImage("collectTrash");
      mascotFetchTimer = setTimeout(() => {
        mascotWalkLeg(trashX, canX, ["walkTrash1", "walkTrash2"], false, () => {
          // Dropped straight down from canX/micY — the leg's own KNOWN
          // target, not a getBoundingClientRect() read off mascotHop. A
          // rect read seems like it'd be more "live," but it's actually
          // less reliable: it reports the CSS transition's current
          // interpolated value, and a backgrounded/inactive tab can leave
          // that transition's own clock paused independent of wall-clock
          // time, so even after this leg has genuinely finished (by
          // whichever signal — transitionend or the fallback timer — got us
          // here), a rect read could still catch it mid-flight. The target
          // never has that ambiguity: this leg was always going to end at
          // canX, so that's where the trash falls from.
          mascotTossIntoCan(canX + w / 2, a.micY + h / 2, true);
          mascotFetchTimer = setTimeout(() => {
            mascotWalkLeg(canX, homeX, ["walkRight1", "walkRight2"], true, () => {
              mascotCancelFetch();
              mascotEnterIdle();
            });
          }, MASCOT_FETCH_DROP_MS);
        });
      }, MASCOT_FETCH_COLLECT_MS);
    });
  }

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

  // Spoken disfluencies ("um", "uh", "er", "ah") are never real words in
  // this app's context, so they're safe to strip anywhere in the raw
  // transcript, before clause-splitting even runs — that also keeps them
  // from confusing insertImplicitBoundaries' word-by-word scan (e.g. "fed
  // the cat um I did laundry" needs to see "I" sitting right where a clause
  // restart is expected, not two words after it).
  const PURE_DISFLUENCY_PATTERN = /\b(?:u+m+|u+h+m?|e+r+m?|a+h+)\b/gi;

  function stripPureDisfluencies(transcript) {
    return transcript.replace(PURE_DISFLUENCY_PATTERN, " ").replace(/\s+/g, " ").trim();
  }

  // "ok"/"okay" and "or" ARE real words, unlike the above, so they can only
  // be stripped where they're unambiguously a filler and not actual clause
  // content — the front of an already-split clause ("or, feed the cat",
  // "okay lock the door"). Left alone mid-clause ("milk or bread") where
  // removing it would change the item's meaning.
  const LEADING_FILLER_WORD = /^(?:ok(?:ay)?|or)\b[\s,]*/i;

  function stripLeadingFillerWord(clause) {
    let text = clause;
    let prev;
    do {
      prev = text;
      text = text.replace(LEADING_FILLER_WORD, "");
    } while (text !== prev);
    return text.trim();
  }

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
      .map(stripLeadingFillerWord)
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

  // Strips a leading 我/我的/的. The \s* between 我 and 的 tolerates a stray
  // space landing at exactly that boundary — the pause-based transcript
  // joiner (see PAUSE_BREAK_MS below) inserts a plain " " between segments
  // when the gap is short, and Chinese speech has no spaces of its own for
  // that joiner to instead fall back on. So "我" ...short pause... "的手机
  // 在桌子上" comes out as "我 的手机在桌子上" — without \s* here, that
  // space breaks "我的" into two separate tokens and only "我" matches,
  // leaving a stray "的手机" behind. (With "他的手机" this never came up:
  // 他 isn't 我, so the pattern was never trying to match a pronoun there
  // in the first place — it's not that "他的" was handled correctly, it's
  // that it was never touched at all.)
  const ZH_LEADING_PRONOUN = /^(我\s*的?|的)/;

  // \w in a JS regex never matches CJK characters, so an English pattern
  // anchored with ^ (like TELEGRAPHIC_LOCATION_PATTERN) can't match at all
  // while a leading 我/我的/的 is still attached — strip it first so "我的
  // purse on the table" tests the same as "purse on the table".
  function stripLeadingZhPronoun(clause) {
    return clause.trim().replace(ZH_LEADING_PRONOUN, "").trim();
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
    let text = clause.trim().replace(ZH_LEADING_PRONOUN, "").trim();
    text = text.replace(LEADING_PRONOUN, "").trim();
    return text || clause.trim();
  }

  function formatChineseForCategory(clause, categoryId) {
    if (categoryId === "find") {
      const match = clause.match(ZH_LOCATION_PATTERN);
      if (match) {
        const item = match[1].trim().replace(ZH_LEADING_PRONOUN, "").trim();
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
    transcript = stripPureDisfluencies(transcript);
    const chinese = isChineseText(transcript);
    const clauses = chinese ? splitClausesChinese(transcript) : splitClauses(transcript);
    if (clauses.length === 0) return false;
    mascotStartFetchTrash();
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
