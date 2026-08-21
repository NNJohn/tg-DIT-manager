// Pocket Jira — Telegram Mini App Logic
// ============================================================
const API_URL = '/api/auth';
let tasks = [];
let currentUserName = 'Пользователь';
let isDeveloper = false;
let deadlineMode = 'date';
let editingTaskId = null;
let currentView = localStorage.getItem('viewMode') || 'board';
// Если сохранён 'list', сбросим на 'board' — доска всегда основная
if (currentView === 'list') {
  currentView = 'board';
  localStorage.removeItem('viewMode');
}

const tg =
  window.Telegram && window.Telegram.WebApp
    ? window.Telegram.WebApp
    : null;

function isIsoDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function formatDeadlineDisplay(deadline) {
  if (!deadline || deadline === '—') {
    return '—';
  }

  if (isIsoDateValue(deadline)) {
    const parts = deadline.split('-');
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }

  return deadline;
}

function getDeadlineLabel(deadline) {
  if (!deadline || deadline === '—') {
    return 'Срок';
  }

  return isIsoDateValue(deadline) ? 'Дата' : 'Спринт';
}

// ============================================================
// Режим отображения: Доска / Список
// ============================================================
function switchView(mode) {
  currentView = mode;
  localStorage.setItem('viewMode', mode);

  const board = document.querySelector('.board');
  const listView = document.getElementById('list-view');
  const boardBtn = document.getElementById('view-board');
  const listBtn = document.getElementById('view-list');

  if (mode === 'list') {
    if (board) board.classList.add('hidden');
    if (listView) {
      listView.classList.add('active');
      renderListView();
    }
  } else {
    if (board) board.classList.remove('hidden');
    if (listView) listView.classList.remove('active');
  }

  if (boardBtn) {
    boardBtn.classList.toggle('is-active', mode === 'board');
  }
  if (listBtn) {
    listBtn.classList.toggle('is-active', mode === 'list');
  }
}

// ============================================================
// UI Функции управления экранами
// ============================================================
function showError(title, message) {
  const app = document.getElementById('app');
  const authScreen = document.getElementById('auth-status-screen');
  const statusTitle = document.getElementById('status-title');
  const statusDesc = document.getElementById('status-desc');
  if (app) app.style.display = 'none';
  if (authScreen) authScreen.style.display = 'block';
  if (statusTitle) statusTitle.innerText = title;
  if (statusDesc) statusDesc.innerText = message;
}

