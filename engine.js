/* ============================================================
   渲染引擎 V3.1
   ── 路由、Markdown 渲染、MathJax 排版、进度条、返回顶部
   ── 异步加载 config.json / articles.json / articles/*.md / about.md
   ── 依赖：marked.js（Markdown 解析，CDN 加载）
            MathJax（公式渲染，CDN 加载）
   ── V3.1 修复：缓存策略、数据容错、稳健性增强
   ============================================================ */
var CONFIG = null;
var ARTICLE_LIST = null;
var currentFilter = 'all';
var currentSearch = '';
var searchTimer = null;

/* ---- 缓存版本号 ----
   修改文章/配置后，浏览器会因 fetch 的 cache:'no-cache' 策略
   自动向服务器验证是否有更新（ETag/Last-Modified），无需手动清缓存。
   如需强制刷新所有用户缓存，递增此版本号即可。 */
var CACHE_VERSION = 'v3.1';

/* ---- 工具函数 ---- */
function escapeHTML(s){
  if(s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function escapeAttr(s){ return escapeHTML(s); }

/* 安全获取文章字段，缺失时返回默认值 */
function safeField(obj, key, def){
  if(obj && obj[key] != null) return String(obj[key]);
  return def != null ? def : '';
}

function getCategoryName(id){
  if(!CONFIG || !CONFIG.categories) return id || '未分类';
  var cat = CONFIG.categories.find(function(c){ return c.id === id; });
  return cat ? (cat.name || id) : (id || '未分类');
}

/* ---- 异步文件加载（cache: 'no-cache' 确保每次验证更新） ---- */
function fetchText(url){
  return fetch(url, { cache: 'no-cache' }).then(function(res){
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  });
}
function fetchJSON(url){
  return fetch(url, { cache: 'no-cache' }).then(function(res){
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

/* ---- Markdown 渲染 + MathJax 排版 ---- */
function renderMarkdown(text){
  if(!text) return '';

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

  /* Markdown 转 HTML（带容错） */
  var html;
  try{
    if(typeof marked === 'undefined'){
      /* marked 未加载，做最基本的换行处理 */
      html = '<p>' + escapeHTML(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
    } else {
      html = marked.parse(text);
    }
  } catch(e){
    html = '<p style="color:var(--muted)">正文渲染异常：' + escapeHTML(e.message) + '</p><pre>' + escapeHTML(text) + '</pre>';
  }

  /* 恢复公式 */
  html = html.replace(/\x00MATH(\d+)\x00/g, function(m, i){
    return mathBlocks[parseInt(i)] || '';
  });

  return html;
}

function typesetMath(container){
  try{
    if(window.MathJax && window.MathJax.typesetPromise){
      MathJax.typesetPromise([container]).catch(function(){});
    }
  } catch(e){ /* MathJax 排版失败不影响内容展示 */ }
}

/* ---- 安全滚动（兼容旧浏览器） ---- */
function safeScrollTo(top, smooth){
  try{
    if(smooth){
      window.scrollTo({ top: top, behavior: 'smooth' });
    } else {
      window.scrollTo(0, top);
    }
  } catch(e){
    window.scrollTo(0, top);
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

  var navArticles = document.getElementById('navArticles');
  var navAbout = document.getElementById('navAbout');
  if(navArticles) navArticles.classList.toggle('active', hash === '' || hash.indexOf('article/') !== 0);
  if(navAbout) navAbout.classList.toggle('active', hash === 'about');

  safeScrollTo(0, false);

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
  if(!app || !ARTICLE_LIST || !CONFIG){
    if(app) app.innerHTML = '<div class="empty-state">数据未加载，请刷新页面重试。</div>';
    return;
  }

  var filtered = ARTICLE_LIST.filter(function(a){
    var matchFilter = currentFilter === 'all' || a.category === currentFilter;
    if(!matchFilter) return false;
    if(currentSearch){
      var q = currentSearch.toLowerCase();
      var title = (a.title || '').toLowerCase();
      var excerpt = (a.excerpt || '').toLowerCase();
      return title.indexOf(q) >= 0 || excerpt.indexOf(q) >= 0;
    }
    return true;
  });

  var filterHTML = (CONFIG.categories || []).map(function(c){
    var cls = currentFilter === c.id ? 'filter-chip active' : 'filter-chip';
    return '<span class="' + cls + '" onclick="setFilter(\'' + escapeAttr(c.id) + '\')">' + escapeHTML(c.name) + '</span>';
  }).join('');
  filterHTML = '<span class="filter-chip' + (currentFilter === 'all' ? ' active' : '') + '" onclick="setFilter(\'all\')">全部</span>' + filterHTML;

  var listHTML;
  if(filtered.length === 0){
    listHTML = '<div class="empty-state">没有匹配的文章。</div>';
  } else {
    listHTML = filtered.map(function(a){
      return '<article class="article-card" onclick="navigate(\'article/' + escapeAttr(a.id) + '\')">' +
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

/* 搜索防抖：避免每次输入都重渲染 */
function setSearch(val){
  currentSearch = val;
  if(searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(function(){
    renderList();
    var box = document.querySelector('.search-box');
    if(box){
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
  }, 200);
}

/* ---- 渲染文章详情页 ---- */
function renderArticle(id){
  var app = document.getElementById('app');
  if(!app || !ARTICLE_LIST){
    if(app) app.innerHTML = '<div class="empty-state">数据未加载，请刷新页面重试。</div>';
    return;
  }

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

  fetchText('articles/' + encodeURIComponent(article.id) + '.md').then(function(content){
    var body = document.getElementById('articleBody');
    if(!body) return; /* 用户可能已切换页面 */
    body.innerHTML = renderMarkdown(content);
    typesetMath(body);
    updateProgress();
  }).catch(function(){
    var body = document.getElementById('articleBody');
    if(!body) return;
    body.innerHTML = '<div class="empty-state">正文加载失败：' + escapeHTML(article.id + '.md') + ' 不存在或无法读取。</div>';
  });

  updateProgress();
}

/* ---- 渲染关于页 ---- */
function renderAbout(){
  var app = document.getElementById('app');
  if(!app) return;

  var contactHTML = '';
  if(CONFIG && CONFIG.contact && CONFIG.contact.email){
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
    if(!aboutBody) return;
    aboutBody.innerHTML = renderMarkdown(content);
    typesetMath(aboutBody);
    updateProgress();
  }).catch(function(){
    var aboutBody = document.getElementById('aboutBody');
    if(!aboutBody) return;
    aboutBody.innerHTML = '<div class="empty-state">关于页内容加载失败。</div>';
  });

  updateProgress();
}

/* ---- 渲染页脚 ---- */
function renderFooter(){
  var footer = document.getElementById('footer');
  if(!footer || !CONFIG) return;
  var html = '<p>' + escapeHTML(CONFIG.footer || '') + '</p>';
  if(CONFIG.contact && CONFIG.contact.email){
    html += '<p><a href="mailto:' + escapeAttr(CONFIG.contact.email) + '">' + escapeHTML(CONFIG.contact.email) + '</a></p>';
  }
  footer.innerHTML = html;
}

/* ---- 更新站点标题 ---- */
function updateSiteMeta(){
  if(!CONFIG) return;
  document.title = CONFIG.siteName || '思考者';
  var navHome = document.getElementById('navHome');
  var navTagline = document.getElementById('navTagline');
  if(navHome) navHome.textContent = CONFIG.siteName || '';
  if(navTagline) navTagline.textContent = CONFIG.tagline || '';
  var metaDesc = document.querySelector('meta[name="description"]');
  var ogTitle = document.querySelector('meta[property="og:title"]');
  var ogDesc = document.querySelector('meta[property="og:description"]');
  if(metaDesc) metaDesc.setAttribute('content', CONFIG.tagline || '');
  if(ogTitle) ogTitle.setAttribute('content', CONFIG.siteName || '');
  if(ogDesc) ogDesc.setAttribute('content', CONFIG.tagline || '');
}

/* ---- 阅读进度条 ---- */
function updateProgress(){
  var bar = document.getElementById('progressBar');
  if(!bar) return;
  var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  var scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
  var pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
  bar.style.width = pct + '%';
}

window.addEventListener('scroll', function(){
  updateProgress();
  var btn = document.getElementById('backToTop');
  if(!btn) return;
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
    var rawList = results[1];

    /* 容错：articles.json 不是数组时降级处理 */
    if(!Array.isArray(rawList)){
      rawList = [];
    }

    /* 安全排序：缺失 date 字段时排到末尾 */
    ARTICLE_LIST = rawList.map(function(a){
      return {
        id: a.id || '',
        title: a.title || '（无标题）',
        subtitle: a.subtitle || '',
        date: a.date || '0000-00-00',
        category: a.category || '',
        excerpt: a.excerpt || ''
      };
    }).sort(function(a, b){
      var da = a.date || '';
      var db = b.date || '';
      if(da < db) return 1;
      if(da > db) return -1;
      return 0;
    });

    updateSiteMeta();
    renderFooter();
    window.addEventListener('hashchange', router);
    router();
  }).catch(function(err){
    var app = document.getElementById('app');
    if(app){
      app.innerHTML =
        '<div class="empty-state">站点配置加载失败，请检查 config.json 和 articles.json 是否存在。<br>' +
        '<small style="color:var(--muted)">' + escapeHTML(err && err.message ? err.message : '') + '</small></div>';
    }
  });
}

init();
