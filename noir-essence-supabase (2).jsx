import { useState, useEffect, useContext, createContext, useRef, useCallback, useMemo } from "react";

// ─── SUPABASE LIGHTWEIGHT CLIENT ─────────────────────────────────────────────
const SUPA_URL = "https://aazilvclgpuloujskspa.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhemlsdmNsZ3B1bG91anNrc3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjMwMjEsImV4cCI6MjA4ODI5OTAyMX0.AQybX9vcDPMqo_gQsAnjyKpnzGEgqdosTu8sb0qXjKU";

// Minimal Supabase client built on fetch — no external dependency needed
const createClient = (url, key) => {
  let _session = null;
  const _authListeners = [];

  const _getToken = () => {
    if (_session?.access_token) return _session.access_token;
    try { const s = localStorage.getItem("ne_supa_session"); if (s) { _session = JSON.parse(s); return _session?.access_token; } } catch(e){}
    return null;
  };
  const _saveSession = (s) => {
    _session = s;
    try { if (s) localStorage.setItem("ne_supa_session", JSON.stringify(s)); else localStorage.removeItem("ne_supa_session"); } catch(e){}
    _authListeners.forEach(fn => fn(s ? "SIGNED_IN" : "SIGNED_OUT", s));
  };

  const _headers = (extra = {}) => ({
    "Content-Type": "application/json",
    "apikey": key,
    "Authorization": `Bearer ${_getToken() || key}`,
    ...extra
  });

  // ── REST query builder ──
  const from = (table) => {
    let _filters = [], _select = "*", _order = null, _single = false, _limit = null;
    const builder = {
      select: (cols = "*") => { _select = cols; return builder; },
      eq: (col, val) => { _filters.push(`${col}=eq.${val}`); return builder; },
      order: (col, { ascending = true } = {}) => { _order = `${col}.${ascending?"asc":"desc"}`; return builder; },
      limit: (n) => { _limit = n; return builder; },
      single: () => { _single = true; return builder; },
      then: async (resolve, reject) => {
        try {
          let u = `${url}/rest/v1/${table}?select=${_select}`;
          if (_filters.length) u += "&" + _filters.join("&");
          if (_order) u += `&order=${_order}`;
          if (_limit) u += `&limit=${_limit}`;
          const headers = { ..._headers(), "Prefer": _single ? "return=representation" : "return=representation" };
          if (_single) headers["Accept"] = "application/vnd.pgrst.object+json";
          const res = await fetch(u, { headers });
          const data = res.ok ? await res.json() : null;
          resolve({ data: _single ? data : (Array.isArray(data) ? data : (data ? [data] : [])), error: res.ok ? null : await res.json().catch(()=>({message:"Error"})) });
        } catch(e) { resolve({ data: null, error: { message: e.message } }); }
      },
      insert: (rows) => ({
        select: () => insertBuilder(rows, true),
        single: () => insertBuilder(rows, true, true),
        then: (resolve) => insertBuilder(rows, false).then(resolve),
      }),
      update: (obj) => ({
        eq: (col, val) => ({
          then: async (resolve) => {
            try {
              const res = await fetch(`${url}/rest/v1/${table}?${col}=eq.${val}`, { method:"PATCH", headers: { ..._headers(), "Prefer":"return=representation" }, body: JSON.stringify(obj) });
              const data = res.ok ? await res.json().catch(()=>null) : null;
              resolve({ data, error: res.ok ? null : { message: "Update failed" } });
            } catch(e) { resolve({ data:null, error:{message:e.message} }); }
          }
        })
      }),
      upsert: async (obj) => {
        try {
          const res = await fetch(`${url}/rest/v1/${table}`, { method:"POST", headers: { ..._headers(), "Prefer":"resolution=merge-duplicates,return=representation" }, body: JSON.stringify(obj) });
          return { data: res.ok ? await res.json().catch(()=>null) : null, error: res.ok ? null : {message:"Upsert failed"} };
        } catch(e) { return { data:null, error:{message:e.message} }; }
      },
      delete: () => ({
        eq: async (col, val) => {
          try {
            const res = await fetch(`${url}/rest/v1/${table}?${col}=eq.${val}`, { method:"DELETE", headers: _headers() });
            return { error: res.ok ? null : {message:"Delete failed"} };
          } catch(e) { return { error:{message:e.message} }; }
        }
      }),
    };
    const insertBuilder = (rows, returning, single=false) => ({
      single: () => insertBuilder(rows, true, true),
      then: async (resolve) => {
        try {
          const body = Array.isArray(rows) ? rows : [rows];
          const res = await fetch(`${url}/rest/v1/${table}`, { method:"POST", headers:{..._headers(),"Prefer":"return=representation"}, body:JSON.stringify(body) });
          const data = res.ok ? await res.json().catch(()=>null) : null;
          resolve({ data: single && Array.isArray(data) ? data[0] : data, error: res.ok ? null : {message:"Insert failed"} });
        } catch(e) { resolve({data:null,error:{message:e.message}}); }
      }
    });
    return builder;
  };

  // ── Auth ──
  const auth = {
    getSession: async () => {
      try { const s = localStorage.getItem("ne_supa_session"); if (s) { _session = JSON.parse(s); return { data:{session:_session}, error:null }; } } catch(e){}
      return { data:{session:null}, error:null };
    },
    signInWithPassword: async ({ email, password }) => {
      try {
        const res = await fetch(`${url}/auth/v1/token?grant_type=password`, { method:"POST", headers:{"Content-Type":"application/json","apikey":key}, body:JSON.stringify({email,password}) });
        const data = await res.json();
        if (!res.ok) return { data:null, error:{message:data.error_description||data.msg||"Invalid credentials"} };
        _saveSession(data);
        return { data:{user:data.user,session:data}, error:null };
      } catch(e) { return { data:null, error:{message:e.message} }; }
    },
    signUp: async ({ email, password }) => {
      try {
        const res = await fetch(`${url}/auth/v1/signup`, { method:"POST", headers:{"Content-Type":"application/json","apikey":key}, body:JSON.stringify({email,password}) });
        const data = await res.json();
        if (!res.ok) return { data:null, error:{message:data.msg||data.error_description||"Signup failed"} };
        if (data.access_token) _saveSession(data);
        return { data:{user:data.user||data,session:data}, error:null };
      } catch(e) { return { data:null, error:{message:e.message} }; }
    },
    signOut: async () => {
      try { await fetch(`${url}/auth/v1/logout`, { method:"POST", headers:_headers() }); } catch(e){}
      _saveSession(null);
      return { error:null };
    },
    resetPasswordForEmail: async (email) => {
      try {
        const res = await fetch(`${url}/auth/v1/recover`, { method:"POST", headers:{"Content-Type":"application/json","apikey":key}, body:JSON.stringify({email}) });
        return { error: res.ok ? null : {message:"Reset failed"} };
      } catch(e) { return { error:{message:e.message} }; }
    },
    onAuthStateChange: (callback) => {
      _authListeners.push(callback);
      return { data:{ subscription:{ unsubscribe:() => { const i=_authListeners.indexOf(callback); if(i>-1)_authListeners.splice(i,1); } } } };
    },
  };

  // ── Storage ──
  const storage = {
    from: (bucket) => ({
      upload: async (path, file, opts={}) => {
        try {
          const fd = new FormData(); fd.append("", file, file.name);
          const method = opts.upsert ? "PUT" : "POST";
          const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, { method, headers:{"apikey":key,"Authorization":`Bearer ${_getToken()||key}`}, body:file });
          return { error: res.ok ? null : {message:"Upload failed"} };
        } catch(e) { return { error:{message:e.message} }; }
      },
      getPublicUrl: (path) => ({ data:{ publicUrl:`${url}/storage/v1/object/public/${bucket}/${path}` } }),
    }),
  };

  return { from, auth, storage };
};

const supabase = createClient(SUPA_URL, SUPA_KEY);

// ─── CURRENCY: PKR ───────────────────────────────────────────────────────────
const fmt = (n) => `PKR ${Number(n).toLocaleString("en-PK")}`;

