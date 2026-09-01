fetch('status.json?_=' + Date.now())
    .then(r => r.ok ? r.json() : null)
    .then(data => {
        if (data && data.maintenance) {
            document.getElementById('maintenance-screen').classList.add('visible');
        }
    })
    .catch(() => { });