function showApp() {
  const authScreen = document.getElementById('auth-status-screen');
  const app = document.getElementById('app');
  const userGreeting = document.getElementById('user-greeting');
  if (authScreen) authScreen.style.display = 'none';
  if (app) app.style.display = 'block';
  if (userGreeting) userGreeting.innerText = 'Привет, ' + currentUserName + '!';
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
  //    Бэкенд уже подставляет читаемые имена, поэтому используем значения напрямую
  if (usersWhitelist && Array.isArray(usersWhitelist)) {
    usersWhitelist.forEach(function(userName) {
      // Исключаем текущее пользователя (отображается первым)
      if (String(userName).includes(currentUserName)) {
        return;
      }
      
      const option = document.createElement('option');
      option.value = userName;
      option.innerText = userName;
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

  const statusTitle = document.getElementById('status-title');
  const statusDesc = document.getElementById('status-desc');
  if (statusTitle) statusTitle.innerText = 'Проверка прав доступа...';
  if (statusDesc) statusDesc.innerText = 'Проверяем ваш Telegram ID.';

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

    // Устанавливаем пользователей для фильтра
    if (typeof window.setFilterUsers === 'function') {
      window.setFilterUsers(result.usersWhitelist);
    }

    isDeveloper = Boolean(result.isDeveloper);
    if (isDeveloper) {
      document.getElementById('devtools').hidden = false;
      loadTeamMembers();
    }

    // Рендерим доску и открываем приложение
    renderBoard();
    showApp();
    switchView(currentView);
    
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
    blocked: [],
    done: [],
    cancelled: []
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

    // Обновляем счётчик задач в колонке
    const column = listElement.closest('.column');
    if (column) {
      const countBadge = column.querySelector('.count-badge');
      if (countBadge && typeof countBadge.textContent !== 'undefined') {
        countBadge.textContent = columns[status].length;
      }
    }

    columns[status].forEach(function(task) {
      const card = createTaskCard(task);
      listElement.appendChild(card);
    });
  }

  // Обновляем список если он активен
  if (currentView === 'list') {
    renderListView();
  }
}

// ============================================================
// Создание карточки задачи (новый формат)
// ============================================================
function createTaskCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card priority-' + task.priority;
  card.draggable = true;
  card.ondragstart = function(event) {
    event.dataTransfer.setData('text/plain', task.id);
  };

  // Цветная полоска статуса
  const statusBar = document.createElement('div');
  statusBar.className = 'task-status-bar';
  card.appendChild(statusBar);

  // Контент карточки
  const content = document.createElement('div');
  content.className = 'task-card-content';

  // Заголовок: текст задачи + кнопки
  const header = document.createElement('div');
  header.className = 'task-header';

  const text = document.createElement('div');
  text.className = 'task-number';
  text.style.maxWidth = 'calc(100% - 80px)';
  text.style.whiteSpace = 'pre-wrap';
  text.style.wordBreak = 'break-word';
  text.innerText = task.text || '';
  header.appendChild(text);

  // Контейнер для кнопок
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'task-actions';

  // Кнопка "Изменить" (карандаш на листе, синяя)
  const taskEdit = document.createElement('button');
  taskEdit.className = 'task-edit';
  taskEdit.type = 'button';
  taskEdit.title = 'Изменить задачу';
  taskEdit.setAttribute('aria-label', 'Изменить задачу');
  taskEdit.draggable = false;
  taskEdit.onclick = function(event) {
    event.stopPropagation();
    openEditTask(task.id);
  };
  // SVG иконка: карандаш на листе 16x16, цвет var(--tg-theme-button-color)
  taskEdit.innerHTML = '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5Z" stroke="var(--tg-theme-button-color)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 3l3 3" stroke="var(--tg-theme-button-color)" stroke-width="1.3" stroke-linecap="round"/></svg>';
  actionsContainer.appendChild(taskEdit);

  // Кнопка "Удалить" (корзина)
  const taskDelete = document.createElement('button');
  taskDelete.className = 'task-delete';
  taskDelete.type = 'button';
  taskDelete.title = 'Удалить задачу';
  taskDelete.setAttribute('aria-label', 'Удалить задачу');
  taskDelete.draggable = false;
  taskDelete.onclick = function(event) {
    event.stopPropagation();
    deleteTask(task.id, taskDelete);
  };
  // SVG иконка корзины с крышкой 16x16, цвет #B85252
  taskDelete.innerHTML = '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3.5h12M3.5 3.5v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-10M5.5 1.5h5M6.5 7v4.5M9.5 7v4.5" stroke="#B85252" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  actionsContainer.appendChild(taskDelete);



  header.appendChild(actionsContainer);
  content.appendChild(header);

  // Метаданные
  const metaGroup = document.createElement('div');
  metaGroup.className = 'task-meta-group';

  // Исполнитель
  const executorRow = document.createElement('div');
  executorRow.className = 'task-meta-row';
  const executorLabel = document.createElement('span');
  executorLabel.className = 'task-meta-label';
  executorLabel.innerText = 'Исполнитель:';
  executorRow.appendChild(executorLabel);
  const executorValue = document.createElement('span');
  executorValue.className = 'task-meta-value';
  executorValue.innerText = task.executor || '—';
  executorRow.appendChild(executorValue);
  metaGroup.appendChild(executorRow);

  // Срок
  const deadlineRow = document.createElement('div');
  deadlineRow.className = 'task-meta-row';
  const deadlineLabel = document.createElement('span');
  deadlineLabel.className = 'task-meta-label';
  deadlineLabel.innerText = 'Срок:';
  deadlineRow.appendChild(deadlineLabel);
  const deadlineValue = document.createElement('span');
  deadlineValue.className = 'task-meta-value';
  deadlineValue.innerText = formatDeadlineDisplay(task.deadline);
  deadlineRow.appendChild(deadlineValue);
  metaGroup.appendChild(deadlineRow);

  content.appendChild(metaGroup);
  card.appendChild(content);

  // Клик по карточке — открывает режим просмотра
  card.style.cursor = 'pointer';
  card.onclick = function(event) {
    if (event.target.closest('.task-delete') || event.target.closest('.task-edit')) {
      return;
    }
    openViewTask(task.id);
  };

  return card;
}

// ============================================================
// Отрисовка списка задач (без разделения по статусам)
// ============================================================
function renderListView() {
  const listView = document.getElementById('list-view');
  if (!listView) return;

  listView.innerHTML = '';

  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.innerHTML = `
      <div class="list-empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1"/>
          <line x1="9" y1="12" x2="15" y2="12"/>
          <line x1="9" y1="16" x2="13" y2="16"/>
        </svg>
      </div>
      <div class="list-empty-text">Задач пока нет</div>
      <div class="list-empty-subtext">Нажмите "+Задача" чтобы добавить первую</div>
    `;
    listView.appendChild(empty);
    return;
  }

  // Сортируем: сначала Беклог, потом В работе, Блок, Выполнено, Отменено
  const statusOrder = { todo: 0, progress: 1, blocked: 2, done: 3, cancelled: 4 };
  const sortedTasks = [...tasks].sort(function(a, b) {
    return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
  });

  sortedTasks.forEach(function(task) {
    const card = createTaskCard(task);
    listView.appendChild(card);
  });
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
  if (!list) return;

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

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn-primary';
    saveButton.innerText = 'Сохранить';
    saveButton.onclick = function() {
      saveTeamMember(member.telegramId, saveButton);
    };

    card.appendChild(info);
    card.appendChild(displayName);
    card.appendChild(saveButton);
    list.appendChild(card);
  });
}

