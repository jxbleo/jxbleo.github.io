(function(window, document) {
    'use strict';
    var root = document.getElementById('view-ai-usage');
    if (!root) return;
    var state = { rows: [], ids: new Set(), cursor: null, complete: false, loading: false, error: '', scanned: 0, asOf: '', pricing: null, generation: 0, visible: 30, lastLoaded: 0 };
    var $ = function(id) { return document.getElementById('ai-usage-' + id); };
    var labels = { language_review: 'Writing review', standardized_review: 'Exam writing review', rewrite_check: 'Sentence check', ocr_transcription: 'Writing OCR', ocr_uncertainty_location: 'OCR location check', revision_ocr: 'Revision OCR', individual_analysis: 'Individual speaking', dse_analysis: 'Group speaking', dse_analysis_overview: 'Group speaking overview', dse_analysis_turn_reviews: 'Group speaking turn reviews', individual_transcription: 'Speech transcription', transcription: 'Group transcription', vocabulary_page_ocr: 'Scan Words', review: 'Writing review', rewrite: 'Sentence check', ocr: 'Writing OCR' };
    var statusLabels = { completed: 'Completed', failed: 'Failed', quota_exhausted: 'Free quota exhausted', pending: 'In progress', unknown: 'Unknown' };
    var errorLabels = { SPEAKING_AI_TIMEOUT: 'Timed out', SPEAKING_AI_TRANSPORT_ERROR: 'Network transport error', SPEAKING_AI_RATE_LIMITED: 'Rate limited', SPEAKING_AI_PROVIDER_UNAVAILABLE: 'Provider unavailable', SPEAKING_AI_SCHEMA_INVALID: 'Invalid report JSON', SPEAKING_AI_INVALID_RESPONSE: 'Invalid provider response', SPEAKING_PROVIDER_NOT_CONFIGURED: 'Provider configuration error', SPEAKING_AI_FREE_QUOTA_EXHAUSTED: 'Free quota switch', WRITING_AI_TIMEOUT: 'Timed out', WRITING_AI_UNAVAILABLE: 'Network transport error', WRITING_AI_RATE_LIMITED: 'Rate limited', WRITING_AI_PROVIDER_UNAVAILABLE: 'Provider unavailable', WRITING_AI_SCHEMA_RESPONSE_INVALID: 'Invalid report JSON', WRITING_AI_EMPTY_RESPONSE: 'Empty provider response', WRITING_AI_NOT_CONFIGURED: 'Provider configuration error', WRITING_AI_FREE_QUOTA_EXHAUSTED: 'Free quota switch' };
    function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function number(value) { return typeof value === 'number' ? value.toLocaleString('en-US') : '—'; }
    function money(value, digits) { return typeof value === 'number' ? '¥' + value.toFixed(digits == null ? 2 : digits) : '—'; }
    function time(value) { return value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Shanghai', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : 'Unknown time'; }
    function day(value) { return new Date(new Date(value).getTime() + 28800000).toISOString().slice(0, 10); }
    function dateStart(period) {
        if (period === 'all') return '';
        var today = day(state.asOf || new Date().toISOString());
        var start = new Date(today + 'T00:00:00+08:00');
        start.setTime(start.getTime() - (period === 'today' ? 0 : Number(period) - 1) * 86400000);
        return day(start);
    }
    function filteredRows() {
        var query = $('search').value.trim().toLowerCase();
        var start = dateStart($('period').value);
        var module = $('module').value, model = $('model').value, status = $('status').value, student = $('student').value;
        return state.rows.filter(function(row) {
            var people = row.students || [];
            return (!start || row.occurred_at && day(row.occurred_at) >= start)
                && (!module || row.module === module) && (!model || row.model === model)
                && (!status || (status === 'missing' ? row.usage_status === 'missing' : row.status === status))
                && (!student || people.some(function(person) { return person.key === student; }))
                && (!query || [people.map(function(person) { return person.name + ' ' + person.login_id; }).join(' '), row.model, labels[row.stage] || row.stage].join(' ').toLowerCase().indexOf(query) !== -1);
        }).sort(function(a, b) { return String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')) || a.id.localeCompare(b.id); });
    }
    function totals(rows) {
        var out = { calls: 0, tasks: 0, input: 0, output: 0, cached: 0, cost: 0, priced: 0, missing: 0, unpriced: 0, failures: 0, max: 0, plus: 0, comparisons: 0 };
        rows.forEach(function(row) {
            if (row.call_count == null) out.tasks += 1; else out.calls += row.call_count;
            out.input += row.input_tokens || 0; out.output += row.output_tokens || 0; out.cached += row.cached_input_tokens || 0;
            if (row.estimated_cny != null) { out.cost += row.estimated_cny; out.priced += 1; }
            else if (row.kind !== 'speech_call') out.unpriced += 1;
            if (row.usage_status === 'missing') out.missing += 1;
            if (row.status === 'failed' || row.status === 'quota_exhausted') out.failures += 1;
            if (row.comparison_max_cny != null) { out.max += row.comparison_max_cny; out.plus += row.comparison_plus_cny; out.comparisons += 1; }
        });
        return out;
    }
    function options(id, items, placeholder) {
        var el = $(id), selected = el.value;
        el.innerHTML = '<option value="">' + placeholder + '</option>' + items.map(function(item) { return '<option value="' + escape(item.key) + '">' + escape(item.label) + '</option>'; }).join('');
        if (items.some(function(item) { return item.key === selected; })) el.value = selected;
    }
    function updateOptions() {
        var people = new Map(), models = new Set();
        state.rows.forEach(function(row) {
            if (row.model) models.add(row.model);
            (row.students || []).forEach(function(person) { people.set(person.key, { key: person.key, label: person.name + (person.login_id ? ' · ' + person.login_id : '') }); });
        });
        options('student', Array.from(people.values()).sort(function(a, b) { return a.label.localeCompare(b.label); }), 'All accounts');
        options('model', Array.from(models).sort().map(function(model) { return { key: model, label: model }; }), 'All models');
    }
    function rowHtml(row) {
        var people = row.students || [];
        var person = people.length ? people.map(function(p) { return '<strong>' + escape(p.name) + '</strong><small>' + escape([p.login_id, p.role === 'teacher' ? 'Teacher' : '', p.deleted ? 'Deleted account' : ''].filter(Boolean).join(' · ')) + '</small>'; }).join('') : '<strong>Historical record</strong><small>Account unavailable</small>';
        var detail = row.group ? 'Group · created by this account' : row.exam_family === 'ielts' ? 'IELTS Speaking' : row.module === 'speaking' ? 'HKDSE Speaking' : '';
        if (row.kind === 'task_summary') detail = 'Task total · ' + number(row.call_count) + ' calls';
        if (row.kind === 'legacy_task') detail = 'Legacy task · call count unavailable';
        var usage = row.usage_status === 'missing' ? 'Usage unavailable' : row.usage_status === 'nonbillable' ? 'No billable usage' : row.kind === 'speech_call' ? 'Audio service · not Token-billed' : row.cached_input_tokens ? number(row.cached_input_tokens) + ' cached input' : '';
        var statusParts = [];
        if (errorLabels[row.error_code]) statusParts.push(errorLabels[row.error_code]);
        if (row.status === 'failed' && row.finish_reason === 'length') statusParts = ['Output truncated'];
        if (row.status === 'failed' && row.http_status) statusParts.push('HTTP ' + row.http_status);
        if (row.status === 'failed' && row.provider_code) statusParts.push(row.provider_code);
        var statusDetail = statusParts.join(' · ');
        return '<tr><td data-label="Time"><time>' + escape(time(row.occurred_at)) + '</time></td>' +
            '<td data-label="Account">' + person + '</td><td data-label="Activity"><strong>' + escape(labels[row.stage] || row.stage || 'AI task') + '</strong><small>' + escape(detail) + '</small></td>' +
            '<td data-label="Model"><span class="ai-usage-model">' + escape(row.model || 'Not recorded') + '</span></td>' +
            '<td data-label="Input" class="ai-usage-number">' + number(row.input_tokens) + '</td><td data-label="Output" class="ai-usage-number">' + number(row.output_tokens) + '</td>' +
            '<td data-label="Total" class="ai-usage-number"><strong>' + number(row.total_tokens) + '</strong><small>' + escape(usage) + '</small></td>' +
            '<td data-label="Est. CNY" class="ai-usage-number">' + money(row.estimated_cny, 4) + '</td>' +
            '<td data-label="Status"><span class="ai-usage-status is-' + escape(row.status) + '">' + escape(statusLabels[row.status] || 'Unknown') + '</span><small>' + escape(statusDetail) + '</small></td></tr>';
    }
    function render() {
        var rows = filteredRows(), total = totals(rows), prefix = state.complete ? '' : 'Partial · ';
        $('calls').textContent = number(total.calls);
        $('calls-note').textContent = prefix + 'Recorded requests' + (total.tasks ? ' · ' + total.tasks + ' legacy tasks excluded' : '');
        $('tokens').textContent = number(total.input + total.output);
        $('tokens-note').textContent = prefix + number(total.input) + ' in / ' + number(total.output) + ' out';
        $('cost').textContent = total.priced ? money(total.cost) : '—';
        $('cost-note').textContent = prefix + (total.unpriced ? total.unpriced + ' entries unpriced' : 'Recorded usage only');
        $('attention').textContent = number(total.missing);
        $('attention-note').textContent = prefix + 'Entries without Token data';
        $('comparison').hidden = !total.comparisons;
        $('comparison').textContent = prefix + 'Same text usage: Max ' + money(total.max) + ' · Plus ' + money(total.plus) + ' before cache discounts. Excludes OCR and speech services.';
        $('body').innerHTML = rows.slice(0, state.visible).map(rowHtml).join('');
        $('empty').hidden = rows.length > 0;
        $('empty').textContent = state.loading ? 'Reading usage history…' : state.error ? 'Usage history could not be fully loaded.' : 'No AI usage matches these filters.';
        $('more').hidden = rows.length <= state.visible;
        $('count').textContent = Math.min(rows.length, state.visible) + ' of ' + rows.length + ' entries' + (state.complete ? '' : ' loaded so far');
        $('refresh').disabled = state.loading;
        $('retry').hidden = !state.error;
        $('progress').textContent = state.error || (state.loading ? 'Loading history · ' + number(state.scanned) + ' records checked…' : state.complete ? 'Updated ' + time(state.asOf) + ' · Shanghai time' : 'History loading paused. Open AI Usage to continue.');
        $('progress').classList.toggle('is-error', Boolean(state.error));
        $('list').setAttribute('aria-busy', String(state.loading));
        if (state.pricing) $('pricing-date').textContent = state.pricing.checked_at;
    }
    async function load(force) {
        if (state.loading) return;
        if (!force && state.complete && Date.now() - state.lastLoaded < 60000) { render(); return; }
        if (force || state.complete) {
            state.rows = []; state.ids = new Set(); state.cursor = null; state.complete = false; state.scanned = 0; state.asOf = ''; state.visible = 30;
        }
        state.error = ''; state.loading = true;
        var generation = ++state.generation;
        render();
        try {
            do {
                var result = await window.MrCatCloud.callAuthenticatedFunction('teacherAdmin', { action: 'listAiUsage', cursor: state.cursor });
                if (generation !== state.generation) return;
                if (!result || !result.success) {
                    var unavailable = result && result.code === 'UNKNOWN_ACTION';
                    throw new Error(unavailable ? 'AI Usage needs the updated teacher service. Please try again after deployment.' : result && result.message || 'Unable to load AI usage. Please retry.');
                }
                (result.rows || []).forEach(function(row) { if (!state.ids.has(row.id)) { state.ids.add(row.id); state.rows.push(row); } });
                state.cursor = result.next_cursor; state.complete = result.complete === true;
                state.asOf = result.as_of; state.pricing = result.pricing; state.scanned += result.scanned_count || 0;
                if (!state.complete && !state.cursor) throw new Error('Usage history is incomplete. Please refresh.');
                updateOptions(); render();
            } while (!state.complete && !root.hidden && !document.hidden);
            if (state.complete) state.lastLoaded = Date.now();
        } catch (error) {
            if (generation === state.generation) state.error = error.message || 'Unable to load AI usage.';
        } finally {
            if (generation === state.generation) { state.loading = false; render(); }
        }
    }
    function dispose() {
        state.generation += 1; state.rows = []; state.ids.clear(); state.cursor = null; state.complete = false; state.loading = false; state.scanned = 0; state.lastLoaded = 0;
        state.error = ''; state.asOf = ''; state.pricing = null; state.visible = 30;
        $('search').value = ''; $('period').value = '30'; $('module').value = ''; $('status').value = '';
        updateOptions(); render();
    }
    ['period', 'module', 'model', 'status', 'student'].forEach(function(id) { $(id).addEventListener('change', function() { state.visible = 30; render(); }); });
    $('search').addEventListener('input', function() { state.visible = 30; render(); });
    $('refresh').addEventListener('click', function() { load(true); });
    $('retry').addEventListener('click', function() { load(false); });
    $('more').addEventListener('click', function() { state.visible += 30; render(); });
    document.addEventListener('visibilitychange', function() { if (!document.hidden && !root.hidden) load(false); });
    window.addEventListener('pagehide', dispose);
    window.addEventListener('pageshow', function(event) { if (event.persisted && !root.hidden) load(false); });
    window.MrCatTeacherAiUsage = { load: load, dispose: dispose };
})(window, document);
