// ============================================================
// Pocket Jira — Telegram Mini App
// ============================================================

const API_URL = '/api/auth';

// ============================================================
// Данные MVP
// ============================================================

let tasks = [
  {
    id: '1',
    status: 'todo',
    text: 'Запустить MVP бота',
    author: 'Система',
    executor: 'Команда',
    deadline: '2026-08-20',
    priority: 'high'
  },
  {
    id: '2',
    status: 'progress',
    text: 'Тестирование интерфейса',
    author: 'Иван',
    executor: 'Петр',
    deadline: '2026-08-15',
    priority: 'medium'
  }
];

let currentUserName = 'Пользователь';


// ============================================================
// Telegram
// ============================================================

const tg =
  window.Telegram && window.Telegram.WebApp
    ? window.Telegram.WebApp
    : null;


// ============================================================
// UI
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
// Telegram theme
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


// ============================================================
// Получение имени из Telegram
// ============================================================

function getTelegramUser() {
  if (!tg || !tg.initDataUnsafe) {
    return null;
  }

  return tg.initDataUnsafe.user || null;
}


// ============================================================
// Авторизация через Vercel
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

  document.getElementById('status-title').innerText =
    'Проверка прав доступа...';

  document.getElementById('status-desc').innerText =
    'Проверяем ваш Telegram ID.';


  try {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      initData: tg.initData
    })
  });

  const responseText = await response.text();

  console.log('AUTH STATUS:', response.status);
  console.log('AUTH RESPONSE:', responseText);

  let result;

  try {
    result = JSON.parse(responseText);
  } catch (e) {
    throw new Error(
      `Сервер вернул не JSON. HTTP ${response.status}. Ответ: ${responseText.substring(0, 300)}`
    );
  }

  if (!response.ok || !result.success) {
    showError(
      'Доступ ограничен',
      result.error ||
        `Ошибка авторизации. HTTP ${response.status}`
    );

    return false;
  }

  if (result.userName) {
    currentUserName = result.userName;
  }

  showApp();
  renderBoard();

  return true;

} catch (error) {

  console.error('AUTH ERROR:', error);

  showError(
    'ТЕСТОВАЯ ВЕРСИЯ',
    'НОВЫЙ SCRIPT.JS ЗАГРУЖЕН'
  );

  return false;
}

// ============================================================
// Kanban
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

    const listElement =
      document.getElementById(status);

    if (!listElement) {
      continue;
    }


    listElement.innerHTML = '';


    columns[status].forEach(function(task) {

      const card =
        document.createElement('div');

      card.className =
        'task-card priority-' + task.priority;

      card.draggable = true;


      card.ondragstart = function(event) {

        event.dataTransfer.setData(
          'text/plain',
          task.id
        );

      };


      const taskText =
        document.createElement('div');

      taskText.className = 'task-text';
      taskText.innerText = task.text;


      const taskAuthor =
        document.createElement('div');

      taskAuthor.className = 'task-meta';

      taskAuthor.innerText =
        'От: ' +
        task.author +
        ' | Исполнитель: ' +
        (task.executor || '—');


      const taskDeadline =
        document.createElement('div');

      taskDeadline.className = 'task-meta';

      taskDeadline.innerText =
        'Срок: ' +
        (task.deadline || '—');


      card.appendChild(taskText);
      card.appendChild(taskAuthor);
      card.appendChild(taskDeadline);

      listElement.appendChild(card);

    });

  }
}


// ============================================================
// Создание задачи
// ============================================================

function toggleForm() {

  const form =
    document.getElementById('task-form');

  form.style.display =
    form.style.display === 'flex'
      ? 'none'
      : 'flex';
}


function addTask() {

  const text =
    document.getElementById('form-text').value.trim();

  const executor =
    document.getElementById('form-executor').value.trim();

  const deadline =
    document.getElementById('form-deadline').value;

  const priority =
    document.getElementById('form-priority').value;


  if (!text) {
    return;
  }


  tasks.push({

    id: Date.now().toString(),

    status: 'todo',

    text: text,

    author: currentUserName,

    executor: executor,

    deadline: deadline,

    priority: priority

  });


  renderBoard();
  toggleForm();


  document.getElementById('form-text').value = '';
  document.getElementById('form-executor').value = '';
  document.getElementById('form-deadline').value = '';
}


// ============================================================
// Drag & Drop
// ============================================================

function allowDrop(event) {
  event.preventDefault();
}


function drop(event, newStatus) {

  event.preventDefault();


  const taskId =
    event.dataTransfer.getData('text/plain');


  const task =
    tasks.find(function(item) {
      return item.id === taskId;
    });


  if (!task) {
    return;
  }


  task.status = newStatus;

  renderBoard();
}


// ============================================================
// Excel
// ============================================================

function exportToExcel() {

  const dataToExport =
    tasks.map(function(task) {

      return {

        'ID Задачи':
          task.id,

        'Статус':
          task.status === 'todo'
            ? 'Надо сделать'
            : task.status === 'progress'
              ? 'В работе'
              : 'Готово',

        'Текст задачи':
          task.text,

        'Автор':
          task.author,

        'Исполнитель':
          task.executor || 'Не назначен',

        'Срок выполнения':
          task.deadline || 'Не указан',

        'Приоритет':
          task.priority.toUpperCase()

      };

    });


  const worksheet =
    XLSX.utils.json_to_sheet(dataToExport);

  const workbook =
    XLSX.utils.book_new();


  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    'Задачи'
  );


  XLSX.writeFile(
    workbook,
    'kanban_tasks.xlsx'
  );
}


// ============================================================
// Инициализация
// ============================================================

async function initApplication() {

  // Если файл случайно открыть напрямую в браузере,
  // не пытаемся проводить Telegram авторизацию.
  if (!tg) {

    showError(
      'Откройте приложение в Telegram',
      'Pocket Jira должен запускаться через Telegram Mini App.'
    );

    return;
  }


  // Telegram сообщает, что Mini App готов
  tg.ready();
  tg.expand();


  // Применяем тему Telegram
  applyTelegramTheme();


  // Сначала получаем имя локально.
  // Это не является авторизацией — только предварительное отображение.
  const telegramUser = getTelegramUser();

  if (telegramUser) {

    currentUserName =
      telegramUser.first_name ||
      telegramUser.username ||
      'Пользователь';

  }


  // Настоящая авторизация происходит на Vercel
  await authorize();
}


// Запуск
initApplication();