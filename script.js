// Pocket Jira — Telegram Mini App Logic
// ============================================================
const API_URL = '/api/auth';
let tasks = [];
let currentUserName = 'Пользователь';
let isDeveloper = false;

const tg =
  window.Telegram && window.Telegram.WebApp
    ? window.Telegram.WebApp
    : null;

// ============================================================
// UI Функции управления экранами
// ============================================================
function showError(title, message) {
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-status-screen').style.display = 'block';
  document.getElementById('status-title').innerText = title;
  document.getElementById('status-desc').innerText = message;
}

function showApp() {
  document.getElementById('auth-status-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-greeting').innerText =
    'Привет, ' + currentUserName + '!';
}

// ============================================================
// Динамическое наполнение списка исполнителей из Вайтлиста
// ============================================================
function populateExecutors(usersWhitelist) {
  const selectEl = document.getElementById('form-executor');
  if (!selectEl) return;

  // Очищаем старые опции и ставим базовый вариант
  selectEl.innerHTML = '<option value="">— Без исполнителя —</option>';

  // 1. Первой строчкой всегда добавляем текущую сессию пользователя (Вас)
  const meOption = document.createElement('option');
  meOption.value = currentUserName;
  meOption.innerText = currentUserName + " (Это вы)";
  selectEl.appendChild(meOption);

  // 2. Следом добавляем остальных участников из вайтлиста бэкенда
  if (usersWhitelist && Array.isArray(usersWhitelist)) {
    usersWhitelist.forEach(function(userId) {
      // Исключаем дублирование вас в списке по ID, если бэкенд его вернул
      if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && String(tg.initDataUnsafe.user.id) === String(userId)) {
        return;
      }
      
      const option = document.createElement('option');
      option.value = "Сотрудник [" + userId + "]";
      option.innerText = "Сотрудник [" + userId + "]";
      selectEl.appendChild(option);
    });
  }
}

// ============================================================
// Интеграция цветовой темы Telegram
// ============================================================
function applyTelegramTheme() {
  if (!tg || !tg.themeParams) {
    return;
  }
  const getParam = (name, fallback) => {
    return tg.themeParams[name] || fallback;
  };
  document.documentElement.style.setProperty(
    '--tg-theme-bg-color',
    getParam('bg_color', '#ffffff')
  );
  document.documentElement.style.setProperty(
    '--tg-theme-text-color',
    getParam('text_color', '#000000')
  );
  document.documentElement.style.setProperty(
    '--tg-theme-hint-color',
    getParam('hint_color', '#707579')
  );
  document.documentElement.style.setProperty(
    '--tg-theme-button-color',
    getParam('button_color', '#2481cc')
  );
  document.documentElement.style.setProperty(
    '--tg-theme-button-text-color',
    getParam('button_text_color', '#ffffff')
  );
  document.documentElement.style.setProperty(
    '--tg-theme-secondary-bg-color',
    getParam('secondary_bg_color', '#f4f4f5')
  );
}

function getTelegramUser() {
  if (!tg || !tg.initDataUnsafe) {
    return null;
  }
  return tg.initDataUnsafe.user || null;
}

// ============================================================
// Авторизация и получение данных
// ============================================================
async function authorize() {
  if (!tg) {
    showError(
      'Telegram не найден',
      'Приложение должно быть открыто внутри Telegram.'
    );
    return false;
  }
  if (!tg.initData) {
    showError(
      'Нет данных Telegram',
      'Telegram не передал данные авторизации.'
    );
    return false;
  }

  document.getElementById('status-title').innerText = 'Проверка прав доступа...';
  document.getElementById('status-desc').innerText = 'Проверяем ваш Telegram ID.';

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        initData: tg.initData,
        action: 'login' // Сообщаем бэкенду, что это стартовый вход
      })
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      throw new Error(
        'Сервер вернул некорректный ответ. HTTP ' + response.status
      );
    }

    if (!response.ok || !result.success) {
      showError(
        'Доступ ограничен',
        result.error || 'Ваш Telegram ID отсутствует в белом списке.'
      );
      return false;
    }

    if (result.userName) {
      currentUserName = result.userName;
    }

    // Сохраняем полученные из MongoDB задачи в локальный массив
    tasks = result.tasks || [];

    // Динамически строим список исполнителей на основе вайтлиста Vercel
    populateExecutors(result.usersWhitelist);

    isDeveloper = Boolean(result.isDeveloper);
    if (isDeveloper) {
      document.getElementById('devtools').hidden = false;
      loadTeamMembers();
    }

    // Рендерим доску и открываем приложение
    renderBoard();
    showApp();
    return true;
  } catch (error) {
    console.error('AUTH ERROR:', error);
    showError(
      'Ошибка авторизации',
      error.message || 'Не удалось выполнить авторизацию.'
    );
    return false;
  }
}

