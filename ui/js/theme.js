function updateThemeIcon() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const iconUse = document.querySelector('#theme-icon use');
    if (iconUse) {
        iconUse.setAttribute('href', current === 'dark' ? '#icon-sun' : '#icon-moon');
    }
}
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon();
}
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
window.addEventListener('load', updateThemeIcon);
window.toggleTheme = toggleTheme;
