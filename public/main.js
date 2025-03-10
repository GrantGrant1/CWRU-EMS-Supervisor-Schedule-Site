const socket = io();
let isMouseDown = false;
let pendingChanges = {}; // { "date||slot": true/false }

document.addEventListener('mousedown', () => {
  isMouseDown = true;
});
document.addEventListener('mouseup', () => {
  isMouseDown = false;
});

// Toggle cell pending state on click/drag
function toggleCell(cell) {
  const date = cell.dataset.date;
  const slot = cell.dataset.slot;
  const key = date + '||' + slot;

  // Check if the shift is taken by someone else
  const isTaken = cell.dataset.taken === 'true';
  const currentUserAssigned = cell.dataset.assigned === 'true';

  // For regular users, if the shift is taken and it's not already theirs, do nothing.
  if (!window.isAdmin && isTaken && !currentUserAssigned) {
    return;
  }
  
  let currentState = currentUserAssigned;
  if (pendingChanges.hasOwnProperty(key)) {
    currentState = pendingChanges[key];
  }
  
  const newState = !currentState;
  pendingChanges[key] = newState;
  
  // Update appearance based on new state:
  if (newState) {
    // Light blue for “pending assignment”
    cell.style.backgroundColor = '#8fcaff';
    cell.innerHTML = '<strong>Available:</strong> (pending)';
  } else {
    // Gray for “unassigned”
    cell.style.backgroundColor = '#c0c0c0';
    cell.innerHTML = '<strong>Unassigned:</strong>';
  }
}

document.querySelectorAll('.timeslot').forEach(cell => {
  cell.addEventListener('click', () => {
    toggleCell(cell);
  });
  cell.addEventListener('mouseover', () => {
    if (isMouseDown) {
      toggleCell(cell);
    }
  });
});

// Batch Save Changes
document.getElementById('saveButton').addEventListener('click', () => {
  let targetUserId = null;
  const targetSelect = document.getElementById('targetUserSelect');
  if (targetSelect) {
    targetUserId = targetSelect.value;
  }
  
  let changes = [];
  for (let key in pendingChanges) {
    if (pendingChanges.hasOwnProperty(key)) {
      const parts = key.split('||');
      const date = parts[0];
      const timeSlot = parts.slice(1).join('||');
      changes.push({
        date,
        timeSlot,
        available: pendingChanges[key],
        targetUserId
      });
    }
  }
  
  fetch('/api/batch-availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        pendingChanges = {};
        location.reload();
      } else {
        alert(data.message || 'Error updating availability.');
      }
    });
});

// Cancel Changes
document.getElementById('cancelButton').addEventListener('click', () => {
  pendingChanges = {};
  location.reload();
});

socket.on('updateAvailability', () => {
  location.reload();
});