// ============================================================
// Отрисовка Канбан-доски
// ============================================================
function renderBoard() {
  const columns = {
    todo: [],
    progress: [],
    done: []
  };

  tasks.forEach(function(task) {
    if (columns[task.status]) {
      columns[task.status].push(task);
    }
  });

  for (const status in columns) {
    const listElement = document.getElementById(status);
    if (!listElement) {
      continue;
    }
    listElement.innerHTML = '';

    columns[status].forEach(function(task) {
      const card = document.createElement('div');
      card.className = 'task-card priority-' + task.priority;
      card.draggable = true;
      card.ondragstart = function(event) {
        event.dataTransfer.setData('text/plain', task.id);
      };

      const taskText = document.createElement('div');
      taskText.className = 'task-text';
      taskText.innerText = task.text;

      const taskDelete = document.createElement('button');
      taskDelete.className = 'task-delete';
      taskDelete.type = 'button';
      taskDelete.title = 'Удалить задачу';
      taskDelete.setAttribute('aria-label', 'Удалить задачу');
      taskDelete.innerText = '×';
      taskDelete.draggable = false;
      taskDelete.onclick = function(event) {
        event.stopPropagation();
        deleteTask(task.id, taskDelete);
      };

      const taskHeader = document.createElement('div');
      taskHeader.className = 'task-header';
      taskHeader.appendChild(taskText);
      taskHeader.appendChild(taskDelete);

      const taskAuthor = document.createElement('div');
      taskAuthor.className = 'task-meta';
      taskAuthor.innerText = 'От: ' + task.author + ' | Исполнитель: ' + (task.executor || '—');

      const taskDeadline = document.createElement('div');
      taskDeadline.className = 'task-meta';
      taskDeadline.innerText = 'Срок: ' + (task.deadline || '—');

      card.appendChild(taskHeader);
      card.appendChild(taskAuthor);
      card.appendChild(taskDeadline);
      listElement.appendChild(card);
    });
  }
}

// ============================================================
// DevTools — справочник команды и приглашения для Telegram-бота
// ============================================================
async function devRequest(action, payload) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ initData: tg.initData, action: action }, payload || {}))
  });
  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Не удалось выполнить действие DevTools.');
  }
  return result;
}

function getMemberTelegramName(member) {
  const fullName = [member.telegramFirstName, member.telegramLastName].filter(Boolean).join(' ');
  const username = member.telegramUsername ? ' @' + member.telegramUsername : '';
  return (fullName || 'Пользователь') + username;
}

function renderTeamMembers(members) {
  const list = document.getElementById('team-members');
  list.innerHTML = '';

  if (!members.length) {
    list.innerText = 'Пока никто не зарегистрировался через бота.';
    return;
  }

  members.forEach(function(member) {
    const card = document.createElement('div');
    card.className = 'member-card';

    const info = document.createElement('div');
    info.className = 'task-meta';
    info.innerText = getMemberTelegramName(member) + ' · ID ' + member.telegramId;

    const displayName = document.createElement('input');
    displayName.id = 'member-display-' + member.telegramId;
    displayName.type = 'text';
    displayName.maxLength = 100;
    displayName.placeholder = 'Отображаемое имя для экспорта';
    displayName.value = member.displayName || '';

    const team = document.createElement('input');
    team.id = 'member-team-' + member.telegramId;
    team.type = 'text';
    team.maxLength = 100;
    team.placeholder = 'Команда или роль (необязательно)';
    team.value = member.team || '';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.innerText = 'Сохранить';
    saveButton.onclick = function() {
      saveTeamMember(member.telegramId, saveButton);
    };

    card.appendChild(info);
    card.appendChild(displayName);
    card.appendChild(team);
    card.appendChild(saveButton);
    list.appendChild(card);
  });
}

async function loadTeamMembers() {
  if (!isDeveloper) return;

  const list = document.getElementById('team-members');
  list.innerText = 'Загрузка справочника…';
  try {
    const result = await devRequest('list_team_members');
    renderTeamMembers(result.members || []);
  } catch (error) {
    list.innerText = error.message || 'Не удалось загрузить справочник.';
  }
}

async function createInvite() {
  const output = document.getElementById('invite-output');
  output.innerText = 'Создаём приглашение…';

  try {
    const result = await devRequest('create_invite');
    if (!result.inviteLink) {
      output.innerText = 'Укажите BOT_USERNAME в переменных Vercel, чтобы получить ссылку-приглашение.';
      return;
    }

    output.innerText = result.inviteLink + '\nДействует до ' + new Date(result.expiresAt).toLocaleString('ru-RU') + '.';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(result.inviteLink);
        output.innerText += ' Ссылка скопирована.';
      } catch (copyError) {
        console.warn('Не удалось скопировать приглашение:', copyError);
      }
    }
  } catch (error) {
    output.innerText = error.message || 'Не удалось создать приглашение.';
  }
}

async function saveTeamMember(telegramId, button) {
  const displayName = document.getElementById('member-display-' + telegramId).value;
  const team = document.getElementById('member-team-' + telegramId).value;
  const originalText = button.innerText;
  button.disabled = true;
  button.innerText = 'Сохраняем…';

  try {
    await devRequest('update_team_member', {
      member: { telegramId: telegramId, displayName: displayName, team: team }
    });
    button.innerText = 'Сохранено';
    setTimeout(function() {
      button.innerText = originalText;
      button.disabled = false;
    }, 1200);
  } catch (error) {
    button.disabled = false;
    button.innerText = originalText;
    alert(error.message || 'Не удалось сохранить пользователя.');
  }
}

