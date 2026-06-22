/* ============================================================
   MODULE · MentisSession — «Сеанс дня» (smart structured session)
   Ties together genProblem/rate, MentisCoach+Teach (visual reteach),
   MentisMistakes (due review), MentisFacts (due facts), MentisMeta
   (error classify + confidence calibration), MentisMastery (focus goal).
   Single IIFE. Exposes only window.MentisSession. Offline-safe; every
   external engine guarded; degrades gracefully when any is absent.
   ============================================================ */
(function(){
  "use strict";
  var M = window.Mentis;
  if(!M) return;
  var U = M.util, ID = "session";
  var OPS = M.OPS || {add:"+",sub:"−",mul:"×",div:"÷"};
  var OPN = M.opNames || {add:"Сложение",sub:"Вычитание",mul:"Умножение",div:"Деление"};

  /* ---- timers (cleared on leave) ---- */
  var timers = [];
  function later(fn, ms){ var t = setTimeout(fn, ms); timers.push(t); return t; }
  function clearTimers(){ timers.forEach(function(t){ clearTimeout(t); }); timers = []; }
  M.onLeave(function(){ clearTimers(); ses = null; });

  /* ---- safe helpers ---- */
  function S(){ return M.getState(); }
  function save(){ try{ M.save(); }catch(e){} }
  function noanim(){ try{ return M.noanim(); }catch(e){ return false; } }
  function rand(a,b){ try{ return U.rand(a,b); }catch(e){ return a + Math.floor(Math.random()*(b-a+1)); } }
  function todayKey(){ try{ return U.todayKey(); }catch(e){
    var d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  } }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function clean(v){ return String(v==null?"":v).replace(/[^0-9.\-]/g,""); }

  /* ---- enabled ops + weakest (focus) ---- */
  function enabledOps(){
    var st = S(); var ops = (st.settings && st.settings.ops) || {};
    var on = Object.keys(ops).filter(function(o){ return ops[o]; });
    return on.length ? on : ["add","sub","mul","div"];
  }
  function ratingOf(op){
    var r = (S().ratings)||{}; var v = r[op];
    return (typeof v === "number" && isFinite(v)) ? v : 3;
  }
  function weakestOp(){
    var ops = enabledOps(), best = ops[0], bv = Infinity;
    ops.forEach(function(o){ var v = ratingOf(o); if(v < bv){ bv = v; best = o; } });
    return best;
  }

  /* ---- focus goal: prefer MentisMastery.nextGoal(), else weakest op ---- */
  function focusGoal(){
    try{
      if(window.MentisMastery && typeof window.MentisMastery.nextGoal === "function"){
        var g = window.MentisMastery.nextGoal();
        if(g){
          var op = g.op || (g.skill && g.skill.op) || weakestOp();
          return { op: op, title: g.title || g.label || ("Фокус: " + (OPN[op]||op)), source:"mastery" };
        }
      }
    }catch(e){}
    var w = weakestOp();
    return { op: w, title: OPN[w] || w, source:"weakest" };
  }

  /* ---- due counts (guarded) ---- */
  function dueFacts(){
    try{ if(window.MentisFacts && typeof window.MentisFacts.due === "function"){ var d = window.MentisFacts.due(); return Array.isArray(d) ? d : []; } }catch(e){}
    return [];
  }
  function dueMistakes(){
    try{ if(window.MentisMistakes && typeof window.MentisMistakes.due === "function"){ var d = window.MentisMistakes.due(); return Array.isArray(d) ? d : []; } }catch(e){}
    return [];
  }

  /* ============================================================
     PLAN
     ============================================================ */
  function plan(){
    var focus, phases, est;
    try{
      focus = focusGoal();
      var facts = dueFacts(), miss = dueMistakes();
      var ops = enabledOps();
      phases = [
        { key:"warmup", title:"Разминка", icon:"☀️", sub:"Лёгкие задачи на освоенном — без таймера",
          count:6, op:focus.op, timed:false },
        { key:"acquire", title:"Освоение", icon:"🎯", sub:"Блок задач на фокус-навыке: " + (OPN[focus.op]||focus.op),
          count:10, op:focus.op, timed:false },
        { key:"challenge", title:"Челлендж", icon:"⚡", sub:"Перемежающийся блок по включённым операциям, ~75 с",
          seconds:75, ops:ops.slice(), timed:true },
        { key:"cooldown", title:"Заминка", icon:"🌙", sub:"Повтор просроченных фактов и ошибок, финиш на лёгком",
          factsN: Math.min(8, facts.length), missN: Math.min(6, miss.length), op:focus.op }
      ];
      // estimate: warmup ~.5min, acquire ~2.5min, challenge 75s, cooldown ~2.5min
      est = 8;
    }catch(e){
      focus = { op:"add", title:"Сложение", source:"weakest" };
      phases = [];
      est = 8;
    }
    return { focus: focus, phases: phases, estMin: est };
  }

  /* ============================================================
     RUN — drive phases sequentially
     ============================================================ */
  var ses = null;

  function run(){
    try{ M.audio.ensure(); }catch(e){}
    clearTimers();
    var p = plan();
    ses = {
      plan: p,
      focus: p.focus,
      phaseIdx: 0,
      body: M.openScreen(ID, "Сеанс дня"),
      total: 0, correct: 0,
      rts: [],
      misses: [],            // {a,op,b,ans} items missed in acquire/challenge for cooldown retest
      seenSig: {},
      startTs: Date.now(),
      ratStart: snapshotRatings(),
      calib: [],             // {conf,correct}
      errTypes: {},
      lastChallengeSkill: null
    };
    startPhase();
  }

  function snapshotRatings(){
    var r = (S().ratings)||{}, o = {};
    Object.keys(r).forEach(function(k){ o[k] = r[k]; });
    return o;
  }

  function startPhase(){
    if(!ses) return;
    var ph = ses.plan.phases[ses.phaseIdx];
    if(!ph){ finish(); return; }
    // phase intro card, then run
    ses.phaseProgress = 0;
    if(ph.key === "warmup" || ph.key === "acquire") runArithPhase(ph, false);
    else if(ph.key === "challenge") runChallengePhase(ph);
    else if(ph.key === "cooldown") runCooldownPhase(ph);
    else nextPhase();
  }
  function nextPhase(){ if(!ses) return; ses.phaseIdx++; startPhase(); }

  /* ---- phase header ---- */
  function phaseHeaderHTML(ph, idx, total, progLabel){
    var dots = "";
    for(var i=0;i<total;i++){
      dots += '<span class="ses-pd' + (i<idx?" ses-done":(i===idx?" ses-cur":"")) + '"></span>';
    }
    return '<div class="ses-head">' +
        '<div class="ses-phdots">' + dots + '</div>' +
        '<div class="ses-phtitle"><span class="ses-phic">'+ph.icon+'</span> '+esc(ph.title)+'</div>' +
        '<div class="ses-phsub">'+esc(ph.sub)+'</div>' +
        (progLabel ? '<div class="ses-phprog">'+progLabel+'</div>' : '') +
      '</div>';
  }

  /* ---- shared arithmetic problem UI ---- */
  function arithShell(ph, progLabel){
    ses.body.innerHTML =
      '<div class="ex-wrap ses-wrap">' +
        phaseHeaderHTML(ph, ses.phaseIdx, ses.plan.phases.length, progLabel) +
        '<div class="ses-display ex-display tnum" id="ses-prob">—</div>' +
        '<input class="ex-input tnum" id="ses-in" inputmode="numeric" autocomplete="off" placeholder="?" aria-label="Ответ">' +
        '<div class="ex-msg" id="ses-msg" aria-live="polite"></div>' +
        '<div class="ses-conf" id="ses-conf" hidden></div>' +
        '<div class="ses-pad numpad force" id="ses-pad">' +
          '<button type="button" data-k="1">1</button><button type="button" data-k="2">2</button><button type="button" data-k="3">3</button>' +
          '<button type="button" data-k="4">4</button><button type="button" data-k="5">5</button><button type="button" data-k="6">6</button>' +
          '<button type="button" data-k="7">7</button><button type="button" data-k="8">8</button><button type="button" data-k="9">9</button>' +
          '<button type="button" class="act" data-k="back">←</button><button type="button" data-k="0">0</button><button type="button" class="act" data-k="enter">⏎</button>' +
        '</div>' +
      '</div>';
    var inp = document.getElementById("ses-in");
    if(inp){
      inp.focus();
      inp.addEventListener("keydown", function(e){ if(e.key === "Enter"){ e.preventDefault(); ses && ses._submit && ses._submit(); } });
    }
    var pad = document.getElementById("ses-pad");
    if(pad) pad.addEventListener("click", function(e){
      var b = e.target.closest("button"); if(!b || !ses) return;
      var inp = document.getElementById("ses-in"); if(!inp) return;
      var k = b.dataset.k;
      if(k === "back") inp.value = inp.value.slice(0,-1);
      else if(k === "enter"){ ses._submit && ses._submit(); return; }
      else inp.value += k;
      inp.focus();
    });
  }
  function setProblem(cur){
    var el = document.getElementById("ses-prob");
    if(el){
      el.innerHTML = '<span class="tnum">'+cur.a+'</span> ' + (cur.sym||OPS[cur.op]||"?") + ' <span class="tnum">'+cur.b+'</span>';
      if(!noanim()){ el.classList.remove("swap"); void el.offsetWidth; el.classList.add("swap"); }
    }
    var inp = document.getElementById("ses-in"); if(inp){ inp.value = ""; inp.disabled = false; inp.focus(); }
    var msg = document.getElementById("ses-msg"); if(msg){ msg.className = "ex-msg"; msg.textContent = ""; }
  }

  /* feed adaptive engine + tallies */
  function rate(op, ok, rt){ try{ M.rate(op, ok, rt); }catch(e){} }

  /* classify + log a miss; returns lesson (or null) */
  function handleMiss(cur, given){
    var lesson = null;
    try{ if(window.MentisCoach) lesson = window.MentisCoach.explain(cur.a, cur.op, cur.b); }catch(e){}
    var etype = null;
    try{ if(window.MentisMeta && typeof window.MentisMeta.classifyError === "function") etype = window.MentisMeta.classifyError(lesson, given); }catch(e){}
    if(etype){ ses.errTypes[etype] = (ses.errTypes[etype]||0) + 1; }
    try{
      if(window.MentisMistakes) window.MentisMistakes.log({
        a:cur.a, op:cur.op, b:cur.b, answer:cur.ans, given:(given||"—"),
        method: lesson && lesson.method, methodTitle: lesson && lesson.methodTitle,
        errorType: etype, context:"session"
      });
    }catch(e){}
    return lesson;
  }

  /* open visual reteach (exposure-based faded); pauses flow until onClose */
  function reteach(lesson, after){
    var st = S();
    if(!(window.MentisTeach && lesson)){ later(after, noanim()?300:600); return; }
    if(!st.coachExposure) st.coachExposure = {};
    var mk = lesson.method || "_";
    var ex = st.coachExposure[mk] || 0;
    var faded = ex < 1 ? "worked" : (ex < 3 ? "completion" : "independent");
    st.coachExposure[mk] = ex + 1; save();
    var done = false;
    try{
      window.MentisTeach.open(lesson, { faded: faded, onClose: function(){ if(done) return; done = true; after(); } });
    }catch(e){ after(); }
  }

  /* ---------- WARMUP / ACQUISITION (blocked single op) ---------- */
  function runArithPhase(ph, isChallenge){
    var i = 0, n = ph.count, op = ph.op;
    function showOne(){
      if(!ses) return;
      if(i >= n){ nextPhase(); return; }
      arithShell(ph, "Задача <b class='tnum'>"+(i+1)+"</b> из <b class='tnum'>"+n+"</b>");
      var cur;
      try{ cur = M.genProblem(op); }catch(e){ cur = fallbackProblem(op); }
      if(!cur || cur.ans == null) cur = fallbackProblem(op);
      setProblem(cur);
      var t0 = Date.now(), locked = false;
      ses._submit = function(){
        if(locked || !ses) return;
        var inp = document.getElementById("ses-in"); if(!inp) return;
        var v = clean(inp.value); if(v === "") return;
        locked = true; inp.disabled = true;
        var rt = Date.now() - t0, ok = (parseFloat(v) === cur.ans);
        ses.total++; if(ok) ses.correct++; ses.rts.push(rt);
        rate(op, ok, rt);
        var msg = document.getElementById("ses-msg");
        if(ok){
          if(msg){ msg.textContent = "✓ Верно"; msg.className = "ex-msg show ok"; }
          try{ M.audio.ok(); M.audio.vibe(30); }catch(e){}
          i++; later(showOne, noanim()?60:520);
        }else{
          if(msg){ msg.innerHTML = "✕ Ответ: <span class='tnum'>"+cur.ans+"</span>"; msg.className = "ex-msg show no"; }
          try{ M.audio.no(); M.audio.vibe([30,50,30]); }catch(e){}
          recordMiss(cur);
          // warmup: gentle, no reteach interruption; acquire: visual reteach on miss
          var lesson = handleMiss(cur, v);
          if(ph.key === "acquire"){
            later(function(){ reteach(lesson, function(){ if(!ses) return; i++; showOne(); }); }, noanim()?200:700);
          }else{
            i++; later(showOne, noanim()?400:1100);
          }
        }
      };
    }
    showOne();
  }

  function recordMiss(cur){
    var sig = cur.op + "|" + cur.a + "|" + cur.b;
    if(ses.seenSig[sig]) return;
    ses.seenSig[sig] = true;
    ses.misses.push({ a:cur.a, op:cur.op, b:cur.b, ans:cur.ans, sym:cur.sym||OPS[cur.op] });
  }

  function fallbackProblem(op){
    var a,b,ans,sym=OPS[op]||"+";
    if(op==="add"){ a=rand(2,40); b=rand(2,40); ans=a+b; }
    else if(op==="sub"){ var s=rand(2,40),d=rand(2,40); a=s+d; b=d; ans=s; }
    else if(op==="mul"){ a=rand(2,12); b=rand(2,12); ans=a*b; }
    else { var dv=rand(2,12),q=rand(2,12); a=dv*q; b=dv; ans=q; }
    return { op:op, a:a, b:b, sym:sym, ans:ans };
  }

  /* ---------- CHALLENGE (interleaved, timed, no two same op in a row) ---------- */
  function runChallengePhase(ph){
    var ops = (ph.ops && ph.ops.length) ? ph.ops : enabledOps();
    var seconds = ph.seconds || 75;
    var deadline = Date.now() + seconds*1000;
    var lastOp = null, idx = 0;
    var tickTimer = null;

    function pickOp(){
      if(ops.length === 1) return ops[0];
      var o, guard = 0;
      do{ o = ops[rand(0, ops.length-1)]; guard++; }while(o === lastOp && guard < 8);
      lastOp = o; return o;
    }
    function timeLeft(){ return Math.max(0, Math.ceil((deadline - Date.now())/1000)); }
    function updateTimer(){
      var el = document.getElementById("ses-timer");
      if(el) el.textContent = timeLeft() + " с";
    }

    function showOne(){
      if(!ses) return;
      if(Date.now() >= deadline){ stopTick(); nextPhase(); return; }
      idx++;
      arithShell(ph, 'Осталось <b class="tnum" id="ses-timer">'+timeLeft()+' с</b> · решено <b class="tnum">'+idx+'</b>');
      var op = pickOp();
      var cur;
      try{ cur = M.genProblem(op); }catch(e){ cur = fallbackProblem(op); }
      if(!cur || cur.ans == null) cur = fallbackProblem(op);
      setProblem(cur);
      startTick();
      var t0 = Date.now(), locked = false;
      // confidence tap on ~1 in 4 challenge items (sampled), if MentisMeta provides chips
      var wantConf = (idx % 4 === 0) && hasConfChips();

      ses._submit = function(){
        if(locked || !ses) return;
        var inp = document.getElementById("ses-in"); if(!inp) return;
        var v = clean(inp.value); if(v === "") return;
        locked = true; inp.disabled = true;
        var rt = Date.now() - t0, ok = (parseFloat(v) === cur.ans);
        var commit = function(conf){
          ses.total++; if(ok) ses.correct++; ses.rts.push(rt);
          rate(op, ok, rt);
          if(conf != null) logCalib(conf, ok, cur, v);
          var msg = document.getElementById("ses-msg");
          if(ok){
            if(msg){ msg.textContent = "✓"; msg.className = "ex-msg show ok"; }
            try{ M.audio.ok(); M.audio.vibe(25); }catch(e){}
            later(showOne, noanim()?50:300);
          }else{
            if(msg){ msg.innerHTML = "✕ <span class='tnum'>"+cur.ans+"</span>"; msg.className = "ex-msg show no"; }
            try{ M.audio.no(); M.audio.vibe([25,45,25]); }catch(e){}
            recordMiss(cur);
            handleMiss(cur, v);   // logged; visual reteach happens in cooldown to keep timer flowing
            later(showOne, noanim()?500:1100);
          }
        };
        if(wantConf){ stopTick(); askConfidence(commit); }
        else commit(null);
      };
    }
    function startTick(){ stopTick(); tickTimer = setInterval(function(){ if(!ses){ stopTick(); return; } updateTimer(); if(Date.now()>=deadline){ stopTick(); } }, 250); timers.push(tickTimer); }
    function stopTick(){ if(tickTimer){ clearInterval(tickTimer); tickTimer = null; } }

    showOne();
  }

  function hasConfChips(){
    try{ return !!(window.MentisMeta && typeof window.MentisMeta.confidenceChips === "function"); }catch(e){ return false; }
  }
  function logCalib(conf, ok, cur, given){
    ses.calib.push({ conf: conf, correct: ok });
    try{
      if(window.MentisMeta && typeof window.MentisMeta.logCalibration === "function")
        window.MentisMeta.logCalibration({ conf:conf, correct:ok, a:cur.a, op:cur.op, b:cur.b, given:given });
    }catch(e){}
  }
  /* render a 3-point confidence tap; calls cb(conf) */
  function askConfidence(cb){
    var chips = null;
    try{ chips = window.MentisMeta.confidenceChips(); }catch(e){}
    if(!Array.isArray(chips) || !chips.length){
      chips = [{label:"наугад", value:0.33},{label:"не уверен", value:0.66},{label:"уверен", value:0.95}];
    }
    var box = document.getElementById("ses-conf");
    if(!box){ cb(null); return; }
    box.hidden = false;
    box.innerHTML = '<div class="ses-conf-q">Насколько уверены?</div><div class="ses-conf-row">' +
      chips.map(function(c,i){ return '<button type="button" class="btn ghost sm ses-cf" data-v="'+c.value+'" data-i="'+i+'">'+esc(c.label)+'</button>'; }).join("") +
      '</div>';
    var done = false;
    box.querySelectorAll(".ses-cf").forEach(function(b){
      b.addEventListener("click", function(){
        if(done) return; done = true;
        box.hidden = true; box.innerHTML = "";
        cb(parseFloat(b.dataset.v));
      });
    });
  }

  /* ---------- COOLDOWN (re-test misses + due facts/mistakes, finish on a win) ---------- */
  function runCooldownPhase(ph){
    // Build queue: session misses (retest) -> due mistakes -> due facts -> 1 easy "win"
    var queue = [];
    ses.misses.forEach(function(m){ queue.push({ kind:"miss", a:m.a, op:m.op, b:m.b, ans:m.ans, sym:m.sym }); });
    var dm = dueMistakes().slice(0, ph.missN||0);
    dm.forEach(function(it){
      var ans = (it.answer != null) ? it.answer : computeAns(it.a, it.op, it.b);
      queue.push({ kind:"mistake", sig:it.sig, a:it.a, op:it.op, b:it.b, ans:ans, sym:OPS[it.op], method:it.method, methodTitle:it.methodTitle });
    });
    var df = dueFacts().slice(0, ph.factsN||0);
    df.forEach(function(f){ var q = factToProblem(f); if(q) queue.push(q); });
    // finish on a win: one easy problem on the focus op
    var win = fallbackProblem(ph.op || "add");
    win.kind = "win"; win.sym = win.sym || OPS[win.op];
    queue.push(win);

    var i = 0;
    function showOne(){
      if(!ses) return;
      if(i >= queue.length){ nextPhase(); return; }
      var item = queue[i];
      arithShell(ph, "Повтор <b class='tnum'>"+(i+1)+"</b> из <b class='tnum'>"+queue.length+"</b>");
      var labelEl = document.getElementById("ses-msg");
      if(labelEl){
        var tag = item.kind==="win" ? "на победе" : (item.kind==="miss" ? "из этой сессии" : (item.kind==="mistake" ? "работа над ошибкой" : "факт к повтору"));
        labelEl.textContent = tag; labelEl.className = "ex-msg show";
      }
      setProblem(item);
      var t0 = Date.now(), locked = false;
      ses._submit = function(){
        if(locked || !ses) return;
        var inp = document.getElementById("ses-in"); if(!inp) return;
        var v = clean(inp.value); if(v === "") return;
        locked = true; inp.disabled = true;
        var rt = Date.now() - t0, ok = (parseFloat(v) === item.ans);
        ses.total++; if(ok) ses.correct++; ses.rts.push(rt);
        if(item.op) rate(item.op, ok, rt);
        // update SRS engines
        if(item.kind === "mistake" && item.sig){ try{ window.MentisMistakes.review(item.sig, ok); }catch(e){} }
        if(item.kind === "fact" && item.factId){ gradeFact(item, ok, rt, v); }
        var msg = document.getElementById("ses-msg");
        if(ok){
          if(msg){ msg.textContent = "✓ Верно"; msg.className = "ex-msg show ok"; }
          try{ M.audio.ok(); M.audio.vibe(30); }catch(e){}
          i++; later(showOne, noanim()?60:500);
        }else{
          if(msg){ msg.innerHTML = "✕ Ответ: <span class='tnum'>"+item.ans+"</span>"; msg.className = "ex-msg show no"; }
          try{ M.audio.no(); M.audio.vibe([30,50,30]); }catch(e){}
          var lesson = null;
          if(item.a!=null && item.op){ lesson = handleMiss({a:item.a,op:item.op,b:item.b,ans:item.ans}, v); }
          later(function(){ reteach(lesson, function(){ if(!ses) return; i++; showOne(); }); }, noanim()?150:650);
        }
      };
    }
    showOne();
  }

  function computeAns(a, op, b){
    a = +a; b = +b;
    if(op==="add") return a+b; if(op==="sub") return a-b;
    if(op==="mul") return a*b; if(op==="div") return b? a/b : 0;
    return a;
  }
  function factToProblem(f){
    // MentisFacts items: try to read operands/answer; fall back to a/op/b
    try{
      var op = f.op || (f.category==="mult"?"mul":null) || "mul";
      var a = (f.a!=null)?f.a:(f.operands && f.operands[0]);
      var b = (f.b!=null)?f.b:(f.operands && f.operands[1]);
      var ans = (f.answer!=null)?f.answer:(a!=null&&b!=null?computeAns(a,op,b):null);
      if(a==null||b==null||ans==null) return null;
      return { kind:"fact", factId:(f.id||f.factId||null), a:a, op:op, b:b, ans:ans, sym:OPS[op] };
    }catch(e){ return null; }
  }
  function gradeFact(item, ok, rt, given){
    try{
      if(window.MentisFacts && typeof window.MentisFacts.gradeFromAnswer === "function"){
        window.MentisFacts.gradeFromAnswer(item.factId, { correct:ok, rtMs:rt, given:given });
      } else if(window.MentisFacts && typeof window.MentisFacts.review === "function"){
        window.MentisFacts.review(item.factId, ok ? (rt<2000?5:4) : 1);
      }
    }catch(e){}
  }

  /* ============================================================
     FINISH — rich summary
     ============================================================ */
  function finish(){
    if(!ses) return;
    clearTimers();
    var elapsed = Math.round((Date.now() - ses.startTs)/1000);
    var acc = ses.total ? Math.round(100*ses.correct/ses.total) : 0;
    var medRt = ses.rts.length ? median(ses.rts) : 0;

    // mastery delta on focus op (rating change this session)
    var fo = ses.focus.op;
    var before = (ses.ratStart && ses.ratStart[fo] != null) ? ses.ratStart[fo] : ratingOf(fo);
    var after = ratingOf(fo);
    var delta = after - before;

    // dominant error type
    var domErr = null, domN = 0;
    Object.keys(ses.errTypes).forEach(function(k){ if(ses.errTypes[k] > domN){ domN = ses.errTypes[k]; domErr = k; } });
    var ERR_RU = { careless:"невнимательность", factual:"забытый факт", procedural:"сбой в шаге", conceptual:"непонятый принцип" };
    var ERR_TIP = {
      careless:"Знаешь метод — просто притормози на вводе.",
      factual:"Один-два факта подвели — их подкинем в повтор.",
      procedural:"Метод верный, оступился в шаге — micro-повтор поможет.",
      conceptual:"Разберём принцип заново, потом вернёмся к задаче."
    };

    // calibration via MentisMeta if available, else local
    var calLine = "";
    try{
      if(window.MentisMeta && typeof window.MentisMeta.calibration === "function"){
        var c = window.MentisMeta.calibration();
        if(c && c.text) calLine = esc(c.text);
      }
    }catch(e){}
    if(!calLine && ses.calib.length){
      var felt = ses.calib.reduce(function(s,x){ return s + x.conf; },0)/ses.calib.length;
      var hit = ses.calib.reduce(function(s,x){ return s + (x.correct?1:0); },0)/ses.calib.length;
      var bias = felt - hit;
      var verdict = Math.abs(bias) < 0.08 ? "Калибровка точная — чувствуешь, что знаешь."
        : (bias > 0 ? "Лёгкая переоценка уверенности — перепроверяй «уверенные»."
                    : "Недооцениваешь себя на отработанном — доверяй фактам чуть больше.");
      calLine = "Уверенность " + Math.round(felt*100) + "% / точность " + Math.round(hit*100) + "%. " + verdict;
    }

    // persist session log + daily + streak via recordResult (which bumps daily)
    try{
      var st = S();
      if(!Array.isArray(st.sessionLog)) st.sessionLog = [];
      st.sessionLog.push({ date: todayKey(), ts: Date.now(), total: ses.total, correct: ses.correct, acc: acc, sec: elapsed, focus: fo });
      st.sessionLog = st.sessionLog.slice(-180);
      save();
    }catch(e){}
    try{ M.recordResult(ID, { score: ses.correct, total: ses.total, acc: acc, focus: fo }); }catch(e){}

    var deltaHTML = delta > 0.05
      ? '<div class="ses-up">↑ ' + (OPN[fo]||fo) + ': уровень вырос на <b class="tnum">+'+delta.toFixed(1)+'</b></div>'
      : (delta < -0.05
        ? '<div class="ses-dn">↓ ' + (OPN[fo]||fo) + ' просел на <b class="tnum">'+delta.toFixed(1)+'</b> — вернёмся завтра</div>'
        : '<div class="ses-flat">'+(OPN[fo]||fo)+': уровень держится <b class="tnum">'+after.toFixed(1)+'</b></div>');

    var errHTML = domErr
      ? '<div class="ses-err"><div class="ses-err-h">Чаще всего: <b>'+esc(ERR_RU[domErr]||domErr)+'</b></div><div class="ses-err-t">'+esc(ERR_TIP[domErr]||"")+'</div></div>'
      : '<div class="ses-err ses-err-ok">Без систематических ошибок — чисто.</div>';

    ses.body.innerHTML =
      '<div class="ex-wrap ses-wrap ses-summary">' +
        '<div class="ses-done-badge">🎉 Сеанс пройден</div>' +
        '<div class="ex-stat-row">' +
          '<div class="ex-stat"><div class="v tnum">'+ses.correct+'/'+ses.total+'</div><div class="k">верно</div></div>' +
          '<div class="ex-stat"><div class="v tnum">'+acc+'%</div><div class="k">точность</div></div>' +
          '<div class="ex-stat"><div class="v tnum">'+fmtMMSS(elapsed)+'</div><div class="k">время</div></div>' +
          (medRt?'<div class="ex-stat"><div class="v tnum">'+(medRt/1000).toFixed(1)+'с</div><div class="k">медиана</div></div>':'') +
        '</div>' +
        '<div class="ses-card ses-prog-card">' + deltaHTML + '</div>' +
        '<div class="ses-card">' + errHTML + '</div>' +
        (calLine ? '<div class="ses-card ses-calib"><div class="ses-calib-h">Калибровка</div><div class="ses-calib-t">'+calLine+'</div></div>' : '') +
        '<p class="lead ses-back">Лучшее закрепление — ежедневный ритм. <b>Возвращайся завтра</b> — фокус подстроится сам.</p>' +
        '<div class="ex-row"><button class="btn ghost" id="ses-home" type="button">На главную</button><button class="btn" id="ses-again" type="button">Ещё сеанс</button></div>' +
      '</div>';
    var hb = document.getElementById("ses-home"); if(hb) hb.addEventListener("click", function(){ M.home(); });
    var ab = document.getElementById("ses-again"); if(ab) ab.addEventListener("click", function(){ run(); });
    try{ M.audio.ok(); }catch(e){}
    ses = null;
  }

  function median(arr){
    try{ if(U.median) return U.median(arr); }catch(e){}
    var a = arr.slice().sort(function(x,y){ return x-y; }), n = a.length;
    if(!n) return 0; return n%2 ? a[(n-1)/2] : (a[n/2-1]+a[n/2])/2;
  }
  function fmtMMSS(s){
    try{ if(U.fmtTime) return U.fmtTime(s*1000); }catch(e){}
    var m = Math.floor(s/60), r = s%60; return m + ":" + String(r).padStart(2,"0");
  }

  /* ============================================================
     HOME CTA (#home-session) + module registration
     ============================================================ */
  function doneToday(){
    try{
      var log = S().sessionLog;
      if(Array.isArray(log) && log.length){
        var last = log[log.length-1];
        return last && last.date === todayKey();
      }
    }catch(e){}
    return false;
  }

  function renderHome(){
    var host = document.getElementById("home-session");
    if(!host) return;
    var p;
    try{ p = plan(); }catch(e){ p = { focus:{op:"add",title:"Сложение"}, estMin:8 }; }
    var done = doneToday();
    var fTitle = (p.focus && p.focus.title) ? p.focus.title : "счёт";

    var html = '<div class="ses-cta' + (done?" ses-cta-done":"") + '" id="ses-cta">' +
      '<div class="ses-cta-ic">🎯</div>' +
      '<div class="ses-cta-body">' +
        '<div class="ses-cta-title">Сеанс дня</div>' +
        (done
          ? '<div class="ses-cta-sub">Сеанс пройден ✓ — можно ещё</div>'
          : '<div class="ses-cta-sub">фокус: <b>'+esc(fTitle)+'</b> · ~'+ (p.estMin||8) +' мин</div>') +
      '</div>' +
      '<button class="btn ses-cta-btn'+(done?" ghost":"")+'" id="ses-cta-go" type="button">' + (done ? "Ещё сеанс" : "Начать сеанс") + '</button>' +
    '</div>';
    host.innerHTML = html;
    var go = document.getElementById("ses-cta-go");
    if(go) go.addEventListener("click", function(){ try{ M.audio.ensure(); }catch(e){} run(); });
  }

  M.onHome(renderHome);

  M.registerModule({
    id: ID, group: "technique", icon: "🎯",
    title: "Сеанс дня",
    subtitle: "Структурированная тренировка: разминка → освоение → челлендж → разбор",
    unit: "оч",
    start: run
  });

  /* ---- public API ---- */
  window.MentisSession = { plan: plan, run: run };
})();
