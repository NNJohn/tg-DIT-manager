// script.filter.js — Фильтрация задач по исполнителю
// Не затрагивает процесс логина и основную логику script.js

(function() {
  'use strict';

  var filterExecutor = '';
  var allUsersWhitelist = [];
  var initialized = false;

  // ============================================================
  // Инициализация
  // ============================================================
  function init() {
    if (initialized) return;
    initialized = true;

    var select = document.getElementById('task-filter-executor');
    if (!select) return;

    // Устанавливаем "Все"
    select.value = '';
    filterExecutor = '';

    // Слушаем изменение
    select.addEventListener('change', function() {
      filterExecutor = select.value;
      applyFilterToCards();
    });
  }

  // ============================================================
  // Установка списка пользователей (вызывается из основного скрипта)
  // ============================================================
  window.setFilterUsers = function(usersWhitelist) {
    if (!usersWhitelist || !usersWhitelist.length) return;
    
    allUsersWhitelist = usersWhitelist;

    var select = document.getElementById('task-filter-executor');
    if (!select) return;

    // Очищаем и добавляем "Все" + список
    select.innerHTML = '<option value="">Все</option>';
    for (var i = 0; i < usersWhitelist.length; i++) {
      var opt = document.createElement('option');
      opt.value = usersWhitelist[i];
      opt.innerText = usersWhitelist[i];
      select.appendChild(opt);
    }
  };

  // ============================================================
  // Применение фильтра к карточкам (скрываем/показываем через class)
  // ============================================================
  function applyFilterToCards() {
    var cards = document.querySelectorAll('.task-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var executorSpan = card.querySelector('.task-meta-value');
      
      if (!executorSpan) {
        card.style.display = '';
        continue;
      }

      var executorText = executorSpan.textContent.trim();
      
      // Если фильтр пустой — показываем все
      if (!filterExecutor) {
        card.style.display = '';
        continue;
      }

      // Показываем только задачи выбранного исполнителя
      if (executorText === filterExecutor) {
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    }

    // Обновляем счётчики в колонках (скрываем пустые колонки если нужно)
    var columns = document.querySelectorAll('.column');
    for (var j = 0; j < columns.length; j++) {
      var column = columns[j];
      var visibleCards = column.querySelectorAll('.task-card[style=""], .task-card:not([style*="display: none"])');
      var list = column.querySelector('.task-list');
      
      if (list) {
        // Пересчитываем видимые карточки
        var count = 0;
        var taskCards = list.querySelectorAll('.task-card');
        for (var k = 0; k < taskCards.length; k++) {
          if (taskCards[k].style.display !== 'none') {
            count++;
          }
        }
        var badge = column.querySelector('.count-badge');
        if (badge) {
          badge.textContent = count;
        }
      }
    }
  }

  // ============================================================
  // Мониторинг изменения задач и повторное применение фильтра
  // ============================================================
  function setupTaskChangeObserver() {
    var observer = new MutationObserver(function() {
      applyFilterToCards();
    });

    // Наблюдаем за task-list на добавление/удаление карточек
    var lists = document.querySelectorAll('.task-list');
    for (var i = 0; i < lists.length; i++) {
      observer.observe(lists[i], {
        childList: true,
        subtree: true
      });
    }
  }

  // ============================================================
  // Запуск
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      init();
      setupTaskChangeObserver();
    });
  } else {
    // Небольшая задержка чтобы main script успел выполнить инициализацию
    setTimeout(function() {
      init();
      setupTaskChangeObserver();
    }, 500);
  }

})();
