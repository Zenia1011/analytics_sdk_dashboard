(function (global) {
  const STORAGE_VISITOR='demo_analytics_visitor';
  const STORAGE_SESSION='demo_analytics_session';
  function id() {
    return (global.crypto && crypto.randomUUID) ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16);});
  }
  function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function safeSet(key,val) { try { localStorage.setItem(key,val); } catch {} }
  class Analytics {
    constructor(options={}) {
      this.endpoint=(options.endpoint||'').replace(/\/$/,'');
      this.queue=[]; this.flushTimer=null; this.maxQueue=options.maxQueue||100;
      this.visitorId=safeGet(STORAGE_VISITOR)||id(); safeSet(STORAGE_VISITOR,this.visitorId);
      this.sessionId=safeGet(STORAGE_SESSION)||id(); safeSet(STORAGE_SESSION,this.sessionId);
      this.consent=options.consent !== false;
      this.fetch=options.fetch||global.fetch.bind(global);
      this.flushInterval=options.flushInterval||3000;
    }
    track(eventName, properties={}) {
      if(!this.consent || typeof eventName!=='string' || !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/.test(eventName)) return false;
      const event={event_name:eventName,source:'browser',visitor_id:this.visitorId,session_id:this.sessionId,
        page_path:global.location ? global.location.pathname : '/',occurred_at:new Date().toISOString(),
        properties:this._clean(properties)};
      this.queue.push(event);
      if(this.queue.length>=this.maxQueue) this.flush(); else if(!this.flushTimer) this.flushTimer=setTimeout(()=>this.flush(),this.flushInterval);
      return true;
    }
    pageView(properties={}) { return this.track('page_view', {title:global.document?.title||'',...properties}); }
    _clean(obj) {
      if(!obj || typeof obj!=='object' || Array.isArray(obj)) return {};
      const out={}; Object.entries(obj).slice(0,30).forEach(([k,v])=>{
        if(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k) && (['string','number','boolean'].includes(typeof v)||v===null))
          out[k]=typeof v==='string'?v.slice(0,200):v;
      }); return out;
    }
    async flush() {
      if(this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer=null; }
      if(!this.queue.length || !this.endpoint) return;
      const batch=this.queue.splice(0,100);
      try {
        const response=await this.fetch(this.endpoint+'/api/events',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({events:batch}),keepalive:true});
        if(!response.ok) throw new Error('Ingestion returned '+response.status);
      } catch {
        // Put failed events back at the front, bounded to avoid unbounded memory use.
        this.queue=[...batch,...this.queue].slice(0,this.maxQueue);
      }
      if(this.queue.length) this.flushTimer=setTimeout(()=>this.flush(),this.flushInterval);
    }
    setConsent(enabled) { this.consent=Boolean(enabled); if(!this.consent) this.queue=[]; }
  }
  global.AnalyticsSDK=Analytics;
})(window);
