/* Dependency-free OOXML workbook writer. All strings are literal cell values. */
(function (root) {
  'use strict';

  var MAX_ROWS = 1048576;
  var MAX_COLUMNS = 16384;
  var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  var MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var encoder = new TextEncoder();
  var crcTable = new Uint32Array(256);
  for (var t = 0; t < 256; t++) {
    var c = t;
    for (var bit = 0; bit < 8; bit++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[t] = c >>> 0;
  }

  function cleanXml(value) {
    var result = '';
    for (var character of value) {
      var code = character.codePointAt(0);
      if (code === 9 || code === 10 || code === 13 ||
          (code >= 32 && code <= 0xD7FF) ||
          (code >= 0xE000 && code <= 0xFFFD) ||
          (code >= 0x10000 && code <= 0x10FFFF)) result += character;
    }
    return result;
  }

  function escapeXml(value) {
    return cleanXml(value).replace(/[&<>"'\r]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\r': '&#13;' }[character];
    });
  }

  function columnName(index) {
    var name = '';
    for (index++; index; index = Math.floor((index - 1) / 26)) {
      name = String.fromCharCode(65 + ((index - 1) % 26)) + name;
    }
    return name;
  }

  function truncateName(value, limit) {
    var result = '';
    for (var character of value) {
      if (result.length + character.length > limit) break;
      result += character;
    }
    return result;
  }

  function sheetName(value, index, used) {
    if (value === undefined) value = 'Sheet' + (index + 1);
    if (typeof value !== 'string') throw new TypeError('Sheet name must be a string');
    var base = cleanXml(value).replace(/[\\/?*\[\]:]/g, '_').trim().replace(/^'+|'+$/g, '');
    base = truncateName(base, 31).replace(/'+$/g, '') || 'Sheet' + (index + 1);
    var name = base;
    var suffix = 2;
    while (used.has(name.toLowerCase())) {
      var ending = ' (' + suffix++ + ')';
      name = truncateName(base, 31 - ending.length) + ending;
    }
    used.add(name.toLowerCase());
    return name;
  }

  function dateSerial(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new TypeError('Date cells require YYYY-MM-DD');
    }
    var parts = value.split('-').map(Number);
    var year = parts[0], month = parts[1], day = parts[2];
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
      throw new RangeError('Date is invalid or outside 1900-9999');
    }
    var serial = (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 31)) / 86400000;
    return serial + (value >= '1900-03-01' ? 1 : 0);
  }

  function cellXml(cell, reference, palette) {
    var format = 0, value = cell, type = typeof cell;
    if (cell !== null && type === 'object') {
      if (Array.isArray(cell) || Object.keys(cell).some(function (key) { return key !== 'type' && key !== 'value'; })) {
        throw new TypeError('Unsupported cell object at ' + reference);
      }
      if (cell.type === 'percent') {
        if (typeof cell.value !== 'number' || !Number.isFinite(cell.value)) throw new TypeError('Percent must be finite at ' + reference);
        value = cell.value;
        format = 1;
      } else if (cell.type === 'date') {
        value = dateSerial(cell.value);
        format = 2;
      } else {
        throw new TypeError('Unsupported cell object at ' + reference);
      }
      type = 'number';
    }
    var start = '<c r="' + reference + '" s="' + (palette * 3 + format) + '"';
    if (cell === null) return start + '/>';
    if (type === 'string') return start + ' t="inlineStr"><is><t xml:space="preserve">' + escapeXml(value) + '</t></is></c>';
    if (type === 'boolean') return start + ' t="b"><v>' + (value ? 1 : 0) + '</v></c>';
    if (type === 'number' && Number.isFinite(value)) return start + ' t="n"><v>' + String(value) + '</v></c>';
    throw new TypeError('Unsupported or non-finite cell at ' + reference);
  }

  function stylesXml() {
    var fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    ['E3F3E8', 'FBE4E5', 'FFF4CC', '3D3BFF'].forEach(function (color) {
      fills.push('<fill><patternFill patternType="solid"><fgColor rgb="FF' + color + '"/><bgColor indexed="64"/></patternFill></fill>');
    });
    var xfs = [];
    for (var palette = 0; palette < 5; palette++) {
      for (var format = 0; format < 3; format++) {
        xfs.push('<xf numFmtId="' + (format ? 163 + format : 0) + '" fontId="' + (palette === 4 ? 1 : 0) +
          '" fillId="' + (palette ? palette + 1 : 0) + '" borderId="0" xfId="0" applyFont="1" applyFill="1"' +
          (format ? ' applyNumberFormat="1"' : '') + '/>');
      }
    }
    return XML + '<styleSheet xmlns="' + MAIN + '">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="DD.MM.YYYY"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><color rgb="FF000000"/><name val="Graphik"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Graphik"/></font></fonts>' +
      '<fills count="6">' + fills.join('') + '</fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="15">' + xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
      '</styleSheet>';
  }

  function worksheetXml(sheet) {
    if (!sheet || typeof sheet !== 'object' || !Array.isArray(sheet.rows)) throw new TypeError('Each sheet requires a rows array');
    var rows = sheet.rows;
    if (rows.length > MAX_ROWS) throw new RangeError('Worksheet exceeds 1048576 rows');
    var columns = 0;
    for (var r = 0; r < rows.length; r++) {
      if (!Array.isArray(rows[r])) throw new TypeError('Each row must be an array');
      if (rows[r].length > MAX_COLUMNS) throw new RangeError('Worksheet exceeds 16384 columns');
      columns = Math.max(columns, rows[r].length);
    }
    var widths = sheet.widths === undefined ? [] : sheet.widths;
    if (!Array.isArray(widths) || widths.length > MAX_COLUMNS) throw new RangeError('Invalid column widths');
    for (var w = 0; w < widths.length; w++) {
      if (typeof widths[w] !== 'number' || !Number.isFinite(widths[w])) throw new TypeError('Column widths must be finite numbers');
    }
    var rowStyles = sheet.rowStyles === undefined ? [] : sheet.rowStyles;
    var palettes = { growth: 1, 'decline-large': 2, 'decline-small': 3, neutral: 0 };
    if (!Array.isArray(rowStyles) || rowStyles.length > rows.length) throw new TypeError('Invalid rowStyles array');
    for (var rs = 0; rs < rowStyles.length; rs++) {
      if (rowStyles[rs] !== null && (typeof rowStyles[rs] !== 'string' || !Object.prototype.hasOwnProperty.call(palettes, rowStyles[rs]))) throw new TypeError('Unsupported row style');
    }
    var freeze = sheet.freezeRows === undefined ? 1 : sheet.freezeRows;
    if (!Number.isInteger(freeze) || freeze < 0 || freeze >= MAX_ROWS) throw new RangeError('Invalid freezeRows');
    if (sheet.autoFilter !== undefined && typeof sheet.autoFilter !== 'boolean') throw new TypeError('autoFilter must be boolean');
    var range = columns && rows.length ? 'A1:' + columnName(columns - 1) + rows.length : 'A1';
    var result = [XML, '<worksheet xmlns="' + MAIN + '"><dimension ref="' + range + '"/>', '<sheetViews><sheetView workbookViewId="0">'];
    if (freeze) {
      result.push('<pane ySplit="' + freeze + '" topLeftCell="A' + (freeze + 1) + '" activePane="bottomLeft" state="frozen"/>',
        '<selection pane="bottomLeft" activeCell="A' + (freeze + 1) + '" sqref="A' + (freeze + 1) + '"/>');
    }
    result.push('</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>');
    if (widths.length) {
      result.push('<cols>');
      widths.forEach(function (width, index) {
        result.push('<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + Math.min(80, Math.max(4, width)) + '" customWidth="1"/>');
      });
      result.push('</cols>');
    }
    result.push('<sheetData>');
    for (var row = 0; row < rows.length; row++) {
      var palette = row === 0 ? 4 : (rowStyles[row] == null ? 0 : palettes[rowStyles[row]]);
      result.push('<row r="' + (row + 1) + '" s="' + (palette * 3) + '" customFormat="1">');
      for (var col = 0; col < columns; col++) {
        result.push(cellXml(col < rows[row].length ? rows[row][col] : null, columnName(col) + (row + 1), palette));
      }
      result.push('</row>');
    }
    result.push('</sheetData>');
    if (sheet.autoFilter !== false && rows.length && columns) result.push('<autoFilter ref="' + range + '"/>');
    result.push('</worksheet>');
    return result.join('');
  }

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(entries) {
    if (entries.length > 65535) throw new RangeError('Too many ZIP entries');
    var offset = 0, centralSize = 0;
    var files = entries.map(function (entry) {
      var name = encoder.encode(entry[0]), data = encoder.encode(entry[1]);
      var file = { name: name, data: data, crc: crc32(data), offset: offset };
      offset += 30 + name.length + data.length;
      centralSize += 46 + name.length;
      return file;
    });
    var total = offset + centralSize + 22;
    if (total > 0xFFFFFFFF) throw new RangeError('Workbook requires ZIP64');
    var bytes = new Uint8Array(total), view = new DataView(bytes.buffer), at = 0;
    function u16(value) { view.setUint16(at, value, true); at += 2; }
    function u32(value) { view.setUint32(at, value, true); at += 4; }
    function copy(value) { bytes.set(value, at); at += value.length; }
    files.forEach(function (file) {
      u32(0x04034B50); u16(20); u16(0x0800); u16(0); u16(0); u16(33);
      u32(file.crc); u32(file.data.length); u32(file.data.length); u16(file.name.length); u16(0);
      copy(file.name); copy(file.data);
    });
    files.forEach(function (file) {
      u32(0x02014B50); u16(20); u16(20); u16(0x0800); u16(0); u16(0); u16(33);
      u32(file.crc); u32(file.data.length); u32(file.data.length); u16(file.name.length);
      u16(0); u16(0); u16(0); u16(0); u32(0); u32(file.offset); copy(file.name);
    });
    u32(0x06054B50); u16(0); u16(0); u16(files.length); u16(files.length); u32(centralSize); u32(offset); u16(0);
    return bytes;
  }

  function writeWorkbook(sheets) {
    if (!Array.isArray(sheets) || !sheets.length) throw new TypeError('Workbook requires at least one sheet');
    if (sheets.length > 65530) throw new RangeError('Too many worksheets for ZIP');
    var used = new Set(), names = [], worksheetEntries = [];
    for (var index = 0; index < sheets.length; index++) {
      var sheet = sheets[index];
      var xml = worksheetXml(sheet);
      names.push(sheetName(sheet.name, index, used));
      worksheetEntries.push(['xl/worksheets/sheet' + (index + 1) + '.xml', xml]);
    }
    var types = XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      names.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>';
    var workbook = XML + '<workbook xmlns="' + MAIN + '" xmlns:r="' + REL + '"><workbookPr date1904="0"/>' +
      '<bookViews><workbookView/></bookViews><sheets>' + names.map(function (name, i) {
        return '<sheet name="' + escapeXml(name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>';
    var workbookRels = XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="' + REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (names.length + 1) + '" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>';
    return zip([
      ['[Content_Types].xml', types],
      ['_rels/.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', workbookRels], ['xl/styles.xml', stylesXml()]
    ].concat(worksheetEntries));
  }

  var api = { writeWorkbook: writeWorkbook };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashboardXlsx = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
