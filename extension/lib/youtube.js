// Shared channel identity and public subscriber parsing. Never searches names.
(() => {
  const channelId = /^UC[A-Za-z0-9_-]{22}$/;
  const handle = /^[\p{L}\p{N}._\-·]+$/u;
  function normalize(value) {
    const raw = String(value || '').trim();
    if (channelId.test(raw)) return `https://www.youtube.com/channel/${raw}`;
    if (raw.startsWith('@') && handle.test(raw.slice(1))) return `https://www.youtube.com/@${encodeURIComponent(raw.slice(1))}`;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || !/^(?:www\.|m\.)?youtube\.com$/i.test(url.hostname)) return '';
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0]?.startsWith('@') && handle.test(parts[0].slice(1)) && (parts.length === 1 || parts.length === 2 && ['videos','shorts','streams','featured','about','community','playlists'].includes(parts[1]))) return normalize(parts[0]);
      if (parts[0] === 'channel' && channelId.test(parts[1]) && (parts.length === 2 || parts.length === 3 && ['videos','shorts','streams','featured','about','community','playlists'].includes(parts[2]))) return normalize(parts[1]);
      if (['c','user'].includes(parts[0]) && parts.length === 2 && handle.test(parts[1])) return `https://www.youtube.com/${parts[0]}/${encodeURIComponent(parts[1])}`;
    } catch { /* Not an explicit channel reference. */ }
    return '';
  }
  function same(a, b) {
    const first = normalize(a), second = normalize(b);
    return !!first && !!second && (first === second || first.includes('/@') && second.includes('/@') && first.toLowerCase() === second.toLowerCase());
  }
  function linked(user = {}) {
    return [user.youtube_channel_id,user.youTubeChannelId,user.youtubeChannelId,user.youtube_id,user.youtube_url,user.youtubeUrl].map(normalize).find(Boolean) || '';
  }
  const text = value => typeof value === 'string' ? value : value?.simpleText || value?.content || value?.runs?.map(run => run.text).join('') || '';
  function subscribers(value, labelled = true) {
    const raw = text(value).normalize('NFKC').replaceAll('萬','万').replaceAll('億','亿');
    if (/^no subscribers$/i.test(raw.trim())) return {subscribers:0,approximate:false,display:raw};
    const labels = /subscribers?|訂閱者|订阅者|登録者|suscriptores|abonnés|abonnenten|inscritos|구독자/i;
    if (labelled && !labels.test(raw)) return null;
    const part = raw.match(/\d[\d.,\s]*\s*(?:[KMB万亿])?/i)?.[0]?.trim();
    if (!part) return null;
    const m = part.replace(/\s/g,'').match(/^(\d[\d.,]*)([KMB万亿]?)$/i);
    if (!m) return null;
    const unit = m[2].toUpperCase();
    // Public pages use locale-specific decimal separators with compact units.
    const digits = unit ? m[1].replace(/,(?=\d{1,2}$)/,'.').replaceAll(',','') : m[1].replace(/[,.]/g,'');
    const count = Math.round(Number(digits) * ({K:1e3,M:1e6,B:1e9,'万':1e4,'亿':1e8}[unit] || 1));
    return Number.isFinite(count) && count >= 0 ? {subscribers:count,approximate:!!unit,display:raw} : null;
  }
  function extract(data) {
    const metadata = data?.metadata?.channelMetadataRenderer;
    // YouTube itself can emit HTTP aliases in metadata; normalize them for
    // identity checks without navigating to an insecure user-supplied URL.
    const identities = [metadata?.externalId,metadata?.channelUrl,metadata?.vanityChannelUrl,...(metadata?.ownerUrls||[]),data?.header?.c4TabbedHeaderRenderer?.channelId].map(value=>normalize(String(value||'').replace(/^http:\/\/(?=(?:www\.|m\.)?youtube\.com\/)/i,'https://'))).filter(Boolean);
    let count = null;
    // Restrict counts to the current channel header, excluding recommended channels.
    function visit(node, depth = 0) {
      if (!node || typeof node !== 'object' || depth > 16 || count) return;
      if (node.subscriberCountText) count = subscribers(node.subscriberCountText, false);
      if (!count) for (const key of ['content','simpleText','accessibilityLabel']) if (typeof node[key] === 'string') { count = subscribers(node[key]); if (count) break; }
      if (!count) for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value, depth + 1);
    }
    visit(data?.header);
    return {identities:[...new Set(identities)],name:metadata?.title || data?.header?.pageHeaderRenderer?.pageTitle || '',...count};
  }
  function initialData(doc) {
    for (const script of doc.querySelectorAll('script')) {
      const source = script.textContent || '', marker = /(?:var\s+ytInitialData|window\[['"]ytInitialData['"]\]|ytInitialData)\s*=\s*/g;
      const match = marker.exec(source); if (!match) continue;
      const start = source.indexOf('{', marker.lastIndex); if (start < 0) continue;
      let depth = 0, quoted = false, escape = false;
      for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (quoted) { if (escape) escape = false; else if (char === '\\') escape = true; else if (char === '"') quoted = false; }
        else if (char === '"') quoted = true;
        else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) { try { return JSON.parse(source.slice(start,i+1)); } catch { break; } }
      }
    }
    return null;
  }
  globalThis.KOLYouTube = {normalize,same,linked,subscribers,extract,initialData};
})();
