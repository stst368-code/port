(function(){
  "use strict";

  var dataNode=document.getElementById("catalogue-data");
  if(!dataNode)return;
  var catalogue=[];
  try{catalogue=JSON.parse(dataNode.textContent||"[]");}catch(_){return;}
  var byId={};catalogue.forEach(function(t){byId[t.id]=t;});

  var el={
    audio:document.getElementById("gbr-audio"),art:document.getElementById("gbr-artwork"),artFrame:document.getElementById("gbr-art-frame"),slot:document.getElementById("gbr-tape-slot"),
    play:document.getElementById("gbr-play"),shuffle:document.getElementById("gbr-shuffle"),back:document.getElementById("gbr-back"),skip:document.getElementById("gbr-skip"),prev:document.getElementById("gbr-prev"),next:document.getElementById("gbr-next"),
    progress:document.getElementById("gbr-progress"),volume:document.getElementById("gbr-volume"),elapsed:document.getElementById("gbr-time"),total:document.getElementById("gbr-total"),status:document.getElementById("gbr-status"),
    lyricWord:document.getElementById("gbr-lyric-word"),lyricLine:document.getElementById("gbr-lyric-line"),spectrum:document.getElementById("gbr-spectrum"),carousel:document.getElementById("gbr-carousel"),
    lossless:document.getElementById("gbr-lossless"),losslessWrap:document.getElementById("gbr-lossless-wrap"),
    eqToggle:document.getElementById("gbr-eq-toggle"),eqPopover:document.getElementById("gbr-eq-popover"),eqClose:document.getElementById("gbr-eq-close"),eqFlat:document.getElementById("gbr-eq-flat"),eqNote:document.getElementById("gbr-eq-note"),
    techToggle:document.getElementById("gbr-tech-toggle"),techPanel:document.getElementById("gbr-tech-panel"),techClose:document.getElementById("gbr-tech-close"),techContent:document.getElementById("gbr-tech-content")
  };
  if(!el.audio)return;

  var audio=el.audio;
  var cards=[];
  var current=null,currentIndex=0,shuffleMode=true,cycleArmed=true,cycleBusy=false;
  var rotation=0,step=360,animating=false,pointer=null,suppressClickUntil=0,wheelLocked=false;
  var cues=[],lyricToken=0,lastLyricWord="",lastLyricLine="";
  var ctx=null,sourceNode=null,analyser=null,freqData=null,eqFilters=[],limiter=null,spectrumLevels=[];
  var fxCtx=null,raf=0;
  var eqFreqs=[60,250,1000,4000,12000];
  var eqInputs=Array.prototype.slice.call(document.querySelectorAll("[data-eq-frequency]"));
  var reduceMotion=window.matchMedia("(prefers-reduced-motion: reduce)");

  function remember(k,v){try{localStorage.setItem(k,v);}catch(_){}}
  function recall(k){try{return localStorage.getItem(k);}catch(_){return null;}}
  function esc(v){return String(v==null?"":v).replace(/[&<>\"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
  function mod(v,d){return((v%d)+d)%d;}
  function clock(sec){if(!isFinite(sec)||sec<0)return"--:--";sec=Math.floor(sec);return Math.floor(sec/60)+":"+String(sec%60).padStart(2,"0");}
  function setStatus(v){if(el.status)el.status.textContent=v||"";}
  function asset(name,folder){if(!name)return null;if(/^(https?:)?\/\//i.test(name)||name.charAt(0)==="/"||name.indexOf("data:")===0||name.indexOf("blob:")===0)return name;return folder+name;}
  function artPath(track){return track&&track.artwork&&track.artwork.base?"assets/img/sleeves/"+track.artwork.base+"-640.jpg":"assets/img/sleeves/gbr-placeholder-640.jpg";}
  function hasLossless(track){var s=track&&track.audio&&track.audio.sources||{};return!!(s.flac||s.lossless);}
  function chooseSource(track){
    var s=track&&track.audio&&track.audio.sources||{},loss=s.flac||s.lossless,wants=!!(el.lossless&&el.lossless.checked);
    if(wants&&loss&&audio.canPlayType("audio/flac"))return asset(loss,"assets/audio/tracks/");
    if(s.opus&&audio.canPlayType('audio/ogg; codecs="opus"'))return asset(s.opus,"assets/audio/tracks/");
    if(s.mp3)return asset(s.mp3,"assets/audio/tracks/");
    if(s.wav&&audio.canPlayType("audio/wav"))return asset(s.wav,"assets/audio/tracks/");
    if(loss&&audio.canPlayType("audio/flac"))return asset(loss,"assets/audio/tracks/");
    return null;
  }
  function sourceIsCrossOrigin(src){if(!src||location.protocol==="file:")return false;try{return new URL(src,location.href).origin!==location.origin;}catch(_){return false;}}
  function configureCors(src){if(sourceIsCrossOrigin(src))audio.crossOrigin="anonymous";else audio.removeAttribute("crossorigin");}
  function playbackMessage(err){var n=err&&err.name||"PlaybackError";if(n==="NotAllowedError")return"PRESS PLAY";if(n==="NotSupportedError")return"FORMAT UNSUPPORTED";if(n==="AbortError")return"SOURCE CHANGED";return"PLAYBACK ERROR";}

  function shuffleGroups(){
    var wall=document.querySelector(".gbr-carousel-cards .track-wall");if(!wall)return;
    var groups=Array.prototype.slice.call(wall.children).filter(function(n){return n.classList.contains("track-group");});
    for(var i=groups.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),tmp=groups[i];groups[i]=groups[j];groups[j]=tmp;}
    groups.forEach(function(g){wall.appendChild(g);});
  }
  function refreshCards(){cards=Array.prototype.slice.call(document.querySelectorAll(".gbr-carousel-cards .card"));step=cards.length?360/cards.length:360;cards.forEach(function(c,i){c.dataset.index=String(i);});}
  function normalizedAngle(v){return mod(v+180,360)-180;}
  function nearestIndex(){return cards.length?mod(Math.round(-rotation/step),cards.length):0;}
  function indexForTrack(track){if(!track)return-1;for(var i=0;i<cards.length;i++)if(cards[i].dataset.track===track.id)return i;return-1;}
  function renderCarousel(ms){
    if(!cards.length)return;
    if(el.carousel){
      var rect=el.carousel.getBoundingClientRect(),d=Math.max(1,Math.min(rect.width,rect.height));
      var orbit=Math.max(90,d*.37);
      /* Size the tapes from the actual rendered wheel. The old 118px cap made
         a desktop-size magazine look like it had postage stamps bolted to it. */
      var cardSize=Math.max(62,Math.min(210,d*.235));
      el.carousel.style.setProperty("--orbit-px",orbit.toFixed(1)+"px");
      el.carousel.style.setProperty("--card-size",cardSize.toFixed(1)+"px");
    }
    cards.forEach(function(card,i){var a=i*step+rotation,near=normalizedAngle(a),distance=Math.abs(near)/180;card.style.setProperty("--angle",a+"deg");card.style.setProperty("--scale",String(1-distance*.18));card.style.setProperty("--opacity",String(.46+(1-distance)*.54));card.style.setProperty("--spin-ms",Math.max(0,ms||0)+"ms");card.style.setProperty("--z",String(1000-Math.round(Math.abs(near)*3)));card.dataset.pickup=Math.abs(near)<=step*.48?"true":"false";});
    currentIndex=nearestIndex();
  }
  function nearestRotation(index){var base=-mod(index,cards.length)*step;return base+Math.round((rotation-base)/360)*360;}
  function rotateTo(index,opts,done){
    if(!cards.length){if(done)done();return;}opts=opts||{};index=mod(index,cards.length);
    var duration=reduceMotion.matches?0:(opts.long?1250:(opts.duration==null?360:opts.duration)),target=nearestRotation(index);
    if(opts.direction===1&&target>=rotation)target-=360;if(opts.direction===-1&&target<=rotation)target+=360;
    if(opts.long&&!reduceMotion.matches)target-=(3+Math.floor(Math.random()*3))*360;
    animating=true;rotation=target;renderCarousel(duration);
    setTimeout(function(){animating=false;currentIndex=index;if(done)done();},duration+24);
  }
  function stepCarousel(dir){if(!cards.length||animating)return;rotateTo(nearestIndex()+dir,{direction:dir},null);}
  function markSelected(id){cards.forEach(function(c){var on=c.dataset.track===id;c.dataset.active=on?"true":"false";c.classList.toggle("is-in-deck",on);var b=c.querySelector(".card__play");if(b)b.setAttribute("aria-pressed",on?"true":"false");});}

  function initCarouselInteractions(){
    if(!el.carousel)return;
    el.carousel.addEventListener("keydown",function(e){if(e.key==="ArrowUp"||e.key==="ArrowLeft"){e.preventDefault();stepCarousel(-1);}else if(e.key==="ArrowDown"||e.key==="ArrowRight"){e.preventDefault();stepCarousel(1);}else if(e.key==="Enter"||e.key===" "){e.preventDefault();var t=byId[cards[nearestIndex()]&&cards[nearestIndex()].dataset.track];if(t)engageTrack(t,true,false);}});
    el.carousel.addEventListener("wheel",function(e){e.preventDefault();if(wheelLocked)return;wheelLocked=true;stepCarousel((e.deltaY||e.deltaX)>0?1:-1);setTimeout(function(){wheelLocked=false;},160);},{passive:false});
    el.carousel.addEventListener("pointerdown",function(e){if(animating||e.button!==0)return;pointer={id:e.pointerId,y:e.clientY,x:e.clientX,rotation:rotation,moved:false};el.carousel.dataset.dragging="true";try{el.carousel.setPointerCapture(e.pointerId);}catch(_){}});
    el.carousel.addEventListener("pointermove",function(e){if(!pointer||pointer.id!==e.pointerId)return;var dy=e.clientY-pointer.y,dx=e.clientX-pointer.x,delta=Math.abs(dy)>=Math.abs(dx)?dy:dx;if(Math.abs(delta)>5)pointer.moved=true;rotation=pointer.rotation+delta*.42;renderCarousel(0);});
    function release(e){if(!pointer||pointer.id!==e.pointerId)return;var moved=pointer.moved;pointer=null;el.carousel.dataset.dragging="false";if(moved)suppressClickUntil=Date.now()+320;rotateTo(nearestIndex(),{duration:250},null);try{el.carousel.releasePointerCapture(e.pointerId);}catch(_){}}
    el.carousel.addEventListener("pointerup",release);el.carousel.addEventListener("pointercancel",release);
    el.carousel.addEventListener("click",function(e){if(Date.now()<suppressClickUntil){e.preventDefault();e.stopPropagation();}},true);
  }

  function playInsertSound(){
    var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    try{if(!fxCtx)fxCtx=new AC();if(fxCtx.state==="suspended")fxCtx.resume().catch(function(){});var now=fxCtx.currentTime,master=fxCtx.createGain();master.gain.setValueAtTime(.0001,now);master.gain.exponentialRampToValueAtTime(.18,now+.004);master.gain.exponentialRampToValueAtTime(.0001,now+.18);master.connect(fxCtx.destination);
      function tone(type,f1,f2,start,len,gain){var o=fxCtx.createOscillator(),g=fxCtx.createGain();o.type=type;o.frequency.setValueAtTime(f1,now+start);o.frequency.exponentialRampToValueAtTime(f2,now+start+len);g.gain.setValueAtTime(.0001,now+start);g.gain.exponentialRampToValueAtTime(gain,now+start+.004);g.gain.exponentialRampToValueAtTime(.0001,now+start+len);o.connect(g);g.connect(master);o.start(now+start);o.stop(now+start+len+.01);}
      tone("square",1800,760,0,.035,.5);tone("sine",132,78,.008,.115,.72);tone("triangle",2450,1250,.082,.05,.34);
    }catch(_){}
  }
  function animateIntoArt(track,done){
    var idx=indexForTrack(track),card=idx>=0?cards[idx]:null,src=card&&card.querySelector(".cassette");
    cards.forEach(function(c){if(c!==card)c.classList.remove("is-in-deck","is-departing");});
    if(!card||!src||!el.artFrame||reduceMotion.matches){if(card)card.classList.add("is-in-deck");playInsertSound();if(done)done();return;}
    var from=src.getBoundingClientRect(),to=el.artFrame.getBoundingClientRect(),fly=src.cloneNode(true),w=Math.min(to.width*.42,120),h=w/1.08;
    fly.classList.add("gbr-cassette-flyer");fly.style.left=from.left+"px";fly.style.top=from.top+"px";fly.style.width=from.width+"px";fly.style.height=from.height+"px";document.body.appendChild(fly);card.classList.add("is-departing");
    requestAnimationFrame(function(){fly.style.left=(to.left+(to.width-w)/2)+"px";fly.style.top=(to.top+to.height-h-12)+"px";fly.style.width=w+"px";fly.style.height=h+"px";fly.style.transform="rotate(-1deg)";});
    setTimeout(function(){if(fly.parentNode)fly.parentNode.removeChild(fly);card.classList.remove("is-departing");card.classList.add("is-in-deck");playInsertSound();if(done)done();},560);
  }
  function materialize(track){if(!track||!el.art)return;el.art.src=artPath(track);el.art.alt="Cover artwork for "+track.title;if(el.artFrame){el.artFrame.classList.remove("materialize");void el.artFrame.offsetWidth;el.artFrame.classList.add("materialize");}if(el.slot)el.slot.classList.add("loaded");}

  function lineText(line){return String(line&&line.text||"").replace(/\s+/g," ").trim();}
  function validLyricLine(line){var t=lineText(line);return t&&!/^\[.*\]$/.test(t);}
  function activeLineAt(t){for(var i=0;i<cues.length;i++){var l=cues[i],s=Number(l.start||0),e=Number(l.end);if(!isFinite(e))e=Infinity;if(t>=s&&t<e&&validLyricLine(l))return l;}return null;}
  function latestPastLine(t){var found=null;for(var i=0;i<cues.length;i++){var l=cues[i],e=Number(l.end);if(isFinite(e)&&e<=t&&validLyricLine(l))found=l;}return found;}
  function activeWordAt(line,t){if(!line||!Array.isArray(line.words))return null;for(var i=0;i<line.words.length;i++){var w=line.words[i];if(t>=Number(w.start)&&t<Number(w.end))return w;}return null;}
  function lastPastWord(line,t){if(!line||!Array.isArray(line.words))return null;var found=null;for(var i=0;i<line.words.length;i++){var w=line.words[i];if(Number(w.end)<=t)found=w;}return found;}
  function paintLyric(t){
    var line=activeLineAt(t),word=line&&activeWordAt(line,t),past=false,text="";
    if(word&&word.text){text=String(word.text).trim();lastLyricWord=text;lastLyricLine=lineText(line);}
    else if(line){var last=lastPastWord(line,t);if(last&&last.text){text=String(last.text).trim();past=true;lastLyricWord=text;lastLyricLine=lineText(line);}else{text=lineText(line).split(/\s+/)[0]||"";}}
    else{var pl=latestPastLine(t);if(pl){var pw=lastPastWord(pl,t);text=(pw&&pw.text?String(pw.text).trim():lineText(pl).split(/\s+/).pop())||lastLyricWord;lastLyricLine=lineText(pl)||lastLyricLine;past=true;}else text=lastLyricWord||"READY";}
    if(el.lyricWord){el.lyricWord.textContent=text||"READY";el.lyricWord.classList.toggle("is-past",past);}if(el.lyricLine)el.lyricLine.textContent=lineText(line)||lastLyricLine||"";
  }
  function setFallbackLyrics(track){cues=track&&track.lyrics&&Array.isArray(track.lyrics.cues)?track.lyrics.cues:[];lastLyricWord="";lastLyricLine="";paintLyric(audio.currentTime||0);}
  function loadLyrics(track){
    lyricToken++;var token=lyricToken;setFallbackLyrics(track);var wt=track&&track.lyrics&&track.lyrics.wordTiming;
    if(!wt||!wt.src||((wt.reviewRequired||wt.usable===false)&&!wt.approved))return;
    fetch(wt.src,{cache:"force-cache"}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).then(function(d){if(token!==lyricToken||!d||d.format!=="gbr-word-lyrics-v1"||!Array.isArray(d.lines))return;cues=d.lines;lastLyricWord="";lastLyricLine="";paintLyric(audio.currentTime||0);}).catch(function(){});
  }

  function eqStorage(){var raw=recall("gbr:eq");if(!raw)return{};try{return JSON.parse(raw)||{};}catch(_){return{};}}
  function eqState(){var o={};eqInputs.forEach(function(i){o[i.dataset.eqFrequency]=Number(i.value)||0;});return o;}
  function updateEqLabels(){eqInputs.forEach(function(i){var o=i.parentElement.querySelector("output"),v=Number(i.value)||0;if(o)o.textContent=(v>0?"+":"")+v+" dB";});}
  function applyEq(){var state=eqState();remember("gbr:eq",JSON.stringify(state));updateEqLabels();if(!ctx||!eqFilters.length)return;var now=ctx.currentTime;eqFilters.forEach(function(f,i){var v=Number(state[String(eqFreqs[i])])||0;try{f.gain.setTargetAtTime(v,now,.025);}catch(_){f.gain.value=v;}});}
  function setEqAvailable(ok){eqInputs.forEach(function(i){i.disabled=!ok;});if(el.eqFlat)el.eqFlat.disabled=!ok;if(el.eqNote)el.eqNote.textContent=ok?"EQ is applied live to the shared player.":"EQ needs HTTP/HTTPS. Direct file:// playback stays native.";}
  function ensureAudioGraph(){
    if(location.protocol==="file:"){setEqAvailable(false);return;}if(analyser){setEqAvailable(true);return;}var AC=window.AudioContext||window.webkitAudioContext;if(!AC){setEqAvailable(false);return;}
    try{ctx=new AC();sourceNode=ctx.createMediaElementSource(audio);eqFilters=eqFreqs.map(function(f,i){var q=ctx.createBiquadFilter();q.frequency.value=f;q.gain.value=0;if(i===0)q.type="lowshelf";else if(i===eqFreqs.length-1)q.type="highshelf";else{q.type="peaking";q.Q.value=1.05;}return q;});analyser=ctx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.34;analyser.minDecibels=-88;analyser.maxDecibels=-18;freqData=new Uint8Array(analyser.frequencyBinCount);limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-3;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.003;limiter.release.value=.12;var node=sourceNode;eqFilters.forEach(function(f){node.connect(f);node=f;});node.connect(analyser);analyser.connect(limiter);limiter.connect(ctx.destination);setEqAvailable(true);applyEq();}catch(_){ctx=null;analyser=null;eqFilters=[];setEqAvailable(false);}
  }
  function resumeGraph(){ensureAudioGraph();if(ctx&&ctx.state==="suspended")ctx.resume().catch(function(){});}
  function initSpectrum(){if(!el.spectrum)return;el.spectrum.innerHTML="";spectrumLevels=[];for(var b=0;b<18;b++){var band=document.createElement("span");band.className="gbr-spectrum-band";for(var s=0;s<10;s++){var seg=document.createElement("i");seg.className="gbr-spectrum-seg";band.appendChild(seg);}el.spectrum.appendChild(band);spectrumLevels.push(0);}}
  function paintSpectrum(){
    if(analyser&&freqData){analyser.getByteFrequencyData(freqData);var sr=ctx.sampleRate,nyq=sr/2,centres=[55,80,115,160,225,315,440,620,870,1220,1700,2400,3400,4800,6800,9600,13500,17500],bands=el.spectrum.children;for(var i=0;i<bands.length;i++){var c=Math.min(centres[i],nyq*.96),lo=i?Math.sqrt(centres[i-1]*centres[i]):c/1.35,hi=i<centres.length-1?Math.sqrt(c*centres[i+1]):c*1.35,b0=Math.max(1,Math.floor(lo/nyq*freqData.length)),b1=Math.min(freqData.length-1,Math.ceil(hi/nyq*freqData.length)),sum=0,count=0;for(var k=b0;k<=b1;k++){sum+=freqData[k];count++;}var raw=count?sum/count/255:0,target=Math.pow(raw,1.05);spectrumLevels[i]=target>spectrumLevels[i]?target:Math.max(0,spectrumLevels[i]*.86-.006);var lit=spectrumLevels[i]>=.995?10:Math.floor(spectrumLevels[i]*10),segs=bands[i].children;for(var j=0;j<segs.length;j++)segs[j].classList.toggle("on",j<lit);}}
    raf=requestAnimationFrame(paintSpectrum);
  }

  function playable(){return catalogue.filter(function(t){return t&&t.audio&&t.audio.available!==false&&!!chooseSource(t);});}
  function randomNext(){var pool=playable();if(!pool.length)return null;if(current&&pool.length>1){var diff=pool.filter(function(t){return t.id!==current.id&&t.title!==current.title;});pool=diff.length?diff:pool.filter(function(t){return t.id!==current.id;});}return pool[Math.floor(Math.random()*pool.length)]||null;}
  function setShuffle(v){shuffleMode=!!v;cycleArmed=true;if(el.shuffle)el.shuffle.setAttribute("aria-pressed",shuffleMode?"true":"false");remember("gbr:shuffle",shuffleMode?"on":"off");}
  function updateLossless(track){var ok=hasLossless(track);if(el.losslessWrap)el.losslessWrap.dataset.available=ok?"true":"false";if(el.lossless){el.lossless.disabled=!ok;el.lossless.checked=ok&&recall("gbr:lossless")==="on";}}
  function buildTech(track){if(!el.techContent)return;if(!track){el.techContent.innerHTML="<p>No cassette loaded.</p>";return;}var rows=[],model=track.model||{},prov=track.provenance||{},gen=track.generation||{},style=track.style||{};if(model.provider||model.name)rows.push(["Model",[model.provider,model.name].filter(Boolean).join(" ")]);if(prov.songVersion!=null)rows.push(["Version","v"+prov.songVersion]);if(gen.cfg!=null)rows.push(["CFG",gen.cfg]);if(gen.steps!=null)rows.push(["Steps",gen.steps]);if(gen.seed!=null)rows.push(["Seed",gen.seed]);if(style.genre)rows.push(["Genre",style.genre]);if(track.audio&&track.audio.duration)rows.push(["Duration",clock(track.audio.duration)]);var html='<dl class="gbr-tech-grid">'+rows.map(function(r){return"<dt>"+esc(r[0])+"</dt><dd>"+esc(r[1])+"</dd>";}).join("")+"</dl>";var note=track.notes&&(track.notes.short||track.notes.caption)||track.subtitle;if(note)html+='<p class="gbr-tech-note">'+esc(note)+"</p>";el.techContent.innerHTML=html;}
  function mediaSession(track){if(!("mediaSession" in navigator)||!("MediaMetadata" in window))return;try{navigator.mediaSession.metadata=new MediaMetadata({title:track.title,artist:"Good Boy Records",album:track.catalogueNumber||"Good Boy Records",artwork:[{src:artPath(track),sizes:"640x640",type:"image/jpeg"}]});navigator.mediaSession.setActionHandler("play",function(){beginPlayback();});navigator.mediaSession.setActionHandler("pause",function(){audio.pause();});navigator.mediaSession.setActionHandler("nexttrack",function(){var n=shuffleMode?randomNext():byId[cards[mod(currentIndex+1,cards.length)]&&cards[mod(currentIndex+1,cards.length)].dataset.track];if(n)engageTrack(n,true,true);});navigator.mediaSession.setActionHandler("previoustrack",function(){var t=byId[cards[mod(currentIndex-1,cards.length)]&&cards[mod(currentIndex-1,cards.length)].dataset.track];if(t)engageTrack(t,true,false);});}catch(_){}}

  function dress(track){current=track;var idx=indexForTrack(track);if(idx>=0)currentIndex=idx;markSelected(track.id);materialize(track);loadLyrics(track);updateLossless(track);buildTech(track);mediaSession(track);if(el.progress){el.progress.value=0;el.progress.max=track.audio&&track.audio.duration||0;}if(el.elapsed)el.elapsed.textContent="0:00";if(el.total)el.total.textContent=clock(track.audio&&track.audio.duration);try{history.replaceState(null,"","?track="+encodeURIComponent(track.slug||track.id));}catch(_){}}
  function setAudioSource(track){var src=chooseSource(track);if(!src){setStatus("NO AUDIO");return false;}configureCors(src);var abs=new URL(src,location.href).href;if(audio.src!==abs){audio.src=src;audio.load();}return true;}
  function beginPlayback(){resumeGraph();var p;try{p=audio.play();}catch(e){setStatus(playbackMessage(e));return;}if(p&&p.catch)p.catch(function(e){setStatus(playbackMessage(e));});}
  function selectTrack(track,autoplay){if(!track)return;dress(track);if(!setAudioSource(track))return;setStatus("LATCHED");if(autoplay)beginPlayback();}
  function engageTrack(track,autoplay,longSpin){var idx=indexForTrack(track);if(idx<0){selectTrack(track,autoplay);return;}rotateTo(idx,{long:!!longSpin},function(){animateIntoArt(track,function(){selectTrack(track,autoplay);});});}
  function playNext(){if(cycleBusy)return;var t;if(shuffleMode)t=randomNext();else t=byId[cards[mod(currentIndex+1,cards.length)]&&cards[mod(currentIndex+1,cards.length)].dataset.track];if(!t)return;cycleBusy=true;engageTrack(t,true,shuffleMode);setTimeout(function(){cycleBusy=false;},reduceMotion.matches?80:1800);}

  function bindCards(){cards.forEach(function(card){card.addEventListener("click",function(e){if(Date.now()<suppressClickUntil){e.preventDefault();return;}var t=byId[card.dataset.track];if(!t)return;if(current&&current.id===t.id){if(audio.paused)beginPlayback();else audio.pause();return;}cycleArmed=true;engageTrack(t,true,false);});});}
  function openPopup(node,button){if(!node)return;node.hidden=false;if(button)button.setAttribute("aria-expanded","true");}
  function closePopup(node,button){if(!node)return;node.hidden=true;if(button)button.setAttribute("aria-expanded","false");}

  function init(){
    shuffleGroups();refreshCards();renderCarousel(0);bindCards();initCarouselInteractions();initSpectrum();paintSpectrum();
    var savedEq=eqStorage();eqInputs.forEach(function(i){if(savedEq[i.dataset.eqFrequency]!=null)i.value=savedEq[i.dataset.eqFrequency];i.addEventListener("input",function(){ensureAudioGraph();applyEq();});});updateEqLabels();setEqAvailable(location.protocol!=="file:"&&!!(window.AudioContext||window.webkitAudioContext));
    setShuffle(recall("gbr:shuffle")!=="off");if(el.volume){var sv=Number(recall("gbr:volume"));if(isFinite(sv)&&sv>=0&&sv<=1)el.volume.value=sv;audio.volume=Number(el.volume.value)||.9;}
    if(el.prev)el.prev.addEventListener("click",function(){stepCarousel(-1);});if(el.next)el.next.addEventListener("click",function(){stepCarousel(1);});
    if(el.back)el.back.addEventListener("click",function(){var t=byId[cards[mod(currentIndex-1,cards.length)]&&cards[mod(currentIndex-1,cards.length)].dataset.track];if(t)engageTrack(t,false,false);});
    if(el.skip)el.skip.addEventListener("click",function(){var t=shuffleMode?randomNext():byId[cards[mod(currentIndex+1,cards.length)]&&cards[mod(currentIndex+1,cards.length)].dataset.track];if(t)engageTrack(t,true,shuffleMode);});
    if(el.play)el.play.addEventListener("click",function(){if(!current){var t=shuffleMode?randomNext():byId[cards[nearestIndex()]&&cards[nearestIndex()].dataset.track];if(t)engageTrack(t,true,shuffleMode);return;}if(audio.paused)beginPlayback();else audio.pause();});
    if(el.shuffle)el.shuffle.addEventListener("click",function(){setShuffle(!shuffleMode);if(!current){var t=randomNext();if(t)engageTrack(t,true,true);}});
    if(el.volume)el.volume.addEventListener("input",function(){audio.volume=Number(el.volume.value)||0;remember("gbr:volume",String(audio.volume));});
    if(el.progress){var seeking=false;el.progress.addEventListener("pointerdown",function(){seeking=true;});el.progress.addEventListener("pointerup",function(){seeking=false;});el.progress.addEventListener("input",function(){audio.currentTime=Number(el.progress.value)||0;paintLyric(audio.currentTime||0);});}
    if(el.lossless)el.lossless.addEventListener("change",function(){remember("gbr:lossless",el.lossless.checked?"on":"off");if(current){var pos=audio.currentTime||0,was=!audio.paused;if(setAudioSource(current)){audio.addEventListener("loadedmetadata",function(){try{audio.currentTime=Math.min(pos,audio.duration||pos);}catch(_){}if(was)beginPlayback();},{once:true});}}});
    if(el.eqToggle)el.eqToggle.addEventListener("click",function(){el.eqPopover.hidden?openPopup(el.eqPopover,el.eqToggle):closePopup(el.eqPopover,el.eqToggle);});if(el.eqClose)el.eqClose.addEventListener("click",function(){closePopup(el.eqPopover,el.eqToggle);});if(el.eqPopover)el.eqPopover.addEventListener("click",function(e){if(e.target===el.eqPopover)closePopup(el.eqPopover,el.eqToggle);});if(el.eqFlat)el.eqFlat.addEventListener("click",function(){eqInputs.forEach(function(i){i.value=0;});ensureAudioGraph();applyEq();});
    if(el.techToggle)el.techToggle.addEventListener("click",function(){el.techPanel.hidden?openPopup(el.techPanel,el.techToggle):closePopup(el.techPanel,el.techToggle);});if(el.techClose)el.techClose.addEventListener("click",function(){closePopup(el.techPanel,el.techToggle);});
    document.addEventListener("keydown",function(e){if(e.key==="Escape"){closePopup(el.eqPopover,el.eqToggle);closePopup(el.techPanel,el.techToggle);}});
    audio.addEventListener("play",function(){resumeGraph();if(el.play)el.play.textContent="Ⅱ";setStatus("PLAY");});audio.addEventListener("pause",function(){if(el.play)el.play.textContent="▶";if(!audio.ended)setStatus("PAUSE");});audio.addEventListener("loadedmetadata",function(){if(el.total)el.total.textContent=clock(audio.duration);if(el.progress)el.progress.max=isFinite(audio.duration)?audio.duration:el.progress.max;});audio.addEventListener("timeupdate",function(){if(el.progress){el.progress.max=isFinite(audio.duration)?audio.duration:el.progress.max;el.progress.value=audio.currentTime||0;}if(el.elapsed)el.elapsed.textContent=clock(audio.currentTime);paintLyric(audio.currentTime||0);});audio.addEventListener("ended",function(){if(cycleArmed)playNext();});audio.addEventListener("error",function(){setStatus("AUDIO ERROR");});
    window.addEventListener("resize",function(){renderCarousel(0);},{passive:true});document.addEventListener("visibilitychange",function(){if(document.hidden&&raf){cancelAnimationFrame(raf);raf=0;}else if(!document.hidden&&!raf)paintSpectrum();});
    var wanted=null;try{var q=new URLSearchParams(location.search).get("track");if(q)wanted=catalogue.find(function(t){return t.slug===q||t.id===q;});}catch(_){}if(wanted){var wi=indexForTrack(wanted);if(wi>=0)rotateTo(wi,{duration:0},null);selectTrack(wanted,false);}else{setStatus(cards.length?"READY":"NO CASSETTES");}
  }

  init();
})();
