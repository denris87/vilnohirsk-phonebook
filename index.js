const express = require('express');
const cors = require('cors');
const axios = require('axios');
const yaml = require('js-yaml');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Тут мы будем хранить готовый справочник
let phonebookData = { categories: [] };

// --- Состояние номера -----------------------------------------------------
// Ровно два состояния, третьего нет:
//
//   verified: true   ✅ Перевірено   — передзвонили, человек/заведение
//                                      действительно этим занимается
//   verified: false  ○  Не перевірено — номер есть, но никто не подтверждал
//
// Фронтенду не надо ничего вычислять: в поле status приходят готовые
// label, icon и цвета.
const STATUS = {
  verified: {
    verified: true,
    key: 'verified',
    icon: '✓',
    label: 'Перевірено',
    color: '#34d399',
    background: 'rgba(52, 211, 153, 0.12)',
    border: 'rgba(52, 211, 153, 0.35)',
    hint: 'Ми передзвонили: людина справді цим займається',
  },
  unverified: {
    verified: false,
    key: 'unverified',
    icon: '○',
    label: 'Не перевірено',
    color: '#94a3b8',
    background: 'rgba(148, 163, 184, 0.10)',
    border: 'rgba(148, 163, 184, 0.25)',
    hint: 'Номер ще ніхто не підтверджував',
  },
};

function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function buildStatus(item) {
  if (!item.verified) return STATUS.unverified;

  // Дата и автор проверки необязательны — если их указали, уточняем подсказку.
  const on = formatDate(item.verified_at);
  const by = item.verified_by;
  if (!on && !by) return STATUS.verified;

  const details = [on && `перевірено ${on}`, by && `перевірив(ла) ${by}`]
    .filter(Boolean).join(', ');
  return { ...STATUS.verified, hint: `Людина справді цим займається — ${details}` };
}

