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
    detailsLink: document.getElementById("deck-details"), status: document.getElementById("deck-status"),
    audio: document.getElementById("showcase-player"), toggle: document.getElementById("transport-toggle"),
    scrub: document.getElementById("transport-scrub"), elapsed: document.getElementById("time-elapsed"),
    total: document.getElementById("time-total"), volume: document.getElementById("transport-volume"),
    lyrics: document.getElementById("lyrics"), lyricsScroll: document.getElementById("lyrics-scroll"),
    lyricsList: document.getElementById("lyrics-list"), lyricsReturn: document.getElementById("lyrics-return"),
    lyricsNote: document.getElementById("lyrics-note"), previewField: document.getElementById("preview-field"),
    previewToggle: document.getElementById("preview-toggle"), qualityToggle: document.getElementById("quality-toggle"),
    monitorTitle: document.getElementById("wall-monitor-title"), monitorCode: document.getElementById("wall-monitor-code"),
    inspiration: document.getElementById("deck-inspiration"),
    vuLeft: document.getElementById("vu-left"), vuRight: document.getElementById("vu-right"),
    eqPanel: document.getElementById("eq-panel"), eqReset: document.getElementById("eq-reset"), eqNote: document.getElementById("eq-note"),
    playerRail: document.getElementById("player-rail"), stage: document.querySelector(".showcase-stage")
  };
  if (!el.deck || !el.audio) return;

  var audio = el.audio;
  var preview = new Audio();
  preview.preload = "none";
  preview.volume = 0.55;
  var current = null, cues = [], cueIndex = -1, wordIndex = -1, wordTimed = false, lyricsLoadToken = 0, lyricFrame = null, scrubbing = false, following = true;
  var audioUnlocked = false, previewTimer = null, previewStop = null;
  var canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var audioContext = null, mediaSource = null, analyser = null, analyserData = null, vuFrame = null;
  var eqFilters = [], eqHeadroom = null;
  var eqInputs = Array.prototype.slice.call(document.querySelectorAll("[data-eq-frequency]"));
  var eqFrequencies = [60, 250, 1000, 4000, 12000];

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

  /* ----------------------------------------------------------- appearance */
  function setFormat(format) {
    format = format === "vinyl" ? "vinyl" : "cassette";
    document.body.dataset.format = format;
    document.querySelectorAll("[data-format-choice]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.formatChoice === format ? "true" : "false");
    });
    remember("gbr:format", format);
  }
  document.querySelectorAll("[data-format-choice]").forEach(function (button) {
    button.addEventListener("click", function () { setFormat(button.dataset.formatChoice); });
  });
  setFormat(recall("gbr:format") || "cassette");

  /* --------------------------------------------------------------- lyrics */
  function renderCueSet(nextCues, mode) {
    cues = Array.isArray(nextCues) ? nextCues : [];
    cueIndex = -1;
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
          if (wordNumber) line.appendChild(document.createTextNode(" "));
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
    wordIndex = -1;
    wordTimed = false;
    el.lyrics.dataset.mode = "raw";
    setFollowing(false);
    el.lyricsScroll.scrollTop = 0;
  }

  function renderLyrics(track) {
    lyricsLoadToken += 1;
    var token = lyricsLoadToken;
    var fallback = (track.lyrics && track.lyrics.cues) || [];
    if (!renderCueSet(fallback, "line")) renderRawLyrics(track);
    el.lyricsNote.hidden = !(track.lyrics && track.lyrics.status === "placeholder");

    var timing = track.lyrics && track.lyrics.wordTiming;
    if (!timing || !timing.src) return;
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
    var changed = index !== cueIndex;
    if (changed) {
      cueIndex = index;
      wordIndex = -1;
      var lines = el.lyricsList.children;
      for (var i = 0; i < lines.length; i++) {
        lines[i].classList.toggle("is-active", i === index);
        lines[i].classList.toggle("is-past", index >= 0 && i < index);
        if (i !== index) {
          lines[i].querySelectorAll(".lyrics__word").forEach(function (span) {
            span.classList.remove("is-current", "is-next");
            span.classList.toggle("is-sung", i < index);
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
    /* Preserve some headroom when bands are boosted, rather than turning the
       equalizer into an accidental clipping machine. */
    if (eqHeadroom) {
      var linear = Math.pow(10, -maxBoost / 20);
      try { eqHeadroom.gain.setTargetAtTime(linear, now, .03); } catch (_) { eqHeadroom.gain.value = linear; }
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
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = .68;
      analyserData = new Uint8Array(analyser.fftSize);

      mediaSource.connect(eqHeadroom);
      var node = eqHeadroom;
      eqFilters.forEach(function (filter) { node.connect(filter); node = filter; });
      node.connect(analyser);
      analyser.connect(audioContext.destination);
      setEqAvailability(true);
      applyEq();
    } catch (_) { analyser = null; eqFilters = []; setEqAvailability(false); }
  }
  function resumeAnalyser() {
    ensureAudioGraph();
    if (audioContext && audioContext.state === "suspended") audioContext.resume().catch(function () {});
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
    vuFrame = requestAnimationFrame(drawMeters);
  }
  function startMeters() { if (vuFrame) cancelAnimationFrame(vuFrame); if (analyser) vuFrame = requestAnimationFrame(drawMeters); }
  function restMeters() {
    if (vuFrame) cancelAnimationFrame(vuFrame); vuFrame = null;
    if (el.vuLeft) el.vuLeft.style.transform = "rotate(-42deg)";
    if (el.vuRight) el.vuRight.style.transform = "rotate(-42deg)";
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
    var genre = track.style && track.style.genre ? track.style.genre : "Unclassified";
    el.catalogue.textContent = [genre, track.versionLabel, track.catalogueNumber, track.released].filter(Boolean).join(" · ");
    if (el.monitorTitle) el.monitorTitle.textContent = track.title;
    if (el.monitorCode) el.monitorCode.textContent = track.catalogueNumber || track.versionLabel || "ACTIVE";
    if (el.inspiration) {
      var inspiration = (track.style && track.style.inspiration) || (track.notes && track.notes.short) || "No inspiration note stored for this version.";
      el.inspiration.textContent = inspiration;
    }
    el.detailsLink.href = "music/" + track.slug + "/";
    el.detailsLink.textContent = "Technical record";
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
  function select(track, shouldPlay) { stopPreview(); dress(track); loadCurrentSource(shouldPlay); }

  /* --------------------------------------------------------- audio events */
  audio.addEventListener("playing", function () { setState("playing"); say("Playing"); audioUnlocked = true; revealPreviewToggle(); resumeAnalyser(); startMeters(); startLyricClock(); });
  audio.addEventListener("pause", function () { if (!audio.ended) { setState("paused"); say("Paused"); } restMeters(); stopLyricClock(); highlight(audio.currentTime || 0); });
  audio.addEventListener("waiting", function () { setState("buffering"); say("Buffering"); });
  audio.addEventListener("ended", function () { setState("ended"); say("End of side"); setFollowing(true); restMeters(); stopLyricClock(); highlight(audio.currentTime || 0); });
  audio.addEventListener("error", function () { setState("error"); say("That file would not load", "alert"); restMeters(); stopLyricClock(); });
  audio.addEventListener("loadedmetadata", function () { if (isFinite(audio.duration) && audio.duration > 0) { el.scrub.max = audio.duration; el.total.textContent = clock(audio.duration); } });
  audio.addEventListener("timeupdate", function () { if (!scrubbing) { el.scrub.value = audio.currentTime; el.elapsed.textContent = clock(audio.currentTime); } highlight(audio.currentTime); });
  audio.addEventListener("seeking", function () { say("Seeking"); });
  audio.addEventListener("seeked", function () { cueIndex = -1; highlight(audio.currentTime); say(audio.paused ? "Paused" : "Playing"); });
  audio.addEventListener("ratechange", function () { cueIndex = -1; });


  /* ------------------------------------------------------ viewport player */
  function initViewportPlayer() {
    if (!el.playerRail || !el.stage) return;
    var desktop = window.matchMedia("(min-width:1121px)");

    function setVisible(visible) {
      el.playerRail.dataset.visible = visible ? "true" : "false";
    }
    function configure() {
      if (!desktop.matches) { setVisible(true); return; }
      if (!("IntersectionObserver" in window)) { setVisible(true); return; }
      if (el.playerRail._gbrObserver) el.playerRail._gbrObserver.disconnect();
      var observer = new IntersectionObserver(function (entries) {
        setVisible(entries.some(function (entry) { return entry.isIntersecting; }));
      }, { root:null, threshold:0, rootMargin:"-52px 0px 0px 0px" });
      observer.observe(el.stage);
      el.playerRail._gbrObserver = observer;
    }
    configure();
    if (desktop.addEventListener) desktop.addEventListener("change", configure);
    else if (desktop.addListener) desktop.addListener(configure);
  }

  /* ------------------------------------------------------------- controls */
  el.toggle.addEventListener("click", function () {
    if (!current) return;
    if (audio.paused) beginPlayback();
    else audio.pause();
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

  /* ---------------------------------------------------------------- shelf */
  document.querySelectorAll("[data-play]").forEach(function (button) {
    var track = byId[button.dataset.play]; if (!track) return;
    button.addEventListener("click", function () {
      if (current && current.id === track.id) {
        if (audio.paused) beginPlayback();
        else audio.pause();
        return;
      }
      select(track, true);
    });
    var card = button.closest(".card");
    if (card && canHover) { card.addEventListener("mouseenter", function () { startPreview(track); }); card.addEventListener("mouseleave", stopPreview); card.addEventListener("focusout", stopPreview); }
  });

  /* ----------------------------------------------------------------- boot */
  initViewportPlayer();
  audio.removeAttribute("controls");
  var storedVolume = recall("gbr:volume"); audio.volume = storedVolume === null ? .9 : Number(storedVolume); el.volume.value = audio.volume;
  var requested = new URLSearchParams(location.search).get("track");
  if (requested) { var match = catalogue.filter(function (track) { return track.slug === requested; })[0]; if (match) select(match, false); }
})();
