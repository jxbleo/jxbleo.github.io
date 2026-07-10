(function(root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.MrCatVocabularyWorksheetPdf = api;
})(typeof window !== 'undefined' ? window : null, function() {
    'use strict';

    var MM = 72 / 25.4;
    var PAGE_WIDTH = 210 * MM;
    var PAGE_HEIGHT = 297 * MM;
    var FRAME_X = 15 * MM;
    var FRAME_Y = 14 * MM;
    var FRAME_WIDTH = PAGE_WIDTH - 30 * MM;
    var FRAME_HEIGHT = PAGE_HEIGHT - 28 * MM;
    var CONTENT_X = 23 * MM;
    var CONTENT_WIDTH = PAGE_WIDTH - 46 * MM;
    var TOP_Y = PAGE_HEIGHT - 25 * MM;
    var BOTTOM_Y = 31 * MM;
    var NUMBER_COLUMN_WIDTH = 11 * MM;
    var SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    function fmt(value) {
        return (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
    }

    function decodeEntities(value) {
        return String(value || '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }

    function cleanText(value) {
        return decodeEntities(value)
            .replace(/<\s*br\s*\/?\s*>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[\u2018\u2019\u201B]/g, "'")
            .replace(/[\u201C\u201D\u201F]/g, '"')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\u2026/g, '...')
            .replace(/[^\x20-\x7E]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizePrompt(prompt) {
        return cleanText(prompt).replace(/_{5,}/g, '___________');
    }

    function pdfString(value) {
        return cleanText(value)
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
    }

    function textWidth(text, size) {
        var width = 0;
        String(text || '').split('').forEach(function(char) {
            if (char === ' ') width += 0.28;
            else if (/[ilI1.,;:'"`|!]/.test(char)) width += 0.25;
            else if (/[mwMW@#%&]/.test(char)) width += 0.78;
            else if (/[A-Z]/.test(char)) width += 0.6;
            else width += 0.5;
        });
        return width * size;
    }

    function wrapText(text, maxWidth, size) {
        var words = cleanText(text).split(/\s+/).filter(Boolean);
        var lines = [];
        var line = '';
        words.forEach(function(word) {
            var next = line ? line + ' ' + word : word;
            if (textWidth(next, size) <= maxWidth || !line) {
                line = next;
                return;
            }
            lines.push(line);
            line = word;
        });
        if (line) lines.push(line);
        return lines.length ? lines : [''];
    }

    function textCommand(x, y, text, options) {
        options = options || {};
        var font = options.font || 'F1';
        var size = options.size || 10;
        var align = options.align || 'left';
        var tx = x;
        if (align === 'center') tx -= textWidth(text, size) / 2;
        if (align === 'right') tx -= textWidth(text, size);
        return 'BT /' + font + ' ' + fmt(size) + ' Tf ' + fmt(tx) + ' ' + fmt(y) + ' Td (' + pdfString(text) + ') Tj ET';
    }

    function lineCommand(x1, y1, x2, y2) {
        return fmt(x1) + ' ' + fmt(y1) + ' m ' + fmt(x2) + ' ' + fmt(y2) + ' l S';
    }

    function rectCommand(x, y, width, height) {
        return fmt(x) + ' ' + fmt(y) + ' ' + fmt(width) + ' ' + fmt(height) + ' re S';
    }

    function roundRectCommand(x, y, width, height, radius) {
        var k = 0.5522847498;
        var r = Math.min(radius, width / 2, height / 2);
        var c = r * k;
        return [
            fmt(x + r) + ' ' + fmt(y) + ' m',
            fmt(x + width - r) + ' ' + fmt(y) + ' l',
            fmt(x + width - r + c) + ' ' + fmt(y) + ' ' + fmt(x + width) + ' ' + fmt(y + r - c) + ' ' + fmt(x + width) + ' ' + fmt(y + r) + ' c',
            fmt(x + width) + ' ' + fmt(y + height - r) + ' l',
            fmt(x + width) + ' ' + fmt(y + height - r + c) + ' ' + fmt(x + width - r + c) + ' ' + fmt(y + height) + ' ' + fmt(x + width - r) + ' ' + fmt(y + height) + ' c',
            fmt(x + r) + ' ' + fmt(y + height) + ' l',
            fmt(x + r - c) + ' ' + fmt(y + height) + ' ' + fmt(x) + ' ' + fmt(y + height - r + c) + ' ' + fmt(x) + ' ' + fmt(y + height - r) + ' c',
            fmt(x) + ' ' + fmt(y + r) + ' l',
            fmt(x) + ' ' + fmt(y + r - c) + ' ' + fmt(x + r - c) + ' ' + fmt(y) + ' ' + fmt(x + r) + ' ' + fmt(y) + ' c',
            'h S'
        ].join(' ');
    }

    function fillRectCommand(x, y, width, height, shade) {
        var color = typeof shade === 'number' ? shade : 0;
        return 'q ' + fmt(color) + ' g ' + fmt(x) + ' ' + fmt(y) + ' ' + fmt(width) + ' ' + fmt(height) + ' re f Q';
    }

    function drawWrapped(commands, text, x, topY, maxWidth, options) {
        options = options || {};
        var size = options.size || 10;
        var leading = options.leading || size * 1.25;
        var font = options.font || 'F1';
        var lines = wrapText(text, maxWidth, size);
        lines.forEach(function(line, index) {
            commands.push(textCommand(x, topY - (index * leading), line, { font: font, size: size }));
        });
        return topY - (lines.length * leading);
    }

    function hashSeed(text) {
        var value = 2166136261;
        text = String(text || '');
        for (var i = 0; i < text.length; i += 1) {
            value ^= text.charCodeAt(i);
            value = Math.imul(value, 16777619);
        }
        return value >>> 0;
    }

    function randomFromSeed(seed) {
        var state = hashSeed(seed);
        return function() {
            state += 0x6D2B79F5;
            var t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function shuffled(list, seed) {
        var copy = (list || []).slice();
        var random = randomFromSeed(seed);
        for (var i = copy.length - 1; i > 0; i -= 1) {
            var j = Math.floor(random() * (i + 1));
            var tmp = copy[i];
            copy[i] = copy[j];
            copy[j] = tmp;
        }
        if (copy.length > 1 && copy.every(function(item, index) { return item === list[index]; })) {
            copy.push(copy.shift());
        }
        return copy;
    }

    function makeSeed() {
        var seed = '';
        var cryptoRef = typeof crypto !== 'undefined' ? crypto : null;
        var values = new Uint8Array(6);
        if (cryptoRef && cryptoRef.getRandomValues) {
            cryptoRef.getRandomValues(values);
        } else {
            for (var i = 0; i < values.length; i += 1) values[i] = Math.floor(Math.random() * 256);
        }
        for (var index = 0; index < values.length; index += 1) {
            seed += SEED_ALPHABET[values[index] % SEED_ALPHABET.length];
        }
        return seed;
    }

    function groupIndex(unit, group) {
        var groups = unit.quizGroups || [];
        for (var i = 0; i < groups.length; i += 1) {
            if (groups[i].id === group.id) return i + 1;
        }
        return 1;
    }

    function groupTitle(unit, group) {
        return 'Set ' + groupIndex(unit, group) + ' - Words ' + group.rangeStart + '-' + group.rangeEnd;
    }

    function prepareGroup(group, options) {
        var copy = {
            id: group.id,
            rangeStart: group.rangeStart,
            rangeEnd: group.rangeEnd,
            wordList: (group.wordList || []).slice(),
            questions: (group.questions || []).slice()
        };
        if (options.shuffle) {
            copy.wordList = shuffled(copy.wordList, options.seed + ':' + group.id + ':words');
            copy.questions = shuffled(copy.questions, options.seed + ':' + group.id + ':questions');
            copy.questions = copy.questions.map(function(question, index) {
                var next = {};
                Object.keys(question || {}).forEach(function(key) {
                    next[key] = question[key];
                });
                next._worksheetNumber = index + 1;
                return next;
            });
        }
        return copy;
    }

    function drawFrame(commands, pageNumber, footerRight) {
        commands.push('q 0 G 0 g 0.75 w');
        commands.push(rectCommand(FRAME_X, FRAME_Y, FRAME_WIDTH, FRAME_HEIGHT));
        commands.push(textCommand(18 * MM, 9 * MM, 'Answers written in the margins will not be marked.', { size: 8.4 }));
        commands.push(textCommand(PAGE_WIDTH / 2, 8.5 * MM, String(pageNumber), { size: 8.4, align: 'center' }));
        commands.push(textCommand(PAGE_WIDTH - 18 * MM, 9 * MM, footerRight, { size: 8.4, align: 'right' }));
        commands.push('Q');
    }

    function drawInfoTags(commands, x, topY, width) {
        var labels = ['Name', 'Date', 'Score'];
        var tagGap = 3.2 * MM;
        var tagWidth = 31 * MM;
        var tagHeight = 11.5 * MM;
        var totalWidth = labels.length * tagWidth + (labels.length - 1) * tagGap;
        var startX = x + width - totalWidth;
        var top = topY + 3.2 * MM;
        commands.push('q 0 G 0 g 0.55 w');
        labels.forEach(function(label, index) {
            var tagX = startX + index * (tagWidth + tagGap);
            var tagY = top - tagHeight;
            commands.push(roundRectCommand(tagX, tagY, tagWidth, tagHeight, 1.8 * MM));
            commands.push(textCommand(tagX + 2.2 * MM, top - 3.7 * MM, label, { font: 'F2', size: 5.8 }));
            commands.push('0.35 w');
            commands.push(lineCommand(tagX + 2.2 * MM, top - 8.3 * MM, tagX + tagWidth - 2.2 * MM, top - 8.3 * MM));
            commands.push('0.55 w');
        });
        commands.push('Q');
    }

    function wordBankLayout(words, width) {
        var list = words && words.length ? words : [''];
        var columns = 5;
        var fontSize = 9.6;
        if (words.length <= 5) {
            columns = Math.max(1, words.length);
        } else {
            var fiveColumnWidth = width / 5;
            var maxFiveColumnWordWidth = list.reduce(function(max, word) {
                return Math.max(max, textWidth(word, fontSize));
            }, 0);
            if (maxFiveColumnWordWidth > fiveColumnWidth - 8 * MM) columns = 4;
        }
        var cellWidth = width / columns;
        var maxWordWidth = list.reduce(function(max, word) {
            return Math.max(max, textWidth(word, fontSize));
        }, 0);
        var available = cellWidth - 5 * MM;
        if (maxWordWidth > available) {
            fontSize = Math.max(7.2, fontSize * available / maxWordWidth);
        }
        return {
            columns: columns,
            rows: Math.max(words.length <= 5 ? 2 : 1, Math.ceil(words.length / columns)),
            fontSize: fontSize
        };
    }

    function drawWordGrid(commands, words, x, topY, width) {
        words = (words || []).map(cleanText);
        var layout = wordBankLayout(words, width);
        var rowHeight = 8.6 * MM;
        var height = layout.rows * rowHeight;
        var cellWidth = width / layout.columns;

        commands.push('q 0 G 0 g 0.45 w');
        commands.push(rectCommand(x, topY - height, width, height));
        for (var column = 1; column < layout.columns; column += 1) {
            commands.push(lineCommand(x + column * cellWidth, topY, x + column * cellWidth, topY - height));
        }
        for (var row = 1; row < layout.rows; row += 1) {
            commands.push(lineCommand(x, topY - row * rowHeight, x + width, topY - row * rowHeight));
        }
        words.forEach(function(word, index) {
            var rowIndex = Math.floor(index / layout.columns);
            var columnIndex = index % layout.columns;
            commands.push(textCommand(
                x + columnIndex * cellWidth + cellWidth / 2,
                topY - rowIndex * rowHeight - rowHeight / 2 - layout.fontSize / 3,
                word,
                { size: layout.fontSize, align: 'center' }
            ));
        });
        commands.push('Q');
        return height;
    }

    function drawWordBank(commands, unit, group, x, topY, width) {
        var ribbonWidth = 14.5 * MM;
        var gridHeight = drawWordGrid(commands, group.wordList || [], x + ribbonWidth, topY, width - ribbonWidth);
        var centerY = topY - gridHeight / 2;
        commands.push(fillRectCommand(x, topY - gridHeight, ribbonWidth, gridHeight, 0));
        commands.push('q 1 g');
        commands.push(textCommand(x + ribbonWidth / 2, centerY + 4.4 * MM, 'SET', { font: 'F2', size: 7.2, align: 'center' }));
        commands.push(textCommand(x + ribbonWidth / 2, centerY - 4.5 * MM, String(groupIndex(unit, group)), { font: 'F4', size: 20, align: 'center' }));
        commands.push('Q');
        return topY - gridHeight;
    }

    function drawQuestionTable(commands, group, x, topY, width) {
        var numberWidth = NUMBER_COLUMN_WIDTH;
        var sentenceWidth = width - numberWidth;
        var headerHeight = 9 * MM;
        var questions = group.questions || [];
        var sentenceTextWidth = sentenceWidth - 8 * MM;
        var rows = questions.map(function(question, index) {
            var lines = wrapText(normalizePrompt(question.prompt || ''), sentenceTextWidth, 9.2);
            return {
                number: String(question._worksheetNumber || question.number || index + 1),
                lines: lines,
                height: Math.max(14.6 * MM, lines.length * 11.2 + 7 * MM)
            };
        });
        var available = topY - BOTTOM_Y - headerHeight;
        var total = rows.reduce(function(sum, row) { return sum + row.height; }, 0);
        if (total > available && rows.length) {
            var reduced = Math.max(12.8 * MM, available / rows.length);
            rows.forEach(function(row) { row.height = Math.min(row.height, reduced); });
        }

        commands.push('q 0 G 0 g 0.55 w');
        commands.push(rectCommand(x, topY - headerHeight, numberWidth, headerHeight));
        commands.push(rectCommand(x + numberWidth, topY - headerHeight, sentenceWidth, headerHeight));
        commands.push(textCommand(x + numberWidth / 2, topY - 6 * MM, 'No.', { font: 'F2', size: 10, align: 'center' }));
        commands.push(textCommand(x + numberWidth + sentenceWidth / 2, topY - 6 * MM, 'Sentence', { font: 'F2', size: 10, align: 'center' }));

        var y = topY - headerHeight;
        rows.forEach(function(row) {
            commands.push(rectCommand(x, y - row.height, numberWidth, row.height));
            commands.push(rectCommand(x + numberWidth, y - row.height, sentenceWidth, row.height));
            commands.push(textCommand(x + numberWidth / 2, y - row.height / 2 - 3, row.number, { size: 9.2, align: 'center' }));
            var textTop = y - 6 * MM;
            row.lines.forEach(function(line, lineIndex) {
                commands.push(textCommand(x + numberWidth + 4 * MM, textTop - lineIndex * 11.2, line, { size: 9.2 }));
            });
            y -= row.height;
        });
        commands.push('Q');
    }

    function renderGroupPage(unit, group, options, pageNumber) {
        var commands = [];
        var x = CONTENT_X;
        var y = TOP_Y;
        var width = CONTENT_WIDTH;
        drawFrame(commands, pageNumber, 'Mr. Cat Academy');

        commands.push(textCommand(x, y, cleanText(unit.id || 'Vocabulary'), { font: 'F2', size: 11.2 }));
        drawInfoTags(commands, x, y, width);
        commands.push('q 0 G 0 g 0.55 w');
        commands.push(lineCommand(x, y - 7.2 * MM, x + width - 106 * MM, y - 7.2 * MM));
        commands.push('Q');

        y -= 29 * MM;
        y = drawWordBank(commands, unit, group, x, y, width);
        y -= 8 * MM;
        drawQuestionTable(commands, group, x, y, width);
        return commands.join('\n');
    }

    function buildPdf(pages) {
        var objects = [];
        objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>';
        objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>';
        objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>';
        objects[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

        var kids = [];
        pages.forEach(function(content, index) {
            var contentId = 7 + index * 2;
            var pageId = contentId + 1;
            objects[contentId] = '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream';
            objects[pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmt(PAGE_WIDTH) + ' ' + fmt(PAGE_HEIGHT) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ' + contentId + ' 0 R >>';
            kids.push(pageId + ' 0 R');
        });
        objects[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';

        var pdf = '%PDF-1.4\n';
        var offsets = [0];
        for (var i = 1; i < objects.length; i += 1) {
            offsets[i] = pdf.length;
            pdf += i + ' 0 obj\n' + objects[i] + '\nendobj\n';
        }
        var xrefStart = pdf.length;
        pdf += 'xref\n0 ' + objects.length + '\n';
        pdf += '0000000000 65535 f \n';
        for (var index = 1; index < objects.length; index += 1) {
            pdf += String(offsets[index]).padStart(10, '0') + ' 00000 n \n';
        }
        pdf += 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';
        return new Blob([pdf], { type: 'application/pdf' });
    }

    function makeWorksheetPdfBlob(options) {
        options = options || {};
        var unit = options.unit || {};
        var groups = options.groups || [];
        if (!groups.length) throw new Error('Choose at least one group.');
        var pdfOptions = {
            shuffle: !!options.shuffle,
            seed: options.seed || makeSeed()
        };
        var pages = groups.map(function(group, index) {
            return renderGroupPage(unit, prepareGroup(group, pdfOptions), pdfOptions, index + 1);
        });
        return buildPdf(pages);
    }

    function filenameFor(options) {
        var unit = options.unit || {};
        var id = cleanText(unit.id || 'vocabulary');
        if (options.shuffle) return id + '-practice-shuffled.pdf';
        return id + '-practice-custom.pdf';
    }

    function downloadWorksheetPdf(options) {
        options = options || {};
        var blob = makeWorksheetPdfBlob(options);
        if (typeof document === 'undefined' || typeof URL === 'undefined') return blob;
        var link = document.createElement('a');
        var url = URL.createObjectURL(blob);
        link.href = url;
        link.download = options.filename || filenameFor(options);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function() {
            URL.revokeObjectURL(url);
        }, 1200);
        return blob;
    }

    return {
        makeSeed: makeSeed,
        makeWorksheetPdfBlob: makeWorksheetPdfBlob,
        downloadWorksheetPdf: downloadWorksheetPdf,
        _cleanText: cleanText,
        _shuffled: shuffled
    };
});
