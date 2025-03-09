const socket = io();
let isMouseDown = false;
let pendingChanges = {};

document.addEventListener('mousedown', () => {
  isMouseDown = true;
});
document.addEventListener('mouseup', () => {
  isMouseDown = false;
});

function toggleCell(cell) {
  const date = cell.dataset.date;
  const slot = cell.dataset.slot;
  const key = date + '||' + slot;

  const isTaken = cell.dataset.taken === 'true';
  const currentUserAssigned = cell.dataset.assigned === 'true';

  if (!window.isAdmin && isTaken && !currentUserAssigned) {
    return;
  }

  let currentState = currentUserAssigned;
  if (pendingChanges.hasOwnProperty(key)) {
    currentState = pendingChanges[key];
  }
  const newState = !currentState;
  pendingChanges[key] = newState;

  if (newState) {
    cell.classList.remove('assigned-cell', 'unassigned-cell');
    cell.classList.add('pending-cell');
    cell.innerHTML = '<strong>Available:</strong> (pending)';
  } else {
    cell.classList.remove('assigned-cell', 'pending-cell');
    cell.classList.add('unassigned-cell');
    cell.innerHTML = '<strong>Unassigned:</strong>';
  }
}

document.querySelectorAll('.timeslot').forEach(cell => {
  cell.addEventListener('click', () => toggleCell(cell));
  cell.addEventListener('mouseover', () => {
    if (isMouseDown) {
      toggleCell(cell);
    }
  });
});

document.getElementById('saveButton').addEventListener('click', () => {
  let targetUserId = null;
  const targetSelect = document.getElementById('targetUserSelect');
  if (targetSelect) {
    targetUserId = targetSelect.value;
  }

  let changes = [];
  for (let key in pendingChanges) {
    if (pendingChanges.hasOwnProperty(key)) {
      const [d, tSlot] = key.split('||');
      changes.push({
        date: d,
        timeSlot: tSlot,
        available: pendingChanges[key],
        targetUserId
      });
    }
  }

  fetch('/api/test-batch-availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes })
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        pendingChanges = {};
        location.reload();
      } else {
        alert(data.message || 'Error updating test availability.');
      }
    });
});

document.getElementById('cancelButton').addEventListener('click', () => {
  pendingChanges = {};
  location.reload();
});

socket.on('updateTestAvailability', () => {
  location.reload();
});
