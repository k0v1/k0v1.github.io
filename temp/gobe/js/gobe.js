// MAIN NAVIGATION

var menu = document.querySelector('menu');
var nav = document.querySelector('nav');

function openMenu() {
    menu.classList.add('menu-show');
    nav.classList.add('nav-open');
}

function closeMenu() {
    menu.classList.remove('menu-show');
    nav.classList.remove('nav-open');
}

function toggleMenu() {
    if (menu.classList.contains('menu-show')) {
        closeMenu();
    }
    else {
        openMenu();
    }
}

document.getElementById('hamburger').addEventListener('click', toggleMenu);