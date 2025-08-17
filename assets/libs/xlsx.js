/* xlsx.mjs (C) 2013-present SheetJS -- https://sheetjs.com */
/* vim: set ts=2: */
/*jshint -W041 */
/*jshint funcscope:true, eqnull:true */
var XLSX = {};
(function make_xlsx(XLSX){
var DUPE_STR_CHECK = false;
function rstr2workbooks(data, opts) {
	var d = data;
	var o = opts||{};
	if(o.type == "base64") d = Base64.decode(d);
	d = s2a(d);
	return parsenoop(d, o);
}

function bstr2workbooks(data, opts) {
	var d = data;
	var o = opts||{};
	if(o.type == "base64") d = Base64.decode(d);
	d = b2a(d);
	return parsenoop(d, o);
}

function str2workbooks(data, opts) {
	var o = opts||{};
	if(o.type == 'base64') return rstr2workbooks(data, o);
	return bstr2workbooks(data, o);
}

function ab2workbooks(data, opts) { return parsenoop(new Uint8Array(data), opts); }

function parsenoop(data, opts) {
	var o = opts || {};
	var mode = "", ent = false;
	if(typeof o.type == "undefined") {
		var h = data.slice(0, 1024);
		var hstr = "", hhex = "";
		if(typeof TextDecoder !== "undefined") {
			try { hstr = new TextDecoder('utf-8').decode(h); } catch(e) {
				try { hstr = new TextDecoder('latin1').decode(h); } catch(e) { /* empty */ }
			}
		}
		for(var i = 0; i < h.length; ++i) {
			if(hstr.charCodeAt(i) === (h[i] & 0xFF)) continue;
			hstr = a2s(h); break;
		}
		if(hstr.length > h.length) hstr = a2s(h);
		for(i=0; i<h.length; ++i) hhex += ("0" + h[i].toString(16)).slice(-2);
		/*console.log(hstr); console.log(hhex); */

		if(data.length > 2 && h[0] == 0xEF && h[1] == 0xBB && h[2] == 0xBF) return parse_csv(a2s(data.slice(3)), o);
		if(hstr.slice(0,5) == "<?xml") return parse_xlml(hstr, o);
		if(hstr.slice(0, 9) == "<!DOCTYPE") return parse_html(hstr, o);
		if(hstr.slice(0, 10) == "MIME-Version") return parse_mht(hstr, o);
		if(hstr.slice(0, 5) == "table") return parse_html(hstr, o);
		if(hstr.match(/<meta charset *= *["']?utf-8['"]?/i)) return parse_html(hstr, o);

		if(hstr.slice(0,4) == "PK\u0003\u0004" || hstr.slice(0,2) == "PK" && hstr.charCodeAt(2) < 8 && hstr.charCodeAt(3) < 20) return parse_zip(data, o);
		if(hhex.slice(0,16) == 'd0cf11e0a1b11ae1') return parse_cfb(data, o);
		if(hhex.slice(0,4) == '0908' || hhex.slice(0,4) == '0904' || hhex.slice(0,4) == 'fdff') return parse_cfb(data, o);

		if(hstr.indexOf("<meta") > -1) return parse_html(hstr, o);
		if(hstr.indexOf("<style") > -1) return parse_html(hstr, o);
		if(hstr.indexOf("<table") > -1) return parse_html(hstr, o);
		if(hstr.indexOf("</body") > -1) return parse_html(hstr, o);

		if(hstr.indexOf(",") != -1 || hstr.indexOf("\t") != -1 || hstr.indexOf(";") != -1) return parse_csv(hstr, o);
	}
	switch(o.type) {
		case 'base64': return ab2workbooks(s2a(Base64.decode(data)), o);
		case 'binary': return ab2workbooks(s2a(data), o);
		case 'string': return ab2workbooks(b2a(data), o);
		case 'buffer': case 'file': return ab2workbooks(data, o);
		case 'array': return ab2workbooks(data, o);
	}
	throw new Error("Unsupported file type");
}
function writenoo(wb, opts) {
	var o = opts||{};
	switch(o.bookType) {
		case 'biff8': case 'biff5': case 'biff2':
		case 'xlml': case 'xlsm': case 'xlsx': return write_zip(wb, o);
		case 'fods': case 'ods': return write_ods(wb, o);
		case 'csv': return write_csv(wb, o);
		case 'txt': return write_txt(wb, o);
		case 'sylk': case 'slk': return write_slk(wb, o);
		case 'html': return write_html(wb, o);
		case 'dif': return write_dif(wb, o);
		case 'dbf': return write_dbf(wb, o);
		case 'prn': return write_prn(wb, o);
		case 'rtf': return write_rtf(wb, o);
		case 'eth': return write_eth(wb, o);
	}
	throw new Error("Cannot find writer for type " + o.bookType);
}

/*::
declare var Base64:any;
declare var define:any;
declare var CRC32:any;
declare var ADLER32:any;
declare var require:any;
declare var module:any;
declare var Uint8Array:any;
declare var Uint16Array:any;
declare var Uint32Array:any;
declare var Int32Array:any;
declare var ArrayBuffer:any;
declare var Float64Array:any;
declare var DataView:any;
*/
var has_buf = (typeof Buffer !== 'undefined');

var Buffer_from = (function(){
	if(typeof Buffer === 'undefined') return null;
	var nbfs = !Buffer.from;
	if(!nbfs) try { Buffer.from("foo", "utf8"); } catch(e) { nbfs = true; }
	if(!nbfs) return Buffer.from;
	return function(buf, enc) { return (enc) ? new Buffer(buf, enc) : new Buffer(buf); };
})();


function new_raw_buf(len/*:number*/)/*:any*/ {
	/* jshint -W056 */
	if(has_buf) return Buffer.alloc ? Buffer.alloc(len) : new Buffer(len);
	var arr = new Array(len);
	for(var i=0; i<len; ++i) arr[i] = 0;
	return arr;
	/* jshint +W056 */
}
function new_buf(len/*:number*/)/*:any*/ {
	/* jshint -W056 */
	if(has_buf) return Buffer.alloc(len);
	return new Uint8Array(len);
	/* jshint +W056 */
}

var s2a = function s2a(s/*:string*/)/*:any*/ {
	if(has_buf) {
		var o = Buffer_from(s, "binary");
		return o;
	}
	var o = new Uint8Array(s.length);
	for(var i = 0; i < s.length; ++i) o[i] = s.charCodeAt(i);
	return o;
};

var b2a = function b2a(s/*:string*/)/*:any*/ {
	if(has_buf) {
		var o = Buffer_from(s, "utf8");
		return o;
	}
	var o = new Uint8Array(s.length);
	for(var i = 0; i < s.length; ++i) o[i] = s.charCodeAt(i);
	return o;
};

var a2s = function a2s(data/*:any*/)/*:string*/ {
	if(has_buf && Buffer.isBuffer(data)) return data.toString('binary');
	if(data.toString) return data.toString('binary');
	var o = "";
	for(var i = 0; i < data.length; ++i) o += String.fromCharCode(data[i]);
	return o;
};

var a2u = function a2u(data/*:any*/)/*:string*/ {
	if(typeof TextDecoder !== "undefined") try { return new TextDecoder("utf8").decode(data); } catch(e) { /* continue */ }
	if(has_buf && Buffer.isBuffer(data)) return data.toString('utf8');
	return utf8read(a2s(data));
};

function s2ab(s/*:string*/)/*:ArrayBuffer*/ {
	var L = s.length, i, o;
	var b = new ArrayBuffer(L);
	o = new Uint8Array(b);
	for(i=0; i<L; ++i) o[i] = s.charCodeAt(i);
	return b;
}

function ab2s(ab/*:ArrayBuffer*/)/*:string*/ {
	var o = new Uint8Array(ab), L = o.length, s = "", i;
	for(i=0; i<L; ++i) s += String.fromCharCode(o[i]);
	return s;
}

var bconcat = function(bufs) { return has_buf ? Buffer.concat(bufs.map(function(buf) { return Buffer.isBuffer(buf) ? buf : Buffer_from(buf); })) : [].concat.apply([], bufs.map(function(buf) { return Array.isArray(buf) ? buf : [].slice.call(buf); })); };

var chr0 = /\u0000/g, chr1 = /[\u0001-\u0006]/g;
/* from js-xls */
if(typeof cptable === 'undefined') var cptable = {};
function reset_cp() {
	cptable[1200] = cptable[1252];
}
var current_codepage = 1252, current_ansi = 1252;
function set_cp(cp) { current_codepage = cp; }
function set_ansi(cp) { current_ansi = cp; }
function codeshift(C/*:number*/, o/*:string*/)/*:string*/ {
	if(C.slice(0, 19) == "THIS IS A WONDERFUL") return o;
	var L = o.length, i, j, c, d = [];
	for(i=0; i<L; ++i) if((c=o.charCodeAt(i)) < 0x80) d.push(String.fromCharCode(c)); else {
		var w = cptable[C][c];
		if(w === undefined) w = "?";
		if(typeof w === "number") w = String.fromCharCode(w);
		for(j=0; j<w.length; ++j) d.push(w.charAt(j));
	}
	return d.join("");
}

var debom = function(text) {
	var c = text.charCodeAt(0);
	if(c === 0xFFFE) return text.slice(1);
	if(c === 0xFEFF) return text.slice(1);
	return text;
};

var has_vbar = (function(){ try{ var a = new RegExp("|"); return true; } catch(e) { return false; }})();
/*
 1. Remove comment lines starting with `<!--`
 2. Remove CDATA sections `<![CDATA[ ... 