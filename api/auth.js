const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { google } = require('googleapis');

// Кэш подключений к БД для Serverless-архитектуры Vercel
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }
  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000
  });
  await client.connect();
  const db = client.db('pocket_jira');
  cachedClient = client;
  cachedDb = db;
  return { client, db };
}

module.exports = async (req, res) => {
  // Настройка CORS политик
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tg-init-data');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const botToken = process.env.BOT_TOKEN;
  const allowedUsers = (process.env.ALLOWED_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  const developerUsers = (process.env.DEV_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  const initData = req.body?.initData || req.headers['x-tg-init-data'];

  if (!initData || !botToken) {
    return res.status(401).json({ error: 'Сессия Telegram не найдена или сервер не настроен.' });
  }

  // 1. Валидация криптографической подписи Telegram
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

  // Извлекаем данные пользователя
  const user = JSON.parse(urlParams.get('user') || '{}');
  if (!user.id || !allowedUsers.includes(String(user.id))) {
    return res.status(403).json({ error: 'Доступ ограничен.' });
  }

  const realName = user.first_name || user.username || 'Участник';
  const isDeveloper = developerUsers.includes(String(user.id));

  try {
    const { db } = await connectToDatabase();
    const collection = db.collection('tasks');
    const teamMembers = db.collection('team_members');

    // МАРШРУТ 1: Вход в приложение и выгрузка задач на доску
    if (req.method === 'POST' && req.body.action === 'login') {
      const dbTasks = await collection.find({}).toArray();
      return res.status(200).json({
        success: true,
        userName: realName,
        tasks: dbTasks,
        usersWhitelist: allowedUsers,
        isDeveloper
      });
    }

    // DevTools: справочник команды и одноразовые приглашения для /start.
    if (req.method === 'POST' && ['list_team_members', 'create_invite', 'update_team_member'].includes(req.body.action)) {
      if (!isDeveloper) {
        return res.status(403).json({ error: 'DevTools доступны только разработчику.' });
      }

      if (req.body.action === 'list_team_members') {
        const members = await teamMembers
          .find({}, { projection: { _id: 0, telegramId: 1, telegramFirstName: 1, telegramLastName: 1, telegramUsername: 1, displayName: 1, team: 1, registeredAt: 1 } })
          .sort({ registeredAt: -1 })
          .toArray();
        return res.status(200).json({ success: true, members });
      }

      if (req.body.action === 'create_invite') {
        const token = `join_${crypto.randomBytes(24).toString('base64url')}`;
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
        await db.collection('bot_invites').insertOne({
          token,
          createdAt,
          expiresAt,
          createdById: String(user.id)
        });

        const botUsername = (process.env.BOT_USERNAME || '').replace(/^@/, '');
        return res.status(200).json({
          success: true,
          token,
          expiresAt,
          inviteLink: botUsername ? `https://t.me/${botUsername}?start=${token}` : null
        });
      }

      const { telegramId, displayName, team } = req.body.member || {};
      if (!/^\d+$/.test(String(telegramId || ''))) {
        return res.status(400).json({ error: 'Некорректный Telegram ID.' });
      }

      const normalizedDisplayName = String(displayName || '').trim();
      const normalizedTeam = String(team || '').trim();
      if (normalizedDisplayName.length > 100 || normalizedTeam.length > 100) {
        return res.status(400).json({ error: 'Имя и команда не должны быть длиннее 100 символов.' });
      }

      const result = await teamMembers.updateOne(
        { telegramId: String(telegramId) },
        { $set: { displayName: normalizedDisplayName, team: normalizedTeam, updatedAt: new Date() } }
      );
      if (!result.matchedCount) {
        return res.status(404).json({ error: 'Пользователь не найден в справочнике.' });
      }
      return res.status(200).json({ success: true });
    }

    // МАРШРУТ 2: Добавление новой задачи в MongoDB Atlas
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

    // МАРШРУТ 3: Изменение статуса задачи (Drag & Drop)
    if (req.method === 'PUT') {
      const { taskId, newStatus } = req.body;
      await collection.updateOne({ id: taskId }, { $set: { status: newStatus } });
      return res.status(200).json({ success: true });
    }

    // МАРШРУТ 4: Удаление задачи
    if (req.method === 'DELETE') {
      const { taskId } = req.body || {};
      if (!taskId) {
        return res.status(400).json({ error: 'Не указан идентификатор задачи.' });
      }

      const result = await collection.deleteOne({ id: taskId });
      if (!result.deletedCount) {
        return res.status(404).json({ error: 'Задача не найдена.' });
      }

      return res.status(200).json({ success: true });
    }

    // МАРШРУТ 5: Синхронизация данных с Google Sheets
    if (req.method === 'POST' && req.body.action === 'sync_google') {
      
      // ИСПРАВЛЕННЫЙ И НАДЕЖНЫЙ ВАРИАНТ:
      let privateKey = process.env.GOOGLE_PRIVATE_KEY;

      if (privateKey) {
       // Убираем случайные внешние кавычки, если они закрались
       privateKey = privateKey.trim().replace(/^["']|["']$/g, '');
  
       // Если ключ содержит текстовые слэши \n — превращаем их в переносы
        if (privateKey.includes('\\n')) {
          privateKey = privateKey.replace(/\\n/g, '\n');
         } else {
        // Если ключ многострочный (как на скриншоте) — 
        // нормализуем переносы строк для Linux-серверов Vercel
        privateKey = privateKey.split(/\r?\n/).join('\n');
      }
}


      const auth = new google.auth.JWT(
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        null,
        privateKey,
        ['https://www.googleapis.com/auth/spreadsheets']
      );

      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
      
      // Достаем актуальный срез из MongoDB Atlas
      const dbTasks = await collection.find({}).toArray();

      // Формируем структуру строк (первая строка — шапка таблицы)
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

      // Автоматически определяем имя первого листа таблицы (Лист1 или Sheet1)
      const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
      const firstSheetName = spreadsheetInfo.data.sheets[0].properties.title;

      // Очищаем старые записи
      await sheets.spreadsheets.values.clear({ 
        spreadsheetId, 
        range: `${firstSheetName}!A1:Z1000` 
      });
      
      // Записываем обновленные строки
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${firstSheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: rows }
      });

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Некорректный метод или действие.' });
 } catch (err) {
    console.error('SERVER ERROR LOG:', err);
    
    // ИСПРАВЛЕНО: Бэкенд теперь честно скажет фронтенду, на чем споткнулся Google
    const errorMessage = err.message || 'Неизвестная ошибка сервера.';
    return res.status(500).json({ 
      error: 'Ошибка: ' + errorMessage 
    });
  }
};
