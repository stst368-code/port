(function () {
  "use strict";

  var TYPE_COLORS = {
    CLIP: "#d6ad45",
    CONDITIONING: "#d1843b",
    MODEL: "#a875d6",
    LATENT: "#8f65c7",
    VAE: "#c76666",
    AUDIO: "#5b9ecf",
    FLOAT: "#70a86d",
    INT: "#78a86d",
    STRING: "#c9c4b8",
    IMAGE: "#6ca7a0"
  };


  var MEDIA_EXTENSIONS = {
    image: /\.(?:png|jpe?g|webp|gif|svg|avif)$/i,
    video: /\.(?:mp4|webm|mov|m4v|ogv)$/i,
    audio: /\.(?:mp3|flac|wav|ogg|oga|m4a|aac|opus)$/i
  };

  function safeMediaPath(value) {
    var raw = String(value || "").trim().replace(/\\/g, "/");
    if (!raw || raw.charAt(0) === "/") return "";
    var parts = raw.split("/");
    if (parts.some(function (part) { return !part || part === "." || part === ".."; })) return "";
    return parts.map(function (part) { return encodeURIComponent(part); }).join("/");
  }

  function mediaInfo(node) {
    var named = node && node.widgets_values_named;
    var values = [];
    if (named && typeof named === "object" && !Array.isArray(named)) {
      ["audio", "file", "image"].forEach(function (key) {
        if (typeof named[key] === "string") values.push(named[key]);
      });
    }
    if (Array.isArray(node && node.widgets_values)) {
      node.widgets_values.forEach(function (value) {
        if (typeof value === "string") values.push(value);
      });
    }
    for (var i = 0; i < values.length; i += 1) {
      var value = values[i];
      if (MEDIA_EXTENSIONS.audio.test(value)) return { kind: "audio", file: value };
      if (MEDIA_EXTENSIONS.video.test(value)) return { kind: "video", file: value };
      if (MEDIA_EXTENSIONS.image.test(value)) return { kind: "image", file: value };
    }
    return null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function alphaColor(value, alpha) {
    if (!value) return "rgba(110, 90, 70, " + alpha + ")";
    var hex = String(value).trim();
    if (/^#[0-9a-f]{3}$/i.test(hex)) {
      hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      var r = parseInt(hex.slice(1, 3), 16);
      var g = parseInt(hex.slice(3, 5), 16);
      var b = parseInt(hex.slice(5, 7), 16);
      return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
    }
    return value;
  }

  function portColor(type) {
    return TYPE_COLORS[type] || "#9d9182";
  }

  function normaliseSize(node) {
    var size = node && node.size;
    if (Array.isArray(size)) return [Number(size[0]) || 260, Number(size[1]) || 120];
    if (size && typeof size === "object") {
      return [Number(size[0] || size.width) || 260, Number(size[1] || size.height) || 120];
    }
    return [260, 120];
  }

  function normalisePos(node) {
    var pos = node && node.pos;
    if (Array.isArray(pos)) return [Number(pos[0]) || 0, Number(pos[1]) || 0];
    if (pos && typeof pos === "object") {
      return [Number(pos[0] || pos.x) || 0, Number(pos[1] || pos.y) || 0];
    }
    return [0, 0];
  }

  function formatValue(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try { return JSON.stringify(value, null, 2); }
    catch (_) { return String(value); }
  }

  function widgetEntries(node) {
    var named = node.widgets_values_named;
    if (named && typeof named === "object" && !Array.isArray(named)) {
      return Object.keys(named).map(function (key) {
        return { key: key, value: formatValue(named[key]) };
      });
    }

    var values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
    if (!values.length) return [];

    var inputs = Array.isArray(node.inputs) ? node.inputs : [];
    if ((node.type === "PrimitiveString" || node.type === "PrimitiveStringMultiline") && values.length) {
      var label = (inputs[0] && (inputs[0].label || inputs[0].name)) || "value";
      return [{ key: label, value: formatValue(values[0]) }];
    }

    return values.map(function (value, index) {
      return { key: "value " + (index + 1), value: formatValue(value) };
    });
  }

  function WorkflowViewer(root) {
    this.root = root;
    this.stage = null;
    this.panLayer = null;
    this.world = null;
    this.linkSvg = null;
    this.workflow = null;
    this.nodeMap = new Map();
    this.shiftX = 0;
    this.shiftY = 0;
    this.worldWidth = 1;
    this.worldHeight = 1;
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.drag = null;
    this.pointers = new Map();
    this.gesture = null;
    this.wire = null;
    this.userWireCount = 0;
    this.initialFitDone = false;
    this.lastStageWidth = 0;
    this.lastStageHeight = 0;
    this.lastTapAt = 0;
    this.focusNode = root.dataset.focus ? String(root.dataset.focus) : "";
    this.mediaRoot = String(root.dataset.mediaRoot || "assets/workflow-media").replace(/\/+$/, "");
    this.useCssZoom = "zoom" in document.documentElement.style;
    this.buildShell();
    this.load();
  }

  WorkflowViewer.prototype.buildShell = function () {
    var height = clamp(parseInt(this.root.dataset.height || "620", 10) || 620, 320, 1100);
    this.root.style.setProperty("--cw-height", height + "px");
    this.root.innerHTML =
      '<div class="cw-toolbar">' +
        '<div class="cw-title"><strong>COMFYUI WORKFLOW</strong><span class="cw-meta">Loading...</span><span class="cw-navhint">DRAG · PINCH · WHEEL · DRAW CABLES</span></div>' +
        '<div class="cw-actions">' +
          '<button type="button" data-cw-action="out" aria-label="Zoom out">−</button>' +
          '<button type="button" data-cw-action="in" aria-label="Zoom in">+</button>' +
          '<button type="button" data-cw-action="fit">FIT</button>' +
          '<button type="button" data-cw-action="fullscreen">FULLSCREEN</button>' +
        '</div>' +
      '</div>' +
      '<div class="cw-stage" tabindex="0" aria-label="Read-only ComfyUI workflow. Drag with a mouse or one finger to pan. Pinch or use the mouse wheel to zoom.">' +
        '<div class="cw-loading">Loading workflow…</div>' +
      '</div>';

    this.stage = this.root.querySelector(".cw-stage");
    this.bindControls();
  };

  WorkflowViewer.prototype.bindControls = function () {
    var self = this;
    this.root.querySelectorAll("[data-cw-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        var action = button.dataset.cwAction;
        if (action === "fit") self.fit(true);
        if (action === "in") self.zoomBy(1.18);
        if (action === "out") self.zoomBy(1 / 1.18);
        if (action === "fullscreen") self.toggleFullscreen();
      });
    });

    /* Keep the canvas grid attached to the graph. A stationary grid while the
       nodes move is subtle, but it makes panning feel uncannily wrong. */
    this.stage.addEventListener("wheel", function (event) {
      if (!self.world) return;
      event.preventDefault();
      var rect = self.stage.getBoundingClientRect();
      var x = event.clientX - rect.left;
      var y = event.clientY - rect.top;
      var delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= rect.height;
      delta = clamp(delta, -160, 160);
      var factor = Math.exp(-delta * 0.0024);
      self.zoomAt(x, y, factor);
    }, { passive: false });

    function point(event) {
      var rect = self.stage.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function firstTwoPointers() {
      var values = Array.from(self.pointers.values());
      return values.length >= 2 ? [values[0], values[1]] : null;
    }

    function distance(a, b) {
      var dx = b.x - a.x, dy = b.y - a.y;
      return Math.max(1, Math.hypot(dx, dy));
    }

    function midpoint(a, b) {
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function beginPan(id, p) {
      self.gesture = {
        mode: "pan",
        id: id,
        x: p.x,
        y: p.y,
        panX: self.panX,
        panY: self.panY,
        moved: false
      };
    }

    function beginPinch() {
      var pair = firstTwoPointers();
      if (!pair) return;
      var mid = midpoint(pair[0], pair[1]);
      self.gesture = {
        mode: "pinch",
        distance: distance(pair[0], pair[1]),
        scale: self.scale,
        panX: self.panX,
        panY: self.panY,
        midX: mid.x,
        midY: mid.y,
        worldX: (mid.x - self.panX) / self.scale,
        worldY: (mid.y - self.panY) / self.scale
      };
    }

    this.stage.addEventListener("pointerdown", function (event) {
      if (!self.world) return;
      if (event.target && event.target.closest && event.target.closest(".cw-port-handle")) return;
      if (event.target && event.target.closest && event.target.closest(".cw-user-link")) return;
      if (event.target && event.target.closest && event.target.closest(".cw-text-selectable")) return;
      if (event.target && event.target.closest && event.target.closest(".cw-media-interactive")) return;
      /* Touch/pen pointer events do not need a mouse-button test. */
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      var p = point(event);
      self.pointers.set(event.pointerId, p);
      try { self.stage.setPointerCapture(event.pointerId); } catch (_) {}
      self.stage.dataset.dragging = "true";
      if (self.pointers.size >= 2) beginPinch();
      else beginPan(event.pointerId, p);
    }, { passive: false });

    this.stage.addEventListener("pointermove", function (event) {
      if (self.wire && self.wire.pointerId === event.pointerId) {
        event.preventDefault();
        self.updateWire(event);
        return;
      }
      if (!self.pointers.has(event.pointerId)) return;
      event.preventDefault();
      var p = point(event);
      self.pointers.set(event.pointerId, p);

      if (self.pointers.size >= 2) {
        if (!self.gesture || self.gesture.mode !== "pinch") beginPinch();
        var pair = firstTwoPointers();
        if (!pair || !self.gesture) return;
        var mid = midpoint(pair[0], pair[1]);
        var next = clamp(self.gesture.scale * (distance(pair[0], pair[1]) / self.gesture.distance), 0.035, 3.0);
        self.scale = next;
        self.panX = mid.x - self.gesture.worldX * next;
        self.panY = mid.y - self.gesture.worldY * next;
        self.applyTransform();
        return;
      }

      if (!self.gesture || self.gesture.mode !== "pan") beginPan(event.pointerId, p);
      if (!self.gesture || self.gesture.id !== event.pointerId) return;
      var dx = p.x - self.gesture.x;
      var dy = p.y - self.gesture.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) self.gesture.moved = true;
      self.panX = self.gesture.panX + dx;
      self.panY = self.gesture.panY + dy;
      self.applyTransform();
    }, { passive: false });

    function finishPointer(event) {
      if (self.wire && self.wire.pointerId === event.pointerId) {
        self.finishWire(event);
        return;
      }
      if (!self.pointers.has(event.pointerId)) return;
      var wasMoved = self.gesture && self.gesture.moved;
      self.pointers.delete(event.pointerId);
      try { self.stage.releasePointerCapture(event.pointerId); } catch (_) {}

      if (self.pointers.size >= 2) {
        beginPinch();
      } else if (self.pointers.size === 1) {
        var remaining = self.pointers.entries().next().value;
        beginPan(remaining[0], remaining[1]);
      } else {
        self.gesture = null;
        self.stage.dataset.dragging = "false";
        /* Double tap/click on empty canvas is a quick way home. */
        if (!wasMoved) {
          var now = performance.now();
          if (now - self.lastTapAt < 320) {
            self.lastTapAt = 0;
            self.fit(true);
          } else {
            self.lastTapAt = now;
          }
        }
      }
    }
    this.stage.addEventListener("pointerup", finishPointer);
    this.stage.addEventListener("pointercancel", finishPointer);
    this.stage.addEventListener("lostpointercapture", function (event) {
      if (self.pointers.has(event.pointerId)) finishPointer(event);
    });
    this.stage.addEventListener("contextmenu", function (event) { event.preventDefault(); });

    this.stage.addEventListener("keydown", function (event) {
      if (event.key === "+" || event.key === "=") { event.preventDefault(); self.zoomBy(1.15); }
      else if (event.key === "-") { event.preventDefault(); self.zoomBy(1 / 1.15); }
      else if (event.key === "0") { event.preventDefault(); self.fit(true); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); self.panX += 40; self.applyTransform(); }
      else if (event.key === "ArrowRight") { event.preventDefault(); self.panX -= 40; self.applyTransform(); }
      else if (event.key === "ArrowUp") { event.preventDefault(); self.panY += 40; self.applyTransform(); }
      else if (event.key === "ArrowDown") { event.preventDefault(); self.panY -= 40; self.applyTransform(); }
    });

    if ("ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(function () {
        if (!self.world) return;
        var rect = self.stage.getBoundingClientRect();
        if (rect.width <= 40 || rect.height <= 40) return;
        if (!self.initialFitDone) {
          self.initialFitDone = true;
          self.lastStageWidth = rect.width;
          self.lastStageHeight = rect.height;
          if (self.focusNode) self.focus(self.focusNode);
          else self.fit(false);
          return;
        }
        /* When the folder drawer is resized, preserve the graph point that was
           in the middle of the viewport instead of leaving the view displaced. */
        if (self.lastStageWidth && self.lastStageHeight) {
          self.panX += (rect.width - self.lastStageWidth) / 2;
          self.panY += (rect.height - self.lastStageHeight) / 2;
        }
        self.lastStageWidth = rect.width;
        self.lastStageHeight = rect.height;
        self.applyTransform();
      });
      this.resizeObserver.observe(this.stage);
    } else {
      window.addEventListener("resize", function () {
        if (!self.world) return;
        var rect = self.stage.getBoundingClientRect();
        if (rect.width <= 40 || rect.height <= 40) return;
        self.panX += (rect.width - (self.lastStageWidth || rect.width)) / 2;
        self.panY += (rect.height - (self.lastStageHeight || rect.height)) / 2;
        self.lastStageWidth = rect.width;
        self.lastStageHeight = rect.height;
        self.applyTransform();
      });
    }
  };

  WorkflowViewer.prototype.load = function () {
    var self = this;
    var src = this.root.dataset.workflow;
    fetch(src, { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (workflow) {
        self.workflow = workflow;
        self.render();
      })
      .catch(function (error) {
        self.stage.innerHTML = '<div class="cw-error"><strong>Workflow could not be loaded.</strong><br>' + escapeHtml(error.message) + '</div>';
        var meta = self.root.querySelector(".cw-meta");
        if (meta) meta.textContent = "LOAD ERROR";
      });
  };

  WorkflowViewer.prototype.bounds = function () {
    var items = [];
    var nodes = Array.isArray(this.workflow.nodes) ? this.workflow.nodes : [];
    var groups = Array.isArray(this.workflow.groups) ? this.workflow.groups : [];

    nodes.forEach(function (node) {
      var p = normalisePos(node);
      var s = normaliseSize(node);
      items.push([p[0], p[1], s[0], s[1]]);
    });
    groups.forEach(function (group) {
      if (Array.isArray(group.bounding) && group.bounding.length >= 4) {
        items.push(group.bounding.map(Number));
      }
    });

    if (!items.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 700 };
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    items.forEach(function (r) {
      minX = Math.min(minX, r[0]); minY = Math.min(minY, r[1]);
      maxX = Math.max(maxX, r[0] + r[2]); maxY = Math.max(maxY, r[1] + r[3]);
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  };

  WorkflowViewer.prototype.render = function () {
    var self = this;
    var bounds = this.bounds();
    var margin = 100;
    this.shiftX = margin - bounds.minX;
    this.shiftY = margin - bounds.minY;
    this.worldWidth = Math.max(1, bounds.maxX - bounds.minX + margin * 2);
    this.worldHeight = Math.max(1, bounds.maxY - bounds.minY + margin * 2);

    this.stage.innerHTML = '<div class="cw-pan-layer"><div class="cw-world"></div></div>';
    this.panLayer = this.stage.querySelector(".cw-pan-layer");
    this.world = this.stage.querySelector(".cw-world");
    this.world.style.width = this.worldWidth + "px";
    this.world.style.height = this.worldHeight + "px";

    this.renderGroups();
    this.renderLinks();
    this.renderNodes();
    this.bindWirePorts();

    this.updateMeta();

    requestAnimationFrame(function () {
      var rect = self.stage.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 40) {
        self.initialFitDone = true;
        if (self.focusNode) self.focus(self.focusNode);
        else self.fit(false);
      }
    });
  };

  WorkflowViewer.prototype.renderGroups = function () {
    var self = this;
    (this.workflow.groups || []).forEach(function (group) {
      if (!Array.isArray(group.bounding) || group.bounding.length < 4) return;
      var b = group.bounding.map(Number);
      var el = document.createElement("div");
      el.className = "cw-group";
      el.style.left = (b[0] + self.shiftX) + "px";
      el.style.top = (b[1] + self.shiftY) + "px";
      el.style.width = b[2] + "px";
      el.style.height = b[3] + "px";
      el.style.borderColor = group.color || "#795b34";
      el.style.background = alphaColor(group.color, 0.10);
      var title = document.createElement("div");
      title.className = "cw-group-title";
      title.textContent = group.title || "Group";
      title.style.background = alphaColor(group.color, 0.78);
      el.appendChild(title);
      self.world.appendChild(el);
    });
  };

  WorkflowViewer.prototype.portY = function (node, slot, output) {
    var p = normalisePos(node);
    var list = output ? (node.outputs || []) : (node.inputs || []);
    var count = Math.max(1, list.length);
    var row = 20;
    /* Matches the compact read-only node chrome: 28px header + 4px top
       padding + half a 20px port row. */
    var y = p[1] + this.shiftY + 42 + clamp(Number(slot) || 0, 0, count - 1) * row;
    return y;
  };

  WorkflowViewer.prototype.renderLinks = function () {
    var self = this;
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.classList.add("cw-links");
    this.linkSvg = svg;
    svg.setAttribute("width", this.worldWidth);
    svg.setAttribute("height", this.worldHeight);
    svg.setAttribute("viewBox", "0 0 " + this.worldWidth + " " + this.worldHeight);

    (this.workflow.nodes || []).forEach(function (node) { self.nodeMap.set(String(node.id), node); });

    (this.workflow.links || []).forEach(function (link) {
      if (!Array.isArray(link) || link.length < 6) return;
      var from = self.nodeMap.get(String(link[1]));
      var to = self.nodeMap.get(String(link[3]));
      if (!from || !to) return;
      var fp = normalisePos(from), fs = normaliseSize(from), tp = normalisePos(to);
      var x1 = fp[0] + self.shiftX + fs[0] - 16;
      var y1 = self.portY(from, link[2], true);
      var x2 = tp[0] + self.shiftX + 16;
      var y2 = self.portY(to, link[4], false);
      var bend = Math.max(55, Math.abs(x2 - x1) * 0.45);
      var path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", "M " + x1 + " " + y1 + " C " + (x1 + bend) + " " + y1 + ", " + (x2 - bend) + " " + y2 + ", " + x2 + " " + y2);
      path.setAttribute("stroke", portColor(link[5]));
      path.setAttribute("data-link-type", link[5] || "");
      svg.appendChild(path);
    });

    this.world.appendChild(svg);
  };

  WorkflowViewer.prototype.renderNodes = function () {
    var self = this;
    (this.workflow.nodes || []).forEach(function (node) {
      var p = normalisePos(node), s = normaliseSize(node);
      var el = document.createElement("section");
      el.className = "cw-node" + (node.mode && node.mode !== 0 ? " cw-node--muted" : "");
      el.dataset.nodeId = String(node.id);
      el.style.left = (p[0] + self.shiftX) + "px";
      el.style.top = (p[1] + self.shiftY) + "px";
      el.style.width = s[0] + "px";
      el.style.height = s[1] + "px";
      el.style.background = node.bgcolor || "#25211f";
      el.style.setProperty("--cw-node-head", node.color || "#44362e");

      var title = node.title || node.type || ("Node " + node.id);
      var header = document.createElement("header");
      header.className = "cw-node-head";
      header.innerHTML = '<strong class="cw-text-selectable">' + escapeHtml(title) + '</strong><span class="cw-text-selectable">#' + escapeHtml(node.id) + '</span>';
      el.appendChild(header);

      var ports = document.createElement("div");
      ports.className = "cw-ports";
      var inputs = document.createElement("div");
      inputs.className = "cw-port-list cw-port-list--in";
      (node.inputs || []).forEach(function (input, slot) {
        var row = document.createElement("div");
        row.className = "cw-port";
        var dot = document.createElement("i");
        dot.className = "cw-port-handle";
        dot.style.setProperty("--port", portColor(input.type));
        dot.dataset.nodeId = String(node.id);
        dot.dataset.slot = String(slot);
        dot.dataset.direction = "in";
        dot.dataset.type = String(input.type || "");
        dot.setAttribute("role", "button");
        dot.setAttribute("tabindex", "0");
        dot.setAttribute("aria-label", "Input " + (input.label || input.name || input.type || "port") + ". Drag a cable here.");
        var label = document.createElement("span");
        label.className = "cw-text-selectable";
        label.textContent = input.label || input.name || input.type || "input";
        row.appendChild(dot);
        row.appendChild(label);
        inputs.appendChild(row);
      });
      var outputs = document.createElement("div");
      outputs.className = "cw-port-list cw-port-list--out";
      (node.outputs || []).forEach(function (output, slot) {
        var row = document.createElement("div");
        row.className = "cw-port";
        var label = document.createElement("span");
        label.className = "cw-text-selectable";
        label.textContent = output.name || output.type || "output";
        var dot = document.createElement("i");
        dot.className = "cw-port-handle";
        dot.style.setProperty("--port", portColor(output.type));
        dot.dataset.nodeId = String(node.id);
        dot.dataset.slot = String(slot);
        dot.dataset.direction = "out";
        dot.dataset.type = String(output.type || "");
        dot.setAttribute("role", "button");
        dot.setAttribute("tabindex", "0");
        dot.setAttribute("aria-label", "Output " + (output.name || output.type || "port") + ". Drag to an input to draw a cable.");
        row.appendChild(label);
        row.appendChild(dot);
        outputs.appendChild(row);
      });
      ports.appendChild(inputs);
      ports.appendChild(outputs);
      el.appendChild(ports);

      var media = mediaInfo(node);
      if (media) {
        var safePath = safeMediaPath(media.file);
        if (safePath) {
          var folder = media.kind === "audio" ? "audio" : "images";
          var mediaUrl = self.mediaRoot + "/" + folder + "/" + safePath;
          var mediaBox = document.createElement("div");
          mediaBox.className = "cw-media cw-media--" + media.kind + " cw-media-interactive";
          if (media.kind === "image") {
            var image = document.createElement("img");
            image.src = mediaUrl;
            image.alt = media.file;
            image.loading = "lazy";
            image.draggable = false;
            mediaBox.appendChild(image);
          } else if (media.kind === "video") {
            var video = document.createElement("video");
            video.src = mediaUrl;
            video.controls = true;
            video.preload = "metadata";
            video.playsInline = true;
            mediaBox.appendChild(video);
          } else {
            var audio = document.createElement("audio");
            audio.src = mediaUrl;
            audio.controls = true;
            audio.preload = "metadata";
            mediaBox.appendChild(audio);
          }
          var mediaName = document.createElement("div");
          mediaName.className = "cw-media-name";
          mediaName.textContent = media.file;
          mediaBox.appendChild(mediaName);
          ["pointerdown", "pointermove", "pointerup", "click", "dblclick"].forEach(function (eventName) {
            mediaBox.addEventListener(eventName, function (event) { event.stopPropagation(); });
          });
          el.appendChild(mediaBox);
        }
      }

      var widgets = widgetEntries(node).filter(function (entry) {
        if (!media) return true;
        var key = String(entry.key || "").toLowerCase();
        if (key === "audio" || key === "file" || key === "image" || key === "upload") return false;
        return entry.value !== media.file;
      });
      if (widgets.length) {
        var body = document.createElement("div");
        body.className = "cw-widgets";
        var multiCount = widgets.reduce(function (count, entry) {
          var value = String(entry.value == null ? "" : entry.value);
          return count + ((value.indexOf("\n") !== -1 || value.length > 90) ? 1 : 0);
        }, 0);
        if (widgets.length === 1 && multiCount === 1) body.classList.add("cw-widgets--single-multi");
        if (widgets.length >= 3) body.classList.add("cw-widgets--dense");
        widgets.forEach(function (entry) {
          var field = document.createElement("div");
          field.className = "cw-widget";
          var value = entry.value;
          var multiline = value.indexOf("\n") !== -1 || value.length > 90;
          field.innerHTML = '<div class="cw-widget-key cw-text-selectable">' + escapeHtml(entry.key) + '</div>' +
            '<div class="cw-widget-value cw-text-selectable' + (multiline ? ' cw-widget-value--multi' : '') + '">' + escapeHtml(value || "—") + '</div>';
          body.appendChild(field);
        });
        el.appendChild(body);
      }

      var type = document.createElement("div");
      type.className = "cw-node-type cw-text-selectable";
      type.textContent = node.type || "Unknown node";
      el.appendChild(type);
      self.world.appendChild(el);
    });
  };

  WorkflowViewer.prototype.updateMeta = function () {
    var nodes = Array.isArray(this.workflow && this.workflow.nodes) ? this.workflow.nodes.length : 0;
    var links = Array.isArray(this.workflow && this.workflow.links) ? this.workflow.links.length : 0;
    var extra = this.userWireCount ? " + " + this.userWireCount + " PLAY CABLE" + (this.userWireCount === 1 ? "" : "S") : "";
    var meta = this.root.querySelector(".cw-meta");
    if (meta) meta.textContent = nodes + " NODES / " + links + " LINKS" + extra + " / SAFE SANDBOX";
  };

  WorkflowViewer.prototype.screenToWorld = function (clientX, clientY) {
    var rect = this.stage.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX) / this.scale,
      y: (clientY - rect.top - this.panY) / this.scale
    };
  };

  WorkflowViewer.prototype.portPointFromElement = function (handle) {
    var rect = handle.getBoundingClientRect();
    return this.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  WorkflowViewer.prototype.wirePath = function (a, b) {
    var dx = b.x - a.x;
    var bend = Math.max(55, Math.abs(dx) * 0.45);
    var dir = dx >= 0 ? 1 : -1;
    return "M " + a.x + " " + a.y +
      " C " + (a.x + bend * dir) + " " + a.y +
      ", " + (b.x - bend * dir) + " " + b.y +
      ", " + b.x + " " + b.y;
  };

  WorkflowViewer.prototype.closestPortAt = function (clientX, clientY, exclude) {
    var direct = document.elementFromPoint(clientX, clientY);
    if (direct && direct.closest) {
      var found = direct.closest(".cw-port-handle");
      if (found && found !== exclude && this.root.contains(found)) return found;
    }

    var best = null;
    var bestDistance = 24;
    this.root.querySelectorAll(".cw-port-handle").forEach(function (handle) {
      if (handle === exclude) return;
      var rect = handle.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var d = Math.hypot(clientX - cx, clientY - cy);
      if (d < bestDistance) {
        bestDistance = d;
        best = handle;
      }
    });
    return best;
  };

  WorkflowViewer.prototype.validWireTarget = function (source, target) {
    if (!source || !target || source === target) return false;
    if (source.dataset.direction === target.dataset.direction) return false;
    var a = String(source.dataset.type || "");
    var b = String(target.dataset.type || "");
    if (!a || !b) return true;
    return a === b || a === "*" || b === "*" || a === "ANY" || b === "ANY";
  };

  WorkflowViewer.prototype.bindWirePorts = function () {
    var self = this;
    this.root.querySelectorAll(".cw-port-handle").forEach(function (handle) {
      handle.addEventListener("pointerdown", function (event) {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        self.startWire(event, handle);
      });
      handle.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handle.classList.add("cw-port-handle--pulse");
          setTimeout(function () { handle.classList.remove("cw-port-handle--pulse"); }, 260);
        }
      });
    });
  };

  WorkflowViewer.prototype.startWire = function (event, handle) {
    if (!this.linkSvg || this.wire) return;
    var svgNS = "http://www.w3.org/2000/svg";
    var start = this.portPointFromElement(handle);
    var path = document.createElementNS(svgNS, "path");
    path.classList.add("cw-wire-preview");
    path.setAttribute("stroke", portColor(handle.dataset.type));
    path.setAttribute("d", this.wirePath(start, start));
    this.linkSvg.appendChild(path);

    this.wire = {
      pointerId: event.pointerId,
      source: handle,
      target: null,
      path: path,
      start: start
    };
    handle.classList.add("cw-port-handle--active");
    this.stage.dataset.wiring = "true";
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
  };

  WorkflowViewer.prototype.updateWire = function (event) {
    if (!this.wire) return;
    var target = this.closestPortAt(event.clientX, event.clientY, this.wire.source);
    var valid = this.validWireTarget(this.wire.source, target);

    if (this.wire.target && this.wire.target !== target) {
      this.wire.target.classList.remove("cw-port-handle--target", "cw-port-handle--invalid");
    }
    this.wire.target = target || null;

    var end = this.screenToWorld(event.clientX, event.clientY);
    if (target) {
      target.classList.add(valid ? "cw-port-handle--target" : "cw-port-handle--invalid");
      if (valid) end = this.portPointFromElement(target);
    }

    this.wire.path.classList.toggle("cw-wire-preview--valid", !!valid);
    this.wire.path.classList.toggle("cw-wire-preview--invalid", !!target && !valid);
    this.wire.path.setAttribute("d", this.wirePath(this.wire.start, end));
  };

  WorkflowViewer.prototype.finishWire = function (event) {
    if (!this.wire) return;
    var wire = this.wire;
    var target = this.closestPortAt(event.clientX, event.clientY, wire.source);
    var valid = this.validWireTarget(wire.source, target);

    if (wire.target) wire.target.classList.remove("cw-port-handle--target", "cw-port-handle--invalid");
    wire.source.classList.remove("cw-port-handle--active");
    this.stage.dataset.wiring = "false";

    try { wire.source.releasePointerCapture(event.pointerId); } catch (_) {}

    if (valid && target) {
      var outHandle = wire.source.dataset.direction === "out" ? wire.source : target;
      var inHandle = wire.source.dataset.direction === "in" ? wire.source : target;
      var a = this.portPointFromElement(outHandle);
      var b = this.portPointFromElement(inHandle);
      wire.path.setAttribute("d", this.wirePath(a, b));
      wire.path.classList.remove("cw-wire-preview", "cw-wire-preview--valid", "cw-wire-preview--invalid");
      wire.path.classList.add("cw-user-link");
      wire.path.setAttribute("stroke", portColor(outHandle.dataset.type || inHandle.dataset.type));
      wire.path.setAttribute("data-from-node", outHandle.dataset.nodeId || "");
      wire.path.setAttribute("data-to-node", inHandle.dataset.nodeId || "");
      wire.path.setAttribute("aria-label", "Cosmetic user cable. Double click to remove.");
      var self = this;
      wire.path.addEventListener("dblclick", function (removeEvent) {
        removeEvent.preventDefault();
        removeEvent.stopPropagation();
        if (wire.path.isConnected) {
          wire.path.remove();
          self.userWireCount = Math.max(0, self.userWireCount - 1);
          self.updateMeta();
        }
      });
      this.userWireCount += 1;
      this.updateMeta();
    } else {
      wire.path.remove();
    }

    this.wire = null;
  };

  WorkflowViewer.prototype.applyTransform = function () {
    if (!this.world || !this.panLayer) return;

    /* Do not magnify a cached transform layer. Chrome will happily turn text
       into a bitmap and then enlarge the bitmap, which is why node copy looked
       fuzzy at high zoom. Separate pan from scale and use layout zoom where the
       browser supports it so text, controls and SVG are re-rendered crisply. */
    this.panLayer.style.left = this.panX + "px";
    this.panLayer.style.top = this.panY + "px";
    if (this.useCssZoom) {
      this.world.style.zoom = String(this.scale);
      this.world.style.transform = "none";
    } else {
      this.world.style.zoom = "1";
      this.world.style.transform = "scale(" + this.scale + ")";
    }

    /* Move and scale the grid with the graph, including the coordinate shift
       introduced when we normalise negative ComfyUI canvas positions. */
    var gridX = this.panX + this.shiftX * this.scale;
    var gridY = this.panY + this.shiftY * this.scale;
    var minor = Math.max(8, 20 * this.scale);
    var major = Math.max(32, 80 * this.scale);
    this.stage.style.setProperty("--cw-grid-x", gridX + "px");
    this.stage.style.setProperty("--cw-grid-y", gridY + "px");
    this.stage.style.setProperty("--cw-grid-minor", minor + "px");
    this.stage.style.setProperty("--cw-grid-major", major + "px");
  };

  WorkflowViewer.prototype.fit = function (animate) {
    if (!this.world) return;
    var rect = this.stage.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    var pad = 28;
    this.scale = clamp(Math.min((rect.width - pad * 2) / this.worldWidth, (rect.height - pad * 2) / this.worldHeight), 0.035, 1.8);
    this.panX = (rect.width - this.worldWidth * this.scale) / 2;
    this.panY = (rect.height - this.worldHeight * this.scale) / 2;
    this.lastStageWidth = rect.width;
    this.lastStageHeight = rect.height;
    if (animate) this.world.classList.add("cw-world--animate");
    this.applyTransform();
    if (animate) setTimeout(function (world) { world.classList.remove("cw-world--animate"); }, 220, this.world);
  };

  WorkflowViewer.prototype.focus = function (id) {
    var node = this.nodeMap.get(String(id));
    if (!node || !this.world) { this.fit(false); return; }
    var rect = this.stage.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    var p = normalisePos(node), s = normaliseSize(node);
    var x = p[0] + this.shiftX, y = p[1] + this.shiftY;
    this.scale = clamp(Math.min((rect.width * 0.72) / s[0], (rect.height * 0.72) / s[1]), 0.12, 1.15);
    this.panX = rect.width / 2 - (x + s[0] / 2) * this.scale;
    this.panY = rect.height / 2 - (y + s[1] / 2) * this.scale;
    this.lastStageWidth = rect.width;
    this.lastStageHeight = rect.height;
    this.applyTransform();
  };

  WorkflowViewer.prototype.zoomAt = function (x, y, factor) {
    var old = this.scale;
    var next = clamp(old * factor, 0.035, 3.0);
    this.panX = x - (x - this.panX) * (next / old);
    this.panY = y - (y - this.panY) * (next / old);
    this.scale = next;
    this.applyTransform();
  };

  WorkflowViewer.prototype.zoomBy = function (factor) {
    var rect = this.stage.getBoundingClientRect();
    this.zoomAt(rect.width / 2, rect.height / 2, factor);
  };

  WorkflowViewer.prototype.toggleFullscreen = function () {
    var self = this;
    if (document.fullscreenElement === this.root) {
      document.exitFullscreen();
      return;
    }
    if (this.root.requestFullscreen) {
      this.root.requestFullscreen().then(function () {
        setTimeout(function () { self.fit(false); }, 80);
      }).catch(function () {});
    }
  };

  function boot() {
    document.querySelectorAll(".comfy-workflow[data-workflow]").forEach(function (root) {
      if (!root.dataset.cwReady) {
        root.dataset.cwReady = "true";
        new WorkflowViewer(root);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
