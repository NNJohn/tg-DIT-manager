const crypto = require('crypto');
const { connectToDatabase, STATUS_LABELS, PRIORITY_LABELS, formatUserWhitelistName } = require('./lib');
const { syncGoogle, deleteFromSheets } = require('./sheets');

module.exports = async (req, res) => {
  // CORS
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
  const isDeveloper = developerUsers.includes(String(user.id));

  try {
    const { db } = await connectToDatabase();
    const collection = db.collection('tasks');
    const teamMembers = db.collection('team_members');

    // ============================================================
    // МАРШРУТ 1: Login — выгрузка задач
    // ============================================================
    if (req.method === 'POST' && req.body.action === 'login') {
      const currentMember = await teamMembers.findOne(
        { telegramId: String(user.id) },
        { projection: { _id: 0, displayName: 1 } }
      );
      const dbTasks = await collection.find({}).toArray();

      const whitelistMembers = await teamMembers
        .find({ telegramId: { $in: allowedUsers.map(String) } }, { projection: { _id: 0, telegramId: 1, displayName: 1, telegramFirstName: 1, telegramLastName: 1, telegramUsername: 1 } })
        .toArray();

      const usersWhitelist = whitelistMembers.map(m => formatUserWhitelistName(m));

      return res.status(200).json({
        success: true,
        userName: currentMember && currentMember.displayName ? currentMember.displayName : realName,
        tasks: dbTasks,
        usersWhitelist,
        isDeveloper
      });
    }

    // ============================================================
    // DevTools
    // ============================================================
    if (req.method === 'POST' && ['list_team_members', 'create_invite', 'update_team_member'].includes(req.body.action)) {
      if (!isDeveloper) {
        return res.status(403).json({ error: 'DevTools доступны только разработчику.' });
      }

      if (req.body.action === 'list_team_members') {
        const members = await teamMembers
          .find({}, { projection: { _id: 0, telegramId: 1, telegramFirstName: 1, telegramLastName: 1, telegramUsername: 1, displayName: 1, registeredAt: 1 } })
          .sort({ registeredAt: -1 })
          .toArray();
        return res.status(200).json({ success: true, members });
      }

      if (req.body.action === 'create_invite') {
        const token = `join_${crypto.randomBytes(24).toString('base64url')}`;
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
        await db.collection('bot_invites').insertOne({ token, createdAt, expiresAt, createdById: String(user.id) });

        const botUsername = (process.env.BOT_USERNAME || '').replace(/^@/, '');
        return res.status(200).json({
          success: true,
          token,
          expiresAt,
          inviteLink: botUsername ? `https://t.me/${botUsername}?start=${token}` : null
        });
      }

      if (req.body.action === 'update_team_member') {
        const { telegramId, displayName } = req.body.member || {};
        if (!/^\d+$/.test(String(telegramId || ''))) {
          return res.status(400).json({ error: 'Некорректный Telegram ID.' });
        }
        const normalizedDisplayName = String(displayName || '').trim();
        if (normalizedDisplayName.length > 100) {
          return res.status(400).json({ error: 'Имя не должно быть длиннее 100 символов.' });
        }

        const result = await teamMembers.updateOne(
          { telegramId: String(telegramId) },
          { $set: { displayName: normalizedDisplayName, updatedAt: new Date() }, $unset: { team: '' } }
        );
        if (!result.matchedCount) {
          return res.status(404).json({ error: 'Пользователь не найден в справочнике.' });
        }
        return res.status(200).json({ success: true });
      }
    }

    // ============================================================
    // CRUD: Create / Update / Delete / Drag & Drop
    // ============================================================
    const validStatuses = Object.keys(STATUS_LABELS);
    const validPriorities = Object.keys(PRIORITY_LABELS);

    if (req.method === 'POST' && req.body.action === 'create') {
      const currentMember = await teamMembers.findOne(
        { telegramId: String(user.id) },
        { projection: { _id: 0, displayName: 1 } }
      );
      const newTask = {
        id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        status: validStatuses.includes(req.body.task.status) ? req.body.task.status : 'todo',
        text: req.body.task.text,
        author: currentMember && currentMember.displayName ? currentMember.displayName : realName,
        executor: req.body.task.executor || '—',
        deadline: req.body.task.deadline || '—',
        priority: validPriorities.includes(req.body.task.priority) ? req.body.task.priority : 'medium',
        notes: req.body.task.notes || '',
        createdAt: new Date(),
        lastModified: new Date()
      };
      await collection.insertOne(newTask);
      return res.status(200).json({ success: true, task: newTask });
    }

    if (req.method === 'POST' && req.body.action === 'update') {
      const { taskId } = req.body;
      if (!taskId) return res.status(400).json({ error: 'Не указан ID задачи.' });

      const updateFields = {};
      if (req.body.task) {
        updateFields.text = req.body.task.text || '—';
        updateFields.status = validStatuses.includes(req.body.task.status) ? req.body.task.status : 'todo';
        updateFields.executor = req.body.task.executor || '—';
        updateFields.deadline = req.body.task.deadline || '—';
        updateFields.priority = validPriorities.includes(req.body.task.priority) ? req.body.task.priority : 'medium';
        updateFields.notes = req.body.task.notes || '';
      }
      updateFields.lastModified = new Date();

      const result = await collection.updateOne({ id: taskId }, { $set: updateFields });
      if (!result.matchedCount) {
        return res.status(404).json({ error: 'Задача не найдена.' });
      }
      const updatedTask = await collection.findOne({ id: taskId });
      return res.status(200).json({ success: true, task: updatedTask });
    }

    if (req.method === 'PUT') {
      const { taskId, newStatus } = req.body;
      await collection.updateOne({ id: taskId }, { $set: { status: newStatus } });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && req.body.action === 'delete_task') {
      const { taskId } = req.body || {};
      if (!taskId) return res.status(400).json({ error: 'Не указан идентификатор задачи.' });

      const task = await collection.findOne({ id: taskId });
      const result = await collection.deleteOne({ id: taskId });
      if (!result.deletedCount) {
        return res.status(404).json({ error: 'Задача не найдена.' });
      }

      // Удаляем из Sheets
      await deleteFromSheets(db, taskId);

      return res.status(200).json({ success: true });
    }

    // ============================================================
    // Sync: Google Sheets
    // ============================================================
    if (req.method === 'POST' && req.body.action === 'sync_google') {
      return await syncGoogle(db, null, realName);
    }

    return res.status(400).json({ error: 'Некорректный метод или действие.' });

  } catch (err) {
    console.error('SERVER ERROR LOG:', err);
    const errorMessage = err.message || 'Неизвестная ошибка сервера.';
    return res.status(500).json({ error: 'Ошибка: ' + errorMessage });
  }
};