async function loadTeamMembers() {
  if (!isDeveloper) return;

  const list = document.getElementById('team-members');
  if (!list) return;
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
  const originalText = button.innerText;
  button.disabled = true;
  button.innerText = 'Сохраняем…';

  try {
    await devRequest('update_team_member', {
      member: { telegramId: telegramId, displayName: displayName }
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
  var hadButton = !!button;
  askForDeletion(async function(confirmed) {
    if (!confirmed) return;

    if (hadButton) {
      button.disabled = true;
      button.innerText = '…';
    }

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData, action: 'delete_task', taskId: taskId })
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
      if (hadButton) {
        button.disabled = false;
        button.innerText = '×';
      }
      console.error('Ошибка удаления задачи:', error);
      if (tg && typeof tg.showAlert === 'function') {
        tg.showAlert(error.message || 'Не удалось удалить задачу.');
      } else {
        alert(error.message || 'Не удалось удалить задачу.');
      }
    }
  });
}

function deleteFromView() {
  var taskId = currentViewTaskId;
  if (!taskId) return;
  closeViewTask();
  deleteTask(taskId, null);
}

function getNotesFromForm() {
  const notesInput = document.getElementById('form-notes');
  return notesInput ? notesInput.value.trim() : '';
}

// ============================================================
// Справочник статусов и приоритетов
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
// Просмотр задачи (режим чтения)
// ============================================================
let currentViewTaskId = null;

function openViewTask(taskId) {
  const task = tasks.find(function(t) {
    return t.id === taskId;
  });
  if (!task) return;

  currentViewTaskId = task.id;

  // Заполняем текст
  const viewText = document.getElementById('task-view-text');
  if (viewText) viewText.innerText = task.text || '';

  // Статус
  const viewStatus = document.getElementById('task-view-status');
  if (viewStatus) {
    viewStatus.className = 'task-view-status-badge status-' + (task.status || 'todo');
    viewStatus.innerText = STATUS_LABELS[task.status] || task.status;
  }

  // Приоритет
  const viewPriority = document.getElementById('task-view-priority');
  if (viewPriority) {
    viewPriority.className = 'task-view-priority-badge priority-' + (task.priority || 'medium');
    viewPriority.innerText = PRIORITY_LABELS[task.priority] || task.priority;
  }

  // Исполнитель
  const viewExecutor = document.getElementById('task-view-executor');
  if (viewExecutor) viewExecutor.innerText = task.executor || '—';

  // Срок
  const viewDeadline = document.getElementById('task-view-deadline');
  if (viewDeadline) viewDeadline.innerText = formatDeadlineDisplay(task.deadline);

  // Заметки
  const viewNotesContainer = document.getElementById('task-view-notes-container');
  const viewNotes = document.getElementById('task-view-notes');
  const notes = task.notes || '';
  if (viewNotes) viewNotes.innerText = notes;
  if (viewNotesContainer) {
    if (notes) {
      viewNotesContainer.style.display = 'flex';
    } else {
      viewNotesContainer.style.display = 'none';
    }
  }

  // Открываем модалку
  const overlay = document.getElementById('task-view-overlay');
  if (overlay) {
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    if (tg && tg.BackButton) {
      tg.BackButton.show();
      tg.BackButton.onClick(closeViewTask);
    }
  }
}

