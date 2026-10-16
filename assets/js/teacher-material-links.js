(function(root) {
    'use strict';
    const ORIGIN = 'https://www.mrcatenglish.com/';
    const categories = { classroom: '一对一讲义', study: '通用讲义', information: '资讯' };
    function shareURL(path) {
        if (typeof path !== 'string' || !/^[a-z0-9-]+\.html(?:\?[^#]*)?$/.test(path)) throw new Error('资料链接格式无效');
        const url = new URL(path, ORIGIN);
        const allowed = { 'classroom.html': ['course'], 'classroom-lesson.html': ['course', 'lesson', 'view'], 're.html': ['lesson'] };
        for (const key of url.searchParams.keys()) if (!(allowed[url.pathname.slice(1)] || []).includes(key)) throw new Error('资料链接参数无效');
        return url.href;
    }
    function curatedItems(catalog) {
        if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.items)) throw new Error('资料目录格式无效');
        return catalog.items.map(item => {
            if (!categories[item.category] || !item.id || !item.title || !item.access) throw new Error('资料信息不完整');
            return { ...item, links: [{ label: '复制链接', href: shareURL(item.href) }] };
        });
    }
    function privateHandoutItems(catalog) {
        if (!catalog || catalog.success !== true || catalog.schemaVersion !== 1 || !Array.isArray(catalog.items)) throw new Error('独立讲义暂时无法加载');
        const ids = new Set(), links = new Set();
        return catalog.items.map(item => {
            if (!item || item.category !== 'study' || typeof item.href !== 'string' || !/^h-[a-f0-9]{48}\.html$/.test(item.href) || ids.has(item.id) || links.has(item.href)) throw new Error('独立讲义目录格式无效');
            for (const key of ['id', 'title', 'topic', 'description', 'access']) if (typeof item[key] !== 'string' || !item[key].trim()) throw new Error('独立讲义信息不完整');
            ids.add(item.id); links.add(item.href);
            return { id: item.id, category: 'study', title: item.title, topic: item.topic, description: item.description, access: item.access,
                links: [{ label: '复制链接', href: shareURL(item.href) }] };
        });
    }
    async function loadPrivateHandouts(cloud) {
        if (!cloud || typeof cloud.callAuthenticatedFunction !== 'function') throw new Error('请先登录教师账号');
        return privateHandoutItems(await cloud.callAuthenticatedFunction('teacherHandoutLinks', { action: 'list' }));
    }
    function classroomItems(catalog) {
        if (!Array.isArray(catalog.courses)) throw new Error('课程目录格式无效');
        return catalog.courses.flatMap(course => {
            if (!/^course-\d+$/.test(course.id) || !Array.isArray(course.lessons)) throw new Error('课程信息无效');
            const courseQuery = 'course=' + encodeURIComponent(course.id);
            const common = { category: 'classroom', topic: course.studentName, access: '链接持有人可阅读' };
            return [{ ...common, id: course.id, kind: 'course', title: course.studentName, description: '分享课程目录，后续新增课次也会显示在这里。', links: [{ label: '复制课程链接', href: shareURL('classroom.html?' + courseQuery) }] },
                ...course.lessons.slice().sort((a, b) => a.number - b.number).map(lesson => {
                    if (!/^lesson-\d+$/.test(lesson.id)) throw new Error('课次信息无效');
                    const path = 'classroom-lesson.html?' + courseQuery + '&lesson=' + encodeURIComponent(lesson.id);
                    return { ...common, id: course.id + '/' + lesson.id, kind: 'lesson', courseId: course.id, title: '第 ' + lesson.number + ' 次课 · ' + lesson.title, description: lesson.subtitle || '', links: [
                        { label: '复制讲义链接', href: shareURL(path) },
                        { label: '复制课后练习', href: shareURL(path + '&view=practice') }
                    ] };
                })];
        });
    }
    function readingItems(catalog) {
        if (!Array.isArray(catalog.lessons)) throw new Error('精读目录格式无效');
        return catalog.lessons.map(lesson => ({ id: lesson.id, category: 'study', topic: '阅读 · RE', title: 'RE 精读 · ' + lesson.title, description: lesson.label, access: '师生登录后阅读', links: [{ label: '复制链接', href: shareURL('re.html?lesson=' + encodeURIComponent(lesson.id)) }] }));
    }
    function matches(item, category, query) {
        return (!category || item.category === category) && [item.title, item.topic, item.description, item.access].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    }
    function visibleItems(items, category, query, courseId) {
        if (category === 'classroom') {
            if (courseId) return items.filter(item => item.kind === 'lesson' && item.courseId === courseId && matches(item, category, query));
            return items.filter(item => item.kind === 'course' && (matches(item, category, query) || items.some(lesson => lesson.courseId === item.id && matches(lesson, category, query))));
        }
        return items.filter(item => matches(item, category, query));
    }
    if (typeof module !== 'undefined' && module.exports) { module.exports = { shareURL, curatedItems, privateHandoutItems, loadPrivateHandouts, classroomItems, readingItems, matches, visibleItems }; return; }
    const trigger = document.getElementById('teacher-material-links-button');
    if (!trigger) return;
    let items = [], loading = false, loaded = false, selected = 'classroom', selectedCourseId = '', parentSearch = '', copySequence = 0;
    const dialog = document.createElement('dialog');
    dialog.id = 'teacher-material-links-dialog';
    dialog.className = 'material-links-dialog';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'material-links-title');
    dialog.innerHTML = '<header class="material-links-head"><div><p>SHARE & LEARN</p><h2 id="material-links-title">资料链接</h2></div><button type="button" data-links-close aria-label="关闭资料链接">关闭</button></header>' +
        '<div class="material-links-controls"><input type="search" aria-label="搜索资料" placeholder="搜索学生、课程或资料关键词…"><nav aria-label="资料分类"></nav></div>' +
        '<div class="material-links-meta"><p data-links-count></p><button type="button" data-links-retry hidden>重新加载</button></div>' +
        '<p class="material-links-status" role="status" aria-live="polite"></p><div class="material-links-list"></div>' +
        '<div class="material-links-manual" hidden><label>可选择并手动复制链接<input type="text" readonly aria-label="待复制链接"></label></div>';
    (document.getElementById('teacher-modal-root') || document.body).append(dialog);
    const list = dialog.querySelector('.material-links-list'), status = dialog.querySelector('[role="status"]'), search = dialog.querySelector('input[type="search"]'), nav = dialog.querySelector('nav'), count = dialog.querySelector('[data-links-count]'), retry = dialog.querySelector('[data-links-retry]'), manual = dialog.querySelector('.material-links-manual');
    function element(tag, className, text) { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
    Object.entries(categories).forEach(([key, label]) => {
        const button = element('button', '', label); button.type = 'button'; button.dataset.category = key; button.setAttribute('aria-pressed', String(key === selected));
        button.onclick = () => { selected = key; selectedCourseId = ''; search.value = ''; search.placeholder = '搜索学生、课程或资料关键词…'; clearCopyFeedback(); nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); render(); }; nav.append(button);
    });
    function clearCopyFeedback() {
        copySequence++; manual.hidden = true;
        if (/^(已复制|浏览器未允许)/.test(status.textContent)) status.textContent = '';
    }
    function actionsFor(item) {
        const actions = element('div', 'material-link-actions', '');
        const open = element('a', '', item.kind === 'course' ? '打开课程目录 ↗' : '打开 ↗');
        open.href = item.links[0].href; open.target = '_blank'; open.rel = 'noopener noreferrer';
        open.setAttribute('aria-label', '打开：' + item.title); actions.append(open);
        for (const link of item.links) {
            const button = element('button', '', link.label); button.type = 'button';
            const title = item.kind === 'lesson' ? item.topic + ' · ' + item.title : item.title;
            button.setAttribute('aria-label', link.label + '：' + title);
            button.onclick = () => copyLink(link.href, title, button, link.label); actions.append(button);
        }
        return actions;
    }
    function render() {
        list.replaceChildren();
        const course = selected === 'classroom' && items.find(item => item.kind === 'course' && item.id === selectedCourseId);
        const shown = visibleItems(items, selected, search.value, course ? course.id : '');
        count.textContent = loading ? '正在加载资料…' : '共 ' + shown.length + (selected === 'classroom' ? (course ? ' 次课' : ' 位学生') : ' 份资料');
        if (course) {
            const header = element('div', 'material-course-head', '');
            const back = element('button', 'material-course-back', '← 返回学生列表'); back.type = 'button';
            back.onclick = () => {
                selectedCourseId = ''; search.value = parentSearch; search.placeholder = '搜索学生、课程或资料关键词…'; clearCopyFeedback(); render();
                const card = Array.from(list.querySelectorAll('[data-course-id]')).find(node => node.dataset.courseId === course.id);
                if (card) card.focus(); else search.focus();
            };
            const name = element('h3', '', course.title); name.tabIndex = -1;
            header.append(back, name, actionsFor(course)); list.append(header);
        }
        for (const item of shown) {
            if (item.kind === 'course') {
                const lessons = items.filter(lesson => lesson.courseId === item.id);
                const card = element('button', 'material-student-card', ''); card.type = 'button'; card.dataset.courseId = item.id;
                card.setAttribute('aria-label', '查看课次：' + item.title);
                const summary = element('span', 'material-student-summary', '');
                summary.append(element('strong', '', item.title), element('span', '', lessons.length + ' 次课'));
                card.append(summary, element('span', 'material-student-arrow', '查看课次 →'));
                card.onclick = () => {
                    parentSearch = search.value; selectedCourseId = item.id; search.value = ''; search.placeholder = '搜索这位学生的课次或内容…'; clearCopyFeedback(); render();
                    list.querySelector('.material-course-head h3').focus(); dialog.scrollTop = 0;
                };
                list.append(card); continue;
            }
            const row = element('article', 'material-link-row', '');
            const info = element('div', 'material-link-info', '');
            if (!course) info.append(element('span', 'material-link-topic', item.topic || categories[selected]));
            info.append(element('h4', '', item.title), element('p', '', item.description || ''), element('span', 'material-link-access', item.access));
            row.append(info, actionsFor(item)); list.append(row);
        }
        if (!shown.length && !loading) list.append(element('p', 'material-links-empty', loaded ? (course && !search.value ? '这位学生还没有已收录的课次。' : '没有找到匹配的内容，试试其他关键词。') : '暂时无法加载资料，请重试。'));
    }
    async function copyLink(url, title, button, label) {
        const request = ++copySequence; manual.hidden = true;
        try {
            await navigator.clipboard.writeText(url);
            if (request !== copySequence || !dialog.open) return;
            dialog.querySelectorAll('[data-copied-label]').forEach(b => { b.textContent = b.dataset.copiedLabel; delete b.dataset.copiedLabel; });
            button.dataset.copiedLabel = label; button.textContent = '已复制 ✓'; status.textContent = '已复制：' + title;
        } catch (_) {
            if (request !== copySequence || !dialog.open) return;
            manual.hidden = false; const field = manual.querySelector('input'); field.value = url; field.focus(); field.select();
            status.textContent = '浏览器未允许自动复制，请复制下方已选中的链接。';
        }
    }
    async function load() {
        if (loading) return; loading = true; retry.hidden = true; status.textContent = ''; render();
        const sources = [['content/share-materials.json', curatedItems, '通用讲义与资讯'], ['content/classroom/catalog.json', classroomItems, '一对一课程'], ['content/reading-explorer/catalog.json', readingItems, 'RE 精读'], [null, () => loadPrivateHandouts(root.MrCatCloud), '独立讲义']];
        const results = await Promise.allSettled(sources.map(async ([url, build]) => {
            if (!url) {
                let timer;
                try { return await Promise.race([build(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('加载超时')), 15000); })]); }
                finally { clearTimeout(timer); }
            }
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
            try { const response = await fetch(url, { cache: 'no-cache', signal: controller.signal }); if (!response.ok) throw new Error('加载失败'); return build(await response.json()); } finally { clearTimeout(timer); }
        }));
        items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
        const missing = results.flatMap((result, i) => result.status === 'rejected' ? [sources[i][2]] : []);
        loading = false; loaded = !missing.length; retry.hidden = loaded;
        if (missing.length) status.textContent = missing.join('、') + '暂时未加载，请重试。';
        render();
    }
    trigger.onclick = () => { dialog.hidden = false; dialog.showModal(); trigger.setAttribute('aria-expanded', 'true'); search.focus(); if (!loaded) load(); };
    dialog.querySelector('[data-links-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { copySequence++; dialog.hidden = true; manual.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus({ preventScroll: true }); });
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
    search.addEventListener('input', () => { clearCopyFeedback(); render(); }); retry.onclick = load;
})(typeof window === 'undefined' ? globalThis : window);
