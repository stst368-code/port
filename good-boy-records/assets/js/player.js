/* Good Boy Records — wall-mounted cassette player.
   One shared <audio> element remains the source of truth. Selecting a tape
   latches and lights that exact cassette in the wall; the viewport never moves. */
(function () {
  "use strict";

  var payload = document.getElementById("catalogue-data");
  if (!payload) return;
  var catalogue = JSON.parse(payload.textContent);
  var byId = {};
  catalogue.forEach(function (track) { byId[track.id] = track; });

  var el = {
    deck: document.getElementById("deck"), title: document.getElementById("deck-title"),
    catalogue: document.getElementById("deck-catalogue"), meta: document.getElementById("deck-meta"),
    detailsLink: document.getElementById("deck-details"), drawer: document.getElementById("player-drawer"), status: document.getElementById("deck-status"),
    audio: document.getElementById("showcase-player"), toggle: document.getElementById("transport-toggle"),
    shuffle: document.getElementById("transport-shuffle"),
    scrub: document.getElementById("transport-scrub"), elapsed: document.getElementById("time-elapsed"),
    total: document.getElementById("time-total"), volume: document.getElementById("transport-volume"),
    lyrics: document.getElementById("lyrics"), lyricsScroll: document.getElementById("lyrics-scroll"),
    lyricsList: document.getElementById("lyrics-list"), lyricsReturn: document.getElementById("lyrics-return"),
    lyricsNote: document.getElementById("lyrics-note"), previewField: document.getElementById("preview-field"),
    previewToggle: document.getElementById("preview-toggle"), qualityToggle: document.getElementById("quality-toggle"),
    monitorTitle: document.getElementById("wall-monitor-title"), monitorCode: document.getElementById("wall-monitor-code"),
    inspiration: document.getElementById("deck-inspiration"),
    vuLeft: document.getElementById("vu-left"), vuRight: document.getElementById("vu-right"),
    spectrum: document.getElementById("spectrum"),
    artwork: document.getElementById("deck-artwork"),
    eqPanel: document.getElementById("eq-panel"), eqReset: document.getElementById("eq-reset"), eqNote: document.getElementById("eq-note"),
    eqToggle: document.getElementById("eq-toggle"), eqPopover: document.getElementById("eq-popover"),
    cassetteBay: document.getElementById("cassette-bay"), cassetteBayTape: document.getElementById("cassette-bay-tape"),
    cassetteBayArt: document.getElementById("cassette-bay-art"), cassetteBayLabel: document.getElementById("cassette-bay-label"),
    carousel: document.getElementById("cassette-carousel"), carouselPlatter: document.getElementById("carousel-platter"),
    carouselPrev: document.getElementById("carousel-prev"), carouselNext: document.getElementById("carousel-next"),
    carouselSong: document.getElementById("carousel-song"), carouselVersion: document.getElementById("carousel-version"),
    playerRail: document.getElementById("player-rail"), stage: document.querySelector(".showcase-stage")
  };
  if (!el.deck || !el.audio) return;

  var audio = el.audio;
  var preview = new Audio();
  preview.preload = "none";
  preview.volume = 0.55;
  var current = null, cues = [], cueIndex = -1, pastCueIndex = -1, wordIndex = -1, wordTimed = false, lyricsLoadToken = 0, lyricFrame = null, scrubbing = false, following = true;
  var audioUnlocked = false, previewTimer = null, previewStop = null;
  var canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var audioContext = null, mediaSource = null, analyser = null, analyserData = null, frequencyData = null, vuFrame = null;
  var fxContext = null, cycleArmed = false, cycleInProgress = false;
  var spectrumBars = [], spectrumLevels = [];
  var spectrumBandCount = 18, spectrumSegmentCount = 10;
  var spectrumCentres = [55, 80, 115, 160, 225, 315, 440, 620, 870, 1220, 1700, 2400, 3400, 4800, 6800, 9600, 13500, 17500];
  var eqFilters = [], eqHeadroom = null, eqLimiter = null;
  var eqInputs = Array.prototype.slice.call(document.querySelectorAll("[data-eq-frequency]"));
  var eqFrequencies = [60, 250, 1000, 4000, 12000];
  var carouselCards = [], carouselRotation = 0, carouselIndex = 0, carouselStep = 360, carouselAnimating = false;
  var carouselPointer = null, carouselWheelLock = false, carouselSuppressClickUntil = 0;

  function initSpectrum() {
    if (!el.spectrum || spectrumBars.length) return;
    var fragment = document.createDocumentFragment();
    for (var band = 0; band < spectrumBandCount; band++) {
      var bar = document.createElement("span");
      bar.className = "spectrum__band";
      var segments = [];
      for (var seg = spectrumSegmentCount - 1; seg >= 0; seg--) {
        var block = document.createElement("i");
        block.className = "spectrum__segment";
        block.dataset.level = String(seg + 1);
        bar.appendChild(block);
        segments.push(block);
      }
      fragment.appendChild(bar);
      spectrumBars.push(segments);
      spectrumLevels.push(0);
    }
    el.spectrum.appendChild(fragment);
  }

  function paintSpectrum(levels) {
    if (!spectrumBars.length) return;
    for (var band = 0; band < spectrumBars.length; band++) {
      var normalized = Math.max(0, Math.min(1, levels[band] || 0));
      /* Floor rather than round so a nearly-full band does not sit on all ten
         lamps continuously. The top segment is reserved for genuine peaks. */
      var lit = normalized >= .995 ? spectrumSegmentCount : Math.floor(normalized * spectrumSegmentCount);
      spectrumBars[band].forEach(function (segment) {
        var level = Number(segment.dataset.level) || 0;
        segment.classList.toggle("is-lit", level <= lit);
      });
    }
  }

  function clearSpectrum() {
    spectrumLevels = spectrumLevels.map(function () { return 0; });
    paintSpectrum(spectrumLevels);
  }

  function remember(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function recall(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function clock(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "--:--";
    var whole = Math.floor(seconds);
    return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
  }
  function setState(state) {
    el.deck.dataset.state = state;
    document.querySelectorAll(".card[data-selected=true]").forEach(function (card) {
      card.dataset.transportState = state;
    });
  }
  function say(message, tone) {
    el.status.textContent = message || "";
    if (tone) el.status.dataset.tone = tone; else el.status.removeAttribute("data-tone");
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; });
  }
  function assetPath(name, folder) {
    if (!name) return null;
    if (/^(https?:)?\/\//i.test(name) || name.charAt(0) === "/" || name.indexOf("data:") === 0 || name.indexOf("blob:") === 0) return name;
    return folder + name;
  }

  if (el.detailsLink && el.drawer) {
    el.detailsLink.addEventListener("click", function () {
      el.drawer.open = !el.drawer.open;
      el.detailsLink.setAttribute("aria-expanded", el.drawer.open ? "true" : "false");
    });
    el.drawer.addEventListener("toggle", function () {
      el.detailsLink.setAttribute("aria-expanded", el.drawer.open ? "true" : "false");
    });
  }

  /* --------------------------------------------------------------- lyrics */
  function renderCueSet(nextCues, mode) {
    cues = Array.isArray(nextCues) ? nextCues : [];
    cueIndex = -1;
    pastCueIndex = -1;
    wordIndex = -1;
    wordTimed = mode === "word";
    el.lyrics.dataset.mode = wordTimed ? "word" : "line";
    el.lyricsList.innerHTML = "";
    if (!cues.length) return false;

    var fragment = document.createDocumentFragment();
    cues.forEach(function (cue, index) {
      var line = document.createElement("li");
      line.id = "cue-" + index;
      line.tabIndex = 0;
      line.dataset.time = cue.start;
      line.title = "Seek to " + clock(cue.start);
      if (wordTimed && Array.isArray(cue.words) && cue.words.length) {
        cue.words.forEach(function (word, wordNumber) {
          var span = document.createElement("span");
          span.className = "lyrics__word";
          span.textContent = word.text;
          span.dataset.start = word.start;
          span.dataset.end = word.end;
          line.appendChild(span);
        });
      } else {
        line.textContent = cue.text;
      }
      line.addEventListener("click", function () { if (audio.src) audio.currentTime = cue.start; });
      line.addEventListener("keydown", function (event) {
        if ((event.key === "Enter" || event.key === " ") && audio.src) { event.preventDefault(); audio.currentTime = cue.start; }
      });
      fragment.appendChild(line);
    });
    el.lyricsList.appendChild(fragment);
    setFollowing(true);
    el.lyricsScroll.scrollTop = 0;
    return true;
  }

  function renderRawLyrics(track) {
    var raw = track.lyrics && track.lyrics.raw;
    el.lyricsList.innerHTML = "";
    if (raw) {
      var rawFragment = document.createDocumentFragment();
      raw.split(/\r?\n/).forEach(function (text) {
        text = text.trim();
        if (!text) return;
        var line = document.createElement("li");
        line.textContent = text;
        line.className = /^\[.*\]$/.test(text) ? "lyrics__direction" : "lyrics__raw";
        rawFragment.appendChild(line);
      });
      el.lyricsList.appendChild(rawFragment);
    } else {
      var empty = document.createElement("li");
      empty.textContent = "No lyrics stored for this one yet.";
      el.lyricsList.appendChild(empty);
    }
    cues = [];
    cueIndex = -1;
    pastCueIndex = -1;
    wordIndex = -1;
    wordTimed = false;
    el.lyrics.dataset.mode = "raw";
    setFollowing(false);
    el.lyricsScroll.scrollTop = 0;
  }

  function renderLyrics(track) {
    lyricsLoadToken += 1;
    var token = lyricsLoadToken;
    el.lyrics.dataset.loading = "false";
    var fallback = (track.lyrics && track.lyrics.cues) || [];
    if (!renderCueSet(fallback, "line")) renderRawLyrics(track);
    el.lyricsNote.hidden = !(track.lyrics && track.lyrics.status === "placeholder");

    var timing = track.lyrics && track.lyrics.wordTiming;
    if (!timing || !timing.src) return;
    if ((timing.reviewRequired || timing.usable === false) && !timing.approved) {
      el.lyrics.dataset.loading = "review";
      return;
    }
    el.lyrics.dataset.loading = "true";
    fetch(timing.src, {cache:"force-cache"})
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (token !== lyricsLoadToken || !current || current.id !== track.id) return;
        if (!data || data.format !== "gbr-word-lyrics-v1" || !Array.isArray(data.lines) || !data.lines.length) {
          throw new Error("unsupported word-timing file");
        }
        renderCueSet(data.lines, "word");
        el.lyrics.dataset.loading = "false";
        highlight(audio.currentTime || 0);
      })
      .catch(function () {
        if (token !== lyricsLoadToken || !current || current.id !== track.id) return;
        el.lyrics.dataset.loading = "error";
        /* Timed lyrics are an enhancement. Never let a missing sidecar break the
           ordinary transcript or, more importantly, playback. */
      });
  }

  function findCue(time) {
    if (cueIndex >= 0 && cueIndex < cues.length) {
      var active = cues[cueIndex], next = cues[cueIndex + 1];
      if (time >= active.start && time < active.end) return cueIndex;
      if (next && time >= next.start && time < next.end) return cueIndex + 1;
    }
    var low = 0, high = cues.length - 1, found = -1;
    while (low <= high) {
      var mid = (low + high) >> 1;
      if (time < cues[mid].start) high = mid - 1;
      else if (time >= cues[mid].end) low = mid + 1;
      else { found = mid; break; }
    }
    return found;
  }

  function findPastCue(time) {
    if (!cues.length) return -1;
    var low = 0, high = cues.length - 1, found = -1;
    while (low <= high) {
      var mid = (low + high) >> 1;
      if (Number(cues[mid].end) <= time) { found = mid; low = mid + 1; }
      else high = mid - 1;
    }
    return found;
  }

  function findWord(words, time) {
    if (!Array.isArray(words) || !words.length) return -1;
    var low = 0, high = words.length - 1;
    while (low <= high) {
      var mid = (low + high) >> 1;
      if (time < Number(words[mid].start)) high = mid - 1;
      else if (time >= Number(words[mid].end)) low = mid + 1;
      else return mid;
    }
    return -1;
  }

  function paintWords(line, cue, time) {
    if (!wordTimed || !line || !cue || !Array.isArray(cue.words)) return;
    var activeWord = findWord(cue.words, time);
    if (activeWord === wordIndex && cueIndex >= 0) return;
    wordIndex = activeWord;
    var spans = line.querySelectorAll(".lyrics__word");
    spans.forEach(function (span, index) {
      var word = cue.words[index];
      var start = word ? Number(word.start) : Infinity;
      var end = word ? Number(word.end) : Infinity;
      span.classList.toggle("is-current", index === activeWord);
      span.classList.toggle("is-sung", time >= end && index !== activeWord);
      span.classList.toggle("is-next", activeWord >= 0 && index === activeWord + 1);
      if (activeWord < 0 && time >= start && time < end) span.classList.add("is-current");
    });
  }

  function highlight(time) {
    if (!cues.length) return;
    var index = findCue(time);
    var pastIndex = findPastCue(time);
    var changed = index !== cueIndex || pastIndex !== pastCueIndex;
    if (changed) {
      cueIndex = index;
      pastCueIndex = pastIndex;
      wordIndex = -1;
      var lines = el.lyricsList.children;
      for (var i = 0; i < lines.length; i++) {
        var cue = cues[i];
        /* During a pause between lines findCue() correctly returns -1. Past
           lyrics must nevertheless remain past, instead of springing back to
           the same bright colour as words that have not been sung yet. */
        var isPast = i <= pastIndex;
        lines[i].classList.toggle("is-active", i === index);
        lines[i].classList.toggle("is-past", i !== index && isPast);
        if (i !== index) {
          lines[i].querySelectorAll(".lyrics__word").forEach(function (span) {
            var wordEnd = Number(span.dataset.end);
            span.classList.remove("is-current", "is-next");
            span.classList.toggle("is-sung", isFinite(wordEnd) ? wordEnd <= time : isPast);
          });
        }
      }
      if (index >= 0 && following) centre(lines[index]);
    }
    if (index >= 0 && wordTimed) paintWords(el.lyricsList.children[index], cues[index], time);
  }

  function startLyricClock() {
    if (lyricFrame) cancelAnimationFrame(lyricFrame);
    function tick() {
      highlight(audio.currentTime || 0);
      if (!audio.paused && !audio.ended) lyricFrame = requestAnimationFrame(tick);
      else lyricFrame = null;
    }
    lyricFrame = requestAnimationFrame(tick);
  }
  function stopLyricClock() {
    if (lyricFrame) cancelAnimationFrame(lyricFrame);
    lyricFrame = null;
  }

  function centre(line) {
    if (!line) return;
    var box = el.lyricsScroll;
    var target = line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2;
    box.scrollTo({top: Math.max(0, target), behavior: reduceMotion.matches ? "auto" : "smooth"});
  }
  function setFollowing(value) { following = value; el.lyrics.dataset.following = value ? "true" : "false"; }

  /* ------------------------------------------------------------- previews */
  function previewsAllowed() { return canHover && audioUnlocked && el.previewToggle && el.previewToggle.checked; }
  function startPreview(track) {
    if (!previewsAllowed() || !audio.paused || !track.audio.preview || !track.audio.preview.src || track.audio.available === false) return;
    stopPreview();
    previewTimer = setTimeout(function () {
      var source = track.audio.preview;
      preview.src = assetPath(source.src, "assets/audio/previews/");
      preview.addEventListener("loadedmetadata", function () { preview.currentTime = source.start || 0; }, {once:true});
      var play = preview.play(); if (play && play.catch) play.catch(function () {});
      previewStop = setTimeout(stopPreview, ((source.duration || 12) + .5) * 1000);
    }, 220);
  }
  function stopPreview() { clearTimeout(previewTimer); clearTimeout(previewStop); if (!preview.paused) preview.pause(); }
  function revealPreviewToggle() { if (canHover && el.previewField) el.previewField.hidden = false; }

  /* ------------------------------------------------------- audio/EQ/VU */
  function eqStateFromStorage() {
    var stored = recall("gbr:eq");
    if (!stored) return {};
    try { return JSON.parse(stored) || {}; } catch (_) { return {}; }
  }
  function currentEqState() {
    var state = {};
    eqInputs.forEach(function (input) { state[input.dataset.eqFrequency] = Number(input.value) || 0; });
    return state;
  }
  function updateEqLabels() {
    eqInputs.forEach(function (input) {
      var out = input.parentElement && input.parentElement.querySelector("output");
      if (out) { var value = Number(input.value) || 0; out.textContent = (value > 0 ? "+" : "") + value + " dB"; }
    });
  }
  function applyEq() {
    var state = currentEqState();
    remember("gbr:eq", JSON.stringify(state));
    updateEqLabels();
    if (!eqFilters.length || !audioContext) return;
    var now = audioContext.currentTime;
    var maxBoost = 0;
    eqFilters.forEach(function (filter, index) {
      var gain = Number(state[String(eqFrequencies[index])]) || 0;
      maxBoost = Math.max(maxBoost, gain);
      try { filter.gain.setTargetAtTime(gain, now, .025); } catch (_) { filter.gain.value = gain; }
    });
    /* Do not counteract a positive EQ move by turning the entire programme
       down by the same number of dB. That made a boost feel perversely like a
       cut. The downstream limiter catches true output peaks instead. */
    if (eqHeadroom) {
      try { eqHeadroom.gain.setTargetAtTime(1, now, .03); } catch (_) { eqHeadroom.gain.value = 1; }
    }
  }
  function setEqAvailability(available) {
    eqInputs.forEach(function (input) { input.disabled = !available; });
    if (el.eqReset) el.eqReset.disabled = !available;
    if (el.eqPanel) el.eqPanel.dataset.available = available ? "true" : "false";
    if (el.eqNote) el.eqNote.textContent = available ? "EQ is applied live to the shared player." : "EQ requires the site to run over HTTP. Use START-SITE.bat rather than file://.";
  }
  function ensureAudioGraph() {
    /* file:// pages have opaque origins. Routing a local media element through
       MediaElementAudioSourceNode can make Chromium output silence. GitHub
       Pages and START-SITE.bat are HTTP, so the real EQ/VU graph is enabled
       there and native playback remains untouched for direct file opens. */
    if (location.protocol === "file:") { setEqAvailability(false); return; }
    if (analyser) { setEqAvailability(true); return; }
    if (!(window.AudioContext || window.webkitAudioContext)) { setEqAvailability(false); return; }
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      mediaSource = audioContext.createMediaElementSource(audio);
      eqHeadroom = audioContext.createGain();
      eqFilters = eqFrequencies.map(function (frequency, index) {
        var filter = audioContext.createBiquadFilter();
        filter.frequency.value = frequency;
        filter.gain.value = 0;
        if (index === 0) filter.type = "lowshelf";
        else if (index === eqFrequencies.length - 1) filter.type = "highshelf";
        else { filter.type = "peaking"; filter.Q.value = 1.05; }
        return filter;
      });
      analyser = audioContext.createAnalyser();
      /* 2048 gives the low end enough FFT resolution that several visual
         bands no longer collapse onto the same one or two bins. */
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = .34;
      analyser.minDecibels = -88;
      analyser.maxDecibels = -18;
      analyserData = new Uint8Array(analyser.fftSize);
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      eqLimiter = audioContext.createDynamicsCompressor();
      eqLimiter.threshold.value = -3;
      eqLimiter.knee.value = 0;
      eqLimiter.ratio.value = 20;
      eqLimiter.attack.value = .003;
      eqLimiter.release.value = .12;

      mediaSource.connect(eqHeadroom);
      var node = eqHeadroom;
      eqFilters.forEach(function (filter) { node.connect(filter); node = filter; });
      node.connect(analyser);
      analyser.connect(eqLimiter);
      eqLimiter.connect(audioContext.destination);
      setEqAvailability(true);
      applyEq();
    } catch (_) { analyser = null; eqFilters = []; setEqAvailability(false); }
  }
  function resumeAnalyser() {
    ensureAudioGraph();
    if (audioContext && audioContext.state === "suspended") audioContext.resume().catch(function () {});
  }
  function drawSpectrum() {
    if (!analyser || !frequencyData || !spectrumBars.length) return;
    analyser.getByteFrequencyData(frequencyData);
    var nyquist = (audioContext ? audioContext.sampleRate : 48000) / 2;
    var raw = [];
    var framePeak = 0;

    for (var band = 0; band < spectrumBandCount; band++) {
      var centre = spectrumCentres[band] || 1000;
      var lowHz = band === 0 ? 45 : Math.sqrt(spectrumCentres[band - 1] * centre);
      var highHz = band === spectrumBandCount - 1
        ? Math.min(19500, nyquist * .94)
        : Math.sqrt(centre * spectrumCentres[band + 1]);
      var lowBin = Math.max(1, Math.floor(lowHz / nyquist * frequencyData.length));
      var highBin = Math.min(frequencyData.length - 1, Math.max(lowBin, Math.ceil(highHz / nyquist * frequencyData.length)));
      var total = 0, peak = 0, count = 0;
      for (var i = lowBin; i <= highBin; i++) {
        var value = frequencyData[i] / 255;
        total += value;
        peak = Math.max(peak, value);
        count += 1;
      }
      var mean = count ? total / count : 0;
      var level = mean * .78 + peak * .22;
      /* Remove analyser floor, then compensate gently for the normal spectral
         downward slope of music. This keeps bass alive without letting the
         first two columns weld themselves permanently to the ceiling. */
      level = Math.max(0, (level - .075) / .925);
      level *= .76 + .28 * (band / Math.max(1, spectrumBandCount - 1));
      level = Math.pow(Math.max(0, Math.min(1, level)), 1.22);
      raw.push(level);
      framePeak = Math.max(framePeak, level);
    }

    var ceiling = Math.max(.38, framePeak);
    for (var b = 0; b < spectrumBandCount; b++) {
      var relative = Math.min(1, raw[b] / ceiling);
      var loudness = Math.min(.96, .18 + framePeak * .82);
      var target = relative * loudness;
      var currentLevel = spectrumLevels[b] || 0;
      /* Fast attack, short analogue-looking decay. */
      spectrumLevels[b] = target >= currentLevel ? target : Math.max(target, currentLevel - .075);
    }
    paintSpectrum(spectrumLevels);
  }
  function drawMeters() {
    if (!analyser || audio.paused || audio.ended) { vuFrame = null; return; }
    analyser.getByteTimeDomainData(analyserData);
    var sum = 0;
    for (var i = 0; i < analyserData.length; i++) { var n = (analyserData[i] - 128) / 128; sum += n * n; }
    var rms = Math.sqrt(sum / analyserData.length);
    var strength = Math.min(1, rms * 4.8);
    var left = -42 + strength * 76;
    var right = -42 + Math.min(1, strength * .94 + .025) * 76;
    if (el.vuLeft) el.vuLeft.style.transform = "rotate(" + left.toFixed(1) + "deg)";
    if (el.vuRight) el.vuRight.style.transform = "rotate(" + right.toFixed(1) + "deg)";
    drawSpectrum();
    vuFrame = requestAnimationFrame(drawMeters);
  }
  function startMeters() { if (vuFrame) cancelAnimationFrame(vuFrame); if (analyser) vuFrame = requestAnimationFrame(drawMeters); }
  function restMeters() {
    if (vuFrame) cancelAnimationFrame(vuFrame); vuFrame = null;
    if (el.vuLeft) el.vuLeft.style.transform = "rotate(-42deg)";
    if (el.vuRight) el.vuRight.style.transform = "rotate(-42deg)";
    clearSpectrum();
  }

  /* A tiny synthesized transport sound keeps the site self-contained while
     still giving the wall a physical action: plastic click, low deck thunk,
     then a short latch tick. The context is created on the first cassette
     gesture and stays unlocked for automatic tape changes afterwards. */
  function playCassetteInsertSound() {
    if (!(window.AudioContext || window.webkitAudioContext)) return;
    try {
      if (!fxContext) fxContext = new (window.AudioContext || window.webkitAudioContext)();
      if (fxContext.state === "suspended") fxContext.resume().catch(function () {});
      var now = fxContext.currentTime;
      var master = fxContext.createGain();
      master.gain.setValueAtTime(.0001, now);
      master.gain.exponentialRampToValueAtTime(.19, now + .004);
      master.gain.exponentialRampToValueAtTime(.0001, now + .19);
      master.connect(fxContext.destination);

      var thunk = fxContext.createOscillator();
      var thunkGain = fxContext.createGain();
      thunk.type = "sine";
      thunk.frequency.setValueAtTime(132, now);
      thunk.frequency.exponentialRampToValueAtTime(78, now + .095);
      thunkGain.gain.setValueAtTime(.0001, now);
      thunkGain.gain.exponentialRampToValueAtTime(.78, now + .006);
      thunkGain.gain.exponentialRampToValueAtTime(.0001, now + .12);
      thunk.connect(thunkGain); thunkGain.connect(master);
      thunk.start(now); thunk.stop(now + .13);

      var click = fxContext.createOscillator();
      var clickGain = fxContext.createGain();
      click.type = "square";
      click.frequency.setValueAtTime(1780, now);
      click.frequency.exponentialRampToValueAtTime(760, now + .026);
      clickGain.gain.setValueAtTime(.5, now);
      clickGain.gain.exponentialRampToValueAtTime(.0001, now + .035);
      click.connect(clickGain); clickGain.connect(master);
      click.start(now); click.stop(now + .04);

      var latch = fxContext.createOscillator();
      var latchGain = fxContext.createGain();
      latch.type = "triangle";
      latch.frequency.setValueAtTime(2450, now + .082);
      latch.frequency.exponentialRampToValueAtTime(1250, now + .12);
      latchGain.gain.setValueAtTime(.0001, now);
      latchGain.gain.setValueAtTime(.0001, now + .078);
      latchGain.gain.exponentialRampToValueAtTime(.36, now + .085);
      latchGain.gain.exponentialRampToValueAtTime(.0001, now + .13);
      latch.connect(latchGain); latchGain.connect(master);
      latch.start(now + .078); latch.stop(now + .14);
    } catch (_) {}
  }

  function playableTracks() {
    return catalogue.filter(function (track) {
      return track && track.audio && track.audio.available !== false && !!chooseSource(track);
    });
  }
  function randomNextTrack() {
    var pool = playableTracks();
    if (!pool.length) return null;
    if (current && pool.length > 1) {
      var differentSong = pool.filter(function (track) { return track.id !== current.id && track.title !== current.title; });
      pool = differentSong.length ? differentSong : pool.filter(function (track) { return track.id !== current.id; });
    }
    return pool[Math.floor(Math.random() * pool.length)] || null;
  }
  function setCycleArmed(value) {
    cycleArmed = !!value;
    if (el.shuffle) {
      el.shuffle.setAttribute("aria-pressed", cycleArmed ? "true" : "false");
      el.shuffle.classList.toggle("is-active", cycleArmed);
    }
  }
  function mod(value, divisor) { return ((value % divisor) + divisor) % divisor; }
  function normalizedAngle(value) { return mod(value + 180, 360) - 180; }
  function carouselTrackAt(index) {
    if (!carouselCards.length) return null;
    var card = carouselCards[mod(index, carouselCards.length)];
    return card ? byId[card.dataset.track] : null;
  }
  function carouselIndexForTrack(track) {
    if (!track) return -1;
    for (var i = 0; i < carouselCards.length; i++) if (carouselCards[i].dataset.track === track.id) return i;
    return -1;
  }
  function carouselNearestIndex() {
    if (!carouselCards.length) return 0;
    return mod(Math.round(-carouselRotation / carouselStep), carouselCards.length);
  }
  function updateCarouselReadout(index) {
    var track = carouselTrackAt(index);
    if (!track) return;
    if (el.carouselSong) el.carouselSong.textContent = track.title || "UNTITLED";
    if (el.carouselVersion) {
      var bits = [track.versionLabel, track.model && (track.model.name || track.model.provider)].filter(Boolean);
      el.carouselVersion.textContent = bits.join(" / ") || "READY AT PICKUP";
    }
  }
  function renderCarousel(duration) {
    if (!carouselCards.length) return;
    var ms = Math.max(0, Number(duration) || 0);
    carouselCards.forEach(function (card, index) {
      var angle = index * carouselStep + carouselRotation;
      var near = normalizedAngle(angle);
      var distance = Math.abs(near) / 180;
      card.style.setProperty("--slot-angle", angle + "deg");
      card.style.setProperty("--slot-scale", String(1 - distance * .22));
      card.style.setProperty("--slot-opacity", String(.46 + (1 - distance) * .54));
      card.style.setProperty("--slot-transition", ms + "ms");
      card.style.zIndex = String(1000 - Math.round(Math.abs(near) * 3));
      card.classList.toggle("is-pickup", Math.abs(near) <= carouselStep * .48);
    });
    carouselIndex = carouselNearestIndex();
    updateCarouselReadout(carouselIndex);
  }
  function nearestEquivalentRotation(index) {
    var base = -mod(index, carouselCards.length) * carouselStep;
    return base + Math.round((carouselRotation - base) / 360) * 360;
  }
  function rotateCarouselTo(index, options, done) {
    if (!carouselCards.length) { if (done) done(); return; }
    options = options || {};
    index = mod(index, carouselCards.length);
    var duration = reduceMotion.matches ? 0 : (options.longSpin ? 1300 : (options.duration == null ? 430 : options.duration));
    var target = nearestEquivalentRotation(index);
    if (options.direction === 1 && target >= carouselRotation) target -= 360;
    if (options.direction === -1 && target <= carouselRotation) target += 360;
    if (options.longSpin && !reduceMotion.matches) target -= (3 + Math.floor(Math.random() * 3)) * 360;
    carouselAnimating = true;
    carouselRotation = target;
    renderCarousel(duration);
    window.setTimeout(function () {
      carouselAnimating = false;
      carouselIndex = index;
      updateCarouselReadout(index);
      if (done) done();
    }, duration + 24);
  }
  function stepCarousel(direction) {
    if (!carouselCards.length || carouselAnimating) return;
    var target = mod(carouselNearestIndex() + direction, carouselCards.length);
    rotateCarouselTo(target, {direction: direction}, null);
  }
  function restoreCarouselCassette() {
    var previous = document.querySelector(".card.is-in-deck");
    if (previous) {
      previous.classList.remove("is-in-deck");
      previous.classList.add("is-returning");
      window.setTimeout(function () { previous.classList.remove("is-returning"); }, 330);
    }
  }
  function updateCassetteBay(track) {
    if (!track) return;
    if (el.cassetteBayTape) el.cassetteBayTape.dataset.loaded = "true";
    if (el.cassetteBayArt) el.cassetteBayArt.style.backgroundImage = 'url("' + artPath(track).replace(/"/g, "") + '")';
    if (el.cassetteBayLabel) el.cassetteBayLabel.textContent = [track.title, track.versionLabel].filter(Boolean).join(" / ");
  }
  function animateCassetteIntoDeck(track, done) {
    var index = carouselIndexForTrack(track);
    var card = index >= 0 ? carouselCards[index] : null;
    var source = card && card.querySelector(".cassette");
    restoreCarouselCassette();
    if (!card || !source || !el.cassetteBay || reduceMotion.matches) {
      if (card) card.classList.add("is-in-deck");
      updateCassetteBay(track);
      playCassetteInsertSound();
      if (done) done();
      return;
    }
    var from = source.getBoundingClientRect();
    var bay = el.cassetteBay.getBoundingClientRect();
    var targetWidth = Math.min(Math.max(118, bay.width * .64), 230);
    var targetHeight = targetWidth / 1.58;
    var targetLeft = bay.left + (bay.width - targetWidth) / 2;
    var targetTop = bay.top + (bay.height - targetHeight) / 2 + 4;
    var flyer = source.cloneNode(true);
    flyer.classList.add("cassette-flyer");
    flyer.style.left = from.left + "px"; flyer.style.top = from.top + "px";
    flyer.style.width = from.width + "px"; flyer.style.height = from.height + "px";
    document.body.appendChild(flyer);
    card.classList.add("is-departing");
    requestAnimationFrame(function () {
      flyer.style.left = targetLeft + "px"; flyer.style.top = targetTop + "px";
      flyer.style.width = targetWidth + "px"; flyer.style.height = targetHeight + "px";
      flyer.style.transform = "rotate(-1deg)";
    });
    window.setTimeout(function () {
      if (flyer.parentNode) flyer.parentNode.removeChild(flyer);
      card.classList.remove("is-departing");
      card.classList.add("is-in-deck");
      updateCassetteBay(track);
      playCassetteInsertSound();
      if (done) done();
    }, 700);
  }
  function spinAndEngage(track, shouldPlay, longSpin) {
    var index = carouselIndexForTrack(track);
    if (index < 0) { select(track, shouldPlay, true); return; }
    rotateCarouselTo(index, {longSpin: !!longSpin}, function () {
      animateCassetteIntoDeck(track, function () { select(track, shouldPlay, false); });
    });
  }
  function cycleToRandomTrack() {
    if (!cycleArmed || cycleInProgress) return false;
    var next = randomNextTrack();
    if (!next) return false;
    cycleInProgress = true;
    spinAndEngage(next, true, true);
    window.setTimeout(function () { cycleInProgress = false; }, reduceMotion.matches ? 50 : 2500);
    return true;
  }


  /* --------------------------------------------------------------- select */
  function hasLossless(track) { return !!(track.audio && track.audio.sources && (track.audio.sources.flac || track.audio.sources.lossless)); }
  function chooseSource(track) {
    var sources = track.audio.sources || {};
    var wantsLossless = el.qualityToggle && el.qualityToggle.checked;
    var lossless = sources.flac || sources.lossless;
    if (wantsLossless && lossless && audio.canPlayType("audio/flac")) return assetPath(lossless, "assets/audio/tracks/");
    if (sources.opus && audio.canPlayType('audio/ogg; codecs="opus"')) return assetPath(sources.opus, "assets/audio/tracks/");
    if (sources.mp3) return assetPath(sources.mp3, "assets/audio/tracks/");
    if (sources.wav && audio.canPlayType("audio/wav")) return assetPath(sources.wav, "assets/audio/tracks/");
    if (lossless && audio.canPlayType("audio/flac")) return assetPath(lossless, "assets/audio/tracks/");
    return null;
  }
  function markSelected(id) {
    document.querySelectorAll(".card").forEach(function (card) {
      var selected = card.dataset.track === id;
      card.dataset.selected = selected ? "true" : "false";
      if (!selected) card.removeAttribute("data-transport-state");
      var button = card.querySelector(".card__play");
      if (button) button.setAttribute("aria-pressed", selected ? "true" : "false");
      var verb = card.querySelector(".card__insert");
      if (verb) verb.textContent = selected ? "LATCHED" : "ENGAGE";
    });
  }
  function artPath(track) { return "assets/img/sleeves/" + track.artwork.base + "-640.jpg"; }
  function latchCassette(id) {
    var card = document.querySelector('.card[data-track="' + CSS.escape(id) + '"]');
    if (!card || reduceMotion.matches) return;
    card.classList.remove("is-latching");
    void card.offsetWidth;
    card.classList.add("is-latching");
    setTimeout(function () { card.classList.remove("is-latching"); }, 430);
  }
  function dress(track) {
    current = track;
    el.deck.hidden = false;
    el.title.textContent = track.title;
    if (el.artwork) { el.artwork.src = artPath(track); el.artwork.alt = "Cover artwork for " + track.title; }
    var genre = track.style && track.style.genre ? track.style.genre : "Unclassified";
    el.catalogue.textContent = [genre, track.versionLabel, track.catalogueNumber, track.released].filter(Boolean).join(" · ");
    if (el.monitorTitle) el.monitorTitle.textContent = track.title;
    if (el.monitorCode) el.monitorCode.textContent = track.catalogueNumber || track.versionLabel || "ACTIVE";
    if (el.inspiration) {
      var inspiration = (track.style && track.style.inspiration) || (track.notes && track.notes.short) || "No inspiration note stored for this version.";
      el.inspiration.textContent = inspiration;
    }
    el.detailsLink.textContent = "Technical";
    el.meta.innerHTML = metaMarkup(track);
    el.scrub.max = track.audio.duration || 0; el.scrub.value = 0;
    el.total.textContent = clock(track.audio.duration); el.elapsed.textContent = "0:00";
    if (el.qualityToggle) {
      el.qualityToggle.parentElement.dataset.available = hasLossless(track) ? "true" : "false";
      el.qualityToggle.disabled = !hasLossless(track);
      el.qualityToggle.checked = hasLossless(track) && recall("gbr:lossless") === "on";
    }
    markSelected(track.id); renderLyrics(track); setMediaSession(track); latchCassette(track.id);
    try { history.replaceState(null, "", "?track=" + encodeURIComponent(track.slug)); } catch (_) {}
  }
  function metaMarkup(track) {
    var rows = [];
    if (track.model && track.model.provider) rows.push(["Model", [track.model.provider, track.model.name].filter(Boolean).join(" ")]);
    if (track.provenance && track.provenance.songVersion != null) rows.push(["Song ver.", "v" + track.provenance.songVersion]);
    if (track.provenance && track.provenance.generationNumber != null) rows.push(["Generation", "#" + track.provenance.generationNumber]);
    var generation = track.generation || {};
    [["CFG","cfg"],["Steps","steps"],["Seed","seed"]].forEach(function (pair) { if (generation[pair[1]] != null) rows.push([pair[0], String(generation[pair[1]])]); });
    if (track.style && track.style.genre) rows.push(["Genre", track.style.genre]);
    if (!rows.length) return '<p class="meta__empty">Generation details for this release have not been written up yet.</p>';
    return '<dl class="meta">' + rows.map(function (r) { return '<div class="meta__row"><dt>' + r[0] + '</dt><dd>' + escapeHtml(r[1]) + '</dd></div>'; }).join("") + '</dl>';
  }
  function setMediaSession(track) {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    navigator.mediaSession.metadata = new MediaMetadata({title:track.title, artist:"Good Boy Records", album:track.catalogueNumber || "Good Boy Records", artwork:[{src:artPath(track),sizes:"640x640",type:"image/jpeg"}]});
    try {
      navigator.mediaSession.setActionHandler("play", function () { audio.play().catch(function () {}); });
      navigator.mediaSession.setActionHandler("pause", function () { audio.pause(); });
      navigator.mediaSession.setActionHandler("nexttrack", function () {
        setCycleArmed(true);
        var next = randomNextTrack();
        if (next) spinAndEngage(next, true, true);
      });
    } catch (_) {}
  }
  function sourceIsCrossOrigin(source) {
    if (!source || location.protocol === "file:") return false;
    try { return new URL(source, location.href).origin !== location.origin; }
    catch (_) { return false; }
  }
  function configureMediaCors(source) {
    /* Local/bundled media must not be forced through CORS mode. In particular,
       file:// pages have an opaque origin and Chromium will reject otherwise
       valid local MP3s if crossorigin=anonymous is left on permanently. */
    if (sourceIsCrossOrigin(source)) audio.crossOrigin = "anonymous";
    else audio.removeAttribute("crossorigin");
  }
  function playbackFailure(error) {
    var name = error && error.name ? error.name : "PlaybackError";
    if (name === "NotAllowedError") return "Playback was blocked until a direct play gesture";
    if (name === "NotSupportedError") return "This audio source or format is not supported";
    if (name === "AbortError") return "Playback was interrupted while the source changed";
    return "Playback failed (" + name + ")";
  }
  function beginPlayback() {
    var attempt;
    try { attempt = audio.play(); }
    catch (error) { setState("blocked"); say(playbackFailure(error), "alert"); return; }
    /* Call play() first while we are still inside the user's click. The analyser
       is decorative and is not allowed to get in front of actual playback. */
    resumeAnalyser();
    if (attempt && attempt.then) {
      attempt.then(function () { audioUnlocked = true; revealPreviewToggle(); })
        .catch(function (error) { setState("blocked"); say(playbackFailure(error), "alert"); });
    } else { audioUnlocked = true; revealPreviewToggle(); }
  }
  function loadCurrentSource(shouldPlay) {
    if (!current) return;
    if (current.audio.available === false) { setState("pending"); say("Audio for this track is not in the repository yet", "alert"); audio.removeAttribute("src"); return; }
    var source = chooseSource(current);
    if (!source) { setState("error"); say("No playable source for this track", "alert"); return; }
    configureMediaCors(source);
    audio.src = source; audio.load();
    if (!shouldPlay) { setState("paused"); say("Ready"); return; }
    setState("loading"); say("Loading"); beginPlayback();
  }
  function select(track, shouldPlay, withInsertSound) { stopPreview(); dress(track); if (withInsertSound) playCassetteInsertSound(); loadCurrentSource(shouldPlay); }

  /* --------------------------------------------------------- audio events */
  audio.addEventListener("playing", function () { setState("playing"); say("Playing"); audioUnlocked = true; revealPreviewToggle(); resumeAnalyser(); startMeters(); startLyricClock(); });
  audio.addEventListener("pause", function () { if (!audio.ended) { setState("paused"); say("Paused"); } restMeters(); stopLyricClock(); highlight(audio.currentTime || 0); });
  audio.addEventListener("waiting", function () { setState("buffering"); say("Buffering"); });
  audio.addEventListener("ended", function () {
    setState("ended"); say("End of side"); setFollowing(true); restMeters(); stopLyricClock(); highlight(audio.currentTime || 0);
    if (cycleArmed && cycleToRandomTrack()) say("Changing tape");
  });
  audio.addEventListener("error", function () { setState("error"); say("That file would not load", "alert"); restMeters(); stopLyricClock(); });
  audio.addEventListener("loadedmetadata", function () { if (isFinite(audio.duration) && audio.duration > 0) { el.scrub.max = audio.duration; el.total.textContent = clock(audio.duration); } });
  audio.addEventListener("timeupdate", function () { if (!scrubbing) { el.scrub.value = audio.currentTime; el.elapsed.textContent = clock(audio.currentTime); } highlight(audio.currentTime); });
  audio.addEventListener("seeking", function () { say("Seeking"); });
  audio.addEventListener("seeked", function () { cueIndex = -2; pastCueIndex = -2; highlight(audio.currentTime); say(audio.paused ? "Paused" : "Playing"); });
  audio.addEventListener("ratechange", function () { cueIndex = -2; pastCueIndex = -2; });


  /* ------------------------------------------------------ viewport player */
  function initViewportPlayer() {
    if (!el.playerRail) return;
    /* v5.12: the transport is the stationary reference frame. It is visible
       from page load and remains fixed at the top while only the document wall
       scrolls underneath it. */
    el.playerRail.dataset.visible = "true";
  }

  /* ------------------------------------------------------------- controls */
  el.toggle.addEventListener("click", function () {
    if (!current) return;
    if (audio.paused) beginPlayback();
    else audio.pause();
  });
  if (el.shuffle) el.shuffle.addEventListener("click", function () {
    setCycleArmed(true);
    var next = randomNextTrack();
    if (!next) { say("No playable cassette available for shuffle", "alert"); return; }
    spinAndEngage(next, true, true);
    say("Shuffle magazine");
  });
  el.scrub.addEventListener("pointerdown", function () { scrubbing = true; });
  el.scrub.addEventListener("input", function () { el.elapsed.textContent = clock(Number(el.scrub.value)); });
  function commitScrub() { if (!scrubbing && document.activeElement !== el.scrub) return; scrubbing = false; if (current && audio.src) audio.currentTime = Number(el.scrub.value); }
  el.scrub.addEventListener("change", commitScrub); el.scrub.addEventListener("pointerup", commitScrub);
  el.volume.addEventListener("input", function () { audio.volume = Number(el.volume.value); remember("gbr:volume", el.volume.value); });
  el.lyricsReturn.addEventListener("click", function () { setFollowing(true); centre(el.lyricsList.children[cueIndex]); });
  ["wheel","touchmove","keydown"].forEach(function (type) { el.lyricsScroll.addEventListener(type, function () { setFollowing(false); }, {passive:true}); });
  if (el.previewToggle) {
    el.previewToggle.checked = recall("gbr:previews") === "on";
    el.previewToggle.addEventListener("change", function () { remember("gbr:previews", el.previewToggle.checked ? "on" : "off"); if (!el.previewToggle.checked) stopPreview(); });
  }
  if (el.qualityToggle) {
    el.qualityToggle.checked = recall("gbr:lossless") === "on";
    el.qualityToggle.addEventListener("change", function () {
      remember("gbr:lossless", el.qualityToggle.checked ? "on" : "off");
      if (current) { var wasPlaying = !audio.paused; var oldTime = audio.currentTime || 0; loadCurrentSource(false); audio.addEventListener("loadedmetadata", function () { audio.currentTime = Math.min(oldTime, audio.duration || oldTime); if (wasPlaying) beginPlayback(); }, {once:true}); }
    });
  }

  if (el.eqToggle && el.eqPopover) {
    el.eqToggle.addEventListener("click", function () {
      var opening = el.eqPopover.hidden;
      el.eqPopover.hidden = !opening;
      el.eqToggle.setAttribute("aria-expanded", opening ? "true" : "false");
      if (opening) ensureAudioGraph();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !el.eqPopover.hidden) { el.eqPopover.hidden = true; el.eqToggle.setAttribute("aria-expanded", "false"); el.eqToggle.focus(); }
    });
  }

  /* ------------------------------------------------------------- equalizer */
  (function initEqControls() {
    var stored = eqStateFromStorage();
    eqInputs.forEach(function (input) {
      var key = input.dataset.eqFrequency;
      if (Object.prototype.hasOwnProperty.call(stored, key)) {
        var value = Math.max(Number(input.min), Math.min(Number(input.max), Number(stored[key]) || 0));
        input.value = value;
      }
      input.addEventListener("input", function () { ensureAudioGraph(); applyEq(); });
    });
    if (el.eqReset) el.eqReset.addEventListener("click", function () {
      eqInputs.forEach(function (input) { input.value = 0; });
      ensureAudioGraph(); applyEq();
    });
    updateEqLabels();
    setEqAvailability(location.protocol !== "file:" && !!(window.AudioContext || window.webkitAudioContext));
  })();

  function shuffleSongGroups() {
    var wall = document.querySelector(".track-wall");
    if (!wall) return;
    var groups = Array.prototype.slice.call(wall.children).filter(function (child) { return child.classList.contains("track-group"); });
    for (var i = groups.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = groups[i]; groups[i] = groups[j]; groups[j] = tmp;
    }
    groups.forEach(function (group) { wall.appendChild(group); });
  }

  function initCarousel() {
    if (!el.carousel) return;
    carouselCards = Array.prototype.slice.call(document.querySelectorAll(".track-wall .card"));
    if (!carouselCards.length) return;
    carouselStep = 360 / carouselCards.length;
    carouselCards.forEach(function (card, index) { card.dataset.carouselIndex = String(index); });
    carouselRotation = 0; carouselIndex = 0; renderCarousel(0);

    if (el.carouselPrev) el.carouselPrev.addEventListener("click", function () { stepCarousel(-1); });
    if (el.carouselNext) el.carouselNext.addEventListener("click", function () { stepCarousel(1); });

    el.carousel.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") { event.preventDefault(); stepCarousel(-1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); stepCarousel(1); }
      else if ((event.key === "Enter" || event.key === " ") && carouselCards[carouselNearestIndex()]) {
        event.preventDefault();
        var track = byId[carouselCards[carouselNearestIndex()].dataset.track];
        if (track) { setCycleArmed(true); spinAndEngage(track, true, false); }
      }
    });

    el.carousel.addEventListener("wheel", function (event) {
      if (!(event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) return;
      event.preventDefault();
      if (carouselWheelLock) return;
      carouselWheelLock = true;
      stepCarousel((event.deltaX || event.deltaY) > 0 ? 1 : -1);
      window.setTimeout(function () { carouselWheelLock = false; }, 180);
    }, {passive:false});

    el.carousel.addEventListener("pointerdown", function (event) {
      if (carouselAnimating || event.button !== 0) return;
      carouselPointer = {id:event.pointerId, x:event.clientX, rotation:carouselRotation, moved:false};
      el.carousel.dataset.dragging = "true";
      try { el.carousel.setPointerCapture(event.pointerId); } catch (_) {}
    });
    el.carousel.addEventListener("pointermove", function (event) {
      if (!carouselPointer || carouselPointer.id !== event.pointerId) return;
      var dx = event.clientX - carouselPointer.x;
      if (Math.abs(dx) > 5) carouselPointer.moved = true;
      carouselRotation = carouselPointer.rotation + dx * .42;
      renderCarousel(0);
    });
    function releaseCarouselPointer(event) {
      if (!carouselPointer || carouselPointer.id !== event.pointerId) return;
      var moved = carouselPointer.moved;
      carouselPointer = null; el.carousel.dataset.dragging = "false";
      if (moved) carouselSuppressClickUntil = Date.now() + 350;
      rotateCarouselTo(carouselNearestIndex(), {duration:280}, null);
      try { el.carousel.releasePointerCapture(event.pointerId); } catch (_) {}
    }
    el.carousel.addEventListener("pointerup", releaseCarouselPointer);
    el.carousel.addEventListener("pointercancel", releaseCarouselPointer);
    el.carousel.addEventListener("click", function (event) {
      if (Date.now() < carouselSuppressClickUntil) { event.preventDefault(); event.stopPropagation(); }
    }, true);
  }

  /* ---------------------------------------------------------------- shelf */
  document.querySelectorAll("[data-play]").forEach(function (button) {
    var track = byId[button.dataset.play]; if (!track) return;
    button.addEventListener("click", function (event) {
      if (Date.now() < carouselSuppressClickUntil) { event.preventDefault(); return; }
      setCycleArmed(true);
      if (current && current.id === track.id) {
        if (audio.paused) beginPlayback();
        else audio.pause();
        return;
      }
      spinAndEngage(track, true, false);
    });
    var card = button.closest(".card");
    if (card && canHover) { card.addEventListener("mouseenter", function () { startPreview(track); }); card.addEventListener("mouseleave", stopPreview); card.addEventListener("focusout", stopPreview); }
  });

  /* ----------------------------------------------------------------- boot */
  initSpectrum();
  shuffleSongGroups();
  initCarousel();
  initViewportPlayer();
  audio.removeAttribute("controls");
  var storedVolume = recall("gbr:volume"); audio.volume = storedVolume === null ? .9 : Number(storedVolume); el.volume.value = audio.volume;
  var requested = new URLSearchParams(location.search).get("track");
  if (requested) {
    var match = catalogue.filter(function (track) { return track.slug === requested; })[0];
    if (match) { var requestedIndex = carouselIndexForTrack(match); if (requestedIndex >= 0) rotateCarouselTo(requestedIndex, {duration:0}, null); updateCassetteBay(match); var requestedCard = requestedIndex >= 0 ? carouselCards[requestedIndex] : null; if (requestedCard) requestedCard.classList.add("is-in-deck"); select(match, false, false); }
  }
})();
