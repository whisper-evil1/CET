exports.id=3513,exports.ids=[3513],exports.modules={3421:(a,b,c)=>{"use strict";Object.defineProperty(b,"I",{enumerable:!0,get:function(){return g}});let d=c(71237),e=c(55088),f=c(17679);async function g(a,b,c,g){if((0,d.isNodeNextResponse)(b)){var h;b.statusCode=c.status,b.statusMessage=c.statusText;let d=["set-cookie","www-authenticate","proxy-authenticate","vary"];null==(h=c.headers)||h.forEach((a,c)=>{if("x-middleware-set-cookie"!==c.toLowerCase())if("set-cookie"===c.toLowerCase())for(let d of(0,f.splitCookiesString)(a))b.appendHeader(c,d);else{let e=void 0!==b.getHeader(c);(d.includes(c.toLowerCase())||!e)&&b.appendHeader(c,a)}});let{originalResponse:i}=b;c.body&&"HEAD"!==a.method?await (0,e.pipeToNodeResponse)(c.body,i,g):i.end()}}},33200:(a,b,c)=>{"use strict";c.d(b,{BY:()=>e,Ex:()=>f,RX:()=>k,mm:()=>l,q2:()=>j});let d={deepseek:{baseUrl:"https://api.deepseek.com/v1",model:"deepseek-chat"},dashscope:{baseUrl:"https://dashscope.aliyuncs.com/compatible-mode/v1",model:"qwen-plus"},zhipu:{baseUrl:"https://open.bigmodel.cn/api/paas/v4",model:"glm-4-flash"},moonshot:{baseUrl:"https://api.moonshot.cn/v1",model:"moonshot-v1-8k"}};function e(){let a=(process.env.AI_PROVIDER??"deepseek").toLowerCase(),b=d[a]??d.deepseek,c=process.env.AI_API_KEY?.trim()??"";return{enabled:c.length>0,provider:a,baseUrl:process.env.AI_BASE_URL?.trim()||b.baseUrl,model:process.env.AI_MODEL?.trim()||b.model,apiKey:c}}function f(a){let b=a.paragraphs.map(a=>`[${a.label}] ${a.text}`).join("\n\n"),c=a.question.options.map(a=>`${a.key}. ${a.text}`).join("\n"),d=a.optionAnalysis?Object.entries(a.optionAnalysis).map(([a,b])=>`${a}. ${b}`).join("\n"):"（暂无逐项分析）";return`你是一位耐心的四六级英语阅读老师，正在一对一辅导学生。请始终基于下面这篇【文章】和【当前题目】作答，不要编造文章里没有的信息。

【文章标题】${a.passageTitle??a.paperTitle}
【文章原文】
${b}

【当前题目】第 ${a.question.number} 题 ${a.question.stem}
${c}

【学生的选择】${a.myChoice?`${a.myChoice}`:"还未作答"}
【正确答案】${a.correctAnswer??"（学生尚未提交，先不要直接公布答案，引导他定位原文）"}
【官方解析】${a.analysis??"（无）"}
【逐项分析】
${d}

回答要求：
1. 用中文解释，必要时引用英文原句，并标注它来自哪一段（如 [C]）。
2. 讲"为什么"，不要只给结论；如果学生问某个选项错在哪，要指出它偷换了原文的哪个词或逻辑。
3. 篇幅控制在 200 字以内，除非学生要求详细展开。
4. 不要使用一级标题，不使用表格。`}let g=Number(process.env.AI_CONNECT_TIMEOUT_MS??"20000"),h=Number(process.env.AI_CHUNK_TIMEOUT_MS??"12000");async function i(a,b,c){let d=new AbortController,e=setTimeout(()=>d.abort(),c);try{return await fetch(a,{...b,signal:d.signal})}finally{clearTimeout(e)}}async function j(a,b){let c;try{c=await i(`${b.baseUrl}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${b.apiKey}`},body:JSON.stringify({model:b.model,messages:a,stream:!0,temperature:.3,max_tokens:900})},g)}catch(a){throw Error(a instanceof Error&&"AbortError"===a.name?"模型接口连接超时":`模型接口连接失败：${a instanceof Error?a.message:"未知错误"}`)}if(!c.ok||!c.body){let a=await c.text().catch(()=>"");throw Error(`模型接口返回 ${c.status}: ${a.slice(0,200)}`)}let d=c.body,e=new TextDecoder,f=new TextEncoder;return new ReadableStream({async start(a){let b=d.getReader(),c="";try{for(;;){let d=setTimeout(()=>b.cancel("chunk-timeout"),h),{done:g,value:i}=await b.read();if(clearTimeout(d),g)break;let j=(c+=e.decode(i,{stream:!0})).split("\n");for(let b of(c=j.pop()??"",j)){let c=b.trim();if(!c.startsWith("data:"))continue;let d=c.slice(5).trim();if(d&&"[DONE]"!==d)try{let b=JSON.parse(d),c=b.choices?.[0]?.delta?.content;c&&a.enqueue(f.encode(c))}catch{}}}}catch(b){a.enqueue(f.encode(`

> 连接中断：${b instanceof Error?b.message:"未知错误"}，已切换为内置讲解。`))}finally{a.close()}}})}function k(a){return l(function(a){let b=[...a].reverse().find(a=>"user"===a.role)?.content??"",c=b.slice(0,40),d=/批改|评分|打分|作文|写作|翻译|译文|范文/.test(b),e=`> 这次没能连上云端模型，下面是内置的通用讲解（换个网络再点一次通常就好了）。

你问的是「${c}${b.length>40?"…":""}」。
`;return d?`${e}
**写作 / 翻译这类题的采分点**

1. **主干先立稳**：每个句子先确定主语和谓语，再把定语、状语挂上去。中文习惯把修饰堆在前面，直译过去最容易缺谓语。
2. **时态统一**：一段话里不要今天用过去时、明天用现在时。中文没有时态标记，这一步最容易丢分。
3. **数字、年代、专有名词必须落地**：题目里出现的数据、人名、地名一个都不能漏，这是硬采分点。
4. **标点换半角**：中文的，。；：出现在英文里会被直接判错。
5. **别用大词**：写不准的长难句不如写对的两三个短句，准确性优先于花哨。

想要逐句批改，回到写作/翻译页面点「AI 批改」，那里会按 15 分制给分并指出具体句子。`:`${e}
**阅读题按这个顺序走**

1. **先看题干定位关键词**：把题干里的人名、时间、专有名词当路标，回原文扫一遍，找到同一段。
2. **再看原文那句的主干**：四六级阅读的错误选项，多数是把原文某句话的主语、范围或程度偷偷换掉。
3. **逐项排除**：把四个选项和原文原句摆在一起对照，只要有一处跟原文不符，就可以直接划掉。

> 提示：提交答案后，题目下方会出现「答案与解析」，每条错项都写了具体错在哪个词。`}(a))}function l(a,b={}){let c=new TextEncoder;if(b.instant)return new ReadableStream({start(b){b.enqueue(c.encode(a)),b.close()}});let d=0;return new ReadableStream({async pull(b){if(d>=a.length)return void b.close();let e=2+Math.floor(3*Math.random()),f=a.slice(d,d+e);d+=e,b.enqueue(c.encode(f)),await new Promise(a=>setTimeout(a,15+20*Math.random()))}})}},67360:(a,b,c)=>{"use strict";c.d(b,{Y9:()=>l,j2:()=>m,m6:()=>p});var d=c(98133),e=c(14838),f=c(7028),g=c(86441),h=c(96798),i=c(78507),j=c(85547);let k=g.Ikc({email:g.YjP().trim().toLowerCase().min(3),password:g.YjP().min(6).max(64).optional(),code:g.YjP().trim().min(6).max(6).optional()}),{handlers:l,auth:m,signIn:n,signOut:o}=(0,d.Ay)({trustHost:!0,secret:process.env.AUTH_SECRET??"dev-only-secret-change-me",session:{strategy:"jwt",maxAge:2592e3},pages:{signIn:"/login"},providers:[(0,e.A)({name:"邮箱密码",credentials:{email:{label:"邮箱",type:"email"},password:{label:"密码",type:"password"},code:{label:"验证码",type:"text"}},async authorize(a){let b=k.safeParse(a);if(!b.success)return null;let{email:c}=b.data,d=await h.z.user.findUnique({where:{email:c}});if(!d)return null;if(b.data.code){if(!(0,j.HR)(c,"login",b.data.code).ok)return null}else if(!b.data.password||!await f.Ay.compare(b.data.password,d.password))return null;return await (0,i.j)({localUserId:d.id,email:d.email,name:d.name,passwordHash:d.password,source:"login"}),{id:d.id,email:d.email,name:d.name??null}}})],callbacks:{jwt:async({token:a,user:b})=>(b?.id&&(a.uid=b.id),a),session:async({session:a,token:b})=>(b.uid&&a.user&&(a.user.id=b.uid),a)}});async function p(){let a=await m();return a?.user?.id??null}},78335:()=>{},95736:(a,b,c)=>{"use strict";a.exports=c(44870)},96487:()=>{},96952:(a,b,c)=>{"use strict";c.d(b,{I:()=>h,Nt:()=>j,OG:()=>k,fJ:()=>g,hD:()=>i,ok:()=>f});var d=c(10641),e=c(37947);function f(a,b="ok"){return d.NextResponse.json({code:0,message:b,data:a},{status:200})}function g(a,b,c=400){return d.NextResponse.json({code:a,message:b,data:null},{status:c})}let h={unauthorized:()=>g(4001,"请先登录",401),forbidden:()=>g(4003,"无权操作这条数据",403),notFound:(a="资源")=>g(4004,`${a}不存在`,404),badRequest:(a="参数不合法")=>g(4e3,a,400),tooMany:(a="请求过于频繁，请稍后再试")=>g(4029,a,429),server:(a="服务器开小差了，请稍后再试")=>g(5e3,a,500)};class i extends Error{constructor(a,b,c=400){super(b),this.code=a,this.status=c}}function j(a){return async(...b)=>{try{return await a(...b)}catch(a){if(a instanceof i)return g(a.code,a.message,a.status);if(a instanceof e.G){let b=a.issues[0];return g(4e3,b?`参数不合法：${b.path.join(".")} ${b.message}`:"参数不合法",400)}return console.error("[api]",a),h.server()}}}async function k(a,b){let c;try{let b=await a.text();if(!b.trim())throw new i(4e3,"请求体不能为空");c=JSON.parse(b)}catch(a){if(a instanceof i)throw a;throw new i(4e3,"请求体不是合法 JSON")}let d=b.safeParse(c);if(!d.success){let a=d.error.issues[0];throw new i(4e3,a?`参数不合法：${a.path.join(".")} ${a.message}`:"参数不合法")}return d.data}}};