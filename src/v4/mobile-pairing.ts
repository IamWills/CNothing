import { ValidationError } from "../utils/errors";

/** The browser only returns a short-lived, verifier-bound code, never a session token. */
export function mobilePairingPage(url: URL, userId: string): Response {
  const challenge = url.searchParams.get("code_challenge") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || !/^[A-Za-z0-9_-]{16,128}$/.test(state)) {
    throw new ValidationError("Invalid mobile login session");
  }
  const identity = userId.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CNothing</title><style>
body{font:17px system-ui;background:#f4f5f7;color:#17211c;min-height:100dvh;margin:0;display:grid;place-items:center}main{padding:28px;max-width:420px;text-align:center}button{font:600 17px system-ui;background:#187a3b;color:white;border:0;border-radius:14px;padding:18px;width:100%;margin-top:24px}p{overflow-wrap:anywhere}#error{color:#b42318}
</style></head><body><main><h1 id="title">Add account to CNothing</h1><p>${identity}</p><p id="description">Allow this iPhone to receive and approve requests for this account.</p><button id="continue">Add account and return to app</button><p id="error" role="alert"></p></main><script>
const zh=navigator.language.startsWith('zh');
if(zh){document.getElementById('title').textContent='添加账号到 CNothing';document.getElementById('description').textContent='允许这台 iPhone 接收并审批此账号的授权请求。';document.getElementById('continue').textContent='添加账号并返回 App';}
document.getElementById('continue').onclick=async function(){
this.disabled=true;document.getElementById('error').textContent='';
try{const response=await fetch('/v4/devices/mobile-pairing-codes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code_challenge:'${challenge}'})});
const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Unable to add account');
window.location.href='cnothing://login-callback?state=${state}&code='+encodeURIComponent(data.pairing_code);
}catch(error){document.getElementById('error').textContent=error.message;this.disabled=false;}
};</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" } });
}