function closeViewTask(event) {
  if (event && event.target && event.target.id !== 'task-view-overlay' && !event.target.classList.contains('task-view-close')) {
    return;
  }

  const overlay = document.getElementById('task-view-overlay');
  if (!overlay) return;

  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  currentViewTaskId = null;

  if (tg && tg.BackButton) {
    tg.BackButton.hide();
  }
}

function editFromView() {
  var taskId = currentViewTaskId;
  if (!taskId) return;
  closeViewTask();
  setTimeout(function() {
    openEditTask(taskId);
  }, 200);
}

// ============================================================
// Модальное окно создания/редактирования задачи
// ============================================================
function openEditTask(taskId) {
  const task = tasks.find(function(t) {
    return t.id === taskId;
  });
  if (!task) return;

  editingTaskId = task.id;

  // Устанавливаем заголовок
  const modalTitle = document.getElementById('modal-title');
  if (modalTitle) modalTitle.innerText = 'Редактировать задачу';

  // Заполняем поля
  const textInput = document.getElementById('form-text');
  if (textInput) textInput.value = task.text || '';
  
  const executorInput = document.getElementById('form-executor');
  if (executorInput) executorInput.value = task.executor || '';
  
  const statusInput = document.getElementById('form-status');
  if (statusInput) statusInput.value = task.status || 'todo';
  const priorityInput = document.getElementById('form-priority');
  if (priorityInput) priorityInput.value = task.priority || 'medium';
  
  // Заполняем заметки
  const notesInput = document.getElementById('form-notes');
  if (notesInput) notesInput.value = task.notes || '';

  // Определяем режим срока
  if (isIsoDateValue(task.deadline)) {
    setDeadlineMode('date');
    document.getElementById('form-deadline-date').value = task.deadline === '—' ? '' : task.deadline;
  } else {
    setDeadlineMode('sprint');
    document.getElementById('form-deadline-sprint').value = task.deadline || '';
  }

  // Открываем модалку
  openTaskForm();
}

function saveTask() {
  const textInput = document.getElementById('form-text');
  const text = textInput ? textInput.value.trim() : '';
  const executorInput = document.getElementById('form-executor');
  const executor = executorInput ? executorInput.value : '';
  const deadline = getTaskDeadlineValue();
  const statusInput = document.getElementById('form-status');
  const status = statusInput ? statusInput.value : 'todo';
  const priorityInput = document.getElementById('form-priority');
  const priority = priorityInput ? priorityInput.value : 'medium';
  const notes = getNotesFromForm();

  if (!text) {
    if (tg && typeof tg.showAlert === 'function') {
      tg.showAlert('Введите текст задачи.');
    }
    return;
  }

  const isCreate = !editingTaskId;

  if (isCreate) {
    saveNewTask(text, executor, deadline, status, priority, notes).catch(function(error) {
      console.error('Ошибка создания задачи:', error);
      if (tg && typeof tg.showAlert === 'function') {
        tg.showAlert(error.message || 'Не удалось создать задачу.');
      } else {
        alert(error.message || 'Не удалось создать задачу.');
      }
    });
  } else {
    updateExistingTask(text, executor, deadline, status, priority, notes).catch(function(error) {
      console.error('Ошибка обновления задачи:', error);
      if (tg && typeof tg.showAlert === 'function') {
        tg.showAlert(error.message || 'Не удалось обновить задачу.');
      } else {
        alert(error.message || 'Не удалось обновить задачу.');
      }
    });
  }
  exportToExcel();
}

