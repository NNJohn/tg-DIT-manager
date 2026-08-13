const crypto = require('crypto');

module.exports = async (req, res) => {
  // Настройка CORS для связи с GitHub Pages
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

  // Получаем список разрешенных ID из настроек Vercel
  const allowedUsers = (process.env.ALLOWED_USER_IDS || '').split(',').map(id => id.trim());

  if (!initData || !botToken) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  // 1. Валидация подписи Telegram (проверка, что данные не подделаны)
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

  // 2. Проверка личного Telegram ID пользователя
  const userParam = urlParams.get('user');
  if (!userParam) {
    return res.status(400).json({ error: 'Данные пользователя отсутствуют' });
  }

  const user = JSON.parse(userParam);

  // Проверяем, есть ли ID зашедшего человека в нашем списке в Vercel
  if (!allowedUsers.includes(String(user.id))) {
    return res.status(403).json({ error: 'Доступ ограничен. Вашего Telegram ID нет в белом списке.' });
  }

  // Если пользователь прошел проверку
  return res.status(200).json({ success: true });
};
