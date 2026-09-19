const express = require('express');
const cors = require('cors');
const axios = require('axios');
const yaml = require('js-yaml');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Тут мы будем хранить готовый справочник
let phonebookData = { categories: [] };

// --- Уровни доверия -------------------------------------------------------
// Каждая позиция справочника получает поле trust, которое фронтенд рисует
// значком рядом с номером. Уровень выводится из данных, руками ничего
// дублировать не надо.
//
//   broken: true                -> ⛔ не работает
//   verified_at: "2026-09-19"   -> ✅ проверено (звонили, номер живой)
//   source: directory           -> 📋 из городского справочника
//   recommended >= 3            -> 👥 советовали N человек
//   иначе                       -> 💬 из чата, не проверено
const TRUST_LEVELS = {
  broken:    { level: 'broken',    icon: '⛔', color: '#f87171', label: 'Не відповідає' },
  verified:  { level: 'verified',  icon: '✅', color: '#34d399', label: 'Перевірено' },
  directory: { level: 'directory', icon: '📋', color: '#60a5fa', label: 'З міського довідника' },
  community: { level: 'community', icon: '👥', color: '#fbbf24', label: 'Радить спільнота' },
  chat:      { level: 'chat',      icon: '💬', color: '#94a3b8', label: 'З чату, не перевірено' },
};

const MIN_RECOMMENDATIONS = 3;

function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

// 1 людина, 2-4 людини, 5+ людей
function people(n) {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return `${n} людей`;
  if (ones === 1) return `${n} людина`;
  if (ones >= 2 && ones <= 4) return `${n} людини`;
  return `${n} людей`;
}

// Возвращает готовый к отрисовке значок: label, icon, color и короткое
// пояснение, которое можно показать в тултипе.
function buildTrust(item) {
  if (item.broken) {
    return { ...TRUST_LEVELS.broken, hint: 'Спільнота повідомила, що номер не діє' };
  }

  const verifiedOn = formatDate(item.verified_at);
  if (verifiedOn) {
    const by = item.verified_by ? `, ${item.verified_by}` : '';
    return {
      ...TRUST_LEVELS.verified,
      label: `Перевірено ${verifiedOn}`,
      hint: `Номер набрали і він підтвердився ${verifiedOn}${by}`,
    };
  }

  const seenOn = formatDate(item.last_seen);
  const seenHint = seenOn ? ` Востаннє згадували ${seenOn}.` : '';
  const recommended = Number(item.recommended) || 0;

  if (item.source === 'directory') {
    return { ...TRUST_LEVELS.directory, hint: `Контакт із міського довідника.${seenHint}` };
  }

  if (recommended >= MIN_RECOMMENDATIONS) {
    return {
      ...TRUST_LEVELS.community,
      label: `Радить ${people(recommended)}`,
      hint: `${people(recommended)} незалежно називали цей номер у чаті.${seenHint}`,
    };
  }

  const who = recommended === 1 ? 'Одна людина порадила' : `${people(recommended)} порадили`;
  return {
    ...TRUST_LEVELS.chat,
    hint: recommended ? `${who} цей номер у чаті. Ніхто не передзвонював.${seenHint}`
                      : 'Номер з чату, не підтверджений.',
  };
}

// Раскладывает сырой YAML в то, что отдаём приложению: те же поля плюс trust
// у каждой позиции и сводка по уровням.
function decorate(raw) {
  const totals = {};
  const categories = (raw && raw.categories ? raw.categories : []).map((category) => ({
    ...category,
    items: (category.items || []).map((item) => {
      const trust = buildTrust(item);
      totals[trust.level] = (totals[trust.level] || 0) + 1;
      return { ...item, trust };
    }),
  }));

  const items = categories.reduce((sum, c) => sum + c.items.length, 0);
  return {
    categories,
    meta: {
      categories: categories.length,
      items,
      phones: categories.reduce(
        (sum, c) => sum + c.items.reduce((n, i) => n + (i.phones || []).length, 0), 0),
      trust: totals,
      updated_at: new Date().toISOString(),
    },
  };
}

// Функция скачивания и конвертации YAML в JSON
async function fetchPhonebook() {
  try {
    // Ссылка на ваш raw-файл в GitHub (PHONEBOOK_URL — чтобы проверить локально)
    const url = process.env.PHONEBOOK_URL ||
      'https://raw.githubusercontent.com/denris87/vilnohirsk-phonebook/main/phonebook.yaml';

    // Добавляем timestamp, чтобы обходить кэш GitHub
    const response = await axios.get(url + '?t=' + Date.now());

    // Конвертируем YAML текст в JavaScript объект
    phonebookData = decorate(yaml.load(response.data));
    console.log('✅ Справочник успешно обновлен с GitHub');
  } catch (error) {
    console.error('❌ Ошибка загрузки справочника:', error.message);
  }
}