// ─── FONTS & GLOBAL STYLES ────────────────────────────────────────────────────
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=Tenor+Sans&family=DM+Mono:wght@300;400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --black:#050508;--deep:#0a0a10;--card:#111119;--card2:#16161f;--card3:#1c1c28;
      --border:#252535;--border2:#2e2e42;
      --gold:#c8a96e;--gold2:#e2c88a;--gold3:#f0dfa8;--gold-dim:rgba(200,169,110,0.15);
      --purple:#6b4fa0;--purple2:#8b6fc0;--purple3:rgba(107,79,160,0.2);
      --text:#ede9f8;--text2:#b8b4cc;--text3:#7a7890;
      --red:#d64f4f;--red2:rgba(214,79,79,0.15);
      --green:#4a9e75;--green2:rgba(74,158,117,0.15);
      --orange:#d4824a;
      --shadow:0 8px 32px rgba(0,0,0,0.4);
      --shadow2:0 24px 64px rgba(0,0,0,0.6);
    }
    html{scroll-behavior:smooth}
    body{background:var(--black);color:var(--text);font-family:'Tenor Sans',serif;overflow-x:hidden;min-height:100vh}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:var(--deep)}::-webkit-scrollbar-thumb{background:var(--border2)}
    input,textarea,select,button{font-family:'Tenor Sans',serif}
    a{text-decoration:none;color:inherit;cursor:pointer}
    button{cursor:pointer}
    img{display:block;max-width:100%}

    /* ── KEYFRAMES ─────────────────────────────────────────── */
    @keyframes fadeUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
    @keyframes fadeDown{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:none}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes fadeLeft{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}
    @keyframes fadeRight{from{opacity:0;transform:translateX(-30px)}to{opacity:1;transform:none}}
    @keyframes slideIn{from{transform:translateX(100%)}to{transform:none}}
    @keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:none;opacity:1}}
    @keyframes slideReveal{from{transform:translateY(110%)}to{transform:translateY(0%)}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes spinSlow{to{transform:rotate(360deg)}}
    @keyframes float{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-14px) rotate(1deg)}}
    @keyframes floatB{0%,100%{transform:translateY(0) rotate(1deg)}50%{transform:translateY(-10px) rotate(-1deg)}}
    @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
    @keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
    @keyframes shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}
    @keyframes goldShimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    @keyframes glow{0%,100%{box-shadow:0 0 0 rgba(200,169,110,0)}50%{box-shadow:0 0 40px rgba(200,169,110,0.25)}}
    @keyframes glowPurple{0%,100%{box-shadow:0 0 0 rgba(107,79,160,0)}50%{box-shadow:0 0 40px rgba(107,79,160,0.3)}}
    @keyframes draw{from{stroke-dashoffset:1000}to{stroke-dashoffset:0}}
    @keyframes scaleIn{from{opacity:0;transform:scale(0.93)}to{opacity:1;transform:scale(1)}}
    @keyframes popIn{0%{opacity:0;transform:scale(0.5)}60%{transform:scale(1.05)}100%{opacity:1;transform:scale(1)}}
    @keyframes ripple{0%{transform:scale(0);opacity:.6}100%{transform:scale(4);opacity:0}}
    @keyframes curtainLeft{from{transform:scaleX(1);transform-origin:right}to{transform:scaleX(0);transform-origin:right}}
    @keyframes curtainRight{from{transform:scaleX(1);transform-origin:left}to{transform:scaleX(0);transform-origin:left}}
    @keyframes lineGrow{from{width:0}to{width:100%}}
    @keyframes lineGrowH{from{height:0}to{height:100%}}
    @keyframes particleDrift{0%{transform:translateY(0) translateX(0) scale(1);opacity:0}10%{opacity:1}90%{opacity:.6}100%{transform:translateY(-100vh) translateX(var(--dx,20px)) scale(0);opacity:0}}
    @keyframes scanLine{0%{top:-2px}100%{top:100%}}
    @keyframes typeReveal{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0% 0 0)}}
    @keyframes borderFlow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    @keyframes wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
    @keyframes counterUp{from{transform:translateY(100%);opacity:0}to{transform:none;opacity:1}}
    @keyframes orbFloat{0%{transform:translate(0,0) scale(1)}25%{transform:translate(30px,-20px) scale(1.05)}50%{transform:translate(-20px,30px) scale(.97)}75%{transform:translate(20px,10px) scale(1.02)}100%{transform:translate(0,0) scale(1)}}
    @keyframes logoStroke{to{stroke-dashoffset:0}}
    @keyframes loadingBar{from{width:0}to{width:100%}}
    @keyframes loadingFade{0%,80%{opacity:1}100%{opacity:0;pointer-events:none}}

    /* ── BASE ANIMATION CLASSES ─────────────────────────────── */
    .fu{animation:fadeUp .65s cubic-bezier(.22,1,.36,1) both}
    .fi{animation:fadeIn .4s ease both}
    .fl{animation:fadeLeft .55s cubic-bezier(.22,1,.36,1) both}
    .fr{animation:fadeRight .55s cubic-bezier(.22,1,.36,1) both}
    .si{animation:scaleIn .35s cubic-bezier(.22,1,.36,1) both}
    .pi{animation:popIn .5s cubic-bezier(.22,1,.36,1) both}

    /* ── SCROLL REVEAL ──────────────────────────────────────── */
    .reveal{opacity:0;transform:translateY(32px);transition:opacity .75s cubic-bezier(.22,1,.36,1),transform .75s cubic-bezier(.22,1,.36,1)}
    .reveal.visible{opacity:1;transform:none}
    .reveal-left{opacity:0;transform:translateX(-32px);transition:opacity .75s cubic-bezier(.22,1,.36,1),transform .75s cubic-bezier(.22,1,.36,1)}
    .reveal-left.visible{opacity:1;transform:none}
    .reveal-right{opacity:0;transform:translateX(32px);transition:opacity .75s cubic-bezier(.22,1,.36,1),transform .75s cubic-bezier(.22,1,.36,1)}
    .reveal-right.visible{opacity:1;transform:none}
    .reveal-scale{opacity:0;transform:scale(.94);transition:opacity .75s cubic-bezier(.22,1,.36,1),transform .75s cubic-bezier(.22,1,.36,1)}
    .reveal-scale.visible{opacity:1;transform:scale(1)}

    /* ── CUSTOM CURSOR ──────────────────────────────────────── */
    *{cursor:none!important}
    .cursor-dot{position:fixed;width:8px;height:8px;background:var(--gold);border-radius:50%;pointer-events:none;z-index:99999;transform:translate(-50%,-50%);transition:transform .1s,background .3s,width .3s,height .3s;mix-blend-mode:difference}
    .cursor-ring{position:fixed;width:36px;height:36px;border:1px solid rgba(200,169,110,.5);border-radius:50%;pointer-events:none;z-index:99998;transform:translate(-50%,-50%);transition:width .4s cubic-bezier(.22,1,.36,1),height .4s cubic-bezier(.22,1,.36,1),border-color .3s,transform .15s cubic-bezier(.22,1,.36,1);mix-blend-mode:normal}
    .cursor-ring.hovering{width:60px;height:60px;border-color:var(--gold);background:rgba(200,169,110,.05)}
    .cursor-ring.clicking{width:28px;height:28px;background:rgba(200,169,110,.12)}
    .cursor-trail{position:fixed;border-radius:50%;pointer-events:none;z-index:99997;transform:translate(-50%,-50%);background:rgba(200,169,110,.15);animation:fadeIn .1s ease}

    /* ── LOADING SCREEN ─────────────────────────────────────── */
    .loading-screen{position:fixed;inset:0;z-index:99000;background:var(--black);display:flex;flex-direction:column;align-items:center;justify-content:center;animation:loadingFade 0.6s ease 2.2s both}
    .loading-logo{font-family:'Cormorant Garamond',serif;font-size:2.5rem;font-weight:300;letter-spacing:.5em;color:transparent;background:linear-gradient(90deg,var(--gold3),var(--gold),var(--gold2),var(--gold));background-size:200% auto;-webkit-background-clip:text;background-clip:text;animation:goldShimmer 2s linear infinite;margin-bottom:2.5rem;padding-right:.5em}
    .loading-tagline{font-size:.6rem;letter-spacing:.45em;text-transform:uppercase;color:var(--text3);margin-bottom:3rem;animation:fadeIn .5s ease .8s both;opacity:0}
    .loading-bar-track{width:200px;height:1px;background:var(--border);position:relative;overflow:hidden}
    .loading-bar-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--gold));animation:loadingBar 1.8s cubic-bezier(.22,1,.36,1) .3s both}

    /* ── PAGE TRANSITION ────────────────────────────────────── */
    .page-transition{position:fixed;inset:0;z-index:9000;pointer-events:none;display:flex}
    .pt-panel{flex:1;background:var(--deep);transform-origin:top;transition:transform .5s cubic-bezier(.76,0,.24,1)}
    .pt-panel.exit{transform:scaleY(0);transform-origin:bottom}

    /* ── PARTICLE FIELD ─────────────────────────────────────── */
    .particle-field{position:absolute;inset:0;overflow:hidden;pointer-events:none}
    .particle{position:absolute;border-radius:50%;pointer-events:none;animation:particleDrift linear infinite}

    /* ── HERO ───────────────────────────────────────────────── */
    .hero-letter{display:inline-block;animation:slideReveal .8s cubic-bezier(.22,1,.36,1) both;overflow:hidden}
    .hero-word-wrap{display:inline-block;overflow:hidden;vertical-align:bottom}
    .hero-scan{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(200,169,110,.3),transparent);animation:scanLine 3s linear infinite;pointer-events:none}

    /* ── MAGNETIC BUTTON ────────────────────────────────────── */
    .mag-btn{transition:transform .4s cubic-bezier(.22,1,.36,1),box-shadow .4s ease}

    /* ── CARD TILT ──────────────────────────────────────────── */
    .tilt-card{transform-style:preserve-3d;transition:transform .4s cubic-bezier(.22,1,.36,1),box-shadow .4s ease}
    .tilt-card:hover{box-shadow:0 30px 60px rgba(0,0,0,.6),0 0 0 1px rgba(200,169,110,.2)!important}
    .tilt-shine{position:absolute;inset:0;background:radial-gradient(circle at var(--mx,50%) var(--my,50%),rgba(255,255,255,.06) 0%,transparent 60%);pointer-events:none;transition:opacity .3s;opacity:0;border-radius:inherit}
    .tilt-card:hover .tilt-shine{opacity:1}
    .pc{transform-style:preserve-3d}

    /* ── RIPPLE ─────────────────────────────────────────────── */
    .ripple-wrap{position:relative;overflow:hidden}
    .ripple-circle{position:absolute;border-radius:50%;background:rgba(255,255,255,.15);animation:ripple .6s ease-out forwards;pointer-events:none}

    /* ── GOLD LINE REVEAL ───────────────────────────────────── */
    .gold-line-anim{width:0;height:1px;background:var(--gold);transition:width 1s cubic-bezier(.22,1,.36,1)}
    .gold-line-anim.visible{width:40px}

    /* ── ANIMATED COUNTER ───────────────────────────────────── */
    .counter-wrap{overflow:hidden}
    .counter-inner{animation:counterUp .6s cubic-bezier(.22,1,.36,1) both}

    /* ── STAGGER ────────────────────────────────────────────── */
    .stagger-children > *{opacity:0;transform:translateY(20px);transition:opacity .6s cubic-bezier(.22,1,.36,1),transform .6s cubic-bezier(.22,1,.36,1)}
    .stagger-children.visible > *{opacity:1;transform:none}
    .stagger-children.visible > *:nth-child(1){transition-delay:.05s}
    .stagger-children.visible > *:nth-child(2){transition-delay:.12s}
    .stagger-children.visible > *:nth-child(3){transition-delay:.19s}
    .stagger-children.visible > *:nth-child(4){transition-delay:.26s}
    .stagger-children.visible > *:nth-child(5){transition-delay:.33s}
    .stagger-children.visible > *:nth-child(6){transition-delay:.40s}

    /* ── FLOATING ORBS ──────────────────────────────────────── */
    .orb-animated{animation:orbFloat 12s ease-in-out infinite}

    /* ── SHIMMER SKELETON ───────────────────────────────────── */
    .shimmer{background:linear-gradient(90deg,var(--card) 0%,var(--card3) 50%,var(--card) 100%);background-size:600px 100%;animation:shimmer 1.5s infinite}

    /* ── BORDER GLOW ────────────────────────────────────────── */
    .border-glow{position:relative}
    .border-glow::before{content:'';position:absolute;inset:-1px;background:linear-gradient(135deg,var(--gold),var(--purple),var(--gold));border-radius:inherit;z-index:-1;opacity:0;transition:opacity .4s;animation:borderFlow 3s ease infinite;background-size:200% 200%}
    .border-glow:hover::before{opacity:1}

    /* ── TEXT GRADIENT ANIMATE ──────────────────────────────── */
    .text-shimmer{background:linear-gradient(90deg,var(--gold3),var(--gold),var(--gold2),var(--gold3));background-size:300% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:goldShimmer 4s linear infinite}

    /* ── HOVER LIFT ─────────────────────────────────────────── */
    .hover-lift{transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s ease}
    .hover-lift:hover{transform:translateY(-6px);box-shadow:0 20px 40px rgba(0,0,0,.4)}

    /* ── SCROLL PROGRESS BAR ────────────────────────────────── */
    .scroll-progress{position:fixed;top:0;left:0;height:2px;background:linear-gradient(90deg,var(--purple),var(--gold));z-index:9999;transition:width .1s linear;pointer-events:none}

    /* ── SECTION TRANSITION LINE ────────────────────────────── */
    .section-line{width:0;height:1px;background:linear-gradient(90deg,var(--purple),var(--gold),transparent);transition:width 1.2s cubic-bezier(.22,1,.36,1)}
    .section-line.visible{width:100%}

    /* ── ANIMATED UNDERLINE ─────────────────────────────────── */
    .anim-underline{position:relative}
    .anim-underline::after{content:'';position:absolute;bottom:-2px;left:0;width:0;height:1px;background:var(--gold);transition:width .3s ease}
    .anim-underline:hover::after{width:100%}

    /* ── TOAST ENHANCED ─────────────────────────────────────── */
    .toast{animation:slideUp .35s cubic-bezier(.22,1,.36,1)}
    .toast::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--gold);border-radius:2px 0 0 2px}
    .toast{position:relative;padding-left:1.2rem!important}

    /* ── EMOJI PULSE ────────────────────────────────────────── */
    .emoji-float{display:inline-block;animation:float 4s ease infinite}
    .emoji-float-b{display:inline-block;animation:floatB 5s ease infinite}

    /* ── FORM INPUT ANIMATED ────────────────────────────────── */
    .inp-animated{position:relative}
    .inp-animated::after{content:'';position:absolute;bottom:0;left:50%;right:50%;height:1px;background:var(--gold);transition:left .3s ease,right .3s ease}
    .inp-animated:focus-within::after{left:0;right:0}

    /* NAV */
    .nav{position:fixed;top:0;left:0;right:0;z-index:500;height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 2.5rem;transition:all .3s}
    .nav.scrolled{background:rgba(5,5,8,.92);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
    .nav-logo{font-family:'Cormorant Garamond',serif;font-size:1.45rem;font-weight:400;letter-spacing:.3em;color:var(--gold);cursor:pointer;white-space:nowrap}
    .nav-center{display:flex;gap:2.2rem;list-style:none}
    .nav-link{font-size:.72rem;letter-spacing:.2em;text-transform:uppercase;color:var(--text3);cursor:pointer;transition:color .2s;position:relative;padding-bottom:2px}
    .nav-link:hover,.nav-link.active{color:var(--text)}
    .nav-link.active::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:var(--gold)}
    .nav-right{display:flex;align-items:center;gap:.7rem}
    .icon-btn{width:38px;height:38px;background:none;border:none;color:var(--text3);display:flex;align-items:center;justify-content:center;border-radius:50%;transition:all .2s;position:relative;flex-shrink:0}
    .icon-btn:hover{color:var(--text);background:rgba(255,255,255,.05)}
    .badge{position:absolute;top:3px;right:3px;width:14px;height:14px;border-radius:50%;font-size:8px;display:flex;align-items:center;justify-content:center;font-weight:600;border:1.5px solid var(--black)}

    /* BUTTONS */
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:.6rem;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;border:none;transition:all .25s;cursor:pointer;white-space:nowrap;font-family:'Tenor Sans',serif}
    .btn-gold{background:var(--gold);color:#000;padding:.85rem 2.2rem}
    .btn-gold:hover{background:var(--gold2);transform:translateY(-1px);box-shadow:0 8px 24px rgba(200,169,110,.25)}
    .btn-gold:active{transform:none}
    .btn-outline{background:transparent;color:var(--text);padding:.85rem 2.2rem;border:1px solid var(--border2)}
    .btn-outline:hover{border-color:var(--gold);color:var(--gold)}
    .btn-ghost{background:none;border:none;color:var(--text3);padding:.5rem 1rem;font-size:.75rem;letter-spacing:.1em}
    .btn-ghost:hover{color:var(--text)}
    .btn-sm{padding:.6rem 1.4rem;font-size:.68rem}
    .btn-icon{width:42px;height:42px;padding:0;border-radius:0}
    .btn-danger{border-color:var(--red);color:var(--red)}
    .btn-danger:hover{background:var(--red2)}
    .btn-purple{background:var(--purple);color:#fff;padding:.85rem 2.2rem}
    .btn-purple:hover{background:var(--purple2)}
    .btn:disabled{opacity:.5;pointer-events:none}

    /* INPUTS */
    .inp{width:100%;background:var(--card2);border:1px solid var(--border);color:var(--text);padding:.8rem 1rem;font-size:.88rem;outline:none;transition:border-color .2s;font-family:'Tenor Sans',serif}
    .inp:focus{border-color:var(--gold)}
    .inp::placeholder{color:var(--border2);font-size:.82rem}
    .inp-label{display:block;font-size:.62rem;letter-spacing:.22em;text-transform:uppercase;color:var(--text3);margin-bottom:.45rem}
    .form-group{margin-bottom:1.1rem}
    .form-row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
    .form-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem}
    .inp-error{border-color:var(--red)!important}
    .err-msg{font-size:.72rem;color:var(--red);margin-top:.3rem}
    select.inp{cursor:pointer}
    textarea.inp{resize:vertical;min-height:100px}

    /* CARDS */
    .card{background:var(--card);border:1px solid var(--border);transition:all .3s}
    .card:hover{border-color:var(--border2)}
    .card-elevated{box-shadow:var(--shadow)}

    /* TOAST */
    .toasts{position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;pointer-events:none}
    .toast{background:var(--card2);border:1px solid var(--border2);border-left:3px solid var(--gold);padding:.9rem 1.3rem;font-size:.8rem;letter-spacing:.04em;animation:slideUp .3s ease;color:var(--text);max-width:300px;pointer-events:all;line-height:1.4}
    .toast.err{border-left-color:var(--red)}
    .toast.ok{border-left-color:var(--green)}
    .toast.info{border-left-color:var(--purple2)}

    /* MODAL */
    .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:800;backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:1rem;animation:fadeIn .2s ease}
    .modal{background:var(--deep);border:1px solid var(--border2);width:100%;max-width:540px;max-height:90vh;overflow-y:auto;animation:scaleIn .25s ease}
    .modal-lg{max-width:720px}
    .modal-hd{display:flex;align-items:center;justify-content:space-between;padding:1.5rem 2rem;border-bottom:1px solid var(--border)}
    .modal-title{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:400;letter-spacing:.05em}
    .modal-bd{padding:2rem}
    .modal-ft{display:flex;gap:.8rem;justify-content:flex-end;padding:1.2rem 2rem;border-top:1px solid var(--border)}

    /* PRODUCT CARD */
    .pc{background:var(--card);border:1px solid var(--border);cursor:pointer;transition:all .35s;position:relative;overflow:hidden;animation:fadeUp .5s ease both}
    .pc:hover{border-color:rgba(200,169,110,.25);transform:translateY(-5px);box-shadow:0 20px 50px rgba(0,0,0,.5)}
    .pc-img{height:240px;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,var(--card3) 0%,var(--card) 100%);position:relative;overflow:hidden}
    .pc-emoji{font-size:5.5rem;transition:transform .5s ease;display:block;animation:float 4s ease infinite}
    .pc:hover .pc-emoji{transform:scale(1.08)}
    .pc-badge{position:absolute;top:.9rem;left:.9rem;font-size:.58rem;letter-spacing:.14em;text-transform:uppercase;padding:.28rem .65rem;font-weight:600}
    .badge-bs{background:var(--purple);color:#fff}
    .badge-cl{background:transparent;border:1px solid var(--gold);color:var(--gold)}
    .badge-nw{background:var(--gold);color:#000}
    .badge-sl{background:var(--red);color:#fff}
    .pc-wish{position:absolute;bottom:.9rem;right:.9rem;width:32px;height:32px;background:rgba(5,5,8,.7);border:1px solid var(--border2);border-radius:50%;display:flex;align-items:center;justify-content:center;transition:all .2s;backdrop-filter:blur(4px)}
    .pc-wish:hover,.pc-wish.on{border-color:var(--red);color:var(--red)}
    .pc-wish.on{background:rgba(214,79,79,.12)}
    .pc-body{padding:1.2rem 1.4rem 1.4rem}
    .pc-house{font-size:.6rem;letter-spacing:.28em;text-transform:uppercase;color:var(--text3);margin-bottom:.35rem}
    .pc-name{font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-weight:400;margin-bottom:.5rem;line-height:1.2}
    .pc-stars{display:flex;align-items:center;gap:.35rem;margin-bottom:.85rem}
    .pc-foot{display:flex;align-items:center;justify-content:space-between}
    .pc-price{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:300}
    .pc-old{font-size:.8rem;color:var(--text3);text-decoration:line-through;margin-left:.4rem;font-family:'DM Mono',monospace}
    .pc-cart{width:36px;height:36px;background:var(--purple);border:none;color:#fff;display:flex;align-items:center;justify-content:center;transition:all .2s}
    .pc-cart:hover{background:var(--purple2)}

    /* STARS */
    .stars{display:flex;gap:2px;align-items:center}
    .star{color:var(--gold);line-height:1}
    .star.e{color:var(--border2)}
    .rc{font-size:.72rem;color:var(--text3);font-family:'DM Mono',monospace}

    /* SHOP LAYOUT */
    .shop-layout{display:grid;grid-template-columns:256px 1fr;min-height:100vh;padding-top:68px}
    .sidebar{padding:2rem 1.8rem;border-right:1px solid var(--border);position:sticky;top:68px;height:calc(100vh - 68px);overflow-y:auto;background:var(--deep)}
    .sb-title{font-size:.62rem;letter-spacing:.28em;text-transform:uppercase;color:var(--text3);margin-bottom:1rem;padding-bottom:.7rem;border-bottom:1px solid var(--border)}
    .sb-section{margin-bottom:2.2rem}
    .shop-main{padding:2rem 2.5rem}
    .shop-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.8rem;gap:1rem;flex-wrap:wrap}
    .shop-count{font-size:.82rem;color:var(--text3)}
    .shop-count b{color:var(--text);font-weight:400}
    .grid-3{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:1.4rem}
    .grid-4{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1.2rem}

    /* RANGE INPUT */
    input[type=range]{width:100%;-webkit-appearance:none;height:2px;background:var(--border2);outline:none;cursor:pointer}
    input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;background:var(--gold);border-radius:50%}
    .range-val{display:flex;justify-content:space-between;font-size:.75rem;color:var(--text3);margin-bottom:.6rem;font-family:'DM Mono',monospace}

    /* CHECKBOX */
    .cb-item{display:flex;align-items:center;gap:.7rem;cursor:pointer;padding:.3rem 0;font-size:.82rem;color:var(--text3);transition:color .2s}
    .cb-item:hover,.cb-item.on{color:var(--text)}
    .cb-item input{accent-color:var(--purple);width:13px;height:13px;cursor:pointer}

    /* PRODUCT PAGE */
    .pp-wrap{padding-top:68px;min-height:100vh}
    .pp-inner{display:grid;grid-template-columns:1fr 1fr;max-width:1200px;margin:0 auto;padding:3.5rem 2rem;gap:0;align-items:start}
    .pp-gallery{position:relative}
    .pp-main-img{aspect-ratio:1;background:radial-gradient(ellipse at center,var(--card3),var(--card));display:flex;align-items:center;justify-content:center;font-size:11rem;border:1px solid var(--border)}
    .pp-thumbs{display:flex;gap:.7rem;margin-top:.8rem}
    .pp-thumb{width:68px;height:68px;background:var(--card2);border:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.8rem;transition:border-color .2s;flex-shrink:0}
    .pp-thumb.on{border-color:var(--gold)}
    .pp-info{padding:2.5rem}
    .pp-house{font-size:.62rem;letter-spacing:.3em;text-transform:uppercase;color:var(--gold);margin-bottom:.8rem}
    .pp-name{font-family:'Cormorant Garamond',serif;font-size:2.8rem;font-weight:300;line-height:1.05;margin-bottom:.7rem}
    .pp-tagline{font-family:'Cormorant Garamond',serif;font-style:italic;color:var(--text3);font-size:1.05rem;margin-bottom:1.4rem}
    .pp-price{font-family:'Cormorant Garamond',serif;font-size:2.4rem;font-weight:300;margin-bottom:2rem}
    .size-row{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:2rem}
    .size-btn{padding:.48rem 1rem;border:1px solid var(--border2);background:none;color:var(--text3);font-size:.78rem;cursor:pointer;transition:all .2s;font-family:'DM Mono',monospace;display:flex;flex-direction:column;align-items:center;min-width:60px}
    .size-btn:hover{border-color:var(--gold);color:var(--gold)}
    .size-btn.on{border-color:var(--gold);color:var(--gold);background:var(--gold-dim)}
    .qty-row{display:flex;align-items:center;border:1px solid var(--border2)}
    .qty-btn{width:42px;height:46px;background:none;border:none;color:var(--text);font-size:1rem;cursor:pointer;transition:background .2s}
    .qty-btn:hover{background:rgba(255,255,255,.05)}
    .qty-n{width:50px;text-align:center;font-family:'DM Mono',monospace;font-size:.9rem;color:var(--text)}
    .trust-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;padding:1.4rem 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:1.8rem}
    .trust-item{text-align:center}
    .trust-ico{font-size:1.3rem;margin-bottom:.3rem}
    .trust-t{font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.15rem}
    .trust-s{font-size:.68rem;color:var(--text3)}
    .notes-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1.5rem;margin-top:1rem}
    .note-group-t{font-size:.6rem;letter-spacing:.22em;text-transform:uppercase;color:var(--text3);margin-bottom:.5rem}
    .note-tag{display:inline-block;padding:.18rem .5rem;border:1px solid var(--border);font-size:.65rem;color:var(--text2);margin:.18rem .1rem;font-family:'DM Mono',monospace;letter-spacing:.04em}

    /* REVIEWS */
    .review-card{padding:1.5rem 0;border-bottom:1px solid var(--border)}
    .review-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem}
    .review-author{font-size:.85rem;font-weight:600;letter-spacing:.05em}
    .review-date{font-size:.72rem;color:var(--text3);font-family:'DM Mono',monospace}
    .review-text{font-size:.88rem;color:var(--text2);line-height:1.7;margin-top:.5rem}
    .review-verified{font-size:.62rem;letter-spacing:.1em;color:var(--green);text-transform:uppercase;margin-top:.4rem}
    .rating-bars{display:flex;flex-direction:column;gap:.5rem;margin:1rem 0}
    .bar-row{display:flex;align-items:center;gap:.8rem;font-size:.75rem;font-family:'DM Mono',monospace}
    .bar-track{flex:1;height:4px;background:var(--border2);border-radius:2px;overflow:hidden}
    .bar-fill{height:100%;background:var(--gold);border-radius:2px;transition:width .8s ease}

    /* CART PAGE */
    .cart-page{padding-top:68px;min-height:100vh}
    .cart-inner{max-width:1100px;margin:0 auto;padding:3rem 2rem;display:grid;grid-template-columns:1fr 360px;gap:2.5rem;align-items:start}
    .cart-item-row{display:grid;grid-template-columns:80px 1fr auto;gap:1.2rem;align-items:center;padding:1.4rem 0;border-bottom:1px solid var(--border)}
    .cart-thumb{width:80px;height:80px;background:var(--card2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:2.2rem}
    .cart-name{font-family:'Cormorant Garamond',serif;font-size:1.15rem;margin-bottom:.25rem}
    .cart-meta{font-size:.72rem;color:var(--text3);font-family:'DM Mono',monospace;margin-bottom:.5rem}
    .cart-remove{background:none;border:none;color:var(--text3);font-size:.72rem;cursor:pointer;transition:color .2s;font-family:'Tenor Sans',serif;letter-spacing:.05em;text-decoration:underline}
    .cart-remove:hover{color:var(--red)}
    .cart-price{font-family:'Cormorant Garamond',serif;font-size:1.3rem;text-align:right}
    .order-summary{background:var(--card);border:1px solid var(--border);padding:1.8rem;position:sticky;top:88px}
    .summary-row{display:flex;justify-content:space-between;font-size:.83rem;color:var(--text2);margin-bottom:.8rem}
    .summary-row.total{font-family:'Cormorant Garamond',serif;font-size:1.5rem;color:var(--text);margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)}
    .coupon-row{display:flex;gap:.5rem;margin:1.2rem 0}
    .coupon-inp{flex:1;background:var(--card2);border:1px solid var(--border);color:var(--text);padding:.7rem .9rem;font-size:.82rem;outline:none;font-family:'DM Mono',monospace;letter-spacing:.05em}
    .coupon-inp:focus{border-color:var(--gold)}
    .coupon-inp::placeholder{color:var(--border2)}

    /* CHECKOUT */
    .checkout-page{padding-top:68px;min-height:100vh}
    .checkout-inner{max-width:1060px;margin:0 auto;padding:3rem 2rem;display:grid;grid-template-columns:1fr 340px;gap:2.5rem;align-items:start}
    .step-bar{display:flex;align-items:center;gap:0;margin-bottom:2.5rem}
    .step{display:flex;align-items:center;gap:.6rem;font-size:.68rem;letter-spacing:.15em;text-transform:uppercase;color:var(--text3);flex:1}
    .step.done{color:var(--green)}
    .step.active{color:var(--gold)}
    .step-num{width:26px;height:26px;border-radius:50%;border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:.7rem;font-family:'DM Mono',monospace;flex-shrink:0;transition:all .3s}
    .step.active .step-num{border-color:var(--gold);background:var(--gold-dim);color:var(--gold)}
    .step.done .step-num{border-color:var(--green);background:var(--green2);color:var(--green)}
    .step-line{flex:1;height:1px;background:var(--border)}
    .checkout-section{background:var(--card);border:1px solid var(--border);padding:1.8rem;margin-bottom:1.2rem}
    .checkout-section-title{font-family:'Cormorant Garamond',serif;font-size:1.3rem;font-weight:400;margin-bottom:1.4rem;padding-bottom:.8rem;border-bottom:1px solid var(--border)}
    .addr-card{border:1px solid var(--border);padding:1rem;cursor:pointer;transition:all .2s;margin-bottom:.7rem;display:flex;align-items:flex-start;gap:.9rem}
    .addr-card.on{border-color:var(--gold);background:var(--gold-dim)}
    .addr-card input[type=radio]{accent-color:var(--gold);margin-top:3px;flex-shrink:0}
    .payment-option{border:1px solid var(--border);padding:1rem 1.2rem;cursor:pointer;transition:all .2s;margin-bottom:.7rem;display:flex;align-items:center;gap:.9rem}
    .payment-option.on{border-color:var(--gold);background:var(--gold-dim)}
    .card-icons{display:flex;gap:.5rem;margin-top:.8rem}
    .card-icon{width:44px;height:28px;background:var(--card2);border:1px solid var(--border);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:.65rem;color:var(--text3);letter-spacing:.02em}

    /* ORDER CONFIRM */
    .confirm-page{padding-top:68px;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:5rem 2rem}
    .confirm-inner{max-width:600px;width:100%;text-align:center}
    .confirm-icon{width:80px;height:80px;border-radius:50%;background:var(--green2);border:2px solid var(--green);display:flex;align-items:center;justify-content:center;font-size:2rem;margin:0 auto 2rem;animation:scaleIn .5s .2s ease both}
    .confirm-order-id{font-family:'DM Mono',monospace;font-size:.85rem;color:var(--gold);letter-spacing:.15em;margin:1rem 0}
    .confirm-items{background:var(--card);border:1px solid var(--border);padding:1.5rem;text-align:left;margin:2rem 0}

    /* PROFILE PAGE */
    .profile-page{padding-top:68px;min-height:100vh}
    .profile-inner{max-width:1100px;margin:0 auto;padding:2.5rem 2rem;display:grid;grid-template-columns:240px 1fr;gap:2rem;align-items:start}
    .profile-sidebar{background:var(--card);border:1px solid var(--border);overflow:hidden;position:sticky;top:88px}
    .profile-avatar-area{padding:2rem 1.5rem;text-align:center;border-bottom:1px solid var(--border);background:radial-gradient(ellipse at center,var(--card3),var(--card))}
    .avatar-circle{width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--gold));display:flex;align-items:center;justify-content:center;font-family:'Cormorant Garamond',serif;font-size:1.8rem;margin:0 auto 1rem;font-weight:400;color:#000;flex-shrink:0}
    .profile-name{font-family:'Cormorant Garamond',serif;font-size:1.2rem;margin-bottom:.2rem}
    .profile-email{font-size:.72rem;color:var(--text3);font-family:'DM Mono',monospace}
    .profile-nav-item{display:flex;align-items:center;gap:.8rem;padding:.8rem 1.5rem;font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);cursor:pointer;transition:all .2s;border-left:3px solid transparent}
    .profile-nav-item:hover{color:var(--text);background:rgba(255,255,255,.02)}
    .profile-nav-item.on{color:var(--gold);border-left-color:var(--gold);background:var(--gold-dim)}
    .profile-content{background:var(--card);border:1px solid var(--border);padding:2rem;min-height:500px}
    .profile-section-title{font-family:'Cormorant Garamond',serif;font-size:1.6rem;font-weight:400;margin-bottom:.3rem}
    .profile-section-sub{font-size:.8rem;color:var(--text3);margin-bottom:2rem}
    .order-row{display:flex;align-items:center;justify-content:space-between;padding:1.1rem 0;border-bottom:1px solid var(--border);cursor:pointer;transition:background .2s;margin:0 -.5rem;padding-left:.5rem;padding-right:.5rem}
    .order-row:hover{background:rgba(255,255,255,.02)}
    .order-id{font-family:'DM Mono',monospace;font-size:.78rem;color:var(--gold);letter-spacing:.1em}
    .order-date{font-size:.72rem;color:var(--text3)}
    .order-total{font-family:'Cormorant Garamond',serif;font-size:1.1rem}
    .loyalty-bar-wrap{background:var(--card2);height:6px;border-radius:3px;overflow:hidden;margin:1rem 0}
    .loyalty-bar-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--gold));border-radius:3px;transition:width 1s ease}
    .points-big{font-family:'Cormorant Garamond',serif;font-size:3rem;color:var(--gold);font-weight:300}
    .addr-saved{background:var(--card2);border:1px solid var(--border);padding:1.2rem 1.4rem;margin-bottom:.8rem;position:relative}
    .addr-default{font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;color:var(--green);background:var(--green2);padding:.15rem .5rem;border-radius:2px}

    /* STATUS BADGES */
    .status{display:inline-flex;align-items:center;padding:.22rem .65rem;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;border-radius:2px}
    .s-active,.s-delivered{background:var(--green2);color:var(--green)}
    .s-pending{background:rgba(212,130,74,.15);color:var(--orange)}
    .s-shipped{background:var(--purple3);color:var(--purple2)}
    .s-cancelled,.s-inactive{background:rgba(214,79,79,.1);color:var(--red)}

    /* AUTH */
    .auth-wrap{min-height:100vh;display:flex;background:var(--black)}
    .auth-left{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem;background:radial-gradient(ellipse at 40% 50%,var(--purple3) 0%,transparent 60%),radial-gradient(ellipse at 80% 20%,rgba(200,169,110,.06) 0%,transparent 50%),var(--deep);border-right:1px solid var(--border);position:relative;overflow:hidden;min-width:420px}
    .auth-right{flex:1;display:flex;align-items:center;justify-content:center;padding:4rem}
    .auth-form-box{width:100%;max-width:400px}
    .auth-logo{font-family:'Cormorant Garamond',serif;font-size:2.2rem;font-weight:300;letter-spacing:.35em;color:var(--gold);margin-bottom:.4rem}
    .auth-tagline{font-size:.65rem;letter-spacing:.3em;text-transform:uppercase;color:var(--text3)}
    .auth-title{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;margin-bottom:.4rem}
    .auth-sub{font-size:.82rem;color:var(--text3);margin-bottom:2rem;line-height:1.6}
    .auth-switch{text-align:center;font-size:.8rem;color:var(--text3);margin-top:1.5rem}
    .auth-link{background:none;border:none;color:var(--gold);font-size:.8rem;cursor:pointer;font-family:'Tenor Sans',serif;text-decoration:underline}
    .auth-demo-box{background:rgba(200,169,110,.06);border:1px solid rgba(200,169,110,.2);padding:.9rem 1rem;margin-bottom:1.4rem;font-size:.74rem;color:var(--text3);line-height:1.7}
    .auth-demo-box strong{color:var(--gold);display:block;margin-bottom:.2rem;font-size:.66rem;letter-spacing:.15em;text-transform:uppercase}

    /* ADMIN */
    .admin-wrap{display:grid;grid-template-columns:220px 1fr;min-height:100vh;padding-top:68px}
    .admin-sidebar{background:var(--deep);border-right:1px solid var(--border);position:sticky;top:68px;height:calc(100vh - 68px);overflow-y:auto}
    .admin-sidebar-hd{padding:1.4rem 1.5rem;border-bottom:1px solid var(--border)}
    .admin-sidebar-logo{font-family:'Cormorant Garamond',serif;font-size:1rem;color:var(--gold);letter-spacing:.2em}
    .admin-nav{display:flex;flex-direction:column;padding:.8rem 0}
    .an-item{display:flex;align-items:center;gap:.7rem;padding:.75rem 1.4rem;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);cursor:pointer;transition:all .2s;border-left:3px solid transparent}
    .an-item:hover{color:var(--text);background:rgba(255,255,255,.02)}
    .an-item.on{color:var(--gold);border-left-color:var(--gold);background:var(--gold-dim)}
    .admin-content{padding:2.5rem;background:var(--black)}
    .admin-title{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;margin-bottom:.2rem}
    .admin-sub{font-size:.78rem;color:var(--text3);margin-bottom:2rem;letter-spacing:.03em}
    .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2.5rem}
    .stat-card{background:var(--card);border:1px solid var(--border);padding:1.4rem;position:relative;overflow:hidden}
    .stat-card::after{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--purple),var(--gold))}
    .stat-lbl{font-size:.6rem;letter-spacing:.22em;text-transform:uppercase;color:var(--text3);margin-bottom:.7rem}
    .stat-val{font-family:'Cormorant Garamond',serif;font-size:2.1rem;font-weight:300;margin-bottom:.25rem;line-height:1}
    .stat-chg{font-size:.7rem}
    .stat-chg.up{color:var(--green)}
    .stat-chg.dn{color:var(--red)}
    .tbl{width:100%;border-collapse:collapse;font-size:.82rem}
    .tbl th{font-size:.6rem;letter-spacing:.2em;text-transform:uppercase;color:var(--text3);padding:.75rem 1rem;border-bottom:1px solid var(--border);text-align:left;font-weight:400;white-space:nowrap}
    .tbl td{padding:.95rem 1rem;border-bottom:1px solid rgba(37,37,53,.6);color:var(--text2);vertical-align:middle}
    .tbl tr:hover td{background:rgba(255,255,255,.015);color:var(--text)}
    .tbl-wrap{background:var(--card);border:1px solid var(--border)}
    .tbl-hd{display:flex;align-items:center;justify-content:space-between;padding:1.1rem 1.5rem;border-bottom:1px solid var(--border)}
    .tbl-title{font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;color:var(--text3)}
    .act-btn{background:none;border:1px solid var(--border2);color:var(--text3);padding:.3rem .7rem;font-size:.68rem;cursor:pointer;transition:all .2s;font-family:'Tenor Sans',serif}
    .act-btn:hover{border-color:var(--gold);color:var(--gold)}
    .act-btn.del:hover{border-color:var(--red);color:var(--red)}

    /* ABOUT PAGE */
    .about-page{padding-top:68px}
    .about-hero{height:55vh;display:flex;align-items:center;justify-content:center;text-align:center;background:radial-gradient(ellipse at center,var(--purple3) 0%,transparent 60%),var(--deep);border-bottom:1px solid var(--border);position:relative;overflow:hidden}
    .timeline{max-width:700px;margin:0 auto;padding:4rem 2rem}
    .tl-item{display:grid;grid-template-columns:80px 1fr;gap:2rem;margin-bottom:3rem;position:relative}
    .tl-year{font-family:'Cormorant Garamond',serif;font-size:1.4rem;color:var(--gold);font-weight:300;padding-top:.2rem;letter-spacing:.05em}
    .tl-content{padding-bottom:3rem;border-bottom:1px solid var(--border)}
    .tl-title{font-family:'Cormorant Garamond',serif;font-size:1.3rem;margin-bottom:.5rem}
    .tl-text{font-size:.85rem;color:var(--text3);line-height:1.8}

    /* CONTACT PAGE */
    .contact-page{padding-top:68px;min-height:100vh}
    .contact-inner{max-width:1000px;margin:0 auto;padding:4rem 2rem;display:grid;grid-template-columns:1fr 1fr;gap:4rem;align-items:start}

    /* SEARCH */
    .search-overlay{position:fixed;inset:0;z-index:600;background:rgba(5,5,8,.95);backdrop-filter:blur(12px);display:flex;flex-direction:column;animation:fadeIn .2s ease}
    .search-bar-wrap{padding:2rem 3rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:1rem}
    .search-big-inp{flex:1;background:none;border:none;font-family:'Cormorant Garamond',serif;font-size:2rem;color:var(--text);outline:none;letter-spacing:.05em}
    .search-big-inp::placeholder{color:var(--border2)}
    .search-results-wrap{flex:1;overflow-y:auto;padding:2rem 3rem}
    .search-result-item{display:flex;align-items:center;gap:1.2rem;padding:1rem 0;border-bottom:1px solid var(--border);cursor:pointer;transition:background .2s}
    .search-result-item:hover{padding-left:.5rem}
    .search-result-img{width:54px;height:54px;background:var(--card2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0}

    /* GIFT SETS */
    .gift-set-card{background:var(--card);border:1px solid var(--border);overflow:hidden;transition:all .35s;cursor:pointer;animation:fadeUp .5s ease both}
    .gift-set-card:hover{border-color:rgba(200,169,110,.3);transform:translateY(-4px);box-shadow:var(--shadow2)}
    .gift-set-img{height:200px;background:radial-gradient(ellipse at center,var(--card3),var(--card));display:flex;align-items:center;justify-content:center;font-size:4rem;gap:.5rem}
    .gift-set-body{padding:1.4rem}

    /* DIVIDER */
    .gold-line{width:40px;height:1px;background:var(--gold);margin:0 auto 1.5rem}
    .section-eyebrow{font-size:.62rem;letter-spacing:.35em;text-transform:uppercase;color:var(--gold);text-align:center;margin-bottom:.9rem}
    .section-h{font-family:'Cormorant Garamond',serif;font-size:2.6rem;font-weight:300;text-align:center;margin-bottom:0;line-height:1.1}

    /* FOOTER */
    .footer{background:var(--deep);border-top:1px solid var(--border);padding:4rem 3rem 2rem}
    .footer-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:3rem;margin-bottom:3rem}
    .footer-brand{font-family:'Cormorant Garamond',serif;font-size:1.4rem;color:var(--gold);letter-spacing:.25em;margin-bottom:1rem}
    .footer-desc{font-size:.8rem;color:var(--text3);line-height:1.8;max-width:260px}
    .footer-heading{font-size:.62rem;letter-spacing:.28em;text-transform:uppercase;color:var(--text3);margin-bottom:1.1rem}
    .footer-link{display:block;font-size:.8rem;color:var(--text3);cursor:pointer;margin-bottom:.5rem;transition:color .2s}
    .footer-link:hover{color:var(--text)}
    .footer-bottom{display:flex;align-items:center;justify-content:space-between;padding-top:2rem;border-top:1px solid var(--border);font-size:.72rem;color:var(--text3)}
    .newsletter-row{display:flex;gap:.5rem;margin-top:1rem}
    .newsletter-inp{flex:1;background:var(--card);border:1px solid var(--border);color:var(--text);padding:.7rem .9rem;font-size:.8rem;outline:none;font-family:'Tenor Sans',serif}
    .newsletter-inp:focus{border-color:var(--gold)}
    .newsletter-inp::placeholder{color:var(--border2)}

    /* LOADER */
    .spinner{width:22px;height:22px;border:2px solid rgba(255,255,255,.15);border-top-color:var(--gold);border-radius:50%;animation:spin .6s linear infinite;display:inline-block}

    /* EMPTY STATE */
    .empty-state{text-align:center;padding:5rem 2rem;color:var(--text3)}
    .empty-icon{font-size:3.5rem;margin-bottom:1.2rem;display:block;opacity:.4}
    .empty-title{font-family:'Cormorant Garamond',serif;font-size:1.5rem;color:var(--text2);margin-bottom:.4rem}

    /* CART SLIDE PANEL */
    .cart-panel-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:600;backdrop-filter:blur(4px);animation:fadeIn .2s ease}
    .cart-panel{position:fixed;top:0;right:0;bottom:0;width:400px;background:var(--deep);border-left:1px solid var(--border2);z-index:601;display:flex;flex-direction:column;animation:slideIn .3s cubic-bezier(.22,1,.36,1)}
    .cp-hd{display:flex;align-items:center;justify-content:space-between;padding:1.5rem 1.8rem;border-bottom:1px solid var(--border)}
    .cp-title{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:400;letter-spacing:.08em}
    .cp-items{flex:1;overflow-y:auto;padding:1rem 1.8rem}
    .cp-item{display:grid;grid-template-columns:58px 1fr auto;gap:.9rem;align-items:center;padding:1.1rem 0;border-bottom:1px solid var(--border)}
    .cp-img{width:58px;height:58px;background:var(--card2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1.5rem}
    .cp-name{font-family:'Cormorant Garamond',serif;font-size:1rem;margin-bottom:.18rem}
    .cp-meta{font-size:.68rem;color:var(--text3);font-family:'DM Mono',monospace}
    .cp-foot{padding:1.5rem 1.8rem;border-top:1px solid var(--border)}

    /* NOTIFICATION DOT */
    .notif-dot{position:absolute;top:6px;right:6px;width:7px;height:7px;background:var(--red);border-radius:50%;border:1.5px solid var(--black)}

    /* HERO */
    .hero{height:100vh;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding-top:68px}
    .hero-bg{position:absolute;inset:0;background:radial-gradient(ellipse at 65% 50%,rgba(107,79,160,.14) 0%,transparent 55%),radial-gradient(ellipse at 25% 70%,rgba(200,169,110,.05) 0%,transparent 50%),var(--black)}
    .hero-txt{position:relative;text-align:center;max-width:680px;padding:2rem}
    .hero-eyebrow{font-size:.65rem;letter-spacing:.45em;text-transform:uppercase;color:var(--gold);margin-bottom:2rem;opacity:.85}
    .hero-h{font-family:'Cormorant Garamond',serif;font-size:clamp(3.5rem,8vw,6.5rem);font-weight:300;line-height:.95;letter-spacing:-.01em;margin-bottom:1.8rem}
    .hero-h em{font-style:italic;color:var(--gold)}
    .hero-p{font-size:.88rem;color:var(--text3);line-height:1.9;margin-bottom:3rem;max-width:400px;margin-left:auto;margin-right:auto;letter-spacing:.04em}
    .hero-orb{position:absolute;border-radius:50%;filter:blur(80px);pointer-events:none}

    /* TAG */
    .tag{display:inline-flex;align-items:center;padding:.2rem .6rem;border:1px solid var(--border2);font-size:.66rem;color:var(--text3);letter-spacing:.08em;margin:.2rem .1rem}

    /* SEARCH PILL */
    .search-inp-wrap{display:flex;align-items:center;gap:.5rem;background:var(--card2);border:1px solid var(--border);padding:.5rem .9rem;cursor:text}
    .search-inp-wrap input{background:none;border:none;color:var(--text);font-size:.82rem;outline:none;width:100%;font-family:'Tenor Sans',serif}

    /* PROGRESS STEP INDICATOR */
    .checkout-mini-items{display:flex;flex-direction:column;gap:.7rem;margin-bottom:1.2rem}
    .mini-item{display:flex;align-items:center;gap:.8rem;font-size:.8rem}
    .mini-img{width:44px;height:44px;background:var(--card2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0}
    .mini-name{font-family:'Cormorant Garamond',serif;font-size:.95rem;flex:1}
    .mini-price{font-family:'DM Mono',monospace;font-size:.78rem;color:var(--text3)}

    @media(max-width:900px){
      .shop-layout{grid-template-columns:1fr}
      .sidebar{display:none}
      .pp-inner{grid-template-columns:1fr}
      .cart-inner{grid-template-columns:1fr}
      .checkout-inner{grid-template-columns:1fr}
      .profile-inner{grid-template-columns:1fr}
      .auth-left{display:none}
      .footer-grid{grid-template-columns:1fr 1fr}
      .stat-grid{grid-template-columns:1fr 1fr}
      .admin-wrap{grid-template-columns:1fr}
      .contact-inner{grid-template-columns:1fr}
    }
    @media(max-width:600px){
      .nav-center{display:none}
      .form-row,.form-row-3{grid-template-columns:1fr}
    }
  `}</style>
);

// ─── PERSISTENT STORAGE HELPERS ───────────────────────────────────────────────
const LS_KEY = "noir_essence_db";
const LS_USER = "noir_essence_user";
const LS_CART = "noir_essence_cart";
const LS_WISH = "noir_essence_wish";

const DEFAULT_USERS = [
  { id:1, name:"Admin User", email:"admin@noiressence.com", password:"admin123", role:"admin", joined:"2023-01-15", phone:"+1 555 000 0000", points:2400, avatar:null,
    addresses:[{id:1,label:"Office",name:"Admin User",line1:"100 Admin Blvd",city:"New York",state:"NY",zip:"10001",country:"US",isDefault:true}] },
  { id:2, name:"Sophie Laurent", email:"sophie@email.com", password:"pass123", role:"customer", joined:"2024-03-15", phone:"+1 555 123 4567", points:1280, avatar:null,
    addresses:[{id:1,label:"Home",name:"Sophie Laurent",line1:"42 Rue de Rivoli",city:"New York",state:"NY",zip:"10002",country:"US",isDefault:true},{id:2,label:"Work",name:"Sophie Laurent",line1:"350 Fifth Avenue",city:"New York",state:"NY",zip:"10118",country:"US",isDefault:false}] },
  { id:3, name:"James Harlow", email:"james@email.com", password:"pass123", role:"customer", joined:"2024-06-22", phone:"+1 555 987 6543", points:540, avatar:null,
    addresses:[{id:1,label:"Home",name:"James Harlow",line1:"88 Park Avenue",city:"Los Angeles",state:"CA",zip:"90001",country:"US",isDefault:true}] },
];

// ── Storage helpers (localStorage for cart/wish, Supabase for users/products/orders) ──
const saveCart = (c) => { try { localStorage.setItem("ne_cart", JSON.stringify(c)); } catch(e){} };
const loadCart = () => { try { const s = localStorage.getItem("ne_cart"); return s ? JSON.parse(s) : []; } catch(e){ return []; } };
const saveWish = (w) => { try { localStorage.setItem("ne_wish", JSON.stringify(w)); } catch(e){} };
const loadWish = () => { try { const s = localStorage.getItem("ne_wish"); return s ? JSON.parse(s) : []; } catch(e){ return []; } };
const saveDB = () => {};
const loadDB = () => null;
const saveUser = () => {};
const loadUser = () => null;

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const initDB = () => ({
  users: DEFAULT_USERS,
  products: [
    { id:1, name:"Sauvage Elixir", house:"Dior", price:195, oldPrice:230, badge:"Bestseller", badgeType:"bs", rating:5, reviews:342, emoji:"🫐", gender:"Masculine", concentration:"Elixir", sizes:["10ml","60ml","100ml"], sizePrices:{"10ml":117,"60ml":195,"100ml":302}, stock:24, status:"active", description:"An intensely fresh and powerful fragrance built on a bold woody, spicy heart. A raw, noble material celebrating fierce, free masculinity.", notes:{top:["Grapefruit","Cinnamon"],heart:["Nutmeg","Cardamom"],base:["Sandalwood","Amber"]}, tags:["Woody","Spicy","Fresh"],
      reviewList:[{user:"Marcus T.",rating:5,date:"2025-01-20",text:"Absolutely stunning. This is my signature scent now — powerful without being loud.",verified:true},{user:"Remi A.",rating:5,date:"2025-02-01",text:"Every compliment I've ever received while wearing this. Worth every penny.",verified:true},{user:"James H.",rating:4,date:"2025-02-10",text:"Incredible longevity. Lasts 12+ hours on skin easily.",verified:false}]
    },
    { id:2, name:"N°5 L'Eau", house:"Chanel", price:142, oldPrice:null, badge:"Classic", badgeType:"cl", rating:3.5, reviews:218, emoji:"🌸", gender:"Feminine", concentration:"Eau de Toilette", sizes:["35ml","50ml","100ml"], sizePrices:{"35ml":85,"50ml":142,"100ml":220}, stock:18, status:"active", description:"A luminous floral aldehyde fragrance. Fresh and sensual, it's the spirit of N°5 reinvented for modern femininity.", notes:{top:["Aldehydes","Citrus"],heart:["Rose","Jasmine","Ylang-ylang"],base:["Sandalwood","Musk"]}, tags:["Floral","Fresh","Powdery"],
      reviewList:[{user:"Chloe M.",rating:4,date:"2025-01-05",text:"Classic, feminine, and timeless. A true icon.",verified:true},{user:"Nadia S.",rating:3,date:"2025-01-22",text:"Pretty but I expected more longevity for the price.",verified:false}]
    },
    { id:3, name:"Black Orchid", house:"Tom Ford", price:175, oldPrice:null, badge:null, badgeType:null, rating:4.5, reviews:189, emoji:"🖤", gender:"Unisex", concentration:"Eau de Parfum", sizes:["50ml","100ml"], sizePrices:{"50ml":114,"100ml":175}, stock:12, status:"active", description:"A luxurious and sensual fragrance of rich, dark accords and an alluring potion of black orchids and spice.", notes:{top:["Truffle","Gardenia"],heart:["Black Orchid","Bergamot"],base:["Patchouli","Vetiver"]}, tags:["Dark","Floral","Oriental"],
      reviewList:[{user:"Elena K.",rating:5,date:"2025-02-14",text:"Mysterious, seductive, unlike anything else in my collection.",verified:true}]
    },
    { id:4, name:"Green Irish Tweed", house:"Creed", price:340, oldPrice:null, badge:"Classic", badgeType:"cl", rating:5, reviews:412, emoji:"🌿", gender:"Masculine", concentration:"Eau de Parfum", sizes:["50ml","100ml","250ml"], sizePrices:{"50ml":237,"100ml":395,"250ml":612}, sizePrices:{"50ml":171,"100ml":285,"250ml":442}, sizePrices:{"50ml":204,"100ml":340,"250ml":527}, stock:8, status:"active", description:"An icon of refined elegance, evoking the lush, verdant Irish countryside with crisp freshness.", notes:{top:["Verbena","Lemon"],heart:["Violet Leaves","Iris"],base:["Ambergris","Sandalwood"]}, tags:["Green","Fresh","Aromatic"],
      reviewList:[{user:"William P.",rating:5,date:"2025-01-30",text:"The gold standard of fresh masculine fragrances. Nothing comes close.",verified:true}]
    },
    { id:5, name:"La Vie Est Belle", house:"Lancôme", price:110, oldPrice:135, badge:"-19%", badgeType:"sl", rating:4, reviews:287, emoji:"🍬", gender:"Feminine", concentration:"Eau de Parfum", sizes:["30ml","50ml","75ml"], sizePrices:{"30ml":66,"50ml":110,"75ml":170}, stock:35, status:"active", description:"The fragrance of happiness. A gourmand iris paired with praline and vanilla creates a radiant, joyful scent.", notes:{top:["Blackcurrant","Pear"],heart:["Iris","Jasmine"],base:["Praline","Vanilla"]}, tags:["Sweet","Gourmand","Floral"],
      reviewList:[{user:"Amira N.",rating:4,date:"2025-02-20",text:"The sweetness is perfectly balanced. Not too sugary at all.",verified:true}]
    },
    { id:6, name:"Oud Wood", house:"Tom Ford", price:285, oldPrice:null, badge:"New", badgeType:"nw", rating:4.5, reviews:156, emoji:"🪵", gender:"Unisex", concentration:"Eau de Parfum", sizes:["50ml","100ml","250ml"], stock:15, status:"active", description:"Rare oud wood combines with warm spices for an intoxicating, exotic blend that defies convention.", notes:{top:["Rosewood","Cardamom"],heart:["Oud","Sandalwood"],base:["Vetiver","Tonka Bean"]}, tags:["Oud","Woody","Spicy"],
      reviewList:[{user:"Karim B.",rating:5,date:"2025-02-28",text:"Silky oud, perfectly refined. My new obsession.",verified:true}]
    },
    { id:7, name:"Aventus", house:"Creed", price:395, oldPrice:null, badge:"Bestseller", badgeType:"bs", rating:5, reviews:503, emoji:"🍍", gender:"Masculine", concentration:"Eau de Parfum", sizes:["50ml","100ml","250ml"], stock:6, status:"active", description:"A bold and sophisticated scent celebrating strength, power, vision, and success. A fragrance for those who dare.", notes:{top:["Pineapple","Bergamot","Apple"],heart:["Birch","Rose"],base:["Musk","Oakmoss"]}, tags:["Fruity","Woody","Smoky"],
      reviewList:[{user:"Alex R.",rating:5,date:"2025-03-01",text:"The king of fragrances. Timeless, powerful, unforgettable.",verified:true}]
    },
    { id:8, name:"Miss Dior Blooming Bouquet", house:"Dior", price:128, oldPrice:158, badge:"-19%", badgeType:"sl", rating:4, reviews:234, emoji:"🌺", gender:"Feminine", concentration:"Eau de Toilette", sizes:["30ml","50ml","100ml"], sizePrices:{"30ml":87,"50ml":145,"100ml":225}, sizePrices:{"30ml":77,"50ml":128,"100ml":198}, stock:42, status:"active", description:"An airy, romantic fragrance that blossoms like a bouquet of peonies and white musk in the breeze.", notes:{top:["Peonies","Mandarin"],heart:["Damascus Rose","Freesia"],base:["White Musk","Blond Wood"]}, tags:["Floral","Fresh","Romantic"],
      reviewList:[{user:"Lucia F.",rating:4,date:"2025-01-15",text:"Fresh and romantic. My go-to for spring and summer.",verified:true}]
    },
    { id:9, name:"Baccarat Rouge 540", house:"Maison Francis Kurkdjian", price:325, oldPrice:null, badge:"New", badgeType:"nw", rating:5, reviews:621, emoji:"🔴", gender:"Unisex", concentration:"Extrait de Parfum", sizes:["35ml","70ml","200ml"], sizePrices:{"35ml":195,"70ml":325,"200ml":504}, stock:20, status:"active", description:"Incandescent and warm, like molten crystal. An addictive skin scent with an extraordinary sillage.", notes:{top:["Jasmine","Saffron"],heart:["Ambergris","Fir Resin"],base:["Cedarwood","Musk"]}, tags:["Amber","Floral","Sweet"],
      reviewList:[{user:"Yasmin H.",rating:5,date:"2025-02-25",text:"The most compliment-worthy fragrance I've ever worn. Absolutely ethereal.",verified:true}]
    },
    { id:10, name:"Flowerbomb", house:"Viktor & Rolf", price:145, oldPrice:null, badge:null, badgeType:null, rating:4, reviews:198, emoji:"💣", gender:"Feminine", concentration:"Eau de Parfum", sizes:["30ml","50ml","100ml"], stock:28, status:"active", description:"A floral explosion where jasmine, rose, freesia, and orchid detonate together in a warm, addictive cloud.", notes:{top:["Tea","Bergamot"],heart:["Jasmine","Rose","Orchid"],base:["Patchouli","Musk"]}, tags:["Floral","Gourmand","Warm"],
      reviewList:[{user:"Priya K.",rating:4,date:"2025-01-28",text:"The iconic bottle and scent combo. A timeless feminine fragrance.",verified:true}]
    },
  ],
  orders: [
    { id:"NE-0012", userId:2, items:[{productId:1,qty:1,size:"100ml",price:195},{productId:5,qty:1,size:"50ml",price:110}], subtotal:305, discount:0, shipping:0, total:305, status:"delivered", date:"2025-02-14", address:"42 Rue de Rivoli, New York NY 10002", tracking:"USPS9400111899228121834234" },
    { id:"NE-0011", userId:3, items:[{productId:7,qty:1,size:"100ml",price:395}], subtotal:395, discount:0, shipping:0, total:395, status:"shipped", date:"2025-02-28", address:"88 Park Avenue, Los Angeles CA 90001", tracking:"USPS9400111899228156723890" },
    { id:"NE-0010", userId:2, items:[{productId:3,qty:1,size:"100ml",price:175},{productId:9,qty:2,size:"35ml",price:650}], subtotal:825, discount:82.5, shipping:0, total:742.5, status:"pending", date:"2025-03-01", address:"42 Rue de Rivoli, New York NY 10002", tracking:null },
    { id:"NE-0009", userId:null, items:[{productId:3,qty:1,size:"50ml",price:175}], subtotal:175, discount:0, shipping:15, total:190, status:"delivered", date:"2025-02-10", address:"Guest", tracking:"USPS9400111899228109934456" },
    { id:"NE-0008", userId:3, items:[{productId:4,qty:1,size:"50ml",price:340}], subtotal:340, discount:0, shipping:0, total:340, status:"delivered", date:"2025-01-28", address:"88 Park Avenue, Los Angeles CA 90001", tracking:"USPS9400111899228143219875" },
  ],
  giftSets: [
    { id:101, name:"The Masculine Edit", price:299, emoji1:"🫐",emoji2:"🌿",emoji3:"🪵", items:["Sauvage Elixir 60ml","Green Irish Tweed 50ml","Oud Wood 50ml"], desc:"Three of the most coveted masculine fragrances, beautifully gift-wrapped." },
    { id:102, name:"Floral Dreams", price:249, emoji1:"🌸",emoji2:"🌺",emoji3:"💣", items:["N°5 L'Eau 50ml","Miss Dior Blooming Bouquet 50ml","Flowerbomb 30ml"], desc:"A delicate floral trilogy for the woman who loves to bloom." },
    { id:103, name:"The Signature Discovery", price:189, emoji1:"🍍",emoji2:"🔴",emoji3:"🖤", items:["Aventus Sample 5ml","Baccarat Rouge 540 Sample 5ml","Black Orchid Sample 5ml","Oud Wood Sample 5ml","Sauvage Elixir Sample 5ml"], desc:"Five iconic fragrances in travel sizes — the perfect way to find your signature." },
    { id:104, name:"Luxury Duo", price:399, emoji1:"🍍",emoji2:"🔴",emoji3:null, items:["Aventus 100ml","Baccarat Rouge 540 70ml"], desc:"The two most sought-after fragrances in the world, together at last." },
  ],
  coupons: [
    { code:"NOIR10", discount:0.10, label:"10% off" },
    { code:"WELCOME20", discount:0.20, label:"20% off for new members" },
    { code:"FREESHIP", discount:0, shipping:true, label:"Free shipping" },
  ]
});

// ─── CONTEXT ──────────────────────────────────────────────────────────────────
const Ctx = createContext(null);

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Ico = ({ n, s = 18 }) => {
  const d = {
    heart:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
    heartF:<svg width={s} height={s} fill="currentColor" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
    bag:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>,
    user:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    search:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    x:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    plus:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    minus:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    chevL:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>,
    chevR:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>,
    grid:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    chart:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    pkg:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
    users:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
    cog:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
    logout:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    edit:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    trash:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
    map:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
    gift:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>,
    star:<svg width={s} height={s} fill="currentColor" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    check:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
    info:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    mail:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
    phone:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.4 11.16 19.79 19.79 0 01.36 2.57 2 2 0 012.34.4h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.8a16 16 0 006.29 6.29l1.66-1.68a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>,
    orders:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    award:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>,
    lock:<svg width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  };
  return d[n] || null;
};

// ─── ANIMATION HOOKS & COMPONENTS ────────────────────────────────────────────

// useInView — triggers when element enters viewport
const useInView = (options = {}) => {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); if (!options.repeat) obs.disconnect(); }
      else if (options.repeat) setInView(false);
    }, { threshold: options.threshold || 0.15, rootMargin: options.margin || "0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, inView];
};

// ScrollReveal wrapper
const Reveal = ({ children, dir = "up", delay = 0, className = "", style = {} }) => {
  const cls = dir === "left" ? "reveal-left" : dir === "right" ? "reveal-right" : dir === "scale" ? "reveal-scale" : "reveal";
  const [ref, inView] = useInView();
  return (
    <div ref={ref} className={`${cls}${inView ? " visible" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms`, ...style }}>
      {children}
    </div>
  );
};

// Stagger children reveal
const Stagger = ({ children, className = "", style = {} }) => {
  const [ref, inView] = useInView();
  return (
    <div ref={ref} className={`stagger-children${inView ? " visible" : ""} ${className}`} style={style}>
      {children}
    </div>
  );
};

// Animated gold divider line
const GoldLine = ({ delay = 0 }) => {
  const [ref, inView] = useInView();
  return <div ref={ref} className={`gold-line-anim${inView ? " visible" : ""}`}
    style={{ transitionDelay:`${delay}ms`, margin:"0 auto 1.5rem" }} />;
};

// Section horizontal rule
const SectionLine = () => {
  const [ref, inView] = useInView();
  return <div ref={ref} className={`section-line${inView ? " visible" : ""}`} style={{ margin:"2rem 0" }} />;
};

// Animated counter
const Counter = ({ target, suffix = "", prefix = "", duration = 1200 }) => {
  const [count, setCount] = useState(0);
  const [ref, inView] = useInView();
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const num = parseFloat(target.toString().replace(/[^0-9.]/g, ""));
    const step = num / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= num) { setCount(num); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [inView]);
  return <span ref={ref}>{prefix}{count.toLocaleString()}{suffix}</span>;
};

// Ripple button
const RippleBtn = ({ children, className = "", onClick, style = {}, disabled = false }) => {
  const [ripples, setRipples] = useState([]);
  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const id = Date.now();
    setRipples(r => [...r, { x, y, id }]);
    setTimeout(() => setRipples(r => r.filter(rp => rp.id !== id)), 700);
    onClick?.(e);
  };
  return (
    <button className={`ripple-wrap ${className}`} onClick={handleClick} style={style} disabled={disabled}>
      {children}
      {ripples.map(rp => (
        <span key={rp.id} className="ripple-circle"
          style={{ left: rp.x, top: rp.y, width: 10, height: 10, marginLeft: -5, marginTop: -5 }} />
      ))}
    </button>
  );
};

// 3D Tilt Card wrapper
const TiltCard = ({ children, className = "", style = {}, onClick }) => {
  const ref = useRef(null);
  const handleMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const rx = (y - 0.5) * -14;
    const ry = (x - 0.5) * 14;
    el.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(8px)`;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
    const shine = el.querySelector(".tilt-shine");
    if (shine) shine.style.opacity = "1";
  };
  const handleLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
    const shine = el.querySelector(".tilt-shine");
    if (shine) shine.style.opacity = "0";
  };
  return (
    <div ref={ref} className={`tilt-card ${className}`} style={style}
      onMouseMove={handleMove} onMouseLeave={handleLeave} onClick={onClick}>
      <div className="tilt-shine" />
      {children}
    </div>
  );
};

