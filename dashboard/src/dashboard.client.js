/* Dashboard page script (step 1: read-only). Edit buttons are shown but
   disabled until editing is added. */
(function () {
  "use strict";
  document.querySelectorAll(".ed").forEach(function (b) {
    b.disabled = true;
    b.title = "Editing arrives in the next step";
  });
})();
