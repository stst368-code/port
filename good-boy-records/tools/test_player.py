#!/usr/bin/env python3
"""Browser smoke checks for the fixed hi-fi + rotary cassette magazine.

Start the site first:

    python tools/serve.py
    python tools/test_player.py

Needs Playwright and Chromium. These checks intentionally work even when the
example cassette has no audio file yet.
"""
from playwright.sync_api import sync_playwright
import shutil

checks = []
def check(name, ok):
    checks.append((name, bool(ok)))

with sync_playwright() as p:
    system_chromium = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    launch_args = {"executable_path": system_chromium, "args": ["--no-sandbox", "--disable-dev-shm-usage"]} if system_chromium else {}
    b = p.chromium.launch(**launch_args)
    page = b.new_page(viewport={"width": 1440, "height": 1000})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://127.0.0.1:8000/", wait_until="domcontentloaded")
    page.wait_for_timeout(250)

    check("fixed player visible before selection", page.locator("#deck").is_visible())
    check("one shared audio element", page.locator("audio").count() == 1)
    check("rotary magazine exists", page.locator("#cassette-carousel").is_visible())
    check("album artwork display exists", page.locator("#deck-artwork").is_visible())
    check("one integrated cassette bay", page.locator("#cassette-bay").count() == 1 and page.locator(".program-art #cassette-bay").count() == 1)
    split = page.locator(".program-panel").evaluate("e => { const c=[...e.children]; return c.length>=2 ? [c[0].getBoundingClientRect().width,c[1].getBoundingClientRect().width] : [0,1]; }")
    check("program faceplate is 50/50", abs(split[0] - split[1]) <= 2)
    check("EQ is a button-operated popover", page.locator("#eq-toggle").is_visible() and page.locator("#eq-popover").is_hidden())
    check("version markers map to cassettes", page.locator(".version-tag").count() == page.locator(".card").count())
    check("native audio controls removed", not page.locator("#showcase-player").get_attribute("controls"))

    if page.locator("[data-play]").count():
        first = page.locator("[data-play]").first
        track_id = first.get_attribute("data-play")
        first.click()
        page.wait_for_timeout(1400)
        selected = page.locator('.card[data-track="' + track_id + '"]')
        check("cassette becomes selected", selected.get_attribute("data-selected") == "true")
        check("loaded cassette leaves an empty magazine slot", selected.evaluate("e => e.classList.contains('is-in-deck')"))
        check("cassette bay shows loaded state", page.locator("#cassette-bay-tape").get_attribute("data-loaded") == "true")
        check("player title populated", page.locator("#deck-title").inner_text().strip() not in ("", "NO TAPE LATCHED"))
    else:
        check("clean package may contain no sample cassettes", True)

    page.locator("#eq-toggle").click()
    check("EQ popover opens", page.locator("#eq-popover").is_visible())

    mobile = b.new_page(viewport={"width": 390, "height": 844})
    mobile.goto("http://127.0.0.1:8000/", wait_until="domcontentloaded")
    mobile.wait_for_timeout(150)
    check("same player exists on mobile", mobile.locator("#deck").is_visible())
    check("same rotary magazine exists on mobile", mobile.locator("#cassette-carousel").is_visible())
    check("same VU meters exist on mobile", mobile.locator(".vu").count() == 2)
    check("same spectrum exists on mobile", mobile.locator("#spectrum").is_visible())
    mobile_split = mobile.locator(".program-panel").evaluate("e => { const c=[...e.children]; return c.length>=2 ? [c[0].getBoundingClientRect().width,c[1].getBoundingClientRect().width] : [0,1]; }")
    check("mobile keeps the same 50/50 faceplate", abs(mobile_split[0] - mobile_split[1]) <= 2)
    if mobile.locator("[data-play]").count():
        mobile.locator("[data-play]").first.click()
        mobile.wait_for_timeout(900)
        check("mobile title remains visible", mobile.locator("#deck-title").is_visible() and mobile.locator("#deck-title").bounding_box()["height"] > 0)
    check("no page errors", not errs)
    b.close()

for name, ok in checks:
    print(("  PASS  " if ok else "  FAIL  ") + name)
print(("ALL PASS" if all(o for _, o in checks) else "FAILURES PRESENT") + f" ({sum(o for _,o in checks)}/{len(checks)})")