// ============================================================
// Удаление задачи
// ============================================================
function askForDeletion(callback) {
  if (tg && typeof tg.showConfirm === 'function') {
    tg.showConfirm('Удалить эту задачу без возможности восстановления?', callback);
    return;
  }

  callback(window.confirm('Удалить эту задачу без возможности восстановления?'));
}

function deleteTask(taskId, button) {
  askForDeletion(async function(confirmed) {
    if (!confirmed) return;

    button.disabled = true;
    button.innerText = '…';

    try {
      const response = await fetch(API_URL, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData, taskId: taskId })
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Не удалось удалить задачу.');
      }

      tasks = tasks.filter(function(task) {
        return task.id !== taskId;
      });
      renderBoard();
    } catch (error) {
      button.disabled = false;
      button.innerText = '×';
      console.error('Ошибка удаления задачи:', error);
      if (tg && typeof tg.showAlert === 'function') {
        tg.showAlert(error.message || 'Не удалось удалить задачу.');
      } else {
        alert(error.message || 'Не удалось удалить задачу.');
      }
    }
  });
}

// ============================================================
// Создание задачи и отправка в MongoDB
// ============================================================
function toggleForm() {
  const form = document.getElementById('task-form');
  form.style.display = form.style.display === 'flex' ? 'none' : 'flex';
}

async function addTask() {
  const text = document.getElementById('form-text').value.trim();
  // Считываем выбранное значение из выпадающего списка select
  const executor = document.getElementById('form-executor').value;
  const deadline = document.getElementById('form-deadline').value;
  const priority = document.getElementById('form-priority').value;

  if (!text) {
    return;
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData,
        action: 'create', // Сигнал бэкенду на запись в базу
        task: { text: text, executor: executor, deadline: deadline, priority: priority }
      })
    });
    
    const result = await response.json();
    if (response.ok && result.success) {
      // Добавляем созданную сервером задачу в массив и перерисовываем
      tasks.push(result.task);
      renderBoard();
      toggleForm();
      
      // Сброс полей
      document.getElementById('form-text').value = '';
      document.getElementById('form-deadline').value = '';
    }
  } catch (e) {
    console.error('Ошибка создания задачи:', e);
  }
}

// ============================================================
// Drag & Drop (Перетаскивание карточек с обновлением в MongoDB)
// ============================================================
function allowDrop(event) {
  event.preventDefault();
}

async function drop(event, newStatus) {
  event.preventDefault();
  const taskId = event.dataTransfer.getData('text/plain');
  const task = tasks.find(function(item) {
    return item.id === taskId;
  });

  if (!task) {
    return;
  }

  const oldStatus = task.status;
  task.status = newStatus;
  renderBoard();

  try {
    // Отправляем PUT запрос на Vercel для перезаписи статуса в MongoDB
    const response = await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData,
        taskId: taskId,
        newStatus: newStatus
      })
    });
    if (!response.ok) throw new Error();
  } catch (err) {
    // Если сеть прервалась — возвращаем карточку на исходное место
    task.status = oldStatus;
    renderBoard();
    console.error('Не удалось сохранить статус на сервере:', err);
  }
}
// ============================================================
// Excel Экспорт (SheetJS)
// ============================================================
async function exportToExcel() {
  if (!tg) return;

  // Меням текст на кнопке, чтобы пользователь видел статус
  const excelBtn = document.querySelector("button[onclick='exportToExcel()']");
  if (excelBtn) excelBtn.innerText = "Синхронизация...";

  try {
    var response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData,
        action: 'sync_google' // Отправляем команду на бэкенд
      })
    });

    var result = await response.json();
    if (response.ok && result.success) {
      tg.showPopup({
        title: 'Успешно',
        message: 'Данные в Google Drive синхронизированы! Откройте вашу закрепленную таблицу.',
        buttons: [{ type: 'ok' }]
      });
    } else {
      alert(result.error || "Сбой синхронизации");
    }
  } catch (e) {
    alert("Ошибка соединения с сервером.");
  } finally {
    if (excelBtn) excelBtn.innerText = "Excel";
  }
}

// ============================================================
// Точка входа Инициализации
// ============================================================
async function initApplication() {
  console.log('Pocket Jira: initApplication()');
  if (!tg) {
    showError(
      'Откройте приложение в Telegram',
      'Pocket Jira должен запускаться через Telegram Mini App.'
    );
    return;
  }
  
  applyTelegramTheme();

  const telegramUser = getTelegramUser();
  if (telegramUser) {
    currentUserName =
      telegramUser.first_name ||
      telegramUser.username ||
      'Пользователь';
  }

  // Запуск процесса авторизации и загрузки базы данных
  await authorize();
}

initApplication();