// Отдаём те же поля, что были, плюс status у каждой позиции и сводку meta.
function decorate(raw) {
  let verified = 0;
  const categories = (raw && raw.categories ? raw.categories : []).map((category) => ({
    ...category,
    items: (category.items || []).map((item) => {
      const status = buildStatus(item);
      if (status.verified) verified += 1;
      return { ...item, verified: status.verified, status };
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
      verified,
      unverified: items - verified,
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
      <p>${m ? `${m.categories} категорий, ${m.items} позиций, ${m.phones} телефонов
         — проверено ${m.verified}` : 'Загрузка...'}</p>
      <a href="/api/phonebook">Посмотреть данные (JSON)</a> &nbsp;·&nbsp;
      <a href="/preview">Предпросмотр справочника</a>
    </div>
  `);
});

// Маршрут, к которому будет обращаться наше приложение
app.get('/api/phonebook', (req, res) => {
  res.json(phonebookData);
});

const escapeHtml = (s) => String(s).replace(/[&<>"]/g,
  (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Живой предпросмотр: карточки с отметкой проверки, фильтр и поиск.
// Нужен, чтобы согласовать вид, не пересобирая фронтенд.
app.get('/preview', (req, res) => {
  const m = phonebookData.meta || { items: 0, verified: 0, unverified: 0, categories: 0 };
  const percent = m.items ? Math.round((m.verified / m.items) * 100) : 0;

  const badge = (s) => `<span class="badge" style="color:${s.color};
      background:${s.background};border-color:${s.border}"
      title="${escapeHtml(s.hint)}"><i>${s.icon}</i>${escapeHtml(s.label)}</span>`;

  const cards = (phonebookData.categories || []).map((category) => `
    <section class="cat" data-name="${escapeHtml(category.name.toLowerCase())}">
      <h2><span class="ico">${escapeHtml(category.icon || '')}</span>
        ${escapeHtml(category.name)}<em>${category.items.length}</em></h2>
      <div class="grid">
        ${category.items.map((item) => `
          <article class="card${item.verified ? ' is-verified' : ''}"
                   data-verified="${item.verified}"
                   data-search="${escapeHtml((item.title + ' ' + item.phones.join(' ')).toLowerCase())}">
            <div class="head">
              <span class="title">${escapeHtml(item.title)}</span>
              ${badge(item.status)}
            </div>
            <div class="phones">${item.phones.map((p) =>
              `<a href="tel:${escapeHtml(p)}">${escapeHtml(p)}</a>`).join('')}</div>
          </article>`).join('')}
      </div>
    </section>`).join('');

  res.send(`<!doctype html><html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Довідник Вільногірська</title>
<style>
  :root { color-scheme: dark; --bg:#0b1220; --card:#111c33; --line:#1e2b45;
          --text:#e6edf7; --mute:#8fa3bf; --ok:#34d399; }
  * { box-sizing: border-box; }
  body { margin:0; padding:0 0 80px; background:var(--bg); color:var(--text);
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         -webkit-font-smoothing: antialiased; }
  .wrap { max-width:1120px; margin:0 auto; padding:0 16px; }

  header { padding:36px 0 22px; }
  h1 { font-size:26px; letter-spacing:-.02em; margin:0 0 8px; }
  .sub { color:var(--mute); font-size:14px; margin:0 0 20px; line-height:1.6; }
  .sub b { color:var(--ok); font-weight:600; }

  .bar { height:6px; border-radius:99px; background:#16233c; overflow:hidden; margin-bottom:22px; }
  .bar span { display:block; height:100%; border-radius:99px;
              background:linear-gradient(90deg,#34d399,#22d3ee); }

  .tools { display:flex; flex-wrap:wrap; gap:10px; align-items:center;
           position:sticky; top:0; z-index:5; padding:12px 0;
           background:linear-gradient(var(--bg) 70%, transparent); }
  .chip { border:1px solid var(--line); background:#0f1a2e; color:var(--mute);
          border-radius:99px; padding:7px 14px; font-size:13px; font-weight:500;
          cursor:pointer; transition:.15s; }
  .chip:hover { color:var(--text); border-color:#2b3d5e; }
  .chip.on { background:rgba(52,211,153,.12); border-color:rgba(52,211,153,.4); color:var(--ok); }
  input { flex:1; min-width:180px; background:#0f1a2e; border:1px solid var(--line);
          color:var(--text); border-radius:10px; padding:8px 13px; font-size:14px; outline:none; }
  input:focus { border-color:#2b3d5e; }

  .cat h2 { display:flex; align-items:center; gap:10px; font-size:16px;
            letter-spacing:-.01em; margin:30px 0 13px; }
  .cat h2 .ico { font-size:18px; }
  .cat h2 em { margin-left:auto; font-style:normal; font-size:12px; color:var(--mute);
               background:#16233c; border-radius:99px; padding:3px 10px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; }

  .card { background:var(--card); border:1px solid var(--line); border-radius:14px;
          padding:15px 16px; transition:.15s; }
  .card:hover { border-color:#2b3d5e; transform:translateY(-1px); }
  .card.is-verified { border-color:rgba(52,211,153,.28);
                      box-shadow: inset 3px 0 0 rgba(52,211,153,.55); }
  .head { display:flex; align-items:flex-start; gap:10px; margin-bottom:11px; }
  .title { font-weight:600; font-size:14.5px; line-height:1.4; }
  .badge { margin-left:auto; flex:none; display:inline-flex; align-items:center; gap:5px;
           font-size:11.5px; font-weight:600; border:1px solid; border-radius:99px;
           padding:3px 9px; white-space:nowrap; }
  .badge i { font-style:normal; font-size:11px; }
  .phones { display:flex; flex-wrap:wrap; gap:7px; }
  .phones a { color:#4ade80; text-decoration:none; font-size:14px;
              font-variant-numeric:tabular-nums; letter-spacing:.02em;
              border:1px solid rgba(74,222,128,.28); background:rgba(74,222,128,.07);
              border-radius:9px; padding:6px 11px; transition:.15s; }
  .phones a:hover { background:rgba(74,222,128,.14); border-color:rgba(74,222,128,.5); }

  .empty { color:var(--mute); font-size:14px; padding:40px 0; text-align:center; display:none; }
  @media (max-width:560px){ h1{font-size:22px} .grid{grid-template-columns:1fr} }
</style></head><body><div class="wrap">
<header>
  <h1>Довідник Вільногірська</h1>
  <p class="sub">${m.items} контактів у ${m.categories} категоріях.
     <b>${m.verified} перевірено</b> — це означає, що передзвонили і людина
     справді цим займається.</p>
  <div class="bar"><span style="width:${percent}%"></span></div>
</header>

<div class="tools">
  <button class="chip on" data-filter="all">Усі · ${m.items}</button>
  <button class="chip" data-filter="verified">✓ Перевірені · ${m.verified}</button>
  <button class="chip" data-filter="unverified">Не перевірені · ${m.unverified}</button>
  <input type="search" placeholder="Пошук за назвою або номером…">
</div>

${cards}
<p class="empty">Нічого не знайшли.</p>
</div>
<script>
  const chips = document.querySelectorAll('.chip');
  const search = document.querySelector('input');
  const cards = [...document.querySelectorAll('.card')];
  const cats = [...document.querySelectorAll('.cat')];
  const empty = document.querySelector('.empty');
  let filter = 'all';

  function apply() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach((card) => {
      const byState = filter === 'all' || card.dataset.verified === String(filter === 'verified');
      const byText = !q || card.dataset.search.includes(q);
      const ok = byState && byText;
      card.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    cats.forEach((cat) => {
      const any = [...cat.querySelectorAll('.card')].some((c) => c.style.display !== 'none');
      cat.style.display = any ? '' : 'none';
    });
    empty.style.display = shown ? 'none' : 'block';
  }

  chips.forEach((chip) => chip.addEventListener('click', () => {
    chips.forEach((c) => c.classList.toggle('on', c === chip));
    filter = chip.dataset.filter;
    apply();
  }));
  search.addEventListener('input', apply);
</script>
</body></html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
