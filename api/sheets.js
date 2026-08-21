// api/sheets.js — Google Sheets экспорт и синхронизация

const { google } = require('googleapis');
const { STATUS_LABELS, PRIORITY_LABELS, formatDueDate } = require('./lib');

// ============================================================
// Утилиты Google
// ============================================================
function normalizePrivateKey(key) {
  if (!key) return null;
  let normalized = key.trim().replace(/^["']|["']$/g, '');
  if (normalized.includes('\\n')) {
    normalized = normalized.replace(/\\n/g, '\n');
  } else if (normalized.includes('\n')) {
    normalized = normalized.split(/\r?\n/).join('\n');
  }
  return normalized;
}

function getSheetsAuth() {
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  if (!privateKey) throw new Error('GOOGLE_PRIVATE_KEY не настроен');
  if (!process.env.GOOGLE_SPREADSHEET_ID) throw new Error('GOOGLE_SPREADSHEET_ID не настроен');

  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return { auth, spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID };
}

// ============================================================
// Sync: MongoDB <-> Google Sheets (двусторонняя)
// ============================================================
async function syncGoogle(db, tasks, realName) {
  const { auth, spreadsheetId } = getSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const collection = db.collection('tasks');

  const dbTasks = tasks || await collection.find({}).toArray();

  const spreadsheetInfo = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(title,sheetId),tables(tableId,range,columnProperties))'
  });
  const sheetsList = spreadsheetInfo.data.sheets || [];

  const targetSheetData = sheetsList.find(s => s.properties.title === 'Открытые Вопросы') || sheetsList[0];
  if (!targetSheetData) {
    return { success: true, message: 'Таблица пуста' };
  }

  const sheetName = targetSheetData.properties.title;
  const sheetId = targetSheetData.properties.sheetId;
  const sheetTable = (targetSheetData.tables || [])[0] || null;

  // ---- ОБРАТНАЯ СИНХРОНИЗАЦИЯ: Sheets → MongoDB ----
  const sheetResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:I`
  });
  const sheetRows = sheetResponse.data.values || [];

  const fromSheet = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    if (!row || !row[0] || !String(row[0]).trim()) continue;

    fromSheet.push({
      sheetId: row[7] ? String(row[7]).trim() : '',
      lastModified: row[8] ? String(row[8]).trim() : '',
      text: String(row[0]).trim(),
      status: Object.keys(STATUS_LABELS).find(k => STATUS_LABELS[k] === (row[1] || 'Беклог')) || 'todo',
      author: row[2] || '',
      executor: row[3] || '—',
      deadline: row[4] || '—',
      priority: Object.keys(PRIORITY_LABELS).find(k => PRIORITY_LABELS[k] === (row[5] || 'Средний')) || 'medium',
      notes: row[6] ? String(row[6]).trim() : ''
    });
  }

  const dbIdMap = {};
  dbTasks.forEach(t => { dbIdMap[t.id] = t; });

  const toInsert = [];
  const toUpdate = {};

  for (const sheetTask of fromSheet) {
    let existing = null;
    if (sheetTask.sheetId) {
      existing = dbIdMap[sheetTask.sheetId];
    }
    if (!existing && !sheetTask.sheetId) {
      existing = dbTasks.find(t => t.text === sheetTask.text);
    }
    if (existing && !sheetTask.sheetId) {
      const newId = 'task_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
      toUpdate[existing.id] = Object.assign(toUpdate[existing.id] || {}, { id: newId });
    }

    if (!existing) {
      const newId = sheetTask.sheetId || ('task_' + Date.now().toString() + Math.random().toString(36).substr(2, 9));
      toInsert.push({
        id: newId,
        status: sheetTask.status,
        text: sheetTask.text,
        author: sheetTask.author || realName,
        executor: sheetTask.executor || '—',
        deadline: sheetTask.deadline,
        priority: sheetTask.priority,
        notes: sheetTask.notes,
        createdAt: new Date()
      });
    } else {
      const sheetLastModified = sheetTask.lastModified ? new Date(sheetTask.lastModified) : null;
      const dbLastModified = existing.lastModified ? new Date(existing.lastModified) : existing.createdAt;
      if (sheetLastModified && sheetLastModified >= dbLastModified) {
        toUpdate[existing.id] = {
          text: sheetTask.text,
          author: sheetTask.author,
          executor: sheetTask.executor,
          deadline: sheetTask.deadline,
          priority: sheetTask.priority,
          notes: sheetTask.notes,
          lastModified: new Date()
        };
      }
    }
  }

  let insertedCount = 0;
  let updatedCount = 0;

  for (const [id, fields] of Object.entries(toUpdate)) {
    await collection.updateOne({ id }, { $set: fields });
    updatedCount++;
  }

  if (toInsert.length > 0) {
    await collection.insertMany(toInsert);
    insertedCount = toInsert.length;
  }

  const currentDbTasks = await collection.find({}).toArray();

  // ---- ПРЯМОЙ ЭКСПОРТ: MongoDB → Sheets ----
  const rows = [];
  currentDbTasks.forEach(t => {
    rows.push([
      t.text,
      STATUS_LABELS[t.status] || 'Беклог',
      t.author,
      t.executor || '—',
      formatDueDate(t.deadline),
      PRIORITY_LABELS[t.priority] || 'Средний',
      t.notes || '',
      t.id || '',
      t.lastModified ? t.lastModified.toISOString() : ''
    ]);
  });

  const teamMembers = await db.collection('team_members')
    .find({}, { projection: { _id: 0, telegramId: 1, displayName: 1, telegramFirstName: 1, telegramLastName: 1, telegramUsername: 1 } })
    .toArray();

  const formatMemberLabel = (member) => {
    if (member.displayName) return member.displayName;
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

  const memberOptions = Array.from(new Set([
    '—',
    ...teamMembers.map(formatMemberLabel),
    ...currentDbTasks.flatMap(t => [t.author, t.executor]).filter(v => v && v !== '—')
  ]));

  // Записываем задачи
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A2:I1000`
  });

  if (rows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A2`,
      valueInputOption: 'RAW',
      resource: { values: rows }
    });
  }

  // Обновляем валидацию (dropdowns)
  const validationRequests = sheetTable
    ? buildTableValidationRequests(sheetTable, sheetId, STATUS_LABELS, PRIORITY_LABELS, memberOptions, rows.length)
    : buildLegacyValidationRequests(sheetId, STATUS_LABELS, PRIORITY_LABELS, memberOptions);

  if (validationRequests.length) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests: validationRequests }
      });
    } catch (validationErr) {
      if (!sheetTable) throw validationErr;
      console.warn('Google Sheets table metadata update skipped:', validationErr.message);
    }
  }

  return {
    success: true,
    syncStats: {
      inserted: insertedCount,
      updated: updatedCount,
      totalTasks: dbTasks.length
    }
  };
}

// ============================================================
// Helper: Dropdown rules for tables and legacy
// ============================================================
function buildTableValidationRequests(sheetTable, sheetId, statusLabels, priorityLabels, memberOptions, rowCount) {
  if (!sheetTable) return [];

  const dropdownOptionsByColumnName = {
    'Статус': Object.values(statusLabels),
    'Автор': memberOptions,
    'Исполнитель': memberOptions,
    'Приоритет': Object.values(priorityLabels)
  };

  const dropdownOptionsByColumnIndex = {
    1: Object.values(statusLabels),
    2: memberOptions,
    3: memberOptions,
    5: Object.values(priorityLabels)
  };

  const updatedColumnProperties = (sheetTable.columnProperties || [])
    .filter(col => col.columnType === 'DROPDOWN')
    .map(column => {
      const options = dropdownOptionsByColumnName[column.columnName] ?? dropdownOptionsByColumnIndex[column.columnIndex];
      if (!options) return null;
      return {
        columnIndex: column.columnIndex,
        columnType: 'DROPDOWN',
        dataValidationRule: { condition: { type: 'ONE_OF_LIST', values: options.map(v => ({ userEnteredValue: v })) } }
      };
    })
    .filter(Boolean);

  const requests = [];

  if (updatedColumnProperties.length) {
    requests.push({
      updateTable: {
        table: { tableId: sheetTable.tableId, columnProperties: updatedColumnProperties },
        fields: 'columnProperties'
      }
    });
  }

  const requiredEndRow = 1 + rowCount;
  const currentRange = sheetTable.range || {};
  if ((currentRange.endRowIndex || 0) < requiredEndRow) {
    requests.push({
      updateTable: {
        table: {
          tableId: sheetTable.tableId,
          range: {
            sheetId: sheetId,
            startRowIndex: currentRange.startRowIndex ?? 0,
            endRowIndex: requiredEndRow,
            startColumnIndex: currentRange.startColumnIndex ?? 0,
            endColumnIndex: currentRange.endColumnIndex ?? 8
          }
        },
        fields: 'range'
      }
    });
  }

  return requests;
}

function buildLegacyValidationRequests(sheetId, statusLabels, priorityLabels, memberOptions) {
  return [
    {
      setDataValidation: {
        range: { sheetId: sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 1, endColumnIndex: 2 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: Object.values(statusLabels).map(v => ({ userEnteredValue: v })) },
          strict: true,
          showCustomUi: true,
          inputMessage: 'Выберите статус задачи.'
        }
      }
    },
    {
      setDataValidation: {
        range: { sheetId: sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 3 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: memberOptions.map(v => ({ userEnteredValue: v })) },
          strict: true,
          showCustomUi: true,
          inputMessage: 'Выберите автора из справочника.'
        }
      }
    },
    {
      setDataValidation: {
        range: { sheetId: sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: memberOptions.map(v => ({ userEnteredValue: v })) },
          strict: true,
          showCustomUi: true,
          inputMessage: 'Выберите исполнителя из справочника.'
        }
      }
    },
    {
      setDataValidation: {
        range: { sheetId: sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 5, endColumnIndex: 6 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: Object.values(priorityLabels).map(v => ({ userEnteredValue: v })) },
          strict: true,
          showCustomUi: true,
          inputMessage: 'Выберите приоритет задачи.'
        }
      }
    }
  ];
}

// ============================================================
// Удаление задачи из Google Sheets
// ============================================================
async function deleteFromSheets(db, taskId) {
  try {
    const task = await db.collection('tasks').findOne({ id: taskId });
    if (!task) return;

    const { auth, spreadsheetId } = getSheetsAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const sheetsList = (await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(title))'
    })).data.sheets || [];

    const targetSheetName = sheetsList.find(s => s.properties.title === 'Открытые Вопросы') || sheetsList[0];
    if (!targetSheetName) return;

    const title = targetSheetName.properties.title;
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${title}!A:H`
    });
    const rows = sheetData.data.values || [];

    const filteredRows = rows.filter((row, index) => {
      if (index === 0) return true;
      if (!row || !row[0]) return false;
      return (row[7] || '').trim() !== task.id;
    });

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${title}!A2:H1000`
    });

    if (filteredRows.length > 1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${title}!A2`,
        valueInputOption: 'RAW',
        resource: { values: filteredRows.slice(1) }
      });
    }
  } catch (sheetErr) {
    console.warn('Не удалось удалить строку из Sheets:', sheetErr.message);
  }
}

module.exports = { syncGoogle, deleteFromSheets };
