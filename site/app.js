const key = 'enriqueite.ai-mate.site.language';
for (const link of document.querySelectorAll('[data-lang]')) {
  link.addEventListener('click', () => {
    try { localStorage.setItem(key, link.dataset.lang); } catch {}
  });
}

if (document.documentElement.lang === 'es') {
  let preferred;
  try { preferred = localStorage.getItem(key); } catch {}
  if (!preferred) {
    const languages = navigator.languages || [navigator.language];
    preferred = languages.map(tag => tag.split('-')[0].toLowerCase()).find(lang => lang === 'es' || lang === 'en');
  }
  if (preferred === 'en') location.replace('en/index.html' + location.search + location.hash);
}

const group = document.querySelector('.toggle');
const examples = document.querySelectorAll('[data-example]');
const buttons = group.querySelectorAll('button');
group.hidden = false;
group.addEventListener('click', event => {
  const active = event.target.closest('button[data-style]');
  if (!active) return;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button === active));
  for (const example of examples) example.hidden = example.dataset.example !== active.dataset.style;
});
