/* Dashboard page script: Edit buttons open the block's edit form; forms can
   add rows from a <template>; "Go back" returns to the form with its input. */
(function () {
  "use strict";
  var wrap = document.getElementById("page-wrap");
  var path = wrap && wrap.getAttribute("data-path");
  document.querySelectorAll(".ed[data-edit]").forEach(function (b) {
    if (!path) { b.disabled = true; return; }
    b.addEventListener("click", function () {
      location.href = "/g/" + path + "/edit/" + b.getAttribute("data-edit");
    });
  });

  document.querySelectorAll("[data-add]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var name = btn.getAttribute("data-add");
      var tpl = document.getElementById("tpl-" + name);
      var box = document.querySelector('[data-rows="' + name + '"]');
      if (!tpl || !box) return;
      var i = +btn.getAttribute("data-next");
      btn.setAttribute("data-next", String(i + 1));
      var holder = document.createElement("div");
      holder.innerHTML = tpl.innerHTML.replace(/__i__/g, String(i));
      var row = holder.firstElementChild;
      box.appendChild(row);
      var first = row.querySelector("input:not([type=hidden]),textarea,select");
      if (first) first.focus();
    });
  });

  document.querySelectorAll("[data-back]").forEach(function (b) {
    b.addEventListener("click", function () { history.back(); });
  });

  // Ask before leaving a form with unsaved edits.
  var form = document.querySelector("form.edit-form");
  if (form) {
    var dirty = false;
    form.addEventListener("input", function () { dirty = true; });
    form.addEventListener("submit", function () { dirty = false; });
    window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  }
})();
