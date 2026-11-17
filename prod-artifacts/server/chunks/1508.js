exports.id=1508,exports.ids=[1508],exports.modules={5682:(a,b,c)=>{"use strict";c.r(b),c.d(b,{default:()=>d});let d=(0,c(97954).registerClientReference)(function(){throw Error("Attempted to call the default export of \"D:\\\\work buddy work\\\\2026-11-01-23-11-42\\\\CET项目_2026-11-01_v2修复版\\\\cet-reader\\\\src\\\\app\\\\error.tsx\" from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"D:\\work buddy work\\2026-11-01-23-11-42\\CET项目_2026-11-01_v2修复版\\cet-reader\\src\\app\\error.tsx","default")},25397:(a,b,c)=>{"use strict";c.r(b),c.d(b,{default:()=>i,metadata:()=>h});var d=c(75338);c(61135),c(51306);var e=c(33468);let f=`(function(){
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
})();`,g=`(function(){
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
})();`,h={title:"左文右题 \xb7 四六级阅读刷题",description:"左边滚动原文，右边答题，两栏互不干扰。点词即查、生词自动进库循环复习，每题都能问 AI、写笔记。"};function i({children:a}){return(0,d.jsxs)("html",{lang:"zh-CN",suppressHydrationWarning:!0,children:[(0,d.jsxs)("head",{children:[(0,d.jsx)("script",{dangerouslySetInnerHTML:{__html:f}}),(0,d.jsx)("script",{dangerouslySetInnerHTML:{__html:'(function(){try{if(!("CSSLayerBlockRule" in window)){document.documentElement.setAttribute("data-css-fallback","1");}}catch(e){}})();'}})]}),(0,d.jsxs)("body",{className:"min-h-full antialiased",children:[(0,d.jsx)("script",{dangerouslySetInnerHTML:{__html:g}}),(0,d.jsx)(e.ShareCodeSync,{}),(0,d.jsx)("noscript",{children:(0,d.jsx)("div",{style:{background:"#17181a",color:"#faf8f3",padding:"12px 16px",fontSize:14,lineHeight:1.6},children:"当前禁用了 JavaScript：文章和题目仍可阅读，但答题、查词、AI 解析等交互无法使用。开启后即可正常使用。"})}),a]})]})}},28070:(a,b,c)=>{"use strict";function d(){return null}c.d(b,{ShareCodeSync:()=>d}),c(38301),c(91735)},31801:(a,b,c)=>{Promise.resolve().then(c.bind(c,5682))},33468:(a,b,c)=>{"use strict";c.d(b,{ShareCodeSync:()=>d});let d=(0,c(97954).registerClientReference)(function(){throw Error("Attempted to call ShareCodeSync() from the server but ShareCodeSync is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"D:\\work buddy work\\2026-11-01-23-11-42\\CET项目_2026-11-01_v2修复版\\cet-reader\\src\\components\\share-code-sync.tsx","ShareCodeSync")},35327:(a,b,c)=>{Promise.resolve().then(c.t.bind(c,81170,23)),Promise.resolve().then(c.t.bind(c,23597,23)),Promise.resolve().then(c.t.bind(c,36893,23)),Promise.resolve().then(c.t.bind(c,89748,23)),Promise.resolve().then(c.t.bind(c,6060,23)),Promise.resolve().then(c.t.bind(c,7184,23)),Promise.resolve().then(c.t.bind(c,69576,23)),Promise.resolve().then(c.t.bind(c,73041,23)),Promise.resolve().then(c.t.bind(c,51384,23))},44953:(a,b,c)=>{Promise.resolve().then(c.bind(c,96908))},47577:(a,b,c)=>{Promise.resolve().then(c.bind(c,33468))},51306:()=>{},61135:()=>{},70440:(a,b,c)=>{"use strict";c.r(b),c.d(b,{default:()=>e});var d=c(97523);let e=async a=>[{type:"image/x-icon",sizes:"16x16",url:(0,d.fillMetadataSegment)(".",await a.params,"favicon.ico")+""}]},84025:(a,b,c)=>{Promise.resolve().then(c.bind(c,28070))},91735:(a,b,c)=>{"use strict";c.d(b,{An:()=>h,Gd:()=>f,X2:()=>j,tB:()=>g,xg:()=>i});let d="sharecode",e="false"!==(process.env.NEXT_PUBLIC_SHARECODE_ENABLED??"true").trim().toLowerCase();function f(){return null}function g(a){}function h(){if(!e)return null;let a=f();return a?(g(a),a):null}function i(a){if(!e||/^https?:\/\//i.test(a)&&!a.includes("workbuddy.host"))return a;let b=h();if(!b)return a;try{let c=new URL(a,"http://localhost");if(c.searchParams.has(d))return a;if(c.searchParams.set(d,b),a.startsWith("/"))return c.pathname+c.search;return c.toString()}catch{return a}}function j(a,b){return 403===a.status&&!!b&&!!/text\/html/i.test(b)}},95575:(a,b,c)=>{Promise.resolve().then(c.t.bind(c,54160,23)),Promise.resolve().then(c.t.bind(c,31603,23)),Promise.resolve().then(c.t.bind(c,68495,23)),Promise.resolve().then(c.t.bind(c,75170,23)),Promise.resolve().then(c.t.bind(c,77526,23)),Promise.resolve().then(c.t.bind(c,78922,23)),Promise.resolve().then(c.t.bind(c,29234,23)),Promise.resolve().then(c.t.bind(c,12263,23)),Promise.resolve().then(c.bind(c,82146))},96908:(a,b,c)=>{"use strict";c.r(b),c.d(b,{default:()=>g});var d=c(21124);c(38301);var e=c(3991),f=c.n(e);function g({error:a,reset:b}){return(0,d.jsxs)("div",{className:"mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center px-6 py-16 text-center",children:[(0,d.jsx)("p",{className:"text-[11px] tracking-[0.28em] text-ink-mute uppercase",children:"Something went wrong"}),(0,d.jsx)("h1",{className:"mt-4 font-serif text-[28px] leading-tight text-ink",children:"页面出了点小问题"}),(0,d.jsxs)("p",{className:"mt-4 text-[14px] leading-[1.8] text-ink-soft",children:["可能是网络波动，或分享链接的访问凭证失效了。",(0,d.jsx)("br",{}),"先回首页试试；如果反复出现，请重新打开分享链接。"]}),(0,d.jsxs)("div",{className:"mt-8 flex flex-wrap items-center justify-center gap-3",children:[(0,d.jsx)("button",{type:"button",onClick:b,className:"rounded-full bg-ink px-5 py-2 text-[13px] text-paper transition-opacity hover:opacity-85",children:"重试当前页"}),(0,d.jsx)(f(),{href:"/",className:"rounded-full border border-line px-5 py-2 text-[13px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink",children:"回首页"})]}),a.digest&&(0,d.jsxs)("p",{className:"mt-8 font-mono text-[11px] text-ink-mute",children:["错误编号：",a.digest]})]})}}};