async function saveNewTask(text, executor, deadline, status, priority, notes) {
  // Сразу добавляем задачу в локальный массив и закрываем модалку,
  // чтобы пользователь не мог кликнуть "Сохранить" повторно
  const tempTask = {
    id: Date.now().toString(),
    text: text,
    executor: executor,
    deadline: deadline,
    status: status,
    priority: priority,
    notes: notes
  };
  tasks.push(tempTask);
  renderBoard();
  closeTaskForm();

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData,
        action: 'create',
        task: { text: text, executor: executor, deadline: deadline, status: status, priority: priority, notes: notes }
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Не удалось создать задачу.');
    }

    // Обновляем задачу на серверный id и данные
    const taskIndex = tasks.findIndex(function(t) {
      return t.id === tempTask.id;
    });
    if (taskIndex !== -1) {
      tasks[taskIndex] = Object.assign({}, tasks[taskIndex], result.task);
    }
  } catch (error) {
    // При ошибке удаляем неудачно созданную задачу
    tasks = tasks.filter(function(t) {
      return t.id !== tempTask.id;
    });
    renderBoard();
    throw error;
  }
  
  // Авто-синхронизация после создания задачи
  exportToExcel();
}

async function updateExistingTask(text, executor, deadline, status, priority, notes) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      initData: tg.initData,
      action: 'update',
      taskId: editingTaskId,
      task: { text: text, executor: executor, deadline: deadline, status: status, priority: priority, notes: notes }
    })
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Не удалось обновить задачу.');
  }

  // Обновляем локальную задачу
  const taskIndex = tasks.findIndex(function(t) {
    return t.id === editingTaskId;
  });
  if (taskIndex !== -1) {
    tasks[taskIndex] = Object.assign({}, tasks[taskIndex], result.task);
  }
  
  renderBoard();
  closeTaskForm();
  exportToExcel();
}
function setDeadlineMode(mode) {
  deadlineMode = mode === 'sprint' ? 'sprint' : 'date';

  const dateButton = document.getElementById('deadline-mode-date');
  const sprintButton = document.getElementById('deadline-mode-sprint');
  const dateInput = document.getElementById('form-deadline-date');
  const sprintInput = document.getElementById('form-deadline-sprint');

  if (!dateButton || !sprintButton || !dateInput || !sprintInput) {
    return;
  }

  const isDateMode = deadlineMode === 'date';
  dateButton.classList.toggle('is-active', isDateMode);
  sprintButton.classList.toggle('is-active', !isDateMode);
  dateButton.setAttribute('aria-selected', isDateMode ? 'true' : 'false');
  sprintButton.setAttribute('aria-selected', !isDateMode ? 'true' : 'false');
  dateInput.hidden = !isDateMode;
  sprintInput.hidden = isDateMode;
}

function resetTaskForm() {
  const textInput = document.getElementById('form-text');
  const executorInput = document.getElementById('form-executor');
  const statusInput = document.getElementById('form-status');
  const priorityInput = document.getElementById('form-priority');
  const dateInput = document.getElementById('form-deadline-date');
  const sprintInput = document.getElementById('form-deadline-sprint');
  const notesInput = document.getElementById('form-notes');
  const modalTitle = document.getElementById('modal-title');

  editingTaskId = null;
  if (textInput) textInput.value = '';
  if (executorInput) executorInput.value = '';
  if (statusInput) statusInput.value = 'todo';
  if (priorityInput) priorityInput.value = 'medium';
  if (dateInput) dateInput.value = '';
  if (sprintInput) sprintInput.value = '';
  if (notesInput) notesInput.value = '';
  if (modalTitle) modalTitle.innerText = 'Новая задача';
  setDeadlineMode('date');
}

function openTaskForm() {
  const overlay = document.getElementById('task-form-overlay');
  if (!overlay) return;

  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  if (tg && tg.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(closeTaskForm);
  }

  const textInput = document.getElementById('form-text');
  if (textInput) {
    setTimeout(function() {
      textInput.focus();
    }, 120);
  }
}

function closeTaskForm() {
  const overlay = document.getElementById('task-form-overlay');
  if (!overlay) return;

  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');

  if (tg && tg.BackButton) {
    tg.BackButton.hide();
  }

  resetTaskForm();
}

function handleOverlayClick(event) {
  if (event.target && event.target.id === 'task-form-overlay') {
    closeTaskForm();
  }
}

function getTaskDeadlineValue() {
  if (deadlineMode === 'sprint') {
    const sprintValue = document.getElementById('form-deadline-sprint').value.trim();
    return sprintValue || '—';
  }

  const dateValue = document.getElementById('form-deadline-date').value;
  return dateValue || '—';
}

