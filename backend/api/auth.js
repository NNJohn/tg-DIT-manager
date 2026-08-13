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

  // Считываем списки разрешенных ID из настроек Vercel (разделенные запятыми)
  const allowedChats = (process.env.ALLOWED_CHAT_IDS || '').split(',').map(id => id.trim());
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

  // Получаем данные пользователя и контекст чата
  const chatParam = urlParams.get('chat');
  const userParam = urlParams.get('user');
  
  const user = userParam ? JSON.parse(userParam) : null;
  const chat = chatParam ? JSON.parse(chatParam) : null;

  // 2. Логика проверки белого списка (Пропускаем, если совпал чат ИЛИ если пользователь в списке)
  let isAccessGranted = false;

  // Проверка по ID чата (если запуск из группы)
  if (chat && allowedChats.includes(String(chat.id))) {
    isAccessGranted = true;
  }

  // Проверка по личному ID пользователя (если запуск из лички/профиля)
  if (user && allowedUsers.includes(String(user.id))) {
    isAccessGranted = true;
  }

  if (!isAccessGranted) {
    return res.status(403).json({ error: 'Доступ ограничен. Вас или вашего чата нет в белом списке.' });
  }

  return res.status(200).json({ success: true });
};
