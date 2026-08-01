(function(root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.MrCatMyWordsExport = api;
})(typeof window !== 'undefined' ? window : null, function() {
    'use strict';

    var FIELD_DEFINITIONS = {
        english: { label: 'English', width: 22 },
        chinese: { label: 'Chinese', width: 24 },
        part_of_speech: { label: 'Part of Speech', width: 16 },
        phonetic: { label: 'Phonetic', width: 18 },
        english_definition: { label: 'English Definition', width: 44 },
        source: { label: 'Source', width: 28 },
        context: { label: 'Saved Example / Context', width: 50 },
        note: { label: 'My Note', width: 42 },
        saved_date: { label: 'Saved Date', width: 16 }
    };

    function dictionaryFor(word) { return word && word.dictionary || {}; }
    function savedExamples(word) {
        return word && Array.isArray(word.saved_examples) ? word.saved_examples : [];
    }
    function uniqueLines(values) {
        return values.map(function(value) { return String(value || '').trim(); })
            .filter(function(value, index, all) { return value && all.indexOf(value) === index; })
            .join('\n');
    }
    function shanghaiDate(value) {
        var date = value ? new Date(value) : null;
        if (!date || Number.isNaN(date.getTime())) return '';
        var parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(date);
        var result = {};
        parts.forEach(function(part) { if (part.type !== 'literal') result[part.type] = part.value; });
        return [result.year, result.month, result.day].filter(Boolean).join('-');
    }
    function cellValue(word, field) {
        var dictionary = dictionaryFor(word);
        var examples = savedExamples(word);
        if (field === 'english') return word && word.text || '';
        if (field === 'chinese') return dictionary.chinese_meaning || '';
        if (field === 'part_of_speech') return dictionary.part_of_speech || '';
        if (field === 'phonetic') return dictionary.phonetic || '';
        if (field === 'english_definition') return dictionary.english_definition || '';
        if (field === 'source') return uniqueLines([word && (word.source_title || word.source_set_id)].concat(examples.map(function(example) {
            return example.source_title || example.source_set_id;
        })));
        if (field === 'context') {
            var lines = examples.map(function(example) {
                return example.context ? '[' + (example.form || word.text || 'Saved form') + '] ' + example.context : '';
            });
            if (!lines.some(Boolean) && word && word.context) lines.push(word.context);
            return uniqueLines(lines);
        }
        if (field === 'note') return word && word.personal_note || '';
        if (field === 'saved_date') {
            return shanghaiDate(word && (word.activity_updated_at || word.last_added_at || word.created_at));
        }
        return '';
    }

    function normalizeFields(fields) {
        var selected = Array.isArray(fields) ? fields.filter(function(field) { return FIELD_DEFINITIONS[field]; }) : [];
        if (selected.indexOf('english') === -1) selected.unshift('english');
        return selected.filter(function(field, index) { return selected.indexOf(field) === index; });
    }

    function tableData(words, fields) {
        var selected = normalizeFields(fields);
        return {
            fields: selected,
            headers: selected.map(function(field) { return FIELD_DEFINITIONS[field].label; }),
            rows: (words || []).map(function(word) {
                return selected.map(function(field) { return cellValue(word, field); });
            })
        };
    }

    function xmlEscape(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    function columnName(index) {
        var output = '';
        for (var value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
            output = String.fromCharCode(65 + ((value - 1) % 26)) + output;
        }
        return output;
    }

    function workbookFiles(words, fields) {
        var data = tableData(words, fields);
        var maxColumn = columnName(data.fields.length - 1);
        var headerCells = data.headers.map(function(value, index) {
            return '<c r="' + columnName(index) + '1" t="inlineStr" s="1"><is><t>' + xmlEscape(value) + '</t></is></c>';
        }).join('');
        var rows = data.rows.map(function(row, rowIndex) {
            var number = rowIndex + 2;
            return '<row r="' + number + '">' + row.map(function(value, columnIndex) {
                return '<c r="' + columnName(columnIndex) + number + '" t="inlineStr" s="2"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>';
            }).join('') + '</row>';
        }).join('');
        var columns = data.fields.map(function(field, index) {
            var width = FIELD_DEFINITIONS[field].width;
            return '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>';
        }).join('');
        return {
            '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
            '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="My Words" sheetId="1" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
            'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF13766D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFDDE8E4"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>',
            'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' + columns + '</cols><sheetData><row r="1" ht="24" customHeight="1">' + headerCells + '</row>' + rows + '</sheetData><autoFilter ref="A1:' + maxColumn + Math.max(1, data.rows.length + 1) + '"/><pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>'
        };
    }

    var crcTable = null;
    function crc32(bytes) {
        if (!crcTable) {
            crcTable = [];
            for (var n = 0; n < 256; n++) {
                var c = n;
                for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                crcTable[n] = c >>> 0;
            }
        }
        var crc = 0 ^ -1;
        for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
        return (crc ^ -1) >>> 0;
    }

    function littleEndian(value, length) {
        var bytes = new Uint8Array(length);
        for (var i = 0; i < length; i++) bytes[i] = (value >>> (i * 8)) & 0xFF;
        return bytes;
    }

    function joinBytes(parts) {
        var length = parts.reduce(function(sum, part) { return sum + part.length; }, 0);
        var output = new Uint8Array(length);
        var offset = 0;
        parts.forEach(function(part) { output.set(part, offset); offset += part.length; });
        return output;
    }

    function zipStore(files) {
        var encoder = new TextEncoder();
        var locals = [];
        var centrals = [];
        var offset = 0;
        Object.keys(files).forEach(function(name) {
            var nameBytes = encoder.encode(name);
            var data = encoder.encode(files[name]);
            var crc = crc32(data);
            var local = joinBytes([
                littleEndian(0x04034b50, 4), littleEndian(20, 2), littleEndian(0x0800, 2), littleEndian(0, 2),
                littleEndian(0, 2), littleEndian(0, 2), littleEndian(crc, 4), littleEndian(data.length, 4), littleEndian(data.length, 4),
                littleEndian(nameBytes.length, 2), littleEndian(0, 2), nameBytes, data
            ]);
            locals.push(local);
            centrals.push(joinBytes([
                littleEndian(0x02014b50, 4), littleEndian(20, 2), littleEndian(20, 2), littleEndian(0x0800, 2), littleEndian(0, 2),
                littleEndian(0, 2), littleEndian(0, 2), littleEndian(crc, 4), littleEndian(data.length, 4), littleEndian(data.length, 4),
                littleEndian(nameBytes.length, 2), littleEndian(0, 2), littleEndian(0, 2), littleEndian(0, 2), littleEndian(0, 2),
                littleEndian(0, 4), littleEndian(offset, 4), nameBytes
            ]));
            offset += local.length;
        });
        var centralData = joinBytes(centrals);
        return joinBytes(locals.concat([centralData, joinBytes([
            littleEndian(0x06054b50, 4), littleEndian(0, 2), littleEndian(0, 2), littleEndian(centrals.length, 2),
            littleEndian(centrals.length, 2), littleEndian(centralData.length, 4), littleEndian(offset, 4), littleEndian(0, 2)
        ])]));
    }

    function makeXlsxBlob(words, fields) {
        return new Blob([zipStore(workbookFiles(words, fields))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }

    function downloadExcel(words, fields) {
        downloadBlob(makeXlsxBlob(words, fields), 'my-words-' + new Date().toISOString().slice(0, 10) + '.xlsx');
    }

    function printableHtml(words, fields) {
        var data = tableData(words, fields);
        var head = data.headers.map(function(value) { return '<th>' + xmlEscape(value) + '</th>'; }).join('');
        var body = data.rows.map(function(row) {
            return '<tr>' + row.map(function(value) { return '<td>' + xmlEscape(value).replace(/\n/g, '<br>') + '</td>'; }).join('') + '</tr>';
        }).join('');
        return '<!doctype html><html><head><meta charset="utf-8"><title>My Words</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans CJK SC",sans-serif;color:#18332f}h1{margin:0 0 4px;font-size:22px}p{margin:0 0 16px;color:#637871;font-size:11px}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px}th{padding:8px 7px;color:#fff;background:#13766d;text-align:left}td{padding:7px;vertical-align:top;border-bottom:1px solid #dce8e4;overflow-wrap:anywhere;white-space:normal}tr{break-inside:avoid}tbody tr:nth-child(even){background:#f5f9f7}</style></head><body><h1>My Words</h1><p>' + data.rows.length + ' words - ' + new Date().toLocaleDateString('en-GB') + '</p><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table><script>window.addEventListener("load",function(){setTimeout(function(){window.print()},120)})<\/script></body></html>';
    }

    function printPdf(words, fields) {
        var popup = window.open('', '_blank');
        if (!popup) throw new Error('Allow pop-ups to export PDF.');
        popup.opener = null;
        popup.document.open();
        popup.document.write(printableHtml(words, fields));
        popup.document.close();
    }

    return {
        FIELD_DEFINITIONS: FIELD_DEFINITIONS,
        tableData: tableData,
        workbookFiles: workbookFiles,
        makeXlsxBlob: makeXlsxBlob,
        downloadExcel: downloadExcel,
        printableHtml: printableHtml,
        printPdf: printPdf
    };
});
