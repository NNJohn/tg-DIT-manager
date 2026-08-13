var tasks = [
  { id: '1', status: 'todo', text: 'Запустить MVP бота', author: 'Система', executor: 'Команда', deadline: '2026-08-20', priority: 'high' },
  { id: '2', status: 'progress', text: 'Тестирование интерфейса', author: 'Иван', executor: 'Петр', deadline: '2026-08-15', priority: 'medium' }
];

var currentUserName = "Пользователь";

function showError(title, message) {
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-status-screen').style.display = 'block';
  document.getElementById('status-title').innerText = title;
  document.getElementById('status-desc').innerText = message;
}

function renderBoard() {
  var columns = { todo: [], progress: [], done: [] };
  tasks.forEach(function(t) { if (columns[t.status]) columns[t.status].push(t); });

  for (var status in columns) {
    var listEl = document.getElementById(status);
    if (!listEl) continue;
    listEl.innerHTML = '';
    
    columns[status].forEach(function(task) {
      var card = document.createElement('div');
      card.className = "task-card priority-" + task.priority;
      card.draggable = true;
      card.ondragstart = function(e) { e.dataTransfer.setData('text/plain', task.id); };
      
      card.innerHTML = '<div class="task-text">' + task.text + '</div>' +
                       '<div class="task-meta">От: ' + task.author + ' | Исполнитель: ' + (task.executor || '—') + '</div>' +
                       '<div class="task-meta">Срок: ' + (task.deadline || '—') + '</div>';
      listEl.appendChild(card);
    });
  }
}

function toggleForm() {
  var form = document.getElementById('task-form');
  form.style.display = form.style.display === 'flex' ? 'none' : 'flex';
}

