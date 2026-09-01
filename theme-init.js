(function () {
    try {
        var stored = localStorage.getItem('chemdeck-theme');
        if (stored === 'dark' || stored === 'light') {
            document.documentElement.setAttribute('data-theme', stored);
        }
    } catch (e) { }
})();
