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
      const currentMember = await teamMembers.findOne(
        { telegramId: String(user.id) },
        { projection: { _id: 0, displayName: 1 } }
      );
      const dbTasks = await collection.find({}).toArray();
      return res.status(200).json({
        success: true,
        userName: currentMember && currentMember.displayName ? currentMember.displayName : realName,
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
      const validStatuses = ['todo', 'progress', 'blocked', 'done', 'cancelled'];
      const validPriorities = ['low', 'medium', 'high', 'critical'];
      const currentMember = await teamMembers.findOne(
        { telegramId: String(user.id) },
        { projection: { _id: 0, displayName: 1 } }
      );
      const newTask = {
        id: Date.now().toString(),
        status: validStatuses.includes(req.body.task.status) ? req.body.task.status : 'todo',
        text: req.body.task.text,
        author: currentMember && currentMember.displayName ? currentMember.displayName : realName,
        executor: req.body.task.executor || '—',
        deadline: req.body.task.deadline || '—',
        priority: validPriorities.includes(req.body.task.priority) ? req.body.task.priority : 'medium',
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

      const statusLabels = {
        todo: 'Беклог',
        progress: 'В работе',
        blocked: 'Блок',
        done: 'Выполнено',
        cancelled: 'Отменено'
      };

      const priorityLabels = {
        low: 'Низкий',
        medium: 'Средний',
        high: 'Высокий',
        critical: 'Критический'
      };

      const formatDueDate = (deadline) => {
        if (!deadline || deadline === '—') return '';
        const isoDate = String(deadline).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return isoDate ? `${isoDate[3]}.${isoDate[2]}.${isoDate[1]}` : deadline;
      };

      // Строка 1 принадлежит пользователю и никогда не перезаписывается.
      // Notes станет отдельным шестым столбцом в следующей итерации.
      const rows = [];

      dbTasks.forEach(t => {
        rows.push([
          t.text,
          statusLabels[t.status] || 'Беклог',
          t.author,
          t.executor || '—',
          formatDueDate(t.deadline),
          priorityLabels[t.priority] || 'Средний'
        ]);
      });

      // Автоматически определяем имя первого листа таблицы (Лист1 или Sheet1)
      const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
      const firstSheet = spreadsheetInfo.data.sheets[0].properties;
      const firstSheetName = firstSheet.title;
      const firstSheetId = firstSheet.sheetId;

      const teamMembers = await db.collection('team_members')
        .find({}, { projection: { _id: 0, telegramId: 1, displayName: 1, telegramFirstName: 1, telegramLastName: 1, telegramUsername: 1, team: 1 } })
        .toArray();

      const formatMemberLabel = (member) => {
        if (member.displayName) return member.team ? `${member.displayName} · ${member.team}` : member.displayName;
        const telegramName = [member.telegramFirstName, member.telegramLastName].filter(Boolean).join(' ');
        return member.telegramUsername ? `${telegramName || 'Пользователь'} · @${member.telegramUsername}` : telegramName || 'Пользователь';
      };

      const resolveMemberLabel = (value) => {
        if (!value || value === '—') return '—';
        const member = teamMembers.find((item) => {
          const telegramName = [item.telegramFirstName, item.telegramLastName].filter(Boolean).join(' ');
          const aliases = [
            formatMemberLabel(item),
            item.displayName,
            item.telegramFirstName,
            telegramName,
            item.telegramUsername ? `@${item.telegramUsername}` : '',
            `Сотрудник [${item.telegramId}]`
          ];
          return aliases.filter(Boolean).includes(value);
        });
        return member ? formatMemberLabel(member) : value;
      };

      rows.forEach((row) => {
        row[2] = resolveMemberLabel(row[2]);
        row[3] = resolveMemberLabel(row[3]);
      });

      // Старые значения включены временно, чтобы ранее созданные задачи не стали
      // невалидными в dropdown до полного перехода на справочник.
      const memberOptions = Array.from(new Set([
        '—',
        ...teamMembers.map(formatMemberLabel),
        ...dbTasks.flatMap(task => [task.author, task.executor]).filter(value => value && value !== '—')
      ]));

      const dropdownRule = (values, inputMessage) => ({
        condition: {
          type: 'ONE_OF_LIST',
          values: values.map(value => ({ userEnteredValue: value }))
        },
        strict: true,
        showCustomUi: true,
        inputMessage
      });

      // Очищаем только строки с задачами, не затрагивая заголовки в строке 1.
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${firstSheetName}!A2:Z1000`
      });

            // Применяем dropdown сразу после clear — столбцы ещё не "typed"
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            // Dropdown для статуса (строки 2-1000)
            {
              setDataValidation: {
                range: { sheetId: firstSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 1, endColumnIndex: 2 },
                rule: dropdownRule(Object.values(statusLabels), 'Выберите статус задачи.')
              }
            },
            // Dropdown для автора
            {
              setDataValidation: {
                range: { sheetId: firstSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 3 },
                rule: dropdownRule(memberOptions, 'Выберите автора из справочника.')
              }
            },
            // Dropdown для исполнителя
            {
              setDataValidation: {
                range: { sheetId: firstSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 },
                rule: dropdownRule(memberOptions, 'Выберите исполнителя из справочника.')
              }
            },
            // Dropdown для приоритета
            {
              setDataValidation: {
                range: { sheetId: firstSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 5, endColumnIndex: 6 },
                rule: dropdownRule(Object.values(priorityLabels), 'Выберите приоритет задачи.')
              }
            }
          ]
        }
      });

      // Записываем задачи
      if (rows.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${firstSheetName}!A2`,
          valueInputOption: 'RAW',
          resource: { values: rows }
        });
      }

      // Записываем задачи
      if (rows.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${firstSheetName}!A2`,
          valueInputOption: 'RAW',
          resource: { values: rows }
        });
      }

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
