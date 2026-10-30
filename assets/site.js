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
})();
