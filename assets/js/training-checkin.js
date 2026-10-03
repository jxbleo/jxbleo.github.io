(function (window, document) {
    'use strict';
    var serial = 0, active = null, profileRequest = null;
    function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
    function number(value) { return value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null; }
    function sourceInfo(value, family) {
        var text = String(value || '');
        var bbc = text.match(/(?:BBC[- _]?)?(?:20)?(\d{2})[- _]?(\d{2})[- _]?(\d{2})(?:\D|$)/i);
        var ielts = text.match(/C(\d+)[- _]*T(\d+)[- _]*S(\d+)/i);
        if (family === 'BBC' && bbc) return ['节目期数', bbc[1] + '-' + bbc[2] + '-' + bbc[3]];
        if (ielts) return ['题目编号', 'C' + ielts[1] + '-T' + ielts[2] + '-S' + ielts[3]];
        return null;
    }
    function scoreModel(result, options) {
        options = options || {}; result = result || {};
        var vocab = options.family === '词汇', practice = options.practice === true;
        var correct = number(result.correct_count), total = number(result.question_count);
        var perfect = total > 0 && correct === total;
        var passed = result.passed === true;
        var pct = number(result.display_percentage);
        if (pct === null) pct = number(result.percentage);
        if (pct === null && total > 0 && correct !== null) pct = Math.round(correct / total * 100);
        perfect = perfect && pct === 100;
        var kind = vocab ? '词汇' : '听力';
        var metrics = [['练习类型', vocab ? (practice ? '词汇练习' : '词汇小测') : options.family + '听力']];
        if (vocab && !practice && number(options.groupCount) !== null) metrics.push(['所选组数', options.groupCount + '组']);
        var source = sourceInfo(options.setId, options.family);
        if (!vocab && source) metrics.push(source);
        if (correct !== null && total !== null) metrics.push(['答对题目', correct + ' / ' + total]);
        if (!practice && number(result.attempt_number) !== null) metrics.push(['提交次数', '第 ' + result.attempt_number + ' 次']);
        var earned = passed && !practice && Boolean(result.assignment_id || options.assignmentId) && result.mastery_enabled === true && result.mastered === true && result.mastery_eligible === true;
        return { title: options.title, value: pct === null ? '结果已保存' : pct + '%', text: pct === null,
            tone: passed ? 'green' : 'muted', status: perfect ? kind + '已满分' : passed ? kind + '已过关' : '请继续努力', perfect: perfect,
            decoration: earned ? 'star' : passed ? 'popper' : '', metrics: metrics,
            groups: vocab && practice ? options.selectedGroups : null, profile: options.profile,
            time: result.submitted_at || options.time, onClose: options.onClose };
    }
    // Count required word slots only. Revealed answers are never copied into the numerator.
    function wordProgress(material, progress, localUnits) {
        var filled = 0, required = 0;
        (material && material.units || []).forEach(function (unit) {
            if (unit.practice_mode && unit.practice_mode !== 'dictation') return;
            var server = progress && progress.unit_progress && progress.unit_progress[unit.unit_id] || {};
            var local = localUnits && localUnits[unit.unit_id] || {};
            (unit.slots || []).forEach(function (slot, i) {
                if (slot.spelling_requirement === 'provided') return;
                required += 1;
                var entry = Array.isArray(local.entries) ? local.entries[i] : (server.saved_entries || [])[i];
                var checked = server.correct_positions_reliable !== false && (server.correct_positions || [])[i] === true;
                if (String(entry || '').trim() || checked) filled += 1;
            });
        });
        return { filled: filled, required: required };
    }
    function listeningModel(material, progress, localUnits, options) {
        options = options || {}; progress = progress || {};
        var words = wordProgress(material, progress, localUnits);
        var pct = number(progress.percentage); if (pct === null) pct = number(progress.best_percentage);
        var passed = pct !== null && pct >= (number(options.target) || 100);
        var source = sourceInfo(options.setId, /BBC/i.test(options.setId || '') ? 'BBC' : '雅思');
        return { title: material && material.title, value: pct === null ? '已完成' : pct + '%', text: pct === null,
            tone: passed ? 'green' : 'muted', status: passed ? '精听已过关' : '请继续努力',
            metrics: [['练习类型','精听']].concat(source ? [source] : []).concat([['已填写词数',words.filled + ' / ' + words.required + ' 词']]), time: options.time };
    }
    function beijingTime(value) {
        var date = value ? new Date(value) : new Date();
        if (!Number.isFinite(date.getTime())) date = new Date();
        var parts = new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(date).reduce(function (o,p) { o[p.type]=p.value; return o; }, {});
        return '北京时间 ' + parts.year + '.' + parts.month + '.' + parts.day + ' ' + parts.hour + ':' + parts.minute;
    }
    function getProfile(explicit) {
        if (explicit && (explicit.chinese_name || explicit.english_name || explicit.name)) return Promise.resolve(explicit);
        if (!profileRequest) profileRequest = Promise.resolve().then(function () {
            if (!window.MrCatCloud) return null;
            return window.MrCatCloud.callAuthenticatedFunction('getCurrentStudent').then(function (r) { return r && r.success ? r.student : null; });
        }).catch(function () { profileRequest = null; return null; });
        return profileRequest;
    }
    function nameHtml(profile) {
        profile = profile || {};
        var chinese = String(profile.chinese_name || '').trim(), english = String(profile.english_name || '').trim();
        return chinese || english ? escapeHtml(chinese) + (english ? '<span>' + escapeHtml(english) + '</span>' : '') : escapeHtml(profile.name || '');
    }
    function metricsHtml(model) {
        var rows = model.metrics || [];
        var html = rows.map(function (row, i) { return '<div class="metric' + (!model.groups && rows.length % 2 && i === 0 ? ' is-wide' : '') + '"><dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd></div>'; }).join('');
        if (model.groups) html += '<div class="metric is-wide is-groups"><dt>所选组别</dt><dd class="group-grid">' + Array.from(new Set(model.groups)).sort(function (a,b) { return Number(a)-Number(b); }).map(function (n) { return '<span class="group-cell">' + escapeHtml(n) + '</span>'; }).join('') + '</dd></div>';
        return html;
    }
    function starSvg(prefix) { return STAR_SVG.replace(/star-(gold|light|outline|sheen)/g, prefix + '-$&').replace('class="' + prefix + '-star-sheen"', 'class="star-sheen"'); }
    function renderHtml(model, profile, prefix) {
        var decoration = model.decoration === 'star' ? starSvg(prefix) : model.decoration === 'popper' ? '<span class="celebration-popper" role="img" aria-label="庆祝礼花">🎉</span>' : model.writingCount > 0 ? '<div class="completion-medal">' + writingBadge(model.writingCount).svg(prefix + '-badge') + '</div>' : '';
        var note = model.writingCount > 0 ? '这是你订正完成的第<strong class="achievement-count">' + escapeHtml(model.writingCount) + '</strong>篇作文' : escapeHtml(model.note || '');
        return '<div class="dialog-stack"><article class="checkin-card" data-tone="' + (model.tone === 'muted' ? 'muted' : 'green') + '"><header class="identity"><div class="identity-details"><p class="identity-name">' + nameHtml(profile) + '</p><time class="date-value">' + escapeHtml(beijingTime(model.time)) + '</time></div><span class="checkin-status" data-state="' + (model.perfect ? 'perfect' : 'normal') + '">' + escapeHtml(model.status) + '</span></header><div class="card-rule"></div><section class="result-panel"><header class="result-heading"><h2 class="task-title">' + escapeHtml(model.title || '训练记录') + '</h2></header><div class="result-content"><div class="result-summary"><p class="result-main' + (model.text ? ' is-text' : '') + '">' + escapeHtml(model.value) + '</p>' + (decoration ? '<div class="result-decoration' + (model.writingCount > 0 ? ' is-medal' : '') + '">' + decoration + '</div>' : '') + '</div>' + (note ? '<p class="result-note">' + note + '</p>' : '') + '</div></section><dl class="metrics">' + metricsHtml(model) + '</dl><footer class="card-footer"><div class="card-brand"><img class="brand-mark" src="assets/icons/mrcat-apple-touch-icon.png" width="20" height="20" alt=""><span class="brand-caption">猫先生英语</span><span class="brand-website">www.mrcatenglish.com</span></div></footer></article><button class="close-button" type="button" aria-label="关闭打卡凭证"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>';
    }
    function show(model) {
        var time = model.time || new Date().toISOString(), cleanup;
        return getProfile(model.profile).then(function (profile) {
            if (profile && profile.role === 'teacher') return;
            if (active) active.close();
            var prefix = 'checkin-' + (++serial), focus = document.activeElement;
            var dialog = document.createElement('dialog'); dialog.className = 'mrcat-checkin'; dialog.setAttribute('aria-label', '训练打卡凭证');
            dialog.innerHTML = renderHtml(Object.assign({},model,{time:time}), profile, prefix);
            var top = window.scrollY, bodyStyle = document.body.getAttribute('style');
            document.body.appendChild(dialog);
            document.body.style.position='fixed'; document.body.style.top=-top+'px'; document.body.style.width='100%';
            var title=dialog.querySelector('.task-title'), observer;
            function fit() { title.style.fontSize='20px'; title.style.whiteSpace='nowrap'; var size=20; while(title.scrollWidth>title.clientWidth && size>12) {size-=.5;title.style.fontSize=size+'px';}title.style.whiteSpace='normal'; var value=dialog.querySelector('.result-main:not(.is-text)'); if(value){value.style.fontSize='';var scoreSize=parseFloat(window.getComputedStyle(value).fontSize);while(value.scrollWidth>value.clientWidth && scoreSize>28){scoreSize-=.5;value.style.fontSize=scoreSize+'px';}} }
            function close() { if (!dialog.isConnected) return; if (observer) observer.disconnect(); dialog.close(); dialog.remove(); if (bodyStyle === null) document.body.removeAttribute('style'); else document.body.setAttribute('style',bodyStyle); window.scrollTo(0,top); active=null; if(focus && focus.isConnected) focus.focus({preventScroll:true}); if(typeof model.onClose==='function') model.onClose(); }
            dialog.addEventListener('cancel',function(e){e.preventDefault();});
            cleanup = close;
            dialog.addEventListener('click',function(e){if(e.target.closest('.close-button'))close();});
            dialog.showModal(); fit();
            if(window.ResizeObserver){var width=0;observer=new ResizeObserver(function(entries){if(entries[0].contentRect.width!==width){width=entries[0].contentRect.width;fit();}});observer.observe(title);}
            if(document.fonts)document.fonts.ready.then(function(){if(dialog.isConnected)fit();});
            active={close:close};
            if(typeof model.onShown==='function')model.onShown();
            return { close:close, update:function(patch){
                if(!dialog.isConnected)return;
                var restoreFocus=dialog.contains(document.activeElement);
                Object.assign(model,patch);
                dialog.innerHTML=renderHtml(Object.assign({},model,{time:time}),profile,prefix);
                if(observer)observer.disconnect();
                title=dialog.querySelector('.task-title');fit();
                if(observer)observer.observe(title);
                if(restoreFocus)dialog.querySelector('.close-button').focus({preventScroll:true});
            }};
        }).catch(function () { if(cleanup)cleanup();else if(typeof model.onClose==='function')model.onClose();return null; });
    }
    function writing(composition, options) {
        options = options || {}; composition = composition || {};
        var completed = options.completed === true;
        var model = { title: composition.title, text:true, value:completed?'已完成订正':'等待批改', status:completed?'作文已订正':'作文已上传', profile:options.profile, onShown:options.onShown,
            metrics:[['练习类型','写作'],['作文词数',(number(composition.word_count) === null ? '—' : composition.word_count + ' 词')]].concat(completed ? [] : [['训练阶段','原稿上传']]), time:completed?composition.completed_at:undefined };
        if (!completed) return show(model);
        model.note='成就篇数加载中…';
        return show(model).then(function(receipt){
            if(!receipt)return null;
            var timer=window.setTimeout(function(){receipt.update({note:'成就篇数暂未加载，请稍后重新查看。'});},8000);
            Promise.resolve().then(function(){
                return window.MrCatCloud.callAuthenticatedFunction('writingTutor',{action:'getCheckinSummary',composition_id:composition.composition_id});
            }).then(function(result){
                if(!result || !result.success || !(result.completed_count > 0))throw new Error('CHECKIN_COUNT_UNAVAILABLE');
                if(result.word_count !== undefined)model.metrics[1][1]=result.word_count+' 词';
                receipt.update({writingCount:result.completed_count,note:'',metrics:model.metrics});
            }).catch(function(){receipt.update({note:'成就篇数暂未加载，请稍后重新查看。'});})
                .finally(function(){window.clearTimeout(timer);});
            return receipt;
        });
    }
    function speaking(response, duration) {
        response=response||{};var set=response.set_snapshot||{},question=response.question_snapshot||{};
        var seconds=number(duration);if(seconds===null)seconds=number(response.duration_seconds);
        var metrics=[['练习类型','口语']];
        if(set.exam_year && set.paper_version)metrics.push(['题目来源','Y'+set.exam_year+' Set '+set.paper_version]);
        if(seconds!==null)metrics.push(['录音时长',String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(Math.round(seconds)%60).padStart(2,'0')]);
        metrics.push(['训练阶段','个人回应']);
        return show({title:question.prompt||question.question_text||question.text||response.question_text,value:'录音已提交',text:true,status:'口语已录制',metrics:metrics});
    }
    var STAR_SVG = "<svg class=\"gold-star\" viewBox=\"0 0 100 106\" role=\"img\" aria-label=\"达标获得金星\"><defs><linearGradient id=\"star-gold\" x1=\".1\" y1=\"0\" x2=\".85\" y2=\"1\"><stop stop-color=\"#fff9b7\"/><stop offset=\".23\" stop-color=\"#ffe270\"/><stop offset=\".5\" stop-color=\"#e6a91c\"/><stop offset=\".72\" stop-color=\"#ffc943\"/><stop offset=\"1\" stop-color=\"#b77a13\"/></linearGradient><linearGradient id=\"star-light\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"#fffdea\"/><stop offset=\"1\" stop-color=\"#ffe88a\"/></linearGradient><clipPath id=\"star-outline\"><path d=\"m50 5 13.3 27 29.8 4.3-21.6 21 5.1 29.7L50 73 23.4 87l5.1-29.7-21.6-21L36.7 32Z\"/></clipPath><linearGradient id=\"star-sheen\"><stop stop-color=\"#fff\" stop-opacity=\"0\"/><stop offset=\".5\" stop-color=\"#fffce1\" stop-opacity=\".9\"/><stop offset=\"1\" stop-color=\"#fff\" stop-opacity=\"0\"/></linearGradient></defs><path d=\"m50 5 13.3 27 29.8 4.3-21.6 21 5.1 29.7L50 73 23.4 87l5.1-29.7-21.6-21L36.7 32Z\" fill=\"#be811d\" transform=\"translate(0 5)\" stroke=\"#a66a11\" stroke-width=\"2\" stroke-linejoin=\"round\"/><path d=\"m50 5 13.3 27 29.8 4.3-21.6 21 5.1 29.7L50 73 23.4 87l5.1-29.7-21.6-21L36.7 32Z\" fill=\"url(#star-gold)\" stroke=\"#db9d28\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/><path d=\"M50 5v47L36.7 32ZM6.9 36.3 50 52l-21.5 5.3ZM50 52 76.6 87 50 73Z\" fill=\"url(#star-light)\" opacity=\".78\"/><path d=\"M50 5 63.3 32 50 52ZM50 52l43.1-15.7-21.6 21ZM50 52 23.4 87 50 73Z\" fill=\"#b8800b\" opacity=\".25\"/><path d=\"m39 32 11-23 11 23\" fill=\"none\" stroke=\"#fffbd4\" stroke-width=\"2\" stroke-linecap=\"round\" opacity=\".9\"/><g clip-path=\"url(#star-outline)\"><g class=\"star-sheen\"><path d=\"M-28-10H0L56 110H28Z\" fill=\"url(#star-sheen)\"/></g></g></svg>";
    function writingBadge(count) {
      const tiers = [
        { name: '青铜', light: '#f4c391', mid: '#c78e5c', dark: '#865237', face: '#fff2e1', ink: '#794626', kind: 'bronze' },
        { name: '蓝金', light: '#c6f1ff', mid: '#67bce6', dark: '#356db1', face: '#eafaff', ink: '#205b91', kind: 'blue' },
        { name: '黄金', light: '#fff0aa', mid: '#e4bb4f', dark: '#a27020', face: '#fff8d9', ink: '#865911', kind: 'gold' },
        { name: '紫金', light: '#eddcff', mid: '#b292e2', dark: '#7454ab', face: '#f8f0ff', ink: '#65438d', kind: 'purple' },
        { name: '黑钻', light: '#b8c5d5', mid: '#58677b', dark: '#182231', face: '#222e40', ink: '#f5f8fc', kind: 'black' }
      ];
      const tierIndex = Math.min(tiers.length - 1, Math.floor((count - 1) / 10));
      const tier = tiers[tierIndex];
      const progress = ((Math.min(count, tiers.length * 10) - 1) % 10) + 1;
      const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][progress - 1];
      if (tierIndex > 0) return { ...tier, progress, roman, svg: (prefix) => gemWritingBadge(prefix, tier, roman, progress, count) };
      const point = (r, angle) => [72 + r * Math.cos(angle * Math.PI / 180), 64 + r * Math.sin(angle * Math.PI / 180)];
      const ticks = Array.from({ length: 10 }, (_, i) => {
        const a = point(44, -90 + i * 36 + 5), b = point(44, -90 + i * 36 + 29);
        return '<path d="M' + a.join(' ') + ' A44 44 0 0 1 ' + b.join(' ') + '" fill="none" stroke="' + (tier.kind === 'black' ? tier.light : tier.dark) + '" stroke-opacity="' + (i < progress ? '1' : '.16') + '" stroke-width="4.5" stroke-linecap="round"/>';
      }).join('');
      const svg = (prefix) => {
        const metal = 'url(#' + prefix + '-metal)', face = 'url(#' + prefix + '-face)';
        const metalStops = '<stop stop-color="' + tier.light + '"/><stop offset=".32" stop-color="' + tier.mid + '"/><stop offset=".53" stop-color="' + tier.light + '"/><stop offset="1" stop-color="' + tier.dark + '"/>';
        const faceDefinition = '<radialGradient id="' + prefix + '-face" cx=".38" cy=".3" r=".8"><stop stop-color="' + (tier.kind === 'black' ? '#65758b' : '#fff') + '"/><stop offset="1" stop-color="' + tier.face + '"/></radialGradient>';
        const outer = '<circle cx="72" cy="64" r="54" fill="' + metal + '" stroke="' + tier.dark + '" stroke-width="1.5"/>';
        const gem = '<circle cx="72" cy="64" r="35" fill="' + face + '" stroke="' + tier.mid + '" stroke-width="1.5"/>';
        return '<svg viewBox="0 0 144 160" role="img" aria-label="' + tier.name + '，累计' + count + '篇，本阶段' + progress + '格"><defs><linearGradient id="' + prefix + '-metal" x1="0" y1="0" x2="1" y2="1">' + metalStops + '</linearGradient>' + faceDefinition + '</defs>' + outer + '<circle cx="72" cy="64" r="49" fill="' + tier.face + '" stroke="' + tier.light + '" stroke-width="1.4"/>' + ticks + gem + '<text x="72" y="64" text-anchor="middle" dominant-baseline="central" fill="' + tier.ink + '" font-family="Times New Roman, Georgia, serif" font-size="' + (roman.length >= 4 ? 24 : 32) + '" font-weight="700">' + roman + '</text><path d="M39 27Q56 14 75 16" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="2" stroke-linecap="round"/>' + '</svg>';
      };
      return { ...tier, progress, roman, svg };
    }
    function gemWritingBadge(prefix, tier, roman, progress, count) {
      // The selected gemstone silhouette stays consistent; each stage retains its material palette.
      const palette = {
        blue: { edge: '#648ca7', high: '#effcff', facet: '#c8ebf9', shade: '#5a9abb', low: '#357398', bottom: '#83bdd8', glass: ['#f4fdff', '#c8edfa', '#8ac6e0', '#d9f5ff'], ink: '#285d7c', active: '#346886', idle: '#4a84a640' },
        gold: { edge: '#95702d', high: '#fff8d7', facet: '#f6d983', shade: '#b4862d', low: '#c99d40', bottom: '#ffe9a0', glass: ['#fffbed', '#f9e9b0', '#e3c56f', '#fff0b9'], ink: '#805d20', active: '#825a20', idle: '#805d2040' },
        purple: { edge: '#64507f', high: '#f7eeff', facet: '#d6b9f3', shade: '#7953a1', low: '#9270ba', bottom: '#dfc9fa', glass: ['#fcf7ff', '#e8d5fa', '#bba0d7', '#efe2ff'], ink: '#65438d', active: '#65438d', idle: '#65438d45' },
        black: { edge: '#101925', high: '#d8e4f1', facet: '#8b9eb6', shade: '#152232', low: '#34465d', bottom: '#9eb1c7', glass: ['#7a8ea6', '#42556e', '#202d40', '#536a85'], ink: '#f5f8fc', active: '#e7f4ff', idle: '#d2dfeb50' }
      }[tier.kind];
      const ref = (name) => 'url(#' + prefix + '-' + name + ')';
      const octagon = 'M49 17H95L127 49V95L95 127H49L17 95V49Z';
      const inset = 'M52 25H92L119 52V92L92 119H52L25 92V52Z';
      const defs = `<defs>
        <linearGradient id="${prefix}-gold" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="#fff9df"/><stop offset=".24" stop-color="#bf9653"/><stop offset=".45" stop-color="#fff3cb"/><stop offset=".7" stop-color="#c39b5b"/><stop offset="1" stop-color="#82623a"/></linearGradient>
        <clipPath id="${prefix}-face-clip"><path d="${inset}"/></clipPath>
        <linearGradient id="${prefix}-reflection" x1="0" y1="0" x2=".75" y2="1"><stop stop-color="#fff" stop-opacity=".85"/><stop offset=".48" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <radialGradient id="${prefix}-glint" cx=".3" cy=".2" r=".75"><stop stop-color="#fff" stop-opacity=".8"/><stop offset=".45" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <linearGradient id="${prefix}-blue" x1=".15" y1="0" x2=".85" y2="1"><stop stop-color="${palette.high}"/><stop offset=".4" stop-color="${tier.mid}"/><stop offset="1" stop-color="${tier.dark}"/></linearGradient>
        <linearGradient id="${prefix}-glass" x1=".1" y1="0" x2=".9" y2="1"><stop stop-color="${palette.glass[0]}"/><stop offset=".36" stop-color="${palette.glass[1]}"/><stop offset=".7" stop-color="${palette.glass[2]}"/><stop offset="1" stop-color="${palette.glass[3]}"/></linearGradient>
      </defs>`;
      const numeral = (fill, size = 40) => `<text x="72" y="74" text-anchor="middle" dominant-baseline="central" font-family="Times New Roman, Georgia, serif" font-size="${roman.length >= 4 ? 28 : size}" font-weight="400" fill="${fill}">${roman}</text>`;
      const ticks = (radius, active, idle, width) => Array.from({length:10}, (_,i) => {
        const angle = (-90 + i * 36) * Math.PI / 180;
        return `<path d="M${72 + radius * Math.cos(angle)} ${72 + radius * Math.sin(angle)}L${72 + (radius-5) * Math.cos(angle)} ${72 + (radius-5) * Math.sin(angle)}" stroke="${i < progress ? active : idle}" stroke-width="${width}" stroke-linecap="round"/>`;
      }).join('');
      const body = `<path d="${octagon}" transform="translate(0 3)" fill="${palette.edge}"/>
          <path d="${octagon}" fill="${ref('gold')}" stroke="#ad8d54" stroke-width=".8"/>
          <path d="${inset}" fill="${ref('blue')}" stroke="${palette.high}" stroke-width="1"/>
          <path d="M52 25 59 40H85L92 25ZM25 52 40 59V85L25 92Z" fill="${palette.high}"/>
          <path d="M92 25 119 52 104 59 85 40Z" fill="${palette.facet}"/>
          <path d="M119 52V92L104 85V59Z" fill="${palette.shade}"/>
          <path d="M119 92 92 119 85 104 104 85ZM52 119 25 92 40 85 59 104Z" fill="${palette.low}"/>
          <path d="M52 119H92L85 104H59Z" fill="${palette.bottom}"/>
          <path d="M59 40H85L104 59V85L85 104H59L40 85V59Z" fill="${ref('glass')}" stroke="${palette.high}" stroke-opacity=".85"/>
          <g clip-path="${ref('face-clip')}">
            <path d="M17 34 112 13 132 37 20 78Z" fill="${ref('reflection')}"/>
            <path d="M23 85 122 48 122 54 23 91Z" fill="#fff" opacity=".22"/>
            <path d="${inset}" fill="${ref('glint')}"/>
          </g>
          <path d="M52 25H92L119 52M25 92V52L52 25M59 40H85L104 59" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="1.3"/>
          <path d="M104 85 85 104H59M92 119 119 92" fill="none" stroke="${palette.high}" stroke-opacity=".75" stroke-width="1.1"/>
          ${ticks(53, palette.active, palette.idle, 2)}${numeral(palette.ink)}`;
      return `<svg viewBox="0 0 144 144" role="img" aria-label="${tier.name}，累计${count}篇，本阶段${roman}">${defs}${body}</svg>`;
    }
    var api = {show:show,score:function(result,options){return show(scoreModel(result,options));},listening:function(material,progress,local,options){return show(listeningModel(material,progress,local,options));},writing:writing,speaking:speaking};
    if (typeof module !== 'undefined' && module.exports) module.exports={scoreModel:scoreModel,wordProgress:wordProgress,listeningModel:listeningModel,sourceInfo:sourceInfo,renderHtml:renderHtml,writingBadge:writingBadge,beijingTime:beijingTime};
    if(window)window.MrCatTrainingCheckin=api;
})(typeof window === 'undefined' ? null : window, typeof document === 'undefined' ? null : document);