// Запускаем обновление каждые 5 минут
setInterval(fetchPhonebook, 5 * 60 * 1000);

// Делаем самую первую загрузку при старте сервера
fetchPhonebook();

// Главная страница для проверки статуса сервера
app.get('/', (req, res) => {
  const m = phonebookData.meta;
  res.send(`
    <div style="font-family: sans-serif; padding: 20px;">
      <h1 style="color: #00b8ff;">Smart Vilnohirsk Phonebook API 📖</h1>
      <p>Статус: <b style="color: green;">Работает отлично!</b></p>
      <p>${m ? `${m.categories} категорий, ${m.items} позиций, ${m.phones} телефонов` : 'Загрузка...'}</p>
      <a href="/api/phonebook">Посмотреть данные (JSON)</a> &nbsp;·&nbsp;
      <a href="/preview">Как выглядят значки доверия</a>
    </div>
  `);
});

// Маршрут, к которому будет обращаться наше приложение
app.get('/api/phonebook', (req, res) => {
  res.json(phonebookData);
});

const escapeHtml = (s) => String(s).replace(/[&<>"]/g,
  (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Живой предпросмотр: та же вёрстка карточек, что в приложении, но со
// значками доверия. Нужен, чтобы согласовать дизайн, не собирая фронтенд.
app.get('/preview', (req, res) => {
  const cards = (phonebookData.categories || []).map((category) => `
    <section class="cat">
      <h2><span>${escapeHtml(category.icon || '')}</span> ${escapeHtml(category.name)}
        <em>${category.items.length}</em></h2>
      <div class="grid">
        ${category.items.map((item) => `
          <article class="card">
            <div class="row">
              <span class="title">${escapeHtml(item.title)}</span>
              <span class="phones">${item.phones.map((p) =>
                `<b>${escapeHtml(p)}</b>`).join('')}</span>
            </div>
            <span class="badge" style="color:${item.trust.color};border-color:${item.trust.color}33;background:${item.trust.color}14"
                  title="${escapeHtml(item.trust.hint)}">
              ${item.trust.icon} ${escapeHtml(item.trust.label)}
            </span>
          </article>`).join('')}
      </div>
    </section>`).join('');

  const legend = Object.values(TRUST_LEVELS).map((t) =>
    `<span class="badge" style="color:${t.color};border-color:${t.color}33;background:${t.color}14">${t.icon} ${t.label}</span>`).join('');

  res.send(`<!doctype html><html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Позначки довіри</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px 16px 64px; background:#0f172a; color:#e2e8f0;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .lead { color:#94a3b8; font-size:14px; margin:0 0 20px; line-height:1.6; }
  .legend { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:32px; }
  .cat h2 { display:flex; align-items:center; gap:10px; font-size:17px; margin:28px 0 12px; }
  .cat h2 em { margin-left:auto; font-style:normal; font-size:13px; color:#94a3b8;
               background:#1e293b; border-radius:999px; padding:2px 10px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:12px; }
  .card { background:#111c33; border:1px solid #1e293b; border-radius:12px; padding:14px 16px; }
  .row { display:flex; align-items:center; gap:12px; }
  .title { font-weight:600; font-size:14px; line-height:1.35; }
  .phones { margin-left:auto; display:flex; flex-direction:column; gap:4px; text-align:right; }
  .phones b { color:#4ade80; font-variant-numeric:tabular-nums; border:1px solid #14532d;
              border-radius:8px; padding:5px 10px; font-size:14px; white-space:nowrap; }
  .badge { display:inline-flex; align-items:center; gap:5px; margin-top:10px;
           font-size:12px; font-weight:500; border:1px solid; border-radius:999px; padding:3px 10px; }
  @media (max-width:520px){ .row{flex-direction:column;align-items:flex-start}
    .phones{margin-left:0;text-align:left} }
</style></head><body><div class="wrap">
<h1>Позначки довіри біля номерів</h1>
<p class="lead">Рівень рахується автоматично з даних у phonebook.yaml.
«Перевірено» ставиться вручну — додайте позиції рядок
<code>verified_at: "2026-09-19"</code> після того, як номер набрали.</p>
<div class="legend">${legend}</div>
${cards}
</div></body></html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