async function addTask() {
  const text = document.getElementById('form-text').value.trim();
  const executor = document.getElementById('form-executor').value;
  const deadline = getTaskDeadlineValue();
  const status = document.getElementById('form-status').value;
  const priority = document.getElementById('form-priority').value;

  if (!text) {
    if (tg && typeof tg.showAlert === 'function') {
      tg.showAlert('Введите текст задачи.');
    }
    return;
  }

  const saveButton = document.querySelector('#task-form-overlay .modal-footer .btn-primary');
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.innerText = 'Сохраняем…';
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData,
        action: 'create',
        task: { text: text, executor: executor, deadline: deadline, status: status, priority: priority }
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Не удалось создать задачу.');
    }

    tasks.push(result.task);
    renderBoard();
    closeTaskForm();
  } catch (error) {
    console.error('Ошибка создания задачи:', error);
    if (tg && typeof tg.showAlert === 'function') {
      tg.showAlert(error.message || 'Не удалось создать задачу.');
    } else {
      alert(error.message || 'Не удалось создать задачу.');
    }
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.innerText = 'Сохранить';
    }
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
  exportToExcel();
}
// ============================================================
// Excel Экспорт и синхронизация с Google Sheets
// ============================================================
let syncTimeoutId = null;

function showSyncIndicator(success) {
  const excelBtn = document.getElementById('excel-export-btn');
  if (!excelBtn) return;
  
  if (!success) return;
  
  // Сброс предыдущего таймера если есть
  if (syncTimeoutId) {
    clearTimeout(syncTimeoutId);
  }
  
  // Сохраняем исходные стили
  const computedStyle = getComputedStyle(excelBtn);
  
  excelBtn.style.setProperty('background-color', 'var(--tg-theme-accent-color)');
  excelBtn.style.setProperty('border-color', 'var(--tg-theme-accent-color)');
  excelBtn.style.setProperty('color', '#FFFFFF');
  
  syncTimeoutId = setTimeout(function() {
    syncTimeoutId = null;
    excelBtn.style.removeProperty('background-color');
    excelBtn.style.removeProperty('border-color');
    excelBtn.style.removeProperty('color');
  }, 3000);
}

async function exportToExcel() {
  if (!tg) return;

  const excelBtn = document.getElementById('excel-export-btn');
  if (excelBtn) excelBtn.classList.add('excel-syncing');
  excelBtn.disabled = true;

  try {
    var response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData,
        action: 'sync_google'
      })
    });

    var result = await response.json();
    if (response.ok && result.success) {
      // Переинициализируем задачи с сервера после синхронизации
      await reloadTasks();
      showSyncIndicator(true);
    } else {
      showSyncIndicator(false);
      console.error('Ошибка синхронизации:', result.error);
    }
  } catch (e) {
    showSyncIndicator(false);
    console.error('Ошибка соединения:', e);
  } finally {
    if (excelBtn) {
      excelBtn.classList.remove('excel-syncing');
      excelBtn.disabled = false;
    }
  }
}

async function reloadTasks() {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData,
        action: 'login'
      })
    });
    
    const responseText = await response.text();
    const result = JSON.parse(responseText);
    if (result.success) {
      tasks = result.tasks || [];
      renderBoard();
    }
  } catch (error) {
    console.error('Ошибка перезагрузки задач:', error);
  }
}

// ============================================================
// Автоматическая синхронизация при загрузке
// ============================================================
async function autoSyncOnStart() {
  // Синхронизируем только если задача уже была создана
  if (tasks.length === 0) return;
  
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData,
        action: 'sync_google'
      })
    });
    // После синхронизации перезагружаем задачи
    await reloadTasks();
  } catch (error) {
    console.log('Авто-синхронизация пропущена:', error.message);
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
  switchView(currentView);

  const telegramUser = getTelegramUser();
  if (telegramUser) {
    currentUserName =
      telegramUser.first_name ||
      telegramUser.username ||
      'Пользователь';
  }

  // Запуск процесса авторизации и загрузки базы данных
  await authorize();
  
  // Автоматическая синхронизация после загрузки
  autoSyncOnStart();
}

initApplication();
