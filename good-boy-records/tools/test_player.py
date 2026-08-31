#!/usr/bin/env python3
"""Browser checks for the gallery player.

Start the site first, in another terminal:

    python tools/serve.py
    python tools/test_player.py

Needs playwright (pip install playwright && playwright install chromium).
The dev server must support Range requests or the seek checks fail for the
wrong reason — tools/serve.py does, python -m http.server does not.
"""

from playwright.sync_api import sync_playwright
import shutil

checks = []
def check(name, ok):
    checks.append((name, ok))

with sync_playwright() as p:
    system_chromium = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    launch_args = {"executable_path": system_chromium, "args": ["--no-sandbox"]} if system_chromium else {}
    b = p.chromium.launch(**launch_args)
    page = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8000/", wait_until="networkidle")

    check("deck hidden before selection", page.locator("#deck").is_hidden())
    check("native controls removed by JS", not page.locator("#showcase-player").get_attribute("controls"))
    check("hover-preview toggle hidden before audio unlocked", page.locator("#preview-field").is_hidden())

    shelf_y = page.evaluate("window.scrollY")
    page.click('[data-play="gimmie-gimmie-ball"]')
    page.wait_for_timeout(1500)
    check("state is playing", page.locator("#deck").get_attribute("data-state") == "playing")
    check("url carries the track", "track=gimmie-gimmie-ball" in page.url)
    selected_card = page.locator('.card[data-track="gimmie-gimmie-ball"]')
    check("card marked selected", selected_card.get_attribute("data-selected") == "true")
    check("selected wall cassette mirrors playback state", selected_card.get_attribute("data-transport-state") == "playing")
    check("selection does not move the page to the monitor", abs(page.evaluate("window.scrollY") - shelf_y) < 20)
    check("preview toggle revealed after play", page.locator("#preview-field").is_visible())

    # Lyric sync: jump to 0:33, which sits inside the fourth cue.
    page.evaluate("document.getElementById('showcase-player').currentTime = 33")
    page.wait_for_timeout(900)
    active = page.locator(".lyrics__list li.is-active")
    check("exactly one active lyric after seek", active.count() == 1)
    check("correct lyric highlighted", active.first.inner_text().startswith("Gimmie!"))
    check("earlier lines marked as past", page.locator(".lyrics__list li.is-past").count() == 5)
    check("seek actually moved the clock", page.evaluate("document.getElementById('showcase-player').currentTime") > 30)

    # Manual scroll should hand control back to the reader.
    page.locator("#lyrics-scroll").hover()
    page.mouse.wheel(0, 200)
    page.wait_for_timeout(300)
    check("auto-scroll suspends on manual scroll", page.locator("#lyrics").get_attribute("data-following") == "false")
    page.click("#lyrics-return")
    check("return button resumes following", page.locator("#lyrics").get_attribute("data-following") == "true")

    # Pause path
    page.click("#transport-toggle")
    page.wait_for_timeout(400)
    check("pause reaches paused state", page.locator("#deck").get_attribute("data-state") == "paused")

    # Switching records reuses the one audio element.
    page.click('[data-play="dogtushya-v2"]')
    page.wait_for_timeout(1200)
    check("only one audio element exists", page.locator("audio").count() == 1)
    check("switching updates the deck title", "DOGTUSHYA" in page.locator("#deck-title").inner_text().upper())

    # Deep link loads but must not autoplay.
    page2 = b.new_page()
    page2.goto("http://localhost:8000/?track=sixteen-treats", wait_until="networkidle")
    page2.wait_for_timeout(600)
    check("deep link selects without playing", page2.locator("#deck").get_attribute("data-state") == "paused")
    check("deep link fills the deck", "SIXTEEN" in page2.locator("#deck-title").inner_text().upper())

    check("no page errors", not errs)
    b.close()

for name, ok in checks:
    print(("  PASS  " if ok else "  FAIL  ") + name)
print(("ALL PASS" if all(o for _, o in checks) else "FAILURES PRESENT") + f" ({sum(o for _,o in checks)}/{len(checks)})")
