const { google } = require("googleapis");
const jwt = require("jsonwebtoken");

const SHEET_ID   = "1rY13xKEH9lEiy8Gz9AE8kz8bAVxkOnOqZixdW1tx-9M";
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";

let cache = { data: null, ts: 0 };
const CACHE_MS = 30 * 60 * 1000;

function verifyToken(event) {
  const auth  = event.headers["authorization"] || event.headers["Authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) throw new Error("No token");
  return jwt.verify(token, JWT_SECRET);
}

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT || "{}";
  let creds;
  try { creds = JSON.parse(raw); }
  catch (e) { throw new Error("Bad GOOGLE_SERVICE_ACCOUNT JSON: " + e.message); }
  if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  return new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
}

const cv = v => (v===null||v===undefined||v===""||v==="#REF!"||v==="#N/A"||v==="#VALUE!") ? null : String(v).trim();
const cn = v => { const s=cv(v); if(!s)return null; const n=parseFloat(s.replace(/[$,%()]/g,"").replace(/,/g,"")); return isNaN(n)?null:n; };
function cd(v) {
  if(!v)return null; const s=String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
  const p=s.split("/"); if(p.length===3){let[m,d,y]=p.map(Number);if(y<100)y+=2000;if(m&&d&&y)return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}
  return null;
}
const MKT={"nyc":"New York","city vineyard":"New York","new york":"New York","philadlephia":"Philadelphia","philadelphia":"Philadelphia","pittsbugh":"Pittsburgh","pittsburgh":"Pittsburgh","nashville":"Nashville","chicago":"Chicago","atlanta":"Atlanta","boston":"Boston","st. louis":"St. Louis","dc":"DC","hudson valley":"Hudson Valley","washington":"DC"};
const ROOM={"main":"Main","loft":"Loft","the loft":"Loft","haymarket":"Haymarket","haymakret":"Haymarket","lounge":"Lounge","longe":"Lounge","secondary":"Loft","secondary venue":"Loft","wine garden":"Wine Garden","voh":"VOH"};
const nm=v=>{if(!v)return null;const k=String(v).toLowerCase().trim();return MKT[k]||String(v).trim();};
const nr=v=>{if(!v)return null;const k=String(v).toLowerCase().trim();return ROOM[k]||String(v).trim();};

const BAD=["","market","location","city","average","total","totals","artist","none","#ref!"];
function skip(r,mi,ai,di){return BAD.includes(String(r[mi]||"").toLowerCase().trim())||!r[ai]||BAD.includes(String(r[ai]||"").toLowerCase().trim())||!r[di];}

const TABS=[
  {name:"2016-2021",ds:1, mi:0,ri:1,ai:2,di:4,wi:5,gi:6, th:7,tl:8,at:9,dos:11,hf:12,te:19,gr:43,ts:42,ct:44,fb:59,net:62,pm:63,ppa:64,cap:null,pc:null},
  {name:"2023",     ds:2, mi:0,ri:1,ai:2,di:3,wi:4,gi:5, th:6,tl:7,at:8,dos:10,hf:11,te:20,gr:44,ts:43,ct:45,fb:61,net:64,pm:65,ppa:66,cap:null,pc:null},
  {name:"2024",     ds:2, mi:0,ri:1,di:2,ai:3,wi:4,gi:5, th:6,tl:7,at:8,dos:10,hf:11,te:20,gr:44,ts:43,ct:45,fb:62,net:65,pm:66,ppa:67,cap:null,pc:null},
  {name:"2025",     ds:1, mi:0,ri:1,di:2,wi:3,ai:4,gi:5, th:18,tl:19,at:20,dos:17,hf:6,te:14,gr:30,ts:44,ct:52,fb:57,net:33,pm:34,ppa:61,cap:45,pc:46},
  {name:"2026",     ds:2, mi:0,ri:1,di:2,wi:3,ai:4,gi:5, th:18,tl:19,at:20,dos:17,hf:6,te:14,gr:30,ts:44,ct:52,fb:57,net:33,pm:34,ppa:61,cap:45,pc:46},
];

function parseTab(tab, rows) {
  const results=[];
  for(let i=tab.ds;i<rows.length;i++){
    const r=rows[i]; if(!r||r.length<3)continue;
    if(skip(r,tab.mi,tab.ai,tab.di))continue;
    const date=cd(r[tab.di]); if(!date)continue;
    const yr=parseInt(date.slice(0,4)); if(yr<2015||yr>2030)continue;
    let pm=cn(r[tab.pm]); if(pm!==null&&Math.abs(pm)<=1.5&&pm!==0)pm=Math.round(pm*1000)/10;
    let genre=cv(r[tab.gi]); if(genre&&/^[\d\.\-\s]+$/.test(genre))genre=null;
    results.push({
      market:nm(r[tab.mi]),room:nr(r[tab.ri]),date,dow:cv(r[tab.wi]),artist:cv(r[tab.ai]),genre,
      avg_ticket:cn(r[tab.at]),ticket_high:cn(r[tab.th]),ticket_low:cn(r[tab.tl]),
      days_on_sale:cn(r[tab.dos]),headliner_fee:cn(r[tab.hf]),total_exp:cn(r[tab.te]),
      gross:cn(r[tab.gr]),net:cn(r[tab.net]),profit_margin:pm,total_tix_sold:cn(r[tab.ts]),
      capacity:tab.cap!=null?cn(r[tab.cap]):null,pct_capacity:tab.pc!=null?cn(r[tab.pc]):null,
      comp_tickets:cn(r[tab.ct]),fb_sales:cn(r[tab.fb]),ppa:cn(r[tab.ppa]),
    });
  }
  return results;
}

async function fetchAll() {
  const auth=getAuth();
  const sheets=google.sheets({version:"v4",auth});
  // Fetch all tabs IN PARALLEL for speed
  const results = await Promise.all(TABS.map(async tab => {
    try {
      const res=await sheets.spreadsheets.values.get({
        spreadsheetId:SHEET_ID, range:`'${tab.name}'!A:CZ`,
        valueRenderOption:"UNFORMATTED_VALUE", dateTimeRenderOption:"FORMATTED_STRING",
      });
      const parsed=parseTab(tab,res.data.values||[]);
      console.log(`Tab ${tab.name}: ${parsed.length} rows`);
      return parsed;
    } catch(err) {
      console.error(`Tab ${tab.name} error:`,err.message);
      return [];
    }
  }));
  const all=results.flat();
  all.sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  console.log(`Total: ${all.length} rows`);
  return all;
}

exports.handler = async (event) => {
  const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Content-Type":"application/json"};
  if(event.httpMethod==="OPTIONS")return{statusCode:200,headers,body:""};
  try{verifyToken(event);}catch{return{statusCode:401,headers,body:JSON.stringify({error:"Unauthorized"})};}
  const now=Date.now();
  if(cache.data&&now-cache.ts<CACHE_MS)return{statusCode:200,headers,body:JSON.stringify({rows:cache.data,count:cache.data.length,cached:true})};
  try {
    const rows=await fetchAll();
    cache={data:rows,ts:now};
    return{statusCode:200,headers,body:JSON.stringify({rows,count:rows.length,cached:false})};
  } catch(err) {
    console.error("fetchAll error:",err);
    return{statusCode:500,headers,body:JSON.stringify({error:err.message})};
  }
};
