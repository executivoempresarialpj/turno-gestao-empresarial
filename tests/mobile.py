"""Public booking on a real mobile viewport, using the optional local fixture."""
import os
import re
from datetime import date,timedelta
from playwright.sync_api import sync_playwright, expect

base=os.environ.get("TEST_APP_URL","http://localhost:3000")
with sync_playwright() as runner:
    browser=runner.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH"))
    page=browser.new_page(viewport={"width":390,"height":844},is_mobile=True,has_touch=True)
    page.goto(base+"/agendar/demonstracao-local")
    page.get_by_role("button",name="Agendar",exact=True).click()
    page.get_by_label("Data",exact=True).fill((date.today()+timedelta(days=3)).isoformat())
    page.get_by_role("button",name=re.compile(r"^\d\d:\d\d$")).first.click()
    page.get_by_label("Nome completo").fill("Pessoa Teste Mobile")
    page.get_by_label("WhatsApp com DDD").fill("11999900001")
    page.get_by_role("button",name="Revisar agendamento").click()
    page.get_by_role("button",name="Confirmar agendamento").click()
    expect(page.get_by_role("heading",name="Comprovante de reserva")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    page.get_by_role("button",name="Cancelar reserva").click()
    page.get_by_role("button",name="Confirmar cancelamento").click()
    expect(page.get_by_text("Cancelado",exact=True)).to_be_visible()
    browser.close()
print("Reserva sem login e cancelamento verificados em viewport de 390 × 844.")