// Magnetic button
const MagBtn = ({ children, className = "", onClick, style = {}, disabled = false }) => {
  const ref = useRef(null);
  const handleMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) * 0.35;
    const y = (e.clientY - rect.top - rect.height / 2) * 0.35;
    el.style.transform = `translate(${x}px, ${y}px)`;
  };
  const handleLeave = () => {
    if (ref.current) ref.current.style.transform = "";
  };
  return (
    <button ref={ref} className={`mag-btn ${className}`} style={style}
      onMouseMove={handleMove} onMouseLeave={handleLeave}
      onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
};

// Particle field for hero
const ParticleField = () => {
  const particles = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    size: Math.random() * 3 + 1,
    duration: Math.random() * 12 + 8,
    delay: Math.random() * 10,
    dx: (Math.random() - 0.5) * 120,
    color: i % 3 === 0 ? "rgba(200,169,110,.5)" : i % 3 === 1 ? "rgba(107,79,160,.4)" : "rgba(237,233,248,.25)",
  })), []);
  return (
    <div className="particle-field">
      {particles.map(p => (
        <div key={p.id} className="particle" style={{
          left: `${p.x}%`, bottom: `-${p.size * 4}px`,
          width: p.size, height: p.size,
          background: p.color,
          "--dx": `${p.dx}px`,
          animationDuration: `${p.duration}s`,
          animationDelay: `${p.delay}s`,
          filter: "blur(.5px)",
          boxShadow: p.color.includes("169") ? `0 0 ${p.size * 2}px ${p.color}` : "none",
        }} />
      ))}
    </div>
  );
};

