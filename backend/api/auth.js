const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { initData } = req.body;
  const botToken = process.env.BOT_TOKEN;
  const allowedUsers = (process.env.ALLOWED_USER_IDS || '').split(',').map(id => id.trim());

  if (!initData || !botToken) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  // 1. Валидация подписи Telegram
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  
  urlParams.delete('hash');
  const dataCheckString = Array.from(urlParams.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (hmac !== hash) {
    return res.status(401).json({ error: 'Криптографическая проверка не пройдена' });
  }

  // 2. Безопасное извлечение данных пользователя на бэкенде
  const userParam = urlParams.get('user');
  if (!userParam) {
    return res.status(400).json({ error: 'Данные пользователя отсутствуют в сессии' });
  }

  const user = JSON.parse(userParam);

  // 3. Проверка белого списка по ID
  if (!allowedUsers.includes(String(user.id))) {
    return res.status(403).json({ error: 'Доступ ограничен. Вашего Telegram ID нет в белом списке.' });
  }

  // Собираем имя (берем First Name, если нет Username)
  const realName = user.first_name || user.username || "Участник чата";

  // Возвращаем фронтенду статус успеха и реальное имя пользователя
  return res.status(200).json({ 
    success: true, 
    userName: realName 
  });
};
