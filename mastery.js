/* ============================================================
   MODULE · Карта мастерства (MentisMastery)
   Mastery model + visual skill map. Isolated IIFE against the
   Mentis API. Exposes window.MentisMastery and registers a
   module {id:'mastery'}. Reads only documented S slices.
   ============================================================ */
(function(){
  var M = window.Mentis; if(!M) return;
  var U = M.util, ID = "mastery";
  var clamp = U.clamp, median = U.median;

  /* ----------------------------------------------------------
     SKILL GRAPH
     categories -> skills; each skill: id,title,kind, prereqs[],
     and a resolver telling level() how to read S.
     kinds: 'op' | 'tech' | 'mod' | 'fact'
     ---------------------------------------------------------- */

  // Coach method families grouped by the operation they belong to.
  // Each technique skill unlocks once its parent op is 'proficient'.
  var TECHS = [
    {id:"t.add",  title:"Сложение: округление и слева-направо", op:"add",
      methods:["add_round","add_l2r"]},
    {id:"t.sub",  title:"Вычитание: округление, досчёт, дополнение", op:"sub",
      methods:["sub_round","sub_l2r","sub_countup"]},
    {id:"t.mul",  title:"Умножение: ×11, крест-накрест, разряды", op:"mul",
      methods:["mul11","mul_nines","mul_crisscross","mul_distributive",
               "mul_double_halve","mul_half_scale","mul_quarter_scale","mul_nikhilam"]},
    {id:"t.sq",   title:"Квадраты: через разность, оканч. на 5", op:"mul",
      methods:["sq_diff","sq_end5"]},
    {id:"t.div",  title:"Деление: разложение, пополам, подбор", op:"div",
      methods:["div_distributive","div_factor","div_five_scale","div_halving",
               "div_multiply_up","div_remainder"]}
  ];

  var MEM_MODS = [
    {id:"m.numspan", mod:"numspan", title:"Числовой ряд",   hib:true,  tgt:7},
    {id:"m.nback",   mod:"nback",   title:"N-back",          hib:true,  tgt:3},
    {id:"m.stroop",  mod:"stroop",  title:"Числовой Струп",  hib:true,  tgt:20},
    {id:"m.schulte", mod:"schulte", title:"Таблица Шульте",  hib:false, tgt:30},
    {id:"m.anzan",   mod:"anzan",   title:"Флеш-анзан",      hib:true,  tgt:10}
  ];

  // Fact groups — maturity read from S.facts (SRS deck). Until the deck
  // is populated we fall back to a proxy from op fluency.
  var FACT_GROUPS = [
    {id:"f.times",       title:"Таблица умножения", cats:["mult"],            proxyOp:"mul"},
    {id:"f.squares",     title:"Квадраты 2–25",     cats:["sq"],              proxyOp:"mul"},
    {id:"f.complements", title:"Дополнения до 10/100", cats:["comp10","comp100","doubles"], proxyOp:"add"}
  ];

  var TIER_LABEL = {locked:"Закрыто", untouched:"Не начато", novice:"Новичок", learning:"Осваиваю",
                    proficient:"Уверенно", mastered:"Освоено"};
  var TIER_ICON  = {locked:"🔒", untouched:"○", novice:"◔", learning:"◑", proficient:"◕", mastered:"●"};

  /* ---------- helpers reading S ---------- */
  function S(){ return M.getState(); }

  // Recent arithmetic accuracy + median RT for an op across last sessions.
  function opPerf(op){
    var st = S(), out = {att:0, corr:0, rts:[]};
    var ses = Array.isArray(st.sessions) ? st.sessions.slice(-30) : [];
    for(var i=0;i<ses.length;i++){
      var d = ses[i] && ses[i].perOp && ses[i].perOp[op];
      if(d){ out.att += d.attempts||0; out.corr += d.correct||0;
        if(d.medRt) out.rts.push(d.medRt); }
    }
    return out;
  }

  // Error rate for an op from the mistakes ledger (active leeches weigh more).
  function opErrLoad(op){
    var L = S().errLedger; if(!Array.isArray(L)) return 0;
    var n=0;
    for(var i=0;i<L.length;i++){ if(L[i].op===op){ n += 1 + Math.min(L[i].lapses||0,3)*0.5; } }
    return n;
  }

  // SRS maturity ratio for a fact group: mature = reps>=2 & interval>=6.
  function factMaturity(grp){
    var facts = S().facts;
    var ids = [], mature = 0;
    if(facts && typeof facts==="object"){
      for(var k in facts){ if(!facts.hasOwnProperty(k)) continue;
        var f = facts[k]; var cat = (f && (f.category||(""+k).split(":")[0]));
        if(grp.cats.indexOf(cat) >= 0){
          ids.push(k);
          var r = S().ratings && S().ratings[k]; // SRS per-fact lives in ratings per spec
          if(r && (r.reps>=2) && (r.interval>=6)) mature++;
          else if(f && f.reps>=2 && f.interval>=6) mature++;
        }
      }
    }
    if(!ids.length) return {ratio:null, count:0}; // deck not built yet
    return {ratio: mature/ids.length, count: ids.length, mature:mature};
  }

  /* ---------- tier mapping from a 0..1 score ---------- */
  function tierOf(pctFrac, attempted){
    if(!attempted) return "novice"; // unlocked but untouched still shows as novice-able
    if(pctFrac >= 0.90) return "mastered";
    if(pctFrac >= 0.70) return "proficient";
    if(pctFrac >= 0.45) return "learning";
    return "novice";
  }

  /* ---------- prerequisites / unlock ---------- */
  // op skills are always unlocked (core). tech unlocks when its op is proficient.
  // squares fact group needs mul proficient; complements need add proficient.
  // A technique/fact opens once its parent op reaches the "learning" tier
  // (≥45%) — i.e. after a little real practice, not the old 70% wall a fresh
  // user could never climb.
  function opCompetent(op){ var ol = levelOp(op); return ol.attempted && ol.pct >= 45; }
  function prereqMet(skillId){
    try{
      if(skillId.charAt(0)==="o") return true;                 // op.*
      if(skillId.charAt(0)==="t"){                              // technique
        var t = findTech(skillId); if(!t) return true;
        return opCompetent(t.op);
      }
      if(skillId.charAt(0)==="m") return true;                  // memory modules always open
      if(skillId.charAt(0)==="f"){                              // fact group
        var g = findFact(skillId); if(!g) return true;
        return g.id==="f.times" || opCompetent(g.proxyOp);
      }
    }catch(e){}
    return true;
  }
  function findTech(id){ for(var i=0;i<TECHS.length;i++) if(TECHS[i].id===id) return TECHS[i]; return null; }
  function findFact(id){ for(var i=0;i<FACT_GROUPS.length;i++) if(FACT_GROUPS[i].id===id) return FACT_GROUPS[i]; return null; }

  // Quick op fluency fraction (used for unlock gating) from rating + accuracy.
  function rawOpFrac(op){
    var lvlF = clamp((S().ratings && S().ratings[op] || 3)/40, 0, 1);
    var p = opPerf(op);
    var acc = p.att>=5 ? p.corr/p.att : (lvlF>0.25?0.85:0.5);
    return 0.55*acc + 0.45*lvlF;
  }

  /* ============================================================
     PUBLIC: level(skillId)
     -> {pct, tier, metrics:{acc,speed,volume,retention}}
     ============================================================ */
  function level(skillId){
    try{
      var unlocked = prereqMet(skillId);
      var m;
      if(skillId.charAt(0)==="o")      m = levelOp(skillId.slice(2));
      else if(skillId.charAt(0)==="t") m = levelTech(skillId);
      else if(skillId.charAt(0)==="m") m = levelMod(skillId);
      else if(skillId.charAt(0)==="f") m = levelFact(skillId);
      else m = {pct:0, metrics:{acc:0,speed:0,volume:0,retention:0}, attempted:false};

      if(!unlocked){
        return {pct:0, tier:"locked", metrics:m.metrics, locked:true, attempted:m.attempted};
      }
      if(!m.attempted){
        return {pct:0, tier:"untouched", metrics:m.metrics, locked:false, attempted:false};
      }
      var frac = clamp(m.pct/100, 0, 1);
      return {pct:Math.round(m.pct), tier:tierOf(frac, m.attempted),
              metrics:m.metrics, locked:false, attempted:m.attempted};
    }catch(e){
      return {pct:0, tier:"novice", metrics:{acc:0,speed:0,volume:0,retention:0}, locked:false, attempted:false};
    }
  }

  // OP: acc (sessions), speed (medRt vs ~3.5s target), volume (rating level), retention (session count over time)
  function levelOp(op){
    var p = opPerf(op);
    var lvlF = clamp((S().ratings && S().ratings[op] || 3)/40, 0, 1);
    var attempted = p.att>0 || lvlF>0.1;
    if(!attempted) return {pct:0, attempted:false, metrics:z()};  // honest: nothing practised yet
    var acc = p.att>=4 ? p.corr/p.att : (lvlF>0.2?0.85:0.6);
    var medRt = p.rts.length ? median(p.rts) : (lvlF>0.3?3500:6000);
    var speed = clamp(3500/Math.max(medRt,1), 0, 1);            // ~3.5s/item target
    var volume = lvlF;                                          // adaptive level proxies practice depth
    var errLoad = opErrLoad(op);
    var retention = clamp(1 - errLoad/8, 0, 1) * clamp(lvlF*1.4,0,1) + 0.001;
    var pct = 100*(0.45*acc + 0.25*speed + 0.15*volume + 0.15*retention);
    return {pct:pct, attempted:attempted,
      metrics:{acc:acc, speed:speed, volume:volume, retention:retention}};
  }

  // TECH: derived from coachExposure (drills) + parent op accuracy + error load on op.
  function levelTech(id){
    var t = findTech(id); if(!t) return {pct:0, attempted:false, metrics:z()};
    var st = S(), exp = st.coachExposure || {};
    var reps = 0;
    for(var i=0;i<t.methods.length;i++){ var e=exp[t.methods[i]]; if(e!=null){ reps += (typeof e==="number"?e:(e.count||e.reps||1)); } }
    var attempted = reps>0;
    if(!attempted) return {pct:0, attempted:false, metrics:z()};  // honest: not drilled yet
    var op = opPerf(t.op);
    var acc = op.att>=4 ? op.corr/op.att : 0.7;
    var volume = clamp(reps/24, 0, 1);                          // ~24 drills => fluent
    var speed = clamp((op.rts.length?3500/Math.max(median(op.rts),1):0.6), 0, 1);
    var retention = clamp(1 - opErrLoad(t.op)/8, 0, 1);
    var pct = 100*(0.30*acc + 0.45*volume + 0.15*speed + 0.10*retention);
    return {pct:pct, attempted:attempted,
      metrics:{acc:acc, speed:speed, volume:volume, retention:retention}};
  }

  // MOD: cognitive modules from moduleStats best/plays vs a target.
  function levelMod(id){
    var spec=null; for(var i=0;i<MEM_MODS.length;i++) if(MEM_MODS[i].id===id) spec=MEM_MODS[i];
    if(!spec) return {pct:0, attempted:false, metrics:z()};
    var stt = M.stat(spec.mod);
    if(!stt || stt.best==null) return {pct:0, attempted:false, metrics:z()};
    var best = stt.best, plays = stt.plays||0;
    // proximity to target — schulte is lower-is-better (seconds)
    var prox = spec.hib ? clamp(best/spec.tgt, 0, 1)
                        : clamp(spec.tgt/Math.max(best,1), 0, 1);
    var volume = clamp(plays/12, 0, 1);
    // trend / retention: recent history stability
    var hist = (stt.history||[]).slice(-8).map(function(h){return h.score;}).filter(function(x){return x!=null&&isFinite(x);});
    var retention = hist.length>=3 ? clamp((spec.hib?median(hist)/spec.tgt:spec.tgt/Math.max(median(hist),1)),0,1) : prox*0.7;
    var acc = prox;                                            // module accuracy ≈ proximity
    var speed = prox;
    var pct = 100*(0.55*prox + 0.25*volume + 0.20*retention);
    return {pct:pct, attempted:true,
      metrics:{acc:acc, speed:speed, volume:volume, retention:retention}};
  }

  // FACT: maturity ratio from SRS deck; proxy from op fluency until deck exists.
  function levelFact(id){
    var g = findFact(id); if(!g) return {pct:0, attempted:false, metrics:z()};
    var mat = factMaturity(g);
    if(mat.ratio==null){
      // no SRS deck yet → proxy from real op progress (0 until the op is touched)
      var ol = levelOp(g.proxyOp);
      if(!ol.attempted) return {pct:0, attempted:false, metrics:z()};
      var pr = clamp(ol.pct/100, 0, 1);
      return {pct:Math.min(ol.pct,85), attempted:true,
        metrics:{acc:pr, speed:pr*0.9, volume:0.2, retention:pr*0.5}};
    }
    var acc = mat.ratio;
    var volume = clamp(mat.count/40, 0, 1);
    var retention = mat.ratio;                                 // mature = survived spacing
    var pct = 100*(0.55*acc + 0.20*volume + 0.25*retention);
    return {pct:pct, attempted:mat.count>0,
      metrics:{acc:acc, speed:acc, volume:volume, retention:retention}};
  }
  function z(){ return {acc:0,speed:0,volume:0,retention:0}; }

  /* ============================================================
     PUBLIC: all() / isUnlocked() / nextGoal()
     ============================================================ */
  function buildCats(){
    var cats = [];
    cats.push({category:"Арифметика", skills:[
      {id:"o.add", title:"Сложение", op:"add"},
      {id:"o.sub", title:"Вычитание", op:"sub"},
      {id:"o.mul", title:"Умножение", op:"mul"},
      {id:"o.div", title:"Деление", op:"div"}
    ]});
    cats.push({category:"Техники счёта", skills: TECHS.map(function(t){
      return {id:t.id, title:t.title, op:t.op};
    })});
    cats.push({category:"Память и внимание", skills: MEM_MODS.map(function(m){
      return {id:m.id, title:m.title, mod:m.mod};
    })});
    cats.push({category:"Факты", skills: FACT_GROUPS.map(function(g){
      return {id:g.id, title:g.title, op:g.proxyOp};
    })});
    return cats;
  }

  function all(){
    return buildCats().map(function(c){
      return {category:c.category, skills:c.skills.map(function(sk){
        var lv = level(sk.id);
        return {id:sk.id, title:sk.title, op:sk.op||null, mod:sk.mod||null,
                pct:lv.pct, tier:lv.tier, metrics:lv.metrics, locked:lv.locked, attempted:lv.attempted};
      })};
    });
  }

  function isUnlocked(skillId){ try{ return prereqMet(skillId); }catch(e){ return true; } }

  // Weakest UNLOCKED skill below 'proficient' — the recommended focus.
  function nextGoal(){
    try{
      var best=null;
      buildCats().forEach(function(c){
        c.skills.forEach(function(sk){
          if(!isUnlocked(sk.id)) return;
          var lv = level(sk.id);
          if(lv.tier==="proficient" || lv.tier==="mastered") return;
          // prefer started-but-weak over untouched; rank by pct ascending
          var rank = lv.pct + (lv.attempted?0:8); // tiny nudge: pick something with a little signal first
          if(!best || rank < best.rank){
            best = {skillId:sk.id, title:sk.title, op:sk.op||null, rank:rank,
                    reason: reasonFor(sk, lv)};
          }
        });
      });
      if(best) delete best.rank;
      return best;
    }catch(e){ return null; }
  }
  function reasonFor(sk, lv){
    if(!lv.attempted) return "Ещё не начато — самое слабое звено цепочки.";
    if(lv.metrics.acc < 0.8) return "Точность ниже 80% — закрепи базу.";
    if(lv.metrics.speed < 0.6) return "Считаешь верно, но медленно — нужна скорость.";
    if(lv.metrics.retention < 0.6) return "Знание не закрепилось — повтори с интервалами.";
    return "Почти уверенно — ещё немного практики.";
  }

  window.MentisMastery = { level:level, all:all, isUnlocked:isUnlocked, nextGoal:nextGoal };

  /* ============================================================
     VISUAL MAP MODULE
     ============================================================ */
  var selSkill = null;

  function start(){ render(M.openScreen(ID, "Карта мастерства")); }

  function tierClass(tier){ return "msy-t-"+tier; }

  function metricBar(label, v){
    var pct = Math.round(clamp(v,0,1)*100);
    return '<div class="msy-mrow"><div class="msy-mk">'+label+'</div>'+
      '<div class="msy-mtrack"><i style="width:'+pct+'%"></i></div>'+
      '<div class="msy-mv tnum">'+pct+'%</div></div>';
  }

  function overallPct(){
    var sum=0, n=0;
    all().forEach(function(c){ c.skills.forEach(function(s){
      if(!s.locked){ sum+=s.pct; n++; }
    }); });
    return n? Math.round(sum/n) : 0;
  }

  function findSkill(id){
    var found=null;
    all().forEach(function(c){ c.skills.forEach(function(s){ if(s.id===id) found={cat:c.category, s:s}; }); });
    return found;
  }

  function render(body){
    var goal = nextGoal();
    var goalId = goal ? goal.skillId : null;
    var ov = overallPct();

    var html = '<div class="msy-wrap">';
    // header summary
    html += '<div class="msy-hero">'+
      '<div class="msy-ring" style="--p:'+ov+'"><div class="msy-ringv tnum">'+ov+'<span>%</span></div></div>'+
      '<div class="msy-herotxt"><div class="msy-herot">Общее мастерство</div>'+
      '<div class="msy-herod">Путь новичок → эксперт. Цвет и метка показывают уровень каждого навыка.</div>'+
      '</div></div>';

    // recommended focus
    if(goal){
      html += '<button class="msy-goal" id="msy-goal" type="button" data-id="'+goal.skillId+'">'+
        '<div class="msy-goal-badge">рекомендуем</div>'+
        '<div class="msy-goal-t">'+esc(goal.title)+'</div>'+
        '<div class="msy-goal-r">'+esc(goal.reason)+'</div>'+
        '<div class="msy-goal-go">Открыть →</div>'+
      '</button>';
    }

    // legend (not color-only — icon + word)
    html += '<div class="msy-legend">';
    ["untouched","novice","learning","proficient","mastered","locked"].forEach(function(t){
      html += '<span class="msy-leg '+tierClass(t)+'"><i>'+TIER_ICON[t]+'</i>'+TIER_LABEL[t]+'</span>';
    });
    html += '</div>';

    // categories
    all().forEach(function(c){
      html += '<h2 class="msy-section">'+esc(c.category)+'</h2><div class="msy-grid">';
      c.skills.forEach(function(s){
        var rec = (s.id===goalId);
        html += '<button class="msy-cell '+tierClass(s.tier)+(rec?' msy-rec':'')+'" type="button" data-id="'+s.id+'">'+
          '<div class="msy-cell-top"><span class="msy-ic" aria-hidden="true">'+TIER_ICON[s.tier]+'</span>'+
          (rec?'<span class="msy-cell-rec">★</span>':'')+'</div>'+
          '<div class="msy-cell-t">'+esc(s.title)+'</div>'+
          '<div class="msy-cell-foot"><span class="msy-cell-tier">'+TIER_LABEL[s.tier]+'</span>'+
          ((!s.locked && s.attempted)?'<span class="msy-cell-pct tnum">'+s.pct+'%</span>':'')+'</div>'+
          ((!s.locked && s.attempted)?'<div class="msy-cell-bar"><i style="width:'+s.pct+'%"></i></div>':'')+
        '</button>';
      });
      html += '</div>';
    });

    html += '<div class="msy-panel" id="msy-panel" hidden></div>';
    html += '</div>';
    body.innerHTML = html;

    var g = body.querySelector("#msy-goal");
    if(g) g.addEventListener("click", function(){ openDetail(body, g.dataset.id); });
    body.querySelectorAll(".msy-cell").forEach(function(btn){
      btn.addEventListener("click", function(){ openDetail(body, btn.dataset.id); });
    });

    // record an overall snapshot (score = overall mastery %)
    try{ M.recordResult(ID, {score:ov, higherIsBetter:true}); }catch(e){}

    if(selSkill){ openDetail(body, selSkill, true); }
  }

  function actionLine(s){
    if(s.locked) return "Закрыто. Доведи базовую операцию до уровня «Осваиваю» (≥45%), чтобы открыть приём.";
    if(!s.attempted) return "Ещё не начато. Сделай первый подход — здесь и начнётся прогресс.";
    var mt = s.metrics;
    if(mt.acc < 0.8) return "Сосредоточься на точности: разбирай ошибки, не торопись.";
    if(mt.speed < 0.6) return "Знание есть — гоняй на скорость короткими подходами.";
    if(mt.retention < 0.6) return "Повтори с интервалами, чтобы знание закрепилось.";
    if(s.tier==="mastered") return "Освоено! Поддерживай редкими повторами.";
    return "Ещё немного практики до уровня «Уверенно».";
  }

  function openDetail(body, id, noScroll){
    selSkill = id;
    var f = findSkill(id); if(!f) return;
    var s = f.s, p = body.querySelector("#msy-panel");
    if(!p) return;
    var m = s.metrics || z();
    var html = '<div class="msy-panel-head">'+
      '<div><div class="msy-panel-cat">'+esc(f.cat)+'</div>'+
      '<div class="msy-panel-t">'+esc(s.title)+'</div></div>'+
      '<div class="msy-panel-tier '+tierClass(s.tier)+'"><i>'+TIER_ICON[s.tier]+'</i>'+TIER_LABEL[s.tier]+((!s.locked && s.attempted)?' · '+s.pct+'%':'')+'</div>'+
      '</div>';
    html += '<div class="msy-metrics">'+
      metricBar("Точность", m.acc)+
      metricBar("Скорость", m.speed)+
      metricBar("Объём практики", m.volume)+
      metricBar("Закрепление", m.retention)+
    '</div>';
    html += '<div class="msy-do"><b>Что сделать:</b> '+esc(actionLine(s))+'</div>';

    // jump button to the relevant trainer when sensible
    var jump = jumpFor(s);
    if(jump){
      html += '<button class="btn sm msy-jump" id="msy-jump" type="button" data-mod="'+jump.mod+'">'+esc(jump.label)+' →</button>';
    }
    p.innerHTML = html; p.hidden = false;
    var j = p.querySelector("#msy-jump");
    if(j) j.addEventListener("click", function(){
      try{ M.audio.ensure(); }catch(e){}
      jumpModule(j.dataset.mod);
    });
    if(!noScroll){ try{ p.scrollIntoView({behavior:"smooth", block:"nearest"}); }catch(e){} }
  }

  // Open another trainer by its module id using only public surface:
  // prefer a captured start(), else click its Home tile.
  var MOD_REG = {};
  function jumpModule(modId){
    if(MOD_REG[modId]){ try{ MOD_REG[modId].start(); return; }catch(e){} }
    try{
      M.home();
      var tile = document.querySelector('#home-modules .tile[data-mod="'+modId+'"]');
      if(tile) tile.click();
    }catch(e){}
  }

  function jumpFor(s){
    if(s.mod) return {mod:s.mod, label:"Тренировать"};
    if(s.id && s.id.charAt(0)==="t") return {mod:"tech", label:"Открыть приёмы счёта"};
    if(s.id && s.id.charAt(0)==="f") return {mod:"mistakes", label:"Разобрать ошибки"};
    return null;
  }

  function esc(x){ return (""+x).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];}); }

  M.onLeave(function(){ /* nothing timed; keep selection */ });

  /* Capture future module registrations so the "Тренировать" jump can call
     their start() directly. Modules registered before us fall back to a
     programmatic Home-tile click (see jumpModule). Public surface only. */
  (function hookRegistry(){
    try{
      var orig = M.registerModule.bind(M);
      M.registerModule = function(mod){
        if(mod && mod.id) MOD_REG[mod.id] = mod;
        return orig(mod);
      };
    }catch(e){}
  })();

  M.registerModule({
    id:ID, group:"technique", icon:"🗺️",
    title:"Карта мастерства",
    subtitle:"Путь новичок→эксперт: что освоено и что дальше",
    unit:"%", start:start
  });
})();
