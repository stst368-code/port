(() => {
    const rail = document.querySelector("[data-gbr-page-rail]");
    const drawer = document.querySelector("[data-gbr-page-drawer]");
    const scrim = document.querySelector("[data-gbr-page-scrim]");
    if (!rail || !drawer || !scrim) return;

    const tabs = [...rail.querySelectorAll("[data-gbr-page]")];
    const title = drawer.querySelector("[data-gbr-drawer-title]");
    const body = drawer.querySelector("[data-gbr-drawer-body]");
    const closeButton = drawer.querySelector("[data-gbr-drawer-close]");

    let activeSlug = null;
    let open = false;

    function templateFor(slug) {
        return document.getElementById(`gbr-page-template-${slug}`);
    }

    function setTabState(slug) {
        tabs.forEach((tab) => {
            const active = tab.dataset.gbrPage === slug && open;
            tab.setAttribute("aria-expanded", active ? "true" : "false");
            tab.classList.toggle("is-active", active);
        });
    }

    function emit(name, detail = {}) {
        document.dispatchEvent(new CustomEvent(name, { detail }));
    }

    function openPage(slug, options = {}) {
        const tab = tabs.find((item) => item.dataset.gbrPage === slug);
        const template = templateFor(slug);
        if (!tab || !template) return false;

        const sameOpenPage = open && activeSlug === slug;
        if (sameOpenPage && options.toggle !== false) {
            closeDrawer({ restoreFocus: false });
            tab.focus({ preventScroll: true });
            return true;
        }

        activeSlug = slug;
        open = true;

        title.textContent = tab.dataset.gbrTitle || tab.textContent.trim();
        body.replaceChildren(template.content.cloneNode(true));

        drawer.dataset.open = "true";
        drawer.setAttribute("aria-hidden", "false");
        scrim.dataset.open = "true";
        document.body.classList.add("gbr-page-drawer-open");
        setTabState(slug);

        tab.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            inline: "center",
            block: "nearest"
        });

        emit("gbr:page-drawer-open", { slug });
        return true;
    }

    function closeDrawer({ restoreFocus = true } = {}) {
        if (!open) return;

        const previous = activeSlug;
        open = false;

        drawer.dataset.open = "false";
        drawer.setAttribute("aria-hidden", "true");
        scrim.dataset.open = "false";
        document.body.classList.remove("gbr-page-drawer-open");
        setTabState(null);

        if (restoreFocus && previous) {
            tabs.find((tab) => tab.dataset.gbrPage === previous)
                ?.focus({ preventScroll: true });
        }

        emit("gbr:page-drawer-close", { slug: previous });
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => openPage(tab.dataset.gbrPage));

        tab.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();

            let next = index;
            if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
            if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = tabs.length - 1;

            tabs[next].focus({ preventScroll: true });
            tabs[next].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        });
    });

    closeButton?.addEventListener("click", () => closeDrawer());
    scrim.addEventListener("click", () => closeDrawer({ restoreFocus: false }));

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && open) closeDrawer();
    });

    // Small public API so the existing player/site code can open or close docs
    // without knowing anything about the drawer implementation.
    window.GBRPageDrawer = Object.freeze({
        open: (slug) => openPage(slug, { toggle: false }),
        close: () => closeDrawer(),
        current: () => activeSlug,
        isOpen: () => open
    });
})();
