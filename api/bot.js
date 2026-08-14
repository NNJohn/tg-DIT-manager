const crypto = require('crypto');
const { MongoClient } = require('mongodb');

let cachedDb = null;
let indexesReady = false;

async function getDb() {
  if (cachedDb) return cachedDb;

  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000
  });
  await client.connect();
  cachedDb = client.db('pocket_jira');
  return cachedDb;
}

async function ensureIndexes(db) {
  if (indexesReady) return;
  await Promise.all([
    db.collection('team_members').createIndex({ telegramId: 1 }, { unique: true }),
    db.collection('bot_invites').createIndex({ token: 1 }, { unique: true }),
    db.collection('bot_invites').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]);
  indexesReady = true;
}

function hasValidSecret(requestSecret, configuredSecret) {
  if (!requestSecret || !configuredSecret) return false;
  const requestBuffer = Buffer.from(requestSecret);
  const configuredBuffer = Buffer.from(configuredSecret);
  return requestBuffer.length === configuredBuffer.length && crypto.timingSafeEqual(requestBuffer, configuredBuffer);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const requestSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (!hasValidSecret(requestSecret, process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return res.status(401).end();
  }

  const message = req.body && req.body.message;
  if (!message || !message.from || !message.chat || message.chat.id !== message.from.id || typeof message.text !== 'string') {
    return res.status(200).end();
  }

  const startMatch = message.text.trim().match(/^\/start(?:@\w+)?(?:\s+(join_[A-Za-z0-9_-]{16,58}))?$/);
  if (!startMatch || !startMatch[1]) {
    return res.status(200).end();
  }

  try {
    const db = await getDb();
    await ensureIndexes(db);

    const now = new Date();
    const invitation = await db.collection('bot_invites').findOneAndUpdate(
      { token: startMatch[1], expiresAt: { $gt: now }, usedAt: { $exists: false } },
      { $set: { usedAt: now, usedById: String(message.from.id) } },
      { returnDocument: 'after' }
    );

    if (!invitation) return res.status(200).end();

    const telegramUser = message.from;
    await db.collection('team_members').updateOne(
      { telegramId: String(telegramUser.id) },
      {
        $setOnInsert: { telegramId: String(telegramUser.id), registeredAt: now },
        $set: {
          telegramFirstName: telegramUser.first_name || '',
          telegramLastName: telegramUser.last_name || '',
          telegramUsername: telegramUser.username || '',
          lastSeenAt: now,
          updatedAt: now
        }
      },
      { upsert: true }
    );

    return res.status(200).end();
  } catch (error) {
    console.error('BOT WEBHOOK ERROR:', error);
    return res.status(500).end();
  }
};
