const crypto = require('crypto');

// ID вашей разрешенной группы в Telegram (обычно начинается с -100)
// Замените на ID вашего чата или вынесите в переменные окружения
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID || "-100XXXXXXXXXX"; 

module.exports = async (req, res) => {
  // Разрешаем запросы с вашего GitHub Pages
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
  const botToken = process.env.BOT_TOKEN; // Токен бота из @BotFather

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

  // 2. Проверка контекста чата
  const chatParam = urlParams.get('chat');
  if (!chatParam) {
    return res.status(403).json({ error: 'Приложение должно быть запущено строго из рабочего чата' });
  }

  const chat = JSON.parse(chatParam);

  // Сверяем ID чата, из которого открыли, с вашим разрешенным ID
  if (String(chat.id) !== String(ALLOWED_CHAT_ID)) {
    return res.status(403).json({ error: 'Доступ из этого чата запрещен' });
  }

  // Если всё ок — отдаем статус успеха
  return res.status(200).json({ success: true });
};
