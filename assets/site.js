(function(){
  // menu (phones / tablets)
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('gnav');
  if (btn && nav) {
    btn.addEventListener('click', function(){
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.querySelector('span').textContent = open ? '閉じる' : 'メニュー';
    });
    nav.addEventListener('click', function(e){
      if (e.target.closest('a')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded','false'); btn.querySelector('span').textContent = 'メニュー'; }
    });
  }
  // お問い合わせフォーム
  document.querySelectorAll('[data-contact-form]').forEach(function(f){
    f.addEventListener('submit', function(e){
      e.preventDefault();
      var m = f.querySelector('.form-msg');
      var btn = f.querySelector('button[type=submit]');
      var v = function(id){ var el = document.getElementById(id); return el ? el.value : ''; };
      btn.disabled = true;
      m.classList.remove('err');
      fetch('/api/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        kind: 'contact', company: v('c-company'), name: v('c-name'), email: v('c-mail'), tel: v('c-tel'),
        domain: v('c-url'), topic: v('c-kind'), message: v('c-body'),
        website: (f.querySelector('[name=website]') || {}).value || ''
      }) })
        .then(function(r){ return r.json(); })
        .then(function(j){
          if (j.ok) { m.textContent = '送信しました。1営業日以内に、ご入力のメールアドレスへお返事します。'; f.reset(); }
          else { m.textContent = j.message || '送信できませんでした。'; m.classList.add('err'); }
          m.classList.add('show'); btn.disabled = false;
        })
        .catch(function(){ m.textContent = '通信がうまくいきませんでした。少し待ってからお試しください。'; m.classList.add('err', 'show'); btn.disabled = false; });
    });
  });
  // blog category filter
  var chips = document.querySelectorAll('.cat-chips button');
  // 公開済みの記事が無いカテゴリのボタンは出さない
  chips.forEach(function(c){
    var cat = c.getAttribute('data-cat');
    if (cat === 'all') return;
    var has = Array.prototype.some.call(document.querySelectorAll('.blog-grid .post-card:not(.soon)'), function(card){ return card.getAttribute('data-cat') === cat; });
    if (!has) c.hidden = true;
  });
  chips.forEach(function(c){
    c.addEventListener('click', function(){
      chips.forEach(function(x){ x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); });
      var cat = c.getAttribute('data-cat');
      document.querySelectorAll('.blog-grid .post-card').forEach(function(card){
        card.hidden = !(cat === 'all' || card.getAttribute('data-cat') === cat);
      });
    });
  });
  // 追従ボタン（スマホ・タブレット）：URL入力欄が見えている間は隠す
  (function(){
    var top = document.getElementById('scanForm');
    var a = document.createElement('a');
    a.className = 'float-cta is-hidden';
    a.href = top ? '#top' : '/#top';
    a.setAttribute('aria-label', '無料でサイトを診断する（URLを入れるだけ・登録不要）');
    a.innerHTML = '<span class="fc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M7.5 10.5h1.6l1-2 1.8 4 1-2h1.6"/></svg></span><span class="fc-txt"><strong>無料でサイトを診断する</strong><small>URLだけ・登録不要・数十秒で判定</small></span><span class="fc-arrow" aria-hidden="true">→</span>';
    document.body.appendChild(a);
    document.body.classList.add('has-float-cta');
    var hideFor = Array.prototype.slice.call(document.querySelectorAll('[data-scan], #mailBox, .cta-band, .art-cta, [data-contact-form]'));
    var seen = new Set();
    var started = false;
    var update = function(){ a.classList.toggle('is-hidden', !started || seen.size > 0); };
    if ('IntersectionObserver' in window && hideFor.length) {
      var io = new IntersectionObserver(function(es){
        es.forEach(function(e){ if (e.isIntersecting && e.target.offsetParent !== null) seen.add(e.target); else seen.delete(e.target); });
        update();
      }, { threshold: 0.15 });
      hideFor.forEach(function(el){ io.observe(el); });
    }
    var onScroll = function(){ var s = window.scrollY > 240; if (s !== started) { started = s; update(); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if (top) {
      a.addEventListener('click', function(e){
        e.preventDefault();
        var input = document.getElementById('domain1');
        top.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (input) setTimeout(function(){ try { input.focus({ preventScroll: true }); } catch (x) { input.focus(); } }, 450);
      });
    }
  })();
})();
