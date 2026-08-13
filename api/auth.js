const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// Кэш подключений для Serverless-архитектуры
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }
  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 10, // Ограничиваем пул для экономии лимитов Atlas
    serverSelectionTimeoutMS: 5000
  });
  await client.connect();
  const db = client.db('pocket_jira');
  cachedClient = client;
  cachedDb = db;
  return { client, db };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const botToken = process.env.BOT_TOKEN;
  const allowedUsers = (process.env.ALLOWED_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

  // Извлекаем initData из заголовков или тела запроса
  const initData = req.body?.initData || req.headers['x-tg-init-data'];

  if (!initData || !botToken) {
    return res.status(401).json({ error: 'Сессия Telegram не найдена или сервер не настроен.' });
  }

  // 1. Валидация подписи Telegram
  const urlParams = new URLSearchParams(initData);
  const receivedHash = urlParams.get('hash');
  if (!receivedHash) return res.status(401).json({ error: 'Подпись отсутствует.' });

  urlParams.delete('hash');
  const dataCheckString = Array.from(urlParams.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(receivedHash, 'hex'), Buffer.from(calculatedHash, 'hex'))) {
    return res.status(401).json({ error: 'Криптографическая проверка не пройдена.' });
  }

  const user = JSON.parse(urlParams.get('user') || '{}');
  if (!user.id || !allowedUsers.includes(String(user.id))) {
    return res.status(403).json({ error: 'Доступ ограничен.' });
  }

  const realName = user.first_name || user.username || 'Участник';

  try {
    const { db } = await connectToDatabase();
    const collection = db.collection('tasks');

    // МАРШРУТ 1: Проверка входа и выдача стартового массива задач
    if (req.method === 'POST' && req.body.action === 'login') {
      const dbTasks = await collection.find({}).toArray();
      // Отдаем массив разрешенных ID вместе с задачами
      return res.status(200).json({ 
        success: true, 
        userName: realName, 
        tasks: dbTasks,
        usersWhitelist: allowedUsers 
      });
    }

    // МАРШРУТ 2: Добавление новой задачи
    if (req.method === 'POST' && req.body.action === 'create') {
      const newTask = {
        id: Date.now().toString(),
        status: 'todo',
        text: req.body.task.text,
        author: realName,
        executor: req.body.task.executor || '—',
        deadline: req.body.task.deadline || '—',
        priority: req.body.task.priority,
        createdAt: new Date()
      };
      await collection.insertOne(newTask);
      return res.status(200).json({ success: true, task: newTask });
    }

    // МАРШРУТ 3: Перетаскивание (Обновление статуса)
    if (req.method === 'PUT') {
      const { taskId, newStatus } = req.body;
      await collection.updateOne({ id: taskId }, { $set: { status: newStatus } });
      return res.status(200).json({ success: true });
    }

    // МАРШРУТ 4: Эксель
    const { google } = require('googleapis'); // Импортируем в самый верх файла

    // Внутри экспорта модуля, после проверок Whitelist:
    if (req.method === 'POST' && req.body.action === 'sync_google') {
      try {
        // 1. Авторизация в Google Workspace
        const auth = new google.auth.JWT(
          process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          null,
          process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Корректируем переносы строк ключа
          ['https://googleapis.com']
        );

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

        // 2. Достаем все актуальные задачи из нашей MongoDB
        const dbTasks = await collection.find({}).toArray();

        // 3. Форматируем данные для таблицы (первая строка — шапка)
        const rows = [
          ['ID Задачи', 'Статус', 'Текст задачи', 'Автор', 'Исполнитель', 'Срок', 'Приоритет']
        ];

        dbTasks.forEach(t => {
          rows.push([
            t.id,
              t.status === 'todo' ? 'Надо сделать' : t.status === 'progress' ? 'В работе' : 'Готово',
              t.text,
              t.author,
              t.executor || '—',
              t.deadline || '—',
              t.priority.toUpperCase()
            ]);
          });

        // 4. Полностью очищаем старый лист таблицы перед перезаписью
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: 'Лист1!A1:Z1000'
        });

        // 5. Записываем новые данные в Google Таблицу
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Лист1!A1',
          valueInputOption: 'USER_ENTERED',
          resource: { values: rows }
        });

        return res.status(200).json({ success: true });

      } catch (googleErr) {
      console.error('Google Sheets Sync Error:', googleErr);
      return res.status(500).json({ error: 'Не удалось обновить Google Таблицу.' });
    }
  }

    return res.status(400).json({ error: 'Некорректный метод' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Ошибка Базы Данных.' });
  }
};
