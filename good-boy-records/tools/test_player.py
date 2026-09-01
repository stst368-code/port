#!/usr/bin/env python3
"""Browser smoke checks for the centre-player cassette wall.

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
    launch_args = {"executable_path": system_chromium, "args": ["--no-sandbox"]} if system_chromium else {}
    b = p.chromium.launch(**launch_args)
    page = b.new_page(viewport={"width": 1600, "height": 1000})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8000/", wait_until="networkidle")

    check("centre player visible before selection", page.locator("#deck").is_visible())
    check("only one audio element exists", page.locator("audio").count() == 1)
    check("wall uses vertical composition stacks", page.locator(".composition-stack").count() >= 1)
    check("version markers exist left of cassettes", page.locator(".version-tag").count() == page.locator(".card").count())
    check("native controls removed by JS", not page.locator("#showcase-player").get_attribute("controls"))

    first = page.locator("[data-play]").first
    track_id = first.get_attribute("data-play")
    shelf_y = page.evaluate("window.scrollY")
    first.click()
    page.wait_for_timeout(500)
    selected = page.locator('.card[data-track="' + track_id + '"]')
    check("clicked wall cassette marked selected", selected.get_attribute("data-selected") == "true")
    check("selection does not scroll to player", abs(page.evaluate("window.scrollY") - shelf_y) < 20)
    check("player title populated", page.locator("#deck-title").inner_text().strip() not in ("", "NO TAPE SELECTED"))
    check("inspiration populated", "Select a cassette" not in page.locator("#deck-inspiration").inner_text())
    check("lyrics populated", page.locator("#lyrics-list li").count() > 1)
    check("no page errors", not errs)
    b.close()

for name, ok in checks:
    print(("  PASS  " if ok else "  FAIL  ") + name)
print(("ALL PASS" if all(o for _, o in checks) else "FAILURES PRESENT") + f" ({sum(o for _,o in checks)}/{len(checks)})")
