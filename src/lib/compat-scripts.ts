/**
 * 兼容性引导脚本（内联进 <head>，必须是最早期的 ES5，不经打包、不依赖任何 polyfill 之外的东西）。
 *
 * 两件事：
 *   1. POLYFILLS —— 补齐 ES2020 底线上仍然缺的内置方法。
 *      产物语法底线是 ES2020（见 next.config.ts 注释与 scripts/syntax-floor.mjs），
 *      但 ES2020 的引擎（Chrome 80 / Safari 13.1）并没有 Array.prototype.at（Chrome 92 / Safari 15.4）、
 *      Object.hasOwn、String.replaceAll、structuredClone 这些东西 —— Next 自身的 chunk 里就用了 .at()。
 *      缺一个就是 TypeError，整个交互链断掉，所以用特性检测补上。
 *   2. FLOOR_CHECK —— 语法都解析不了的内核（Chrome < 80、iOS < 13.1 这类）里，
 *      任何脚本都跑不起来，页面会停在「服务端渲染出来的静态样子」。这时至少给一句人话解释，
 *      而不是让用户对着点不动的按钮发呆。
 *
 * 写法约束：只用 ES5（var / function / 字符串拼接），不能有箭头函数、模板串、?.
 * —— 这段代码本身要在最老的核心里被执行。
 */

export const POLYFILLS = `(function(){
  var AP = Array.prototype, SP = String.prototype;
  function def(o, k, v) {
    try {
      Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: false });
    } catch (e) { o[k] = v; }
  }
  function toInt(n) {
    var i = Number(n) || 0;
    if (i !== i) return 0;               /* NaN */
    return i < 0 ? Math.ceil(i) : Math.floor(i);
  }
  /* Array.prototype.at —— Next 的 flight 解析器在用，缺了会直接抛错 */
  if (!AP.at) {
    def(AP, "at", function (n) {
      var o = Object(this), len = o.length >>> 0, k = toInt(n);
      if (k < 0) k += len;
      return k < 0 || k >= len ? undefined : o[k];
    });
  }
  if (!SP.at) {
    def(SP, "at", function (n) {
      var s = String(this), len = s.length, k = toInt(n);
      if (k < 0) k += len;
      return k < 0 || k >= len ? undefined : s.charAt(k);
    });
  }
  if (!Object.hasOwn) {
    def(Object, "hasOwn", function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
  }
  if (!Object.fromEntries) {
    def(Object, "fromEntries", function (it) {
      var o = {};
      if (!it) return o;
      for (var i = 0; i < it.length; i++) o[it[i][0]] = it[i][1];
      return o;
    });
  }
  if (!SP.replaceAll) {
    def(SP, "replaceAll", function (find, rep) {
      var s = String(this);
      if (find instanceof RegExp) return s.split(find).join(rep);
      return s.split(String(find)).join(rep);
    });
  }
  if (!Promise.allSettled) {
    def(Promise, "allSettled", function (list) {
      return Promise.all(
        (list || []).map(function (p) {
          return Promise.resolve(p).then(
            function (v) { return { status: "fulfilled", value: v }; },
            function (e) { return { status: "rejected", reason: e }; }
          );
        })
      );
    });
  }
  if (!AP.flat) {
    def(AP, "flat", function (depth) {
      var d = depth === undefined ? 1 : toInt(depth), out = [];
      (function go(arr, lv) {
        for (var i = 0; i < arr.length; i++) {
          if (AP.slice && Object.prototype.toString.call(arr[i]) === "[object Array]" && lv > 0) go(arr[i], lv - 1);
          else out.push(arr[i]);
        }
      })(this, d);
      return out;
    });
  }
  if (!AP.flatMap) {
    def(AP, "flatMap", function (fn, thisArg) {
      var out = [];
      for (var i = 0; i < this.length; i++) {
        var r = fn.call(thisArg, this[i], i, this);
        if (Object.prototype.toString.call(r) === "[object Array]") {
          for (var j = 0; j < r.length; j++) out.push(r[j]);
        } else out.push(r);
      }
      return out;
    });
  }
  if (typeof globalThis === "undefined") {
    try { window.globalThis = window; } catch (e) {}
  }
  if (typeof window.queueMicrotask !== "function") {
    window.queueMicrotask = function (cb) {
      Promise.resolve().then(cb).catch(function (e) { setTimeout(function () { throw e; }, 0); });
    };
  }
  if (typeof window.structuredClone !== "function") {
    window.structuredClone = function (v) {
      try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
    };
  }
})();`;

/**
 * 语法底线探测 + 兜底提示。
 *
 * 用 new Function 去「解析」一段 ES2020 语法：解析不了就抛 SyntaxError（可捕获），
 * 说明这个内核连脚本都装不进去，页面交互必然不可用。此时插一条提示条。
 * 提示条用纯 DOM + 内联样式画，不依赖任何样式表（此时 Tailwind 的产物它也读不懂）。
 */
export const FLOOR_CHECK = `(function(){
  var ok = false;
  try { new Function("var o={a:1};return (o && o.a) ?? 1;"); ok = true; } catch (e) {}
  if (ok) return;
  function show() {
    if (document.getElementById("__compat_notice")) return;
    var box = document.createElement("div");
    box.id = "__compat_notice";
    box.setAttribute("style", [
      "position:fixed","left:0","right:0","bottom:0","z-index:2147483647",
      "background:#17181a","color:#faf8f3","padding:12px 44px 12px 16px",
      "font:14px/1.6 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif",
      "box-shadow:0 -4px 16px rgba(0,0,0,.2)"
    ].join(";"));
    box.innerHTML =
      "<b style='font-weight:600'>浏览器版本偏旧</b><br>" +
      "文章和题目还能正常阅读，但答题、查词、AI 解析这些交互可能无法使用。" +
      "把浏览器升级到最新版（Chrome / Edge / Safari / 手机自带浏览器）即可恢复正常。" +
      "<span id='__compat_close' style='position:absolute;right:14px;top:10px;cursor:pointer;opacity:.6;font-size:18px;line-height:1'>&#215;</span>";
    document.body.appendChild(box);
    var c = document.getElementById("__compat_close");
    if (c) c.onclick = function () { box.parentNode && box.parentNode.removeChild(box); };
  }
  if (document.body) show();
  else document.addEventListener("DOMContentLoaded", show);
})();`;
