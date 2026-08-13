var tasks = [];
var currentUserName = "Пользователь";
const API_URL = '/api/auth';
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

function showError(title, message) {
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-status-screen').style.display = 'block';
  document.getElementById('status-title').innerText = title;
  document.getElementById('status-desc').innerText = message;
}

function showApp() {
  document.getElementById('auth-status-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-greeting').innerText = 'Привет, ' + currentUserName + '!';
}

function applyTelegramTheme() {
  if (!tg || !tg.themeParams) return;
  var getParam = function(name, fallback) { return tg.themeParams[name] || fallback; };
  document.documentElement.style.setProperty('--tg-theme-bg-color', getParam('bg_color', '#ffffff'));
  document.documentElement.style.setProperty('--tg-theme-text-color', getParam('text_color', '#000000'));
  document.documentElement.style.setProperty('--tg-theme-hint-color', getParam('hint_color', '#707579'));
  document.documentElement.style.setProperty('--tg-theme-button-color', getParam('button_color', '#2481cc'));
  document.documentElement.style.setProperty('--tg-theme-button-text-color', getParam('button_text_color', '#ffffff'));
  document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', getParam('secondary_bg_color', '#f4f4f5'));
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

// ОТПРАВКА СОЗДАННОЙ ЗАДАЧИ В MONGODB
async function addTask() {
  var text = document.getElementById('form-text').value.trim();
  const executor = document.getElementById('form-executor').value;
  var deadline = document.getElementById('form-deadline').value;
  var priority = document.getElementById('form-priority').value;

  if (!text || !tg) return;

  try {
    var response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: tg.initData,
        action: 'create',
        task: { text: text, executor: executor, deadline: deadline, priority: priority }
      })
    });
    var result = await response.json();
    if (response.ok && result.success) {
      tasks.push(result.task);
      renderBoard();
      toggleForm();
      document.getElementById('form-text').value = '';
      document.getElementById('form-executor').value = '';
      document.getElementById('form-deadline').value = '';
    }
  } catch (e) {
    console.error(e);
  }
}

function allowDrop(e) { e.preventDefault(); }

// ОБНОВЛЕНИЕ СТАТУСА ПРИ ПЕРЕТАСКИВАНИИ В MONGODB
async function drop(e, newStatus) {
  e.preventDefault();
  var taskId = e.dataTransfer.getData('text/plain');
  var task = tasks.find(function(t) { return t.id === taskId; });
  if (task && tg) {
    var oldStatus = task.status;
    task.status = newStatus;
    renderBoard();

    try {
      var response = await fetch(API_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData, taskId: taskId, newStatus: newStatus })
      });
      if (!response.ok) throw new Error();
    } catch (err) {
      task.status = oldStatus; // Откат назад при сбое сети
      renderBoard();
    }
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
  XLSX.writeFile(workbook, "pocket_jira_export.xlsx");
}

// ЗАГРУЗКА ДАННЫХ ИЗ MONGODB ПРИ СТАРТЕ
async function initApplication() {
  await new Promise(function(resolve) { setTimeout(resolve, 150); });

  if (!tg || !tg.initData || tg.initData === "") {
    showError("Откройте в Telegram", "Pocket Jira должен запускаться через Telegram Mini App.");
    return;
  }

  tg.ready();
  tg.expand();
  applyTelegramTheme();

  document.getElementById('status-title').innerText = "Получение задач из MongoDB...";

  try {
    var response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData, action: 'login' })
    });

    var result = await response.json();

    if (response.ok && result.success) {
      currentUserName = result.userName || "Пользователь";
      tasks = result.tasks || []; // Перезаписываем пустой массив реальными задачами из базы
      renderBoard();
      showApp();
    } else {
      showError("Доступ ограничен", result.error || "У вас нет прав доступа.");
    }
  } catch (error) {
    showError("Ошибка сервера", "Не удалось связаться с базой данных.");
  }
}

initApplication();
