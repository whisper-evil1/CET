import puppeteer from "puppeteer-core";
const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3055";
const b = await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:"new",args:["--no-sandbox","--disable-dev-shm-usage"]});
const p = await b.newPage();
await p.setViewport({width:1360,height:900});
// 用「禁止执行 JS」的方式看服务端直出的样子
await p.setJavaScriptEnabled(false);
await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded",timeout:60000});
const ssrDisabled = await p.evaluate(()=>document.querySelector('button[type=submit]')?.disabled ?? null);
console.log("服务端直出时按钮 disabled =", ssrDisabled);

await p.setJavaScriptEnabled(true);
await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded",timeout:60000});
await p.waitForFunction(()=>document.querySelector('button[type=submit]') && !document.querySelector('button[type=submit]').disabled, {timeout:20000}).catch(()=>null);
const afterHydrate = await p.evaluate(()=>({
  disabled: document.querySelector('button[type=submit]')?.disabled ?? null,
  text: document.querySelector('button[type=submit]')?.innerText?.trim(),
}));
console.log("hydration 后:", JSON.stringify(afterHydrate));

const ok = ssrDisabled === true && afterHydrate.disabled === false;
console.log(ok ? "✓ 守卫生效（挂载前禁用、挂载后可点）" : "✗ 守卫异常");
await b.close();
process.exit(ok?0:1);
