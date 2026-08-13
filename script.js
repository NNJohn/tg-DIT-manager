// Pocket Jira — Telegram Mini App Logic
// ============================================================
const API_URL = '/api/auth';
let tasks = [];
let currentUserName = 'Пользователь';

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

      const taskAuthor = document.createElement('div');
      taskAuthor.className = 'task-meta';
      taskAuthor.innerText = 'От: ' + task.author + ' | Исполнитель: ' + (task.executor || '—');

      const taskDeadline = document.createElement('div');
      taskDeadline.className = 'task-meta';
      taskDeadline.innerText = 'Срок: ' + (task.deadline || '—');

      card.appendChild(taskText);
      card.appendChild(taskAuthor);
      card.appendChild(taskDeadline);
      listElement.appendChild(card);
    });
  }
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
function exportToExcel() {
  const dataToExport = tasks.map(function(task) {
    return {
      'ID Задачи': task.id,
      'Статус':
        task.status === 'todo'
          ? 'Надо сделать'
          : task.status === 'progress'
            ? 'В работе'
            : 'Готово',
      'Текст задачи': task.text,
      'Автор': task.author,
      'Исполнитель': task.executor || 'Не назначен',
      'Срок выполнения': task.deadline || 'Не указан',
      'Приоритет': task.priority.toUpperCase()
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(dataToExport);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Задачи');
  XLSX.writeFile(workbook, 'kanban_tasks.xlsx');
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
