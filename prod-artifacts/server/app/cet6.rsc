1:"$Sreact.fragment"
8:I[7150,[],""]
:HL["/_next/static/css/a5850f578d44970e.css","style"]
2:Tc2c,(function(){
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
})();0:{"P":null,"b":"qDsGJbf2XzTK4MRJguARa","p":"","c":["","cet6"],"i":false,"f":[[["",{"children":["cet6",{"children":["__PAGE__",{}]}]},"$undefined","$undefined",true],["",["$","$1","c",{"children":[[["$","link","0",{"rel":"stylesheet","href":"/_next/static/css/a5850f578d44970e.css","precedence":"next","crossOrigin":"$undefined","nonce":"$undefined"}]],["$","html",null,{"lang":"zh-CN","suppressHydrationWarning":true,"children":[["$","head",null,{"children":[["$","script",null,{"dangerouslySetInnerHTML":{"__html":"$2"}}],"$L3"]}],"$L4"]}]]}],{"children":["cet6","$L5",{"children":["__PAGE__","$L6",{},null,false]},null,false]},null,false],"$L7",false]],"m":"$undefined","G":["$8",[]],"s":false,"S":true}
a:I[4176,["7177","static/chunks/app/layout-f1cad41f8bfa956b.js"],"ShareCodeSync"]
b:I[9766,[],""]
c:I[960,["2619","static/chunks/2619-3c9e02e22d10480a.js","8039","static/chunks/app/error-e28f54c0e3fda5dd.js"],"default"]
d:I[8924,[],""]
f:I[4431,[],"OutletBoundary"]
11:I[5278,[],"AsyncMetadataOutlet"]
13:I[4431,[],"ViewportBoundary"]
15:I[4431,[],"MetadataBoundary"]
16:"$Sreact.suspense"
3:["$","script",null,{"dangerouslySetInnerHTML":{"__html":"(function(){try{if(!(\"CSSLayerBlockRule\" in window)){document.documentElement.setAttribute(\"data-css-fallback\",\"1\");}}catch(e){}})();"}}]
9:T562,(function(){
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
})();4:["$","body",null,{"className":"min-h-full antialiased","children":[["$","script",null,{"dangerouslySetInnerHTML":{"__html":"$9"}}],["$","$La",null,{}],["$","noscript",null,{"children":["$","div",null,{"style":{"background":"#17181a","color":"#faf8f3","padding":"12px 16px","fontSize":14,"lineHeight":1.6},"children":"当前禁用了 JavaScript：文章和题目仍可阅读，但答题、查词、AI 解析等交互无法使用。开启后即可正常使用。"}]}],["$","$Lb",null,{"parallelRouterKey":"children","error":"$c","errorStyles":[],"errorScripts":[],"template":["$","$Ld",null,{}],"templateStyles":"$undefined","templateScripts":"$undefined","notFound":[[["$","title",null,{"children":"404: This page could not be found."}],["$","div",null,{"style":{"fontFamily":"system-ui,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif,\"Apple Color Emoji\",\"Segoe UI Emoji\"","height":"100vh","textAlign":"center","display":"flex","flexDirection":"column","alignItems":"center","justifyContent":"center"},"children":["$","div",null,{"children":[["$","style",null,{"dangerouslySetInnerHTML":{"__html":"body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}"}}],["$","h1",null,{"className":"next-error-h1","style":{"display":"inline-block","margin":"0 20px 0 0","padding":"0 23px 0 0","fontSize":24,"fontWeight":500,"verticalAlign":"top","lineHeight":"49px"},"children":404}],["$","div",null,{"style":{"display":"inline-block"},"children":["$","h2",null,{"style":{"fontSize":14,"fontWeight":400,"lineHeight":"49px","margin":0},"children":"This page could not be found."}]}]]}]}]],[]],"forbidden":"$undefined","unauthorized":"$undefined"}]]}]
5:["$","$1","c",{"children":[null,["$","$Lb",null,{"parallelRouterKey":"children","error":"$undefined","errorStyles":"$undefined","errorScripts":"$undefined","template":["$","$Ld",null,{}],"templateStyles":"$undefined","templateScripts":"$undefined","notFound":"$undefined","forbidden":"$undefined","unauthorized":"$undefined"}]]}]
6:["$","$1","c",{"children":["$Le",null,["$","$Lf",null,{"children":["$L10",["$","$L11",null,{"promise":"$@12"}]]}]]}]
7:["$","$1","h",{"children":[null,[["$","$L13",null,{"children":"$L14"}],null],["$","$L15",null,{"children":["$","div",null,{"hidden":true,"children":["$","$16",null,{"fallback":null,"children":"$L17"}]}]}]]}]
e:E{"digest":"NEXT_REDIRECT;replace;/?level=CET6;307;"}
14:[["$","meta","0",{"charSet":"utf-8"}],["$","meta","1",{"name":"viewport","content":"width=device-width, initial-scale=1"}]]
10:null
18:I[622,[],"IconMark"]
12:{"metadata":[["$","title","0",{"children":"左文右题 · 四六级阅读刷题"}],["$","meta","1",{"name":"description","content":"左边滚动原文，右边答题，两栏互不干扰。点词即查、生词自动进库循环复习，每题都能问 AI、写笔记。"}],["$","link","2",{"rel":"icon","href":"/favicon.ico","type":"image/x-icon","sizes":"16x16"}],["$","$L18","3",{}]],"error":null,"digest":"$undefined"}
17:"$12:metadata"
