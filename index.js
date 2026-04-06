const express = require('express');
const cors = require('cors');
const axios = require('axios');
const yaml = require('js-yaml');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Тут мы будем хранить готовый справочник
let phonebookData = { categories: [] };

// Функция скачивания и конвертации YAML в JSON
async function fetchPhonebook() {
  try {
    // Ссылка на ваш raw-файл в GitHub
    const url = 'https://raw.githubusercontent.com/denris87/vilnohirsk-phonebook/main/phonebook.yaml';
    
    // Добавляем timestamp, чтобы обходить кэш GitHub
    const response = await axios.get(url + '?t=' + Date.now());
    
    // Конвертируем YAML текст в JavaScript объект
    phonebookData = yaml.load(response.data);
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
  res.send(`
    <div style="font-family: sans-serif; padding: 20px;">
      <h1 style="color: #00b8ff;">Smart Vilnohirsk Phonebook API 📖</h1>
      <p>Статус: <b style="color: green;">Работает отлично!</b></p>
      <a href="/api/phonebook">Посмотреть данные (JSON)</a>
    </div>
  `);
});

// Маршрут, к которому будет обращаться наше приложение
app.get('/api/phonebook', (req, res) => {
  res.json(phonebookData);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
