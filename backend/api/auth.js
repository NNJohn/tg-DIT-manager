const crypto = require('crypto');

module.exports = async (req, res) => {

  // ==========================================================
  // CORS
  // ==========================================================

  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS'
  );


  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }


  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({
        error: 'Method not allowed'
      });
  }


  try {

    // ========================================================
    // Environment variables
    // ========================================================

    const botToken =
      process.env.BOT_TOKEN;

    const allowedUsers =
      (process.env.ALLOWED_USER_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);


    if (!botToken) {

      console.error(
        'BOT_TOKEN is not configured'
      );

      return res
        .status(500)
        .json({
          error:
            'Сервер авторизации не настроен.'
        });
    }


    // ========================================================
    // Получаем initData
    // ========================================================

    const initData =
      req.body && req.body.initData;


    if (!initData) {

      return res
        .status(400)
        .json({
          error:
            'Данные Telegram отсутствуют.'
        });
    }


    // ========================================================
    // Telegram HMAC validation
    // ========================================================

    const urlParams =
      new URLSearchParams(initData);


    const receivedHash =
      urlParams.get('hash');


    if (!receivedHash) {

      return res
        .status(401)
        .json({
          error:
            'Подпись Telegram отсутствует.'
        });
    }


    // Удаляем hash перед созданием data-check-string
    urlParams.delete('hash');


    const dataCheckString =
      Array.from(urlParams.entries())
        .sort(([keyA], [keyB]) =>
          keyA.localeCompare(keyB)
        )
        .map(([key, value]) =>
          `${key}=${value}`
        )
        .join('\n');


    // Секретный ключ Telegram Web Apps
    const secretKey =
      crypto
        .createHmac(
          'sha256',
          'WebAppData'
        )
        .update(botToken)
        .digest();


    const calculatedHash =
      crypto
        .createHmac(
          'sha256',
          secretKey
        )
        .update(dataCheckString)
        .digest('hex');


    // ========================================================
    // Сравниваем подписи
    // ========================================================

    const receivedHashBuffer =
      Buffer.from(receivedHash, 'hex');

    const calculatedHashBuffer =
      Buffer.from(calculatedHash, 'hex');


    if (
      receivedHashBuffer.length !==
      calculatedHashBuffer.length ||
      !crypto.timingSafeEqual(
        receivedHashBuffer,
        calculatedHashBuffer
      )
    ) {

      console.error(
        'Telegram HMAC validation failed'
      );

      return res
        .status(401)
        .json({
          error:
            'Криптографическая проверка не пройдена.'
        });
    }


    // ========================================================
    // Получаем пользователя
    // ========================================================

    const userParam =
      urlParams.get('user');


    if (!userParam) {

      return res
        .status(400)
        .json({
          error:
            'Данные пользователя отсутствуют в сессии.'
        });
    }


    let user;


    try {

      user =
        JSON.parse(userParam);

    } catch (error) {

      return res
        .status(400)
        .json({
          error:
            'Некорректные данные пользователя.'
        });
    }


    if (!user || !user.id) {

      return res
        .status(400)
        .json({
          error:
            'Telegram ID пользователя отсутствует.'
        });
    }


    // ========================================================
    // Whitelist
    // ========================================================

    const telegramUserId =
      String(user.id);


    if (
      !allowedUsers.includes(
        telegramUserId
      )
    ) {

      console.log(
        'Access denied for Telegram ID:',
        telegramUserId
      );

      return res
        .status(403)
        .json({
          error:
            'Доступ ограничен. Вашего Telegram ID нет в белом списке.'
        });
    }


    // ========================================================
    // Пользователь авторизован
    // ========================================================

    const realName =
      user.first_name ||
      user.username ||
      'Участник чата';


    console.log(
      'Access granted:',
      telegramUserId,
      realName
    );


    return res
      .status(200)
      .json({

        success: true,

        userName: realName

      });


  } catch (error) {

    console.error(
      'Auth API error:',
      error
    );

    return res
      .status(500)
      .json({
        error:
          'Внутренняя ошибка сервера авторизации.'
      });
  }
};