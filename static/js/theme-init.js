// Apply saved theme immediately to prevent flash of wrong theme
(() => {
  let saved = localStorage.getItem("fincoach-theme");
  if (!saved) saved = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  if (saved === "light") document.documentElement.classList.add("light-pending");
})();
