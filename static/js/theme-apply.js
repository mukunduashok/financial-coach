if (document.documentElement.classList.contains("light-pending")) {
  document.body.classList.add("light");
  document.documentElement.classList.remove("light-pending");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = "#FFFFFF";
}
