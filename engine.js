/* ============================================================
   渲染引擎 V3
   ── 路由、Markdown 渲染、MathJax 排版、进度条、返回顶部
   ── 异步加载 config.json / articles.json / articles/*.md / about.md
   ── 依赖：marked.js（Markdown 解析，CDN 加载）
            MathJax（公式渲染，CDN 加载）
   ============================================================ */
var CONFIG = null;
var ARTICLE_LIST = null;
var currentFilter = 'all';
var currentSearch = '';

/* ---- 工具函数 ---- */
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function escapeAttr(s){ return escapeHTML(s); }
function getCategoryName(id){
  var cat = CONFIG.categories.find(function(c){ return c.id === id; });
  return cat ? cat.name : id;
}

/* ---- 异步文件加载 ---- */
function fetchText(url){
  return fetch(url).then(function(res){
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  });
}
function fetchJSON(url){
  return fetch(url).then(function(res){
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

/* ---- Markdown 渲染 + MathJax 排版 ---- */
function renderMarkdown(text){
  /* 先保护公式，防止 Markdown 解析破坏 */
  var mathBlocks = [];
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, function(m){
    mathBlocks.push(m);
    return '\x00MATH' + (mathBlocks.length - 1) + '\x00';
  });
  text = text.replace(/\$([^\$\n]+?)\$/g, function(m){
    mathBlocks.push(m);
    return '\x00MATH' + (mathBlocks.length - 1) + '\x00';
  });

  /* Markdown 转 HTML */
  var html = marked.parse(text);

  /* 恢复公式 */
  html = html.replace(/\x00MATH(\d+)\x00/g, function(m, i){
    return mathBlocks[parseInt(i)];
  });

  return html;
}

function typesetMath(container){
  if(window.MathJax && window.MathJax.typesetPromise){
    MathJax.typesetPromise([container]).catch(function(){});
  }
}

/* ---- 路由 ---- */
function navigate(path){
  if(window.location.hash !== '#' + path){
    window.location.hash = path;
  } else {
    router();
  }
}

function router(){
  var hash = window.location.hash.replace('#', '');

  document.getElementById('navArticles').classList.toggle('active', hash === '' || hash.indexOf('article/') !== 0);
  document.getElementById('navAbout').classList.toggle('active', hash === 'about');

  window.scrollTo({top: 0, behavior: 'auto'});

  if(hash === 'about'){
    renderAbout();
  } else if(hash.indexOf('article/') === 0){
    var id = hash.replace('article/', '');
    renderArticle(id);
  } else {
    renderList();
  }
}

/* ---- 渲染列表页 ---- */
function renderList(){
  var app = document.getElementById('app');

  var filtered = ARTICLE_LIST.filter(function(a){
    var matchFilter = currentFilter === 'all' || a.category === currentFilter;
    if(!matchFilter) return false;
    if(currentSearch){
      var q = currentSearch.toLowerCase();
      return a.title.toLowerCase().indexOf(q) >= 0 ||
             a.excerpt.toLowerCase().indexOf(q) >= 0;
    }
    return true;
  });

  var filterHTML = CONFIG.categories.map(function(c){
    var cls = currentFilter === c.id ? 'filter-chip active' : 'filter-chip';
    return '<span class="' + cls + '" onclick="setFilter(\'' + c.id + '\')">' + escapeHTML(c.name) + '</span>';
  }).join('');
  filterHTML = '<span class="filter-chip' + (currentFilter === 'all' ? ' active' : '') + '" onclick="setFilter(\'all\')">全部</span>' + filterHTML;

  var listHTML;
  if(filtered.length === 0){
    listHTML = '<div class="empty-state">没有匹配的文章。</div>';
  } else {
    listHTML = filtered.map(function(a){
      return '<article class="article-card" onclick="navigate(\'article/' + a.id + '\')">' +
        '<div class="article-meta">' +
          '<span class="article-date">' + escapeHTML(a.date) + '</span>' +
          '<span class="article-category">' + escapeHTML(getCategoryName(a.category)) + '</span>' +
        '</div>' +
        '<h2 class="article-title">' + escapeHTML(a.title) + '</h2>' +
        '<p class="article-excerpt">' + escapeHTML(a.excerpt) + '</p>' +
      '</article>';
    }).join('');
  }

  app.innerHTML =
    '<div class="list-header">' +
      '<h1 class="list-title">' + escapeHTML(CONFIG.siteName) + '</h1>' +
      '<p class="list-subtitle">' + escapeHTML(CONFIG.tagline) + '</p>' +
    '</div>' +
    '<input class="search-box" type="text" placeholder="搜索文章…" value="' + escapeAttr(currentSearch) + '" ' +
      'oninput="setSearch(this.value)">' +
    '<div class="filter-bar">' + filterHTML + '</div>' +
    '<div class="article-list">' + listHTML + '</div>';

  updateProgress();
}

function setFilter(id){
  currentFilter = id;
  renderList();
}
function setSearch(val){
  currentSearch = val;
  renderList();
  var box = document.querySelector('.search-box');
  if(box){
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
}

/* ---- 渲染文章详情页 ---- */
function renderArticle(id){
  var app = document.getElementById('app');
  var article = ARTICLE_LIST.find(function(a){ return a.id === id; });

  if(!article){
    app.innerHTML = '<div class="empty-state">文章不存在。</div>';
    return;
  }

  var subtitleHTML = article.subtitle
    ? '<p class="article-view-subtitle">' + escapeHTML(article.subtitle) + '</p>'
    : '';

  app.innerHTML =
    '<div class="article-view">' +
      '<span class="back-link" onclick="navigate(\'\')">← 返回文章列表</span>' +
      '<div class="article-view-meta">' +
        '<span>' + escapeHTML(article.date) + '</span>' +
        '<span class="article-category">' + escapeHTML(getCategoryName(article.category)) + '</span>' +
      '</div>' +
      '<h1 class="article-view-title">' + escapeHTML(article.title) + '</h1>' +
      subtitleHTML +
      '<div class="article-body" id="articleBody">' +
        '<p style="color:var(--muted);font-family:var(--font-sans)">正在加载正文…</p>' +
      '</div>' +
    '</div>';

  fetchText('articles/' + article.id + '.md').then(function(content){
    var body = document.getElementById('articleBody');
    body.innerHTML = renderMarkdown(content);
    typesetMath(body);
    updateProgress();
  }).catch(function(){
    var body = document.getElementById('articleBody');
    body.innerHTML = '<div class="empty-state">正文加载失败：' + escapeHTML(article.id + '.md') + ' 不存在或无法读取。</div>';
  });

  updateProgress();
}

/* ---- 渲染关于页 ---- */
function renderAbout(){
  var app = document.getElementById('app');
  var contactHTML = '';
  if(CONFIG.contact && CONFIG.contact.email){
    contactHTML =
      '<div class="about-contact">' +
        '<div class="about-contact-title">联系方式</div>' +
        '<a href="mailto:' + escapeAttr(CONFIG.contact.email) + '">' + escapeHTML(CONFIG.contact.email) + '</a>' +
      '</div>';
  }

  app.innerHTML =
    '<div class="about-view">' +
      '<span class="back-link" onclick="navigate(\'\')">← 返回文章列表</span>' +
      '<h1 class="about-title">关于</h1>' +
      '<div class="article-body" id="aboutBody">' +
        '<p style="color:var(--muted);font-family:var(--font-sans)">正在加载…</p>' +
      '</div>' +
      contactHTML +
    '</div>';

  fetchText('about.md').then(function(content){
    var aboutBody = document.getElementById('aboutBody');
    aboutBody.innerHTML = renderMarkdown(content);
    typesetMath(aboutBody);
    updateProgress();
  }).catch(function(){
    var aboutBody = document.getElementById('aboutBody');
    aboutBody.innerHTML = '<div class="empty-state">关于页内容加载失败。</div>';
  });

  updateProgress();
}

/* ---- 渲染页脚 ---- */
function renderFooter(){
  var footer = document.getElementById('footer');
  var html = '<p>' + escapeHTML(CONFIG.footer) + '</p>';
  if(CONFIG.contact && CONFIG.contact.email){
    html += '<p><a href="mailto:' + escapeAttr(CONFIG.contact.email) + '">' + escapeHTML(CONFIG.contact.email) + '</a></p>';
  }
  footer.innerHTML = html;
}

/* ---- 更新站点标题 ---- */
function updateSiteMeta(){
  document.title = CONFIG.siteName;
  document.getElementById('navHome').textContent = CONFIG.siteName;
  document.getElementById('navTagline').textContent = CONFIG.tagline;
  document.querySelector('meta[name="description"]').setAttribute('content', CONFIG.tagline);
  document.querySelector('meta[property="og:title"]').setAttribute('content', CONFIG.siteName);
  document.querySelector('meta[property="og:description"]').setAttribute('content', CONFIG.tagline);
}

/* ---- 阅读进度条 ---- */
function updateProgress(){
  var bar = document.getElementById('progressBar');
  var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  var scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
  var pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
  bar.style.width = pct + '%';
}

window.addEventListener('scroll', function(){
  updateProgress();
  var btn = document.getElementById('backToTop');
  if(window.pageYOffset > 400){
    btn.classList.add('visible');
  } else {
    btn.classList.remove('visible');
  }
});

/* ---- 初始化（异步加载配置和文章列表） ---- */
function init(){
  Promise.all([
    fetchJSON('config.json'),
    fetchJSON('articles.json')
  ]).then(function(results){
    CONFIG = results[0];
    ARTICLE_LIST = results[1].sort(function(a, b){
      return b.date.localeCompare(a.date);
    });

    updateSiteMeta();
    renderFooter();
    window.addEventListener('hashchange', router);
    router();
  }).catch(function(){
    document.getElementById('app').innerHTML =
      '<div class="empty-state">站点配置加载失败，请检查 config.json 和 articles.json 是否存在。</div>';
  });
}

init();
