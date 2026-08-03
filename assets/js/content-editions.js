(function(root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MrCatEditions = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
    'use strict';

    function text(value) {
        return String(value == null ? '' : value).trim();
    }

    function setId(item) {
        return text(item && (item.set_id || item.id));
    }

    function family(item) {
        return text(item && (item.edition_family || item.editionFamily)) || setId(item);
    }

    function number(item) {
        var value = Number(item && (item.edition_number == null ? item.editionNumber : item.edition_number));
        return Number.isInteger(value) && value > 0 ? value : 1;
    }

    function label(item) {
        return text(item && (item.edition_label || item.editionLabel)) || 'V' + number(item);
    }

    function isLatest(item) {
        return Boolean(item && (item.is_latest_edition === true || item.isLatestEdition === true));
    }

    function hasEditionMetadata(item) {
        return Boolean(text(item && (item.edition_family || item.editionFamily)));
    }

    function compare(left, right) {
        if (isLatest(left) !== isLatest(right)) return isLatest(left) ? -1 : 1;
        return number(right) - number(left) || setId(left).localeCompare(setId(right));
    }

    function tag(item) {
        return label(item) + (isLatest(item) ? ' (latest)' : ' (previous)');
    }

    function group(items) {
        var groups = {};
        (items || []).forEach(function(item) {
            var key = family(item);
            if (!key) return;
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        });
        return Object.keys(groups).map(function(key) {
            var editions = groups[key].slice().sort(compare);
            return {
                family: key,
                editions: editions,
                representative: editions[0],
                versioned: editions.length > 1 && editions.some(hasEditionMetadata)
            };
        });
    }

    function editionsFor(items, familyId) {
        var wanted = text(familyId);
        return (items || []).filter(function(item) {
            return family(item) === wanted;
        }).sort(compare);
    }

    return {
        compare: compare,
        editionsFor: editionsFor,
        family: family,
        group: group,
        hasEditionMetadata: hasEditionMetadata,
        isLatest: isLatest,
        label: label,
        number: number,
        setId: setId,
        tag: tag
    };
});
