// api/lib.js — Общие утилиты для всех API-маршрутов

// ============================================================
// Кэш MongoDB подключений (Serverless Vercel)
// ============================================================
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }
  const { MongoClient } = require('mongodb');
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

// ============================================================
// Справочники
// ============================================================
const STATUS_LABELS = {
  todo: 'Беклог',
  progress: 'В работе',
  blocked: 'Блок',
  done: 'Выполнено',
  cancelled: 'Отменено'
};

const PRIORITY_LABELS = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический'
};

// ============================================================
// Утилиты форматирования
// ============================================================
function formatDueDate(deadline) {
  if (!deadline || deadline === '—') return '';
  const isoDate = String(deadline).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return isoDate ? `${isoDate[3]}.${isoDate[2]}.${isoDate[1]}` : deadline;
}

function formatMemberLabel(member) {
  if (member.displayName) return member.displayName;
  const telegramName = [member.telegramFirstName, member.telegramLastName].filter(Boolean).join(' ');
  return member.telegramUsername
    ? `${telegramName || 'Пользователь'} · @${member.telegramUsername}`
    : telegramName || 'Пользователь';
}

function resolveMemberLabel(member, teamMembers) {
  if (!member.displayName) {
    const telegramName = [member.telegramFirstName, member.telegramLastName].filter(Boolean).join(' ');
    return member.telegramUsername
      ? `${telegramName || 'Пользователь'} · @${member.telegramUsername}`
      : telegramName || 'Пользователь';
  }
  return member.displayName;
}

function formatUserWhitelistName(member) {
  // Если displayName уже установлен — используем его целиком
  if (member.displayName) return member.displayName;
  // Иначе собираем из Telegram-имени
  const name = [member.telegramFirstName, member.telegramLastName].filter(Boolean).join(' ');
  return name || `Сотрудник ${member.telegramId}`;
}

module.exports = {
  connectToDatabase,
  STATUS_LABELS,
  PRIORITY_LABELS,
  formatDueDate,
  formatMemberLabel,
  resolveMemberLabel,
  formatUserWhitelistName
};
