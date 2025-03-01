const socket = io();

document.querySelectorAll('.timeslot').forEach(cell => {
  cell.addEventListener('click', () => {
    const date = cell.dataset.date;
    const slot = cell.dataset.slot;
    // Check if the current user is assigned using the data attribute
    const isAssigned = cell.dataset.assigned === 'true';
    // Toggle availability: if assigned, then unassign; if not, then assign
    const available = !isAssigned;

    fetch('/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, timeSlot: slot, available })
    })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          location.reload();
        } else {
          alert(data.message || 'Error updating availability.');
        }
      });
  });
});

socket.on('updateAvailability', () => {
  location.reload();
});
