const HASH_GUARD_SCRIPT = `<script>(function(){document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var a=t.closest('a[href^="#"]');if(!a)return;e.preventDefault();var id=a.getAttribute('href').slice(1);if(!id){window.scrollTo({top:0,behavior:'smooth'});return;}var el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});});})();</script>`;

export function injectHashGuard(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return html;
  const bodyCloseIdx = html.search(/<\/body>/i);
  if (bodyCloseIdx !== -1) {
    return html.slice(0, bodyCloseIdx) + HASH_GUARD_SCRIPT + html.slice(bodyCloseIdx);
  }
  return html + HASH_GUARD_SCRIPT;
}