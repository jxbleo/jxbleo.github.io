(function(window, document) {
    'use strict';

    var state = {
        session: null,
        items: [],
        view: 'word-list',
        search: '',
        searchOpen: false,
        sort: 'recent',
        selectedId: '',
        density: 'double',
        densityMenuOpen: false,
        exportOpen: false,
        exportRange: 'all',
        exportSelected: {},
        editingId: '',
        noteEditingId: '',
        mobileDetailOpen: false,
        detailOpener: null,
        lockedScrollY: 0
    };

    var addTrigger = document.getElementById('my-words-add-trigger');
    var addPanel = document.getElementById('my-words-add-panel');
    var addForm = document.getElementById('my-words-add-form');
    var addInput = document.getElementById('my-words-add-input');
    var addSubmit = document.getElementById('my-words-add-submit');
    var addStatus = document.getElementById('my-words-add-status');
    var feedback = document.getElementById('my-words-feedback');
    var recentList = document.getElementById('my-words-recent-list');
    var indexList = document.getElementById('my-words-index-list');
    var desktopDetail = document.getElementById('my-words-desktop-detail');
    var mobileOverlay = document.getElementById('my-words-mobile-detail-overlay');
    var mobileDetail = document.getElementById('my-words-mobile-detail');
    var mobileClose = document.getElementById('my-words-mobile-detail-close');
    var searchInput = document.getElementById('my-words-search');
    var searchTrigger = document.getElementById('my-words-search-trigger');
    var sortSelect = document.getElementById('my-words-sort');
    var densityTrigger = document.getElementById('my-words-density-trigger');
    var densityMenu = document.getElementById('my-words-density-menu');
    var exportTrigger = document.getElementById('my-words-export-trigger');
    var exportPanel = document.getElementById('my-words-export-panel');
    var titleResizeObserver = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function isMobileLayout() {
        return window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
    }

    function activeItems() {
        return (state.items || []).filter(function(item) {
            return item && (item.status || 'active') === 'active';
        });
    }

    function activityTime(word) {
        return new Date(word && (word.activity_updated_at || word.updated_at || word.last_added_at || word.created_at) || 0).getTime();
    }

    function sortedItems(items) {
        var output = (items || []).slice();
        if (state.sort === 'az') {
            return output.sort(function(left, right) {
                return String(left.text || '').localeCompare(String(right.text || ''), 'en', { sensitivity: 'base' });
            });
        }
        if (state.sort === 'za') {
            return output.sort(function(left, right) {
                return String(right.text || '').localeCompare(String(left.text || ''), 'en', { sensitivity: 'base' });
            });
        }
        return output.sort(function(left, right) { return activityTime(right) - activityTime(left); });
    }

    function filteredItems() {
        var query = String(state.search || '').trim().toLowerCase();
        return sortedItems(activeItems().filter(function(word) {
            if (!query) return true;
            var dictionary = word.dictionary || {};
            return [
                word.text,
                word.normalized_text,
                word.source_title,
                word.source_set_id,
                word.context,
                word.personal_note,
                dictionary.chinese_meaning,
                dictionary.english_definition,
                dictionary.part_of_speech
            ].join(' ').toLowerCase().indexOf(query) !== -1;
        }));
    }

    function vocabWord(vocabId) {
        return activeItems().find(function(item) { return item.vocab_id === vocabId; }) || null;
    }

    function formatShortDate(value) {
        var date = value ? new Date(value) : null;
        if (!date || Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }).format(date);
    }

    function shanghaiCalendarParts(value) {
        var parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
        }).formatToParts(value instanceof Date ? value : new Date(value));
        var output = {};
        parts.forEach(function(part) { if (part.type !== 'literal') output[part.type] = part.value; });
        return output;
    }

    function wordMatchesRange(word, range) {
        if (!range || range === 'all') return true;
        var source = word && (word.activity_updated_at || word.last_added_at || word.created_at);
        var date = source ? new Date(source) : null;
        if (!date || Number.isNaN(date.getTime())) return false;
        var now = shanghaiCalendarParts(new Date());
        var item = shanghaiCalendarParts(date);
        if (range === 'year') return item.year === now.year;
        if (range === 'month') return item.year === now.year && item.month === now.month;
        if (range === 'week') {
            var weekdayIndex = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
            var todayUtc = Date.UTC(Number(now.year), Number(now.month) - 1, Number(now.day));
            var startUtc = todayUtc - (weekdayIndex[now.weekday] || 0) * 86400000;
            var itemUtc = Date.UTC(Number(item.year), Number(item.month) - 1, Number(item.day));
            return itemUtc >= startUtc && itemUtc <= todayUtc;
        }
        return true;
    }

    function wordChineseMeaning(dictionary) {
        var meaning = String(dictionary && dictionary.chinese_meaning || '').trim();
        if (!meaning) return '暂无中文释义';
        var partOfSpeech = String(dictionary && dictionary.part_of_speech || '').trim();
        if (partOfSpeech) {
            var escapedPart = partOfSpeech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            meaning = meaning.replace(new RegExp('^\\s*' + escapedPart + '\\s*[.:：、，,;；\\-]?\\s*', 'i'), '');
        }
        meaning = meaning.replace(/(^|[;；、]\s*)(?:(?:n(?:oun)?|v(?:erb)?|vt|vi|adj(?:ective)?|adv(?:erb)?|prep(?:osition)?|pron(?:oun)?|conj(?:unction)?|det(?:erminer)?|aux(?:iliary)?|modal|num(?:eral)?|art(?:icle)|int(?:erjection)?)\.?\s*(?:[/,&+]\s*)?)+(?=[\u3400-\u9fff])/gi, '$1');
        meaning = meaning.replace(/^\s*[.:：、，,;；\-]+\s*/, '').trim();
        return meaning || '暂无中文释义';
    }

    function callStudentVocabulary(payload) {
        return window.MrCatCloud.callFunction('studentVocabulary', payload).then(function(result) {
            if (!result || !result.success) {
                var error = new Error(result && result.message || 'Unable to update My Words.');
                error.result = result;
                throw error;
            }
            return result;
        });
    }

    function upsertItem(word) {
        if (!word || !word.vocab_id) return;
        state.items = activeItems().filter(function(item) { return item.vocab_id !== word.vocab_id; });
        state.items.unshift(word);
    }

    function replaceItem(oldId, word) {
        state.items = activeItems().filter(function(item) {
            return item.vocab_id !== oldId && (!word || item.vocab_id !== word.vocab_id);
        });
        if (word) state.items.unshift(word);
        if (state.selectedId === oldId) state.selectedId = word && word.vocab_id || '';
        if (oldId !== (word && word.vocab_id)) delete state.exportSelected[oldId];
    }

    function reloadWords() {
        setFeedback('Refreshing My Words...');
        return callStudentVocabulary({ action: 'list', status: 'active', limit: 200 }).then(function(result) {
            state.items = result.words || [];
            if (!vocabWord(state.selectedId)) state.selectedId = sortedItems(activeItems())[0] && sortedItems(activeItems())[0].vocab_id || '';
            renderAll();
            enrichPendingItems(state.items);
            setFeedback('');
            return state.items;
        }).catch(function(error) {
            setFeedback(error.message || 'Unable to load My Words.');
            throw error;
        });
    }

    function setFeedback(message) {
        if (feedback) feedback.textContent = message || '';
    }

    function setSearchOpen(open) {
        state.searchOpen = Boolean(open);
        var toolbar = searchTrigger && searchTrigger.closest('.my-words-list-toolbar');
        if (toolbar) toolbar.classList.toggle('search-open', state.searchOpen);
        if (searchTrigger) searchTrigger.setAttribute('aria-expanded', state.searchOpen ? 'true' : 'false');
        if (state.searchOpen && searchInput) window.setTimeout(function() { searchInput.focus(); }, 0);
    }

    function normalizedDensity(value) {
        return ['single', 'double', 'triple'].indexOf(value) !== -1 ? value : 'double';
    }

    function syncDensityControls() {
        document.querySelectorAll('[data-my-words-density]').forEach(function(button) {
            button.setAttribute('aria-pressed', button.dataset.myWordsDensity === state.density ? 'true' : 'false');
        });
        if (densityTrigger) {
            var labels = { single: 'one column', double: 'two columns', triple: 'three columns' };
            densityTrigger.setAttribute('aria-label', 'Choose list layout, currently ' + labels[state.density]);
        }
    }

    function setDensityMenuOpen(open) {
        state.densityMenuOpen = Boolean(open);
        if (!densityMenu || !densityTrigger) return;
        densityMenu.classList.toggle('open', state.densityMenuOpen);
        densityMenu.setAttribute('aria-hidden', state.densityMenuOpen ? 'false' : 'true');
        densityTrigger.setAttribute('aria-expanded', state.densityMenuOpen ? 'true' : 'false');
        if (state.densityMenuOpen) densityMenu.removeAttribute('inert');
        else densityMenu.setAttribute('inert', '');
    }

    function setDensity(value) {
        state.density = normalizedDensity(value);
        try { window.localStorage.setItem('mrcat_my_words_density', state.density); } catch (error) {}
        syncDensityControls();
        indexList.classList.toggle('is-single', state.density === 'single');
        indexList.classList.toggle('is-triple', state.density === 'triple');
        scheduleTitleOverflow();
    }

    function dictionaryPrimary(word) {
        var dictionary = word && word.dictionary;
        if (!dictionary) return word && word.lookup_status === 'not_found' ? 'Definition not found' : 'Finding definition...';
        return [dictionary.part_of_speech, wordChineseMeaning(dictionary)].filter(Boolean).join(' · ');
    }

    function titleWindowHtml(word) {
        return '<span class="my-words-title-window"><span class="my-words-title-track">' + escapeHtml(word.text || '') + '</span></span>';
    }

    function indexEntryHtml(word) {
        var selected = word.vocab_id === state.selectedId;
        return '<div class="my-words-index-entry">' +
            (state.exportOpen ? '<label class="my-words-export-select" aria-label="Select ' + escapeHtml(word.text || 'word') + ' for export"><input type="checkbox" data-select-word="' + escapeHtml(word.vocab_id) + '"' + (state.exportSelected[word.vocab_id] ? ' checked' : '') + '><span></span></label>' : '') +
            '<button class="my-words-index-card" type="button" data-open-word="' + escapeHtml(word.vocab_id) + '" aria-selected="' + (selected ? 'true' : 'false') + '">' +
                titleWindowHtml(word) + '<small>' + escapeHtml(dictionaryPrimary(word)) + '</small>' +
            '</button></div>';
    }

    function renderIndex() {
        var words = filteredItems();
        if (!indexList) return;
        if (!words.length) {
            indexList.innerHTML = '<div class="my-words-empty-state"><div><p>' + (state.search ? 'No saved words match this search.' : 'Your saved words will appear here.') + '</p>' + (!state.search ? '<button class="primary-button" type="button" data-open-add>Add your first word</button>' : '') + '</div></div>';
            renderDesktopDetail();
            return;
        }
        if (!words.some(function(word) { return word.vocab_id === state.selectedId; })) state.selectedId = words[0].vocab_id;
        indexList.innerHTML = words.map(indexEntryHtml).join('');
        indexList.classList.toggle('is-single', state.density === 'single');
        indexList.classList.toggle('is-triple', state.density === 'triple');
        scheduleTitleOverflow();
    }

    function renderRecent() {
        var words = sortedItems(activeItems()).slice(0, 3);
        if (!recentList) return;
        if (!words.length) {
            recentList.innerHTML = '<div class="my-words-empty-state"><div><p>Select a word or short phrase on a learning page, or add one here.</p><button class="primary-button" type="button" data-open-add>Add your first word</button></div></div>';
            return;
        }
        recentList.innerHTML = words.map(function(word) {
            var dictionary = word.dictionary || {};
            return '<button class="my-words-recent-card" type="button" data-open-recent-word="' + escapeHtml(word.vocab_id) + '">' +
                '<span><strong>' + escapeHtml(word.text || '') + '</strong><small>' + escapeHtml(dictionary.phonetic || 'Pronunciation pending') + '</small></span>' +
                '<span class="my-words-recent-divider" aria-hidden="true"></span>' +
                '<span><strong>' + escapeHtml(dictionary.part_of_speech || '—') + '</strong><small>' + escapeHtml(wordChineseMeaning(dictionary)) + '</small></span>' +
                '<span class="my-words-recent-arrow" aria-hidden="true">›</span>' +
            '</button>';
        }).join('');
    }

    function renderStats() {
        var words = activeItems();
        var weekCount = words.filter(function(word) { return wordMatchesRange(word, 'week'); }).length;
        ['my-words-total', 'my-words-sidebar-total'].forEach(function(id) {
            var element = document.getElementById(id);
            if (element) element.textContent = String(words.length);
        });
        var week = document.getElementById('my-words-week-total');
        if (week) week.textContent = String(weekCount);
    }

    function wordSourceLabel(word) {
        return word.source_title || word.source_set_id || word.source_path || 'Saved from Mr. Cat Academy';
    }

    function wordSpeechButtonHtml(spokenWord) {
        return '<button class="my-word-speak" type="button" data-speak-word="' + escapeHtml(spokenWord) + '" aria-label="Pronounce ' + escapeHtml(spokenWord) + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 10v4h3l4 3V7l-4 3H5Z"></path><path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10"></path></svg></button>';
    }

    function detailActionsHtml(word, dictionary) {
        return '<details class="my-words-detail-actions"><summary aria-label="More word actions">•••</summary><div class="my-words-detail-actions-menu">' +
            '<button type="button" data-edit-word="' + escapeHtml(word.vocab_id) + '">Edit word</button>' +
            '<button type="button" data-edit-note="' + escapeHtml(word.vocab_id) + '">' + (word.personal_note ? 'Edit Note' : 'Add Note') + '</button>' +
            (!dictionary && word.lookup_status === 'not_found' ? '<button type="button" data-ai-word="' + escapeHtml(word.vocab_id) + '">Ask AI</button>' : '') +
            (dictionary ? '<button type="button" data-report-word="' + escapeHtml(word.vocab_id) + '">Report issue</button>' : '') +
            '<button class="my-word-archive" type="button" data-archive-word="' + escapeHtml(word.vocab_id) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>Remove word</button>' +
        '</div></details>';
    }

    function wordSavedDate(word) {
        return formatShortDate(word.last_added_at || word.updated_at || word.created_at);
    }

    function mobileSourceHtml(word) {
        var examples = Array.isArray(word.saved_examples) ? word.saved_examples.slice(0, 8) : [];
        if (!examples.length && word.context) {
            examples = [{ context: word.context, source_title: wordSourceLabel(word) }];
        }
        var date = wordSavedDate(word);
        var content = examples.length ? examples.map(function(example) {
            var source = example.source_title || example.source_set_id || wordSourceLabel(word);
            return '<div class="my-word-mobile-source-item">' +
                '<p>' + escapeHtml(example.context || 'No saved sentence.') + '</p>' +
                '<small>' + escapeHtml(source) + (date ? ' · ' + escapeHtml(date) : '') + '</small>' +
            '</div>';
        }).join('') : '<div class="my-word-mobile-source-item"><p>No saved sentence.</p><small>' +
            escapeHtml(wordSourceLabel(word)) + (date ? ' · ' + escapeHtml(date) : '') + '</small></div>';
        return '<section class="my-word-mobile-section"><h3>Source</h3><div class="my-word-mobile-source">' + content + '</div></section>';
    }

    function mobileWordDetailBodyHtml(word) {
        var dictionary = word.dictionary;
        var editHtml = state.editingId === word.vocab_id
            ? '<form class="my-word-edit-form" data-edit-form="' + escapeHtml(word.vocab_id) + '"><input name="text" maxlength="120" value="' + escapeHtml(word.text || '') + '" required><div><button class="outline-button" type="button" data-cancel-word-edit>Cancel</button><button class="primary-button" type="submit">Done</button></div></form>'
            : '';
        var noteHtml = state.noteEditingId === word.vocab_id
            ? '<form class="my-word-note-form" data-note-form="' + escapeHtml(word.vocab_id) + '"><textarea maxlength="500" placeholder="Add a personal note">' + escapeHtml(word.personal_note || '') + '</textarea><div><button class="outline-button" type="button" data-cancel-note>Cancel</button><button class="primary-button" type="submit">Done</button></div></form>'
            : '<div class="my-word-mobile-note"><p>' + escapeHtml(word.personal_note || 'No personal note yet.') + '</p></div>';
        var recommendation = word.recommended_headword
            ? '<button class="my-word-recommendation" type="button" data-use-headword="' + escapeHtml(word.recommended_headword) + '" data-vocab-id="' + escapeHtml(word.vocab_id) + '">' +
                ((word.merge_candidate_ids || []).length ? 'Merge with ' : 'Use ') + escapeHtml(word.recommended_headword) + '</button>'
            : '';
        var lookupHtml = !dictionary
            ? '<p class="my-word-mobile-lookup-copy">' + (word.lookup_status === 'not_found' ? 'English definition unavailable.' : 'Finding English definition...') + '</p>' +
                (word.lookup_status === 'not_found' ? '<button class="my-word-lookup" type="button" data-lookup-word="' + escapeHtml(word.vocab_id) + '">Retry</button>' : '')
            : '';
        var formsHtml = dictionary && dictionary.word_forms
            ? '<p class="my-word-mobile-forms"><strong>Forms</strong><span>' + escapeHtml(dictionary.word_forms) + '</span></p>'
            : '';
        return '<div class="my-word-mobile-detail-copy">' + formsHtml + editHtml + recommendation + lookupHtml +
            mobileSourceHtml(word) +
            '<section class="my-word-mobile-section"><h3>Note</h3>' + noteHtml + '</section>' +
        '</div>';
    }

    function wordDetailBodyHtml(word) {
        var dictionary = word.dictionary;
        var spokenWord = dictionary && dictionary.word || word.text || '';
        var examples = Array.isArray(word.saved_examples) ? word.saved_examples : [];
        var examplesHtml = examples.length ? '<div class="my-word-examples"><strong>Saved examples</strong>' + examples.slice(0, 8).map(function(example) {
            return '<div><span>' + escapeHtml(example.form || word.text || '') + '</span>' +
                (example.context ? '<blockquote>' + escapeHtml(example.context) + '</blockquote>' : '') +
                '<small>' + escapeHtml(example.source_title || example.source_set_id || '') + '</small></div>';
        }).join('') + '</div>' : (word.context ? '<blockquote>' + escapeHtml(word.context) + '</blockquote>' : '');
        var noteHtml = state.noteEditingId === word.vocab_id
            ? '<form class="my-word-note-form" data-note-form="' + escapeHtml(word.vocab_id) + '"><textarea maxlength="500" placeholder="Add a personal note">' + escapeHtml(word.personal_note || '') + '</textarea><div><button class="outline-button" type="button" data-cancel-note>Cancel</button><button class="primary-button" type="submit">Done</button></div></form>'
            : '<div class="my-word-note"><strong>Note</strong><p>' + escapeHtml(word.personal_note || 'No personal note yet.') + '</p></div>';
        var editHtml = state.editingId === word.vocab_id
            ? '<form class="my-word-edit-form" data-edit-form="' + escapeHtml(word.vocab_id) + '"><input name="text" maxlength="120" value="' + escapeHtml(word.text || '') + '" required><div><button class="outline-button" type="button" data-cancel-word-edit>Cancel</button><button class="primary-button" type="submit">Done</button></div></form>'
            : '';
        var recommendation = word.recommended_headword
            ? '<button class="my-word-recommendation" type="button" data-use-headword="' + escapeHtml(word.recommended_headword) + '" data-vocab-id="' + escapeHtml(word.vocab_id) + '">' +
                ((word.merge_candidate_ids || []).length ? 'Merge with ' : 'Use ') + escapeHtml(word.recommended_headword) + '</button>'
            : '';
        var dictionaryStatus = dictionary && dictionary.review_status === 'ai_draft'
            ? '<p class="my-word-dictionary-status">AI-generated · Not reviewed by teacher</p>'
            : (dictionary && dictionary.verified ? '<p class="my-word-dictionary-status">Teacher reviewed</p>' : '');
        var lookupHtml = '';
        if (!dictionary) {
            lookupHtml = '<p>' + (word.lookup_status === 'not_found' ? 'Dictionary entry not found yet.' : 'Finding dictionary details...') + '</p>' +
                (word.lookup_status === 'not_found' ? '<button class="my-word-lookup" type="button" data-lookup-word="' + escapeHtml(word.vocab_id) + '">Retry</button>' : '');
        }
        return '<div class="my-word-detail-copy' + (!dictionary ? ' muted' : '') + '">' + editHtml + recommendation + dictionaryStatus +
            '<div class="my-word-phonetic-row"><p class="my-word-phonetic">' + escapeHtml(dictionary && dictionary.phonetic || 'Pronunciation pending') + '</p>' + wordSpeechButtonHtml(spokenWord) + '</div>' +
            lookupHtml +
            (dictionary && dictionary.english_definition ? '<p class="my-word-definition">' + escapeHtml(dictionary.english_definition) + '</p>' : '') +
            (dictionary && dictionary.word_forms ? '<p><strong>Forms:</strong> ' + escapeHtml(dictionary.word_forms) + '</p>' : '') +
            examplesHtml + noteHtml +
            '<p class="my-word-detail-meta">' + escapeHtml(wordSourceLabel(word)) + (formatShortDate(word.last_added_at || word.updated_at || word.created_at) ? ' · ' + escapeHtml(formatShortDate(word.last_added_at || word.updated_at || word.created_at)) : '') + '</p>' +
        '</div>';
    }

    function detailPanelHtml(word, mobile) {
        var dictionary = word.dictionary || {};
        if (mobile) {
            var spokenWord = dictionary.word || word.text || '';
            return '<div class="my-words-detail-head my-words-detail-head-mobile">' + detailActionsHtml(word, word.dictionary) + '</div>' +
                '<div class="my-word-mobile-title-row"><h2 id="my-words-mobile-detail-title">' + escapeHtml(word.text || '') + '</h2>' + wordSpeechButtonHtml(spokenWord) + '</div>' +
                '<div class="my-word-mobile-lexical-line">' +
                    '<strong>' + escapeHtml(dictionary.part_of_speech || 'Word') + '</strong>' +
                    '<span>' + escapeHtml(dictionary.english_definition || 'English definition unavailable.') + '</span>' +
                '</div>' +
                mobileWordDetailBodyHtml(word);
        }
        return '<div class="my-words-detail-head"><span>Word details</span>' + detailActionsHtml(word, word.dictionary) + '</div>' +
            '<div class="my-words-detail-title"><p class="eyebrow accent">' + escapeHtml(dictionary.part_of_speech || 'MY WORD') + '</p><h2>' + escapeHtml(word.text || '') + '</h2></div>' +
            '<div class="my-words-detail-body">' + wordDetailBodyHtml(word) + '</div>';
    }

    function renderDesktopDetail() {
        if (!desktopDetail) return;
        var word = vocabWord(state.selectedId);
        if (!word) {
            desktopDetail.innerHTML = '<div class="my-words-detail-empty"><p>Select a saved word to see its details.</p></div>';
            return;
        }
        desktopDetail.innerHTML = detailPanelHtml(word, false);
    }

    function renderMobileDetail() {
        if (!state.mobileDetailOpen || !mobileDetail) return;
        var word = vocabWord(state.selectedId);
        if (!word) {
            closeMobileDetail(true);
            return;
        }
        mobileDetail.innerHTML = detailPanelHtml(word, true);
    }

    function renderAll() {
        renderStats();
        renderRecent();
        renderIndex();
        renderDesktopDetail();
        renderMobileDetail();
        updateExportSelectionCount();
    }

    function scheduleTitleOverflow() {
        window.requestAnimationFrame(function() {
            var windows = Array.prototype.slice.call(indexList.querySelectorAll('.my-words-title-window'));
            var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            function update(titleWindow) {
                var track = titleWindow.querySelector('.my-words-title-track');
                if (!track) return;
                var overflow = Math.ceil(track.scrollWidth - titleWindow.clientWidth);
                var shouldScroll = isMobileLayout() && !reduceMotion && titleWindow.clientWidth > 0 && overflow > 2;
                titleWindow.classList.toggle('is-overflowing', shouldScroll || (reduceMotion && overflow > 2));
                if (!shouldScroll) {
                    titleWindow.style.removeProperty('--my-words-title-shift');
                    titleWindow.style.removeProperty('--my-words-title-duration');
                    return;
                }
                titleWindow.style.setProperty('--my-words-title-shift', (-overflow) + 'px');
                titleWindow.style.setProperty('--my-words-title-duration', Math.max(7, Math.min(14, 6 + (overflow / 28))) + 's');
            }
            windows.forEach(update);
            if (titleResizeObserver) titleResizeObserver.disconnect();
            if (!window.ResizeObserver) return;
            titleResizeObserver = new ResizeObserver(function(entries) {
                entries.forEach(function(entry) { update(entry.target); });
            });
            windows.forEach(function(titleWindow) { titleResizeObserver.observe(titleWindow); });
        });
    }

    function syncViewControls() {
        document.querySelectorAll('[data-my-words-nav]').forEach(function(button) {
            button.setAttribute('aria-selected', button.dataset.myWordsNav === state.view ? 'true' : 'false');
        });
        document.querySelectorAll('[data-my-words-view]').forEach(function(view) {
            view.classList.toggle('is-active', view.dataset.myWordsView === state.view);
        });
    }

    function setView(view, updateHistory) {
        state.view = view === 'word-list' ? 'word-list' : 'study';
        if (state.view !== 'word-list' && state.search) {
            state.search = '';
            searchInput.value = '';
            setSearchOpen(false);
        }
        syncViewControls();
        if (state.view === 'word-list') {
            renderIndex();
            renderDesktopDetail();
        }
        if (updateHistory && window.history && window.history.replaceState) {
            var url = new URL(window.location.href);
            url.hash = state.view === 'study' ? 'review' : '';
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        }
    }

    function openWord(vocabId, opener, fromRecent) {
        var word = vocabWord(vocabId);
        if (!word) return;
        state.selectedId = vocabId;
        state.detailOpener = opener || document.activeElement;
        renderIndex();
        renderDesktopDetail();
        if (isMobileLayout()) {
            openMobileDetail();
            return;
        }
        if (fromRecent) setView('word-list', true);
    }

    function lockPageForDetail() {
        state.lockedScrollY = window.scrollY || window.pageYOffset || 0;
        document.body.style.position = 'fixed';
        document.body.style.top = (-state.lockedScrollY) + 'px';
        document.body.style.right = '0';
        document.body.style.left = '0';
        document.body.classList.add('my-words-detail-open');
    }

    function unlockPageForDetail() {
        document.body.classList.remove('my-words-detail-open');
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.right = '';
        document.body.style.left = '';
        window.scrollTo(0, state.lockedScrollY || 0);
    }

    function openMobileDetail() {
        state.mobileDetailOpen = true;
        renderMobileDetail();
        mobileOverlay.hidden = false;
        lockPageForDetail();
        window.requestAnimationFrame(function() { if (mobileClose) mobileClose.focus({ preventScroll: true }); });
    }

    function hasUnsavedDetailEdit() {
        return Boolean(state.editingId || state.noteEditingId);
    }

    function activeDetailRoot() {
        return state.mobileDetailOpen ? mobileDetail : desktopDetail;
    }

    function closeMobileDetail(force) {
        if (!state.mobileDetailOpen) return true;
        if (!force && hasUnsavedDetailEdit() && !window.confirm('Discard your unsaved changes?')) return false;
        state.editingId = '';
        state.noteEditingId = '';
        state.mobileDetailOpen = false;
        mobileOverlay.hidden = true;
        unlockPageForDetail();
        renderDesktopDetail();
        var opener = state.detailOpener;
        state.detailOpener = null;
        if (opener && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
        return true;
    }

    function manualWordValidation(text) {
        var clean = String(text || '').replace(/\s+/g, ' ').trim();
        if (!clean) return 'Enter a word or short phrase first.';
        if (clean.length > 120 || clean.split(/\s+/).filter(Boolean).length > 16) return 'Please add one word or a short phrase at a time.';
        if (!/[\p{L}\p{N}]/u.test(clean)) return 'Use letters or numbers in the word.';
        return '';
    }

    function setAddOpen(open) {
        addPanel.classList.toggle('open', open);
        addPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (open) addPanel.removeAttribute('inert');
        else addPanel.setAttribute('inert', '');
        addTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        addTrigger.setAttribute('aria-label', open ? 'Close add word' : 'Add a word');
        if (open) window.setTimeout(function() { addInput.focus(); }, 170);
        else {
            addInput.value = '';
            addStatus.textContent = '';
        }
    }

    function renderExportFields() {
        var root = document.getElementById('my-words-export-fields');
        if (!root || !window.MrCatMyWordsExport) return;
        var defaults = { chinese: true, part_of_speech: true, phonetic: true };
        root.innerHTML = Object.keys(window.MrCatMyWordsExport.FIELD_DEFINITIONS).filter(function(field) {
            return field !== 'english';
        }).map(function(field) {
            return '<label><input type="checkbox" data-export-field="' + escapeHtml(field) + '"' + (defaults[field] ? ' checked' : '') + '><span>' + escapeHtml(window.MrCatMyWordsExport.FIELD_DEFINITIONS[field].label) + '</span></label>';
        }).join('');
    }

    function exportRangeItems() {
        return filteredItems().filter(function(word) { return wordMatchesRange(word, state.exportRange); });
    }

    function selectedExportItems() {
        return activeItems().filter(function(word) { return state.exportSelected[word.vocab_id]; });
    }

    function selectedExportFields() {
        var fields = ['english'];
        document.querySelectorAll('#my-words-export-fields input[data-export-field]:checked').forEach(function(input) {
            fields.push(input.dataset.exportField);
        });
        return fields;
    }

    function updateExportSelectionCount() {
        var selected = selectedExportItems().length;
        var count = document.getElementById('my-words-selected-count');
        if (count) count.textContent = selected + ' selected';
        ['my-words-export-excel', 'my-words-export-pdf'].forEach(function(id) {
            var button = document.getElementById(id);
            if (button) button.disabled = selected === 0;
        });
    }

    function selectExportRange(range) {
        state.exportRange = range || 'all';
        state.exportSelected = {};
        exportRangeItems().forEach(function(word) { state.exportSelected[word.vocab_id] = true; });
        document.querySelectorAll('[data-export-range]').forEach(function(button) {
            button.classList.toggle('active', button.dataset.exportRange === state.exportRange);
        });
        renderIndex();
        updateExportSelectionCount();
    }

    function setExportOpen(open) {
        state.exportOpen = Boolean(open);
        exportPanel.classList.toggle('open', state.exportOpen);
        exportPanel.setAttribute('aria-hidden', state.exportOpen ? 'false' : 'true');
        if (state.exportOpen) {
            exportPanel.removeAttribute('inert');
            selectExportRange(state.exportRange || 'all');
        } else {
            exportPanel.setAttribute('inert', '');
            renderIndex();
        }
        exportTrigger.setAttribute('aria-expanded', state.exportOpen ? 'true' : 'false');
    }

    function showMergeUndo(vocabId) {
        var toast = document.createElement('div');
        toast.className = 'my-words-undo-toast';
        toast.innerHTML = '<span>Words merged.</span><button type="button">Undo</button>';
        document.body.appendChild(toast);
        window.requestAnimationFrame(function() { toast.classList.add('show'); });
        var timer = window.setTimeout(function() {
            toast.classList.remove('show');
            window.setTimeout(function() { toast.remove(); }, 180);
        }, 10000);
        toast.querySelector('button').addEventListener('click', function() {
            window.clearTimeout(timer);
            callStudentVocabulary({ action: 'undoMerge', vocab_id: vocabId }).then(function() {
                toast.remove();
                return reloadWords();
            }).catch(function(error) { window.alert(error.message); });
        });
    }

    function mergeWordGroup(word, headword, ids) {
        var groupIds = Array.from(new Set([word.vocab_id].concat(ids || word.merge_candidate_ids || [])));
        var selected = groupIds.map(vocabWord).filter(Boolean);
        if (selected.length < 2) {
            state.editingId = word.vocab_id;
            renderDesktopDetail();
            renderMobileDetail();
            var input = activeDetailRoot().querySelector('[data-edit-form] input');
            if (input) { input.value = headword; input.focus(); }
            return;
        }
        var modal = document.createElement('section');
        modal.className = 'my-word-merge-modal my-words-page-merge';
        modal.innerHTML = '<div class="my-word-merge-card" role="dialog" aria-modal="true" aria-labelledby="my-word-merge-title">' +
            '<p class="eyebrow accent">MERGE WORD FORMS</p><h2 id="my-word-merge-title">Keep ' + escapeHtml(headword) + '</h2>' +
            '<p>Select the forms to combine. Notes and saved examples will be kept.</p>' +
            '<div class="my-word-merge-options">' + selected.map(function(item) {
                return '<label><input type="checkbox" value="' + escapeHtml(item.vocab_id) + '" checked><span>' + escapeHtml(item.text) + '</span></label>';
            }).join('') + '</div>' +
            '<p class="my-word-merge-status" role="status"></p><div class="my-word-merge-actions"><button class="outline-button" type="button" data-cancel-merge>Cancel</button><button class="primary-button" type="button" data-confirm-merge>Merge selected</button></div></div>';
        document.body.appendChild(modal);
        var close = function() { modal.remove(); };
        modal.querySelector('[data-cancel-merge]').addEventListener('click', close);
        modal.addEventListener('click', function(event) { if (event.target === modal) close(); });
        modal.querySelector('[data-confirm-merge]').addEventListener('click', function() {
            var checkedIds = Array.from(modal.querySelectorAll('input:checked')).map(function(input) { return input.value; });
            var status = modal.querySelector('.my-word-merge-status');
            if (checkedIds.length < 2) { status.textContent = 'Choose at least two word forms.'; return; }
            var button = modal.querySelector('[data-confirm-merge]');
            button.disabled = true;
            status.textContent = 'Merging...';
            callStudentVocabulary({ action: 'mergeWords', vocab_ids: checkedIds, headword: headword }).then(function(result) {
                checkedIds.forEach(function(id) { replaceItem(id, null); });
                upsertItem(result.word);
                state.selectedId = result.word.vocab_id;
                state.editingId = '';
                modal.remove();
                renderAll();
                showMergeUndo(result.word.vocab_id);
            }).catch(function(error) {
                button.disabled = false;
                status.textContent = error.message;
            });
        });
    }

    function enrichPendingItems(items) {
        if (!window.MrCatPersonalVocab || !window.MrCatPersonalVocab.enrichWord) return;
        (items || []).filter(function(word) {
            return word && !word.dictionary && (word.lookup_status || 'pending') === 'pending';
        }).slice(0, 8).forEach(function(word, index) {
            window.setTimeout(function() { window.MrCatPersonalVocab.enrichWord(word, false); }, index * 180);
        });
    }

    function handleActionClick(event) {
        var add = event.target.closest('[data-open-add]');
        if (add) { setAddOpen(true); return; }
        var recent = event.target.closest('[data-open-recent-word]');
        if (recent) { openWord(recent.dataset.openRecentWord, recent, true); return; }
        var wordButton = event.target.closest('[data-open-word]');
        if (wordButton) { openWord(wordButton.dataset.openWord, wordButton, false); return; }
        var speak = event.target.closest('[data-speak-word]');
        if (speak) {
            var value = speak.dataset.speakWord || '';
            if (value && window.speechSynthesis && window.SpeechSynthesisUtterance) {
                window.speechSynthesis.cancel();
                var utterance = new SpeechSynthesisUtterance(value);
                utterance.lang = 'en-GB';
                window.speechSynthesis.speak(utterance);
            }
            return;
        }
        var archive = event.target.closest('[data-archive-word]');
        if (archive) {
            var archivedWord = vocabWord(archive.dataset.archiveWord);
            if (!archivedWord || !window.confirm('Remove “' + archivedWord.text + '” from My Words?')) return;
            archive.disabled = true;
            callStudentVocabulary({ action: 'archive', vocab_id: archivedWord.vocab_id }).then(function() {
                replaceItem(archivedWord.vocab_id, null);
                state.selectedId = sortedItems(activeItems())[0] && sortedItems(activeItems())[0].vocab_id || '';
                if (state.mobileDetailOpen) closeMobileDetail(true);
                renderAll();
            }).catch(function(error) {
                archive.disabled = false;
                window.alert(error.message || 'Unable to remove this word.');
            });
            return;
        }
        var lookup = event.target.closest('[data-lookup-word]');
        if (lookup) {
            lookup.disabled = true;
            lookup.textContent = 'Looking up...';
            callStudentVocabulary({ action: 'enrich', vocab_id: lookup.dataset.lookupWord, force: true }).then(function(result) {
                replaceItem(lookup.dataset.lookupWord, result.word);
                renderAll();
            }).catch(function() {
                lookup.disabled = false;
                lookup.textContent = 'Retry';
            });
            return;
        }
        var edit = event.target.closest('[data-edit-word]');
        if (edit) {
            state.editingId = edit.dataset.editWord;
            state.noteEditingId = '';
            renderDesktopDetail();
            renderMobileDetail();
            var editInput = activeDetailRoot().querySelector('[data-edit-form] input');
            if (editInput) { editInput.focus(); editInput.select(); }
            return;
        }
        var note = event.target.closest('[data-edit-note]');
        if (note) {
            state.noteEditingId = note.dataset.editNote;
            state.editingId = '';
            renderDesktopDetail();
            renderMobileDetail();
            var textarea = activeDetailRoot().querySelector('[data-note-form] textarea');
            if (textarea) textarea.focus();
            return;
        }
        if (event.target.closest('[data-cancel-word-edit]')) {
            state.editingId = '';
            renderDesktopDetail();
            renderMobileDetail();
            return;
        }
        if (event.target.closest('[data-cancel-note]')) {
            state.noteEditingId = '';
            renderDesktopDetail();
            renderMobileDetail();
            return;
        }
        var useHeadword = event.target.closest('[data-use-headword]');
        if (useHeadword) {
            var headwordItem = vocabWord(useHeadword.dataset.vocabId);
            if (!headwordItem) return;
            if ((headwordItem.merge_candidate_ids || []).length) {
                mergeWordGroup(headwordItem, useHeadword.dataset.useHeadword, headwordItem.merge_candidate_ids);
                return;
            }
            state.editingId = headwordItem.vocab_id;
            renderDesktopDetail();
            renderMobileDetail();
            var headwordInput = activeDetailRoot().querySelector('[data-edit-form] input');
            if (headwordInput) { headwordInput.value = useHeadword.dataset.useHeadword; headwordInput.focus(); }
            return;
        }
        var ai = event.target.closest('[data-ai-word]');
        if (ai) {
            var vocabId = ai.dataset.aiWord;
            ai.disabled = true;
            ai.textContent = 'Asking AI...';
            callStudentVocabulary({ action: 'requestAiDraft', vocab_id: vocabId }).then(function(result) {
                if (result.already_available && result.word) {
                    replaceItem(vocabId, result.word);
                    renderAll();
                    return null;
                }
                var draft = result.draft || {};
                var preview = [draft.word, draft.part_of_speech, draft.chinese_meaning, draft.english_definition].filter(Boolean).join('\n\n');
                if (!window.confirm(preview + '\n\nUse this shared AI draft? It has not been reviewed by a teacher.')) return null;
                return callStudentVocabulary({ action: 'confirmAiDraft', vocab_id: vocabId, draft_token: result.draft_token }).then(function(saved) {
                    replaceItem(vocabId, saved.word);
                    renderAll();
                });
            }).catch(function(error) {
                ai.disabled = false;
                ai.textContent = 'Ask AI';
                window.alert(error.result && error.result.code === 'AI_NOT_CONFIGURED' ? 'AI dictionary lookup is under development.' : error.message);
            });
            return;
        }
        var report = event.target.closest('[data-report-word]');
        if (report) {
            var reason = window.prompt('What seems wrong? You may leave this blank.');
            if (reason === null) return;
            callStudentVocabulary({ action: 'reportDictionaryIssue', vocab_id: report.dataset.reportWord, reason: reason }).then(function() {
                report.textContent = 'Reported';
                report.disabled = true;
            }).catch(function(error) { window.alert(error.message); });
        }
    }

    function handleDetailSubmit(event) {
        var editForm = event.target.closest('[data-edit-form]');
        if (editForm) {
            event.preventDefault();
            var oldId = editForm.dataset.editForm;
            var word = vocabWord(oldId);
            callStudentVocabulary({ action: 'updateWord', vocab_id: oldId, text: editForm.elements.text.value }).then(function(result) {
                state.editingId = '';
                replaceItem(oldId, result.word);
                state.selectedId = result.word.vocab_id;
                renderAll();
                if (window.MrCatPersonalVocab) window.MrCatPersonalVocab.enrichWord(result.word, false);
            }).catch(function(error) {
                if (error.result && error.result.code === 'MERGE_REQUIRED' && word) {
                    mergeWordGroup(word, error.result.recommended_headword, error.result.merge_vocab_ids);
                    return;
                }
                window.alert(error.message);
            });
            return;
        }
        var noteForm = event.target.closest('[data-note-form]');
        if (noteForm) {
            event.preventDefault();
            var vocabId = noteForm.dataset.noteForm;
            callStudentVocabulary({ action: 'updateNote', vocab_id: vocabId, personal_note: noteForm.querySelector('textarea').value }).then(function(result) {
                state.noteEditingId = '';
                replaceItem(vocabId, result.word);
                renderAll();
            }).catch(function(error) { window.alert(error.message); });
        }
    }

    function bindControls() {
        document.querySelectorAll('[data-my-words-nav]').forEach(function(button) {
            button.addEventListener('click', function() { setView(button.dataset.myWordsNav, true); });
        });
        addTrigger.addEventListener('click', function() { setAddOpen(addTrigger.getAttribute('aria-expanded') !== 'true'); });
        addForm.addEventListener('submit', function(event) {
            event.preventDefault();
            var text = String(addInput.value || '').replace(/\s+/g, ' ').trim();
            var validation = manualWordValidation(text);
            if (validation) { addStatus.textContent = validation; addInput.focus(); return; }
            addSubmit.disabled = true;
            addSubmit.textContent = 'Saving...';
            addStatus.textContent = '';
            callStudentVocabulary({ action: 'add', text: text, source_set_id: null, source_title: 'My Words', source_path: 'my-words.html', context: '' }).then(function(result) {
                upsertItem(result.word);
                state.selectedId = result.word.vocab_id;
                setAddOpen(false);
                renderAll();
                if (window.MrCatPersonalVocab) window.MrCatPersonalVocab.enrichWord(result.word, false);
                setFeedback(result.created ? 'Saved. Dictionary details may continue loading.' : 'Already saved. Moved to the top of your list.');
                window.setTimeout(function() { setFeedback(''); }, 2600);
            }).catch(function(error) {
                addStatus.textContent = error.message || 'Unable to add this word.';
            }).finally(function() {
                addSubmit.disabled = false;
                addSubmit.textContent = 'Save';
            });
        });
        searchInput.addEventListener('input', function() { state.search = searchInput.value; renderIndex(); renderDesktopDetail(); });
        searchTrigger.addEventListener('click', function() {
            if (state.searchOpen && !state.search) {
                setSearchOpen(false);
                return;
            }
            setDensityMenuOpen(false);
            setSearchOpen(true);
        });
        sortSelect.addEventListener('change', function() { state.sort = sortSelect.value; renderIndex(); renderDesktopDetail(); });
        densityTrigger.addEventListener('click', function() {
            var open = densityTrigger.getAttribute('aria-expanded') !== 'true';
            if (open && state.exportOpen) setExportOpen(false);
            setDensityMenuOpen(open);
        });
        document.querySelectorAll('[data-my-words-density]').forEach(function(button) {
            button.addEventListener('click', function() {
                setDensity(button.dataset.myWordsDensity);
                setDensityMenuOpen(false);
                densityTrigger.focus();
            });
        });
        exportTrigger.addEventListener('click', function() {
            setDensityMenuOpen(false);
            setExportOpen(exportTrigger.getAttribute('aria-expanded') !== 'true');
        });
        document.querySelectorAll('[data-export-range]').forEach(function(button) {
            button.addEventListener('click', function() { selectExportRange(button.dataset.exportRange); });
        });
        document.getElementById('my-words-select-all').addEventListener('click', function() {
            var items = exportRangeItems();
            var allSelected = items.length && items.every(function(word) { return state.exportSelected[word.vocab_id]; });
            items.forEach(function(word) { state.exportSelected[word.vocab_id] = !allSelected; });
            renderIndex();
            updateExportSelectionCount();
        });
        document.getElementById('my-words-export-excel').addEventListener('click', function() {
            try { window.MrCatMyWordsExport.downloadExcel(selectedExportItems(), selectedExportFields()); }
            catch (error) { document.getElementById('my-words-export-status').textContent = error.message; }
        });
        document.getElementById('my-words-export-pdf').addEventListener('click', function() {
            try { window.MrCatMyWordsExport.printPdf(selectedExportItems(), selectedExportFields()); }
            catch (error) { document.getElementById('my-words-export-status').textContent = error.message; }
        });
        indexList.addEventListener('change', function(event) {
            var input = event.target.closest('[data-select-word]');
            if (!input) return;
            state.exportSelected[input.dataset.selectWord] = input.checked;
            updateExportSelectionCount();
        });
        document.addEventListener('click', handleActionClick);
        document.addEventListener('click', function(event) {
            if (state.densityMenuOpen && !event.target.closest('.my-words-density-picker')) setDensityMenuOpen(false);
        });
        document.addEventListener('click', function(event) {
            document.querySelectorAll('.my-words-detail-actions[open]').forEach(function(actions) {
                if (!actions.contains(event.target)) actions.removeAttribute('open');
            });
        });
        document.addEventListener('submit', handleDetailSubmit);
        mobileClose.addEventListener('click', function() { closeMobileDetail(false); });
        mobileOverlay.addEventListener('click', function(event) { if (event.target === mobileOverlay) closeMobileDetail(false); });
        var logoutButton = document.getElementById('my-words-logout');
        if (logoutButton) logoutButton.addEventListener('click', window.MrCatAuth.logout);
        document.addEventListener('keydown', function(event) {
            if (event.key !== 'Escape') return;
            if (state.mobileDetailOpen) { closeMobileDetail(false); return; }
            if (state.densityMenuOpen) { setDensityMenuOpen(false); densityTrigger.focus(); return; }
            if (state.searchOpen) {
                state.search = '';
                searchInput.value = '';
                setSearchOpen(false);
                renderIndex();
                renderDesktopDetail();
                searchTrigger.focus();
                return;
            }
            if (addTrigger.getAttribute('aria-expanded') === 'true') { setAddOpen(false); addTrigger.focus(); return; }
            if (state.exportOpen) { setExportOpen(false); exportTrigger.focus(); }
        });
        window.addEventListener('resize', scheduleTitleOverflow);
        window.addEventListener('mrcat:vocab-saved', function(event) {
            if (!state.session || state.session.mode !== 'student') return;
            var word = event.detail;
            if (!word || !word.vocab_id) return;
            upsertItem(word);
            renderAll();
        });
    }

    function renderVisitor() {
        setFeedback('Log in as a student to open your personal My Words.');
        recentList.innerHTML = '<div class="my-words-empty-state"><div><p>Your personal words are available after login.</p><a class="primary-button" href="index.html">Log In</a></div></div>';
        indexList.innerHTML = '<div class="my-words-empty-state"><p>Student login required.</p></div>';
        addTrigger.disabled = true;
        searchInput.disabled = true;
        sortSelect.disabled = true;
    }

    function initialize() {
        try {
            state.density = normalizedDensity(window.localStorage.getItem('mrcat_my_words_density'));
        } catch (error) {
            state.density = 'double';
        }
        syncDensityControls();
        state.view = window.location.hash === '#review' || window.location.hash === '#study' ? 'study' : 'word-list';
        syncViewControls();
        renderExportFields();
        bindControls();
        recentList.innerHTML = '<div class="my-words-loading-state"><p>Loading My Words...</p></div>';
        indexList.innerHTML = '<div class="my-words-loading-state"><p>Loading saved words...</p></div>';
        window.MrCatAuth.getSession().then(function(session) {
            if (session.mode === 'none') {
                window.location.replace('index.html');
                return null;
            }
            if (session.mode === 'teacher') {
                window.location.replace('teacher.html');
                return null;
            }
            state.session = session;
            if (session.mode === 'visitor') {
                renderVisitor();
                return null;
            }
            return reloadWords();
        }).catch(function(error) {
            setFeedback(error.message || 'Unable to start My Words.');
            recentList.innerHTML = '<div class="my-words-loading-state"><div><p>My Words could not be loaded.</p><button class="outline-button" type="button" data-retry-load>Try again</button></div></div>';
            indexList.innerHTML = '<div class="my-words-loading-state"><p>My Words could not be loaded.</p></div>';
        });
        document.addEventListener('click', function(event) {
            if (!event.target.closest('[data-retry-load]')) return;
            reloadWords().catch(function() {});
        });
    }

    initialize();
})(window, document);