function addTask() {
  var text = document.getElementById('form-text').value;
  var executor = document.getElementById('form-executor').value;
  var deadline = document.getElementById('form-deadline').value;
  var priority = document.getElementById('form-priority').value;

  if (!text) return;

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

function allowDrop(e) { e.preventDefault(); }

function drop(e, newStatus) {
  e.preventDefault();
  var taskId = e.dataTransfer.getData('text/plain');
  var task = tasks.find(function(t) { return t.id === taskId; });
  if (task) {
    task.status = newStatus;
    renderBoard();
  }
}

function exportToExcel() {
  var dataToExport = tasks.map(function(t) {
    return {
      'ID Задачи': t.id,
      'Статус': t.status === 'todo' ? 'Надо сделать' : t.status === 'progress' ? 'В работе' : 'Готово',
      'Текст задачи': t.text,
      'Автор': t.author,
      'Исполнитель': t.executor || 'Не назначен',
      'Срок выполнения': t.deadline || 'Не указан',
      'Приоритет': t.priority.toUpperCase()
    };
  });

  var worksheet = XLSX.utils.json_to_sheet(dataToExport);
  var workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Задачи");
  XLSX.writeFile(workbook, "kanban_tasks.xlsx");
}

async function initApplication() {
var tasks = [
  { id: '1', status: 'todo', text: 'Запустить MVP бота', author: 'Система', executor: 'Команда', deadline: '2026-08-20', priority: 'high' },
  { id: '2', status: 'progress', text: 'Тестирование интерфейса', author: 'Иван', executor: 'Петр', deadline: '2026-08-15', priority: 'medium' }
];

var currentUserName = "Пользователь";

function showError(title, message) {
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-status-screen').style.display = 'block';
  document.getElementById('status-title').innerText = title;
  document.getElementById('status-desc').innerText = message;
}

function renderBoard() {
  var columns = { todo: [], progress: [], done: [] };
  tasks.forEach(function(t) { if (columns[t.status]) columns[t.status].push(t); });

  for (var status in columns) {
    var listEl = document.getElementById(status);
    if (!listEl) continue;
    listEl.innerHTML = '';
    
    columns[status].forEach(function(task) {
      var card = document.createElement('div');
      card.className = "task-card priority-" + task.priority;
      card.draggable = true;
      card.ondragstart = function(e) { e.dataTransfer.setData('text/plain', task.id); };
      
      card.innerHTML = '<div class="task-text">' + task.text + '</div>' +
                       '<div class="task-meta">От: ' + task.author + ' | Исполнитель: ' + (task.executor || '—') + '</div>' +
                       '<div class="task-meta">Срок: ' + (task.deadline || '—') + '</div>';
      listEl.appendChild(card);
    });
  }
}

function toggleForm() {
  var form = document.getElementById('task-form');
  form.style.display = form.style.display === 'flex' ? 'none' : 'flex';
}

function addTask() {
  var text = document.getElementById('form-text').value;
  var executor = document.getElementById('form-executor').value;
  var deadline = document.getElementById('form-deadline').value;
  var priority = document.getElementById('form-priority').value;

  if (!text) return;

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

function allowDrop(e) { e.preventDefault(); }

function drop(e, newStatus) {
  e.preventDefault();
  var taskId = e.dataTransfer.getData('text/plain');
  var task = tasks.find(function(t) { return t.id === taskId; });
  if (task) {
    task.status = newStatus;
    renderBoard();
  }
}

function exportToExcel() {
  var dataToExport = tasks.map(function(t) {
    return {
      'ID Задачи': t.id,
      'Статус': t.status === 'todo' ? 'Надо сделать' : t.status === 'progress' ? 'В работе' : 'Готово',
      'Текст задачи': t.text,
      'Автор': t.author,
      'Исполнитель': t.executor || 'Не назначен',
      'Срок выполнения': t.deadline || 'Не указан',
      'Приоритет': t.priority.toUpperCase()
    };
  });

  var worksheet = XLSX.utils.json_to_sheet(dataToExport);
  var workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Задачи");
  XLSX.writeFile(workbook, "kanban_tasks.xlsx");
}

async function initApplication() {
  var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  var isRealTelegram = tg && (tg.platform && tg.platform !== "unknown");

  if (!isRealTelegram) {
    document.getElementById('auth-status-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('user-greeting').innerText = "Привет, Разработчик (Браузер)!";
    renderBoard();
    return;
  }

  tg.ready();
  tg.expand();

  try {
    var getParam = function(name, fallback) { return (tg.themeParams && tg.themeParams[name]) ? tg.themeParams[name] : fallback; };
    document.documentElement.style.setProperty('--tg-theme-bg-color', getParam('bg_color', '#ffffff'));
    document.documentElement.style.setProperty('--tg-theme-text-color', getParam('text_color', '#000000'));
    document.documentElement.style.setProperty('--tg-theme-hint-color', getParam('hint_color', '#707579'));
    document.documentElement.style.setProperty('--tg-theme-button-color', getParam('button_color', '#2481cc'));
    document.documentElement.style.setProperty('--tg-theme-button-text-color', getParam('button_text_color', '#ffffff'));
    document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', getParam('secondary_bg_color', '#f4f4f5'));
  } catch (e) {
    console.error(e);
  }

  if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    currentUserName = tg.initDataUnsafe.user.first_name || tg.initDataUnsafe.user.username || "Пользователь";
  }

  if (!tg.initData || tg.initData === "") {
    document.getElementById('auth-status-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('user-greeting').innerText = "Привет, " + currentUserName + "!";
    renderBoard();
    return;
  }

  document.getElementById('status-title').innerText = "Проверка прав доступа...";

  try {
    var response = await fetch('https://vercel.app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData })
    });

    var result = await response.json();

    if (response.ok && result.success) {
      if (result.userName) {
        currentUserName = result.userName;
      }
      document.getElementById('auth-status-screen').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      document.getElementById('user-greeting').innerText = "Привет, " + currentUserName + "!";
      renderBoard();
    } else {
      showError("Доступ ограничен", result.error || "Вашего личного Telegram ID нет в белом списке этой системы.");
    }
  } catch (error) {
    document.getElementById('auth-status-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('user-greeting').innerText = "Привет, " + currentUserName + "!";
    renderBoard();
  }
}

initApplication();
