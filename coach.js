/* MentisCoach — technique solver. Exposes window.MentisCoach.
   Pure logic: returns Lessons per the SHARED LESSON SCHEMA. No DOM, no globals
   except window.MentisCoach. */
(function(){
  "use strict";

  // ---------- helpers ----------
  function dist(n){
    // distance to nearest multiple of 10 (for round-and-adjust shape detection)
    var r = n % 10;
    return Math.min(r, 10 - r);
  }
  function distUp(n){ // how far up to next multiple of 10
    var r = n % 10;
    return r === 0 ? 0 : 10 - r;
  }
  function pow10(k){ var p=1; for(var i=0;i<k;i++)p*=10; return p; }
  function isPow10(n){ // returns k if n===10^k (k>=1), else -1
    if(n<10) return -1;
    var k=0, m=n;
    while(m%10===0){ m/=10; k++; }
    return (m===1) ? k : -1;
  }
  function digits(n){ return String(n).split("").map(Number); }
  var SYM = { add:"+", sub:"−", mul:"×", div:"÷" };

  // active-recall compute step builder
  function ask(prompt, answer){ return { prompt: prompt, answer: answer }; }

  // recap card text builder (stable name/icon vocabulary == B technique names)
  function recap(name, icon, when, why){
    return "Приём: " + name + " " + icon + "\nПрименяй когда: " + when + "\nПочему быстрее: " + why;
  }

  // ======================================================================
  //  ADDITION
  // ======================================================================
  function explainAdd(a, b){
    var answer = a + b;
    // A1: round-and-adjust — one addend close to a round number (dist<=2)
    // choose the addend that is closer to its round-up target
    var cand = null;
    [[a,b],[b,a]].forEach(function(pair){
      var addend = pair[0], other = pair[1];
      var du = distUp(addend);          // 1 or 2 means addend ends in 8/9
      var du100 = (addend%100===98||addend%100===99) ? (100 - addend%100) : 99;
      if(du>0 && du<=2){
        if(!cand || du < cand.delta) cand = { addend:addend, other:other, R:addend+du, delta:du };
      }
      // also handle ...98/...99 (delta to next hundred small)
      var to100 = (100 - (addend%100));
      if((addend%100===98||addend%100===99) && (!cand || to100 < cand.delta)){
        cand = { addend:addend, other:other, R:addend+to100, delta:to100 };
      }
    });
    if(cand){
      var R = cand.R, delta = cand.delta, other = cand.other, addend = cand.addend;
      var sum = other + R;
      // result = sum - delta
      return {
        a:a, op:"add", b:b, sym:"+", answer:answer,
        method:"add_round", methodTitle:"Округление и поправка",
        when:"одно слагаемое чуть меньше круглого (…8, …9, …98)",
        intro:"Округляем неудобное слагаемое вверх до круглого, складываем легко, затем убираем лишнее.",
        steps:[
          { text:"Округляем "+addend+" вверх до круглого "+R+". Так складывать проще.", value:R },
          { text:"На сколько мы перебрали? Это поправка δ, её вычтем в конце.",
            compute: ask("Чему равно δ = "+R+" − "+addend+"?", delta), value:"δ = "+delta },
          { text:"Складываем с круглым: "+other+" + "+R+".", value:sum,
            compute: ask("Сколько будет "+other+" + "+R+"?", sum) },
          { text:"Возвращаем перебор: вычитаем δ. Это и есть ответ.",
            compute: ask("Сколько будет "+sum+" − "+delta+"?", answer), value:answer }
        ],
        recap: recap("Округление и поправка","🎯",
          "слагаемое чуть ниже круглого (…8, …9, …98, …99)",
          "считаешь с круглым якорем и делаешь одну маленькую поправку вместо переноса.")
      };
    }
    // A2 fallback: left-to-right by place
    return addLeftToRight(a, b, answer);
  }

  function addLeftToRight(a, b, answer){
    // build place decomposition from highest place down
    var len = Math.max(String(a).length, String(b).length);
    var steps = [];
    var running = 0;
    var placeNames = {1:"единиц",10:"десятков",100:"сотен",1000:"тысяч"};
    var places = [];
    for(var p = pow10(len-1); p >= 1; p /= 10){ places.push(p); }
    var introParts = [];
    for(var i=0;i<places.length;i++){
      var p = places[i];
      var da = Math.floor(a/p)%10 * p;
      var db = Math.floor(b/p)%10 * p;
      var add = da + db;
      var prev = running;
      running += add;
      var nm = placeNames[p] || (p+"-х");
      if(i===0){
        steps.push({ text:"Начинаем со старших разрядов ("+nm+"): "+da+" + "+db+".", value:running });
      } else {
        // make the tens-place running sum an active-recall step (A2 AR-prompt)
        var isAR = (p===10);
        var st = { text:"Добавляем "+nm+": "+da+" + "+db+" к "+prev+".", value:running };
        if(isAR){ st.compute = ask("Промежуточная сумма: "+prev+" + "+(da+db)+" = ?", running); }
        steps.push(st);
      }
    }
    steps[steps.length-1].value = answer; // ensure chain reaches answer
    return {
      a:a, op:"add", b:b, sym:"+", answer:answer,
      method:"add_l2r", methodTitle:"Слева направо по разрядам",
      when:"любое сложение без удобного округления",
      intro:"Складываем по разрядам начиная со старших — так держишь грубый ответ в голове и уточняешь.",
      steps: steps,
      recap: recap("Слева направо","➡️",
        "общий случай сложения, когда трюк не подходит",
        "сначала получаешь крупную часть ответа, потом уточняешь младшие разряды — меньше держать в уме.")
    };
  }

  // ======================================================================
  //  SUBTRACTION
  // ======================================================================
  function explainSub(a, b){
    var answer = a - b;
    // S1: count-up bridge — small difference
    if(answer >= 0 && answer <= 20){
      var nextRound = b + distUp(b);
      if(distUp(b) === 0) nextRound = b; // b already round
      var g1 = nextRound - b;       // bridge to round
      var g2 = a - nextRound;       // round to a
      // guard: if b already round, just one gap
      if(g1 === 0){
        return {
          a:a, op:"sub", b:b, sym:"−", answer:answer,
          method:"sub_countup", methodTitle:"Досчёт до числа",
          when:"уменьшаемое и вычитаемое близки",
          intro:"Считаем не «сколько отнять», а «сколько добавить к "+b+", чтобы дойти до "+a+"».",
          steps:[
            { text:"Сколько прибавить к "+b+", чтобы получить "+a+"? Это и есть разность.",
              compute: ask(b+" + ? = "+a, answer), value:answer }
          ],
          recap: recap("Досчёт до числа","🪜",
            "числа близки (разница до ~20)",
            "идёшь вверх короткими шагами вместо вычитания с занятием.")
        };
      }
      return {
        a:a, op:"sub", b:b, sym:"−", answer:answer,
        method:"sub_countup", methodTitle:"Досчёт до числа",
        when:"уменьшаемое и вычитаемое близки (разница мала)",
        intro:"Считаем, сколько добавить к "+b+", чтобы дойти до "+a+" — это и есть разность.",
        steps:[
          { text:"Сначала добираемся от "+b+" до круглого "+nextRound+".",
            compute: ask("Сколько прибавить к "+b+" до "+nextRound+"?", g1), value:"+"+g1 },
          { text:"Теперь от "+nextRound+" до "+a+".", value:"+"+g2,
            compute: ask("Сколько прибавить к "+nextRound+" до "+a+"?", g2) },
          { text:"Складываем шаги — это разность.",
            compute: ask(g1+" + "+g2+" = ?", answer), value:answer }
        ],
        recap: recap("Досчёт до числа","🪜",
          "числа близки (разница до ~20)",
          "идёшь вверх через круглое число короткими шагами вместо занятия разрядов.")
      };
    }
    // S2: round-and-adjust — b near round (ends 8/9 or 98/99)
    var du = distUp(b);
    var to100 = (b%100===98||b%100===99) ? (100 - b%100) : 99;
    var useHundred = (b%100===98||b%100===99);
    if((du>0 && du<=2) || useHundred){
      var delta = useHundred ? to100 : du;
      var R = b + delta;
      var t = a - R;
      // result = t + delta
      return {
        a:a, op:"sub", b:b, sym:"−", answer:answer,
        method:"sub_round", methodTitle:"Округление и поправка",
        when:"вычитаемое чуть меньше круглого (…8, …9, …98)",
        intro:"Вычитаем круглое число вместо неудобного "+b+", потом возвращаем лишне снятое.",
        steps:[
          { text:"Округляем вычитаемое "+b+" вверх до "+R+".", value:R },
          { text:"Мы сняли лишнего на δ — это вернём в конце.",
            compute: ask("Чему равно δ = "+R+" − "+b+"?", delta), value:"δ = "+delta },
          { text:"Вычитаем круглое: "+a+" − "+R+".", value:t,
            compute: ask("Сколько будет "+a+" − "+R+"?", t) },
          { text:"Возвращаем лишне снятое: прибавляем δ. Это ответ.",
            compute: ask("Сколько будет "+t+" + "+delta+"?", answer), value:answer }
        ],
        recap: recap("Округление и поправка","🎯",
          "вычитаемое чуть ниже круглого (…8, …9, …98, …99)",
          "снимаешь удобное круглое и делаешь одну поправку вместо занятия через разряды.")
      };
    }
    // S3 fallback: left-to-right by place
    return subLeftToRight(a, b, answer);
  }

  function subLeftToRight(a, b, answer){
    var len = String(a).length;
    var steps = [];
    var running = 0; // running result built from highest place
    var placeNames = {1:"единицы",10:"десятки",100:"сотни",1000:"тысячи"};
    var places = [];
    for(var p = pow10(len-1); p >= 1; p /= 10){ places.push(p); }
    for(var i=0;i<places.length;i++){
      var p = places[i];
      var da = Math.floor(a/p)%10 * p;
      var db = Math.floor(b/p)%10 * p;
      var sub = da - db;
      var prev = running;
      running += sub;
      var nm = placeNames[p] || (p+"-е");
      if(i===0){
        steps.push({ text:"Начинаем со старших разрядов ("+nm+"): "+da+" − "+db+".", value:running });
      } else {
        var st = { text:"Вычитаем "+nm+": "+da+" − "+db+" из текущего "+prev+".", value:running };
        // AR-prompt: the borrow / running step
        st.compute = ask("Текущий результат: "+prev+" "+(sub<0?("− "+(-sub)):("+ "+sub))+" = ?", running);
        steps.push(st);
      }
    }
    steps[steps.length-1].value = answer;
    return {
      a:a, op:"sub", b:b, sym:"−", answer:answer,
      method:"sub_l2r", methodTitle:"Слева направо по разрядам",
      when:"общий случай вычитания",
      intro:"Вычитаем по разрядам со старших, корректируя текущий результат, если младший разряд уходит в минус.",
      steps: steps,
      recap: recap("Слева направо","➡️",
        "общий случай вычитания без удобного округления",
        "держишь грубую разность сразу и аккуратно поправляешь занятие в уме.")
    };
  }

  // ======================================================================
  //  MULTIPLICATION
  // ======================================================================
  function explainMul(a, b){
    var answer = a * b;

    // M1: ×11
    if(a===11 || b===11){
      var n = (a===11)? b : a;
      return mul11(n, a, b, answer);
    }
    // M2: ×(5·10^k)
    var m5 = isFiveScale(a) || isFiveScale(b);
    if(m5){
      var fac = isFiveScale(a)? a : b;
      var oth = (fac===a)? b : a;
      return mulHalveScale(oth, fac, a, b, answer);
    }
    // M3: ×(25·10^k)
    var m25 = isTwentyFiveScale(a) || isTwentyFiveScale(b);
    if(m25){
      var f25 = isTwentyFiveScale(a)? a : b;
      var o25 = (f25===a)? b : a;
      return mulQuarterScale(o25, f25, a, b, answer);
    }
    // M4: ×(10^k - 1) i.e. 9, 99, 999
    var nines = isNines(a) || isNines(b);
    if(nines){
      var fn = isNines(a)? a : b;
      var on = (fn===a)? b : a;
      return mulNines(on, fn, a, b, answer);
    }
    // Tiny squares (≤12²) are memorised table facts — no trick beats recall.
    if(a===b && a<=12){
      return squareSmall(a, answer);
    }
    // M5: square ending in 5
    if(a===b && a%10===5){
      return squareEnd5(a, answer);
    }
    // M6: general square via difference of squares
    if(a===b){
      return squareDiff(a, answer);
    }
    // M7: doubling-halving — (a even & b%5==0) or (b even & a%5==0)
    if((a%2===0 && b%5===0) || (b%2===0 && a%5===0)){
      return mulDoubleHalve(a, b, answer);
    }
    // M8: near-base / Nikhilam — both within ~11% of same base 10^k
    var nik = nikhilamBase(a, b);
    if(nik){
      return mulNikhilam(a, b, nik, answer);
    }
    // M9: criss-cross two 2-digit
    if(a>=10 && a<=99 && b>=10 && b<=99){
      return mulCrissCross(a, b, answer);
    }
    // M10 fallback: distributive split
    return mulDistributive(a, b, answer);
  }

  function isFiveScale(n){ // n === 5 * 10^k, k>=0  (5,50,500,...)
    if(n<5) return false;
    var m=n;
    while(m%10===0) m/=10;
    return m===5;
  }
  function isTwentyFiveScale(n){ // 25,250,2500,... === 25*10^k
    if(n<25) return false;
    var m=n;
    while(m%10===0) m/=10;
    return m===25;
  }
  function isNines(n){ return n===9||n===99||n===999||n===9999; }

  function mul11(n, a, b, answer){
    // works for any n; teach the 2-digit insert-sum rule, fall to general if >2 digits
    if(n>=10 && n<=99){
      var hi = Math.floor(n/10), lo = n%10, s = hi+lo;
      var steps;
      if(s<10){
        steps = [
          { text:"Раздвигаем цифры "+n+": слева "+hi+", справа "+lo+", в середину — их сумму.", value:hi+" _ "+lo },
          { text:"Сумма соседних цифр идёт в середину.",
            compute: ask("Чему равна "+hi+" + "+lo+"?", s), value:""+answer }
        ];
      } else {
        steps = [
          { text:"Раздвигаем цифры "+n+": слева "+hi+", справа "+lo+".", value:hi+" _ "+lo },
          { text:"Сумма цифр в середину (с переносом, т.к. ≥10).",
            compute: ask("Чему равна "+hi+" + "+lo+"?", s), value:"…"+ (s%10) +"…" },
          { text:"Сумма "+s+" ≥ 10: пишем "+(s%10)+", переносим 1 к старшему ("+hi+"+1).",
            value:""+answer }
        ];
      }
      return {
        a:a, op:"mul", b:b, sym:"×", answer:answer,
        method:"mul11", methodTitle:"Умножение на 11",
        when:"один множитель равен 11",
        intro:"Цифры числа раздвигаем по краям, а между ними ставим их сумму.",
        steps: steps,
        recap: recap("Умножение на 11","🔢",
          "множитель равен 11",
          "вместо умножения — одно сложение соседних цифр; ответ собирается сразу.")
      };
    }
    // n*11 = n*10 + n  (general)
    return {
      a:a, op:"mul", b:b, sym:"×", answer:answer,
      method:"mul11", methodTitle:"Умножение на 11",
      when:"один множитель равен 11",
      intro:"Умножить на 11 — это умножить на 10 (приписать ноль) и прибавить само число.",
      steps:[
        { text:"Умножаем на 10 — приписываем ноль.", value:n*10 },
        { text:"Прибавляем само число "+n+".",
          compute: ask((n*10)+" + "+n+" = ?", answer), value:answer }
      ],
      recap: recap("Умножение на 11","🔢",
        "множитель равен 11",
        "умножение на 10 плюс само число — сдвиг и одно сложение.")
    };
  }

  function mulHalveScale(n, fac, a, b, answer){
    // fac = 5*10^k. n*fac = (n/2)*10*10^k = (n/2)*(10^(k+1))
    var m=fac, k=0; while(m%10===0){m/=10;k++;} // fac = 5*10^k
    var scale = pow10(k+1); // since 5*10^k = 10^(k+1)/2
    var half = n/2;
    var halfText, halfVal, exact;
    if(n%2===0){ halfVal = n/2; halfText = "Делим "+n+" пополам."; exact = true; }
    else {
      // odd: n*5 = floor(n/2)*10+5 (for fac=5); general: half is x.5
      halfVal = (n-1)/2; exact = false;
      halfText = n+" нечётное: берём целую часть половины "+halfVal+" (остаток даст …5 при ×5).";
    }
    // Compute exactly via fac directly to guarantee correctness:
    // n * fac. Use halve-and-scale narrative but verify chain reaches answer.
    var steps = [];
    if(n%2===0){
      var hv = n/2;
      steps.push({ text:halfText, value:hv, compute: ask("Сколько будет "+n+" ÷ 2?", hv) });
      steps.push({ text:"Домножаем на "+scale+" (сдвиг): дописываем нули.",
        value:answer, compute: ask(hv+" × "+scale+" = ?", answer) });
    } else {
      // odd path: do n * fac = n*5*10^k. Simpler: (n*fac). Teach via *10 then /2.
      var times10 = n*scale; // n * 10^(k+1)
      steps.push({ text:"Удобнее: умножаем "+n+" на "+scale+" (сдвиг нулями).", value:times10,
        compute: ask(n+" × "+scale+" = ?", times10) });
      steps.push({ text:"Так как множитель — это "+scale+" ÷ 2, делим результат пополам.",
        value:answer, compute: ask(times10+" ÷ 2 = ?", answer) });
    }
    return {
      a:a, op:"mul", b:b, sym:"×", answer:answer,
      method:"mul_half_scale", methodTitle:"Деление пополам и сдвиг",
      when:"множитель 5, 50, 500…",
      intro:"5 — это половина от 10. Умножаем на 10 (сдвиг) и делим пополам.",
      steps: steps,
      recap: recap("Деление пополам и сдвиг","✋",
        "множитель равен 5·10ᵏ (5, 50, 500…)",
        "заменяешь умножение на 5 сдвигом на 10 и делением на 2 — оба действия лёгкие.")
    };
  }

  function mulQuarterScale(n, fac, a, b, answer){
    // fac = 25*10^k. 25 = 100/4.
    var m=fac, k=0; while(m%10===0){m/=10;k++;}
    var scale = pow10(k+2); // 25*10^k = 100*10^k /4 = 10^(k+2)/4
    var times = n*scale;    // n*10^(k+2)
    return {
      a:a, op:"mul", b:b, sym:"×", answer:answer,
      method:"mul_quarter_scale", methodTitle:"Деление на 4 и сдвиг",
      when:"множитель 25, 250, 2500…",
      intro:"25 — это четверть от 100. Умножаем на "+scale+" и делим на 4.",
      steps:[
        { text:"Умножаем "+n+" на "+scale+" (сдвиг нулями).", value:times,
          compute: ask(n+" × "+scale+" = ?", times) },
        { text:"Множитель — это "+scale+" ÷ 4, поэтому делим на 4.",
          value:answer, compute: ask(times+" ÷ 4 = ?", answer) }
      ],
      recap: recap("Деление на 4 и сдвиг","🍀",
        "множитель равен 25·10ᵏ (25, 250…)",
        "25 = 100/4: сдвиг и деление на 4 быстрее столбика.")
    };
  }

  function mulNines(n, fac, a, b, answer){
    var k = String(fac).length;       // 9->1, 99->2
    var scale = pow10(k);             // fac = 10^k - 1
    var shifted = n*scale;
    return {
      a:a, op:"mul", b:b, sym:"×", answer:answer,
      method:"mul_nines", methodTitle:"Умножение на 9/99",
      when:"множитель 9, 99, 999…",
      intro:fac+" = "+scale+" − 1, поэтому "+n+"·"+fac+" = "+n+"·"+scale+" − "+n+".",
      steps:[
        { text:"Умножаем "+n+" на круглое "+scale+" (сдвиг).", value:shifted },
        { text:"Вычитаем само число "+n+" — это и есть ответ.",
          value:answer, compute: ask(shifted+" − "+n+" = ?", answer) }
      ],
      recap: recap("Умножение на 9/99","9️⃣",
        "множитель состоит из девяток (9, 99, 999)",
        "одно умножение на круглое и одно вычитание вместо длинного умножения.")
    };
  }

  function squareSmall(a, answer){
    // small squares are memorised table facts — present as a fact, not a trick
    return {
      a:a, op:"mul", b:a, sym:"×", answer:answer,
      method:"mul_fact", methodTitle:"Табличный квадрат",
      when:"маленький квадрат — это табличный факт",
      intro:"Маленькие квадраты держим в памяти готовыми — приём тут не быстрее, чем просто вспомнить.",
      steps:[
        { text:"«"+a+" в квадрате» — это "+a+" раз по "+a+".",
          value:answer, compute: ask(a+" × "+a+" = ?", answer) },
        { text:"Запоминаем целиком: "+a+" · "+a+" = "+answer+".", value:answer }
      ],
      recap: recap("Табличный квадрат","▦",
        "квадраты до 12² — это таблица, которую держат наизусть",
        "готовый факт срабатывает мгновенно, без вычислений.")
    };
  }

  function squareEnd5(a, answer){
    var t = Math.floor(a/10);      // tens part
    var prod = t*(t+1);
    return {
      a:a, op:"mul", b:a, sym:"×", answer:answer,
      method:"sq_end5", methodTitle:"Квадрат числа на 5",
      when:"возводим в квадрат число, оканчивающееся на 5",
      intro:"Берём число десятков, умножаем его на следующее число и приписываем к ответу «25».",
      steps:[
        { text:"Десятки числа "+a+" — это "+t+". Умножаем на следующее: "+t+"·"+(t+1)+".",
          value:prod, compute: ask("Сколько будет "+t+" × "+(t+1)+"?", prod) },
        { text:"Приписываем справа «25» — получаем ответ.", value:answer }
      ],
      recap: recap("Квадрат числа на 5","⑤",
        "квадрат числа, оканчивающегося на 5 (25², 35², 85²)",
        "десятки, умноженные на следующее число, плюс приписанное «25» дают ответ без столбика.")
    };
  }

  function squareDiff(a, answer){
    // pick nearest multiple of 10 as anchor; d = a - anchor (can be negative)
    var anchor = Math.round(a/10)*10;
    if(anchor===a) anchor = (a%20===0)? a-10 : a-10; // avoid d=0; shift to make a trick
    var d = a - anchor;            // a = anchor + d
    var lo = a - d;                // = anchor
    var hi = a + d;                // = anchor + 2d
    var prod = lo*hi;              // (a-d)(a+d) = a^2 - d^2
    var dd = d*d;
    // answer = prod + dd
    return {
      a:a, op:"mul", b:a, sym:"×", answer:answer,
      method:"sq_diff", methodTitle:"Квадрат через разность",
      when:"возводим в квадрат любое число рядом с круглым",
      intro:"Сдвигаем число до ближайшего круглого и на столько же в другую сторону — выходит удобная пара для умножения. Потом добавляем квадрат сдвига.",
      steps:[
        { text:"Сдвигаем "+a+" до круглого "+lo+". На столько же в другую сторону — "+hi+". Это удобная пара.",
          value:"сдвиг "+Math.abs(d), compute: ask("На сколько "+a+" отстоит от "+lo+"?", Math.abs(d)) },
        { text:"Перемножаем удобную пару "+lo+"·"+hi+".",
          value:prod, compute: ask("Сколько будет "+lo+" × "+hi+"?", prod) },
        { text:"Прибавляем квадрат сдвига: "+Math.abs(d)+"² = "+dd+". Это ответ.",
          value:answer, compute: ask(prod+" + "+dd+" = ?", answer) }
      ],
      recap: recap("Квадрат через разность","◳",
        "квадрат числа недалеко от круглого (нет окончания 5)",
        "удобная пара перемножается легко, остаётся прибавить маленький квадрат сдвига.")
    };
  }

  function mulDoubleHalve(a, b, answer){
    // halve the even one, double the other, repeat until one becomes round-ish; teach one step
    var x=a, y=b;
    // arrange so x is the even one we halve, y the one we double — prefer halving even toward making the *5 factor round
    // we want to turn the multiple-of-5 into a multiple of 10 by doubling it, halving the even.
    var even, fiv;
    if(a%2===0 && b%5===0){ even=a; fiv=b; }
    else { even=b; fiv=a; }
    // double fiv, halve even (one pass usually makes fiv a multiple of 10 if fiv%10==5)
    var halves = even/2;
    var doubled = fiv*2;
    // verify product preserved
    return {
      a:a, op:"mul", b:b, sym:"×", answer:answer,
      method:"mul_double_halve", methodTitle:"Удвоить и располовинить",
      when:"один множитель чётный, другой кратен 5",
      intro:"Делим чётный пополам и удваиваем второй — произведение не меняется, но числа становятся круглее.",
      steps:[
        { text:"Делим чётное "+even+" пополам, второе "+fiv+" удваиваем.",
          value:halves+" × "+doubled, compute: ask(even+" ÷ 2 = ? (новый множитель)", halves) },
        { text:"Получили удобную пару "+halves+" × "+doubled+".",
          value:answer, compute: ask(halves+" × "+doubled+" = ?", answer) }
      ],
      recap: recap("Удвоить и располовинить","⇄",
        "один множитель чётный, другой кратен 5",
        "перекидываешь множитель 2 так, что 5 превращается в круглую 10.")
    };
  }

  function nikhilamBase(a, b){
    // both within ~11% of same base 10^k (k>=1). Return {B,k} if applies and gives a real shortcut
    for(var k=1;k<=4;k++){
      var B = pow10(k);
      var tol = B*0.12;
      if(Math.abs(a-B)<=tol && Math.abs(b-B)<=tol && (a!==B && b!==B)){
        // require both reasonably close and not trivially equal to base
        return { B:B, k:k };
      }
    }
    return null;
  }

  function mulNikhilam(a, b, nik, answer){
    var B = nik.B, k = nik.k;
    var da = a - B, db = b - B;       // deviations (can be negative)
    var left = a + db;                // cross sum (== b + da)
    var right = da * db;              // deviation product
    // result = left*B + right  (right may need k-digit handling / carry — but arithmetic identity holds)
    return {
      a:a, op:"mul", b:b, sym:"×", answer:answer,
      method:"mul_nikhilam", methodTitle:"Близко к базе (Никхилам)",
      when:"оба множителя рядом с круглой базой ("+B+")",
      intro:"Считаем отклонения от базы "+B+", складываем крест-накрест и добавляем произведение отклонений.",
      steps:[
        { text:"Отклонения от "+B+": у "+a+" это "+da+", у "+b+" это "+db+".",
          value:"Δ "+da+", "+db },
        { text:"Левая часть — крест-накрест: "+a+" + ("+db+") = "+b+" + ("+da+").",
          value:left, compute: ask("Чему равно "+a+" + ("+db+")?", left) },
        { text:"Правая часть — произведение отклонений "+da+"·"+db+".",
          value:right, compute: ask("Чему равно ("+da+") × ("+db+")?", right) },
        { text:"Собираем: левая часть × "+B+" + правая часть.",
          value:answer, compute: ask(left+" × "+B+" + ("+right+") = ?", answer) }
      ],
      recap: recap("Близко к базе (Никхилам)","◎",
        "оба множителя рядом с круглой базой (98×97, 103×104)",
        "две маленькие операции с отклонениями вместо полного умножения.")
    };
  }

  function mulCrissCross(a, b, answer){
    var x1=Math.floor(a/10), x0=a%10;
    var y1=Math.floor(b/10), y0=b%10;
    var units = x0*y0;
    var cross = x0*y1 + x1*y0;
    var hundreds = x1*y1;
    // answer = hundreds*100 + cross*10 + units
    return {
      a:a, op:"mul", b:b, sym:"×", answer:answer,
      method:"mul_crisscross", methodTitle:"Крест-накрест",
      when:"любые два двузначных числа",
      intro:"Три части: единицы (низ×низ), середина (крест-накрест), сотни (верх×верх) — с переносами.",
      steps:[
        { text:"Единицы: перемножаем младшие цифры "+x0+"·"+y0+".",
          value:units },
        { text:"Середина — крест-накрест: "+x0+"·"+y1+" + "+x1+"·"+y0+".",
          value:cross, compute: ask("Чему равно "+x0+"·"+y1+" + "+x1+"·"+y0+"?", cross) },
        { text:"Сотни: старшие цифры "+x1+"·"+y1+".",
          value:hundreds, compute: ask("Чему равно "+x1+" × "+y1+"?", hundreds) },
        { text:"Собираем с переносами: "+hundreds+"·100 + "+cross+"·10 + "+units+".",
          value:answer, compute: ask((hundreds*100)+" + "+(cross*10)+" + "+units+" = ?", answer) }
      ],
      recap: recap("Крест-накрест","✕",
        "общий случай двух двузначных чисел",
        "одно умножение раскладывается на три простых произведения, собираемых по разрядам.")
    };
  }

  function mulDistributive(a, b, answer){
    // split the larger factor by place; partial products
    var big = Math.max(a,b), small = Math.min(a,b);
    var len = String(big).length;
    var parts = [];
    var steps = [];
    var acc = 0;
    var firstAR = true;
    var partialNote = [];
    for(var p = pow10(len-1); p>=1; p/=10){
      var d = Math.floor(big/p)%10 * p;
      if(d===0) continue;
      var pp = d*small;
      parts.push({d:d, pp:pp});
    }
    parts.forEach(function(part,i){
      var prev = acc; acc += part.pp;
      var st = { text:"Часть "+(i+1)+": "+part.d+" × "+small+".", value:part.pp };
      st.compute = ask("Сколько будет "+part.d+" × "+small+"?", part.pp);
      steps.push(st);
    });
    // final sum step
    var sumExpr = parts.map(function(p){return p.pp;}).join(" + ");
    steps.push({ text:"Складываем частичные произведения.",
      value:answer, compute: ask(sumExpr+" = ?", answer) });
    return {
      a:a, op:"mul", b:b, sym:"×", answer:answer,
      method:"mul_distributive", methodTitle:"Разложение по разрядам",
      when:"общий случай умножения",
      intro:"Разбиваем больший множитель по разрядам, умножаем каждый кусок и складываем.",
      steps: steps,
      recap: recap("Разложение по разрядам","▦",
        "общий случай, когда специальный приём не подходит",
        "несколько простых умножений на круглые куски складываются проще, чем столбик.")
    };
  }

  // ======================================================================
  //  DIVISION  (assume exact division for teaching; if not exact, fall to distributive estimate)
  // ======================================================================
  function explainDiv(a, b){
    var answer = a / b;
    var exact = (a % b === 0);

    // D1: factor the divisor into easy p*q
    var fac = easyFactorPair(b);
    if(exact && fac){
      return divFactor(a, b, fac, answer);
    }
    // D2: b = 5*10^k -> *2 then /10
    if(exact && isFiveScale(b)){
      return divFiveScale(a, b, answer);
    }
    // D3: b in {2,4,8} -> repeated halving
    if(exact && (b===2||b===4||b===8)){
      return divHalving(a, b, answer);
    }
    // D4: small quotient -> multiply-up
    if(exact && answer<=20){
      return divMultiplyUp(a, b, answer);
    }
    // D5 fallback: distributive split via round near-multiple
    return divDistributive(a, b, answer, exact);
  }

  function easyFactorPair(b){
    // known easy composite divisors
    var table = { 6:[2,3],12:[3,4],14:[2,7],15:[3,5],16:[4,4],18:[2,9],
      21:[3,7],24:[4,6],28:[4,7],32:[4,8],35:[5,7],36:[6,6],
      45:[5,9],48:[6,8],49:[7,7],56:[7,8],63:[7,9],72:[8,9] };
    return table[b] || null;
  }

  function divFactor(a, b, fac, answer){
    var p=fac[0], q=fac[1];
    var mid = a/p; // must be integer because b|a and p|b ... not always integer though.
    // Ensure a/p is integer: if not, swap factors
    if(a%p!==0){ var t=p; p=q; q=t; mid=a/p; }
    if(a%p!==0){ // neither divides cleanly — fall back
      return divMultiplyUp(a,b,answer);
    }
    return {
      a:a, op:"div", b:b, sym:"÷", answer:answer,
      method:"div_factor", methodTitle:"Разложить делитель",
      when:"делитель раскладывается на удобные множители ("+b+" = "+p+"·"+q+")",
      intro:b+" = "+p+"·"+q+": делим последовательно на "+p+", потом на "+q+".",
      steps:[
        { text:"Сначала делим на "+p+".",
          value:mid, compute: ask("Сколько будет "+a+" ÷ "+p+"?", mid) },
        { text:"Теперь делим на "+q+" — это ответ.",
          value:answer, compute: ask(mid+" ÷ "+q+" = ?", answer) }
      ],
      recap: recap("Разложить делитель","🧩",
        "делитель = произведение простых (35=5·7, 12=3·4)",
        "два лёгких деления вместо одного трудного.")
    };
  }

  function divFiveScale(a, b, answer){
    var m=b, k=0; while(m%10===0){m/=10;k++;} // b = 5*10^k
    var scale = pow10(k+1);  // b = 10^(k+1)/2, so a/b = 2a/10^(k+1)
    var doubled = a*2;
    return {
      a:a, op:"div", b:b, sym:"÷", answer:answer,
      method:"div_five_scale", methodTitle:"Удвоить и сдвинуть",
      when:"делитель 5, 50, 500…",
      intro:"Деление на 5 = умножение на 2 и деление на 10. Удваиваем и сдвигаем запятую.",
      steps:[
        { text:"Удваиваем делимое "+a+".",
          value:doubled, compute: ask("Сколько будет "+a+" × 2?", doubled) },
        { text:"Делим на "+scale+" (сдвиг) — это ответ.",
          value:answer, compute: ask(doubled+" ÷ "+scale+" = ?", answer) }
      ],
      recap: recap("Удвоить и сдвинуть","✋",
        "делитель равен 5·10ᵏ (5, 50, 500…)",
        "÷5 = ×2 ÷10 — оба действия мгновенные.")
    };
  }

  function divHalving(a, b, answer){
    var times = (b===2)?1:(b===4)?2:3;
    var steps = [];
    var cur = a;
    for(var i=0;i<times;i++){
      var prev = cur; cur = cur/2;
      steps.push({ text:"Половиним "+(i+1)+"-й раз: "+prev+" ÷ 2.",
        value:cur, compute: ask("Сколько будет "+prev+" ÷ 2?", cur) });
    }
    steps[steps.length-1].value = answer;
    return {
      a:a, op:"div", b:b, sym:"÷", answer:answer,
      method:"div_halving", methodTitle:"Повторное деление пополам",
      when:"делитель 2, 4 или 8",
      intro:"Делим пополам нужное число раз: 4 = два раза, 8 = три раза.",
      steps: steps,
      recap: recap("Повторное деление пополам","½",
        "делитель равен 2, 4 или 8",
        "несколько простых делений на 2 вместо деления столбиком.")
    };
  }

  function divMultiplyUp(a, b, answer){
    // build the multiple of b that hits a (small quotient)
    return {
      a:a, op:"div", b:b, sym:"÷", answer:answer,
      method:"div_multiply_up", methodTitle:"Подбор умножением",
      when:"частное небольшое (до ~20)",
      intro:"Подбираем, на сколько умножить "+b+", чтобы получить "+a+".",
      steps:[
        { text:"Прикидываем кратные "+b+": ищем то, что даёт "+a+".",
          value:answer, compute: ask(b+" × ? = "+a, answer) },
        { text:"Найденный множитель и есть частное.", value:answer }
      ],
      recap: recap("Подбор умножением","🔎",
        "ожидается небольшое частное",
        "проще домножить делитель до делимого, чем делить столбиком.")
    };
  }

  function divDistributive(a, b, answer, exact){
    // a = round multiple of b ± adj
    // find largest multiple of b that is a 'round' chunk (multiple of b and of 10 ideally)
    // simpler: split a into a1 (nearest lower multiple of b that's easy) + remainder
    // Choose chunk = b * floor(a/b/?) ... use a tens-friendly multiple.
    // Practical: pick c = b * floor((a/b)) rounded down to nice — but to keep exact teaching,
    // split a as: a = part1 + part2 where part1 is largest multiple of (b*10) <= a (if exists) else handle.
    var q = Math.floor(a/b);
    var rem = a - q*b;
    if(exact){
      // split quotient by tens: q = qTens*?  Show a = (qHi*b) + (qLo*b)
      // choose qHi = floor(q/10)*10
      var qHi = Math.floor(q/10)*10;
      var qLo = q - qHi;
      var p1 = qHi*b, p2 = qLo*b;
      if(qHi>0){
        return {
          a:a, op:"div", b:b, sym:"÷", answer:answer,
          method:"div_distributive", methodTitle:"Разбить делимое",
          when:"общий случай точного деления",
          intro:"Разбиваем "+a+" на удобные куски, кратные "+b+", делим по частям и складываем.",
          steps:[
            { text:"Берём крупный кусок "+p1+" — это "+qHi+" раз по "+b+".",
              value:qHi, compute: ask(p1+" ÷ "+b+" = ?", qHi) },
            { text:"Остаток "+p2+" делим тоже.",
              value:qLo, compute: ask(p2+" ÷ "+b+" = ?", qLo) },
            { text:"Складываем частные.",
              value:answer, compute: ask(qHi+" + "+qLo+" = ?", answer) }
          ],
          recap: recap("Разбить делимое","▦",
            "общий случай деления без специального приёма",
            "режешь делимое на куски, кратные делителю, — каждый делится устно.")
        };
      }
      // small q, no tens split -> multiply up
      return divMultiplyUp(a, b, answer);
    }
    // non-exact: teach estimate with remainder
    return {
      a:a, op:"div", b:b, sym:"÷", answer:answer,
      method:"div_distributive", methodTitle:"Деление с остатком",
      when:"деление нацело не выходит",
      intro:"Находим наибольшее кратное "+b+", не превышающее "+a+", и остаток.",
      steps:[
        { text:"Наибольшее кратное "+b+" в "+a+": это "+(q*b)+" ("+q+"×"+b+").",
          value:q, compute: ask("Сколько раз "+b+" помещается в "+a+"?", q) },
        { text:"Остаток: "+a+" − "+(q*b)+" = "+rem+".",
          value:answer+" (ост. "+rem+")" }
      ],
      recap: recap("Деление с остатком","▦",
        "деление не нацело",
        "оцениваешь целую часть кратным и отдельно считаешь остаток.")
    };
  }

  // ======================================================================
  //  PUBLIC: explain
  // ======================================================================
  function explain(a, op, b){
    a = Math.abs(Math.trunc(+a)); b = Math.abs(Math.trunc(+b));
    switch(op){
      case "add": return explainAdd(a,b);
      case "sub": return explainSub(a,b);
      case "mul": return explainMul(a,b);
      case "div": return explainDiv(a,b);
      default: return explainAdd(a,b);
    }
  }

  // ======================================================================
  //  PUBLIC: sample(method) -> {a,op,b} where the method applies
  // ======================================================================
  function ri(lo,hi){ return Math.floor(Math.random()*(hi-lo+1))+lo; }
  function sample(method){
    switch(method){
      case "add_round": { var b=[8,9,98,99,198][ri(0,4)]; return {a:ri(120,880), op:"add", b:b}; }
      case "add_l2r":   return {a:ri(125,898), op:"add", b:ri(125,898)};
      case "sub_countup": { var a=ri(40,90); return {a:a, op:"sub", b:a-ri(3,15)}; }
      case "sub_round": { var b2=[8,9,98,99][ri(0,3)]; return {a:ri(b2+30,900), op:"sub", b:b2}; }
      case "sub_l2r":   { var a3=ri(450,980); return {a:a3, op:"sub", b:ri(120,a3-50)}; }
      case "mul11":     return {a:ri(13,98), op:"mul", b:11};
      case "mul_half_scale": { var f=[5,50][ri(0,1)]; return {a:ri(12,89), op:"mul", b:f}; }
      case "mul_quarter_scale": return {a:ri(12,89), op:"mul", b:25};
      case "mul_nines": { var f2=[9,99][ri(0,1)]; return {a:ri(12,89), op:"mul", b:f2}; }
      case "sq_end5":   { var t=ri(2,9); return {a:10*t+5, op:"mul", b:10*t+5}; }
      case "sq_diff":   { var n=ri(21,79); if(n%10===5)n++; return {a:n, op:"mul", b:n}; }
      case "mul_double_halve": { var ev=2*ri(7,24); var fv=[15,25,35,45][ri(0,3)]; return {a:ev, op:"mul", b:fv}; }
      case "mul_nikhilam": { var bse=100; return {a:bse+ri(-7,8), op:"mul", b:bse+ri(-7,8)}; }
      case "mul_crisscross": return {a:ri(12,89), op:"mul", b:ri(12,89)};
      case "mul_distributive": return {a:ri(112,898), op:"mul", b:ri(3,9)};
      case "div_factor": { var pq=[[35,5,7],[12,3,4],[15,3,5],[24,4,6]][ri(0,3)]; var q=ri(4,30); return {a:pq[0]*q, op:"div", b:pq[0]}; }
      case "div_five_scale": { var f3=[5,50][ri(0,1)]; var q2=ri(6,40); return {a:f3*q2, op:"div", b:f3}; }
      case "div_halving": { var d=[2,4,8][ri(0,2)]; var q3=ri(8,60); return {a:d*q3, op:"div", b:d}; }
      case "div_multiply_up": { var d2=ri(6,14); var q4=ri(3,12); return {a:d2*q4, op:"div", b:d2}; }
      case "div_distributive": { var d3=ri(3,9); var q5=ri(22,140); return {a:d3*q5, op:"div", b:d3}; }
      default: {
        if(/^add/.test(method)) return {a:ri(120,880), op:"add", b:ri(120,880)};
        if(/^sub/.test(method)) { var sa=ri(300,900); return {a:sa, op:"sub", b:ri(80,sa-40)}; }
        if(/^div/.test(method)) { var dd=ri(3,9), qq=ri(6,40); return {a:dd*qq, op:"div", b:dd}; }
        return {a:ri(13,89), op:"mul", b:ri(13,89)};
      }
    }
  }

  window.MentisCoach = { explain: explain, sample: sample };
})();
