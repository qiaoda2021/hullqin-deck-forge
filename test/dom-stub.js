/*!
 * dom-stub.js — 够用的假 DOM（只为无头测试面板而写，不追求规范完整）
 * 支持：createElement / append / appendChild / textContent / className / style /
 *       addEventListener + click() / attachShadow / querySelectorAll('.class') /
 *       getElementById / body / keydown 派发
 */
'use strict';

function El(tag) {
  this.tagName = String(tag || 'div').toUpperCase();
  this.nodeName = this.tagName;
  this.children = [];
  this.parentNode = null;
  this.className = '';
  this.style = {};
  this.id = '';
  this.title = '';
  this.type = '';
  this.disabled = false;
  this._text = '';
  this._listeners = {};
  this.shadowRoot = null;
}

Object.defineProperty(El.prototype, 'textContent', {
  get: function () {
    if (this.children.length) {
      return this._text + this.children.map(function (c) { return c.textContent; }).join('');
    }
    return this._text;
  },
  set: function (v) {
    this._text = v === undefined || v === null ? '' : String(v);
    this.children.forEach(function (c) { c.parentNode = null; });
    this.children = [];
  }
});

Object.defineProperty(El.prototype, 'firstChild', {
  get: function () { return this.children.length ? this.children[0] : null; }
});

El.prototype.appendChild = function (child) {
  if (child == null) return child;
  child.parentNode = this;
  this.children.push(child);
  return child;
};

El.prototype.append = function () {
  for (let i = 0; i < arguments.length; i++) {
    const a = arguments[i];
    if (a == null) continue;
    if (typeof a === 'string') this.appendChild(new Text(a));
    else this.appendChild(a);
  }
};

El.prototype.removeChild = function (child) {
  const i = this.children.indexOf(child);
  if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
  return child;
};

El.prototype.setAttribute = function (k, v) { this[k] = String(v); };
El.prototype.getAttribute = function (k) { return this[k] === undefined ? null : String(this[k]); };

El.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] || (this._listeners[type] = [])).push(fn);
};

El.prototype.removeEventListener = function (type, fn) {
  const arr = this._listeners[type] || [];
  const i = arr.indexOf(fn);
  if (i >= 0) arr.splice(i, 1);
};

El.prototype.dispatch = function (type, extra) {
  const ev = Object.assign({
    type: type, target: this, preventDefault: function () { this.defaultPrevented = true; },
    stopPropagation: function () {}
  }, extra || {});
  let node = this;
  while (node) {
    const arr = (node._listeners || {})[type];
    if (arr) arr.slice().forEach(function (fn) { fn(ev); });
    node = node.parentNode;
  }
  return ev;
};

El.prototype.click = function () { this.dispatch('click'); };
El.prototype.setPointerCapture = function () {};

El.prototype.attachShadow = function () {
  const sr = new El('#shadow-root');
  sr.host = this;
  this.shadowRoot = sr;
  return sr;
};

El.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 442, height: 400, right: 442, bottom: 400 };
};

El.prototype._walk = function (out) {
  out.push(this);
  for (let i = 0; i < this.children.length; i++) this.children[i]._walk && this.children[i]._walk(out);
  if (this.shadowRoot) this.shadowRoot._walk(out);
  return out;
};

El.prototype.querySelectorAll = function (sel) {
  const all = this._walk([]);
  if (typeof sel !== 'string' || sel[0] !== '.') return [];
  const cls = sel.slice(1);
  return all.filter(function (n) {
    if (!n.className) return false;
    return String(n.className).split(/\s+/).indexOf(cls) >= 0;
  });
};

function Text(s) {
  this.nodeType = 3;
  this._text = String(s);
  this.children = [];
  this.className = '';
  this.parentNode = null;
}
Object.defineProperty(Text.prototype, 'textContent', {
  get: function () { return this._text; }
});
Text.prototype._walk = function (out) { out.push(this); return out; };

function Doc() {
  this.body = new El('body');
  this.readyState = 'complete';
  this._listeners = {};
  this._byId = {};
}
Doc.prototype.createElement = function (tag) { return new El(tag); };
Doc.prototype.createTextNode = function (s) { return new Text(s); };
Doc.prototype.querySelectorAll = function () { return []; };
Doc.prototype.getElementById = function (id) { return this._byId[String(id)] || null; };
Doc.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] || (this._listeners[type] = [])).push(fn);
};
Doc.prototype.dispatch = function (type, extra) {
  const ev = Object.assign({ type: type, target: this.body, preventDefault: function () {} }, extra || {});
  (this._listeners[type] || []).slice().forEach(function (fn) { fn(ev); });
  return ev;
};
Doc.prototype.mount = function (el) { return this.body.appendChild(el); };

module.exports = { El: El, Text: Text, Doc: Doc, create: function () { return new Doc(); } };