// Custom luxury cursor
const LuxuryCursor = () => {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const [clicking, setClicking] = useState(false);
  const [hovering, setHovering] = useState(false);
  const pos = useRef({ x: -100, y: -100 });
  const ring = useRef({ x: -100, y: -100 });
  const raf = useRef(null);

  useEffect(() => {
    const move = (e) => {
      pos.current = { x: e.clientX, y: e.clientY };
      if (dotRef.current) {
        dotRef.current.style.left = `${e.clientX}px`;
        dotRef.current.style.top = `${e.clientY}px`;
      }
      const el = e.target;
      const isHover = el.tagName === "BUTTON" || el.tagName === "A" || el.closest("button") || el.closest("a") || el.closest(".pc") || el.closest(".tilt-card") || el.closest("[data-hover]");
      setHovering(!!isHover);
    };
    const mouseDown = () => setClicking(true);
    const mouseUp = () => setClicking(false);

    const lerp = () => {
      ring.current.x += (pos.current.x - ring.current.x) * 0.12;
      ring.current.y += (pos.current.y - ring.current.y) * 0.12;
      if (ringRef.current) {
        ringRef.current.style.left = `${ring.current.x}px`;
        ringRef.current.style.top = `${ring.current.y}px`;
      }
      raf.current = requestAnimationFrame(lerp);
    };
    raf.current = requestAnimationFrame(lerp);
    window.addEventListener("mousemove", move);
    window.addEventListener("mousedown", mouseDown);
    window.addEventListener("mouseup", mouseUp);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", mouseDown);
      window.removeEventListener("mouseup", mouseUp);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="cursor-dot" style={{ left:-100,top:-100 }} />
      <div ref={ringRef} className={`cursor-ring${hovering?" hovering":""}${clicking?" clicking":""}`} style={{ left:-100,top:-100 }} />
    </>
  );
};

// Scroll progress bar
const ScrollProgress = () => {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const fn = () => {
      const s = document.documentElement.scrollTop;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setPct(h > 0 ? (s / h) * 100 : 0);
    };
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);
  return <div className="scroll-progress" style={{ width:`${pct}%` }} />;
};

// Loading screen
const LoadingScreen = ({ onDone }) => {
  useEffect(() => { const t = setTimeout(onDone, 2600); return () => clearTimeout(t); }, []);
  return (
    <div className="loading-screen">
      <div className="loading-logo">NOIR ESSENCE</div>
      <div className="loading-tagline">The House of Rare Scents</div>
      <div className="loading-bar-track">
        <div className="loading-bar-fill" />
      </div>
    </div>
  );
};

// Page transition panels
const PageTransition = ({ active }) => (
  <div className="page-transition" style={{ pointerEvents: active ? "all" : "none" }}>
    {[0,1,2,3,4].map(i => (
      <div key={i} className={`pt-panel${active ? "" : " exit"}`}
        style={{ transitionDelay:`${i * 0.05}s`, background: i % 2 === 0 ? "var(--deep)" : "var(--card)" }} />
    ))}
  </div>
);

// Hero animated title
const HeroTitle = ({ line1, line2Em }) => {
  const words1 = line1.split(" ");
  return (
    <h1 className="hero-h" style={{ clipPath:"none" }}>
      {words1.map((w, wi) => (
        <span key={wi} className="hero-word-wrap">
          <span className="hero-letter" style={{ animationDelay:`${0.3 + wi * 0.12}s` }}>{w}</span>
          {wi < words1.length - 1 && " "}
        </span>
      ))}<br />
      <span className="hero-word-wrap">
        <em className="hero-letter text-shimmer" style={{ animationDelay:`${0.3 + words1.length * 0.12}s`, fontStyle:"italic" }}>
          {line2Em}
        </em>
      </span>
    </h1>
  );
};

const Stars = ({ r, size = "13px" }) => (
  <div className="stars">
    {[1,2,3,4,5].map(i => (
      <span key={i} className={`star${i <= Math.round(r) ? "" : " e"}`} style={{ fontSize: size }}>
        {i <= r ? "★" : i - .5 === r ? "⯨" : "☆"}
      </span>
    ))}
  </div>
);

// ─── TOAST ────────────────────────────────────────────────────────────────────
const Toasts = ({ list }) => (
  <div className="toasts">
    {list.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}
  </div>
);

// ─── NAV ──────────────────────────────────────────────────────────────────────
const Nav = () => {
  const { page, go, user, cart, wishlist, cartOpen, setCartOpen, searchOpen, setSearchOpen } = useContext(Ctx);
  const [scrolled, setScrolled] = useState(false);
  const cartCount = cart.reduce((s,i) => s + i.qty, 0);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const links = [
    { label:"New Arrivals", page:"shop" },
    { label:"Bestsellers", page:"shop" },
    { label:"Gift Sets", page:"gifts" },
    { label:"About", page:"about" },
  ];

  return (
    <nav className={`nav${scrolled ? " scrolled" : ""}`}>
      <div className="nav-logo" onClick={() => go("home")}>NOIR ESSENCE</div>
      <ul className="nav-center">
        {links.map(l => (
          <li key={l.label}>
            <span className={`nav-link${page === l.page ? " active" : ""}`} onClick={() => go(l.page)}>{l.label}</span>
          </li>
        ))}
        <li><span className={`nav-link${page === "contact" ? " active" : ""}`} onClick={() => go("contact")}>Contact</span></li>
      </ul>
      <div className="nav-right">
        <button className="icon-btn" onClick={() => setSearchOpen(true)} title="Search"><Ico n="search" s={17}/></button>
        <button className="icon-btn" title="Wishlist" onClick={() => go("wishlist")} style={{ color: wishlist.length ? "var(--red)" : "var(--text3)" }}>
          <Ico n={wishlist.length ? "heartF" : "heart"} s={17}/>
          {wishlist.length > 0 && <span className="badge" style={{ background:"var(--red)", color:"#fff" }}>{wishlist.length}</span>}
        </button>
        <button className="icon-btn" title="Cart" onClick={() => setCartOpen(true)}>
          <Ico n="bag" s={17}/>
          {cartCount > 0 && <span className="badge" style={{ background:"var(--purple)", color:"#fff" }}>{cartCount}</span>}
        </button>
        {user ? (
          <button className="icon-btn" onClick={() => go(user.role === "admin" ? "admin" : "profile")} title={user.name} style={{ color:"var(--gold)" }}>
            <div className="avatar-circle" style={{ width:30, height:30, fontSize:".82rem", border:"1px solid var(--gold)" }}>
              {user.name[0]}
            </div>
          </button>
        ) : (
          <button className="btn btn-outline btn-sm" onClick={() => go("login")}>Sign In</button>
        )}
      </div>
    </nav>
  );
};

// ─── SEARCH OVERLAY ───────────────────────────────────────────────────────────
const SearchOverlay = ({ products, onClose, onViewProduct }) => {
  const [q, setQ] = useState("");
  const ref = useRef();
  useEffect(() => { ref.current?.focus(); }, []);
  const results = q.trim() ? products.filter(p =>
    p.name.toLowerCase().includes(q.toLowerCase()) ||
    p.house.toLowerCase().includes(q.toLowerCase()) ||
    p.tags.some(t => t.toLowerCase().includes(q.toLowerCase()))
  ) : [];

  return (
    <div className="search-overlay">
      <div className="search-bar-wrap">
        <Ico n="search" s={22}/>
        <input ref={ref} className="search-big-inp" placeholder="Search fragrances, houses, notes..." value={q} onChange={e => setQ(e.target.value)} />
        <button className="icon-btn" onClick={onClose}><Ico n="x" s={20}/></button>
      </div>
      <div className="search-results-wrap">
        {q && results.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">🔍</span>
            <div className="empty-title">No results for "{q}"</div>
            <p>Try a different keyword or browse our collection</p>
          </div>
        )}
        {!q && (
          <div>
            <div style={{ fontSize:".65rem", letterSpacing:".25em", textTransform:"uppercase", color:"var(--text3)", marginBottom:"1.5rem" }}>Popular Searches</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:".5rem" }}>
              {["Oud","Floral","Woody","Fresh","Tom Ford","Creed","Unisex","Sweet"].map(t => (
                <span key={t} className="tag" style={{ cursor:"pointer" }} onClick={() => setQ(t)}>{t}</span>
              ))}
            </div>
          </div>
        )}
        {results.map(p => (
          <div key={p.id} className="search-result-item" onClick={() => { onViewProduct(p.id); onClose(); }}>
            <div className="search-result-img">{p.emoji}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"1.1rem" }}>{p.name}</div>
              <div style={{ fontSize:".72rem", color:"var(--text3)", fontFamily:"'DM Mono',monospace" }}>{p.house} · {p.concentration}</div>
            </div>
            <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"1.1rem", color:"var(--gold)" }}>{fmt(p.price)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── PRODUCT CARD ─────────────────────────────────────────────────────────────
const PCard = ({ p, delay = 0, onView, onAdd }) => {
  const { wishlist, toggleWish } = useContext(Ctx);
  const wished = wishlist.includes(p.id);
  return (
    <TiltCard className="pc" style={{ animationDelay: `${delay}ms` }} onClick={() => onView(p.id)}>
      <div className="pc-img">
        {p.image_url ? (
          <img src={p.image_url} alt={p.name} style={{ width:"100%",height:"100%",objectFit:"cover",position:"absolute",inset:0 }} />
        ) : (
          <span className="pc-emoji" style={{ animationDelay: `${delay * .3}ms` }}>{p.emoji}</span>
        )}
        {p.badge && <span className={`pc-badge badge-${p.badgeType}`}>{p.badge}</span>}
        <button className={`pc-wish${wished ? " on" : ""}`} onClick={e => { e.stopPropagation(); toggleWish(p.id); }}>
          <Ico n={wished ? "heartF" : "heart"} s={13}/>
        </button>
      </div>
      <div className="pc-body">
        <div className="pc-house">{p.house}</div>
        <div className="pc-name">{p.name}</div>
        <div className="pc-stars"><Stars r={p.rating} /><span className="rc">({p.reviews})</span></div>
        <div className="pc-foot">
          <div>
            <span className="pc-price">{fmt(p.price)}</span>
            {p.oldPrice && <span className="pc-old">{fmt(p.oldPrice)}</span>}
          </div>
          <RippleBtn className="pc-cart" onClick={e => { e.stopPropagation(); onAdd(p); }}><Ico n="bag" s={14}/></RippleBtn>
        </div>
      </div>
    </TiltCard>
  );
};

// ─── CART SLIDE PANEL ─────────────────────────────────────────────────────────
const CartPanel = () => {
  const { cart, cartOpen, setCartOpen, removeFromCart, go, products, user } = useContext(Ctx);
  if (!cartOpen) return null;
  const total = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const getP = id => products.find(p => p.id === id);
  return (
    <>
      <div className="cart-panel-overlay" onClick={() => setCartOpen(false)} />
      <div className="cart-panel">
        <div className="cp-hd">
          <div className="cp-title">Shopping Cart</div>
          <button className="icon-btn" onClick={() => setCartOpen(false)}><Ico n="x" s={18}/></button>
        </div>
        {cart.length === 0 ? (
          <div className="empty-state" style={{ margin:"auto" }}>
            <span className="empty-icon">🛍</span>
            <div className="empty-title">Your cart is empty</div>
            <p style={{ fontSize:".82rem" }}>Add some fragrances to begin</p>
          </div>
        ) : (
          <>
            <div className="cp-items">
              {cart.map((item, i) => {
                const prod = getP(item.id);
                return (
                  <div key={i} className="cp-item">
                    <div className="cp-img">{item.emoji}</div>
                    <div>
                      <div className="cp-name">{item.name}</div>
                      <div className="cp-meta">{item.house} · {item.size} · Qty: {item.qty}</div>
                      <button style={{ background:"none", border:"none", color:"var(--text3)", fontSize:".68rem", cursor:"pointer", fontFamily:"'Tenor Sans',serif", textDecoration:"underline", marginTop:".3rem" }} onClick={() => removeFromCart(i)}>Remove</button>
                    </div>
                    <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"1.05rem", flexShrink:0 }}>{fmt(item.price * item.qty)}</div>
                  </div>
                );
              })}
            </div>
            <div className="cp-foot">
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"1.2rem", alignItems:"center" }}>
                <span style={{ fontSize:".7rem", letterSpacing:".15em", textTransform:"uppercase", color:"var(--text3)" }}>Subtotal</span>
                <span style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:"1.5rem" }}>{fmt(total)}</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:".6rem" }}>
                <button className="btn btn-gold" style={{ width:"100%" }} onClick={() => { setCartOpen(false); go("cart"); }}>View Cart</button>
                <button className="btn btn-outline" style={{ width:"100%" }} onClick={() => { setCartOpen(false); go("checkout"); }}>Checkout</button>
                {!user && <div style={{ fontSize:".68rem",color:"var(--text3)",textAlign:"center",marginTop:".2rem",lineHeight:1.6 }}>🔒 Login required to checkout</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};

// ─── HOME PAGE ────────────────────────────────────────────────────────────────
const HomePage = () => {
  const { go, products, addToCart, toggleWish, wishlist, viewProduct } = useContext(Ctx);
  const [email, setEmail] = useState("");
  const { toast } = useContext(Ctx);
  const bestsellers = products.filter(p => p.badgeType === "bs").slice(0, 3);
  const newArr = products.filter(p => p.badgeType === "nw" || !p.badge).slice(0, 3);

  return (
    <div>
      {/* HERO */}
      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-scan" />
        <ParticleField />
        <div className="hero-orb orb-animated" style={{ width:700,height:700,background:"rgba(107,79,160,.08)",top:"-10%",right:"-18%",animationDuration:"18s" }} />
        <div className="hero-orb orb-animated" style={{ width:400,height:400,background:"rgba(200,169,110,.05)",bottom:"5%",left:"-5%",animationDuration:"14s",animationDelay:"-7s" }} />
        <div className="hero-orb orb-animated" style={{ width:250,height:250,background:"rgba(107,79,160,.06)",top:"20%",left:"8%",animationDuration:"22s",animationDelay:"-4s" }} />
        <div className="hero-txt">
          <p className="hero-eyebrow fu" style={{ animationDelay:"0.1s" }}>The House of Rare Scents · Est. 2019</p>
          <HeroTitle line1="Wear Your" line2Em="Story" />
          <p className="hero-p fu" style={{ animationDelay:"0.65s" }}>Curated fragrances from the world's most distinguished perfume houses. Each bottle, a universe of emotion.</p>
          <div style={{ display:"flex", gap:"1rem", justifyContent:"center", flexWrap:"wrap" }} className="fu" style2={{ animationDelay:"0.85s" }}>
            <div className="fu" style={{ animationDelay:"0.8s", display:"inline-block" }}>
              <MagBtn className="btn btn-gold" onClick={() => go("shop")}>Explore Collection <Ico n="chevR" s={14}/></MagBtn>
            </div>
            <div className="fu" style={{ animationDelay:"0.95s", display:"inline-block" }}>
              <MagBtn className="btn btn-outline" onClick={() => go("gifts")}>Gift Sets</MagBtn>
            </div>
          </div>
        </div>
      </section>

      {/* BRAND STRIP */}
      <Reveal>
        <div style={{ borderTop:"1px solid var(--border)",borderBottom:"1px solid var(--border)",padding:"1.4rem 3rem" }}>
          <Stagger style={{ display:"flex",justifyContent:"center",gap:"3.5rem",flexWrap:"wrap",alignItems:"center" }}>
            {["DIOR","CHANEL","TOM FORD","CREED","LANCÔME","MFK","VIKTOR & ROLF"].map(b => (
              <span key={b} style={{ fontSize:".6rem",letterSpacing:".35em",color:"var(--text3)",fontWeight:600,whiteSpace:"nowrap",transition:"color .3s",cursor:"default" }}
                onMouseEnter={e => e.target.style.color="var(--gold)"}
                onMouseLeave={e => e.target.style.color="var(--text3)"}>{b}</span>
            ))}
          </Stagger>
        </div>
      </Reveal>

      {/* BESTSELLERS */}
      <section style={{ padding:"5rem 3rem",background:"var(--deep)" }}>
        <Reveal><div className="section-eyebrow">Curated Selection</div></Reveal>
        <Reveal delay={80}><h2 className="section-h">Bestsellers</h2></Reveal>
        <Reveal delay={160}><GoldLine /></Reveal>
        <Stagger className="grid-3" style={{ maxWidth:1100,margin:"0 auto" }}>
          {bestsellers.map((p) => <PCard key={p.id} p={p} onView={viewProduct} onAdd={addToCart} />)}
        </Stagger>
        <Reveal delay={200} style={{ textAlign:"center",marginTop:"3rem" }}>
          <MagBtn className="btn btn-outline" onClick={() => go("shop")}>View Full Collection</MagBtn>
        </Reveal>
      </section>

      {/* FEATURE BANNER */}
      <section style={{ display:"grid",gridTemplateColumns:"1fr 1fr",minHeight:400 }}>
        <Reveal dir="right" style={{ background:"radial-gradient(ellipse at 30% 60%,rgba(107,79,160,.2),transparent 65%),var(--card)",padding:"4rem",display:"flex",flexDirection:"column",justifyContent:"center",borderRight:"1px solid var(--border)",borderBottom:"1px solid var(--border)" }}>
          <div style={{ fontSize:".6rem",letterSpacing:".35em",textTransform:"uppercase",color:"var(--gold)",marginBottom:"1.2rem" }}>Free Discovery</div>
          <h3 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2.5rem",fontWeight:300,marginBottom:"1rem",lineHeight:1.1 }}>Find Your<br /><em style={{ color:"var(--gold)" }}>Signature</em></h3>
          <p style={{ fontSize:".85rem",color:"var(--text3)",lineHeight:1.8,maxWidth:320,marginBottom:"2rem" }}>Not sure where to start? Our Discovery Sets let you sample 5 iconic fragrances before committing.</p>
          <MagBtn className="btn btn-outline" style={{ alignSelf:"flex-start" }} onClick={() => go("gifts")}>Shop Discovery Sets</MagBtn>
        </Reveal>
        <Reveal dir="left" style={{ background:"radial-gradient(ellipse at 70% 40%,rgba(200,169,110,.08),transparent 60%),var(--card2)",padding:"4rem",display:"flex",flexDirection:"column",justifyContent:"center",borderBottom:"1px solid var(--border)" }}>
          <div style={{ fontSize:".6rem",letterSpacing:".35em",textTransform:"uppercase",color:"var(--purple2)",marginBottom:"1.2rem" }}>Loyalty Programme</div>
          <h3 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2.5rem",fontWeight:300,marginBottom:"1rem",lineHeight:1.1 }}>Earn With<br /><em style={{ color:"var(--gold)" }}>Every Drop</em></h3>
          <p style={{ fontSize:".85rem",color:"var(--text3)",lineHeight:1.8,maxWidth:320,marginBottom:"2rem" }}>Every purchase earns you Noir Points. Redeem for discounts, early access, and exclusive gifts.</p>
          <MagBtn className="btn btn-gold" style={{ alignSelf:"flex-start" }} onClick={() => go("login")}>Join Now — It's Free</MagBtn>
        </Reveal>
      </section>

      {/* NEW ARRIVALS */}
      <section style={{ padding:"5rem 3rem" }}>
        <Reveal><div className="section-eyebrow">Just Landed</div></Reveal>
        <Reveal delay={80}><h2 className="section-h">New Arrivals</h2></Reveal>
        <Reveal delay={160}><GoldLine /></Reveal>
        <Stagger className="grid-3" style={{ maxWidth:1100,margin:"0 auto" }}>
          {newArr.map((p) => <PCard key={p.id} p={p} onView={viewProduct} onAdd={addToCart} />)}
        </Stagger>
      </section>

      {/* STATS STRIP */}
      <Reveal>
        <section style={{ padding:"4rem 3rem",background:"var(--deep)",borderTop:"1px solid var(--border)",borderBottom:"1px solid var(--border)" }}>
          <Stagger style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"2rem",maxWidth:900,margin:"0 auto",textAlign:"center" }}>
            {[["200+","Fragrances Curated"],["50+","Perfume Houses"],["12K+","Happy Members"],["4.9★","Average Rating"]].map(([n,l]) => (
              <div key={l}>
                <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2.5rem",fontWeight:300,color:"var(--gold)",marginBottom:".3rem" }}>{n}</div>
                <div style={{ fontSize:".62rem",letterSpacing:".2em",textTransform:"uppercase",color:"var(--text3)" }}>{l}</div>
              </div>
            ))}
          </Stagger>
        </section>
      </Reveal>

      {/* QUOTE */}
      <section style={{ padding:"6rem 3rem",background:"radial-gradient(ellipse at center,var(--purple3),transparent 60%),var(--deep)",textAlign:"center",borderBottom:"1px solid var(--border)",position:"relative",overflow:"hidden" }}>
        <div className="hero-orb orb-animated" style={{ width:400,height:400,background:"rgba(200,169,110,.04)",top:"50%",left:"50%",transform:"translate(-50%,-50%)",pointerEvents:"none" }} />
        <Reveal>
          <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"clamp(1.8rem,4vw,3rem)",fontWeight:300,lineHeight:1.25,maxWidth:800,margin:"0 auto 1.5rem",fontStyle:"italic" }}>
            "A fragrance is a piece of your personality — it tells the world who you are without saying a single word."
          </div>
          <div style={{ fontSize:".62rem",letterSpacing:".3em",color:"var(--gold)",textTransform:"uppercase" }}>— The Noir Essence Philosophy</div>
        </Reveal>
      </section>

      {/* NEWSLETTER */}
      <section style={{ padding:"4rem 3rem",textAlign:"center",borderBottom:"1px solid var(--border)" }}>
        <Reveal><div style={{ fontSize:".62rem",letterSpacing:".35em",textTransform:"uppercase",color:"var(--gold)",marginBottom:".8rem" }}>Stay in the loop</div></Reveal>
        <Reveal delay={80}><h3 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2rem",fontWeight:300,marginBottom:".5rem" }}>Join the Inner Circle</h3></Reveal>
        <Reveal delay={160}><p style={{ fontSize:".82rem",color:"var(--text3)",marginBottom:"2rem" }}>Early access, exclusive drops, and 10% off your first order.</p></Reveal>
        <Reveal delay={240}>
          <div style={{ display:"flex",gap:".5rem",justifyContent:"center",maxWidth:400,margin:"0 auto" }}>
            <input className="newsletter-inp" placeholder="Your email address" value={email} onChange={e => setEmail(e.target.value)} />
            <RippleBtn className="btn btn-gold" style={{ whiteSpace:"nowrap" }} onClick={() => { toast("You're on the list! 🎉", "ok"); setEmail(""); }}>Subscribe</RippleBtn>
          </div>
        </Reveal>
      </section>

      <Footer />
    </div>
  );
};

// ─── FOOTER ───────────────────────────────────────────────────────────────────
const Footer = () => {
  const { go } = useContext(Ctx);
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div>
          <div className="footer-brand">NOIR ESSENCE</div>
          <div className="footer-desc">A curated collection of the world's finest fragrances, delivered to your door with the care and discretion they deserve.</div>
        </div>
        <div>
          <div className="footer-heading">Shop</div>
          {["New Arrivals","Bestsellers","Gift Sets","Discovery Sets","All Fragrances"].map(l => (
            <span key={l} className="footer-link" onClick={() => go("shop")}>{l}</span>
          ))}
        </div>
        <div>
          <div className="footer-heading">Help</div>
          {["My Account","Order Tracking","Shipping & Returns","FAQ","Contact Us"].map(l => (
            <span key={l} className="footer-link" onClick={() => go("contact")}>{l}</span>
          ))}
        </div>
        <div>
          <div className="footer-heading">Company</div>
          {["Our Story","Press","Careers","Sustainability","Privacy Policy"].map(l => (
            <span key={l} className="footer-link" onClick={() => go("about")}>{l}</span>
          ))}
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2025 Noir Essence. All rights reserved.</span>
        <div style={{ display:"flex",gap:"1.5rem" }}>
          {["Privacy","Terms","Cookies"].map(l => <span key={l} className="footer-link">{l}</span>)}
        </div>
      </div>
    </footer>
  );
};

// ─── SHOP PAGE ────────────────────────────────────────────────────────────────
const ShopPage = () => {
  const { products, addToCart, viewProduct } = useContext(Ctx);
  const [maxPrice, setMaxPrice] = useState(300000);
  const [minRating, setMinRating] = useState(0);
  const [selectedHouses, setSelectedHouses] = useState([]);
  const [selectedGenders, setSelectedGenders] = useState([]);
  const [sort, setSort] = useState("featured");
  const [search, setSearch] = useState("");

  const houses = [...new Set(products.map(p => p.house))];

  const filtered = products
    .filter(p => p.price <= maxPrice)
    .filter(p => p.rating >= minRating)
    .filter(p => selectedHouses.length === 0 || selectedHouses.includes(p.house))
    .filter(p => selectedGenders.length === 0 || selectedGenders.includes(p.gender))
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.house.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => {
      if (sort === "price-asc") return a.price - b.price;
      if (sort === "price-desc") return b.price - a.price;
      if (sort === "top") return b.rating - a.rating;
      return 0;
    });

  const toggle = (arr, setArr, val) => setArr(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);

  return (
    <div className="shop-layout">
      <aside className="sidebar">
        <div className="sb-section">
          <div className="sb-title">Search</div>
          <div className="search-inp-wrap">
            <Ico n="search" s={14}/>
            <input placeholder="Fragrance or house..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="sb-section">
          <div className="sb-title">Price Range</div>
          <div className="range-val"><span>PKR 0</span><span>PKR {maxPrice.toLocaleString()}</span></div>
          <input type="range" min={0} max={300000} value={maxPrice} onChange={e => setMaxPrice(+e.target.value)} style={{ background:`linear-gradient(to right,var(--purple) ${maxPrice/10}%,var(--border2) ${maxPrice/10}%)` }} />
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:".68rem",color:"var(--text3)",marginTop:".3rem" }}><span>PKR 0</span><span>PKR 300,000</span></div>
        </div>
        <div className="sb-section">
          <div className="sb-title">Star Rating</div>
          <div style={{ display:"flex",flexDirection:"column",gap:".5rem" }}>
            {[5,4,3,2].map(r => (
              <label key={r} className={`cb-item${minRating === r ? " on" : ""}`}>
                <input type="radio" name="rating" checked={minRating === r} onChange={() => setMinRating(minRating === r ? 0 : r)} style={{ accentColor:"var(--purple)" }} />
                <Stars r={r} size={11} />
                <span style={{ fontSize:".75rem" }}>& Up</span>
              </label>
            ))}
          </div>
        </div>
        <div className="sb-section">
          <div className="sb-title">Perfume Houses</div>
          <div style={{ display:"flex",flexDirection:"column",gap:".3rem" }}>
            {houses.map(h => (
              <label key={h} className={`cb-item${selectedHouses.includes(h) ? " on" : ""}`}>
                <input type="checkbox" checked={selectedHouses.includes(h)} onChange={() => toggle(selectedHouses, setSelectedHouses, h)} />
                {h}
              </label>
            ))}
          </div>
        </div>
        <div className="sb-section">
          <div className="sb-title">Gender</div>
          <div style={{ display:"flex",flexDirection:"column",gap:".3rem" }}>
            {["Masculine","Feminine","Unisex"].map(g => (
              <label key={g} className={`cb-item${selectedGenders.includes(g) ? " on" : ""}`}>
                <input type="checkbox" checked={selectedGenders.includes(g)} onChange={() => toggle(selectedGenders, setSelectedGenders, g)} />
                {g}
              </label>
            ))}
          </div>
        </div>
        <div className="sb-section">
          <div className="sb-title">Fragrance Family</div>
          <div style={{ display:"flex",flexDirection:"column",gap:".3rem" }}>
            {["Woody","Floral","Oriental","Fresh","Gourmand","Oud"].map(f => (
              <label key={f} className="cb-item"><input type="checkbox" />  {f}</label>
            ))}
          </div>
        </div>
      </aside>
      <main className="shop-main">
        <div className="shop-bar">
          <div className="shop-count">Showing <b>{filtered.length}</b> fragrances</div>
          <select className="inp" style={{ width:"auto",minWidth:170,padding:".55rem .9rem",fontSize:".78rem" }} value={sort} onChange={e => setSort(e.target.value)}>
            <option value="featured">Featured</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="top">Top Rated</option>
          </select>
        </div>
        <div className="grid-3">
          {filtered.map((p,i) => <PCard key={p.id} p={p} delay={i*60} onView={viewProduct} onAdd={addToCart} />)}
          {filtered.length === 0 && (
            <div style={{ gridColumn:"1/-1" }} className="empty-state">
              <span className="empty-icon">🌿</span>
              <div className="empty-title">No fragrances match your filters</div>
              <p>Try adjusting your search or filters</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

// ─── PRODUCT PAGE ─────────────────────────────────────────────────────────────
const ProductPage = ({ productId }) => {
  const { products, addToCart, wishlist, toggleWish, viewProduct, go } = useContext(Ctx);
  const p = products.find(x => x.id === productId);
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState("");
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [review, setReview] = useState({ rating:5, text:"" });
  const { toast } = useContext(Ctx);
  const [reviews, setReviews] = useState(p?.reviewList || []);

  useEffect(() => { if (p) { setSize(p.sizes[1] || p.sizes[0]); setReviews(p.reviewList || []); } }, [productId]);

  if (!p) return null;

  // Universal size pricing — works for ALL products with or without sizePrices
  // Auto-generates tiered prices from the sizes array using volume multipliers
  const getSizePrice = (sz) => {
    // If admin set explicit sizePrices, use them
    if (p.sizePrices && p.sizePrices[sz]) return p.sizePrices[sz];
    const sizes = p.sizes || [];
    const idx = sizes.indexOf(sz);
    if (idx < 0 || sizes.length <= 1) return p.price;
    // Extract ml values for ratio-based pricing
    const getMl = (s) => parseFloat(s) || 0;
    const mls = sizes.map(getMl);
    const baseMl = mls[Math.floor((sizes.length - 1) / 2)] || mls[0] || 1; // middle size = base price
    const thisMl = getMl(sz) || baseMl;
    // Use a dampened ratio so prices don't scale linearly (smaller = slightly cheaper, larger = cheaper per ml but higher total)
    const ratio = Math.pow(thisMl / baseMl, 0.75);
    const basePrice = p.price;
    return Math.round(basePrice * ratio);
  };
  const currentPrice = getSizePrice(size);
  // Scale oldPrice proportionally if it exists
  const currentOldPrice = p.oldPrice
    ? Math.round(p.oldPrice * (currentPrice / p.price))
    : null;
  const wished = wishlist.includes(p.id);
  const related = products.filter(x => x.id !== p.id && (x.house === p.house || x.tags.some(t => p.tags.includes(t)))).slice(0,3);
  const avgRating = reviews.length ? (reviews.reduce((s,r) => s + r.rating,0) / reviews.length).toFixed(1) : p.rating;

  const ratingDist = [5,4,3,2,1].map(r => ({
    r, count: reviews.filter(x => x.rating === r).length,
    pct: reviews.length ? Math.round(reviews.filter(x => x.rating === r).length / reviews.length * 100) : 0
  }));

  const submitReview = () => {
    if (!review.text.trim()) { toast("Please write a review.", "err"); return; }
    const newR = { user:"You", rating:review.rating, date:new Date().toISOString().split("T")[0], text:review.text, verified:false };
    setReviews(prev => [newR, ...prev]);
    setShowReviewForm(false);
    setReview({ rating:5, text:"" });
    toast("Review submitted. Thank you!", "ok");
  };

  return (
    <div className="pp-wrap">
      <div style={{ maxWidth:1200,margin:"0 auto",padding:"1.5rem 2rem 0" }}>
        <button className="btn-ghost" style={{ padding:".4rem 0",fontSize:".72rem",letterSpacing:".1em",display:"flex",alignItems:"center",gap:".4rem",color:"var(--text3)" }} onClick={() => go("shop")}>
          <Ico n="chevL" s={14}/> Back to Collection
        </button>
      </div>
      <div className="pp-inner">
        {/* Gallery */}
        <div className="pp-gallery fu">
          <div className="pp-main-img">
            {p.image_url ? (
              <img src={p.image_url} alt={p.name} style={{ width:"100%",height:"100%",objectFit:"cover",borderRadius:4 }} />
            ) : (
              <span style={{ fontSize:"10rem",animation:"float 4s ease infinite" }}>{p.emoji}</span>
            )}
          </div>
          <div className="pp-thumbs">
            {[p.emoji,"✨","🎁","📦"].map((e,i) => (
              <div key={i} className={`pp-thumb${i===0?" on":""}`}>{e}</div>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="pp-info fu" style={{ animationDelay:"100ms" }}>
          <div className="pp-house">{p.house}</div>
          <h1 className="pp-name">{p.name}</h1>
          <div className="pp-tagline">{p.concentration} · {p.gender}</div>
          <div style={{ display:"flex",alignItems:"center",gap:".8rem",marginBottom:"1.5rem" }}>
            <Stars r={+avgRating} size={14} />
            <span style={{ fontSize:".78rem",color:"var(--text3)",fontFamily:"'DM Mono',monospace" }}>{avgRating} ({reviews.length} reviews)</span>
          </div>

          <div className="pp-price">
            {fmt(currentPrice)}
            {currentOldPrice && <span style={{ fontSize:".95rem",color:"var(--text3)",textDecoration:"line-through",marginLeft:".5rem" }}>{fmt(currentOldPrice)}</span>}
            {currentOldPrice && <span style={{ fontSize:".7rem",background:"var(--red)",color:"#fff",padding:".2rem .5rem",marginLeft:".5rem",letterSpacing:".05em" }}>SALE</span>}
          </div>

          <div className="inp-label">Select Size</div>
          <div className="size-row">
            {p.sizes.map(s => (
              <button key={s} className={`size-btn${size===s?" on":""}`} onClick={() => setSize(s)}>
                {s}
                <span style={{ display:"block",fontSize:".6rem",color:size===s?"var(--gold)":"var(--text3)",marginTop:".15rem",fontFamily:"'DM Mono',monospace" }}>{fmt(getSizePrice(s))}</span>
              </button>
            ))}
          </div>

          <div style={{ marginBottom:"1.8rem" }}>
            <div className="inp-label">Quantity</div>
            <div style={{ display:"flex",gap:"1rem",alignItems:"center" }}>
              <div className="qty-row">
                <button className="qty-btn" onClick={() => setQty(q => Math.max(1,q-1))}><Ico n="minus" s={14}/></button>
                <span className="qty-n">{qty}</span>
                <button className="qty-btn" onClick={() => setQty(q => q+1)}><Ico n="plus" s={14}/></button>
              </div>
              <div style={{ fontSize:".72rem",color:"var(--text3)" }}>
                {p.stock < 10 ? <span style={{ color:"var(--red)" }}>Only {p.stock} left</span> : <span style={{ color:"var(--green)" }}>In Stock</span>}
              </div>
            </div>
          </div>

          <div style={{ display:"flex",gap:".8rem",marginBottom:"2rem",flexWrap:"wrap" }}>
            <button className="btn btn-gold" style={{ flex:1,minWidth:180 }} onClick={() => addToCart({...p, price: currentPrice}, qty, size)}>
              Add to Cart — {fmt(currentPrice * qty)}
            </button>
            <button
              className="btn btn-outline btn-icon"
              style={{ color: wished ? "var(--red)" : "var(--text3)", borderColor: wished ? "var(--red)" : "var(--border2)" }}
              onClick={() => toggleWish(p.id)}
            >
              <Ico n={wished ? "heartF" : "heart"} s={18}/>
            </button>
          </div>

          <div className="trust-row">
            {[["🚚","Free Shipping","On orders over PKR 60,000"],["↩️","30-Day Returns","Easy & hassle-free"],["✓","Authentic","100% guaranteed"]].map(([ico,t,s]) => (
              <div key={t} className="trust-item">
                <div className="trust-ico">{ico}</div>
                <div className="trust-t">{t}</div>
                <div className="trust-s">{s}</div>
              </div>
            ))}
          </div>

          <p style={{ fontFamily:"'Cormorant Garamond',serif",fontStyle:"italic",fontSize:"1.05rem",color:"var(--text2)",lineHeight:1.85,marginBottom:"2rem" }}>
            {p.description}
          </p>

          <div>
            <div className="inp-label" style={{ marginBottom:".8rem" }}>Fragrance Pyramid</div>
            <div className="notes-grid">
              {Object.entries(p.notes).map(([g,notes]) => (
                <div key={g}>
                  <div className="note-group-t">{g} Notes</div>
                  {notes.map(n => <span key={n} className="note-tag">{n}</span>)}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display:"flex",gap:".4rem",flexWrap:"wrap",marginTop:"1.5rem" }}>
            {p.tags.map(t => <span key={t} className="tag">{t}</span>)}
          </div>
        </div>
      </div>

      {/* Reviews */}
      <div style={{ maxWidth:1200,margin:"0 auto",padding:"3rem 2rem" }}>
        <div style={{ display:"grid",gridTemplateColumns:"300px 1fr",gap:"3rem",alignItems:"start" }}>
          {/* Rating Summary */}
          <div>
            <div style={{ textAlign:"center",padding:"2rem",background:"var(--card)",border:"1px solid var(--border)",marginBottom:"1rem" }}>
              <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"4rem",fontWeight:300,color:"var(--gold)",lineHeight:1 }}>{avgRating}</div>
              <Stars r={+avgRating} size={16} />
              <div style={{ fontSize:".72rem",color:"var(--text3)",marginTop:".5rem" }}>Based on {reviews.length} reviews</div>
            </div>
            <div className="rating-bars">
              {ratingDist.map(({ r, pct, count }) => (
                <div key={r} className="bar-row">
                  <span>{r}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width:`${pct}%` }} /></div>
                  <span style={{ color:"var(--text3)",minWidth:20,textAlign:"right" }}>{count}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-outline" style={{ width:"100%",marginTop:"1rem" }} onClick={() => setShowReviewForm(true)}>Write a Review</button>
          </div>

          {/* Review list */}
          <div>
            <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",fontWeight:300,marginBottom:"1.5rem" }}>Customer Reviews</div>
            {reviews.length === 0 && <div className="empty-state"><span className="empty-icon">✍️</span><div>No reviews yet. Be the first!</div></div>}
            {reviews.map((rv,i) => (
              <div key={i} className="review-card">
                <div className="review-hd">
                  <div>
                    <span className="review-author">{rv.user}</span>
                    {rv.verified && <span style={{ marginLeft:".6rem",fontSize:".62rem",color:"var(--green)",letterSpacing:".08em",textTransform:"uppercase" }}>✓ Verified</span>}
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:".6rem" }}>
                    <Stars r={rv.rating} size={11} />
                    <span className="review-date">{rv.date}</span>
                  </div>
                </div>
                <div className="review-text">{rv.text}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Review Form Modal */}
        {showReviewForm && (
          <div className="modal-bg" onClick={() => setShowReviewForm(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-hd">
                <div className="modal-title">Write a Review</div>
                <button className="icon-btn" onClick={() => setShowReviewForm(false)}><Ico n="x" s={18}/></button>
              </div>
              <div className="modal-bd">
                <div className="form-group">
                  <label className="inp-label">Your Rating</label>
                  <div style={{ display:"flex",gap:".5rem" }}>
                    {[1,2,3,4,5].map(r => (
                      <span key={r} style={{ fontSize:"1.8rem",cursor:"pointer",color: r <= review.rating ? "var(--gold)" : "var(--border2)",transition:"color .2s" }} onClick={() => setReview(rv => ({ ...rv, rating:r }))}>★</span>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label className="inp-label">Your Review</label>
                  <textarea className="inp" rows={4} placeholder="Share your experience..." value={review.text} onChange={e => setReview(rv => ({ ...rv, text:e.target.value }))} />
                </div>
              </div>
              <div className="modal-ft">
                <button className="btn btn-ghost" onClick={() => setShowReviewForm(false)}>Cancel</button>
                <button className="btn btn-gold" onClick={submitReview}>Submit Review</button>
              </div>
            </div>
          </div>
        )}

        {/* Related Products */}
        {related.length > 0 && (
          <div style={{ marginTop:"4rem" }}>
            <div className="section-eyebrow" style={{ textAlign:"left",marginBottom:".8rem" }}>You May Also Like</div>
            <div className="grid-3">
              {related.map((rp,i) => <PCard key={rp.id} p={rp} delay={i*80} onView={viewProduct} onAdd={addToCart} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── CART PAGE ────────────────────────────────────────────────────────────────
const CartPage = () => {
  const { cart, setCart, removeFromCart, go, products } = useContext(Ctx);
  const { toast } = useContext(Ctx);
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const db = useContext(Ctx).db;

  const subtotal = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const shipping = subtotal >= 60000 ? 0 : 1500;
  const discount = appliedCoupon ? Math.round(subtotal * appliedCoupon.discount) : 0;
  const total = subtotal - discount + shipping;

  const applyCoupon = () => {
    const found = db.coupons.find(c => c.code === coupon.toUpperCase());
    if (found) { setAppliedCoupon(found); toast(`Coupon applied: ${found.label}`, "ok"); }
    else toast("Invalid coupon code.", "err");
  };

  const updateQty = (i, delta) => {
    setCart(prev => {
      const n = [...prev];
      n[i] = { ...n[i], qty: Math.max(1, n[i].qty + delta) };
      return n;
    });
  };

  if (cart.length === 0) return (
    <div className="cart-page">
      <div style={{ maxWidth:1100,margin:"0 auto",padding:"3rem 2rem" }}>
        <h1 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2.5rem",fontWeight:300,marginBottom:"3rem" }}>Shopping Cart</h1>
        <div className="empty-state">
          <span className="empty-icon">🛍</span>
          <div className="empty-title">Your cart is empty</div>
          <p style={{ marginBottom:"2rem" }}>Discover our curated fragrance collection</p>
          <button className="btn btn-gold" onClick={() => go("shop")}>Continue Shopping</button>
        </div>
      </div>
      <Footer />
    </div>
  );

  return (
    <div className="cart-page">
      <div className="cart-inner">
        <div>
          <h1 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2.5rem",fontWeight:300,marginBottom:"2rem" }}>Shopping Cart <span style={{ fontSize:"1rem",color:"var(--text3)",fontFamily:"'DM Mono',monospace" }}>({cart.length} items)</span></h1>
          {cart.map((item,i) => (
            <div key={i} className="cart-item-row fu" style={{ animationDelay:`${i*60}ms` }}>
              <div className="cart-thumb">{item.emoji}</div>
              <div>
                <div className="cart-name">{item.name}</div>
                <div className="cart-meta">{item.house} · {item.size} · {item.concentration}</div>
                <div style={{ display:"flex",alignItems:"center",gap:"1rem",marginTop:".6rem" }}>
                  <div className="qty-row" style={{ border:"1px solid var(--border)" }}>
                    <button className="qty-btn" style={{ width:34,height:36 }} onClick={() => updateQty(i,-1)}><Ico n="minus" s={12}/></button>
                    <span className="qty-n" style={{ width:40,fontSize:".82rem" }}>{item.qty}</span>
                    <button className="qty-btn" style={{ width:34,height:36 }} onClick={() => updateQty(i,1)}><Ico n="plus" s={12}/></button>
                  </div>
                  <button className="cart-remove" onClick={() => removeFromCart(i)}>Remove</button>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div className="cart-price">{fmt(item.price * item.qty)}</div>
                <div style={{ fontSize:".72rem",color:"var(--text3)",fontFamily:"'DM Mono',monospace" }}>{fmt(item.price)} each</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop:"2rem",padding:"1.5rem",background:"var(--card2)",border:"1px solid var(--border)" }}>
            <div style={{ fontSize:".62rem",letterSpacing:".2em",textTransform:"uppercase",color:"var(--text3)",marginBottom:".6rem" }}>Have a coupon?</div>
            <div className="coupon-row">
              <input className="coupon-inp" placeholder="Enter code (NOIR10, WELCOME20)" value={coupon} onChange={e => setCoupon(e.target.value)} onKeyDown={e => e.key === "Enter" && applyCoupon()} />
              <button className="btn btn-outline btn-sm" onClick={applyCoupon}>Apply</button>
            </div>
            {appliedCoupon && <div style={{ fontSize:".75rem",color:"var(--green)" }}>✓ {appliedCoupon.label} applied</div>}
          </div>
        </div>

        {/* Summary */}
        <div className="order-summary fu" style={{ animationDelay:"200ms" }}>
          <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.4rem",marginBottom:"1.5rem",letterSpacing:".05em" }}>Order Summary</div>
          <div className="summary-row"><span>Subtotal ({cart.length} items)</span><span>{fmt(subtotal)}</span></div>
          {discount > 0 && <div className="summary-row" style={{ color:"var(--green)" }}><span>Discount ({appliedCoupon.code})</span><span>-${discount.toFixed(0)}</span></div>}
          <div className="summary-row">
            <span>Shipping</span>
            <span>{shipping === 0 ? <span style={{ color:"var(--green)" }}>FREE</span> : fmt(shipping)}</span>
          </div>
          {shipping > 0 && <div style={{ fontSize:".72rem",color:"var(--text3)",marginBottom:".8rem" }}>Add {fmt(60000 - subtotal)} more for free shipping</div>}
          <div className="summary-row total"><span>Total</span><span>{fmt(total)}</span></div>
          <button className="btn btn-gold" style={{ width:"100%",marginTop:"1.2rem",padding:"1rem" }} onClick={() => go("checkout")}>
            Proceed to Checkout
          </button>
          <button className="btn btn-ghost" style={{ width:"100%",marginTop:".5rem" }} onClick={() => go("shop")}>Continue Shopping</button>
          <div style={{ marginTop:"1.5rem",paddingTop:"1.2rem",borderTop:"1px solid var(--border)" }}>
            <div style={{ fontSize:".65rem",letterSpacing:".1em",color:"var(--text3)",marginBottom:".6rem",textTransform:"uppercase" }}>We Accept</div>
            <div className="card-icons">
              {["VISA","MC","AMEX","PAYPAL"].map(c => <div key={c} className="card-icon">{c}</div>)}
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

// ─── CHECKOUT PAGE ────────────────────────────────────────────────────────────
const CheckoutPage = () => {
  const { cart, user, go, placeOrder, db } = useContext(Ctx);
  const { toast } = useContext(Ctx);
  const [step, setStep] = useState(1);
  const [selectedAddr, setSelectedAddr] = useState(0);
  const [newAddr, setNewAddr] = useState({ name:"",line1:"",city:"",state:"",zip:"",country:"US" });
  const [useNewAddr, setUseNewAddr] = useState(!user);
  const [payment, setPayment] = useState("card");
  const [cardInfo, setCardInfo] = useState({ number:"",name:"",expiry:"",cvv:"" });
  const [loading, setLoading] = useState(false);

  const subtotal = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const shipping = subtotal >= 60000 ? 0 : 1500;
  const total = subtotal + shipping;

  const addresses = user?.addresses || [];

  const handlePlaceOrder = () => {
    setLoading(true);
    setTimeout(() => {
      const addr = useNewAddr ? `${newAddr.name}, ${newAddr.line1}, ${newAddr.city} ${newAddr.state} ${newAddr.zip}` : `${addresses[selectedAddr]?.name}, ${addresses[selectedAddr]?.line1}, ${addresses[selectedAddr]?.city}`;
      placeOrder({ subtotal, discount:0, shipping, total, address:addr });
      setLoading(false);
    }, 1800);
  };

  if (cart.length === 0) { go("shop"); return null; }

  const steps = ["Address","Payment","Review"];

  return (
    <div className="checkout-page">
      <div className="checkout-inner">
        <div>
          {/* Steps */}
          <div className="step-bar">
            {steps.map((s,i) => (
              <>
                <div key={s} className={`step${step > i+1 ? " done" : step === i+1 ? " active" : ""}`}>
                  <div className="step-num">{step > i+1 ? <Ico n="check" s={12}/> : i+1}</div>
                  {s}
                </div>
                {i < steps.length - 1 && <div key={`l${i}`} className="step-line" />}
              </>
            ))}
          </div>

          {/* STEP 1: ADDRESS */}
          {step === 1 && (
            <div className="fi">
              <div className="checkout-section">
                <div className="checkout-section-title">Delivery Address</div>
                {addresses.length > 0 && (
                  <>
                    {addresses.map((a,i) => (
                      <div key={a.id} className={`addr-card${!useNewAddr && selectedAddr === i ? " on" : ""}`} onClick={() => { setSelectedAddr(i); setUseNewAddr(false); }}>
                        <input type="radio" readOnly checked={!useNewAddr && selectedAddr === i} />
                        <div>
                          <div style={{ display:"flex",gap:".6rem",alignItems:"center",marginBottom:".3rem" }}>
                            <span style={{ fontSize:".78rem",fontWeight:600 }}>{a.label}</span>
                            {a.isDefault && <span className="addr-default">Default</span>}
                          </div>
                          <div style={{ fontSize:".82rem",color:"var(--text2)",lineHeight:1.6 }}>
                            {a.name}<br />{a.line1}<br />{a.city}, {a.state} {a.zip}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className={`addr-card${useNewAddr ? " on" : ""}`} onClick={() => setUseNewAddr(true)}>
                      <input type="radio" readOnly checked={useNewAddr} />
                      <span style={{ fontSize:".82rem" }}>+ Use a new address</span>
                    </div>
                  </>
                )}
                {(useNewAddr || addresses.length === 0) && (
                  <div style={{ marginTop:"1rem" }}>
                    <div className="form-row">
                      <div className="form-group"><label className="inp-label">Full Name</label><input className="inp" value={newAddr.name} onChange={e => setNewAddr({...newAddr,name:e.target.value})} placeholder="Full name" /></div>
                      <div className="form-group"><label className="inp-label">Phone</label><input className="inp" placeholder="+1 555 000 0000" /></div>
                    </div>
                    <div className="form-group"><label className="inp-label">Address Line 1</label><input className="inp" value={newAddr.line1} onChange={e => setNewAddr({...newAddr,line1:e.target.value})} placeholder="Street address" /></div>
                    <div className="form-row">
                      <div className="form-group"><label className="inp-label">City</label><input className="inp" value={newAddr.city} onChange={e => setNewAddr({...newAddr,city:e.target.value})} /></div>
                      <div className="form-group"><label className="inp-label">State</label><input className="inp" value={newAddr.state} onChange={e => setNewAddr({...newAddr,state:e.target.value})} /></div>
                    </div>
                    <div className="form-row">
                      <div className="form-group"><label className="inp-label">ZIP Code</label><input className="inp" value={newAddr.zip} onChange={e => setNewAddr({...newAddr,zip:e.target.value})} /></div>
                      <div className="form-group"><label className="inp-label">Country</label>
                        <select className="inp" value={newAddr.country} onChange={e => setNewAddr({...newAddr,country:e.target.value})}>
                          <option value="US">United States</option>
                          <option value="GB">United Kingdom</option>
                          <option value="CA">Canada</option>
                          <option value="AU">Australia</option>
                          <option value="FR">France</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button className="btn btn-gold" style={{ width:"100%",padding:"1rem" }} onClick={() => setStep(2)}>Continue to Payment</button>
            </div>
          )}

          {/* STEP 2: PAYMENT */}
          {step === 2 && (
            <div className="fi">
              <div className="checkout-section">
                <div className="checkout-section-title">Payment Method</div>
                {[{id:"card",label:"Credit / Debit Card",icon:"💳"},{id:"paypal",label:"PayPal",icon:"🅿️"},{id:"crypto",label:"Cryptocurrency",icon:"₿"}].map(pm => (
                  <div key={pm.id} className={`payment-option${payment===pm.id?" on":""}`} onClick={() => setPayment(pm.id)}>
                    <input type="radio" readOnly checked={payment===pm.id} style={{ accentColor:"var(--gold)" }} />
                    <span style={{ fontSize:"1.2rem" }}>{pm.icon}</span>
                    <span style={{ fontSize:".88rem" }}>{pm.label}</span>
                  </div>
                ))}

                {payment === "card" && (
                  <div style={{ marginTop:"1.5rem" }}>
                    <div className="form-group">
                      <label className="inp-label">Card Number</label>
                      <input className="inp" placeholder="1234  5678  9012  3456" value={cardInfo.number}
                        onChange={e => setCardInfo({...cardInfo,number:e.target.value.replace(/\D/g,"").slice(0,16).replace(/(.{4})/g,"$1 ").trim()})} />
                    </div>
                    <div className="form-group">
                      <label className="inp-label">Cardholder Name</label>
                      <input className="inp" placeholder="As shown on card" value={cardInfo.name} onChange={e => setCardInfo({...cardInfo,name:e.target.value})} />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="inp-label">Expiry Date</label>
                        <input className="inp" placeholder="MM / YY" value={cardInfo.expiry} onChange={e => setCardInfo({...cardInfo,expiry:e.target.value})} />
                      </div>
                      <div className="form-group">
                        <label className="inp-label">CVV</label>
                        <input className="inp" placeholder="•••" maxLength={4} value={cardInfo.cvv} onChange={e => setCardInfo({...cardInfo,cvv:e.target.value.replace(/\D/g,"")})} />
                      </div>
                    </div>
                    <div className="card-icons">
                      {["VISA","MC","AMEX","DISCOVER"].map(c => <div key={c} className="card-icon">{c}</div>)}
                    </div>
                  </div>
                )}
                {payment === "paypal" && (
                  <div style={{ textAlign:"center",padding:"2rem",color:"var(--text3)",fontSize:".88rem" }}>
                    You'll be redirected to PayPal to complete your purchase securely.
                  </div>
                )}
              </div>
              <div style={{ display:"flex",gap:".8rem" }}>
                <button className="btn btn-ghost" style={{ flex:.4 }} onClick={() => setStep(1)}><Ico n="chevL" s={14}/> Back</button>
                <button className="btn btn-gold" style={{ flex:1,padding:"1rem" }} onClick={() => setStep(3)}>Review Order</button>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW */}
          {step === 3 && (
            <div className="fi">
              <div className="checkout-section">
                <div className="checkout-section-title">Review Your Order</div>
                {cart.map((item,i) => (
                  <div key={i} style={{ display:"flex",alignItems:"center",gap:"1rem",padding:".9rem 0",borderBottom:"1px solid var(--border)" }}>
                    <div className="mini-img">{item.emoji}</div>
                    <div style={{ flex:1 }}>
                      <div className="mini-name">{item.name}</div>
                      <div style={{ fontSize:".68rem",color:"var(--text3)",fontFamily:"'DM Mono',monospace" }}>{item.house} · {item.size} · ×{item.qty}</div>
                    </div>
                    <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1rem" }}>{fmt(item.price*item.qty)}</div>
                  </div>
                ))}
              </div>
              <div className="checkout-section">
                <div className="checkout-section-title" style={{ marginBottom:".8rem" }}>Order Details</div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.5rem",fontSize:".83rem" }}>
                  <div><div style={{ fontSize:".6rem",letterSpacing:".2em",textTransform:"uppercase",color:"var(--text3)",marginBottom:".4rem" }}>Deliver to</div>
                    <div style={{ color:"var(--text2)",lineHeight:1.6 }}>
                      {useNewAddr ? `${newAddr.name}, ${newAddr.line1}, ${newAddr.city}` : addresses[selectedAddr] ? `${addresses[selectedAddr].name}, ${addresses[selectedAddr].line1}` : "Address not selected"}
                    </div>
                  </div>
                  <div><div style={{ fontSize:".6rem",letterSpacing:".2em",textTransform:"uppercase",color:"var(--text3)",marginBottom:".4rem" }}>Payment</div>
                    <div style={{ color:"var(--text2)" }}>{payment === "card" ? `•••• ${cardInfo.number.replace(/\s/g,"").slice(-4) || "XXXX"}` : payment === "paypal" ? "PayPal" : "Cryptocurrency"}</div>
                  </div>
                </div>
              </div>
              <div style={{ display:"flex",gap:".8rem" }}>
                <button className="btn btn-ghost" style={{ flex:.4 }} onClick={() => setStep(2)}><Ico n="chevL" s={14}/> Back</button>
                <button className="btn btn-gold" style={{ flex:1,padding:"1rem" }} onClick={handlePlaceOrder} disabled={loading}>
                  {loading ? <span className="spinner" style={{ width:18,height:18,borderTopColor:"#000" }} /> : `Place Order — ${fmt(total)}`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ORDER SUMMARY SIDEBAR */}
        <div className="order-summary fu" style={{ animationDelay:"150ms" }}>
          <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.3rem",marginBottom:"1.4rem" }}>Order Summary</div>
          <div className="checkout-mini-items">
            {cart.map((item,i) => (
              <div key={i} className="mini-item">
                <div className="mini-img">{item.emoji}</div>
                <span className="mini-name">{item.name}</span>
                <span className="mini-price">{fmt(item.price*item.qty)}</span>
              </div>
            ))}
          </div>
          <div style={{ borderTop:"1px solid var(--border)",paddingTop:"1rem",display:"flex",flexDirection:"column",gap:".6rem" }}>
            <div className="summary-row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div className="summary-row"><span>Shipping</span><span>{shipping === 0 ? <span style={{ color:"var(--green)" }}>FREE</span> : fmt(shipping)}</span></div>
            <div className="summary-row total"><span>Total</span><span>{fmt(total)}</span></div>
          </div>
          <div style={{ marginTop:"1.5rem",padding:"1rem",background:"var(--card2)",border:"1px solid var(--border)",fontSize:".75rem",color:"var(--text3)",lineHeight:1.7 }}>
            🔒 Secure 256-bit SSL encryption. Your payment info is never stored.
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── ORDER CONFIRMATION ───────────────────────────────────────────────────────
const OrderConfirmPage = ({ orderId }) => {
  const { go, db, products } = useContext(Ctx);
  const order = db.orders.find(o => o.id === orderId);
  if (!order) return null;

  return (
    <div className="confirm-page">
      <div className="confirm-inner fu">
        <div className="confirm-icon">✓</div>
        <div style={{ fontSize:".62rem",letterSpacing:".35em",textTransform:"uppercase",color:"var(--gold)",marginBottom:".8rem" }}>Order Confirmed</div>
        <h1 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2.5rem",fontWeight:300,marginBottom:"1rem" }}>Thank You!</h1>
        <p style={{ fontSize:".88rem",color:"var(--text3)",lineHeight:1.8,maxWidth:400,margin:"0 auto 1rem" }}>
          Your order has been placed successfully. We'll send a confirmation email shortly.
        </p>
        <div className="confirm-order-id">Order ID: {order.id}</div>
        <div className="confirm-items">
          {order.items.map((item,i) => {
            const p = products.find(x => x.id === item.productId);
            return p ? (
              <div key={i} style={{ display:"flex",alignItems:"center",gap:"1rem",padding:".8rem 0",borderBottom:"1px solid var(--border)" }}>
                <span style={{ fontSize:"1.8rem" }}>{p.emoji}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1rem" }}>{p.name}</div>
                  <div style={{ fontSize:".7rem",color:"var(--text3)" }}>{p.house} · {item.size} · ×{item.qty}</div>
                </div>
                <div style={{ fontFamily:"'Cormorant Garamond',serif" }}>{fmt(item.price)}</div>
              </div>
            ) : null;
          })}
          <div style={{ display:"flex",justifyContent:"space-between",paddingTop:"1rem",fontFamily:"'Cormorant Garamond',serif",fontSize:"1.3rem" }}>
            <span>Total Paid</span>
            <span style={{ color:"var(--gold)" }}>{fmt(order.total)}</span>
          </div>
        </div>
        <div style={{ display:"flex",gap:"1rem",justifyContent:"center",flexWrap:"wrap" }}>
          <button className="btn btn-gold" onClick={() => go("profile")}>View My Orders</button>
          <button className="btn btn-outline" onClick={() => go("shop")}>Continue Shopping</button>
        </div>
        <div style={{ marginTop:"2rem",padding:"1rem",background:"var(--card)",border:"1px solid var(--border)",fontSize:".78rem",color:"var(--text3)",textAlign:"left" }}>
          <div style={{ marginBottom:".4rem",color:"var(--text)",fontWeight:600 }}>What happens next?</div>
          📦 Processing: 1–2 business days<br />
          🚚 Shipping: 3–5 business days<br />
          📧 You'll receive tracking info via email
        </div>
      </div>
    </div>
  );
};

// ─── AUTH PAGE ────────────────────────────────────────────────────────────────
const AuthPage = () => {
  const { go, db, setUser, pendingPage, setPendingPage } = useContext(Ctx);
  const { toast } = useContext(Ctx);
  const [mode, setMode] = useState("login"); // login | register | forgot
  const [form, setForm] = useState({ name:"", email:"", password:"", confirm:"", phone:"" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const set = (k,v) => setForm(f => ({ ...f,[k]:v }));

  const validate = () => {
    const e = {};
    if (!form.email) e.email = "Required";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Invalid email";
    if (mode !== "forgot") {
      if (!form.password) e.password = "Required";
      else if (form.password.length < 6) e.password = "Min 6 characters";
    }
    if (mode === "register") {
      if (!form.name) e.name = "Required";
      if (form.password !== form.confirm) e.confirm = "Passwords don't match";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const afterLogin = (u) => {
    setUser(u);
    if (pendingPage) {
      const dest = pendingPage;
      setPendingPage(null);
      go(dest.p, dest.param);
    } else {
      go(u.role === "admin" ? "admin" : "home");
    }
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) { setErrors({ password: error.message }); setLoading(false); return; }
        // Fetch profile from profiles table
        const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single();
        const u = profile ? { ...profile, id: data.user.id } : { id: data.user.id, name: data.user.email.split("@")[0], email: data.user.email, role: "customer", points: 0, phone:"", joined: new Date().toISOString().split("T")[0], addresses:[], status:"active" };
        if (u.status === "blocked") { toast("Your account has been blocked. Please contact support.", "err"); await supabase.auth.signOut(); setLoading(false); return; }
        toast(`Welcome back, ${u.name}!`, "ok");
        afterLogin(u);
      } else if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({ email: form.email, password: form.password });
        if (error) { setErrors({ email: error.message }); setLoading(false); return; }
        // Create profile row
        const profile = { id: data.user.id, name: form.name, email: form.email, phone: form.phone, role: "customer", joined: new Date().toISOString().split("T")[0], points: 100, status: "active" };
        await supabase.from("profiles").upsert(profile);
        db.users.push(profile);
        toast("Account created! Welcome to Noir Essence 🎉", "ok");
        afterLogin(profile);
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(form.email);
        if (error) { toast(error.message, "err"); } else { toast("Reset link sent to your email.", "ok"); setMode("login"); }
      }
    } catch(e) {
      toast("Something went wrong. Please try again.", "err");
    }
    setLoading(false);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-left">
        <div style={{ animation:"float 5s ease infinite",marginBottom:"3rem",textAlign:"center" }}>
          <div style={{ fontSize:"6rem" }}>🖤</div>
        </div>
        <div className="auth-logo">NOIR ESSENCE</div>
        <div className="auth-tagline">The House of Rare Scents</div>

        <div style={{ marginTop:"3.5rem",borderTop:"1px solid var(--border)",paddingTop:"2.5rem",maxWidth:320 }}>
          <p style={{ fontFamily:"'Cormorant Garamond',serif",fontStyle:"italic",fontSize:"1.1rem",color:"var(--text2)",lineHeight:1.9,marginBottom:"1.2rem" }}>
            "A fragrance is an invisible part of your personality that speaks volumes before you say a word."
          </p>
          <div style={{ fontSize:".6rem",letterSpacing:".25em",color:"var(--gold)",textTransform:"uppercase" }}>— Coco Chanel</div>
        </div>

        <div style={{ display:"flex",gap:"2.5rem",marginTop:"3rem" }}>
          {[["200+","Fragrances"],["50+","Houses"],["12K+","Members"]].map(([n,l]) => (
            <div key={l} style={{ textAlign:"center" }}>
              <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",color:"var(--gold)",fontWeight:300 }}>{n}</div>
              <div style={{ fontSize:".58rem",letterSpacing:".2em",color:"var(--text3)",textTransform:"uppercase" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-form-box fu">
          {mode === "login" && <>
            <div className="auth-title">Welcome Back</div>
            <div className="auth-sub">Sign in to your account to access your cart, orders, and wishlist.</div>
            <div className="form-group">
              <label className="inp-label">Email Address</label>
              <input className={`inp${errors.email ? " inp-error" : ""}`} type="email" placeholder="you@example.com" value={form.email} onChange={e => set("email",e.target.value)} onKeyDown={e => e.key==="Enter" && handleSubmit()} />
              {errors.email && <div className="err-msg">{errors.email}</div>}
            </div>
            <div className="form-group">
              <label className="inp-label" style={{ display:"flex",justifyContent:"space-between" }}>
                Password <button className="auth-link" style={{ textTransform:"none",letterSpacing:0 }} onClick={() => setMode("forgot")}>Forgot password?</button>
              </label>
              <input className={`inp${errors.password ? " inp-error" : ""}`} type="password" placeholder="••••••••" value={form.password} onChange={e => set("password",e.target.value)} onKeyDown={e => e.key==="Enter" && handleSubmit()} />
              {errors.password && <div className="err-msg">{errors.password}</div>}
            </div>
            <button className="btn btn-gold" style={{ width:"100%",padding:"1rem" }} onClick={handleSubmit} disabled={loading}>
              {loading ? <span className="spinner" style={{ width:18,height:18,borderTopColor:"#000" }} /> : "Sign In"}
            </button>
            <button className="btn btn-outline" style={{ width:"100%",marginTop:".6rem" }} onClick={() => { setPendingPage(null); go("home"); }}>Browse as Guest</button>
            <div style={{ fontSize:".7rem",color:"var(--text3)",textAlign:"center",marginTop:".6rem",lineHeight:1.6 }}>Guests can browse freely — login required to checkout or view cart.</div>
            <div className="auth-switch">Don't have an account? <button className="auth-link" onClick={() => setMode("register")}>Create one free</button></div>
          </>}

          {mode === "register" && <>
            <div className="auth-title">Create Account</div>
            <div className="auth-sub">Join Noir Essence — free to sign up. Earn 100 welcome points instantly.</div>
            <div className="form-row">
              <div className="form-group">
                <label className="inp-label">Full Name</label>
                <input className={`inp${errors.name ? " inp-error" : ""}`} placeholder="Your name" value={form.name} onChange={e => set("name",e.target.value)} />
                {errors.name && <div className="err-msg">{errors.name}</div>}
              </div>
              <div className="form-group">
                <label className="inp-label">Phone (optional)</label>
                <input className="inp" placeholder="+1 555 000 0000" value={form.phone} onChange={e => set("phone",e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="inp-label">Email Address</label>
              <input className={`inp${errors.email ? " inp-error" : ""}`} type="email" placeholder="you@example.com" value={form.email} onChange={e => set("email",e.target.value)} />
              {errors.email && <div className="err-msg">{errors.email}</div>}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="inp-label">Password</label>
                <input className={`inp${errors.password ? " inp-error" : ""}`} type="password" placeholder="Min 6 chars" value={form.password} onChange={e => set("password",e.target.value)} />
                {errors.password && <div className="err-msg">{errors.password}</div>}
              </div>
              <div className="form-group">
                <label className="inp-label">Confirm Password</label>
                <input className={`inp${errors.confirm ? " inp-error" : ""}`} type="password" placeholder="Repeat password" value={form.confirm} onChange={e => set("confirm",e.target.value)} />
                {errors.confirm && <div className="err-msg">{errors.confirm}</div>}
              </div>
            </div>
            <div style={{ fontSize:".72rem",color:"var(--text3)",marginBottom:"1.2rem",lineHeight:1.6 }}>
              By creating an account you agree to our <span style={{ color:"var(--gold)",cursor:"pointer" }}>Terms</span> and <span style={{ color:"var(--gold)",cursor:"pointer" }}>Privacy Policy</span>.
            </div>
            <button className="btn btn-gold" style={{ width:"100%",padding:"1rem" }} onClick={handleSubmit} disabled={loading}>
              {loading ? <span className="spinner" style={{ width:18,height:18,borderTopColor:"#000" }} /> : "Create Account"}
            </button>
            <div className="auth-switch">Already have an account? <button className="auth-link" onClick={() => setMode("login")}>Sign in</button></div>
          </>}

          {mode === "forgot" && <>
            <div className="auth-title">Reset Password</div>
            <div className="auth-sub">Enter your email address and we'll send you a link to reset your password.</div>
            <div className="form-group">
              <label className="inp-label">Email Address</label>
              <input className={`inp${errors.email ? " inp-error" : ""}`} type="email" placeholder="you@example.com" value={form.email} onChange={e => set("email",e.target.value)} />
              {errors.email && <div className="err-msg">{errors.email}</div>}
            </div>
            <button className="btn btn-gold" style={{ width:"100%",padding:"1rem" }} onClick={handleSubmit} disabled={loading}>
              {loading ? <span className="spinner" style={{ width:18,height:18,borderTopColor:"#000" }} /> : "Send Reset Link"}
            </button>
            <div className="auth-switch"><button className="auth-link" onClick={() => setMode("login")}>← Back to sign in</button></div>
          </>}
        </div>
      </div>
    </div>
  );
};

// ─── PROFILE PAGE ─────────────────────────────────────────────────────────────
const ProfilePage = () => {
  const { user, setUser, go, db, products } = useContext(Ctx);
  const { toast } = useContext(Ctx);
  const [tab, setTab] = useState("overview");
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({ name: user?.name||"", email: user?.email||"", phone: user?.phone||"" });
  const [pwForm, setPwForm] = useState({ current:"", newPw:"", confirm:"" });
  const [addrForm, setAddrForm] = useState({ label:"Home", name:"", line1:"", city:"", state:"", zip:"", country:"US" });
  const [showAddrForm, setShowAddrForm] = useState(false);

  if (!user) { go("login"); return null; }

  const userOrders = db.orders.filter(o => o.userId === user.id);
  const getProduct = id => products.find(p => p.id === id);

  const saveProfile = () => {
    const updated = { ...user, ...formData };
    setUser(updated);
    const idx = db.users.findIndex(u => u.id === user.id);
    if (idx >= 0) db.users[idx] = updated;
    
    setEditMode(false);
    toast("Profile updated.", "ok");
  };

  const changePw = () => {
    if (pwForm.current !== user.password) { toast("Current password incorrect.", "err"); return; }
    if (pwForm.newPw.length < 6) { toast("New password must be 6+ characters.", "err"); return; }
    if (pwForm.newPw !== pwForm.confirm) { toast("Passwords don't match.", "err"); return; }
    const updated = { ...user, password: pwForm.newPw };
    setUser(updated);
    const idx = db.users.findIndex(u => u.id === user.id);
    if (idx >= 0) db.users[idx] = updated;
    
    setPwForm({ current:"", newPw:"", confirm:"" });
    toast("Password changed successfully.", "ok");
  };

  const addAddress = () => {
    const updated = { ...user, addresses: [...(user.addresses||[]), { ...addrForm, id: Date.now(), isDefault: (user.addresses||[]).length === 0 }] };
    setUser(updated);
    const idx = db.users.findIndex(u => u.id === user.id);
    if (idx >= 0) db.users[idx] = updated;
    
    setShowAddrForm(false);
    setAddrForm({ label:"Home", name:"", line1:"", city:"", state:"", zip:"", country:"US" });
    toast("Address saved.", "ok");
  };

  const removeAddr = (addrId) => {
    const updated = { ...user, addresses: user.addresses.filter(a => a.id !== addrId) };
    setUser(updated);
    const idx = db.users.findIndex(u => u.id === user.id);
    if (idx >= 0) db.users[idx] = updated;
    
    toast("Address removed.", "");
  };

  const setDefault = (addrId) => {
    const updated = { ...user, addresses: user.addresses.map(a => ({ ...a, isDefault: a.id === addrId })) };
    setUser(updated);
    const idx = db.users.findIndex(u => u.id === user.id);
    if (idx >= 0) db.users[idx] = updated;
    
    toast("Default address updated.", "ok");
  };

  const navItems = [
    { id:"overview", label:"Overview", icon:"user" },
    { id:"orders", label:"My Orders", icon:"orders" },
    { id:"addresses", label:"Addresses", icon:"map" },
    { id:"loyalty", label:"Loyalty Points", icon:"award" },
    { id:"security", label:"Security", icon:"lock" },
  ];

  const nextTier = user.points >= 2000 ? "Diamond" : user.points >= 1000 ? "Gold" : "Silver";
  const tierPct = user.points >= 2000 ? 100 : user.points >= 1000 ? Math.min(100,(user.points-1000)/10) : Math.min(100,user.points/10);

  return (
    <div className="profile-page">
      <div className="profile-inner">
        {/* Sidebar */}
        <div className="profile-sidebar">
          <div className="profile-avatar-area">
            <div className="avatar-circle">{user.name[0]}</div>
            <div className="profile-name">{user.name}</div>
            <div className="profile-email">{user.email}</div>
            <div style={{ marginTop:".8rem",display:"inline-flex",alignItems:"center",gap:".4rem",background:"var(--gold-dim)",border:"1px solid rgba(200,169,110,.3)",padding:".2rem .7rem",fontSize:".62rem",letterSpacing:".1em",textTransform:"uppercase",color:"var(--gold)" }}>
              {user.points >= 2000 ? "💎 Diamond" : user.points >= 1000 ? "🥇 Gold" : user.points >= 500 ? "🥈 Silver" : "🥉 Bronze"}
            </div>
          </div>
          <nav style={{ padding:".5rem 0" }}>
            {navItems.map(n => (
              <div key={n.id} className={`profile-nav-item${tab===n.id?" on":""}`} onClick={() => setTab(n.id)}>
                <Ico n={n.icon} s={15}/> {n.label}
              </div>
            ))}
            {user.role === "admin" && (
              <div className="profile-nav-item" onClick={() => go("admin")}>
                <Ico n="cog" s={15}/> Admin Panel
              </div>
            )}
            <div style={{ borderTop:"1px solid var(--border)",margin:".5rem 0" }} />
            <div className="profile-nav-item" style={{ color:"var(--red)" }} onClick={async () => { await supabase.auth.signOut(); setUser(null); go("home"); toast("Signed out.", ""); }}>
              <Ico n="logout" s={15}/> Sign Out
            </div>
          </nav>
        </div>

        {/* Content */}
        <div className="profile-content fi">
          {/* OVERVIEW */}
          {tab === "overview" && (
            <div>
              <div className="profile-section-title">My Profile</div>
              <div className="profile-section-sub">Manage your personal information</div>
              {editMode ? (
                <div style={{ maxWidth:480 }}>
                  <div className="form-row">
                    <div className="form-group"><label className="inp-label">Full Name</label><input className="inp" value={formData.name} onChange={e => setFormData({...formData,name:e.target.value})} /></div>
                    <div className="form-group"><label className="inp-label">Phone</label><input className="inp" value={formData.phone} onChange={e => setFormData({...formData,phone:e.target.value})} /></div>
                  </div>
                  <div className="form-group"><label className="inp-label">Email Address</label><input className="inp" type="email" value={formData.email} onChange={e => setFormData({...formData,email:e.target.value})} /></div>
                  <div style={{ display:"flex",gap:".8rem" }}>
                    <button className="btn btn-gold" onClick={saveProfile}>Save Changes</button>
                    <button className="btn btn-ghost" onClick={() => setEditMode(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.5rem",maxWidth:560,marginBottom:"2rem" }}>
                    {[["Full Name",user.name],["Email",user.email],["Phone",user.phone||"Not set"],["Member Since",user.joined],["Role",user.role.charAt(0).toUpperCase()+user.role.slice(1)],["Loyalty Points",`${user.points} pts`]].map(([l,v]) => (
                      <div key={l}>
                        <div style={{ fontSize:".6rem",letterSpacing:".2em",textTransform:"uppercase",color:"var(--text3)",marginBottom:".3rem" }}>{l}</div>
                        <div style={{ fontSize:".9rem",color:"var(--text)",fontFamily:l==="Email"||l==="Member Since"?"'DM Mono',monospace":"inherit" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditMode(true)}><Ico n="edit" s={13}/> Edit Profile</button>
                </div>
              )}

              {/* Quick stats */}
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"1rem",marginTop:"2.5rem" }}>
                {[["Orders",userOrders.length,"Total orders placed"],["Points",user.points,"Loyalty points earned"],["Wishlist",0,"Saved fragrances"]].map(([l,v,s]) => (
                  <div key={l} style={{ background:"var(--card2)",border:"1px solid var(--border)",padding:"1.2rem" }}>
                    <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2rem",color:"var(--gold)",fontWeight:300 }}>{v}</div>
                    <div style={{ fontSize:".68rem",letterSpacing:".15em",textTransform:"uppercase",marginBottom:".2rem" }}>{l}</div>
                    <div style={{ fontSize:".72rem",color:"var(--text3)" }}>{s}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ORDERS */}
          {tab === "orders" && (
            <div>
              <div className="profile-section-title">My Orders</div>
              <div className="profile-section-sub">{userOrders.length} orders placed</div>
              {userOrders.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">📦</span>
                  <div className="empty-title">No orders yet</div>
                  <p style={{ marginBottom:"1.5rem" }}>Start shopping to see your orders here</p>
                  <button className="btn btn-gold" onClick={() => go("shop")}>Shop Now</button>
                </div>
              ) : userOrders.map(o => (
                <div key={o.id} style={{ background:"var(--card2)",border:"1px solid var(--border)",marginBottom:"1rem",padding:"1.4rem" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem",flexWrap:"wrap",gap:".5rem" }}>
                    <div>
                      <div style={{ display:"flex",alignItems:"center",gap:".8rem",marginBottom:".2rem" }}>
                        <span style={{ fontFamily:"'DM Mono',monospace",fontSize:".8rem",color:"var(--gold)",letterSpacing:".1em" }}>{o.id}</span>
                        <span className={`status s-${o.status}`}>{o.status}</span>
                      </div>
                      <div style={{ fontSize:".72rem",color:"var(--text3)" }}>Placed on {o.date} · {o.items.length} item{o.items.length>1?"s":""}</div>
                    </div>
                    <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.5rem",color:"var(--gold)" }}>{fmt(o.total)}</div>
                  </div>
                  <div style={{ display:"flex",gap:".8rem",flexWrap:"wrap" }}>
                    {o.items.map((item,i) => {
                      const p = getProduct(item.productId);
                      return p ? (
                        <div key={i} style={{ display:"flex",alignItems:"center",gap:".6rem",background:"var(--card)",border:"1px solid var(--border)",padding:".5rem .8rem",cursor:"pointer" }} onClick={() => go("product",p.id)}>
                          <span style={{ fontSize:"1.3rem" }}>{p.emoji}</span>
                          <div>
                            <div style={{ fontSize:".78rem",fontFamily:"'Cormorant Garamond',serif" }}>{p.name}</div>
                            <div style={{ fontSize:".62rem",color:"var(--text3)" }}>{item.size} · ×{item.qty}</div>
                          </div>
                        </div>
                      ) : null;
                    })}
                  </div>
                  {o.tracking && (
                    <div style={{ marginTop:"1rem",fontSize:".72rem",color:"var(--text3)" }}>
                      Tracking: <span style={{ fontFamily:"'DM Mono',monospace",color:"var(--purple2)" }}>{o.tracking}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ADDRESSES */}
          {tab === "addresses" && (
            <div>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"1.5rem" }}>
                <div>
                  <div className="profile-section-title">Saved Addresses</div>
                  <div className="profile-section-sub" style={{ marginBottom:0 }}>Manage your delivery addresses</div>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => setShowAddrForm(true)}><Ico n="plus" s={13}/> Add Address</button>
              </div>
              {(user.addresses||[]).length === 0 && (
                <div className="empty-state"><span className="empty-icon">📍</span><div className="empty-title">No addresses saved</div></div>
              )}
              {(user.addresses||[]).map(a => (
                <div key={a.id} className="addr-saved">
                  <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"1rem" }}>
                    <div>
                      <div style={{ display:"flex",alignItems:"center",gap:".7rem",marginBottom:".4rem" }}>
                        <span style={{ fontSize:".82rem",fontWeight:600 }}>{a.label}</span>
                        {a.isDefault && <span className="addr-default">Default</span>}
                      </div>
                      <div style={{ fontSize:".83rem",color:"var(--text2)",lineHeight:1.7 }}>
                        {a.name}<br />{a.line1}<br />{a.city}, {a.state} {a.zip}
                      </div>
                    </div>
                    <div style={{ display:"flex",gap:".5rem",flexShrink:0 }}>
                      {!a.isDefault && <button className="act-btn" onClick={() => setDefault(a.id)}>Set Default</button>}
                      <button className="act-btn del" onClick={() => removeAddr(a.id)}><Ico n="trash" s={12}/></button>
                    </div>
                  </div>
                </div>
              ))}
              {showAddrForm && (
                <div className="modal-bg" onClick={() => setShowAddrForm(false)}>
                  <div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-hd"><div className="modal-title">Add New Address</div><button className="icon-btn" onClick={() => setShowAddrForm(false)}><Ico n="x" s={18}/></button></div>
                    <div className="modal-bd">
                      <div className="form-row">
                        <div className="form-group"><label className="inp-label">Label</label>
                          <select className="inp" value={addrForm.label} onChange={e => setAddrForm({...addrForm,label:e.target.value})}>
                            <option>Home</option><option>Work</option><option>Other</option>
                          </select>
                        </div>
                        <div className="form-group"><label className="inp-label">Full Name</label><input className="inp" value={addrForm.name} onChange={e => setAddrForm({...addrForm,name:e.target.value})} /></div>
                      </div>
                      <div className="form-group"><label className="inp-label">Address Line 1</label><input className="inp" value={addrForm.line1} onChange={e => setAddrForm({...addrForm,line1:e.target.value})} /></div>
                      <div className="form-row">
                        <div className="form-group"><label className="inp-label">City</label><input className="inp" value={addrForm.city} onChange={e => setAddrForm({...addrForm,city:e.target.value})} /></div>
                        <div className="form-group"><label className="inp-label">State</label><input className="inp" value={addrForm.state} onChange={e => setAddrForm({...addrForm,state:e.target.value})} /></div>
                      </div>
                      <div className="form-row">
                        <div className="form-group"><label className="inp-label">ZIP</label><input className="inp" value={addrForm.zip} onChange={e => setAddrForm({...addrForm,zip:e.target.value})} /></div>
                        <div className="form-group"><label className="inp-label">Country</label>
                          <select className="inp" value={addrForm.country} onChange={e => setAddrForm({...addrForm,country:e.target.value})}>
                            <option value="US">United States</option><option value="GB">UK</option><option value="CA">Canada</option><option value="AU">Australia</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="modal-ft">
                      <button className="btn btn-ghost" onClick={() => setShowAddrForm(false)}>Cancel</button>
                      <button className="btn btn-gold" onClick={addAddress}>Save Address</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* LOYALTY */}
          {tab === "loyalty" && (
            <div>
              <div className="profile-section-title">Loyalty Programme</div>
              <div className="profile-section-sub">Earn points on every purchase and redeem for exclusive rewards</div>
              <div style={{ background:"linear-gradient(135deg,var(--purple3),var(--gold-dim))",border:"1px solid rgba(200,169,110,.3)",padding:"2rem",marginBottom:"2rem",textAlign:"center" }}>
                <div className="points-big">{user.points.toLocaleString()}</div>
                <div style={{ fontSize:".65rem",letterSpacing:".25em",textTransform:"uppercase",color:"var(--text3)",marginTop:".3rem" }}>Noir Points Balance</div>
                <div style={{ margin:"1.5rem 0" }}>
                  <div style={{ fontSize:".7rem",color:"var(--text3)",marginBottom:".4rem" }}>
                    {user.points < 2000 ? `${2000 - user.points} pts to ${nextTier} tier` : "Maximum tier achieved 💎"}
                  </div>
                  <div className="loyalty-bar-wrap"><div className="loyalty-bar-fill" style={{ width:`${tierPct}%` }} /></div>
                  <div style={{ display:"flex",justifyContent:"space-between",fontSize:".65rem",color:"var(--text3)" }}>
                    <span>Bronze</span><span>Silver (500)</span><span>Gold (1,000)</span><span>Diamond (2,000)</span>
                  </div>
                </div>
              </div>

              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"2rem" }}>
                {[["🛍","Earn on Purchases","1 point per $1 spent"],["🎁","Birthday Bonus","200 extra points on your birthday"],["👥","Refer a Friend","500 points per referral"],["⭐","Write Reviews","50 points per verified review"]].map(([ico,t,s]) => (
                  <div key={t} style={{ background:"var(--card2)",border:"1px solid var(--border)",padding:"1.2rem" }}>
                    <div style={{ fontSize:"1.5rem",marginBottom:".5rem" }}>{ico}</div>
                    <div style={{ fontSize:".82rem",marginBottom:".2rem" }}>{t}</div>
                    <div style={{ fontSize:".72rem",color:"var(--text3)" }}>{s}</div>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.3rem",marginBottom:"1rem" }}>Redeem Points</div>
                {[[100,"$5 off your order"],[300,"$20 off your order"],[500,"Free shipping voucher"],[1000,"$75 off your order"]].map(([pts,reward]) => (
                  <div key={pts} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:".9rem",background:"var(--card2)",border:"1px solid var(--border)",marginBottom:".6rem" }}>
                    <div>
                      <div style={{ fontSize:".82rem",marginBottom:".1rem" }}>{reward}</div>
                      <div style={{ fontSize:".68rem",color:"var(--gold)",fontFamily:"'DM Mono',monospace" }}>{pts} points</div>
                    </div>
                    <button className="btn btn-outline btn-sm" disabled={user.points < pts} onClick={() => toast(`Redeemed: ${reward}`, "ok")}>Redeem</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECURITY */}
          {tab === "security" && (
            <div>
              <div className="profile-section-title">Security</div>
              <div className="profile-section-sub">Manage your password and account security</div>
              <div style={{ maxWidth:420 }}>
                <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.2rem",marginBottom:"1.2rem" }}>Change Password</div>
                <div className="form-group"><label className="inp-label">Current Password</label><input className="inp" type="password" value={pwForm.current} onChange={e => setPwForm({...pwForm,current:e.target.value})} placeholder="••••••••" /></div>
                <div className="form-group"><label className="inp-label">New Password</label><input className="inp" type="password" value={pwForm.newPw} onChange={e => setPwForm({...pwForm,newPw:e.target.value})} placeholder="Min 6 characters" /></div>
                <div className="form-group"><label className="inp-label">Confirm New Password</label><input className="inp" type="password" value={pwForm.confirm} onChange={e => setPwForm({...pwForm,confirm:e.target.value})} placeholder="Repeat new password" /></div>
                <button className="btn btn-gold" onClick={changePw}>Update Password</button>
              </div>
              <div style={{ marginTop:"2.5rem",paddingTop:"2rem",borderTop:"1px solid var(--border)" }}>
                <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.2rem",marginBottom:"1rem",color:"var(--red)" }}>Danger Zone</div>
                <p style={{ fontSize:".82rem",color:"var(--text3)",marginBottom:"1rem",lineHeight:1.7 }}>Deleting your account is permanent and cannot be undone. All your orders, wishlist, and points will be lost.</p>
                <button className="btn btn-outline btn-sm btn-danger" onClick={() => { setUser(null); go("home"); toast("Account deleted.", "err"); }}>Delete My Account</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
};

// ─── WISHLIST PAGE ────────────────────────────────────────────────────────────
const WishlistPage = () => {
  const { wishlist, products, addToCart, viewProduct, toggleWish } = useContext(Ctx);
  const items = products.filter(p => wishlist.includes(p.id));
  return (
    <div style={{ paddingTop:68,minHeight:"100vh" }}>
      <div style={{ maxWidth:1100,margin:"0 auto",padding:"3rem 2rem" }}>
        <div style={{ textAlign:"center",marginBottom:"3rem" }}>
          <div style={{ fontSize:".62rem",letterSpacing:".35em",textTransform:"uppercase",color:"var(--gold)",marginBottom:".8rem" }}>Saved For Later</div>
          <h1 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2.8rem",fontWeight:300 }}>My Wishlist</h1>
          <div className="gold-line" style={{ marginTop:"1rem" }} />
        </div>
        {items.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">💔</span>
            <div className="empty-title">Your wishlist is empty</div>
            <p style={{ marginBottom:"1.5rem" }}>Heart fragrances you love to save them here</p>
            <button className="btn btn-gold" onClick={() => {}}>Browse Collection</button>
          </div>
        ) : (
          <div className="grid-4">
            {items.map((p,i) => <PCard key={p.id} p={p} delay={i*60} onView={viewProduct} onAdd={addToCart} />)}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
};

// ─── GIFT SETS PAGE ───────────────────────────────────────────────────────────
const GiftSetsPage = () => {
  const { db, addToCart, toast } = useContext(Ctx);
  return (
    <div style={{ paddingTop:68,minHeight:"100vh" }}>
      {/* Hero */}
      <div style={{ background:"radial-gradient(ellipse at center,var(--purple3),transparent 60%),var(--deep)",padding:"5rem 3rem",textAlign:"center",borderBottom:"1px solid var(--border)",position:"relative",overflow:"hidden" }}>
        <ParticleField />
        <Reveal><div style={{ fontSize:".62rem",letterSpacing:".35em",textTransform:"uppercase",color:"var(--gold)",marginBottom:"1rem" }}>Curated With Love</div></Reveal>
        <Reveal delay={80}><h1 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"3.5rem",fontWeight:300,marginBottom:"1rem" }}>Gift Sets</h1></Reveal>
        <Reveal delay={160}><p style={{ fontSize:".88rem",color:"var(--text3)",maxWidth:460,margin:"0 auto",lineHeight:1.8 }}>The perfect fragrance gift, beautifully presented. Each set is curated to tell a story.</p></Reveal>
      </div>
      <div style={{ maxWidth:1100,margin:"0 auto",padding:"3rem 2rem" }}>
        <Stagger className="grid-4">
          {db.giftSets.map((s,i) => (
            <div key={s.id} className="gift-set-card fu" style={{ animationDelay:`${i*80}ms` }}>
              <div className="gift-set-img">
                <span style={{ fontSize:"3.5rem" }}>{s.emoji1}</span>
                <span style={{ fontSize:"3.5rem" }}>{s.emoji2}</span>
                {s.emoji3 && <span style={{ fontSize:"3.5rem" }}>{s.emoji3}</span>}
              </div>
              <div className="gift-set-body">
                <div style={{ fontSize:".62rem",letterSpacing:".2em",textTransform:"uppercase",color:"var(--text3)",marginBottom:".4rem" }}>Gift Set</div>
                <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.3rem",marginBottom:".7rem" }}>{s.name}</div>
                <div style={{ marginBottom:"1rem" }}>
                  {s.items.map(item => <div key={item} style={{ fontSize:".75rem",color:"var(--text3)",marginBottom:".2rem" }}>· {item}</div>)}
                </div>
                <div style={{ fontSize:".78rem",color:"var(--text3)",fontStyle:"italic",fontFamily:"'Cormorant Garamond',serif",marginBottom:"1.2rem",lineHeight:1.6 }}>{s.desc}</div>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                  <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.4rem" }}>{fmt(s.price)}</div>
                  <RippleBtn className="btn btn-gold btn-sm" onClick={() => toast(`${s.name} added to cart!`, "ok")}>Add to Cart</RippleBtn>
                </div>
              </div>
            </div>
          ))}
        </Stagger>
      </div>
      <div style={{ background:"var(--deep)",borderTop:"1px solid var(--border)",padding:"4rem 3rem",textAlign:"center" }}>
        <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2rem",marginBottom:".8rem",fontWeight:300 }}>Need Something More Personal?</div>
        <p style={{ fontSize:".85rem",color:"var(--text3)",marginBottom:"2rem" }}>Our fragrance specialists can help you create a bespoke gift box for any occasion.</p>
        <button className="btn btn-gold">Contact a Specialist</button>
      </div>
      <Footer />
    </div>
  );
};

// ─── ABOUT PAGE ───────────────────────────────────────────────────────────────
const AboutPage = () => (
  <div className="about-page">
    <div className="about-hero">
      <div style={{ position:"absolute",inset:0,background:"radial-gradient(ellipse at 50% 60%,rgba(200,169,110,.08),transparent 60%)" }} />
      <div style={{ position:"relative",textAlign:"center" }}>
        <div style={{ fontSize:".62rem",letterSpacing:".4em",textTransform:"uppercase",color:"var(--gold)",marginBottom:"1.5rem" }}>Est. 2019 · New York</div>
        <h1 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"clamp(2.5rem,6vw,5rem)",fontWeight:300,marginBottom:"1.5rem",lineHeight:.95 }}>The Art of<br /><em style={{ color:"var(--gold)" }}>Fine Fragrance</em></h1>
        <p style={{ fontSize:".88rem",color:"var(--text3)",maxWidth:440,margin:"0 auto",lineHeight:1.9 }}>We believe a fragrance is not just a scent — it's a memory, an emotion, an invisible signature.</p>
      </div>
    </div>

    {/* Mission */}
    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",maxWidth:1100,margin:"0 auto",borderBottom:"1px solid var(--border)" }}>
      {[["Our Mission","To democratize access to the world's finest fragrances, making luxury accessible without compromising on authenticity or curation."],["Our Promise","Every fragrance in our collection is 100% authentic, sourced directly from the houses or authorized distributors. No grey market, ever."]].map(([t,d]) => (
        <div key={t} style={{ padding:"4rem 3rem",borderRight:"1px solid var(--border)" }}>
          <div style={{ fontSize:".62rem",letterSpacing:".3em",textTransform:"uppercase",color:"var(--gold)",marginBottom:"1.2rem" }}>—</div>
          <h2 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"2rem",fontWeight:300,marginBottom:"1rem" }}>{t}</h2>
          <p style={{ fontSize:".88rem",color:"var(--text3)",lineHeight:1.9 }}>{d}</p>
        </div>
      ))}
    </div>

    {/* Timeline */}
    <div style={{ background:"var(--deep)",padding:"5rem 0",borderBottom:"1px solid var(--border)" }}>
      <div style={{ textAlign:"center",marginBottom:"3rem" }}>
        <div className="section-eyebrow">Our Journey</div>
        <h2 className="section-h">A Fragrant History</h2>
        <div className="gold-line" style={{ marginTop:"1.2rem" }} />
      </div>
      <div className="timeline">
        {[["2019","The Founding","Noir Essence was founded in a small New York apartment with 12 hand-selected fragrances and a conviction that fine scent should be accessible to all."],
          ["2020","Going Digital","Launched the online boutique, reaching customers in 18 countries within the first year."],
          ["2021","The Collection Grows","Expanded to 100+ fragrances and partnered with Creed, Tom Ford, and Maison Francis Kurkdjian."],
          ["2023","The Loyalty Programme","Introduced the Noir Points system, rewarding over 10,000 loyal customers."],
          ["2025","200+ Fragrances","Today we curate over 200 fragrances from 50+ houses, with thousands of members worldwide."]].map(([year,title,text]) => (
          <div key={year} className="tl-item">
            <div className="tl-year">{year}</div>
            <div className="tl-content">
              <div className="tl-title">{title}</div>
              <div className="tl-text">{text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Values */}
    <div style={{ padding:"5rem 3rem" }}>
      <div style={{ textAlign:"center",marginBottom:"3rem" }}>
        <div className="section-eyebrow">What Drives Us</div>
        <h2 className="section-h">Our Values</h2>
        <div className="gold-line" style={{ marginTop:"1.2rem" }} />
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"2rem",maxWidth:1000,margin:"0 auto" }}>
        {[["🔍","Authenticity","Every bottle we sell is verified authentic. We maintain direct relationships with brands and authorized distributors."],
          ["🎯","Curation","Not every fragrance makes our edit. We personally evaluate hundreds to bring you only the exceptional ones."],
          ["♻️","Sustainability","We use recycled packaging and offset our carbon footprint for every shipment worldwide."]].map(([ico,t,d]) => (
          <div key={t} style={{ textAlign:"center",padding:"2.5rem 1.5rem" }}>
            <div style={{ fontSize:"2.5rem",marginBottom:"1.2rem" }}>{ico}</div>
            <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.4rem",marginBottom:".8rem" }}>{t}</div>
            <div style={{ fontSize:".83rem",color:"var(--text3)",lineHeight:1.8 }}>{d}</div>
          </div>
        ))}
      </div>
    </div>
    <Footer />
  </div>
);

// ─── CONTACT PAGE ─────────────────────────────────────────────────────────────
const ContactPage = () => {
  const { toast } = useContext(Ctx);
  const [form, setForm] = useState({ name:"", email:"", subject:"", message:"" });
  const [sent, setSent] = useState(false);

  const submit = () => {
    if (!form.name || !form.email || !form.message) { toast("Please fill all required fields.", "err"); return; }
    setSent(true);
    toast("Message sent! We'll reply within 24 hours.", "ok");
  };

  return (
    <div className="contact-page">
      <div style={{ background:"var(--deep)",padding:"4rem 3rem",textAlign:"center",borderBottom:"1px solid var(--border)" }}>
        <div style={{ fontSize:".62rem",letterSpacing:".35em",textTransform:"uppercase",color:"var(--gold)",marginBottom:".8rem" }}>We're Here For You</div>
        <h1 style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"3rem",fontWeight:300 }}>Contact Us</h1>
      </div>
      <div className="contact-inner">
        {/* Info */}
        <div>
          <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",fontWeight:300,marginBottom:"1.5rem" }}>Get in Touch</div>
          <p style={{ fontSize:".88rem",color:"var(--text3)",lineHeight:1.9,marginBottom:"2.5rem" }}>
            Our fragrance experts are available to help you find your perfect scent, assist with orders, or answer any questions about our collection.
          </p>
          {[[<Ico n="mail" s={18}/>,<b>Email</b>,"hello@noiressence.com","We reply within 24 hours"],
            [<Ico n="phone" s={18}/>,<b>Phone</b>,"+1 (800) NOIR-001","Mon–Fri, 9am–6pm EST"],
            [<Ico n="map" s={18}/>,<b>Showroom</b>,"42 Fifth Avenue, New York NY","By appointment only"]].map(([ico,label,val,sub],i) => (
            <div key={i} style={{ display:"flex",gap:"1rem",alignItems:"flex-start",marginBottom:"1.5rem",padding:"1.2rem",background:"var(--card)",border:"1px solid var(--border)" }}>
              <div style={{ color:"var(--gold)",marginTop:".1rem",flexShrink:0 }}>{ico}</div>
              <div>
                <div style={{ fontSize:".72rem",letterSpacing:".15em",textTransform:"uppercase",color:"var(--text3)",marginBottom:".2rem" }}>{label}</div>
                <div style={{ fontSize:".88rem",marginBottom:".2rem" }}>{val}</div>
                <div style={{ fontSize:".72rem",color:"var(--text3)" }}>{sub}</div>
              </div>
            </div>
          ))}
          <div style={{ padding:"1.5rem",background:"var(--card)",border:"1px solid var(--border)",marginTop:"1rem" }}>
            <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.1rem",marginBottom:".8rem" }}>Quick Answers</div>
            {[["How long does shipping take?","3–5 business days standard, 1–2 express."],["Can I return a fragrance?","Yes, within 30 days if unused and in original packaging."],["Are your fragrances authentic?","100% guaranteed authentic from authorized sources."]].map(([q,a]) => (
              <div key={q} style={{ marginBottom:"1rem",paddingBottom:"1rem",borderBottom:"1px solid var(--border)" }}>
                <div style={{ fontSize:".8rem",marginBottom:".3rem",color:"var(--text)" }}>{q}</div>
                <div style={{ fontSize:".75rem",color:"var(--text3)" }}>{a}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Form */}
        <div>
          {sent ? (
            <div style={{ textAlign:"center",padding:"4rem 2rem" }}>
              <div style={{ fontSize:"3rem",marginBottom:"1.2rem" }}>✉️</div>
              <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",marginBottom:".8rem" }}>Message Sent!</div>
              <p style={{ color:"var(--text3)",fontSize:".88rem",lineHeight:1.8 }}>We'll get back to you within 24 hours. Thank you for reaching out.</p>
              <button className="btn btn-outline" style={{ marginTop:"2rem" }} onClick={() => setSent(false)}>Send Another</button>
            </div>
          ) : (
            <div style={{ background:"var(--card)",border:"1px solid var(--border)",padding:"2.5rem" }}>
              <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1.8rem",fontWeight:300,marginBottom:"2rem" }}>Send a Message</div>
              <div className="form-row">
                <div className="form-group"><label className="inp-label">Your Name *</label><input className="inp" value={form.name} onChange={e => setForm({...form,name:e.target.value})} /></div>
                <div className="form-group"><label className="inp-label">Email Address *</label><input className="inp" type="email" value={form.email} onChange={e => setForm({...form,email:e.target.value})} /></div>
              </div>
              <div className="form-group">
                <label className="inp-label">Subject</label>
                <select className="inp" value={form.subject} onChange={e => setForm({...form,subject:e.target.value})}>
                  <option value="">Select a topic...</option>
                  <option>Order Enquiry</option><option>Product Question</option><option>Returns & Exchanges</option><option>Fragrance Consultation</option><option>Other</option>
                </select>
              </div>
              <div className="form-group">
                <label className="inp-label">Message *</label>
                <textarea className="inp" rows={5} placeholder="How can we help you?" value={form.message} onChange={e => setForm({...form,message:e.target.value})} />
              </div>
              <button className="btn btn-gold" style={{ width:"100%",padding:"1rem" }} onClick={submit}>Send Message</button>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
};

// ─── ADMIN PAGE ───────────────────────────────────────────────────────────────
const AdminPage = () => {
  const { user, products, setProducts, db, go } = useContext(Ctx);
  const { toast } = useContext(Ctx);
  const [tab, setTab] = useState("dash");
  const [users, setUsers] = useState([...db.users]);
  const [orders, setOrders] = useState([...db.orders]);
  const [editP, setEditP] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const blankForm = { name:"",house:"",price:"",emoji:"🌸",gender:"Unisex",concentration:"Eau de Parfum",sizes:["50ml","100ml"],stock:10,status:"active",description:"",badge:"",badgeType:"",oldPrice:"",rating:4.5,reviews:0,notes:{top:[],heart:[],base:[]},tags:[],image_url:"" };
  const [pForm, setPForm] = useState(blankForm);
  const [imgFile, setImgFile] = useState(null);
  const [imgPreview, setImgPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  if (!user || user.role !== "admin") { go("home"); return null; }

  // Reload users from Supabase when tab changes to customers
  useEffect(() => {
    if (tab === "customers") {
      supabase.from("profiles").select("*").then(({ data }) => { if (data) setUsers(data); });
    }
    if (tab === "orders") {
      supabase.from("orders").select("*").order("created_at", { ascending: false }).then(({ data }) => { if (data) setOrders(data); });
    }
  }, [tab]);

  const navItems = [
    { id:"dash", label:"Dashboard", icon:"chart" },
    { id:"products", label:"Products", icon:"pkg" },
    { id:"orders", label:"Orders", icon:"orders" },
    { id:"customers", label:"Customers", icon:"users" },
    { id:"settings", label:"Settings", icon:"cog" },
  ];

  const revenue = orders.reduce((s,o) => s + (o.total||0), 0);

  const handleImgChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImgFile(file);
    const reader = new FileReader();
    reader.onload = () => setImgPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const uploadImage = async (file) => {
    const ext = file.name.split(".").pop();
    const path = `products/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
    if (error) { console.error(error); return null; }
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    return data.publicUrl;
  };

  const saveProduct = async (form) => {
    setSaving(true);
    let image_url = form.image_url || "";
    if (imgFile) {
      const url = await uploadImage(imgFile);
      if (url) image_url = url;
    }
    const payload = { ...form, price:+form.price, oldPrice:form.oldPrice ? +form.oldPrice : null, image_url, reviewList: form.reviewList || [] };
    if (editP) {
      const { error } = await supabase.from("products").update(payload).eq("id", editP.id);
      if (!error) {
        const updated = products.map(p => p.id === editP.id ? { ...p, ...payload } : p);
        setProducts(updated);
        toast("Product updated.", "ok");
        setEditP(null);
      } else {
        // fallback local update if table doesn't exist
        const updated = products.map(p => p.id === editP.id ? { ...p, ...payload } : p);
        setProducts(updated);
        toast("Product updated (local).", "ok");
        setEditP(null);
      }
    } else {
      const { data: inserted, error } = await supabase.from("products").insert([{ ...payload, id: undefined }]).select().single();
      if (!error && inserted) {
        setProducts(prev => [...prev, inserted]);
        toast("Product added!", "ok");
      } else {
        const np = { ...payload, id: Date.now() };
        setProducts(prev => [...prev, np]);
        toast("Product added (local)!", "ok");
      }
      setShowAdd(false);
    }
    setPForm(blankForm);
    setImgFile(null);
    setImgPreview(null);
    setSaving(false);
  };

  const deleteProduct = async (id) => {
    await supabase.from("products").delete().eq("id", id);
    const updated = products.filter(x => x.id !== id);
    setProducts(updated);
    toast("Product deleted.", "err");
  };

  const openEdit = (p) => {
    setEditP(p);
    setPForm({ ...p, price:String(p.price), oldPrice:p.oldPrice?String(p.oldPrice):"" });
    setImgPreview(p.image_url || null);
    setImgFile(null);
  };

  const toggleUserBlock = async (u) => {
    const newStatus = u.status === "blocked" ? "active" : "blocked";
    const { error } = await supabase.from("profiles").update({ status: newStatus }).eq("id", u.id);
    if (!error) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, status: newStatus } : x));
      toast(`User ${newStatus === "blocked" ? "blocked" : "unblocked"}.`, newStatus === "blocked" ? "err" : "ok");
    }
  };

  const changeUserRole = async (u, newRole) => {
    const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", u.id);
    if (!error) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: newRole } : x));
      toast(`Role updated to ${newRole}.`, "ok");
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    await supabase.from("orders").update({ status: newStatus }).eq("id", orderId);
    setOrders(prev => prev.map(x => x.id === orderId ? { ...x, status: newStatus } : x));
  };

  const ProductFormModal = ({ onClose }) => (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxHeight:"90vh",overflowY:"auto" }}>
        <div className="modal-hd">
          <div className="modal-title">{editP ? "Edit Fragrance" : "Add New Fragrance"}</div>
          <button className="icon-btn" onClick={onClose}><Ico n="x" s={18}/></button>
        </div>
        <div className="modal-bd">
          {/* Image upload */}
          <div className="form-group">
            <label className="inp-label">Product Image</label>
            <div style={{ display:"flex",alignItems:"center",gap:"1.2rem",marginBottom:".5rem" }}>
              {imgPreview ? (
                <img src={imgPreview} alt="preview" style={{ width:80,height:80,objectFit:"cover",borderRadius:4,border:"1px solid var(--border2)" }} />
              ) : (
                <div style={{ width:80,height:80,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--card2)",border:"1px dashed var(--border2)",borderRadius:4,fontSize:"2rem" }}>
                  {pForm.emoji || "📷"}
                </div>
              )}
              <div>
                <label style={{ display:"inline-block",cursor:"pointer" }}>
                  <span className="btn btn-outline btn-sm">Upload Image</span>
                  <input type="file" accept="image/*" style={{ display:"none" }} onChange={handleImgChange} />
                </label>
                <div style={{ fontSize:".68rem",color:"var(--text3)",marginTop:".4rem" }}>JPG, PNG, WebP — max 5MB</div>
                {imgPreview && <button className="btn-ghost" style={{ fontSize:".68rem",padding:".3rem 0",color:"var(--red)" }} onClick={() => { setImgPreview(null); setImgFile(null); setPForm(f=>({...f,image_url:""})); }}>Remove</button>}
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group"><label className="inp-label">Product Name *</label><input className="inp" value={pForm.name} onChange={e => setPForm({...pForm,name:e.target.value})} placeholder="Fragrance name" /></div>
            <div className="form-group"><label className="inp-label">House / Brand *</label><input className="inp" value={pForm.house} onChange={e => setPForm({...pForm,house:e.target.value})} placeholder="e.g. Dior" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="inp-label">Price (PKR) *</label><input className="inp" type="number" value={pForm.price} onChange={e => setPForm({...pForm,price:e.target.value})} /></div>
            <div className="form-group"><label className="inp-label">Old Price (optional)</label><input className="inp" type="number" value={pForm.oldPrice} onChange={e => setPForm({...pForm,oldPrice:e.target.value})} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="inp-label">Emoji Icon</label><input className="inp" value={pForm.emoji} onChange={e => setPForm({...pForm,emoji:e.target.value})} placeholder="🌸" /></div>
            <div className="form-group"><label className="inp-label">Stock</label><input className="inp" type="number" value={pForm.stock} onChange={e => setPForm({...pForm,stock:+e.target.value})} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="inp-label">Gender</label>
              <select className="inp" value={pForm.gender} onChange={e => setPForm({...pForm,gender:e.target.value})}>
                <option>Masculine</option><option>Feminine</option><option>Unisex</option>
              </select>
            </div>
            <div className="form-group"><label className="inp-label">Concentration</label>
              <select className="inp" value={pForm.concentration} onChange={e => setPForm({...pForm,concentration:e.target.value})}>
                <option>Eau de Cologne</option><option>Eau de Toilette</option><option>Eau de Parfum</option><option>Extrait de Parfum</option><option>Elixir</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="inp-label">Status</label>
              <select className="inp" value={pForm.status} onChange={e => setPForm({...pForm,status:e.target.value})}>
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="form-group"><label className="inp-label">Badge</label>
              <select className="inp" value={pForm.badgeType||""} onChange={e => {
                const bt = e.target.value;
                setPForm({...pForm,badgeType:bt,badge:bt==="bs"?"Bestseller":bt==="cl"?"Classic":bt==="nw"?"New":bt==="sl"?"-15%":""});
              }}>
                <option value="">None</option><option value="bs">Bestseller</option><option value="cl">Classic</option><option value="nw">New</option><option value="sl">Sale</option>
              </select>
            </div>
          </div>
          <div className="form-group"><label className="inp-label">Description</label><textarea className="inp" rows={3} value={pForm.description} onChange={e => setPForm({...pForm,description:e.target.value})} /></div>
        </div>
        <div className="modal-ft">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={() => saveProduct(pForm)} disabled={saving}>
            {saving ? <span className="spinner" style={{ width:16,height:16,borderTopColor:"#000" }} /> : editP ? "Save Changes" : "Add Fragrance"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="admin-wrap">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-hd">
          <div style={{ fontSize:".6rem",letterSpacing:".2em",textTransform:"uppercase",color:"var(--text3)",marginBottom:".3rem" }}>Admin Panel</div>
          <div className="admin-sidebar-logo">NOIR ESSENCE</div>
        </div>
        <div className="admin-nav">
          {navItems.map(n => (
            <div key={n.id} className={`an-item${tab===n.id?" on":""}`} onClick={() => setTab(n.id)}>
              <Ico n={n.icon} s={15}/>{n.label}
            </div>
          ))}
          <div style={{ borderTop:"1px solid var(--border)",margin:".5rem 0" }} />
          <div className="an-item" onClick={() => go("home")}><Ico n="chevL" s={15}/>Back to Store</div>
        </div>
      </aside>

      <div className="admin-content fi">
        {/* DASHBOARD */}
        {tab === "dash" && (
          <div>
            <div className="admin-title">Dashboard</div>
            <div className="admin-sub">Welcome back, {user.name}. Here's your store overview.</div>
            <div className="stat-grid">
              {[
                { label:"Total Revenue", val:fmt(revenue), chg:"+12.5%", up:true },
                { label:"Total Orders", val:orders.length, chg:`${orders.filter(o=>o.status==="pending").length} pending`, up:true },
                { label:"Products", val:products.length, chg:`${products.filter(p=>p.stock<10).length} low stock`, up:false },
                { label:"Customers", val:users.filter(u=>u.role==="customer").length, chg:"+2 this month", up:true },
              ].map(s => (
                <div key={s.label} className="stat-card">
                  <div className="stat-lbl">{s.label}</div>
                  <div className="stat-val">{s.val}</div>
                  <div className={`stat-chg${s.up?" up":" dn"}`}>{s.chg}</div>
                </div>
              ))}
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.5rem" }}>
              <div className="tbl-wrap">
                <div className="tbl-hd">
                  <div className="tbl-title">Recent Orders</div>
                  <button className="act-btn" onClick={() => setTab("orders")}>View All</button>
                </div>
                <table className="tbl">
                  <thead><tr><th>ID</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
                  <tbody>
                    {orders.slice(0,5).map(o => (
                      <tr key={o.id}>
                        <td style={{ fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--gold)" }}>{o.id}</td>
                        <td>{o.customer}</td>
                        <td style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1rem" }}>{fmt(o.total)}</td>
                        <td><span className={`status s-${o.status}`}>{o.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="tbl-wrap">
                <div className="tbl-hd"><div className="tbl-title">Low Stock</div></div>
                <table className="tbl">
                  <thead><tr><th>Product</th><th>House</th><th>Stock</th></tr></thead>
                  <tbody>
                    {products.filter(p=>p.stock<15).map(p => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td style={{ color:"var(--text3)",fontSize:".78rem" }}>{p.house}</td>
                        <td style={{ color:p.stock<10?"var(--red)":"var(--orange)",fontFamily:"'DM Mono',monospace" }}>{p.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* PRODUCTS */}
        {tab === "products" && (
          <div>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"1.5rem" }}>
              <div>
                <div className="admin-title">Products</div>
                <div className="admin-sub" style={{ marginBottom:0 }}>{products.length} fragrances in collection</div>
              </div>
              <button className="btn btn-gold btn-sm" onClick={() => { setEditP(null); setShowAdd(true); }}><Ico n="plus" s={14}/>Add Fragrance</button>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Product</th><th>House</th><th>Concentration</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td>
                        <div style={{ display:"flex",alignItems:"center",gap:".8rem" }}>
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} style={{ width:40,height:40,objectFit:"cover",borderRadius:4,border:"1px solid var(--border)" }} />
                          ) : (
                            <span style={{ fontSize:"1.5rem" }}>{p.emoji}</span>
                          )}
                          <div>
                            <div style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1rem" }}>{p.name}</div>
                            {p.badge && <span style={{ fontSize:".6rem",color:"var(--gold)" }}>{p.badge}</span>}
                          </div>
                        </div>
                      </td>
                      <td style={{ color:"var(--text3)",fontSize:".8rem" }}>{p.house}</td>
                      <td style={{ color:"var(--text3)",fontSize:".78rem" }}>{p.concentration}</td>
                      <td style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1rem" }}>
                        {fmt(p.price)}{p.oldPrice && <span style={{ color:"var(--text3)",fontSize:".75rem",textDecoration:"line-through",marginLeft:".4rem" }}>{fmt(p.oldPrice)}</span>}
                      </td>
                      <td style={{ fontFamily:"'DM Mono',monospace",color:p.stock<10?"var(--red)":"var(--text)" }}>{p.stock}</td>
                      <td><span className={`status s-${p.status}`}>{p.status}</span></td>
                      <td>
                        <div style={{ display:"flex",gap:".4rem" }}>
                          <button className="act-btn" onClick={() => openEdit(p)}><Ico n="edit" s={12}/></button>
                          <button className="act-btn del" onClick={() => deleteProduct(p.id)}><Ico n="trash" s={12}/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ORDERS */}
        {tab === "orders" && (
          <div>
            <div className="admin-title">Orders</div>
            <div className="admin-sub">Manage and fulfil customer orders</div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Order ID</th><th>Customer</th><th>Items</th><th>Total</th><th>Date</th><th>Status</th><th>Update</th></tr></thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id}>
                      <td style={{ fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--gold)" }}>{o.id}</td>
                      <td>{o.customer}</td>
                      <td style={{ color:"var(--text3)" }}>{o.items.length} item{o.items.length>1?"s":""}</td>
                      <td style={{ fontFamily:"'Cormorant Garamond',serif",fontSize:"1rem" }}>{fmt(o.total)}</td>
                      <td style={{ fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text3)" }}>{o.date}</td>
                      <td><span className={`status s-${o.status}`}>{o.status}</span></td>
                      <td>
                        <select className="inp" style={{ padding:".3rem .5rem",fontSize:".72rem",width:"auto",minWidth:110 }}
                          value={o.status}
                          onChange={e => updateOrderStatus(o.id, e.target.value)}>
                          <option value="pending">Pending</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CUSTOMERS */}
        {tab === "customers" && (
          <div>
            <div className="admin-title">Customers</div>
            <div className="admin-sub">{users.filter(u=>u.role==="customer").length} registered customers</div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Customer</th><th>Email</th><th>Phone</th><th>Joined</th><th>Points</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display:"flex",alignItems:"center",gap:".7rem" }}>
                          <div style={{ width:30,height:30,borderRadius:"50%",background:"linear-gradient(135deg,var(--purple),var(--gold))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".75rem",color:"#000",fontWeight:600,flexShrink:0 }}>{u.name?u.name[0]:"?"}</div>
                          {u.name}
                        </div>
                      </td>
                      <td style={{ fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text3)" }}>{u.email}</td>
                      <td style={{ color:"var(--text3)",fontSize:".8rem" }}>{u.phone||"—"}</td>
                      <td style={{ fontFamily:"'DM Mono',monospace",fontSize:".75rem",color:"var(--text3)" }}>{u.joined||"—"}</td>
                      <td style={{ fontFamily:"'DM Mono',monospace",color:"var(--gold)" }}>{u.points||0}</td>
                      <td>
                        {u.role !== "admin" ? (
                          <select className="inp" style={{ padding:".2rem .4rem",fontSize:".72rem",width:"auto",minWidth:90 }} value={u.role||"customer"} onChange={e => changeUserRole(u, e.target.value)}>
                            <option value="customer">Customer</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : <span className="status s-active">admin</span>}
                      </td>
                      <td>
                        <span className={`status ${u.status==="blocked"?"s-cancelled":"s-active"}`}>{u.status||"active"}</span>
                      </td>
                      <td>
                        <div style={{ display:"flex",gap:".4rem" }}>
                          {u.role !== "admin" && (
                            <button
                              className={`act-btn${u.status==="blocked"?"":" del"}`}
                              style={{ fontSize:".65rem",padding:".3rem .6rem",width:"auto",whiteSpace:"nowrap" }}
                              onClick={() => toggleUserBlock(u)}
                            >
                              {u.status==="blocked" ? "Unblock" : "Block"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SETTINGS */}
        {tab === "settings" && (
          <div>
            <div className="admin-title">Store Settings</div>
            <div className="admin-sub">Configure your store preferences</div>
            <div style={{ maxWidth:520 }}>
              {[["Store Name","Noir Essence"],["Email","hello@noiressence.com"],["Currency","PKR (₨)"],["Free Shipping Threshold","PKR 60,000"],["Tagline","The House of Rare Scents"]].map(([l,v]) => (
                <div key={l} className="form-group">
                  <label className="inp-label">{l}</label>
                  <input className="inp" defaultValue={v} />
                </div>
              ))}
              <div className="form-group">
                <label className="inp-label">Maintenance Mode</label>
                <select className="inp"><option>Off</option><option>On</option></select>
              </div>
              <button className="btn btn-gold" onClick={() => toast("Settings saved.", "ok")}>Save Settings</button>
            </div>
          </div>
        )}
      </div>

      {(editP || showAdd) && (
        <ProductFormModal onClose={() => { setEditP(null); setShowAdd(false); }} />
      )}
    </div>
  );
};

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [dbData] = useState(() => {
    const fresh = initDB();
    return fresh;
  });
  const [page, setPage] = useState("home");
  const [pageParam, setPageParam] = useState(null);
  const [user, setUserState] = useState(null);
  const [products, setProductsState] = useState(() => dbData.products);
  const [supaLoading, setSupaLoading] = useState(true);

  // Load Supabase session on mount + sync products from DB
  useEffect(() => {
    const init = async () => {
      // Restore session
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
        if (profile) {
          if (profile.status === "blocked") { await supabase.auth.signOut(); }
          else { setUserState(profile); }
        }
      }
      // Load products from Supabase
      const { data: dbProds } = await supabase.from("products").select("*").order("id");
      if (dbProds && dbProds.length > 0) {
        setProductsState(dbProds);
        dbData.products = dbProds;
      }
      // Load users for admin
      const { data: dbUsers } = await supabase.from("profiles").select("*");
      if (dbUsers) dbData.users = dbUsers;
      // Load orders
      const { data: dbOrders } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
      if (dbOrders && dbOrders.length > 0) dbData.orders = dbOrders;
      setSupaLoading(false);
    };
    init();
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") { setUserState(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const setProducts = (fn) => setProductsState(prev => {
    const next = typeof fn === "function" ? fn(prev) : fn;
    dbData.products = next;
    return next;
  });
  const [cart, setCartState] = useState(loadCart);
  const [wishlist, setWishlistState] = useState(loadWish);
  const [cartOpen, setCartOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confirmedOrderId, setConfirmedOrderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);

  const setUser = (u) => { setUserState(u); };
  const setCart = (fn) => setCartState(prev => {
    const next = typeof fn === "function" ? fn(prev) : fn;
    saveCart(next);
    return next;
  });
  const setWishlist = (fn) => setWishlistState(prev => {
    const next = typeof fn === "function" ? fn(prev) : fn;
    saveWish(next);
    return next;
  });

  const toast = (msg, type = "") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  };

  // Pages that require login — guest can browse freely but must log in to order
  const authRequired = ["cart", "checkout", "wishlist", "profile"];
  const [pendingPage, setPendingPage] = useState(null);

  const go = (p, param = null) => {
    if (authRequired.includes(p) && !user) {
      setTransitioning(true);
      setTimeout(() => {
        setPendingPage({ p, param });
        setPage("login");
        setPageParam(null);
        setCartOpen(false);
        setSearchOpen(false);
        window.scrollTo(0, 0);
        setTimeout(() => setTransitioning(false), 100);
      }, 300);
      return;
    }
    setTransitioning(true);
    setTimeout(() => {
      setPage(p);
      setPageParam(param);
      setCartOpen(false);
      setSearchOpen(false);
      window.scrollTo(0, 0);
      setTimeout(() => setTransitioning(false), 100);
    }, 300);
  };

  const viewProduct = (id) => go("product", id);

  const addToCart = (p, qty = 1, size = null) => {
    const s = size || p.sizes?.[1] || p.sizes?.[0] || "100ml";
    // Compute correct price for this size
    const getSizePrice = (sz, prod) => {
      if (prod.sizePrices && prod.sizePrices[sz]) return prod.sizePrices[sz];
      const sizes = prod.sizes || [];
      const idx = sizes.indexOf(sz);
      if (idx < 0 || sizes.length <= 1) return prod.price;
      const getMl = (x) => parseFloat(x) || 0;
      const mls = sizes.map(getMl);
      const baseMl = mls[Math.floor((sizes.length - 1) / 2)] || mls[0] || 1;
      const thisMl = getMl(sz) || baseMl;
      return Math.round(prod.price * Math.pow(thisMl / baseMl, 0.75));
    };
    const sizedPrice = getSizePrice(s, p);
    const cartItem = { ...p, price: sizedPrice, qty, size: s };
    setCart(c => {
      const idx = c.findIndex(i => i.id === p.id && i.size === s);
      if (idx >= 0) { const n = [...c]; n[idx] = { ...n[idx], qty: n[idx].qty + qty }; return n; }
      return [...c, cartItem];
    });
    toast(`${p.name} added to cart!`, "ok");
    setCartOpen(true);
  };

  const removeFromCart = (idx) => setCart(c => c.filter((_,i) => i !== idx));

  const toggleWish = (id) => {
    setWishlist(w => {
      const has = w.includes(id);
      toast(has ? "Removed from wishlist" : "Added to wishlist ❤", has ? "" : "ok");
      return has ? w.filter(x => x !== id) : [...w, id];
    });
  };

  const placeOrder = async ({ subtotal, discount, shipping, total, address }) => {
    const oid = `NE-${String(dbData.orders.length + 10).padStart(4,"0")}`;
    const order = {
      id: oid, user_id: user?.id || null,
      customer: user?.name || "Guest",
      items: cart.map(i => ({ productId: i.id, qty: i.qty, size: i.size, price: i.price * i.qty })),
      subtotal, discount, shipping, total, status: "pending",
      date: new Date().toISOString().split("T")[0], address, tracking: null
    };
    // Save to Supabase
    await supabase.from("orders").insert([order]);
    dbData.orders.unshift(order);
    // Earn loyalty points
    if (user) {
      const pts = Math.floor(total / 100); // 1 point per 100 PKR
      const updated = { ...user, points: (user.points || 0) + pts };
      setUser(updated);
      await supabase.from("profiles").update({ points: updated.points }).eq("id", user.id);
      toast(`Order placed! +${pts} Noir Points earned 🎉`, "ok");
    } else {
      toast("Order placed successfully! 🎉", "ok");
    }
    
    setCart([]);
    setConfirmedOrderId(oid);
    go("confirm");
  };

  const ctx = {
    page, go, user, setUser, products, setProducts, db: dbData,
    cart, setCart, removeFromCart, cartOpen, setCartOpen,
    wishlist, toggleWish, searchOpen, setSearchOpen,
    addToCart, viewProduct, placeOrder, toast,
    pendingPage, setPendingPage
  };

  const showNav = !["login"].includes(page);

  return (
    <Ctx.Provider value={ctx}>
      <GlobalStyles />

      {/* LUXURY CURSOR */}
      <LuxuryCursor />

      {/* SCROLL PROGRESS */}
      <ScrollProgress />

      {/* LOADING SCREEN */}
      {loading && <LoadingScreen onDone={() => setLoading(false)} />}

      {/* PAGE TRANSITION */}
      <PageTransition active={transitioning} />

      {showNav && <Nav />}
      {searchOpen && <SearchOverlay products={products} onClose={() => setSearchOpen(false)} onViewProduct={viewProduct} />}
      <CartPanel />

      <div key={page} className="fi" style={{ animationDuration: ".4s" }}>
        {page === "home" && <HomePage />}
        {page === "shop" && <ShopPage />}
        {page === "product" && <ProductPage productId={pageParam} />}
        {page === "cart" && <CartPage />}
        {page === "checkout" && <CheckoutPage />}
        {page === "confirm" && confirmedOrderId && <OrderConfirmPage orderId={confirmedOrderId} />}
        {page === "login" && <AuthPage />}
        {page === "profile" && <ProfilePage />}
        {page === "wishlist" && <WishlistPage />}
        {page === "gifts" && <GiftSetsPage />}
        {page === "about" && <AboutPage />}
        {page === "contact" && <ContactPage />}
        {page === "admin" && <AdminPage />}
      </div>

      <Toasts list={toasts} />
    </Ctx.Provider>
  );
}
